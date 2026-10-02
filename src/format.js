import { ROLE_VALUES, NAVIGATION_TYPES } from './schema.js';
export const ROLES = ROLE_VALUES;
export const NAV_TYPES = NAVIGATION_TYPES;
const clone = value => JSON.parse(JSON.stringify(value));
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const meterObject = value => {
  if (typeof value === 'string') { const match = /^(\d{1,2})\/(1|2|4|8|16|32)$/.exec(value); return match ? { numerator: Number(match[1]), denominator: Number(match[2]) } : value; }
  return object(value) ? { numerator: Number(value.numerator), denominator: Number(value.denominator) } : value;
};
const eventFromLegacy = event => !object(event) ? event : event?.type === 'rest' || event?.rest === true
  ? { ...event, type: 'rest', duration: Number(event.duration), needsReview: event.needsReview === true }
  : { ...event, type: event.type ?? 'note', pitch: event?.pitch ?? '', duration: Number(event?.duration), role: event?.role ?? event?.player ?? 'unknown', needsReview: event?.needsReview === true || (event?.role ?? event?.player ?? 'unknown') === 'unknown' };
function navigationFromInline(measures) {
  const output = [], starts = [];
  for (const m of measures) {
    const n = m.navigation ?? {};
    if (n.segno) output.push({ type: 'segno', measure: m.number, id: n.segno === true ? 'default' : n.segno });
    if (n.coda) output.push({ type: 'coda', measure: m.number, id: n.coda === true ? 'default' : n.coda });
    if (n.toCoda) output.push({ type: 'toCoda', measure: m.number, target: n.toCoda === true ? 'default' : n.toCoda });
    if (n.fine) output.push({ type: 'fine', measure: m.number });
    if (n.jump) output.push({ type: n.jump.type === 'DS' ? 'dalSegno' : 'daCapo', measure: m.number, target: typeof n.jump.target === 'string' ? n.jump.target : 'default', mode: n.jump.al === 'coda' ? 'alCoda' : n.jump.al === 'fine' ? 'alFine' : 'end' });
    if (m.repeat?.start) starts.push(m.number);
    if (m.repeat?.end) output.push({ type: 'repeat', startMeasure: starts.pop() ?? measures[0]?.number, endMeasure: m.number, times: m.repeat.times ?? 2 });
    for (const number of m.ending ?? []) output.push({ type: 'ending', number, startMeasure: m.number, endMeasure: m.number });
  }
  for (const startMeasure of starts) output.push({ type: 'repeat', startMeasure, endMeasure: null, times: 2 });
  return output;
}
function normalizeNavigation(raw, repeats = []) {
  if (raw != null && (!Array.isArray(raw) || raw.some(item => !object(item)))) throw new Error('navigationは記号オブジェクトの配列にしてください。');
  const output = (Array.isArray(raw) ? raw : []).filter(object).map(item => ({ ...clone(item), type: item.type === 'DS' ? 'dalSegno' : item.type === 'DC' ? 'daCapo' : item.type }));
  for (const repeat of Array.isArray(repeats) ? repeats : []) {
    const first = repeat.firstEnding, second = repeat.secondEnding;
    if (repeat.startMeasure && (first?.endMeasure ?? repeat.endMeasure)) output.push({ type: 'repeat', startMeasure: repeat.startMeasure, endMeasure: first?.endMeasure ?? repeat.endMeasure, times: 2, needsReview: repeat.needsReview === true });
    if (first) output.push({ type: 'ending', number: 1, startMeasure: first.startMeasure, endMeasure: first.endMeasure, needsReview: repeat.needsReview === true });
    if (second) output.push({ type: 'ending', number: 2, startMeasure: second.startMeasure, endMeasure: second.endMeasure, needsReview: repeat.needsReview === true });
  }
  return output;
}
/** @returns {import('./types').SongData} */
export function normalizeSong(input) {
  let raw;
  try { raw = typeof input === 'string' ? JSON.parse(input) : clone(input); } catch { throw new Error('JSONの構文が正しくありません。カンマや括弧を確認してください。'); }
  if (!object(raw)) throw new Error('JSONの最上位はオブジェクトにしてください。');
  const oldPart = raw.part ?? (Array.isArray(raw.parts) ? raw.parts[0] : undefined);
  const rawMeasures = raw.measures ?? oldPart?.measures ?? [];
  if (!Array.isArray(rawMeasures)) throw new Error('measuresは配列にしてください。');
  if (rawMeasures.some(m => !object(m))) throw new Error('measuresの各小節はオブジェクトにしてください。');
  const measures = (Array.isArray(rawMeasures) ? rawMeasures : []).map(m => ({
    ...m, number: Number(m.number), timeSignature: m.timeSignature == null ? null : meterObject(m.timeSignature), ...(m.beats != null ? { beats: Number(m.beats) } : {}),
    section: m.section == null ? null : String(m.section), events: Array.isArray(m.events ?? m.notes) ? (m.events ?? m.notes).map(eventFromLegacy) : m.events ?? m.notes,
    needsReview: m.needsReview === true
  }));
  for (const m of measures) {
    delete m.notes; delete m.repeat; delete m.ending; delete m.navigation;
    if(Array.isArray(m.events))for(const event of m.events)if(object(event)){delete event.player;delete event.rest;}
  }
  for (const change of raw.timeSignatureChanges ?? []) {
    const m = measures.find(m => m.number === Number(change.measure));
    if (!m) throw new Error('拍子変更：指定された' + change.measure + '小節が存在しません。');
    const meter = meterObject(change.timeSignature ?? change);
    if (m.timeSignature == null) m.timeSignature = { numerator: meter.numerator, denominator: meter.denominator };
  }
  let navigation = normalizeNavigation(raw.navigation, raw.repeatStructures);
  if (!navigation.length) navigation = navigationFromInline(Array.isArray(rawMeasures) ? rawMeasures : []);
  for (const nav of navigation) if (nav.type === 'dalSegno' && nav.targetMeasure != null && !nav.target) {
    const destination = navigation.find(n => n.type === 'segno' && n.measure === nav.targetMeasure);
    if (!destination) throw new Error('D.S.：指定された' + nav.targetMeasure + '小節にSegnoがありません。');
    nav.target = destination.id || 'default';
    delete nav.targetMeasure;
  }
  if (raw.markers != null && (!Array.isArray(raw.markers) || raw.markers.some(item => !object(item)))) throw new Error('markersはオブジェクトの配列にしてください。');
  const markers = Array.isArray(raw.markers) ? clone(raw.markers) : [];
  const metadata = { ...raw };
  for (const key of ['version','defaultTempo','parts','score','timeSignature','timeSignatureChanges','repeatStructures']) delete metadata[key];
  for (const marker of markers) { const measure = measures.find(m => m.number === Number(marker.measure)); if (measure && !measure.section && marker.label) measure.section = String(marker.label); }
  return {
    ...metadata, formatVersion: raw.formatVersion ?? '1.0', title: raw.title ?? '', bpm: Number(raw.bpm ?? raw.defaultTempo),
    part: { ...Object.fromEntries(Object.entries(oldPart ?? {}).filter(([key]) => key !== 'measures')), id: oldPart?.id ?? 'part', name: oldPart?.name ?? 'Part', instrument: oldPart?.instrument ?? oldPart?.name ?? 'Instrument' },
    key: raw.key ?? raw.score?.key ?? '', defaultTimeSignature: meterObject(raw.defaultTimeSignature ?? raw.score?.timeSignature ?? raw.timeSignature ?? '4/4'),
    markers, navigation, measures
  };
}
export const meterText = value => { const meter = meterObject(value); return object(meter) ? `${meter.numerator}/${meter.denominator}` : String(meter ?? ''); };
export const beatsForMeter = value => { const meter = meterObject(value); return object(meter) && Number.isFinite(meter.numerator) && Number.isFinite(meter.denominator) && meter.denominator > 0 ? meter.numerator * 4 / meter.denominator : NaN; };
export const navigationLabel = type => ({ segno: 'Segno', coda: 'Coda', toCoda: 'To Coda', dalSegno: 'D.S.', daCapo: 'D.C.', fine: 'Fine', repeat: 'Repeat', ending: 'Ending' })[type] ?? type;
export function emptyMeasureSummary(song) { const empty = song.measures.filter(m => Array.isArray(m.events) && m.events.length === 0).length; return empty ? `この曲には${song.measures.length}小節中${empty}小節で音符データがありません。まだ再生用データとして完成していません。` : ''; }

/** Legacy multi-part scores become separate, lossless library entries. */
export function normalizeSongs(input) {
  const raw = typeof input === 'string' ? JSON.parse(input) : input;
  if (!raw?.part && Array.isArray(raw?.parts) && raw.parts.length > 1) return raw.parts.map(part => normalizeSong({ ...raw, parts: [part], measures: part.measures ?? raw.measures }));
  return [normalizeSong(input)];
}

export { validateSong } from './validator.js';
