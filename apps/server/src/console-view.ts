import type { HeadsRes, NodeState, StreamView } from '@saakshi/core/wire';
import type { ReleaseMsg } from '@saakshi/core/paper';

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

export function paperStatus(releases: ReleaseMsg[]): { text: string; tone: 'locked' | 'released' } {
  if (!releases.length) return { text: 'Paper locked — waiting for T0 (or for the code phoned in by control if this centre is offline).', tone: 'locked' };
  const how = releases.some((r) => r.sig) ? 'released by control at T0' : 'unlocked here with the phoned code';
  const at = new Date(Math.max(...releases.map((r) => r.ts))).toISOString().slice(11, 19);
  return { text: `Paper ${how} (${releases.map((r) => r.form).join(', ')}) at ${at} UTC. Every seat checks the key against the published commitment.`, tone: 'released' };
}
