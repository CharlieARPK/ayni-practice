// Reproducible sample music and PWA icons; no build-time dependencies.
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { resolve } from 'node:path';
import { normalizeSong } from '../src/format.js';
const root = resolve(import.meta.dirname, '..');
await mkdir(resolve(root, 'samples'), { recursive: true });
await mkdir(resolve(root, 'icons'), { recursive: true });
const melody = [
  ['G3','B3','D4','B3'], ['A3','C4','E4','D4'], ['B3','D4','G4','D4'], ['A3','B3','G3',null],
  ['G3','A3','B3','D4'], ['E4','D4','B3','A3'], ['G3','B3','A3','D4'], ['B3','A3','G3',null],
  ['D4','G4','F#4','E4'], ['D4','B3','A3','B3'], ['C4','E4','D4','B3'], ['A3','B3','G3',null],
  ['G3','B3','D4','G4'], ['E4','D4','C4','A3'], ['B3','A3','G3','A3'], ['G3',null]
];
const measures = melody.map((pitches, index) => ({
  number: index + 1,
  ...([0,4,8,12].includes(index) ? { section: ['イントロ','テーマ A','テーマ B','エンディング'][index / 4] } : {}),
  notes: pitches.map((pitch, n) => pitch ? { pitch, duration: pitches.length === 2 ? 2 : 1, player: index === 15 ? 'both' : n % 2 === 0 ? 'front' : 'back' } : { rest: true, duration: pitches.length === 2 ? 2 : 1 })
}));
await writeFile(resolve(root, 'samples/andean-dialogue.json'), JSON.stringify(normalizeSong({ version:1, title:'風のたより', bpm:80, key:'G major', timeSignature:'4/4', part:{ id:'zampoña', name:'Zampoña', instrument:'Zampoña', measures } }), null, 2) + '\n');
const navMeasures = Array.from({ length: 10 }, (_, i) => ({ number:i + 1, notes:[{ pitch:['G4','A4','B4','C5','D5'][i % 5], duration:i === 8 ? 3 : 4, player:i % 2 ? 'back' : 'front' }] }));
navMeasures[0].section = '反復と括弧';
navMeasures[0].repeat = { start:true };
navMeasures[2].ending = [1];
navMeasures[2].repeat = { end:true };
navMeasures[3].ending = [2];
navMeasures[4].section = 'Segno';
navMeasures[4].navigation = { segno:true };
navMeasures[5].navigation = { toCoda:true };
navMeasures[6].navigation = { jump:{ type:'DS', al:'coda' } };
navMeasures[8].section = 'Coda · 3/4';
navMeasures[8].timeSignature = '3/4';
navMeasures[8].navigation = { coda:true };
navMeasures[9].notes[0].duration = 3;
await writeFile(resolve(root, 'samples/navigation-demo.json'), JSON.stringify(normalizeSong({ version:1,title:'楽譜進行の練習',bpm:100,key:'G major',timeSignature:'4/4',part:{ id:'demo',name:'任意のパート名',instrument:'任意',measures:navMeasures } }), null, 2) + '\n');

const rangeMeasures = Array.from({ length: 14 }, (_, i) => ({
  number: 55 + i,
  ...(i === 0 ? { section: '55〜60小節 · 4/4' } : i === 6 ? { section: '61〜68小節 · 6/8', timeSignature: '6/8' } : {}),
  notes: i < 6 ? [
    { pitch: 'G4', duration: 1.5, player: 'front' },
    { pitch: 'A4', duration: .5, player: 'back' },
    { rest: true, duration: .5 },
    { pitch: 'B4', duration: .5, player: 'front' },
    { pitch: 'D5', duration: 1, player: 'back' }
  ] : [
    { pitch: 'B4', duration: .5, player: 'front' },
    { pitch: 'A4', duration: .5, player: 'back' },
    { pitch: 'G4', duration: .5, player: 'front' },
    { pitch: 'D5', duration: 1.5, player: i === 13 ? 'both' : 'back' }
  ]
}));
await writeFile(resolve(root, 'samples/range-demo.json'), JSON.stringify(normalizeSong({ version: 1, title: '山のこだま', bpm: 80, key: 'G major', timeSignature: '4/4', part: { id:'malta',name: 'Malta',instrument:'Malta', measures: rangeMeasures } }), null, 2) + '\n');

const crc = bytes => {
  let c = 0xffffffff;
  for (const byte of bytes) { c ^= byte; for (let n = 0; n < 8; n++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0); }
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, bytes) => {
  const content = Buffer.concat([Buffer.from(type), bytes]);
  const size = Buffer.alloc(4); size.writeUInt32BE(bytes.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc(content));
  return Buffer.concat([size, content, checksum]);
};
for (const size of [192,512]) {
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x / size * 512; const py = y / size * 512;
    const angle = 7 * Math.PI / 180;
    const ux = Math.cos(angle) * (px - 256) - Math.sin(angle) * (py - 256) + 256;
    const uy = Math.sin(angle) * (px - 256) + Math.cos(angle) * (py - 256) + 256;
    let inside = false;
    for (let n = 0; n < 5; n++) {
      const centerX = 155.5 + n * 49;
      const bottom = 385 - n * 33;
      const nearY = Math.max(162.5, Math.min(bottom - 17.5, uy));
      if ((ux - centerX) ** 2 + (uy - nearY) ** 2 <= 17.5 ** 2) inside = true;
    }
    const offset = y * (1 + size * 3) + 1 + x * 3;
    raw.set(inside ? [220,105,62] : [245,244,239], offset);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size,0); header.writeUInt32BE(size,4); header[8]=8; header[9]=2;
  await writeFile(resolve(root, `icons/icon-${size}.png`), Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
}
console.log('Generated samples and PWA icons.');
