import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SONG_SCHEMA, validateAgainstSchema } from '../src/schema.js';
import { normalizeSong, normalizeSongs } from '../src/format.js';
import { validateSong } from '../src/validator.js';
import { parseSong } from '../src/parser.js';
import { DataEditor } from '../src/editor.js';
import { buildSequence } from '../src/navigation.js';

const note = (role='front') => ({type:'note',pitch:'G3',duration:4,role,needsReview:false});
const fixture = () => ({formatVersion:'1.0',title:'Test',bpm:90,part:{id:'test',name:'自由なパート',instrument:'任意'},key:'G',defaultTimeSignature:{numerator:4,denominator:4},markers:[],navigation:[],measures:[55,56,57].map(number=>({number,timeSignature:null,events:[note()],needsReview:false}))});
function editor(data=fixture(),save=()=>{}) {
  const messages=[],plays=[];
  const root={innerHTML:'',addEventListener(){},querySelector(){return null;}};
  const e=new DataEditor({root,player:{async play(sequence,options){plays.push({sequence,options});},stop(){}},getBpm:()=>123,onSave:save,toast:(...args)=>messages.push(args)});
  e.load(data);e.messages=messages;e.plays=plays;
  return e;
}
const click=(e,action)=>e.onClick({target:{closest:()=>({dataset:{action},closest:()=>null})}});
const navigationInput=(index,field,value)=>({dataset:{navField:field},value:String(value),type:'number',tagName:'INPUT',closest:selector=>selector==='[data-navigation]'?{dataset:{navigation:String(index)}}:null});

test('To CodaとD.S.の位置編集は保存・再読み込み・演奏順に反映される',async()=>{
  const data=JSON.parse(await readFile(new URL('../samples/navigation-demo.json',import.meta.url),'utf8'));
  let saved;
  const e=editor(data,value=>{saved=JSON.stringify(value);});
  e.onChange({target:navigationInput(4,'measure',5)});
  e.onChange({target:navigationInput(5,'measure',8)});
  const expected=[1,2,3,1,2,4,5,6,7,8,5,9,10];
  assert.deepEqual(e.route().sequence.map(m=>m.number),expected);
  click(e,'save');
  assert.deepEqual(buildSequence(parseSong(saved).parts[0],{mode:'score'}).map(m=>m.number),expected);
  assert.equal(data.navigation[4].measure,6);
});

test('曲進行の参照先エラーは具体的に表示し保存を止める',()=>{
  let saves=0;const e=editor(fixture(),()=>saves++);
  e.data.navigation=[{type:'coda',id:'c1',measure:57},{type:'toCoda',target:'c1',measure:56}];
  e.onChange({target:navigationInput(1,'measure',999)});
  click(e,'save');assert.equal(saves,0);assert.equal(e.dirty,true);
  assert.match(e.messages.at(-1)[0],/To Coda.*999小節/);
  assert.match(e.renderRoutePreview(),/999小節/);
});

test('直接入力した音価の警告色と曲進行件数を更新する',()=>{
  const e=editor(),beat={textContent:'',className:''},status={textContent:''};
  e.root.querySelector=selector=>selector==='.beat-check'?beat:selector==='.nav-preview .panel-heading>span'?status:null;
  e.current().events[0].duration=3.5;e.refreshChecks();
  assert.equal(beat.className,'beat-check warning');assert.match(beat.textContent,/0.5拍不足/);assert.equal(status.textContent,'3小節');
  e.current().events[0].duration=4;e.data.navigation=[{type:'repeat',startMeasure:55,endMeasure:56,times:2}];e.refreshChecks();
  assert.equal(beat.className,'beat-check ok');assert.equal(status.textContent,'5小節');
});

test('公開Schemaは実行時の定義と一致する',async()=>assert.deepEqual(JSON.parse(await readFile(new URL('../song.schema.json',import.meta.url),'utf8')),SONG_SCHEMA));
test('Schema単体がNavigation種別ごとの必須項目を検証する',()=>{
  for(const nav of [{type:'segno'},{type:'repeat',startMeasure:55},{type:'ending',startMeasure:55,endMeasure:56}]) {const data=fixture();data.navigation=[nav];assert.ok(validateAgainstSchema(data).length);}
});
test('構造が壊れたJSONでも検証が例外で中断しない',()=>{
  for(const change of [{measures:[null]},{measures:{}},{navigation:{}},{navigation:[null]},{markers:[null]},{measures:[{number:55,events:null}]},{measures:[{number:55,events:[null]}]}]) {
    const result=validateSong({...fixture(),...change});assert.ok(result.errors.length);
  }
});
test('未知のevent typeや版、音域外、逆順範囲を拒否する',()=>{
  const data=fixture();data.measures[0].events[0].type='chord';assert.ok(validateSong(data).errors.length);
  data.measures[0].events[0]=note();data.measures[0].events[0].pitch='G#9';assert.ok(validateSong(data).errors.some(i=>i.message.includes('C-1')));
  assert.ok(validateSong({...fixture(),formatVersion:'2.0'}).errors.length);
  const nav=fixture();nav.navigation=[{type:'repeat',startMeasure:57,endMeasure:55}];assert.ok(validateSong(nav).errors.length);
});
test('複数の旧パートと追加メタデータを保持する',()=>{
  const legacy={title:'Old',bpm:80,timeSignature:'4/4',source:{note:'keep'},parts:['Toyo','Sanka'].map((name,index)=>({name,measures:[{number:1,notes:[{pitch:index?'C3':'C4',duration:4,player:'front',confidence:'low'}]}]}))};
  const converted=normalizeSongs(legacy);assert.equal(converted.length,2);assert.deepEqual(converted.map(s=>s.part.name),['Toyo','Sanka']);assert.equal(converted[1].measures[0].events[0].pitch,'C3');assert.equal(converted[0].source.note,'keep');assert.equal(converted[0].measures[0].events[0].confidence,'low');assert.equal(legacy.parts.length,2);
});
test('拍子変更を継承して6/8と9/8の警告を計算する',()=>{
  const data=fixture();data.measures[0].timeSignature={numerator:6,denominator:8};data.measures[0].events[0].duration=2.5;data.measures[1].events[0].duration=3;data.measures[2].timeSignature={numerator:9,denominator:8};data.measures[2].events[0].duration=5;
  const issues=validateSong(data).warnings.filter(i=>i.code==='beats');assert.equal(issues.length,2);assert.match(issues[0].message,/0.5拍不足/);assert.match(issues[1].message,/0.5拍超過/);assert.equal(parseSong(data).parts[0].measures[2].beats,5);
});
test('編集下書きだけを試聴し、無関係な小節エラーに影響されない',async()=>{
  const data=fixture(),e=editor(data);e.data.measures[0].events[0].pitch='F#4';e.data.measures[2].events[0].pitch='invalid';await e.audition('current','back');assert.equal(e.plays.length,1);assert.equal(e.plays[0].sequence[0].notes[0].pitch,'F#4');assert.equal(e.plays[0].options.bpm,123);assert.equal(e.plays[0].options.target,'back');assert.equal(data.measures[0].events[0].pitch,'G3');
});
test('前後3小節の試聴と空eventsでの停止',async()=>{
  const e=editor();e.selected=56;await e.audition('around');assert.deepEqual(e.plays[0].sequence.map(m=>m.number),[55,56,57]);e.current().events=[];await e.audition('current');assert.equal(e.plays.length,1);assert.match(e.messages.at(-1)[0],/56小節：音符データがありません/);
});
test('空eventsとunknownは確認済みにできない',()=>{
  const e=editor();e.current().events=[];click(e,'confirm-measure');assert.match(e.messages.at(-1)[0],/空のevents/);assert.equal(e.flags(e.current()).review,true);e.current().events=[note('unknown')];click(e,'confirm-measure');assert.equal(e.flags(e.current()).review,true);
});
test('確認フローが次の要確認へ移り、全件終了を表示する',()=>{
  const e=editor();e.data.measures[0].needsReview=true;e.data.measures[2].needsReview=true;click(e,'review-flow');assert.equal(e.selected,55);click(e,'confirm-measure');assert.equal(e.selected,57);click(e,'confirm-measure');assert.equal(e.reviewFlow,false);assert.match(e.messages.at(-1)[0],/要確認項目はありません/);
});
test('保存失敗時は下書きと未保存フラグを維持する',()=>{
  const e=editor(fixture(),()=>{throw new Error('保存容量不足');});e.dirty=true;click(e,'save');assert.equal(e.dirty,true);assert.match(e.messages.at(-1)[0],/保存容量不足/);
});
test('保存は選択小節を維持し、書き出しファイル名を生成する',()=>{
  let saved;const e=editor(fixture(),data=>saved=data);e.selected=56;e.data.title='Condor canqui';e.data.part.id='tyo';e.dirty=true;click(e,'save');assert.equal(e.selected,56);assert.equal(e.dirty,false);assert.equal(saved.title,'Condor canqui');assert.equal(e.filename(),'condor_canqui_tyo.json');assert.notEqual(saved,e.data);
});
test('書き出すJSONは下書きを保持し正式Schemaに適合する',async(t)=>{
  let blob,anchor;
  t.mock.method(URL,'createObjectURL',value=>{blob=value;return 'blob:test';});
  t.mock.method(URL,'revokeObjectURL',()=>{});
  t.mock.method(globalThis,'setTimeout',fn=>{fn();return 0;});
  globalThis.document={createElement(){anchor={click(){this.clicked=true;}};return anchor;}};
  t.after(()=>delete globalThis.document);
  const e=editor();e.current().events[0].pitch='Bb3';e.exportJson();
  assert.equal(anchor.clicked,true);assert.equal(anchor.download,'test_test.json');
  const exported=JSON.parse(await blob.text());assert.equal(exported.measures[0].events[0].pitch,'Bb3');assert.deepEqual(validateAgainstSchema(exported),[]);
});
