import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SONG_SCHEMA } from '../src/schema.js';
await writeFile(resolve(import.meta.dirname, '..', 'song.schema.json'), JSON.stringify(SONG_SCHEMA, null, 2) + '\n');
console.log('Generated song.schema.json from src/schema.js.');
