// Resolve score order before scheduling audio; bounded state prevents runaway navigation.
// Keep the occurrence within a repeat only when the actual runtime measures
// still match. An editor audition or a saved edit creates different measures.
export function restartIndex(sequence, previousSequence, shownIndex, currentNumber, previous = false) {
  const sameSequence = previousSequence?.length === sequence.length &&
    sequence.every((measure, index) => measure === previousSequence[index]);
  const index = sameSequence && sequence[shownIndex]?.number === currentNumber
    ? shownIndex : sequence.findIndex(measure => measure.number === currentNumber);
  return Math.max(0, index - (previous ? 1 : 0));
}

export function buildSequence(part, { mode = 'section', start = part.measures[0].number, end = part.measures.at(-1).number } = {}) {
  const measures = part.measures;
  const startIndex = measures.findIndex(m => m.number === start);
  const endIndex = measures.findIndex(m => m.number === end);
  if (startIndex < 0 || endIndex < 0 || startIndex > endIndex) throw new Error('開始・終了小節は曲に存在する番号で、開始 ≤ 終了にしてください。');
  if (mode === 'section') return measures.slice(startIndex, endIndex + 1);
  const segnos = new Map();
  const codas = new Map();
  const pairs = new Map();
  const starts = [];
  measures.forEach((measure, index) => {
    for (const [key, map] of [['segno', segnos], ['coda', codas]]) {
      const id = measure.navigation[key];
      if (id) {
        if (map.has(id)) throw new Error(`${key}「${id}」が重複しています。記号に別々の名前を指定してください。`);
        map.set(id, index);
      }
    }
    if (measure.repeat.start) starts.push(index);
    if (measure.repeat.end) pairs.set(index, starts.pop() ?? 0);
  });
  if (starts.length) throw new Error('反復開始に対応する反復終了がありません。');
  // Associate every volta measure with its own repeat, including second endings
  // that sit outside that repeat but inside an enclosing repeat.
  const repeatAt = measures.map((_, at) => [...pairs.entries()]
    .filter(([endAt, startAt]) => startAt <= at && at <= endAt)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0]);
  const endingOwner = new Map();
  measures.forEach((m, at) => {
    if (!m.ending.length) return;
    const previousOwner = endingOwner.get(at - 1);
    const followsEnding = previousOwner !== undefined && previousOwner < at && !m.ending.includes(1);
    endingOwner.set(at, followsEnding ? previousOwner : repeatAt[at]);
  });
  for (const m of measures) {
    const nav = m.navigation;
    if (nav.jump?.type === 'DS' && !segnos.has(nav.jump.target)) throw new Error(`D.S.の移動先Segno「${nav.jump.target}」がありません。`);
    if (nav.toCoda && !codas.has(nav.toCoda)) throw new Error(`To Codaの移動先Coda「${nav.toCoda}」がありません。`);
    if (nav.jump?.al === 'coda' && !measures.some(v => v.navigation.toCoda)) throw new Error('al Codaに対応するTo Codaがありません。');
    if (nav.jump?.al === 'fine' && !measures.some(v => v.navigation.fine)) throw new Error('al Fineに対応するFineがありません。');
  }
  const repeats = new Map();
  let index = startIndex;
  let lastPass = 1;
  let jumped = false;
  let codaTaken = false;
  let jumpAl = null;
  const sequence = [];
  const hasJump = measures.some(m => m.navigation.jump);
  for (let steps = 0; steps < 50000; steps++) {
    if (index < 0 || index >= measures.length || index > endIndex) return sequence;
    const measure = measures[index];
    // A repeat after a D.C./D.S. is intentionally skipped (common score convention).
    const owner = measure.ending.length ? endingOwner.get(index) : repeatAt[index];
    const pass = owner !== undefined ? (repeats.get(owner) ?? 1) : lastPass;
    const endingPass = jumped ? (owner !== undefined ? measures[owner].repeat.times : 2) : pass;
    const play = !measure.ending.length || measure.ending.includes(endingPass);
    if (play) {
      sequence.push(measure);
      const nav = measure.navigation;
      if (nav.fine && (jumpAl === 'fine' || !hasJump)) return sequence;
      if (nav.toCoda && jumped && jumpAl === 'coda' && !codaTaken) {
        index = codas.get(nav.toCoda);
        codaTaken = true;
        continue;
      }
      if (nav.jump && !jumped) {
        jumped = true;
        jumpAl = nav.jump.al;
        repeats.clear();
        index = nav.jump.type === 'DC' ? 0 : segnos.get(nav.jump.target);
        continue;
      }
    }
    // Process repeat end even when a first ending was skipped on the final pass.
    if (measure.repeat.end && !jumped) {
      const currentPass = repeats.get(index) ?? 1;
      if (currentPass < measure.repeat.times) {
        repeats.set(index, currentPass + 1);
        const repeatStart = pairs.get(index);
        for (const [innerEnd, innerStart] of pairs) if (innerStart >= repeatStart && innerEnd < index) repeats.delete(innerEnd);
        index = repeatStart;
        continue;
      }
      lastPass = currentPass;
    }
    // Reset the volta pass when entering a new, independent repeat.
    const next = index + 1;
    if (measures[next]?.repeat.start && !measure.repeat.end) lastPass = 1;
    index = next;
  }
  throw new Error('演奏順が50,000小節を超えました。反復・ジャンプ記号を確認してください。');
}
