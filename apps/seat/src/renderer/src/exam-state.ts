import type { State } from '@saakshi/core/protocol';
import type { Action, ItemState, SyncView } from '../../shared/ipc.ts';

export type Tick = 'none' | 'local' | 'relay' | 'cell';
export const GLYPH: Record<Tick, string> = { none: '', local: '✓', relay: '✓✓', cell: '✓✓' };
export const PALETTE_STATES: readonly State[] = ['NV', 'NA', 'A', 'MR', 'AMR'];

export const tickOf = (seq: number, v: SyncView): Tick => (seq <= 0 ? 'none' : seq <= v.cell ? 'cell' : seq <= v.relay ? 'relay' : 'local');

/** Saved (journaled) state wins; otherwise red once visited. Visits are navigation, which is not journaled. */
export const displayState = (items: Record<string, ItemState>, visited: ReadonlySet<string>, item: string): State =>
  items[item]?.state ?? (visited.has(item) ? 'NA' : 'NV');

export function saveAndNext(item: string, selected: string, cur: ItemState | undefined, dwellMs: number): Action | null {
  if (!selected || (cur?.state === 'A' && cur.answer === selected)) return null;
  return { kind: 'answer', item, state: 'A', answer: selected, dwellMs };
}

export function markAndNext(item: string, selected: string, cur: ItemState | undefined, dwellMs: number): Action | null {
  const state: State = selected ? 'AMR' : 'MR';
  if (cur?.state === state && cur.answer === selected) return null;
  return { kind: 'mark', item, state, answer: selected, dwellMs };
}

export function clearResponse(item: string, cur: ItemState | undefined, dwellMs: number): Action | null {
  return cur?.answer ? { kind: 'clear', item, state: 'NA', answer: '', dwellMs } : null;
}

export function legendCounts(order: readonly string[], items: Record<string, ItemState>, visited: ReadonlySet<string>): Record<State, number> {
  const c: Record<State, number> = { NV: 0, NA: 0, A: 0, MR: 0, AMR: 0 };
  for (const id of order) c[displayState(items, visited, id)]++;
  return c;
}

export function fmtRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}
