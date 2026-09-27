import type { HeadsRes, NodeState, StreamView } from '@saakshi/core/wire';

export type Tone = 'ok' | 'lag' | 'silent';
export interface Tile { key: string; cand: string; tone: Tone; text: string; aria: string }
export const SILENT_MS = 30_000;

const keyOf = (v: StreamView): string => JSON.stringify([v.exam, v.shift, v.attempt, v.cand]);

export function tile(v: StreamView, now: number): Tile {
  const seat = v.senderHead < 0 ? '?' : String(v.senderHead);
  const cell = v.cellHead < 0 ? '?' : String(v.cellHead);
  const tone: Tone = v.seenAt === 0 || now - v.seenAt > SILENT_MS ? 'silent' : v.senderHead > v.head || v.cellHead < v.head ? 'lag' : 'ok';
  const text = `seat ${seat} · relay ${v.head} · cell ${cell}`;
  const word = tone === 'ok' ? 'in sync' : tone === 'lag' ? 'syncing' : v.seenAt ? `silent ${Math.round((now - v.seenAt) / 1000)} s` : 'never seen';
  return { key: keyOf(v), cand: v.cand, tone, text, aria: `${v.cand}: ${word}; ${text}` };
}

export function applyEvent(views: Map<string, StreamView>, event: string, data: unknown): { mode?: string; state?: NodeState } {
  if (event === 'snapshot') {
    const d = data as HeadsRes;
    views.clear();
    for (const s of d.streams) views.set(keyOf(s), s);
    return { mode: d.mode, state: d.state };
  }
  if (event === 'stream') { const s = data as StreamView; views.set(keyOf(s), s); return {}; }
  if (event === 'state') return { state: (data as { state: NodeState }).state };
  return {};
}
