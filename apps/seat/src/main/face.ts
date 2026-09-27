// Face presence flags (plan §3.5), pure: no face for noFaceMs or more; more faces than expected in `over` of the last `window` samples.
// One flag per episode, carrying the latest off-expected frame of that episode. No recognition, no video.
import type { FaceSample } from '../shared/ipc.ts';

export interface FaceDraft { code: 'face-none' | 'face-extra'; at: number; faces: number; expected: number; thumb?: string }

export class FaceMonitor {
  #o: { expected: number; noFaceMs: number; window: number; over: number };
  #noneSince?: number; #noneFlagged = false; #noneThumb?: string;
  #recent: number[] = []; #extraFlagged = false; #extraThumb?: string;
  constructor(o: { expected: number; noFaceMs: number; window: number; over: number }) { this.#o = o; }

  sample(s: FaceSample): FaceDraft | undefined {
    const { expected, noFaceMs, window, over } = this.#o;
    if (s.faces === 0) {
      this.#noneSince ??= s.at;
      if (s.thumb) this.#noneThumb = s.thumb;
    } else { this.#noneSince = undefined; this.#noneFlagged = false; this.#noneThumb = undefined; }
    this.#recent.push(s.faces);
    if (this.#recent.length > window) this.#recent.shift();
    const extra = this.#recent.filter((n) => n > expected).length;
    if (s.faces > expected && s.thumb) this.#extraThumb = s.thumb;
    if (extra < over) { this.#extraFlagged = false; if (extra === 0) this.#extraThumb = undefined; }

    if (this.#noneSince !== undefined && !this.#noneFlagged && s.at - this.#noneSince >= noFaceMs) {
      this.#noneFlagged = true;
      return { code: 'face-none', at: s.at, faces: 0, expected, thumb: this.#noneThumb };
    }
    if (extra >= over && !this.#extraFlagged) {
      this.#extraFlagged = true;
      return { code: 'face-extra', at: s.at, faces: Math.max(...this.#recent), expected, thumb: this.#extraThumb };
    }
    return undefined;
  }
}
