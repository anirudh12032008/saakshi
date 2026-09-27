// The one verifier: the audit (server) and /verify (browser) both call it. Browser-safe: noble by default.
import { crockford80, decodeCrockford80, hexToBytes, toHex } from './bytes.ts';
import { canon, type Canon } from './canon.ts';
import { checkWireBind, type Bind } from './enrol.ts';
import { checkCellCert, epochAt, type CellCert, type Epoch } from './handover.ts';
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

/** Addendum C.1: the pinned DEV cells, plus every cell whose key certificate the pinned authority signed. */
export function certifiedCells(exam: string, cells: CellCert[] | undefined, trust: Trust, mkVerify: MkVerify = nobleVerifier): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>(Object.entries(trust.cells).map(([id, pub]) => [id, hexToBytes(pub)]));
  const authority = mkVerify(hexToBytes(trust.authority));
  for (const c of cells ?? []) { try { out.set(c.id, checkCellCert(c, exam, authority)); } catch { /* not certified: not trusted */ } }
  return out;
}

export function verifySheet(sheet: ResponseSheet, forms: Forms, trust: Trust, mkVerify: MkVerify = nobleVerifier, cells?: CellCert[]): SheetReport {
  const { ctx } = sheet;
  const checks: Check[] = [];
  const mismatches: Mismatch[] = [];
  const check = (name: CheckName, ok: boolean, detail: string) => { checks.push({ name, ok, detail }); };
  const form = forms[sheet.form];

  // 1. Keys: a bind certificate from a certified cell (C.1), or — DEV records only — a pinned key.
  const cellPubs = certifiedCells(ctx.exam, cells, trust, mkVerify);
  const certified = new Map<number, Bind>();
  const problems: string[] = [];
  for (const wb of sheet.binds ?? []) {
    const pub = cellPubs.get(wb.cell);
    if (!pub) { problems.push(`a bind certificate names ${wb.cell}, whose key the exam authority has not certified`); continue; }
    try {
      const b = checkWireBind(wb, pub, mkVerify);
      if (b.exam !== ctx.exam || b.shift !== ctx.shift || b.attempt !== ctx.attempt || b.cand !== ctx.cand) problems.push(`a bind certificate is for ${b.cand} (${b.exam} ${b.shift}), not ${ctx.cand}`);
      else certified.set(b.keyEpoch, b);
    } catch (e) { problems.push(`a bind certificate: ${(e as Error).message}`); }
  }
  const keyed = new Map<number, Verify>();
  const epochs: Epoch[] = [];
  let pinned = 0;
  for (const k of sheet.keys) {
    const b = certified.get(k.keyEpoch);
    if (b && b.pub === k.pub) { keyed.set(k.keyEpoch, mkVerify(hexToBytes(k.pub))); epochs.push({ keyEpoch: b.keyEpoch, fromSeq: b.fromSeq }); }
    else if (trust.seats[`${ctx.cand}/${k.keyEpoch}`] === k.pub) { keyed.set(k.keyEpoch, mkVerify(hexToBytes(k.pub))); pinned++; }
    else problems.push(`keyEpoch ${k.keyEpoch}: not a key certified for ${ctx.cand}`);
  }
  epochs.sort((a, b) => a.keyEpoch - b.keyEpoch);
  if (epochs.length && !epochs.every((e, i) => e.keyEpoch === i + 1 && (i === 0 ? e.fromSeq === 0 : e.fromSeq > epochs[i - 1].fromSeq)))
    problems.push('the certified key epochs are not 1, 2, … with increasing fromSeq');
  const by = [...new Set((sheet.binds ?? []).map((b) => b.cell))].join(', ');
  check('keys', problems.length === 0 && keyed.size > 0, problems.length ? problems.join('; ') : !keyed.size ? 'no seat keys in the record'
    : `${keyed.size} key epoch(s) for ${ctx.cand}: ${[epochs.length ? `certified by ${by}, whose key the exam authority certified` : '', pinned ? 'pinned DEV keys' : ''].filter(Boolean).join('; ')}`);

  // 2. Chain, one verifier per key epoch; with certified epochs, each seq must be signed by its own epoch (C.4).
  const chain = verifyChainKeyed(ctx, sheet.entries.map((e) => e.line), (e) => keyed.get(e));
  let fault = chain.ok ? undefined : { seq: chain.index + 1, fault: chain.fault, detail: chain.detail };
  if (!fault && epochs.length) {
    for (const e of sheet.entries) {
      const p = parseSignedLine(e.line);
      const want = p.ok ? epochAt(epochs, p.header.seq) : undefined;
      if (p.ok && want !== p.header.keyEpoch) {
        fault = { seq: p.header.seq, fault: 'sig', detail: `signed at keyEpoch ${p.header.keyEpoch}, but seq ${p.header.seq} belongs to keyEpoch ${want ?? 'none'} (Addendum C.4)` };
        break;
      }
    }
  }
  check('chain', !fault, fault ? `entry ${fault.seq}: ${fault.fault} — ${fault.detail}` : `${sheet.entries.length} entries: signatures, sequence and links verify`);

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
      const pub = cellPubs.get(r.cell);
      const ok = !!pub && r.seq === B.seq && r.h === B.h && r.code === receipt.code && mkVerify(pub)(receiptMessage(B), hexToBytes(r.sig));
      check('receipt', ok, ok ? `receipt ${receipt.code}, countersigned by ${r.cell}` : `the cell's receipt (${r.code}) does not match this record, or its countersignature fails`);
    }
  } else check('receipt', false, 'no receipt without a verified submit');

  return { ok: checks.every((c) => c.ok), checks, mismatches, fault, submit, receipt, leaf };
}

/** verifySheet plus the slip code as typed, the STH signature and the leaf's inclusion. */
export function verifyProof(p: Proof, forms: Forms, trust: Trust, typedCode?: string, mkVerify: MkVerify = nobleVerifier): SheetReport {
  const r = verifySheet(p.sheet, forms, trust, mkVerify, p.cells);
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
  const { sheet, sth, index, inclusion, cells } = x as O;
  need(obj(sheet) && obj(sheet.ctx), 'sheet.ctx is missing');
  const c = sheet.ctx as O;
  need(str(c.exam) && str(c.shift) && nat(c.attempt) && str(c.cand), 'sheet.ctx must be {exam, shift, attempt, cand}');
  need(str(sheet.form) && str(sheet.pseud, 128), 'sheet.form and sheet.pseud');
  need(Array.isArray(sheet.keys) && sheet.keys.length <= 16 && sheet.keys.every((k) => obj(k) && nat(k.keyEpoch) && is(PUB)(k.pub)), 'sheet.keys must be [{keyEpoch, pub}]');
  need(Array.isArray(sheet.entries) && sheet.entries.length <= 10_000
    && sheet.entries.every((e) => obj(e) && str(e.line, 4096) && is(SALT)(e.salt) && Array.isArray(e.body) && tagged(e.body)
      && (e.rx === undefined || (Array.isArray(e.rx) && e.rx.length === 2 && e.rx.every(nat)))), 'sheet.entries must be [{line, salt, body, rx?}]');
  const r = sheet.receipt;
  need(r === undefined || (obj(r) && str(r.cell) && nat(r.seq) && is(HEX64)(r.h) && str(r.code, 32) && is(SIG)(r.sig)), 'sheet.receipt');
  const wb = (b: unknown) => obj(b) && str(b.cert, 4096) && is(SIG)(b.sig) && str(b.cell) && typeof b.pinBox === 'string' && b.pinBox.length <= 2048 && /^[0-9a-f]*$/.test(b.pinBox);
  need(sheet.binds === undefined || (Array.isArray(sheet.binds) && sheet.binds.length <= 16 && sheet.binds.every(wb)), 'sheet.binds must be [{cert, sig, cell, pinBox}]');
  need(cells === undefined || (Array.isArray(cells) && cells.length <= 16
    && cells.every((c) => obj(c) && str(c.id) && is(/^[0-9a-f]{16}$/)(c.keyId) && is(PUB)(c.pub) && is(SIG)(c.cert))), 'cells must be [{id, keyId, pub, cert}]');
  need(obj(sth) && obj(sth.sth) && is(SIG)(sth.sig), 'sth must be {sth, sig}');
  const t = sth.sth as O;
  need(str(t.exam) && str(t.shift) && nat(t.size) && is(HEX64)(t.root) && is(HEX64)(t.prevSTH) && nat(t.ts), 'sth fields');
  need(nat(index) && Array.isArray(inclusion) && inclusion.length <= 64 && inclusion.every(is(HEX64)), 'index and inclusion');
  return x as unknown as Proof;
}
