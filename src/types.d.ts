export type Role = 'front' | 'back' | 'both' | 'unknown';
export interface TimeSignature { numerator: number; denominator: 1 | 2 | 4 | 8 | 16 | 32 }
export interface NoteEvent { type: 'note'; pitch: string; duration: number; role: Role; needsReview: boolean }
export interface RestEvent { type: 'rest'; duration: number; needsReview: boolean }
export interface Measure { number: number; timeSignature: TimeSignature | null; beats?: number; section?: string | null; events: Array<NoteEvent | RestEvent>; needsReview: boolean }
export type NavigationEvent =
  | { type: 'segno' | 'coda'; measure: number; id?: string; needsReview?: boolean }
  | { type: 'toCoda'; measure: number; target?: string; needsReview?: boolean }
  | { type: 'dalSegno' | 'daCapo'; measure: number; target?: string; mode?: 'alCoda' | 'alFine' | 'end'; needsReview?: boolean }
  | { type: 'fine'; measure: number; needsReview?: boolean }
  | { type: 'repeat'; startMeasure: number; endMeasure: number; times?: number; needsReview?: boolean }
  | { type: 'ending'; number: number; startMeasure: number; endMeasure: number; needsReview?: boolean };
export interface SongData {
  formatVersion: '1.0'; title: string; bpm: number;
  part: { id: string; name: string; instrument: string };
  key: string; defaultTimeSignature: TimeSignature;
  markers: Array<{ measure: number; label: string; id?: string }>; navigation: NavigationEvent[]; measures: Measure[];
}
