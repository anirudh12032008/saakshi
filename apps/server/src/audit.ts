// The audit (plan §3.7): sweep every chain, locate edits, truncation and count mismatches, and try the recovery order
// archive/replica → next.prev → option search. Reads only exports and heads, never a DB, so it can run anywhere.
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { parseSignedLine } from '@saakshi/core/journal';
import { verifier } from '@saakshi/core/node';
import { bodyCommit, bodyFromArray, entryHash } from '@saakshi/core/protocol';
import type { Finding, Forms, Recovery, ResponseSheet, ShiftExport, SthRecord, Trust } from '@saakshi/core/sheet';
import { mismatchText, verifySheet } from '@saakshi/core/verify';
import type { HeadsRes } from '@saakshi/core/wire';

export interface AuditIn { cell: ShiftExport; relay: HeadsRes; archive?: ShiftExport; rec?: SthRecord; trust: Trust; forms: Forms }

const keyOf = (cand: string, attempt: number) => `${cand}/${attempt}`;
const entryAt = (sheet: ResponseSheet, seq: number) =>
  sheet.entries.find((e) => { const p = parseSignedLine(e.line); return p.ok && p.header.seq === seq; });

/** 1. the archive's copy, only if its line is identical and its body matches the signed commitment; 3. option search. */
function recoverBody(sheet: ResponseSheet, arch: ResponseSheet | undefined, seq: number, searched: string | null): Recovery | undefined {
  const cur = entryAt(sheet, seq), a = arch?.entries[seq - 1];
  if (cur && a && a.line === cur.line) {
    const p = parseSignedLine(a.line);
    try {
      const b = bodyFromArray(a.body);
      if (p.ok && bodyCommit(hexToBytes(a.salt), b) === p.header.bodyCommit) return { from: 'archive', value: b.answer || 'no answer' };
    } catch { /* unusable copy */ }
  }
  return searched === null ? undefined : { from: 'option-search', value: searched };
}

/** 1. the archive's line, if the next entry's prev confirms it is the original; 2. next.prev pins the original h. */
function recoverLine(sheet: ResponseSheet, arch: ResponseSheet | undefined, seq: number): Recovery | undefined {
  const next = entryAt(sheet, seq + 1);
  const np = next ? parseSignedLine(next.line) : undefined;
  const pinned = np?.ok ? np.header.prev : undefined;
  const a = arch?.entries[seq - 1];
  const ap = a ? parseSignedLine(a.line) : undefined;
  if (ap?.ok && ap.header.seq === seq && (!pinned || toHex(entryHash(ap.header)) === pinned)) return { from: 'archive', value: `seq ${seq} restored from the sealed archive` };
  if (pinned) return { from: 'next.prev', value: `original h ${pinned.slice(0, 16)}… pinned by seq ${seq + 1}` };
  return undefined;
}

export function audit(a: AuditIn): Finding[] {
  const { exam, shift } = a.cell;
  const cellBy = new Map(a.cell.sheets.map((s) => [keyOf(s.ctx.cand, s.ctx.attempt), s]));
  const archBy = new Map((a.archive?.sheets ?? []).map((s) => [keyOf(s.ctx.cand, s.ctx.attempt), s]));
  const relayBy = new Map(a.relay.streams.filter((v) => v.exam === exam && v.shift === shift && v.head > 0).map((v) => [keyOf(v.cand, v.attempt), v.head]));
  const leafBy = new Map((a.rec?.leaves ?? []).filter((l) => l.exam === exam && l.shift === shift).map((l) => [keyOf(l.cand, l.attempt), l]));
  const out: Finding[] = [];

  for (const key of [...new Set([...cellBy.keys(), ...archBy.keys(), ...relayBy.keys(), ...leafBy.keys()])].sort()) {
    const cand = key.slice(0, key.lastIndexOf('/'));
    const sheet = cellBy.get(key), arch = archBy.get(key), relayHead = relayBy.get(key), leaf = leafBy.get(key);
    const add = ({ recovered, ...f }: Omit<Finding, 'cand'>) => { out.push(recovered ? { cand, ...f, recovered } : { cand, ...f }); };

    if (!sheet) {
      const held = [relayHead !== undefined && `the relay holds ${relayHead}`, arch && `the archive holds ${arch.entries.length}`, leaf && 'the register has its leaf'].filter(Boolean).join(', ');
      add({ seq: 0, kind: 'missing', detail: `the cell holds no entries; ${held}`, recovered: arch ? { from: 'archive', value: `${arch.entries.length} entries` } : undefined });
      continue;
    }
    const count = sheet.entries.length;
    if (relayHead !== undefined && relayHead !== count) add({ seq: 0, kind: 'count', detail: `relay holds ${relayHead} entries, cell holds ${count}` });
    if (arch && arch.entries.length > count) add({ seq: 0, kind: 'count', detail: `archive holds ${arch.entries.length} entries, cell holds ${count}` });

    const r = verifySheet(sheet, a.forms, a.trust, verifier);
    if (r.fault) add({ seq: r.fault.seq, kind: 'chain', detail: `entry ${r.fault.seq}: ${r.fault.fault} — ${r.fault.detail}`, recovered: recoverLine(sheet, arch, r.fault.seq) });
    for (const m of r.mismatches)
      add({ seq: m.seq, kind: 'body', detail: mismatchText(m), recovered: recoverBody(sheet, arch, m.seq, m.committed ? m.committed.answer || 'no answer' : null) });

    const anchor = leaf?.h ?? sheet.receipt?.h;
    if (anchor && r.submit?.h !== anchor) {
      add({ seq: count, kind: 'truncated', detail: `the chain ends at seq ${count} without the submit the register (or receipt) commits to`,
        recovered: arch && arch.entries.length > count ? { from: 'archive', value: `entries ${count + 1}–${arch.entries.length} restored from the sealed archive` } : undefined });
      continue;
    }
    const failed = (n: string) => r.checks.find((c) => c.name === n && !c.ok);
    if (!r.fault && !r.mismatches.length && r.submit) {
      const fh = failed('finalHash'), rc = failed('receipt');
      if (fh) add({ seq: r.submit.seq, kind: 'finalHash', detail: fh.detail });
      else if (rc && sheet.receipt) add({ seq: r.submit.seq, kind: 'receipt', detail: rc.detail });
    }
  }
  return out;
}
