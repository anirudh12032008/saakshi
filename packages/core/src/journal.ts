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
    lines.push(signedLine(h, sign));
    headers.push(h);
    prev = toHex(entryHash(h));
  });
  return { headers, lines };
}

export type ChainFault = 'parse' | 'shape' | 'context' | 'sig' | 'seq' | 'prev';
export type ChainResult = { ok: true; head: string; count: number } | { ok: false; index: number; fault: ChainFault; detail: string };

const SIG_HEX = /^[0-9a-f]{128}$/;

/** One §11 journal line: canon(["signed", header, sigHex]). */
export const signedLine = (h: Header, sign: (m: Uint8Array) => Uint8Array): string =>
  canon(['signed', headerArray(h), toHex(sign(tagged(D.ENTRY, headerArray(h))))]);

export type ParsedLine = { ok: true; header: Header; m: Uint8Array; sig: Uint8Array } | { ok: false; fault: 'parse' | 'shape'; detail: string };

/** §11 checks 1–2 for a single line; m is the exact signed message (0x02 ‖ canonical header). */
export function parseSignedLine(line: string): ParsedLine {
  let a: Canon[];
  try { a = parseCanon(line); } catch (e) { return { ok: false, fault: 'parse', detail: (e as Error).message }; }
  const [tag, ha, sig] = a;
  if (a.length !== 3 || tag !== 'signed' || !Array.isArray(ha) || typeof sig !== 'string' || !SIG_HEX.test(sig)) return { ok: false, fault: 'shape', detail: 'not ["signed",header,sigHex]' };
  try { return { ok: true, header: headerFromArray(ha), m: tagged(D.ENTRY, ha), sig: hexToBytes(sig) }; }
  catch (e) { return { ok: false, fault: 'shape', detail: (e as Error).message }; }
}

/** verifyChain with one key per keyEpoch; an epoch with no key is a 'sig' fault on that line. */
export function verifyChainKeyed(c: Ctx, lines: string[], keyFor: (keyEpoch: number) => Verify | undefined): ChainResult {
  let prev = genesisPrev(c);
  for (let i = 0; i < lines.length; i++) {
    const fail = (fault: ChainFault, detail: string): ChainResult => ({ ok: false, index: i, fault, detail });
    const p = parseSignedLine(lines[i]);
    if (!p.ok) return fail(p.fault, p.detail);
    const h = p.header;
    if (h.exam !== c.exam || h.shift !== c.shift || h.attempt !== c.attempt || h.cand !== c.cand) return fail('context', 'entry belongs to another exam, shift, attempt or candidate');
    const verify = keyFor(h.keyEpoch);
    if (!verify) return fail('sig', `no pinned key for keyEpoch ${h.keyEpoch}`);
    if (!verify(p.m, p.sig)) return fail('sig', 'signature does not verify');
    if (h.seq !== i + 1) return fail('seq', `expected seq ${i + 1}, found ${h.seq}`);
    if (h.prev !== prev) return fail('prev', 'prev does not match the previous entry hash');
    prev = toHex(entryHash(h));
  }
  return { ok: true, head: prev, count: lines.length };
}

/** Check order: parse, shape, context, then (per spec) signature, position (seq), prev. Returns the first bad entry. */
export const verifyChain = (c: Ctx, lines: string[], verify: Verify): ChainResult => verifyChainKeyed(c, lines, () => verify);

/** An unlock followed by n-1 answers cycling through the 20 bank items. */
export function demoEntries(n: number): EntryIn[] {
  return Array.from({ length: n }, (_, i): EntryIn => i === 0
    ? { kind: 'unlock', tMonoMs: 0, activeMs: 0, body: { item: '', state: '', answer: '', meta: [] }, salt: randomBytes(16) }
    : { kind: 'answer', tMonoMs: i * 30_000, activeMs: i * 30_000 - 500, salt: randomBytes(16),
        body: { item: `I${String(((i - 1) % 20) + 1).padStart(2, '0')}`, state: 'A', answer: 'ABCD'[i % 4], meta: [25_000 + (i % 7) * 1000, []] } });
}
