// Contract between Electron main (Task 8) and the renderer (Task 9). Types only.
import type { State } from '@saakshi/core/protocol';

export type Lang = 'en' | 'hi';
/** The latest journaled state of one item; seq is the entry that set it (drives the tick). */
export interface ItemState { state: State; answer: string; seq: number }
/** local: journal head (✓). relay: highest seq the relay confirmed with our own h (✓✓). cell: highest seq with a verified cell ack (blue ✓✓). */
export interface SyncView { local: number; relay: number; cell: number; online: boolean; error: string }
export interface ExamBoot {
  cand: string; seatId: string; form: 'F1' | 'F2'; durationMs: number;
  activeMs: number; started: boolean; items: Record<string, ItemState>; sync: SyncView;
}
/** answer → A + option; mark → MR with '' or AMR + option; clear → NA with ''. */
export interface Action { kind: 'answer' | 'mark' | 'clear'; item: string; state: State; answer: string; dwellMs: number }
export type ActResult = { ok: true; seq: number; activeMs: number } | { ok: false; error: string };
export interface SeatApi {
  load(): Promise<ExamBoot>;
  start(): Promise<ActResult>;
  act(a: Action): Promise<ActResult>;
  onSync(cb: (v: SyncView) => void): () => void;
}
