import { normalizeSong, beatsForMeter, navigationLabel, ROLES } from './format.js';
import { validateAgainstSchema } from './schema.js';
export function validateSong(input) {
  let song;
  try { song = normalizeSong(input); } catch (error) { const issue = { level: 'error', message: error.message }; return { song: null, errors: [issue], warnings: [], issues: [issue] }; }
  const issues = validateAgainstSchema(song).map(message => {
    const match = /\$\.measures\[(\d+)\]/.exec(message);
    return { level: 'error', ...(match ? { measure: song.measures[Number(match[1])]?.number } : {}), message: message.replace(/\$\.measures\[(\d+)\]/g, (_, index) => song.measures[Number(index)]?.number + '小節').replace(/\.events\[(\d+)\]/g, (_, index) => ' ' + (Number(index) + 1) + '番目') };
  });
  const add = (level, message, extra = {}) => issues.push({ level, message, ...extra });
  if (!String(song.title ?? '').trim()) add('error', 'titleがありません。');
  if (!Number.isFinite(song.bpm)) add('error', 'bpmがありません。');
  const seen = new Set(); let meter = song.defaultTimeSignature, previous = 0;
  for (const measure of song.measures) {
    if (measure.number <= previous) add('error', `${measure.number}小節：小節番号は重複せず昇順にしてください。`, { measure: measure.number });
    previous = measure.number;
    if (seen.has(measure.number)) add('error', `${measure.number}小節：小節番号が重複しています。`, { measure: measure.number });
    seen.add(measure.number); if (measure.timeSignature) meter = measure.timeSignature;
    const expected = measure.beats ?? beatsForMeter(meter); let total = 0;
    if (!Number.isFinite(expected) || expected <= 0) add('error', `${measure.number}小節：拍子が正しくありません。`, { measure: measure.number });
    if (!Array.isArray(measure.events)) { add('error', `${measure.number}小節：eventsは配列にしてください。`, { measure: measure.number }); continue; }
    if (!measure.events.length) add('warning', `${measure.number}小節：音符データがありません。`, { measure: measure.number, code: 'empty' });
    measure.events.forEach((event, index) => {
      const at = `${measure.number}小節 ${index + 1}番目`;
      if (!['note','rest'].includes(event?.type)) add('error', `${at}：typeはnoteまたはrestにしてください。`, { measure: measure.number, event:index });
      if (!Number.isFinite(event?.duration) || event.duration <= 0) add('error', `${at}：durationは正数にしてください。`, { measure:measure.number,event:index }); else total += event.duration;
      if (event?.type === 'note') {
        if (typeof event.pitch !== 'string' || !/^[A-G][#b]?(-1|[0-9])$/.test(event.pitch)) add('error', `${at}のnoteにpitchがないか、形式が正しくありません。`, { measure:measure.number,event:index });
        if (!ROLES.includes(event.role)) add('error', `${at}のnote：roleはfront/back/both/unknownのいずれかです。`, { measure:measure.number,event:index });
        const match = /^([A-G])([#b]?)(-1|[0-9])$/.exec(event.pitch);
        if (match) {
          const midi = (Number(match[3])+1)*12 + {C:0,D:2,E:4,F:5,G:7,A:9,B:11}[match[1]] + (match[2]==='#'?1:match[2]==='b'?-1:0);
          if(midi<0||midi>127)add('error',`${at}：pitchはC-1〜G9の範囲にしてください。`,{measure:measure.number,event:index});
        }
        if (event?.role === 'unknown') add('warning', `${at}のnote：roleが未設定です。`, { measure: measure.number, event: index, code: 'unknown-role' });
      }
      if (event?.needsReview) add('warning', `${at}：要確認です。`, { measure: measure.number, event: index, code: 'review' });
    });
    if (Number.isFinite(expected) && Math.abs(total - expected) > .000001) add('warning', `${measure.number}小節：${Number(Math.abs(total - expected).toFixed(4))}拍${total < expected ? '不足' : '超過'}しています（${Number(total.toFixed(4))} / ${Number(expected.toFixed(4))}拍）。`, { measure: measure.number, code: 'beats' });
    if (measure.needsReview) add('warning', `${measure.number}小節：要確認です。`, { measure: measure.number, code: 'review' });
  }
  for (const nav of song.navigation) {
    if (['repeat','ending'].includes(nav.type) && nav.startMeasure > nav.endMeasure) add('error', `${navigationLabel(nav.type)}：開始小節は終了小節以前にしてください。`);
    if (nav.type === 'repeat' && !Number.isInteger(nav.endMeasure)) add('error', `Repeat：${nav.startMeasure}小節の反復開始に対応する反復終了がありません。`, { navigation: nav.type });
    const refs = nav.type === 'repeat' || nav.type === 'ending' ? [nav.startMeasure, nav.endMeasure] : [nav.measure];
    for (const value of refs) if (!seen.has(Number(value))) add('error', `${navigationLabel(nav.type)}：指定された${value}小節が存在しません。`, { navigation: nav.type });
    if (nav.needsReview) add('warning', `${navigationLabel(nav.type)} ${nav.measure ?? `${nav.startMeasure}〜${nav.endMeasure}`}小節：要確認です。`, { navigation: nav.type, code: 'review' });
  }
  const segnos = new Set(song.navigation.filter(n => n.type === 'segno').map(n => n.id || 'default'));
  const codas = new Set(song.navigation.filter(n => n.type === 'coda').map(n => n.id || 'default'));
  for (const nav of song.navigation) {
    if (nav.type === 'dalSegno' && !segnos.has(nav.target || 'default')) add('error', `D.S.：移動先Segno「${nav.target || 'default'}」がありません。`, { navigation: nav.type });
    if (nav.type === 'toCoda' && !codas.has(nav.target || 'default')) add('error', `To Coda：移動先Coda「${nav.target || 'default'}」がありません。`, { navigation: nav.type });
  }
  for (const type of ['segno','coda']) {
    const ids = new Set();
    for (const nav of song.navigation.filter(n=>n.type===type)) { const id=nav.id||'default';if(ids.has(id))add('error',`${navigationLabel(type)}：ID「${id}」が重複しています。`);ids.add(id); }
  }
  const occupied = new Set();
  for(const nav of song.navigation.filter(n=>!['repeat','ending'].includes(n.type))){
    const slot=`${['dalSegno','daCapo'].includes(nav.type)?'jump':nav.type}:${nav.measure}`;
    if(occupied.has(slot))add('error',`${navigationLabel(nav.type)}：${nav.measure}小節の記号が重複しています。`);
    occupied.add(slot);
  }
  const repeats=song.navigation.filter(n=>n.type==='repeat');
  for(let i=0;i<repeats.length;i++)for(let j=i+1;j<repeats.length;j++){
    const a=repeats[i],b=repeats[j];
    if(a.startMeasure===b.startMeasure||a.endMeasure===b.endMeasure||(a.startMeasure<b.startMeasure&&b.startMeasure<=a.endMeasure&&a.endMeasure<b.endMeasure)||(b.startMeasure<a.startMeasure&&a.startMeasure<=b.endMeasure&&b.endMeasure<a.endMeasure))add('error','Repeat：反復範囲が重複または交差しています。開始・終了小節を確認してください。');
  }
  for (const marker of song.markers) if(!seen.has(marker.measure))add('error',`セクション ${marker.label}：指定された${marker.measure}小節が存在しません。`);
  return { song, issues, errors: issues.filter(i => i.level === 'error'), warnings: issues.filter(i => i.level === 'warning') };
}
