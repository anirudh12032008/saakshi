// Stage 6 shared analytics types (Addendum E) and two pure helpers. Browser-safe: imports types only.
import type { Canon } from './canon.ts';
import type { IncidentKind } from './ops.ts';

export interface CohortRow {
  cand: string; centre: string; shift: string; form: 'F1' | 'F2'; lang: string; pwd: 0 | 1; item: string;
  state: 'NV' | 'NA' | 'A' | 'MR' | 'AMR'; answer: string; dwellMs: number; visits: number; changes: number; tFirstMs: number;
}
/** Addendum E.1: a cohort row derived from a cell's ShiftExport, plus the last entry's seq, relay rxWall and hex entryHash. */
export interface ExportRow extends CohortRow { seq: number; rxWall: number; h: string }
export interface Disruption { centre: string; shift: string; fromMin: number; toMin: number }
export interface Breach { perimeter: string[] | 'unknown'; systemic: boolean; evidence: string; items?: string[] }
export interface IncidentIn { id: string; disruptions?: Disruption[]; gaps?: Record<string, number[]>; left?: string[]; breach?: Breach }
export type SignalName = 'speed-accuracy' | 'same-room' | 'cusum';
export interface FlagSignal { signal: SignalName; reason: string; observed: number; expected: number; p: number; ring?: string[]; room?: string; changeMin?: number }
export interface HistoryNote { note: string; corroborates?: boolean; pastPct?: number; expectedPct?: number; observedPct?: number; gapSd?: number }
export interface RadarFlag { cand: string; centre: string; shift: string; level: 'watch' | 'review' | 'escalate'; signals: FlagSignal[]; history?: HistoryNote }
export interface DecisionSummary {
  compensated: number; retested: number; reconductedCentres: number; reconductedCentreShifts: number;
  reconductedCandidates: number; baseline: number; spared: number; inrAvoided: number; extraMinTotal: number; rescored: number; openTickets: number;
}
export interface ScoreRow {
  centre: string; risk: number; decision: 'allot' | 'add observer' | 'do not allot'; reasons: string[]; rank: number; note: string;
  telemetry: Record<string, number>;
}
export interface AnalyticsRun {
  v: 1; incident: string;
  /** the report's "Compensated … · ₹ avoided …" line, verbatim */
  headline: string;
  inputs: { rows: number; cands: number; centres: number; evidence: number; sha256: Record<string, string> };
  flags: RadarFlag[]; history: { annotated: number; corroborated: number };
  summary: DecisionSummary; decision: Record<string, unknown>;
  /** decide.render() text */
  report: string;
}
/** Addendum E.2: a named human approved exactly this report (reportHash = hex SHA-256 of its bytes). */
export interface SignedDecision { exam: string; shift: string; reportHash: string; by: string; at: number; sig: string }
/** id = 'R-' + 10 hex of sha256(centre|at|text) */
export interface InvReport { id: string; at: number; centre: string; by: string; text: string }
export type ReportKind = 'CENTRE_OUTAGE' | 'RELAY_WAN_DOWN' | 'INTEGRITY_CRITICAL' | 'SEAT_SILENT' | 'OTHER';
export interface Classification { kind: ReportKind; centre: string; seats: number; summary: string; source: 'template' | 'claude' | 'cache'; linked?: string }
export interface NoticeFacts { exam: string; shift: string; kind: IncidentKind; centres: string[]; audience: number; answersLost: number | null }
export interface NoticeText { en: string; hi: string; ta: string }
export interface Provider {
  name: 'template' | 'claude';
  classify(r: InvReport, open: { id: string; kind: IncidentKind; centres: string[] }[]): Promise<Classification>;
  draftNotice(f: NoticeFacts): Promise<NoticeText>;
  scorecardNote(r: ScoreRow): Promise<string>;
}

export const decisionArray = (d: Omit<SignedDecision, 'sig'>): Canon[] => ['decision', d.exam, d.shift, d.reportHash, d.by, d.at];

/** Indian digit grouping, identical to analytics decide.inr: 29232000 -> 2,92,32,000. */
export function inr(n: number): string {
  const s = String(Math.trunc(n)), head = s.slice(0, -3), tail = s.slice(-3);
  if (!head) return tail;
  const parts: string[] = [];
  for (let i = head.length; i > 0; i -= 2) parts.unshift(head.slice(Math.max(0, i - 2), i));
  return [...parts, tail].join(',');
}
export const headlineOf = (s: DecisionSummary): string =>
  `Compensated ${inr(s.compensated)} · Re-tested ${inr(s.retested)} · Re-conducted ${s.reconductedCentres} centres · Spared ${inr(s.spared)} · ₹ avoided ${inr(s.inrAvoided)}`;
