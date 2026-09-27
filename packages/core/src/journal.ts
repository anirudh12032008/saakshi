import { hexToBytes, randomBytes, toHex } from './bytes.ts';
import { canon, parseCanon, type Canon } from './canon.ts';
import { D, bodyCommit, entryHash, genesisPrev, headerArray, headerFromArray, tagged, type Body, type Ctx, type Header, type Kind } from './protocol.ts';
import type { Verify } from './sig.ts';

export interface EntryIn { kind: Kind; tMonoMs: number; activeMs: number; body: Body; salt: Uint8Array }

export function buildChain(c: Ctx, keyEpoch: number, entries: EntryIn[], sign: (m: Uint8Array) => Uint8Array): { headers: Header[]; lines: string[] } {
  let prev = genesisPrev(c);
  const headers: Header[] = [], lines: string[] = [];
  entries.forEach((e, i) => {
    const h: Header = { ...c, keyEpoch, seq: i + 1, prev, kind: e.kind, tMonoMs: e.tMonoMs, activeMs: e.activeMs, bodyCommit: bodyCommit(e.salt, e.body) };
    lines.push(canon(['signed', headerArray(h), toHex(sign(tagged(D.ENTRY, headerArray(h))))]));
    headers.push(h);
    prev = toHex(entryHash(h));
  });
  return { headers, lines };
}

export type ChainFault = 'parse' | 'shape' | 'context' | 'sig' | 'seq' | 'prev';
export type ChainResult = { ok: true; head: string; count: number } | { ok: false; index: number; fault: ChainFault; detail: string };

const SIG_HEX = /^[0-9a-f]{128}$/;

/** Check order: parse, shape, context, then (per spec) signature, position (seq), prev. Returns the first bad entry. */
export function verifyChain(c: Ctx, lines: string[], verify: Verify): ChainResult {
  let prev = genesisPrev(c);
  for (let i = 0; i < lines.length; i++) {
    const fail = (fault: ChainFault, detail: string): ChainResult => ({ ok: false, index: i, fault, detail });
    let a: Canon[];
    try { a = parseCanon(lines[i]); } catch (e) { return fail('parse', (e as Error).message); }
    const [tag, ha, sig] = a;
    if (a.length !== 3 || tag !== 'signed' || !Array.isArray(ha) || typeof sig !== 'string' || !SIG_HEX.test(sig)) return fail('shape', 'not ["signed",header,sigHex]');
    let h: Header;
    try { h = headerFromArray(ha); } catch (e) { return fail('shape', (e as Error).message); }
    if (h.exam !== c.exam || h.shift !== c.shift || h.attempt !== c.attempt || h.cand !== c.cand) return fail('context', 'entry belongs to another exam, shift, attempt or candidate');
    if (!verify(tagged(D.ENTRY, ha), hexToBytes(sig))) return fail('sig', 'signature does not verify');
    if (h.seq !== i + 1) return fail('seq', `expected seq ${i + 1}, found ${h.seq}`);
    if (h.prev !== prev) return fail('prev', 'prev does not match the previous entry hash');
    prev = toHex(entryHash(h));
  }
  return { ok: true, head: prev, count: lines.length };
}

/** An unlock followed by n-1 answers cycling through the 20 bank items. */
export function demoEntries(n: number): EntryIn[] {
  return Array.from({ length: n }, (_, i): EntryIn => i === 0
    ? { kind: 'unlock', tMonoMs: 0, activeMs: 0, body: { item: '', state: '', answer: '', meta: [] }, salt: randomBytes(16) }
    : { kind: 'answer', tMonoMs: i * 30_000, activeMs: i * 30_000 - 500, salt: randomBytes(16),
        body: { item: `I${String(((i - 1) % 20) + 1).padStart(2, '0')}`, state: 'A', answer: 'ABCD'[i % 4], meta: [25_000 + (i % 7) * 1000, []] } });
}
