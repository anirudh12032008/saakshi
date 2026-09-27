// The one verifier: the audit (server) and /verify (browser) both call it. Browser-safe: noble by default.
import { crockford80, decodeCrockford80, hexToBytes, toHex } from './bytes.ts';
import { canon, type Canon } from './canon.ts';
import { parseSignedLine, verifyChainKeyed, type ChainFault } from './journal.ts';
import { leafHashHex, receiptMessage, responsesOf, sthMessage, type Leaf } from './log.ts';
import { verifyInclusion } from './merkle.ts';
import { STATES, bodyCommit, bodyFromArray, counts, entryHash, finalHash, receiptCode, type Body, type ReceiptIn, type Response } from './protocol.ts';
import type { Forms, Proof, ResponseSheet, Trust } from './sheet.ts';
import { nobleVerifier, type Verify } from './sig.ts';

export type CheckName = 'keys' | 'chain' | 'bodies' | 'finalHash' | 'receipt' | 'slip' | 'sth' | 'inclusion';
export interface Check { name: CheckName; ok: boolean; detail: string }
export interface Answer { state: string; answer: string }
/** A body the record holds that is not what the seat committed. committed = null: option search found nothing. */
export interface Mismatch { seq: number; item: string; q: number; recorded: Answer; committed: Answer | null }
export interface SheetReport {
  ok: boolean;
  checks: Check[];
  mismatches: Mismatch[];
  fault?: { seq: number; fault: ChainFault; detail: string };
  submit?: { seq: number; h: string; form: string; finalHash: string };
  /** Receipt B recomputed from the committed bodies, with its code. */
  receipt?: ReceiptIn & { code: string };
  leaf?: Leaf;
}
type MkVerify = (pub: Uint8Array) => Verify;

const OPTIONS = ['', 'A', 'B', 'C', 'D'];

/** Recovery by option search: the body the seat committed, if only state and/or answer were changed. */
export function optionSearch(salt: Uint8Array, recorded: Body, commit: string): Body | null {
  for (const state of ['', ...STATES] as Body['state'][]) {
    for (const answer of OPTIONS) {
      const b: Body = { ...recorded, state, answer };
      if (bodyCommit(salt, b) === commit) return b;
    }
  }
  return null;
}

/** "Q17: record says C — the seat committed B". Falls back to states when the answers agree. */
export function mismatchText(m: Mismatch): string {
  const where = m.q ? `Q${m.q}` : `Entry ${m.seq}`;
  const sameAnswer = m.committed && m.committed.answer === m.recorded.answer;
  const say = (a: Answer) => (sameAnswer ? a.state || 'no state' : a.answer || 'no answer');
  return `${where}: record says ${say(m.recorded)} — ${m.committed ? `the seat committed ${say(m.committed)}` : 'what the seat committed cannot be recovered'}`;
}

export function verifySheet(sheet: ResponseSheet, forms: Forms, trust: Trust, mkVerify: MkVerify = nobleVerifier): SheetReport {
  const { ctx } = sheet;
  const checks: Check[] = [];
  const mismatches: Mismatch[] = [];
  const check = (name: CheckName, ok: boolean, detail: string) => { checks.push({ name, ok, detail }); };
  const form = forms[sheet.form];

  // 1. Keys: each key the sheet names must be the pinned key for (cand, keyEpoch).
  const keyed = new Map<number, Verify>();
  const badKeys: number[] = [];
  for (const k of sheet.keys) {
    if (trust.seats[`${ctx.cand}/${k.keyEpoch}`] === k.pub) keyed.set(k.keyEpoch, mkVerify(hexToBytes(k.pub)));
    else badKeys.push(k.keyEpoch);
  }
  check('keys', badKeys.length === 0 && keyed.size > 0,
    badKeys.length ? `keyEpoch ${badKeys.join(', ')}: not the pinned seat key for ${ctx.cand}` : keyed.size ? `${keyed.size} key epoch(s), each the pinned key for ${ctx.cand}` : 'no seat keys in the record');

  // 2. Chain, one verifier per key epoch.
  const chain = verifyChainKeyed(ctx, sheet.entries.map((e) => e.line), (e) => keyed.get(e));
  const fault = chain.ok ? undefined : { seq: chain.index + 1, fault: chain.fault, detail: chain.detail };
  check('chain', chain.ok, fault ? `entry ${fault.seq}: ${fault.fault} — ${fault.detail}` : `${sheet.entries.length} entries: signatures, sequence and links verify`);

  // 3. Every recorded body against its signed commitment; option search where they differ.
  const committed: (Body | null)[] = [];
  for (const e of sheet.entries) {
    const p = parseSignedLine(e.line);
    if (!p.ok) { committed.push(null); continue; }
    let rb: Body | undefined;
    try { rb = bodyFromArray(e.body); } catch { /* missing or garbled row */ }
    const salt = hexToBytes(e.salt);
    if (rb && bodyCommit(salt, rb) === p.header.bodyCommit) { committed.push(rb); continue; }
    const c = rb ? optionSearch(salt, rb, p.header.bodyCommit) : null;
    mismatches.push({
      seq: p.header.seq, item: rb?.item ?? '', q: rb && form ? form.indexOf(rb.item) + 1 : 0,
      recorded: rb ? { state: rb.state, answer: rb.answer } : { state: '', answer: '(unreadable)' },
      committed: c && { state: c.state, answer: c.answer },
    });
    committed.push(c);
  }
  check('bodies', mismatches.length === 0, mismatches.length
    ? `${mismatches.length} of ${sheet.entries.length} bodies differ from what the seat committed`
    : `${sheet.entries.length} bodies match their signed commitments`);

  // 4. finalHash: the chain must end in a submit whose committed meta is [form, finalHash]; replay must agree.
  const lastLine = sheet.entries.at(-1);
  const last = lastLine ? parseSignedLine(lastLine.line) : undefined;
  const sb = committed.at(-1);
  let submit: SheetReport['submit'];
  if (last?.ok && last.header.kind === 'submit' && sb && typeof sb.meta[0] === 'string' && typeof sb.meta[1] === 'string')
    submit = { seq: last.header.seq, h: toHex(entryHash(last.header)), form: sb.meta[0], finalHash: sb.meta[1] };
  let responses: Response[] | undefined;
  if (!submit) check('finalHash', false, 'the chain does not end in a submit (truncated, or not submitted yet)');
  else if (!form || submit.form !== sheet.form) check('finalHash', false, `the submit names form ${submit.form}; the record says ${sheet.form}`);
  else {
    const before = committed.slice(0, -1);
    const lost = before.findIndex((b) => b === null);
    if (lost >= 0) check('finalHash', false, `cannot replay: entry ${lost + 1} cannot be recovered`);
    else {
      try {
        const rs = responsesOf(form, before as Body[]);
        const same = finalHash(ctx, sheet.form, rs) === submit.finalHash;
        if (same) responses = rs;
        check('finalHash', same, same ? 'replaying the committed answers gives the submitted finalHash' : 'replaying the committed answers does not give the submitted finalHash');
      } catch (e) { check('finalHash', false, `cannot replay: ${(e as Error).message}`); }
    }
  }

  // 5. Receipt B from the committed record, and the cell's countersignature if the record carries one.
  let receipt: SheetReport['receipt'];
  const leaf: Leaf | undefined = submit && { exam: ctx.exam, shift: ctx.shift, attempt: ctx.attempt, pseud: sheet.pseud, h: submit.h, finalHash: submit.finalHash };
  if (submit && responses) {
    const B: ReceiptIn = { exam: ctx.exam, shift: ctx.shift, attempt: ctx.attempt, pseud: sheet.pseud, seq: submit.seq, h: submit.h, finalHash: submit.finalHash, ...counts(responses) };
    receipt = { ...B, code: receiptCode(B) };
    const r = sheet.receipt;
    if (!r) check('receipt', true, `receipt ${receipt.code}; this record carries no cell countersignature yet`);
    else {
      const pub = trust.cells[r.cell];
      const ok = !!pub && r.seq === B.seq && r.h === B.h && r.code === receipt.code && mkVerify(hexToBytes(pub))(receiptMessage(B), hexToBytes(r.sig));
      check('receipt', ok, ok ? `receipt ${receipt.code}, countersigned by ${r.cell}` : `the cell's receipt (${r.code}) does not match this record, or its countersignature fails`);
    }
  } else check('receipt', false, 'no receipt without a verified submit');

  return { ok: checks.every((c) => c.ok), checks, mismatches, fault, submit, receipt, leaf };
}

/** verifySheet plus the slip code as typed, the STH signature and the leaf's inclusion. */
export function verifyProof(p: Proof, forms: Forms, trust: Trust, typedCode?: string, mkVerify: MkVerify = nobleVerifier): SheetReport {
  const r = verifySheet(p.sheet, forms, trust, mkVerify);
  const add = (name: CheckName, ok: boolean, detail: string) => { r.checks.push({ name, ok, detail }); };
  if (typedCode !== undefined && typedCode.trim() !== '') {
    let typed: string | undefined;
    try { typed = crockford80(decodeCrockford80(typedCode.trim())); } catch { /* a typo: bad length, symbol or check */ }
    add('slip', !!typed && typed === r.receipt?.code,
      !typed ? 'the code as typed is not a valid receipt code — check it against the slip and re-type it'
        : typed === r.receipt?.code ? `matches the slip: ${typed}` : `the slip says ${typed}; this record gives ${r.receipt?.code ?? 'no receipt'}`);
  }
  const { sth, sig } = p.sth;
  const sthOk = sth.exam === p.sheet.ctx.exam && sth.shift === p.sheet.ctx.shift && mkVerify(hexToBytes(trust.authority))(sthMessage(sth), hexToBytes(sig));
  add('sth', sthOk, sthOk ? `register head of ${sth.size} leaves (root ${sth.root.slice(0, 16)}…) signed by the exam authority` : 'the register head is not signed by the pinned authority key, or belongs to another exam or shift');
  const incl = !!r.leaf && verifyInclusion(p.index, sth.size, hexToBytes(leafHashHex(r.leaf)), p.inclusion.map(hexToBytes), hexToBytes(sth.root));
  add('inclusion', incl, incl ? `leaf ${p.index + 1} of ${sth.size} is in the sealed register` : 'this submission is not in the sealed register');
  r.ok = r.checks.every((c) => c.ok) && r.mismatches.length === 0;
  return r;
}

const HEX64 = /^[0-9a-f]{64}$/, SIG = /^[0-9a-f]{128}$/, PUB = /^04[0-9a-f]{128}$/, SALT = /^[0-9a-f]{32}$/;
type O = Record<string, unknown>;
const obj = (x: unknown): x is O => typeof x === 'object' && x !== null && !Array.isArray(x);
const nat = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;
const str = (x: unknown, max = 64): x is string => typeof x === 'string' && x.length > 0 && x.length <= max;
const is = (re: RegExp) => (x: unknown): x is string => typeof x === 'string' && re.test(x);
const tagged = (x: unknown): boolean => { try { canon(x as Canon[]); return true; } catch { return false; } };
function need(ok: boolean, what: string): asserts ok { if (!ok) throw new Error(`proof: ${what}`); }

/** Validate an untrusted proof file before anything reads it. */
export function parseProof(x: unknown): Proof {
  need(obj(x) && x.v === 1, 'not a Saakshi proof (v 1)');
  const { sheet, sth, index, inclusion } = x as O;
  need(obj(sheet) && obj(sheet.ctx), 'sheet.ctx is missing');
  const c = sheet.ctx as O;
  need(str(c.exam) && str(c.shift) && nat(c.attempt) && str(c.cand), 'sheet.ctx must be {exam, shift, attempt, cand}');
  need(str(sheet.form) && str(sheet.pseud, 128), 'sheet.form and sheet.pseud');
  need(Array.isArray(sheet.keys) && sheet.keys.length <= 16 && sheet.keys.every((k) => obj(k) && nat(k.keyEpoch) && is(PUB)(k.pub)), 'sheet.keys must be [{keyEpoch, pub}]');
  need(Array.isArray(sheet.entries) && sheet.entries.length <= 10_000
    && sheet.entries.every((e) => obj(e) && str(e.line, 4096) && is(SALT)(e.salt) && Array.isArray(e.body) && tagged(e.body)), 'sheet.entries must be [{line, salt, body}]');
  const r = sheet.receipt;
  need(r === undefined || (obj(r) && str(r.cell) && nat(r.seq) && is(HEX64)(r.h) && str(r.code, 32) && is(SIG)(r.sig)), 'sheet.receipt');
  need(obj(sth) && obj(sth.sth) && is(SIG)(sth.sig), 'sth must be {sth, sig}');
  const t = sth.sth as O;
  need(str(t.exam) && str(t.shift) && nat(t.size) && is(HEX64)(t.root) && is(HEX64)(t.prevSTH) && nat(t.ts), 'sth fields');
  need(nat(index) && Array.isArray(inclusion) && inclusion.length <= 64 && inclusion.every(is(HEX64)), 'index and inclusion');
  return x as unknown as Proof;
}
