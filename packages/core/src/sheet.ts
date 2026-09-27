// File formats shared by cell, control, the evidence pack and /verify (Addendum A.7, non-normative JSON).
import type { Canon } from './canon.ts';
import type { Leaf, SignedSth } from './log.ts';
import type { Ctx } from './protocol.ts';

/** One entry of the official response sheet: the §11 signed line, and the body as the cell recorded it, with its salt. */
export interface SheetEntry { line: string; salt: string; body: Canon[] }
export interface SheetReceipt { cell: string; seq: number; h: string; code: string; sig: string }
/** A candidate's official response sheet as a cell exports it — "the record". */
export interface ResponseSheet { ctx: Ctx; form: string; pseud: string; keys: { keyEpoch: number; pub: string }[]; entries: SheetEntry[]; receipt?: SheetReceipt }
export interface ShiftExport { cell: string; exam: string; shift: string; sheets: ResponseSheet[] }
/** What /verify reads: the sheet, the signed tree head, and the leaf's inclusion proof. */
export interface Proof { v: 1; sheet: ResponseSheet; sth: SignedSth; index: number; inclusion: string[] }
/** Pinned public keys (hex). seats: `${cand}/${keyEpoch}` → pub. */
export interface Trust { authority: string; cells: Record<string, string>; seats: Record<string, string> }
export interface LogLeaf extends Leaf { cand: string }
/** Control's per-shift log: every leaf in log order (append-only) and every STH issued. */
export interface SthRecord { exam: string; shift: string; leaves: LogLeaf[]; sths: SignedSth[] }
export type FindingKind = 'body' | 'chain' | 'truncated' | 'count' | 'missing' | 'finalHash' | 'receipt';
export interface Recovery { from: 'archive' | 'next.prev' | 'option-search'; value: string }
/** One audit finding. seq 0 = about the whole chain. */
export interface Finding { cand: string; seq: number; kind: FindingKind; detail: string; recovered?: Recovery }
export interface ReconRow {
  centre: string; exam: string; shift: string;
  registered: number; checkedIn: number; unlocked: number; submitted: number; receipts: number; leaves: number;
  headsEqual: boolean; headMismatches: string[]; green: boolean;
}
export type Forms = Record<string, readonly string[]>;
/** forms.json without durationMin. */
export const formsOf = (json: Record<string, unknown>): Forms =>
  Object.fromEntries(Object.entries(json).filter(([, v]) => Array.isArray(v))) as Forms;
