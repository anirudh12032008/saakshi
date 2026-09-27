// Stage 4 (plan §3.6, §3.7, §3.10): operating parameters and the shapes that cross between cells, relays, control, the control page,
// the public status page and the seat. Types and constants only; browser-safe.
import type { TileTone } from './directory.ts';
import type { NodeState } from './wire.ts';

export type Severity = 'P0' | 'P1' | 'P2' | 'P3';
export const RUNGS = ['invigilator', 'superintendent', 'control', 'regulator'] as const;
export type Rung = (typeof RUNGS)[number];

export interface Ops {
  demo: boolean;
  /** Credited gaps at most this (plan §3.6: 30 min); beyond it, re-test eligible. */
  gapCapMs: number;
  /** Hard stop slack after D_i + gap cap. */
  slackMs: number;
  /** Unexplained wall time the time audit tolerates (idle cadence + LAN latency). */
  gapTolMs: number;
  /** SEAT_SILENT after this (plan §3.10: 30 s). */
  silentMs: number;
  /** A state incident closes only after its condition has been clear this long (debounce). */
  clearMs: number;
  /** KEY_RELEASE_DELAY: centres still locked this long after the release. */
  releaseDelayMs: number;
  /** A rebuilding cell goes LIVE this long after the last replay, even if a relay never replays. */
  rebuildGraceMs: number;
  /** Ack timer per rung; 0 = never escalates. */
  ladderMs: Record<Severity, number>;
  /** Wrong handover PINs before the candidate is locked. */
  pinTries: number;
  /** Integrity codes (meta[0] of an `integrity` entry) that are INTEGRITY_CRITICAL. Stage 5 emits them. */
  criticalIntegrity: string[];
}
export const OPS: Ops = {
  demo: false, gapCapMs: 30 * 60_000, slackMs: 10 * 60_000, gapTolMs: 120_000, silentMs: 30_000, clearMs: 30_000,
  releaseDelayMs: 5 * 60_000, rebuildGraceMs: 60_000, ladderMs: { P0: 120_000, P1: 300_000, P2: 900_000, P3: 0 }, pinTries: 3,
  criticalIntegrity: ['remote-session', 'capture-excluded', 'blocklisted', 'vm'],
};
/** The signed DEMO policy of plan §3.10: 10 s ack timers, short debounce and delays. */
export const OPS_DEMO: Ops = { ...OPS, demo: true, clearMs: 5_000, releaseDelayMs: 10_000, rebuildGraceMs: 15_000, ladderMs: { P0: 10_000, P1: 10_000, P2: 10_000, P3: 0 } };
export const opsOf = (x?: Partial<Ops>): Ops => ({ ...OPS, ...x, ladderMs: { ...OPS.ladderMs, ...x?.ladderMs } });

export type IncidentKind = 'CELL_DOWN' | 'CENTRE_OUTAGE' | 'SEAT_SILENT' | 'RELAY_WAN_DOWN' | 'SYNC_LAG' | 'INTEGRITY_CRITICAL' | 'TAMPER'
  | 'BAD_SUBMISSION' | 'KEY_RELEASE_DELAY' | 'HANDOVER' | 'GAP' | 'ORPHANED' | 'LATE';
/** answersLost: null while it cannot be known yet (a cell still down or rebuilding). */
export interface Blast { cells: string[]; centres: string[]; candidates: number; answersLost: number | null }
export interface Incident {
  id: string; kind: IncidentKind; severity: Severity; key: string; title: string; detail: string; blast: Blast;
  openedAt: number; updatedAt: number; resolvedAt?: number;
  rung: number; ladder: { rung: Rung; at: number }[]; ack?: { by: string; rung: Rung; at: number };
  /** Path of the CERT-In draft, relative to control's DIR. */
  certIn?: string; cand?: string; data: Record<string, string | number>;
}
export type EventCode = 'BAD_SUBMISSION' | 'FORK' | 'ORPHANED' | 'LATE' | 'HANDOVER' | 'GAP' | 'INTEGRITY';
/** One row of a cell's evidence table, as GET /v1/events serves it. data: the parsed JSON reason, when it is one. */
export interface CellEvent { id: number; at: number; cell: string; code: EventCode; cand: string; centre: string; seq: number; reason: string; data?: Record<string, string | number> }

/** One relay → cell round, as the forwarder reports it. */
export interface RoundSample { at: number; ms: number; ok: boolean; backlog: number; replaying: boolean }
export interface LinkView {
  centre: string; up: boolean; cut: boolean; degraded: boolean; rttMs: number; errRate: number; backlog: number; lastContactAt: number;
  risk: 'ok' | 'warn' | 'down'; reason: string; etaMs?: number; cell: NodeState | 'unreachable';
}
/** What a relay tells its seats (the in-exam banner). */
export interface CentreStatus { link: 'up' | 'degraded' | 'down'; cell: NodeState | 'unreachable'; etaMs?: number; at: number }

export interface Approval { cand: string; seq: number; by: string; at: number }
export interface GapLine { seq: number; kind: 'gap' | 'handover'; cause: string; pausedMs: number; measuredMs: number; approved: boolean; approvedBy: string }
export type TimeFlag = 'REVIEW_GAPS' | 'RETEST_ELIGIBLE' | 'PENDING_APPROVAL' | 'UNEXPLAINED_TIME';
export interface TimeRow {
  cand: string; wallMs: number; activeMs: number; unaccountedMs: number; gaps: GapLine[]; creditedMs: number; flags: TimeFlag[];
  changedAfterMove: { item: string; q: number }[];
}

export interface Notice {
  id: string; incident: string; kind: IncidentKind; centres: string[]; audience: number; en: string; hi: string;
  channels: ('sms' | 'email' | 'digilocker')[]; draftedAt: number; approvedBy?: string; approvedAt?: number;
}
export interface PublicStatus {
  exam: string; shift: string; at: number; summary: { en: string; hi: string };
  centres: { centre: string; tone: TileTone; en: string; hi: string }[];
  incidents: { kind: IncidentKind; severity: Severity; since: number; centres: string[]; answersLost: number | null; en: string; hi: string }[];
  notices: { at: number; en: string; hi: string }[];
}

export interface StoreReport { store: string; path: string; sha256: string; ok: boolean; detail: string }
export interface ArchiveReport { exam: string; shift: string; size: number; root: string; stores: StoreReport[]; ok: boolean; writtenMs?: number; verifyMs: number }
