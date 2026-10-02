import { normalizeSong, beatsForMeter, meterText } from './format.js';
import { validateSong } from './validator.js';
export class SongFormatError extends Error {}
const fail = message => { throw new SongFormatError(message); };
export function parseTimeSignature(value, path = 'timeSignature') {
  const text = meterText(value), match = /^(\d{1,2})\/(1|2|4|8|16|32)$/.exec(text);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 32) fail(`${path} は「4/4」「6/8」のように指定してください。`);
  return { text, numerator: Number(match[1]), denominator: Number(match[2]), beats: beatsForMeter(value) };
}
export function pitchToMidi(pitch) {
  if (typeof pitch !== 'string') fail('pitch は C4、F#3、Bb5 の形式で指定してください。');
  const match = /^([A-G])([#b]?)(-1|[0-9])$/.exec(pitch);
  if (!match) fail(`音高「${pitch}」を読み取れません。C4、F#3、Bb5 の形式にしてください。`);
  const midi = (Number(match[3]) + 1) * 12 + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1]] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
  if (midi < 0 || midi > 127) fail(`音高「${pitch}」は対応範囲 C-1〜G9 の外です。`);
  return midi;
}
function applyNavigation(song, runtimeMeasures) {
  const byNumber = new Map(runtimeMeasures.map(measure => [measure.number, measure]));
  for (const item of song.navigation) {
    if (item.type === 'repeat') {
      const start = byNumber.get(Number(item.startMeasure)), end = byNumber.get(Number(item.endMeasure));
      if (start) start.repeat.start = true;
      if (end) { end.repeat.end = true; end.repeat.times = Number(item.times) || 2; }
    } else if (item.type === 'ending') {
      const start = runtimeMeasures.findIndex(m => m.number === Number(item.startMeasure)), end = runtimeMeasures.findIndex(m => m.number === Number(item.endMeasure));
      if (start >= 0 && end >= start) for (let i = start; i <= end; i++) if (!runtimeMeasures[i].ending.includes(Number(item.number))) runtimeMeasures[i].ending.push(Number(item.number));
    } else {
      const measure = byNumber.get(Number(item.measure)); if (!measure) continue;
      if (item.type === 'segno') measure.navigation.segno = item.id || 'default';
      if (item.type === 'coda') measure.navigation.coda = item.id || 'default';
      if (item.type === 'toCoda') measure.navigation.toCoda = item.target || item.id || 'default';
      if (item.type === 'fine') measure.navigation.fine = true;
      if (item.type === 'dalSegno') measure.navigation.jump = { type: 'DS', al: item.mode === 'alCoda' ? 'coda' : item.mode === 'alFine' ? 'fine' : 'end', target: item.target || 'default' };
      if (item.type === 'daCapo') measure.navigation.jump = { type: 'DC', al: item.mode === 'alCoda' ? 'coda' : item.mode === 'alFine' ? 'fine' : 'end', target: 'default' };
    }
  }
}
export function parseSong(input) {
  const validation = validateSong(input);
  if (!validation.song) fail(validation.errors[0]?.message ?? 'JSONを読み込めません。');
  if (validation.errors.length) fail(validation.errors.map(issue => issue.message).join('\n'));
  const song = normalizeSong(validation.song);
  let meter = parseTimeSignature(song.defaultTimeSignature, 'defaultTimeSignature'), section = '';
  const measures = song.measures.map(source => {
    if (source.timeSignature != null) meter = parseTimeSignature(source.timeSignature, `${source.number}小節の拍子`);
    if (typeof source.section === 'string' && source.section.trim()) section = source.section.trim();
    let offset = 0;
    const notes = source.events.map(event => {
      const rest = event.type === 'rest';
      const note = { pitch: rest ? null : event.pitch, midi: rest ? null : pitchToMidi(event.pitch), duration: event.duration, rest, player: rest ? 'unknown' : event.role, offset, needsReview: event.needsReview === true };
      offset += event.duration; return note;
    });
    return { number: source.number, timeSignature: meter.text, meter: { ...meter }, beats: Math.max(source.beats ?? meter.beats, offset), section, notes, repeat: { start: false, end: false, times: 2 }, ending: [], navigation: {}, needsReview: source.needsReview === true };
  });
  applyNavigation(song, measures);
  return { formatVersion: '1.0', title: song.title, bpm: song.bpm, key: song.key, canonical: song, parts: [{ ...song.part, measures }] };
}
