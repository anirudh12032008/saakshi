// Control: append submitted chains to the per-shift log and sign a new STH (protocol Addendum A.2/A.3). Pure: no files.
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { parseSignedLine, verifyChainKeyed } from '@saakshi/core/journal';
import { NO_PREV_STH, leafHashHex, sthId, sthMessage, type Sth } from '@saakshi/core/log';
import { inclusionProof, rootOf } from '@saakshi/core/merkle';
import { signer, verifier, type KeyPair } from '@saakshi/core/node';
import { bodyCommit, bodyFromArray } from '@saakshi/core/protocol';
import type { LogLeaf, Proof, ResponseSheet, ShiftExport, SthRecord, Trust } from '@saakshi/core/sheet';
import type { Verify } from '@saakshi/core/sig';
import type { CellCert } from '@saakshi/core/handover';

export interface SealOpts { authority: KeyPair; trust: Trust; pseud: (cand: string) => string; now?: () => number }
export interface SealResult { rec: SthRecord; added: string[]; skipped: { cand: string; reason: string }[] }

/** The leaf a submitted sheet contributes, or why it cannot be logged. Checks only what the leaf commits to. */
export function leafOf(sheet: ResponseSheet, o: Pick<SealOpts, 'trust' | 'pseud'>): LogLeaf | string {
  const { ctx } = sheet;
  if (sheet.pseud !== o.pseud(ctx.cand)) return 'pseudonym does not match';
  const keys = new Map<number, Verify>();
  for (const k of sheet.keys) if (o.trust.seats[`${ctx.cand}/${k.keyEpoch}`] === k.pub) keys.set(k.keyEpoch, verifier(hexToBytes(k.pub)));
  const chain = verifyChainKeyed(ctx, sheet.entries.map((e) => e.line), (e) => keys.get(e));
  if (!chain.ok) return `chain fails at seq ${chain.index + 1} (${chain.fault})`;
  const last = sheet.entries.at(-1);
  const p = last ? parseSignedLine(last.line) : undefined;
  if (!last || !p?.ok || p.header.kind !== 'submit') return 'not submitted';
  let fh: unknown;
  try {
    const b = bodyFromArray(last.body);
    if (bodyCommit(hexToBytes(last.salt), b) !== p.header.bodyCommit) return 'submit body does not match its commitment';
    fh = b.meta[1];
  } catch (e) { return `submit body: ${(e as Error).message}`; }
  if (typeof fh !== 'string' || !/^[0-9a-f]{64}$/.test(fh)) return 'submit meta has no finalHash';
  return { cand: ctx.cand, exam: ctx.exam, shift: ctx.shift, attempt: ctx.attempt, pseud: sheet.pseud, h: chain.head, finalHash: fh };
}

const byCand = (a: ResponseSheet, b: ResponseSheet) => (a.ctx.cand < b.ctx.cand ? -1 : a.ctx.cand > b.ctx.cand ? 1 : a.ctx.attempt - b.ctx.attempt);

/** Append every newly submitted chain (sorted by candidate) and sign an STH. Existing leaves are never reordered. */
export function seal(rec: SthRecord | undefined, exp: ShiftExport, o: SealOpts): SealResult {
  const leaves = [...(rec?.leaves ?? [])];
  const have = new Set(leaves.map((l) => `${l.cand}/${l.attempt}`));
  const added: string[] = [];
  const skipped: SealResult['skipped'] = [];
  for (const s of [...exp.sheets].sort(byCand)) {
    if (have.has(`${s.ctx.cand}/${s.ctx.attempt}`)) continue;
    const l = leafOf(s, o);
    if (typeof l === 'string') { skipped.push({ cand: s.ctx.cand, reason: l }); continue; }
    leaves.push(l);
    added.push(l.cand);
  }
  if (rec && !added.length) return { rec, added, skipped };
  const prev = rec?.sths.at(-1)?.sth;
  const sth: Sth = {
    exam: exp.exam, shift: exp.shift, size: leaves.length,
    root: toHex(rootOf(leaves.map((l) => hexToBytes(leafHashHex(l))))),
    prevSTH: prev ? sthId(prev) : NO_PREV_STH, ts: (o.now ?? Date.now)(),
  };
  const sig = toHex(signer(o.authority)(sthMessage(sth)));
  return { rec: { exam: exp.exam, shift: exp.shift, leaves, sths: [...(rec?.sths ?? []), { sth, sig }] }, added, skipped };
}

/** The proof /verify needs for one sheet, under the latest STH; undefined if the sheet is not in it. */
export function proofFor(rec: SthRecord, sheet: ResponseSheet, cells?: CellCert[]): Proof | undefined {
  const signed = rec.sths.at(-1);
  if (!signed) return undefined;
  const index = rec.leaves.findIndex((l) => l.cand === sheet.ctx.cand && l.attempt === sheet.ctx.attempt);
  if (index < 0 || index >= signed.sth.size) return undefined;
  const hs = rec.leaves.slice(0, signed.sth.size).map((l) => hexToBytes(leafHashHex(l)));
  return { v: 1, sheet, sth: signed, index, inclusion: inclusionProof(hs, index).map(toHex), ...(cells?.length ? { cells } : {}) };
}
