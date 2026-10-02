import { copyFile, lstat, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
// Publish only application assets, never the whole working directory.
const publicFiles = [
  'index.html', 'styles.css', 'manifest.webmanifest', 'sw.js', '_headers', '.nojekyll',
  'src/app.js', 'src/parser.js', 'src/navigation.js', 'src/audio.js',
  'src/storage.js', 'src/score.js', 'src/schema.js', 'src/format.js',
  'src/validator.js', 'src/editor.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'samples/andean-dialogue.json', 'samples/navigation-demo.json',
  'samples/range-demo.json', 'JSON_FORMAT.md', 'song.schema.json',
];
for (const file of publicFiles) {
  if (!(await lstat(join(root, file))).isFile()) throw new Error(`Not an application file: ${file}`);
}
// Verify the exact absolute output path before replacing generated output.
if (resolve(dist) !== join(root, 'dist') || dirname(dist) !== root) throw new Error('Unsafe output path');
const previous = await lstat(dist).catch(error => { if (error.code !== 'ENOENT') throw error; });
if (previous && (!previous.isDirectory() || previous.isSymbolicLink())) throw new Error('Output must be a regular directory');
await rm(dist, { recursive: true, force: true });
for (const file of publicFiles) {
  const target = join(dist, file);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(root, file), target);
}
console.log(`Ready: ${dist} (${publicFiles.length} application files)`);

if (process.platform === 'win32') {
  const zip = join(root, 'ayni-public.zip');
  const temporaryZip = join(root, `.ayni-public-${randomUUID()}.zip`);
  // Paths are passed through environment values, never interpolated into shell code.
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    "Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:AYNI_PACKAGE_DIR, $env:AYNI_PACKAGE_ZIP)",
  ], { encoding: 'utf8', env: { ...process.env, AYNI_PACKAGE_DIR: dist, AYNI_PACKAGE_ZIP: temporaryZip } });
  if (result.error || result.status !== 0) throw result.error || new Error(result.stderr || 'ZIP creation failed');
  await rename(temporaryZip, zip);
  console.log(`ZIP: ${zip}`);
} else {
  console.log('Upload the dist folder to your static host.');
}
