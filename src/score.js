// A compact practice score. Pitch names and durations remain explicit so this
// view is useful without a music font or a full engraving library.
const names = { C: 'ド', D: 'レ', E: 'ミ', F: 'ファ', G: 'ソ', A: 'ラ', B: 'シ' };
export const playerNames = { front: '前', back: '後', both: '両方', unknown: '不明' };
export function noteName(note) {
  if (note.rest) return '休み';
  return note.pitch.replace(/^([A-G])([#b]?)/, (_, letter, accidental) => names[letter] + (accidental === '#' ? '♯' : accidental === 'b' ? '♭' : ''));
}
export function measureMarks(measure) {
  const marks = [];
  if (measure.repeat.start) marks.push('反復開始');
  if (measure.ending.length) marks.push(`${measure.ending.join('・')}番括弧`);
  for (const [key, label] of [['segno', 'Segno'], ['coda', 'Coda'], ['toCoda', 'To Coda']]) if (measure.navigation[key]) marks.push(label);
  if (measure.navigation.jump) marks.push(`${measure.navigation.jump.type === 'DS' ? 'D.S.' : 'D.C.'} al ${measure.navigation.jump.al}`);
  if (measure.navigation.fine) marks.push('Fine');
  if (measure.repeat.end) marks.push(`反復終了 ×${measure.repeat.times}`);
  return marks;
}
export function renderPracticeScore(container, measures, currentNumber) {
  container.replaceChildren();
  for (const measure of measures) {
    const card = document.createElement('section');
    card.className = 'practice-score-measure';
    if (measure.number === currentNumber) card.classList.add('is-current');
    const heading = document.createElement('div');
    heading.className = 'practice-score-heading';
    const title = document.createElement('strong');
    title.textContent = `${measure.number} 小節`;
    const meter = document.createElement('span');
    meter.textContent = measure.timeSignature;
    heading.append(title, meter);
    const marks = document.createElement('p');
    marks.className = 'score-marks';
    marks.textContent = measureMarks(measure).join(' · ') || measure.section;
    const notes = document.createElement('div');
    notes.className = 'practice-score-notes';
    const events = [...measure.notes];
    const used = events.reduce((sum, n) => sum + n.duration, 0);
    if (used < measure.beats - .000001) { const missing = document.createElement('p'); missing.textContent = '音符データなし（休符ではありません）'; notes.append(missing); }
    for (const note of events) {
      const cell = document.createElement('div');
      cell.className = `score-note ${note.rest ? 'rest' : note.player}`;
      const name = document.createElement('strong');
      name.textContent = noteName(note);
      const detail = document.createElement('span');
      detail.textContent = note.rest ? '休符' : `${note.pitch} · ${playerNames[note.player]}`;
      const duration = document.createElement('small');
      duration.textContent = `${Number(note.duration.toFixed(4))} 拍`;
      cell.append(name, detail, duration);
      notes.append(cell);
    }
    card.append(heading, marks, notes);
    container.append(card);
  }
}
