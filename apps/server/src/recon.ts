// Per centre-shift reconciliation (plan §3.7): counts along the chain of custody, and relay head = cell head per candidate.
import { parseSignedLine } from '@saakshi/core/journal';
import type { ReconRow, ShiftExport, SthRecord } from '@saakshi/core/sheet';
import type { HeadsRes } from '@saakshi/core/wire';

export interface ReconIn { centre: string; exam: string; shift: string; roster: string[]; relay: HeadsRes; cell: ShiftExport; rec?: SthRecord }

export function reconcile(i: ReconIn): ReconRow {
  const relay = i.relay.streams.filter((v) => v.exam === i.exam && v.shift === i.shift);
  const sheets = i.cell.sheets.filter((s) => s.ctx.exam === i.exam && s.ctx.shift === i.shift);
  const key = (cand: string, attempt: number) => `${cand}/${attempt}`;
  const relayHead = new Map(relay.map((v) => [key(v.cand, v.attempt), v.head]));
  const cellHead = new Map(sheets.map((s) => [key(s.ctx.cand, s.ctx.attempt), s.entries.length]));
  const headMismatches = [...new Set([...relayHead.keys(), ...cellHead.keys()])].sort()
    .filter((k) => (relayHead.get(k) ?? 0) !== (cellHead.get(k) ?? 0))
    .map((k) => `${k.slice(0, k.lastIndexOf('/'))}: relay ${relayHead.get(k) ?? 0} · cell ${cellHead.get(k) ?? 0}`);
  const submitted = sheets.filter((s) => { const l = s.entries.at(-1); const p = l && parseSignedLine(l.line); return !!p && p.ok && p.header.kind === 'submit'; }).length;
  const row = {
    centre: i.centre, exam: i.exam, shift: i.shift,
    registered: i.roster.length,
    checkedIn: relay.filter((v) => v.senderHead >= 0 && i.roster.includes(v.cand)).length,  // DEV: the relay heard the seat (enrolment is Stage 3)
    unlocked: sheets.filter((s) => s.entries.length > 0).length,
    submitted,
    receipts: sheets.filter((s) => s.receipt).length,
    leaves: i.rec?.sths.at(-1)?.sth.size ?? 0,
    headsEqual: headMismatches.length === 0,
    headMismatches,
  };
  // Nothing submitted yet is not green: an empty shift has nothing to reconcile.
  const green = row.submitted > 0 && row.headsEqual && row.submitted === row.receipts && row.receipts === row.leaves
    && row.unlocked <= row.checkedIn && row.checkedIn <= row.registered;
  return { ...row, green };
}
