import type { ProvSummary } from '@saakshi/core/integrity';

/** Pure accumulator for one question's pointer/keyboard activity (Addendum D.5). Reset per visit. */
export interface ProvState { moves: number; pathPx: number; clicks: number; keys: number; untrusted: number; lastX?: number; lastY?: number; lastMoveAt: number }

export const emptyProv = (): ProvState => ({ moves: 0, pathPx: 0, clicks: 0, keys: 0, untrusted: 0, lastMoveAt: 0 });

export function provMove(s: ProvState, x: number, y: number, at: number, trusted: boolean): ProvState {
  const dx = s.lastX === undefined ? 0 : x - s.lastX;
  const dy = s.lastY === undefined ? 0 : y - s.lastY;
  return { ...s, moves: s.moves + 1, pathPx: s.pathPx + Math.round(Math.hypot(dx, dy)), lastX: x, lastY: y, lastMoveAt: at, untrusted: s.untrusted + (trusted ? 0 : 1) };
}
export const provClick = (s: ProvState, trusted: boolean): ProvState => ({ ...s, clicks: s.clicks + 1, untrusted: s.untrusted + (trusted ? 0 : 1) });
export const provKey = (s: ProvState, trusted: boolean): ProvState => ({ ...s, keys: s.keys + 1, untrusted: s.untrusted + (trusted ? 0 : 1) });

/** lastMoveMs: time since the last pointer move, or -1 if the pointer never moved for this question. */
export function provSummary(s: ProvState, now: number): ProvSummary {
  return { moves: s.moves, pathPx: s.pathPx, clicks: s.clicks, keys: s.keys, untrusted: s.untrusted, lastMoveMs: s.moves === 0 ? -1 : Math.max(0, now - s.lastMoveAt) };
}
