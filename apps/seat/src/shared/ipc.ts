// Contract between Electron main (Task 4) and the renderer (Task 5). Types only.
import type { State } from '@saakshi/core/protocol';

export type Lang = 'en' | 'hi';
/** The latest journaled state of one item; seq is the entry that set it (drives the tick). */
export interface ItemState { state: State; answer: string; seq: number }
/** local: journal head (✓). relay: highest seq the relay confirmed with our own h (✓✓). cell: highest seq with a verified cell ack (blue ✓✓). */
export interface SyncView { local: number; relay: number; cell: number; online: boolean; error: string }
/** Computed on the seat at submit from its own journal (protocol Addendum A.5). code = receipt code; total = items on the form. */
export interface Receipt {
  exam: string; shift: string; cand: string; form: string; code: string;
  seq: number; h: string; finalHash: string; attempted: number; answered: number; marked: number; total: number;
}
export interface ExamBoot {
  cand: string; seatId: string; form: 'F1' | 'F2'; durationMs: number;
  activeMs: number; started: boolean; items: Record<string, ItemState>; sync: SyncView;
  /** Present once the exam is submitted, so a relaunch shows the slip again. */
  receipt?: Receipt;
  /** false with SAAKSHI_NO_CAMERA=1 or --no-camera: no getUserMedia, no MediaPipe, chip says "Camera off (test mode)". */
  camera: boolean;
}
/** answer → A + option; mark → MR with '' or AMR + option; clear → NA with '' (also a first visit, Addendum A.6). */
export interface Action { kind: 'answer' | 'mark' | 'clear'; item: string; state: State; answer: string; dwellMs: number }
export type ActResult = { ok: true; seq: number; activeMs: number } | { ok: false; error: string };
export type SubmitResult = { ok: true; receipt: Receipt } | { ok: false; error: string };
export interface SeatApi {
  load(): Promise<ExamBoot>;
  start(): Promise<ActResult>;
  act(a: Action): Promise<ActResult>;
  submit(): Promise<SubmitResult>;
  onSync(cb: (v: SyncView) => void): () => void;
}
