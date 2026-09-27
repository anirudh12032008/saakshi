// The review queue (plan §3.5, §3.11): face flags from the relay, opened with control's review key; a human clears or confirms each.
// One thumbnail per flag, deleted after retentionMs (30 days); the record of the flag and the decision stays. No recognition, no video.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openThumb, type SignedFace } from '@saakshi/core/integrity';

export interface ReviewItem {
  id: string; cand: string; seatId: string; code: 'face-none' | 'face-extra'; at: number; faces: number; expected: number;
  thumb: string; decision?: 'cleared' | 'confirmed'; by?: string; decidedAt?: number;
}
type Row = { t: 'flag'; item: Omit<ReviewItem, 'thumb' | 'decision' | 'by' | 'decidedAt'> } | { t: 'decide'; id: string; decision: 'cleared' | 'confirmed'; by: string; at: number };

export class ReviewQueue {
  #o: { dir: string; reviewPriv: Uint8Array; retentionMs: number; now: () => number };
  #items = new Map<string, ReviewItem>();
  #log: string;
  constructor(o: { dir: string; reviewPriv: Uint8Array; retentionMs: number; now?: () => number }) {
    this.#o = { ...o, now: o.now ?? Date.now };
    mkdirSync(join(o.dir, 'thumbs'), { recursive: true });
    this.#log = join(o.dir, 'review.jsonl');
    if (existsSync(this.#log)) for (const l of readFileSync(this.#log, 'utf8').split('\n').filter(Boolean)) this.#apply(JSON.parse(l) as Row);
  }
  #thumbPath = (id: string) => join(this.#o.dir, 'thumbs', `${id}.jpg`);
  #apply(r: Row): void {
    if (r.t === 'flag') this.#items.set(r.item.id, { ...r.item, thumb: '' });
    else { const i = this.#items.get(r.id); if (i) Object.assign(i, { decision: r.decision, by: r.by, decidedAt: r.at }); }
  }
  #write(r: Row): void { appendFileSync(this.#log, JSON.stringify(r) + '\n'); this.#apply(r); }

  add(s: SignedFace & { id: number }): void {
    const id = String(s.id);
    if (this.#items.has(id)) return;
    const f = s.f;
    if (f.thumb && this.#o.now() - f.at < this.#o.retentionMs) {
      try { writeFileSync(this.#thumbPath(id), openThumb(this.#o.reviewPriv, f, f.at, f.thumb)); } catch { /* not sealed to this key: keep the record, no image */ }
    }
    this.#write({ t: 'flag', item: { id, cand: f.cand, seatId: f.seatId, code: f.code, at: f.at, faces: f.faces, expected: f.expected } });
  }

  items(): ReviewItem[] {
    const now = this.#o.now();
    return [...this.#items.values()].map((i) => {
      const p = this.#thumbPath(i.id);
      if (now - i.at >= this.#o.retentionMs) { rmSync(p, { force: true }); return { ...i, thumb: '' }; }
      return { ...i, thumb: existsSync(p) ? `data:image/jpeg;base64,${readFileSync(p).toString('base64')}` : '' };
    }).sort((a, b) => Number(!!a.decision) - Number(!!b.decision) || b.at - a.at);
  }

  decide(id: string, decision: 'cleared' | 'confirmed', by: string): ReviewItem {
    const i = this.#items.get(id);
    if (!i) throw new Error('no such item');
    if (i.decision) throw new Error('already decided');
    this.#write({ t: 'decide', id, decision, by, at: this.#o.now() });
    return this.items().find((x) => x.id === id)!;
  }
}
