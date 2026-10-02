import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseSong, pitchToMidi } from '../src/parser.js';
import { buildSequence } from '../src/navigation.js';
import { shouldPlay, PlaybackEngine } from '../src/audio.js';
import { noteName, measureMarks } from '../src/score.js';
import { normalizeSong, validateSong, emptyMeasureSummary } from '../src/format.js';
import { validateAgainstSchema } from '../src/schema.js';

const measure = (number, extra = {}) => ({ number, notes: [], ...extra });
const song = measures => parseSong({ title: 'テスト', bpm: 80, key: 'C', timeSignature: '4/4', part: { name: '任意のパート', measures } });
const order = (measures, options = {}) => buildSequence(song(measures).parts[0], { mode: 'score', ...options }).map(m => m.number);

test('サンプルは両方のモードで読み込める', async () => {
  for (const name of ['andean-dialogue', 'navigation-demo', 'range-demo']) {
    const data = parseSong(await readFile(new URL(`../samples/${name}.json`, import.meta.url), 'utf8'));
    for (const part of data.parts) {
      assert.ok(buildSequence(part).length);
      assert.ok(buildSequence(part, { mode: 'score' }).length);
    }
  }
});
test('簡易楽譜の音名はオクターブ・臨時記号・休符を保持する', () => {
  assert.equal(noteName({ pitch: 'F#3' }), 'ファ♯3');
  assert.equal(noteName({ pitch: 'Bb4' }), 'シ♭4');
  assert.equal(noteName({ pitch: 'C-1' }), 'ド-1');
  assert.equal(noteName({ rest: true }), '休み');
});
test('簡易楽譜は演奏の移動記号を表示する', () => {
  const m = { ending:[1,2],repeat:{end:true,times:3},navigation:{toCoda:true,jump:{type:'DS',al:'coda'}} };
  assert.deepEqual(measureMarks(m), ['1・2番括弧', 'To Coda', 'D.S. al coda', '反復終了 ×3']);
});
test('区間デモの55〜60小節と61小節での拍子変更', async () => {
  const data = parseSong(await readFile(new URL('../samples/range-demo.json', import.meta.url), 'utf8'));
  const part = data.parts[0];
  assert.deepEqual(buildSequence(part, { start: 55, end: 60 }).map(m => m.number), [55,56,57,58,59,60]);
  assert.equal(part.measures[6].timeSignature, '6/8');
  assert.equal(part.measures[6].beats, 3);
  assert.equal(part.measures.at(-1).number, 68);
});
test('正式1.0形式は配布Schemaと同じ定義で検証される', async () => {
  const raw = JSON.parse(await readFile(new URL('../samples/range-demo.json', import.meta.url), 'utf8'));
  assert.equal(raw.formatVersion, '1.0');
  assert.deepEqual(validateAgainstSchema(raw), []);
  assert.equal(validateSong(raw).errors.length, 0);
});
test('旧形式と構造先行形式を安全な項目だけ正式形式へ変換する', () => {
  const converted = normalizeSong({ formatVersion:'1.0',title:'Condor',defaultTempo:90,parts:[{id:'tyo',name:'Tyo',instrument:'Toyo'}],score:{key:'G',timeSignature:{numerator:4,denominator:4}},navigation:[{type:'segno',measure:31}],measures:[{number:31,events:[],needsReview:true}] });
  assert.equal(converted.bpm,90); assert.equal(converted.part.name,'Tyo'); assert.equal(converted.key,'G');
  assert.deepEqual(converted.defaultTimeSignature,{numerator:4,denominator:4});
  assert.match(emptyMeasureSummary(converted),/1小節中1小節/);
  assert.equal(validateSong(converted).errors.length,0);
});
test('検証結果は小節とイベント位置を具体的に示す', () => {
  const bad = normalizeSong({title:'x',bpm:90,key:'G',timeSignature:'4/4',part:{name:'T',measures:[{number:55,notes:[{duration:1,player:'front'}]}]}});
  assert.match(validateSong(bad).errors.map(e=>e.message).join('\n'),/55小節 1番目.*pitch/);
});
test('D.S. al Codaでは初回のTo Codaを通過し、戻った後だけCodaへ進む', () => {
  const measures = [measure(1), measure(2,{navigation:{segno:true}}), measure(3,{navigation:{toCoda:true}}), measure(4,{navigation:{jump:{type:'DS',al:'coda'}}}), measure(5), measure(6,{navigation:{coda:true}}), measure(7)];
  assert.deepEqual(order(measures), [1,2,3,4,2,3,6,7]);
  assert.deepEqual(order(measures,{mode:'section',start:2,end:6}),[2,3,4,5,6]);
});
test('D.C. al Codaと名前付き記号', () => {
  assert.deepEqual(order([measure(1),measure(2,{navigation:{toCoda:'B'}}),measure(3,{navigation:{jump:{type:'DC',al:'coda'}}}),measure(4),measure(5,{navigation:{coda:'B'}})]),[1,2,3,1,2,5]);
});
test('D.C. al Fineでは戻った後だけFineで止まる', () => {
  assert.deepEqual(order([measure(1),measure(2,{navigation:{fine:true}}),measure(3,{navigation:{jump:{type:'DC',al:'fine'}}})]),[1,2,3,1,2]);
});
test('D.S.が一度だけ実行され、ジャンプは連鎖しない', () => {
  assert.deepEqual(order([measure(1,{navigation:{segno:'A'}}),measure(2,{navigation:{jump:{type:'DS',target:'A'}}}),measure(3,{navigation:{jump:{type:'DC'}}})]),[1,2,1,2,3]);
});
test('1番括弧と2番括弧を正しい順序で通る', () => {
  assert.deepEqual(order([measure(1,{repeat:{start:true}}),measure(2),measure(3,{ending:[1],repeat:{end:true}}),measure(4,{ending:[2]}),measure(5)]),[1,2,3,1,2,4,5]);
});
test('複数小節の括弧', () => {
  assert.deepEqual(order([measure(1,{repeat:{start:true}}),measure(2,{ending:[1]}),measure(3,{ending:[1],repeat:{end:true}}),measure(4,{ending:[2]}),measure(5,{ending:[2]})]),[1,2,3,1,4,5]);
});
test('3回反復と1・2共通括弧', () => {
  assert.deepEqual(order([measure(1,{repeat:{start:true}}),measure(2,{ending:[1,2],repeat:{end:true,times:3}}),measure(3,{ending:[3]})]),[1,2,1,2,1,3]);
});
test('入れ子の反復は外側の反復で内側の回数をリセットする', () => {
  assert.deepEqual(order([measure(1,{repeat:{start:true}}),measure(2,{repeat:{start:true}}),measure(3,{repeat:{end:true}}),measure(4,{repeat:{end:true}})]),[1,2,3,2,3,4,1,2,3,2,3,4]);
});
test('反復開始を省略した終了は先頭へ戻る', () => {
  assert.deepEqual(order([measure(1),measure(2,{repeat:{end:true}}),measure(3)]),[1,2,1,2,3]);
});
test('入れ子内の2番括弧は外側の反復回数に影響されない', () => {
  assert.deepEqual(order([measure(1,{repeat:{start:true}}),measure(2,{repeat:{start:true}}),measure(3,{ending:[1],repeat:{end:true}}),measure(4,{ending:[2]}),measure(5,{repeat:{end:true}})]),[1,2,3,2,4,5,1,2,3,2,4,5]);
});
test('D.C.後は反復を省略し2番括弧を演奏する', () => {
  assert.deepEqual(order([measure(1,{repeat:{start:true}}),measure(2,{ending:[1],repeat:{end:true}}),measure(3,{ending:[2]}),measure(4,{navigation:{jump:{type:'DC'}}})]),[1,2,1,3,4,1,3,4]);
});
test('楽譜進行サンプルの全経路', async () => {
  const data = parseSong(await readFile(new URL('../samples/navigation-demo.json',import.meta.url),'utf8'));
  assert.deepEqual(buildSequence(data.parts[0],{mode:'score'}).map(m=>m.number),[1,2,3,1,2,4,5,6,7,5,6,9,10]);
});
test('55〜68のような抜粋・欠番は番号を維持する', () => {
  assert.deepEqual(order([measure(55),measure(56),measure(60),measure(68)],{mode:'section',start:56,end:68}),[56,60,68]);
  assert.throws(()=>order([measure(55),measure(68)],{start:56}),/存在する/);
  assert.throws(()=>order([measure(55),measure(68)],{start:68,end:55}),/開始/);
});
test('途中の拍子変更と弱起と付点音符', () => {
  const part = song([measure(1,{beats:1,notes:[{pitch:'C4',duration:1,player:'front'}]}),measure(2,{timeSignature:'6/8',notes:[{pitch:'D4',duration:1.5,player:'back'},{rest:true,duration:1.5}]}),measure(3)]).parts[0];
  assert.deepEqual(part.measures.map(m=>m.beats),[1,3,3]);
  assert.deepEqual(part.measures.map(m=>m.timeSignature),['4/4','6/8','6/8']);
  assert.equal(part.measures[1].notes[1].offset,1.5);
});
test('実音と臨時記号', () => {
  assert.equal(pitchToMidi('A4'),69); assert.equal(pitchToMidi('Bb3'),58); assert.equal(pitchToMidi('F#4'),66); assert.equal(pitchToMidi('C-1'),0);
  assert.throws(()=>pitchToMidi('G#9')); assert.throws(()=>pitchToMidi('H4'));
});
test('担当unknownと休符は無音、bothはすべての選択で鳴る', () => {
  for (const target of ['front','back','both']) {
    assert.equal(shouldPlay({player:'unknown'},target),false);
    assert.equal(shouldPlay({player:'both',rest:true},target),false);
    assert.equal(shouldPlay({player:'both'},target),true);
  }
  assert.equal(shouldPlay({player:'front'},'back'),false);
  assert.equal(shouldPlay({player:'back'},'front'),false);
  assert.equal(shouldPlay({player:'front'},'both'),true);
});
test('不正な入力を拒否し音価の不足は許可する', () => {
  assert.throws(()=>parseSong('{'),/構文/);
  assert.throws(()=>song([measure(1),measure(1)]),/昇順/);
  assert.doesNotThrow(()=>song([measure(1,{notes:[{pitch:'C4',duration:5,player:'front'}]})]));
  assert.doesNotThrow(()=>song([measure(1,{notes:[{pitch:'C4',duration:3,player:'front'},{rest:true,duration:2}]})]));
  assert.throws(()=>song([measure(1,{notes:[{pitch:'C4',duration:1,player:'left'}]})]),/note\/rest|role/);
  assert.throws(()=>song([measure(1,{timeSignature:'0/4'})]),/拍子/);
  assert.equal(song([measure(1,{notes:[{pitch:'C4',duration:.5,player:'unknown'}]})]).parts[0].measures[0].beats,4);
});
test('存在しない・重複した移動先や未完了の反復を拒否', () => {
  assert.throws(()=>order([measure(1,{navigation:{jump:{type:'DS'}}})]),/Segno/);
  assert.throws(()=>order([measure(1,{navigation:{toCoda:true}})]),/Coda/);
  assert.throws(()=>order([measure(1,{navigation:{segno:true}}),measure(2,{navigation:{segno:true}})]),/重複/);
  assert.throws(()=>order([measure(1,{repeat:{start:true}})]),/反復終了/);
});

// A deterministic AudioContext clock exercises real scheduling code without audio hardware.
class FakeContext {
  currentTime = 0;
  state = 'running';
  destination = {};
  oscillators = [];
  resume() { return Promise.resolve(); }
  createGain() { return { gain:{ value:0,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){} },connect(){return this;},disconnect(){} }; }
  createOscillator() {
    const node = { frequency:{value:0},connect(){return this;},disconnect(){},start(time){this.startTime=time;},stop(time){this.stopTime=time;} };
    this.oscillators.push(node); return node;
  }
}
globalThis.AudioContext = FakeContext;
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
async function runAudio({ measures, countIn=0, loop=false, bpm=60, target='both', metronome=false, seconds=12 }) {
  const engine = new PlaybackEngine();
  const sequence = song(measures).parts[0].measures;
  await engine.play(sequence,{bpm,target,countIn,loop,metronome});
  clearInterval(engine.timer);
  for (let time=0;time<=seconds;time+=.02) { engine.context.currentTime=time; engine.tick(); }
  return engine;
}
test('2小節カウントインの後に正しい音高・タイミングで発音する', async () => {
  const engine = await runAudio({measures:[measure(1,{notes:[{pitch:'A4',duration:1,player:'front'}]})],countIn:2,seconds:9});
  const notes = engine.context.oscillators.filter(o=>o.frequency.value===440);
  assert.equal(notes.length,1); assert.ok(Math.abs(notes[0].startTime - 8.06)<.0001);
  assert.equal(engine.context.oscillators.filter(o=>o.frequency.value===1400).length,2);
  engine.stop();
});
test('拍子変更後も音符の開始時刻と区間ループが合う', async () => {
  const engine = await runAudio({measures:[measure(1,{notes:[{pitch:'A4',duration:1,player:'front'}]}),measure(2,{timeSignature:'3/4',notes:[{pitch:'A4',duration:1,player:'front'}]})],loop:true,seconds:8});
  assert.deepEqual(engine.context.oscillators.map(o=>Math.round(o.startTime*100)),[6,406,706]);
  engine.stop(); assert.equal(engine.active,false);
});
test('停止で予約済みの音も取り消す・停止中のテンポ変更', async () => {
  const engine = await runAudio({measures:[measure(1,{notes:[{pitch:'A4',duration:4,player:'front'}]})],seconds:0});
  assert.equal(engine.nodes.size,1);
  engine.stop(); assert.equal(engine.nodes.size,0); assert.equal(engine.active,false);
  engine.setBpm(120); assert.equal(engine.bpm,120);
});
test('再生準備中の停止によって遅れて再開しない', async () => {
  const engine = new PlaybackEngine();
  const pending = engine.play(song([measure(1)]).parts[0].measures);
  engine.stop(); await pending; assert.equal(engine.active,false);
});
