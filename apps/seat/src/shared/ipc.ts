// Contract between Electron main and the renderer. Types only.
import type { State } from '@saakshi/core/protocol';
export type { GateMethod } from '@saakshi/core/enrol';
import type { GateMethod } from '@saakshi/core/enrol';
import type { CentreStatus } from '@saakshi/core/ops';
import type { IntegrityFinding, ProvSummary, Verdict } from '@saakshi/core/integrity';

export type Lang = 'en' | 'hi' | 'ta';
/** The latest journaled state of one item; seq is the entry that set it (drives the tick). */
export interface ItemState { state: State; answer: string; seq: number }
/** local ✓ / relay ✓✓ / cell blue ✓✓. provisional: the cell has not ratified this seat's binding, so nothing leaves the seat. */
export interface SyncView {
  local: number; relay: number; cell: number; online: boolean; error: string; provisional?: boolean;
  /** Stage 4: this seat was replaced by another (its entries are ORPHANED); it stops sending. */
  moved?: boolean;
}
/** Computed on the seat at submit from its own journal (protocol Addendum A.5). */
export interface Receipt {
  exam: string; shift: string; cand: string; form: string; code: string;
  seq: number; h: string; finalHash: string; attempted: number; answered: number; marked: number; total: number;
}
/** connecting: no verified package yet · enrol: no seat key · locked: waiting for T0 · ready: unlocked, not started ·
 *  moving: a move to this seat awaits approval · moved: this seat was replaced by another (its entries are ORPHANED). */
export type Phase = 'connecting' | 'enrol' | 'moving' | 'locked' | 'ready' | 'exam' | 'submitted' | 'moved';
export type BindState = 'none' | 'provisional' | 'bound' | 'refused' | 'moving';
/** Time credited for a move (Addendum C.5), and who approved it ('' = pending control's approval). */
export interface Credit { ms: number; via: 'pin' | 'key'; approvedBy: string; fromSeq: number }
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
  // Stage 4 (optional)
  /** Check-in was refused because the candidate is bound elsewhere: offer "move here". */
  moveable?: boolean;
  credited?: Credit;
  /** The relay's view of the link and the exam server (the banner). */
  status?: CentreStatus;
  /** The OS suspended or locked the screen; the timer is paused. */
  paused?: boolean;
  /** 16 hex of this seat's key, shown while a move waits so the invigilator can compare it with the console. */
  moveKey?: string;
  // Stage 5 (optional)
  gate?: GateView;
  /** Faces expected in frame (the signed accommodation; 1 by default, 2 for a scribe seat). */
  faces?: number;
}
export interface EnrolInput { pin: string; operatorId: string; method: GateMethod }
export type EnrolResult = { ok: true; bind: BindState } | { ok: false; error: string };
/** answer → A + option; mark → MR with '' or AMR + option; clear → NA with '' (also a first visit, Addendum A.6). */
export interface Action { kind: 'answer' | 'mark' | 'clear'; item: string; state: State; answer: string; dwellMs: number; /** Stage 5 (Addendum D.5) */ prov?: ProvSummary }
export type ActResult = { ok: true; seq: number; activeMs: number } | { ok: false; error: string };
export type SubmitResult = { ok: true; receipt: Receipt } | { ok: false; error: string };
export interface SeatApi {
  load(): Promise<ExamBoot>;
  enrol(e: EnrolInput): Promise<EnrolResult>;
  paper(): Promise<Paper | null>;
  start(): Promise<ActResult>;
  act(a: Action): Promise<ActResult>;
  submit(): Promise<SubmitResult>;
  /** Stage 4: move the candidate to this seat with their PIN (Addendum C.3). */
  handover(pin: string): Promise<EnrolResult>;
  /** Stage 5: run the integrity gate again (after the candidate closes a blocked tool). */
  recheck(): Promise<GateView>;
  faceSample(s: FaceSample): void;
  /** The exam window lost focus for this long (ms). */
  blur(ms: number): void;
  onSync(cb: (v: SyncView) => void): () => void;
  onBoot(cb: (b: ExamBoot) => void): () => void;
}
/** Stage 5: the integrity gate's latest verdict on this seat (Addendum D). checkedAt 0 = not yet checked. */
export interface GateView { verdict: Verdict; findings: IntegrityFinding[]; checkedAt: number }
/** One face-count sample from the renderer (2 per second). thumb: base64 160×120 JPEG, sent only when faces !== expected. */
export interface FaceSample { faces: number; at: number; thumb?: string }
