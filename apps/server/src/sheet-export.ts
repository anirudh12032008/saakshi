// The cell's official response sheets ("the record") for one exam shift, and the DEV rogue-insider edit.
import type { Database } from 'bun:sqlite';
import { toHex } from '@saakshi/core/bytes';
import type { Canon } from '@saakshi/core/canon';
import type { WireBind } from '@saakshi/core/enrol';
import { bodyArray, type State } from '@saakshi/core/protocol';
import type { ResponseSheet, ShiftExport } from '@saakshi/core/sheet';

export interface ExportOpts {
  exam: string; shift: string; cell: string;
  formOf: (cand: string) => string | undefined;
  pseud: (cand: string) => string;
  seatKey: (cand: string, keyEpoch: number) => Uint8Array | undefined;
  /** Addendum C.1 (EXAM mode): the candidate's bind certificates. Exported without the sealed PIN record. */
  binds?: (cand: string) => WireBind[];
}
interface J { attempt: number; cand: string; seq: number; key_epoch: number; line: string; item: string | null; state: string | null; answer: string | null; meta: string | null; salt: Uint8Array | null }
interface R { attempt: number; cand: string; seq: number; h: string; code: string; cell: string; sig: string }

function recorded(r: J): { salt: string; body: Canon[] } {
  if (r.item === null || r.salt === null) return { salt: '0'.repeat(32), body: ['missing'] };
  try { return { salt: toHex(r.salt), body: bodyArray({ item: r.item, state: r.state as State | '', answer: r.answer ?? '', meta: JSON.parse(r.meta ?? '') }) }; }
  catch { return { salt: '0'.repeat(32), body: ['unreadable'] }; }
}

export function shiftExport(db: Database, o: ExportOpts): ShiftExport {
  const rows = db.query(`SELECT e.attempt, e.cand, e.seq, e.key_epoch, e.line, b.item, b.state, b.answer, b.meta, b.salt
    FROM entries e LEFT JOIN bodies b ON b.exam = e.exam AND b.shift = e.shift AND b.attempt = e.attempt AND b.cand = e.cand AND b.seq = e.seq
    WHERE e.exam = ? AND e.shift = ? ORDER BY e.cand, e.attempt, e.seq`).all(o.exam, o.shift) as J[];
  const receipts = new Map((db.query('SELECT attempt, cand, seq, h, code, cell, sig FROM receipts WHERE exam = ? AND shift = ?').all(o.exam, o.shift) as R[])
    .map((r) => [`${r.cand}/${r.attempt}`, r]));
  const sheets = new Map<string, { sheet: ResponseSheet; epochs: Set<number> }>();
  for (const r of rows) {
    const k = `${r.cand}/${r.attempt}`;
    let x = sheets.get(k);
    if (!x) sheets.set(k, (x = { sheet: { ctx: { exam: o.exam, shift: o.shift, attempt: r.attempt, cand: r.cand }, form: o.formOf(r.cand) ?? '', pseud: o.pseud(r.cand), keys: [], entries: [] }, epochs: new Set() }));
    x.epochs.add(r.key_epoch);
    x.sheet.entries.push({ line: r.line, ...recorded(r) });
  }
  for (const [k, { sheet, epochs }] of sheets) {
    sheet.keys = [...epochs].sort((a, b) => a - b).flatMap((e) => { const pub = o.seatKey(sheet.ctx.cand, e); return pub ? [{ keyEpoch: e, pub: toHex(pub) }] : []; });
    const bs = o.binds?.(sheet.ctx.cand) ?? [];
    if (bs.length) sheet.binds = bs.map((b) => ({ ...b, pinBox: '' }));
    const rc = receipts.get(k);
    if (rc) sheet.receipt = { cell: rc.cell, seq: rc.seq, h: rc.h, code: rc.code, sig: rc.sig };
  }
  return { cell: o.cell, exam: o.exam, shift: o.shift, sheets: [...sheets.values()].map((x) => x.sheet) };
}

export interface RogueIn { exam: string; shift: string; attempt: number; cand: string; item: string; answer: string }
export interface RogueOut { seq: number; item: string; from: string; to: string; sql: string }

/** DEV chaos only: what an insider with DB access does — rewrite the recorded answer of the latest entry for an item. */
export function rogueEdit(db: Database, r: RogueIn): RogueOut {
  const row = db.query('SELECT seq, answer FROM bodies WHERE exam = ? AND shift = ? AND attempt = ? AND cand = ? AND item = ? ORDER BY seq DESC LIMIT 1')
    .get(r.exam, r.shift, r.attempt, r.cand, r.item) as { seq: number; answer: string } | null;
  if (!row) throw new Error(`no recorded answer for ${r.cand} ${r.item}`);
  db.query('UPDATE bodies SET answer = ? WHERE exam = ? AND shift = ? AND attempt = ? AND cand = ? AND seq = ?').run(r.answer, r.exam, r.shift, r.attempt, r.cand, row.seq);
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  return {
    seq: row.seq, item: r.item, from: row.answer, to: r.answer,
    sql: `UPDATE bodies SET answer = ${q(r.answer)} WHERE exam = ${q(r.exam)} AND shift = ${q(r.shift)} AND attempt = ${r.attempt} AND cand = ${q(r.cand)} AND seq = ${row.seq};`,
  };
}
