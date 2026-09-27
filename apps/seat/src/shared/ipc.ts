// Contract between Electron main and the renderer. Types only.
import type { State } from '@saakshi/core/protocol';
export type { GateMethod } from '@saakshi/core/enrol';
import type { GateMethod } from '@saakshi/core/enrol';

export type Lang = 'en' | 'hi';
/** The latest journaled state of one item; seq is the entry that set it (drives the tick). */
export interface ItemState { state: State; answer: string; seq: number }
/** local ✓ / relay ✓✓ / cell blue ✓✓. provisional: the cell has not ratified this seat's binding, so nothing leaves the seat. */
export interface SyncView { local: number; relay: number; cell: number; online: boolean; error: string; provisional?: boolean }
/** Computed on the seat at submit from its own journal (protocol Addendum A.5). */
export interface Receipt {
  exam: string; shift: string; cand: string; form: string; code: string;
  seq: number; h: string; finalHash: string; attempted: number; answered: number; marked: number; total: number;
}
/** connecting: no verified package yet · enrol: no seat key · locked: waiting for T0 · ready: unlocked, not started. */
export type Phase = 'connecting' | 'enrol' | 'locked' | 'ready' | 'exam' | 'submitted';
export type BindState = 'none' | 'provisional' | 'bound' | 'refused';
export interface PaperItem { id: string; subject: string; en: { q: string; o: string[] }; hi: { q: string; o: string[] } }
/** The decrypted paper for this seat's form, in form order. It exists only after a key that matches kc_f. */
export interface Paper { exam: string; form: string; items: PaperItem[] }
export interface ExamBoot {
  cand: string; seatId: string; form: 'F1' | 'F2'; durationMs: number;
  activeMs: number; started: boolean; items: Record<string, ItemState>; sync: SyncView;
  receipt?: Receipt;
  /** false with --no-camera, SAAKSHI_NO_CAMERA=1 or test mode. */
  camera: boolean;
  // Stage 3 (optional so the Stage 2 main keeps compiling until Task 14)
  phase?: Phase; centre?: string; bind?: BindState;
  /** The last problem to show (package, enrolment, a rejected key); '' if none. */
  notice?: string;
  /** kc_f of this seat's form, from the signed manifest (shown while locked). */
  commitment?: string;
  release?: { via: 'push' | 'code' };
  /** DEV test keystore: the renderer shows a permanent banner. */
  testMode?: boolean;
}
export interface EnrolInput { pin: string; operatorId: string; method: GateMethod }
export type EnrolResult = { ok: true; bind: BindState } | { ok: false; error: string };
/** answer → A + option; mark → MR with '' or AMR + option; clear → NA with '' (also a first visit, Addendum A.6). */
export interface Action { kind: 'answer' | 'mark' | 'clear'; item: string; state: State; answer: string; dwellMs: number }
export type ActResult = { ok: true; seq: number; activeMs: number } | { ok: false; error: string };
export type SubmitResult = { ok: true; receipt: Receipt } | { ok: false; error: string };
export interface SeatApi {
  load(): Promise<ExamBoot>;
  enrol(e: EnrolInput): Promise<EnrolResult>;
  paper(): Promise<Paper | null>;
  start(): Promise<ActResult>;
  act(a: Action): Promise<ActResult>;
  submit(): Promise<SubmitResult>;
  onSync(cb: (v: SyncView) => void): () => void;
  onBoot(cb: (b: ExamBoot) => void): () => void;
}
