// The per-shift archive (plan §3.7): the sealed register (signed STH and every leaf) and the records behind it, written to TWO
// independent write-once stores. Both are re-read and checked against the signed STH; only then does control sign a purge order
// (Addendum C.10) that lets a relay drop the shift. WORM is simulated: files opened with 'wx' and made read-only (not on Windows).
// Retention until results + the grievance window, then DPDP deletion, is not built.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import type { Database } from 'bun:sqlite';
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { msg } from '@saakshi/core/enrol';
import { purgeArray, type PurgeOrder } from '@saakshi/core/handover';
import { parseSignedLine } from '@saakshi/core/journal';
import { leafHashHex, sthId, sthMessage, type SignedSth } from '@saakshi/core/log';
import { rootOf } from '@saakshi/core/merkle';
import type { ArchiveReport, StoreReport } from '@saakshi/core/ops';
import { entryHash } from '@saakshi/core/protocol';
import type { LogLeaf, ShiftExport } from '@saakshi/core/sheet';
import type { Verify } from '@saakshi/core/sig';
import type { Routes } from './serve.ts';

export interface ArchiveBundle { v: 1; exam: string; shift: string; sth: SignedSth; leaves: LogLeaf[]; export: ShiftExport }
export const bundleName = (exam: string, shift: string, size: number): string => `${exam}-${shift}-${size}.bundle.json`;
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

export function writeArchive(stores: string[], b: ArchiveBundle): StoreReport[] {
  const text = JSON.stringify(b), digest = sha(text);
  return stores.map((store): StoreReport => {
    mkdirSync(store, { recursive: true });
    const path = join(store, bundleName(b.exam, b.shift, b.sth.sth.size));
    if (existsSync(path)) {
      const cur = sha(readFileSync(path, 'utf8'));
      return { store, path, sha256: cur, ok: cur === digest, detail: cur === digest ? 'already archived (write-once)' : 'a different bundle is already archived under this name' };
    }
    writeFileSync(path, text, { flag: 'wx' });
    writeFileSync(`${path}.sha256`, `${digest}  ${basename(path)}\n`, { flag: 'wx' });
    if (process.platform !== 'win32') { chmodSync(path, 0o444); chmodSync(`${path}.sha256`, 0o444); }
    return { store, path, sha256: digest, ok: true, detail: 'written (write-once, read-only)' };
  });
}

/** Both stores must hold the bundle, match its recorded SHA-256, carry this STH, rebuild its root, and hold a record for every leaf. */
export function verifyArchive(stores: string[], want: { exam: string; shift: string; sth: SignedSth }, authority: Verify): ArchiveReport {
  const t0 = performance.now(), size = want.sth.sth.size;
  const reports = stores.map((store): StoreReport => {
    const path = join(store, bundleName(want.exam, want.shift, size));
    const fail = (detail: string, sha256 = ''): StoreReport => ({ store, path, sha256, ok: false, detail });
    try {
      const text = readFileSync(path, 'utf8'), digest = sha(text);
      if (readFileSync(`${path}.sha256`, 'utf8').split(/\s+/)[0] !== digest) return fail('the bundle does not match its recorded SHA-256', digest);
      const b = JSON.parse(text) as ArchiveBundle;
      if (sthId(b.sth.sth) !== sthId(want.sth.sth) || b.sth.sig !== want.sth.sig) return fail('the bundle holds another register head', digest);
      if (!authority(sthMessage(b.sth.sth), hexToBytes(b.sth.sig))) return fail('the register head signature does not verify', digest);
      if (b.leaves.length !== size || toHex(rootOf(b.leaves.map((l) => hexToBytes(leafHashHex(l))))) !== b.sth.sth.root) return fail('its leaves do not rebuild the signed root', digest);
      const heads = new Map(b.export.sheets.map((s) => { const p = parseSignedLine(s.entries.at(-1)?.line ?? ''); return [s.ctx.cand, p.ok ? toHex(entryHash(p.header)) : ''] as const; }));
      const unmatched = b.leaves.filter((l) => heads.get(l.cand) !== l.h).length;
      if (unmatched) return fail(`${unmatched} leaves have no matching record in the bundle`, digest);
      return { store, path, sha256: digest, ok: true, detail: `${size} leaves rebuild the signed root; SHA-256 matches` };
    } catch (e) { return fail((e as Error).message); }
  });
  return { exam: want.exam, shift: want.shift, size, root: want.sth.sth.root, stores: reports, ok: reports.length >= 2 && reports.every((r) => r.ok), verifyMs: Math.round(performance.now() - t0) };
}

export const signPurge = (p: PurgeOrder, sign: (m: Uint8Array) => Uint8Array): { order: PurgeOrder; sig: string } => ({ order: p, sig: toHex(sign(msg(purgeArray(p)))) });

/** Drop a shift's journal entries from a relay DB. Bindings and evidence stay. */
export function purgeRelay(db: Database, exam: string, shift: string): number {
  return db.transaction(() => db.query('DELETE FROM entries WHERE exam = ? AND shift = ?').run(exam, shift).changes)();
}

export function purgeRoute(o: { exam: string; shift: string; authority: Verify; db: Database; log?: (line: string) => void }): Routes {
  const log = o.log ?? ((l: string) => console.log(l));
  return {
    '/v1/purge': { POST: async (req) => {
      const b = (await req.json().catch(() => null)) as { order?: PurgeOrder; sig?: unknown } | null;
      const p = b?.order;
      if (!p || typeof p.exam !== 'string' || typeof p.shift !== 'string' || typeof p.sthId !== 'string' || !/^[0-9a-f]{64}$/.test(p.sthId)
        || !Number.isSafeInteger(p.ts) || typeof b.sig !== 'string' || !/^[0-9a-f]{128}$/.test(b.sig)) return Response.json({ error: 'need {order: {exam, shift, sthId, ts}, sig}' }, { status: 400 });
      if (p.exam !== o.exam || p.shift !== o.shift) return Response.json({ error: `this relay holds ${o.exam} ${o.shift}` }, { status: 400 });
      if (!o.authority(msg(purgeArray(p)), hexToBytes(b.sig))) return Response.json({ error: 'the purge order is not signed by the exam authority' }, { status: 403 });
      const purged = purgeRelay(o.db, p.exam, p.shift);
      log(`PURGED ${JSON.stringify({ exam: p.exam, shift: p.shift, sthId: p.sthId, entries: purged })}`);
      return Response.json({ purged });
    } },
  };
}
