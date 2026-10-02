import { parseSong } from './parser.js';
import { buildSequence, restartIndex } from './navigation.js';
import { PlaybackEngine } from './audio.js';
import { loadLibrary, saveLibrary, createEntry } from './storage.js';
import { renderPracticeScore } from './score.js';
import { normalizeSongs, normalizeSong, emptyMeasureSummary } from './format.js';
import { validateSong } from './validator.js';
import { DataEditor } from './editor.js';

const $ = id => document.getElementById(id);
let library = [];
let song;
let selectedId;
let partIndex = 0;
let currentNumber = 1;
let role = 'front';
let mode = 'section';
let toastTimer;
let wakeLock;
let installPrompt;
let playRequest = 0;
let storageDamaged = false;
let scoreOffset = 0;
let routeSequence = [];
let routeIndex = 0;
let routeWindow = -1;
let appView = 'practice';
let dataEditor;
const part = () => song.parts[partIndex];
const target = () => role === 'front' ? 'back' : role === 'back' ? 'front' : 'both';
const player = new PlaybackEngine({
  onPosition(position) {
    if(appView === 'editor'){dataEditor?.setPosition(position);return;}
    showMeasure(position.measure, position.beat, position.progress);
    updateRoutePosition(position.index);
    if (position.counting) $('play-state').textContent = `カウント ${position.countRemaining} · ${position.beat + 1}`;
  },
  onState(state) {
    if(state==='stopped')dataEditor?.setPosition(null);
    $('play-state').textContent = { stopped: 'スタンバイ', counting: 'カウントイン', playing: '演奏中' }[state];
    $('play-state').classList.toggle('playing', state !== 'stopped');
    $('play-button').disabled = state !== 'stopped';
    if (state === 'stopped') {
      $('measure-progress').style.width = '0%';
      $('beat-dots').querySelectorAll('i').forEach(dot => dot.classList.remove('active'));
      releaseWakeLock();
    }
  },
  onError(error) { toast(error.message, true); }
});
dataEditor = new DataEditor({
  root: $('editor-view'), player, getBpm: () => Number($('bpm').value), toast,
  onSave(data) {
    if(storageDamaged)throw new Error('保存データを読み込めなかったため上書きを防いでいます。JSONを書き出して保管してください。');
    const index = library.findIndex(entry => entry.id === selectedId);
    if (index < 0) return;
    const next = library.map((entry, at) => at === index ? { ...entry, data } : entry);
    const parsed=parseSong(data); saveLibrary(next); library = next; stop(); song=parsed; renderLibrary(); renderMeasures(); updateRange(); showMeasure(part().measures.find(m=>m.number===currentNumber)??part().measures[0]); renderPreview(); renderReadableScore(); updateDataStatus(data);
  }
});

function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').classList.toggle('error', error);
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 9000 : 4000);
}
function persistSelection() { try { localStorage.setItem('ayni.selection', selectedId); } catch {} }
function stop() { playRequest++; player.stop(); }
function setAppView(value) {
  stop(); appView = value;
  $('practice-view').hidden = value !== 'practice'; $('editor-view').hidden = value !== 'editor';
  for (const [id, name] of [['practice-tab','practice'],['editor-tab','editor']]) { const active=value===name;$(id).classList.toggle('active',active);$(id).setAttribute('aria-pressed',String(active)); }
  if (value === 'editor' && song) dataEditor.render();
}
function updateDataStatus(canonical) {
  const validation = validateSong(canonical), empty = emptyMeasureSummary(canonical);
  const reviewMeasures = new Set(validation.warnings.filter(issue => issue.measure && ['review','unknown-role','empty'].includes(issue.code)).map(issue => issue.measure));
  $('review-count').textContent = reviewMeasures.size ? `(${reviewMeasures.size})` : '';
  $('data-warning').hidden = !empty;
  $('data-warning').textContent = empty;
}
async function releaseWakeLock() {
  const old = wakeLock;
  wakeLock = null;
  try { await old?.release(); } catch {}
}
async function keepAwake() {
  if (!('wakeLock' in navigator) || !player.active || wakeLock) return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (!player.active) await lock.release();
    else { wakeLock = lock; lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; }); }
  } catch {}
}

function renderLibrary() {
  $('song-count').textContent = library.length;
  $('song-list').replaceChildren();
  library.forEach(entry => {
    const button = document.createElement('button');
    button.className = `song-item${entry.id === selectedId ? ' active' : ''}`;
    button.setAttribute('aria-pressed', String(entry.id === selectedId));
    button.innerHTML = '<svg><use href="#i-music"/></svg><span class="song-item-text"><strong></strong><small></small></span><svg class="song-item-arrow"><use href="#i-chevron"/></svg>';
    button.querySelector('strong').textContent = entry.data.title;
    button.querySelector('small').textContent = `${entry.data.parts?.[0]?.name ?? entry.data.part?.name ?? ''} · ${entry.data.bpm} BPM`;
    button.addEventListener('click', () => selectSong(entry.id));
    $('song-list').append(button);
  });
}
function canReplaceDraft(){return !dataEditor?.dirty || confirm('未保存の編集内容があります。変更を破棄して曲を切り替えますか？');}
window.addEventListener('beforeunload',event=>{if(dataEditor?.dirty){event.preventDefault();event.returnValue='';}});
function selectSong(id, discardApproved = false) {
  if(!discardApproved && !canReplaceDraft())return;
  try {
    const entry = library.find(item => item.id === id);
    if (!entry) return;
    const canonical = normalizeSong(entry.data);
    const validation = validateSong(canonical);
    if (validation.errors.length) throw new Error(validation.errors.map(issue => issue.message).join('\n'));
    const parsed = parseSong(canonical);
    entry.data = canonical;
    stop();
    song = parsed;
    $('demo-guide').hidden = true;
    selectedId = id;
    partIndex = 0;
    $('song-title').textContent = song.title;
    document.title = `${song.title} · Ayni`;
    $('song-key').textContent = song.key;
    $('default-bpm').textContent = song.bpm;
    $('part-select').replaceChildren(...song.parts.map((p, index) => new Option(p.name, index)));
    setBpm(song.bpm);
    selectPart(0);
    renderLibrary();
    persistSelection();
    document.querySelectorAll('main button, main input, main select').forEach(el => el.disabled = false);
    $('loop-toggle').disabled = mode === 'score';
    renderReadableScore();
    dataEditor.load(canonical);
    updateDataStatus(canonical);
  } catch (error) { toast(error.message, true); }
}
function selectPart(index) {
  stop();
  partIndex = index;
  scoreOffset = 0;
  const measures = part().measures;
  $('start-measure').value = measures[0].number;
  $('end-measure').value = measures.at(-1).number;
  for (const id of ['start-measure', 'end-measure']) { $(id).min = measures[0].number; $(id).max = measures.at(-1).number; }
  $('total-measures').textContent = `/ ${measures.length} 小節`;
  renderMeasures();
  showMeasure(measures[0]);
  renderPreview();
  renderReadableScore();
  updateRange();
}
function renderMeasures() {
  $('measure-list').replaceChildren();
  let section = null;
  for (const measure of part().measures) {
    if (measure.section && measure.section !== section) {
      section = measure.section;
      const heading = document.createElement('div');
      heading.className = 'section-label';
      heading.textContent = section;
      $('measure-list').append(heading);
    }
    const button = document.createElement('button');
    button.className = 'measure-cell';
    button.textContent = measure.number;
    button.dataset.number = measure.number;
    button.setAttribute('aria-label', `${measure.number}小節から練習`);
    button.addEventListener('click', () => {
      const playing = player.active;
      stop();
      $('start-measure').value = measure.number;
      if (Number($('end-measure').value) < measure.number) $('end-measure').value = measure.number;
      updateRange();
      showMeasure(measure);
      if (playing) startPlayback({ noCount: true });
    });
    $('measure-list').append(button);
  }
}
function showMeasure(measure, beat = -1, progress = 0) {
  const changed = currentNumber !== measure.number;
  currentNumber = measure.number;
  $('current-measure').textContent = String(measure.number).padStart(2, '0');
  $('current-section').textContent = measure.section || 'フリープラクティス';
  $('song-time').textContent = measure.timeSignature;
  $('measure-progress').style.width = `${progress * 100}%`;
  $('beat-dots').replaceChildren(...Array.from({ length: measure.meter.numerator }, (_, index) => {
    const dot = document.createElement('i');
    dot.className = index === beat ? 'active' : '';
    return dot;
  }));
  $('beat-dots').setAttribute('aria-label', beat < 0 ? `${measure.meter.numerator}拍` : `${beat + 1}拍目`);
  $('measure-list').querySelectorAll('button').forEach(button => {
    const current = Number(button.dataset.number) === currentNumber;
    button.classList.toggle('current', current);
    if (current) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
  });
  if (changed || !$('note-preview').childElementCount) {
    renderPreview();
    const index = part().measures.findIndex(m => m.number === currentNumber);
    scoreOffset = Math.floor(Math.max(0, index) / 4) * 4;
    renderReadableScore();
  }
  if (!player.active) updateRoutePosition(Math.max(0, routeSequence.findIndex(m => m.number === currentNumber)));
}
function renderReadableScore() {
  if (!song) return;
  const measures = part().measures;
  renderPracticeScore($('practice-score'), measures.slice(scoreOffset, scoreOffset + 4), currentNumber);
  $('score-page').textContent = `${Math.floor(scoreOffset / 4) + 1} / ${Math.ceil(measures.length / 4)}`;
  $('score-prev').disabled = scoreOffset === 0;
  $('score-next').disabled = scoreOffset + 4 >= measures.length;
}
function updateRoute() {
  if (!song) return;
  try {
    routeSequence = buildSequence(part(), { mode, start: Number($('start-measure').value), end: Number($('end-measure').value) });
    $('route-help').classList.remove('error');
    $('route-help').textContent = mode === 'score' ? '記号を含めた演奏順。色のついた矢印は反復・括弧・ジャンプによる移動です。' : '指定区間を順に進みます。ループONでは最後から先頭に戻ります。';
    routeWindow = -1;
    updateRoutePosition(Math.max(0, routeSequence.findIndex(m => m.number === currentNumber)));
  } catch (error) {
    routeSequence = [];
    routeWindow = -1;
    $('route-list').replaceChildren();
    $('route-summary').textContent = '';
    $('route-help').classList.add('error');
    $('route-help').textContent = error.message;
  }
}
function updateRoutePosition(index) {
  if (!routeSequence.length) return;
  routeIndex = Math.min(index, routeSequence.length - 1);
  const windowStart = Math.floor(routeIndex / 80) * 80;
  if (windowStart !== routeWindow) {
    routeWindow = windowStart;
    $('route-list').replaceChildren();
    if (windowStart) {
      const previous = document.createElement('span');
      previous.className = 'route-overflow';
      previous.textContent = '…';
      $('route-list').append(previous);
    }
    routeSequence.slice(windowStart, windowStart + 80).forEach((measure, offset) => {
      const at = windowStart + offset;
      if (offset) {
        const arrow = document.createElement('span');
        const previousIndex = part().measures.indexOf(routeSequence[at - 1]);
        const jumped = part().measures.indexOf(measure) !== previousIndex + 1;
        arrow.className = `route-arrow${jumped ? ' is-jump' : ''}`;
        arrow.textContent = '→';
        arrow.setAttribute('aria-hidden', 'true');
        $('route-list').append(arrow);
      }
      const item = document.createElement('span');
      item.className = 'route-step';
      item.dataset.index = at;
      item.textContent = measure.number;
      item.setAttribute('aria-label', `${at + 1}番目: ${measure.number}小節`);
      $('route-list').append(item);
    });
    if (windowStart + 80 < routeSequence.length) {
      const more = document.createElement('span');
      more.className = 'route-overflow';
      more.textContent = '…再生に合わせて続きを表示';
      $('route-list').append(more);
    }
  }
  $('route-summary').textContent = `${routeIndex + 1} / ${routeSequence.length} 小節目`;
  $('route-list').querySelectorAll('.route-step').forEach(item => {
    const current = Number(item.dataset.index) === routeIndex;
    item.classList.toggle('is-current', current);
    if (current) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
  });
}
function renderPreview() {
  const measures = part().measures;
  const index = measures.findIndex(m => m.number === currentNumber);
  const preview = measures.slice(Math.max(0, index), Math.max(0, index) + 4);
  $('preview-range').textContent = `${preview[0]?.number ?? ''}小節から`;
  $('note-preview').replaceChildren();
  for (const measure of preview) {
    const wrapper = document.createElement('div');
    wrapper.className = 'preview-measure';
    const number = document.createElement('div');
    number.className = 'preview-number';
    const marks = [];
    if (measure.repeat.start) marks.push('|:');
    if (measure.ending.length) marks.push(`${measure.ending.join(',')}.`);
    if (measure.navigation.segno) marks.push('𝄋');
    if (measure.navigation.coda) marks.push('𝄌');
    if (measure.navigation.toCoda) marks.push('To Coda');
    if (measure.navigation.jump) marks.push(`${measure.navigation.jump.type === 'DS' ? 'D.S.' : 'D.C.'} al ${measure.navigation.jump.al}`);
    if (measure.navigation.fine) marks.push('Fine');
    if (measure.repeat.end) marks.push(':|');
    number.textContent = `${String(measure.number).padStart(2, '0')}  ${marks.join(' ')}`;
    const bars = document.createElement('div');
    bars.className = 'preview-bars';
    let total = 0;
    for (const note of measure.notes) {
      total += note.duration;
      const bar = document.createElement('span');
      bar.className = `preview-note${note.rest ? ' rest' : ''}`;
      bar.dataset.player = note.player;
      bar.style.flex = `${note.duration} 1 0`;
      bar.textContent = note.rest ? '' : note.pitch;
      bar.title = `${note.rest ? '休符' : note.pitch} · ${note.duration}拍 · ${note.player}`;
      bars.append(bar);
    }
    if (total < measure.beats) {
      const silence = document.createElement('span');
      silence.className = 'preview-note missing';
      silence.textContent = 'データなし';
      silence.title = '未入力の時間です。休符とは扱いません。';
      silence.style.flex = `${measure.beats - total} 1 0`;
      bars.append(silence);
    }
    wrapper.append(number, bars);
    $('note-preview').append(wrapper);
  }
}
function updateRange() {
  const start = Number($('start-measure').value);
  const end = Number($('end-measure').value);
  $('loop-description').textContent = mode === 'score' ? '区間練習で利用できます' : `${start}〜${end}小節を繰り返す`;
  $('measure-list').querySelectorAll('button').forEach(button => button.classList.toggle('in-range', Number(button.dataset.number) >= start && Number(button.dataset.number) <= end));
  updateRoute();
}
function setBpm(value) {
  if (!Number.isFinite(Number(value))) return;
  const bpm = Math.max(30, Math.min(240, Number(value)));
  $('bpm').value = bpm;
  $('bpm-slider').value = bpm;
  player.setBpm(bpm);
}
function options(noCount = false) {
  return { bpm: Number($('bpm').value), target: target(), countIn: noCount ? 0 : Number($('count-in').value), metronome: $('metronome-toggle').checked, loop: mode === 'section' && $('loop-toggle').checked };
}
async function startPlayback({ noCount = false, current = false, previous = false } = {}) {
  if (!song) return;
  const request = ++playRequest;
  try {
    setBpm($('bpm').value);
    const sequence = buildSequence(part(), { mode, start: Number($('start-measure').value), end: Number($('end-measure').value) });
    const fromIndex = current || previous
      ? restartIndex(sequence, player.sequence, player.shownIndex, currentNumber, previous) : 0;
    $('play-button').disabled = true;
    routeSequence = sequence;
    routeWindow = -1;
    updateRoutePosition(fromIndex);
    await player.play(sequence, { ...options(noCount), fromIndex });
    if (request !== playRequest) return;
    await keepAwake();
  } catch (error) {
    if (request === playRequest) { player.stop(); toast(error.message, true); }
  }
}
function setMode(value) {
  stop();
  mode = value;
  for (const candidate of ['section', 'score']) {
    $(`mode-${candidate}`).classList.toggle('active', mode === candidate);
    $(`mode-${candidate}`).setAttribute('aria-pressed', String(mode === candidate));
  }
  $('loop-toggle').disabled = mode === 'score';
  $('loop-toggle').checked = false;
  player.loop = false;
  $('mode-description').textContent = mode === 'section' ? '反復やジャンプを使わず、指定した区間を練習します。' : '反復・D.C.・D.S.を演奏順に進みます。戻り先は開始小節より前になることがあります。';
  updateRange();
}

$('play-button').addEventListener('click', () => startPlayback());
$('practice-tab').addEventListener('click', () => setAppView('practice'));
$('editor-tab').addEventListener('click', () => setAppView('editor'));
$('stop-button').addEventListener('click', stop);
$('again-button').addEventListener('click', () => startPlayback({ noCount: true, current: $('restart-from').value === 'current' }));
$('previous-button').addEventListener('click', () => {
  if (player.active) startPlayback({ noCount: true, previous: true });
  else {
    const measures = part().measures;
    const index = measures.findIndex(m => m.number === currentNumber);
    const measure = measures[Math.max(0, index - 1)];
    if (measure.number < Number($('start-measure').value)) { $('start-measure').value = measure.number; updateRange(); }
    showMeasure(measure);
  }
});
$('part-select').addEventListener('change', event => selectPart(Number(event.target.value)));
$('bpm').addEventListener('change', event => setBpm(event.target.value));
$('bpm-slider').addEventListener('input', event => setBpm(event.target.value));
$('bpm-down').addEventListener('click', () => setBpm(Number($('bpm').value) - 1));
$('bpm-up').addEventListener('click', () => setBpm(Number($('bpm').value) + 1));
$('reset-bpm').addEventListener('click', () => setBpm(song.bpm));
function setRole(value) {
  role = value;
  player.target = target();
  $('role-toggle').querySelectorAll('button').forEach(item => { const active = item.dataset.role === role; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); });
  $('partner-hint').textContent = role === 'listen' ? 'アプリは両方を演奏' : `アプリは「${role === 'front' ? '後' : '前'}」を演奏`;
}
$('role-toggle').querySelectorAll('button').forEach(button => button.addEventListener('click', () => setRole(button.dataset.role)));
for (const id of ['start-measure', 'end-measure']) $(id).addEventListener('input', () => {
  stop();
  updateRange();
  const measure = part().measures.find(m => m.number === Number($('start-measure').value));
  if (measure) showMeasure(measure);
});
$('select-all').addEventListener('click', () => {
  stop();
  $('start-measure').value = part().measures[0].number;
  $('end-measure').value = part().measures.at(-1).number;
  updateRange();
  showMeasure(part().measures[0]);
});
$('loop-toggle').addEventListener('change', event => { player.loop = event.target.checked; });
$('metronome-toggle').addEventListener('change', event => { player.metronome = event.target.checked; });
$('mode-section').addEventListener('click', () => setMode('section'));
$('mode-score').addEventListener('click', () => setMode('score'));
$('import-button').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', async event => {
  if(!canReplaceDraft()){event.target.value='';return;}
  const files = [...event.target.files];
  event.target.value = '';
  let added = 0;
  let lastId;
  const failures = [];
  for (const file of files) {
    try {
      if (storageDamaged) throw new Error('保存データを読み込めなかったため、上書きを防いでいます。ブラウザーの保存設定をご確認ください。');
      if (file.size > 2 * 1024 * 1024) throw new Error('ファイルは2MB以下にしてください。');
      const text = await file.text();
      const songs=normalizeSongs(text);
      const entries=songs.map(data=>{const validation=validateSong(data);if(validation.errors.length)throw new Error(validation.errors.map(i=>i.message).join(' / '));parseSong(validation.song);return createEntry(validation.song);});
      const next=[...library,...entries];saveLibrary(next);library=next;lastId=entries.at(-1).id;added+=entries.length;
    } catch (error) { failures.push(`${file.name}: ${error.message}`); }
  }
  if (lastId) { selectSong(lastId, true); const imported = library.find(entry => entry.id === lastId); const warning = imported ? emptyMeasureSummary(imported.data) : ''; if (warning) { setAppView('editor'); toast(warning, true); } }
  if (failures.length) toast(`${added ? `${added}曲を保存しました。` : ''}${failures.join(' / ')}`, true);
  else if (added) toast(`${added}曲を端末に保存しました。`);
});
$('delete-song').addEventListener('click', () => {
  if (storageDamaged) { toast('保存データを読み込めなかったため、上書きを防いでいます。', true); return; }
  if (!song || !confirm(`「${song.title}」をこの端末の曲一覧から削除しますか？`)) return;
  try {
    const next = library.filter(entry => entry.id !== selectedId);
    saveLibrary(next);
    stop();
    dataEditor.dirty=false;
    library = next;
    if (library.length) selectSong(library[0].id);
    else {
      song = null; dataEditor.data=null;dataEditor.root.replaceChildren();setAppView('practice');
      selectedId = null;
      $('song-title').textContent = '練習する曲を追加しましょう';
      $('part-select').replaceChildren();
      $('song-key').textContent = '';
      $('song-time').textContent = '';
      $('current-measure').textContent = '—';
      $('total-measures').textContent = '';
      $('current-section').textContent = 'JSONから曲を追加できます';
      $('measure-list').replaceChildren();
      $('note-preview').replaceChildren();
      $('beat-dots').replaceChildren();
      $('practice-score').replaceChildren();
      $('route-list').replaceChildren();
      $('route-summary').textContent = '';
      $('score-page').textContent = '';
      $('demo-guide').hidden = true;
      document.querySelectorAll('main button:not(.mobile-help):not(#demo-button), main input, main select').forEach(el => el.disabled = true);
      $('practice-tab').disabled = false; $('editor-tab').disabled = true;
      renderLibrary();
    }
    toast('曲を削除しました。');
  } catch (error) { toast(error.message, true); }
});
$('help-button').addEventListener('click', () => $('help-dialog').showModal());
$('close-help').addEventListener('click', () => $('help-dialog').close());
$('score-prev').addEventListener('click', () => { scoreOffset = Math.max(0, scoreOffset - 4); renderReadableScore(); });
$('score-next').addEventListener('click', () => { scoreOffset = Math.min(Math.floor((part().measures.length - 1) / 4) * 4, scoreOffset + 4); renderReadableScore(); });
$('demo-button').addEventListener('click', () => { stop(); $('demo-dialog').showModal(); });
$('close-demo').addEventListener('click', () => $('demo-dialog').close());
$('close-demo-guide').addEventListener('click', () => $('demo-guide').hidden = true);
const demos = {
  dialogue: { file: 'andean-dialogue', mode: 'section', start: 1, end: 4, bpm: 80, count: 1, loop: false, guide: 'まず「両方聴く」で1〜4小節を確認。次に「前」を選ぶと後の音だけが鳴ります。簡易楽譜の「前」の音を口ずさんでみてください。' },
  navigation: { file: 'navigation-demo', mode: 'score', start: 1, end: 10, bpm: 160, count: 0, loop: false, guide: '「再生する」で道順を確認：1→2→3→1→2→4→5→6→7→5→6→9→10。最初の6小節は通過し、D.S.から戻った後だけ9小節のCodaへ進みます。' },
  range: { file: 'range-demo', mode: 'section', start: 55, end: 60, bpm: 80, count: 1, loop: true, guide: '55〜60小節をループします。「もう一度」「1小節戻る」も試せます。「全小節」を選ぶと、61小節から6/8拍子に変わる様子を確認できます。' }
};
let demoLoading = false;
document.querySelectorAll('[data-demo]').forEach(button => button.addEventListener('click', async () => {
  if (demoLoading) return;
  if (!canReplaceDraft()) return;
  demoLoading = true;
  const demo = demos[button.dataset.demo];
  try {
    if (storageDamaged) throw new Error('保存データを読み込めなかったため、上書きを防いでいます。');
    const response = await fetch(`./samples/${demo.file}.json`);
    if (!response.ok) throw new Error('デモを読み込めませんでした。オンラインで一度開き直してください。');
    const data = normalizeSong(await response.json());
    const parsed = parseSong(data);
    parsed.parts.forEach(p => buildSequence(p, { mode: 'score' }));
    let entry = library.find(item => item.id === `sample-${demo.file}` || JSON.stringify(item.data) === JSON.stringify(data));
    if (!entry) {
      entry = { id: `sample-${demo.file}`, data };
      const next = [...library, entry];
      saveLibrary(next);
      library = next;
    }
    selectSong(entry.id, true);
    setMode(demo.mode);
    setRole('listen');
    setBpm(demo.bpm);
    $('start-measure').value = demo.start;
    $('end-measure').value = demo.end;
    $('count-in').value = demo.count;
    $('loop-toggle').checked = demo.loop;
    $('metronome-toggle').checked = false;
    $('restart-from').value = 'start';
    updateRange();
    showMeasure(part().measures[0]);
    $('demo-guide-text').textContent = demo.guide;
    $('demo-guide').hidden = false;
    $('demo-dialog').close();
    toast('デモの準備ができました。「再生する」を押してください。');
  } catch (error) { toast(error.message, true); }
  finally { demoLoading = false; }
}));
const mobileHelp = document.createElement('button');
mobileHelp.className = 'text-button mobile-help';
mobileHelp.textContent = '使い方・JSONについて';
mobileHelp.addEventListener('click', () => $('help-dialog').showModal());
document.querySelector('footer').prepend(mobileHelp);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && player.active) { stop(); toast('画面が非表示になったため停止しました。'); }
});
window.addEventListener('pagehide', stop);
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); installPrompt = event; $('install-button').hidden = false;
});
$('install-button').addEventListener('click', async () => { await installPrompt?.prompt(); installPrompt = null; $('install-button').hidden = true; });

async function setupOffline() {
  const status = text => { $('offline-status').lastChild.textContent = text; };
  if (!('serviceWorker' in navigator)) { status('HTTPSでオフライン対応'); return; }
  try {
    const registration = await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
    status(navigator.onLine ? 'オフライン対応' : 'オフラインで利用中');
    const update = () => status(navigator.onLine ? 'オフライン対応' : 'オフラインで利用中');
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    if (registration.waiting) toast('更新があります。アプリを閉じて開き直すと適用されます。');
  } catch { status('オフライン保存できません'); }
}
async function init() {
  let stored = false;
  try {
    stored = localStorage.getItem('ayni.library.v1') !== null;
    const entries = loadLibrary();
    const migrated=entries.flatMap(entry=>{if(!entry?.id)throw new Error('曲一覧が不正です。');return normalizeSongs(entry.data).map((data,index)=>{parseSong(data);return {...entry,id:index ? entry.id+'-part-'+index : entry.id,data};});});
    if(entries.length && JSON.stringify(entries)!==JSON.stringify(migrated)) {
      if(!localStorage.getItem('ayni.library.before-format-1.0'))localStorage.setItem('ayni.library.before-format-1.0',JSON.stringify(entries));
      saveLibrary(migrated);
    }
    library=migrated;
  } catch { storageDamaged = true; toast('保存した曲を読み込めませんでした。既存の保存データは上書きせず、サンプルを表示します。', true); }
  if (!stored || storageDamaged) {
    try {
      const response = await fetch('./samples/andean-dialogue.json');
      if (!response.ok) throw new Error('サンプル曲を読み込めません。JSONを追加してください。');
      const data = normalizeSong(await response.json());
      parseSong(data);
      library = [{ id: 'sample-andean-dialogue', data }];
      if (!storageDamaged) saveLibrary(library);
    } catch (error) { toast(error.message, true); }
  }
  let last;
  try { last = localStorage.getItem('ayni.selection'); } catch {}
  if (library.length) selectSong(library.some(e => e.id === last) ? last : library[0].id);
  else {
    $('song-title').textContent = '練習する曲を追加しましょう';
    $('current-measure').textContent = '—';
    $('current-section').textContent = 'JSONから曲を追加できます';
    $('total-measures').textContent = '';
    document.querySelectorAll('main button:not(.mobile-help):not(#demo-button), main input, main select').forEach(el => el.disabled = true);
    $('practice-tab').disabled = false;
  }
  setupOffline();
}
init();
