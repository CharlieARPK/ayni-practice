export function shouldPlay(note, target) {
  return !note.rest && note.player !== 'unknown' && (note.player === 'both' || target === 'both' || note.player === target);
}

// Timbres receive an AudioContext and destination. Add new factories here later.
export const timbres = {
  soft: (context, destination, frequency, when, duration) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(0.17, when + Math.min(.012, duration / 4));
    gain.gain.setValueAtTime(0.14, when + duration * .65);
    gain.gain.exponentialRampToValueAtTime(.0001, when + duration);
    oscillator.connect(gain).connect(destination);
    oscillator.start(when);
    oscillator.stop(when + duration + .01);
    return { oscillator, gain };
  }
};

export class PlaybackEngine {
  constructor({ onPosition, onState, onError } = {}) {
    this.onPosition = onPosition ?? (() => {});
    this.onState = onState ?? (() => {});
    this.onError = onError ?? (() => {});
    this.active = false;
    this.nodes = new Set();
    this.generation = 0;
    this.bpm = 80;
    this.target = 'back';
    this.metronome = false;
    this.loop = false;
    this.timbre = 'soft';
    this.frame = null;
  }
  async prepare() {
    if (!this.context) {
      const Constructor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!Constructor) throw new Error('このブラウザーはWeb Audioに対応していません。Chromeで開いてください。');
      this.context = new Constructor();
      this.master = this.context.createGain();
      this.master.gain.value = .7;
      this.master.connect(this.context.destination);
      this.context.onstatechange = () => {
        if (this.active && this.context.state !== 'running') {
          this.stop();
          this.onError(new Error('音声が中断されました。画面を開いた状態で再生し直してください。'));
        }
      };
    }
    await this.context.resume();
    if (this.context.state !== 'running') throw new Error('音声を開始できません。再生ボタンをもう一度押してください。');
  }
  async play(sequence, { bpm = this.bpm, target = this.target, countIn = 0, metronome = false, loop = false, fromIndex = 0 } = {}) {
    this.stop(false);
    const generation = this.generation;
    await this.prepare();
    if (generation !== this.generation) return;
    if (!sequence.length) throw new Error('再生できる小節がありません。');
    this.sequence = sequence;
    this.bpm = bpm;
    this.target = target;
    this.metronome = metronome;
    this.loop = loop;
    this.sequenceIndex = fromIndex;
    this.shownIndex = fromIndex;
    this.queue = [];
    this.countRemaining = countIn;
    this.nextTime = this.context.currentTime + .06;
    this.events = [];
    this.eventIndex = 0;
    this.measureBeat = 0;
    this.measureEnd = 0;
    this.finishing = false;
    this.active = true;
    this.onState(countIn ? 'counting' : 'playing');
    this.newMeasure();
    this.timer = setInterval(() => this.tick(), 20);
    this.tick();
    const draw = () => {
      if (!this.active) return;
      const now = this.context.currentTime;
      while (this.queue.length && this.queue[0].time <= now) {
        const position = this.queue.shift();
        if (position.type === 'position') {
          this.shownIndex = position.index;
          this.lastPosition = position;
          this.onPosition(position);
        } else this.onState(position.state);
      }
      this.frame = requestAnimationFrame(draw);
    };
    this.frame = requestAnimationFrame(draw);
  }
  newMeasure() {
    const m = this.sequence[this.sequenceIndex];
    const counting = this.countRemaining > 0;
    const length = counting ? m.meter.beats : m.beats;
    const events = [];
    if (!counting) m.notes.forEach(note => events.push({ beat: note.offset, type: 'note', note }));
    const pulse = 4 / m.meter.denominator;
    for (let beat = 0, n = 0; beat < length - .00001; beat += pulse, n++) events.push({ beat, type: 'pulse', pulse: n, counting });
    events.push({ beat: length, type: 'end' });
    this.events = events.sort((a, b) => a.beat - b.beat);
    this.eventIndex = 0;
    this.measureBeat = 0;
    this.measureEnd = length;
    this.events[0].time = this.nextTime;
  }
  tick() {
    if (!this.active) return;
    const now = this.context.currentTime;
    if (this.finishing) {
      if (now >= this.nextTime) this.stop();
      return;
    }
    if (now - this.nextTime > .5) {
      this.stop();
      this.onError(new Error('端末の処理が中断されたため停止しました。再生し直してください。'));
      return;
    }
    let guard = 0;
    while (this.active && !this.finishing && this.nextTime < now + .1 && guard++ < 1000) {
      const event = this.events[this.eventIndex];
      const m = this.sequence[this.sequenceIndex];
      const time = this.nextTime;
      if (event.type === 'end') {
        if (this.countRemaining) {
          this.countRemaining--;
          if (!this.countRemaining) this.queue.push({ time, type: 'state', state: 'playing' });
        } else {
          this.sequenceIndex++;
          if (this.sequenceIndex >= this.sequence.length) {
            if (this.loop) this.sequenceIndex = 0;
            else { this.finishing = true; break; }
          }
        }
        this.newMeasure();
        continue;
      }
      if (event.type === 'note' && shouldPlay(event.note, this.target)) this.tone(440 * 2 ** ((event.note.midi - 69) / 12), time, Math.max(.015, event.note.duration * 60 / this.bpm * .9));
      if (event.type === 'pulse') {
        if (event.counting || this.metronome) this.click(time, event.pulse === 0);
        this.queue.push({ time, type: 'position', index: this.sequenceIndex, measure: m, beat: event.pulse, progress: event.beat / this.measureEnd, counting: event.counting, countRemaining: this.countRemaining });
      }
      this.measureBeat = event.beat;
      this.eventIndex++;
      const next = this.events[this.eventIndex];
      this.nextTime += (next.beat - event.beat) * 60 / this.bpm;
    }
  }
  track(node) {
    this.nodes.add(node);
    node.oscillator.onended = () => { node.oscillator.disconnect(); node.gain.disconnect(); this.nodes.delete(node); };
  }
  tone(frequency, time, duration) { this.track(timbres[this.timbre](this.context, this.master, frequency, time, duration)); }
  click(time, accent) {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.frequency.value = accent ? 1400 : 950;
    gain.gain.setValueAtTime(accent ? .22 : .13, time);
    gain.gain.exponentialRampToValueAtTime(.0001, time + .035);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(time);
    oscillator.stop(time + .04);
    this.track({ oscillator, gain });
  }
  setBpm(value) {
    const old = this.bpm;
    this.bpm = value;
    if (this.active && !this.finishing) {
      const now = this.context.currentTime;
      this.nextTime = now + Math.max(0, this.nextTime - now) * old / value;
    }
  }
  stop(notify = true) {
    this.generation++;
    this.active = false;
    clearInterval(this.timer);
    cancelAnimationFrame(this.frame);
    for (const node of this.nodes) { try { node.oscillator.stop(); } catch {} node.oscillator.disconnect(); node.gain.disconnect(); }
    this.nodes.clear();
    this.queue = [];
    if (notify) this.onState('stopped');
  }
}
