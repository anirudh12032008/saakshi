// Golden-vector self-test that /verify runs in the browser on every load (noble only).
import { ackMessage } from './ack.ts';
import { hexToBytes, toHex } from './bytes.ts';
import { canon, parseCanon } from './canon.ts';
import { bindArray, msg } from './enrol.ts';
import { grantArray, handoverArray, respHash } from './handover.ts';
import { verifyChain } from './journal.ts';
import { leafHashHex, pseudOf, receiptMessage, responsesOf, sthId, sthMessage } from './log.ts';
import { consistencyProof, inclusionProof, rootOf, verifyConsistency, verifyInclusion } from './merkle.ts';
import { D, bodyCommit, bodyFromArray, counts, entryHash, finalHash, genesisPrev, headerArray, kcf, receiptCode, tagged } from './protocol.ts';
import { nobleVerifier } from './sig.ts';
import { verifyProof } from './verify.ts';

// The vector files are plain JSON; their shapes are pinned by packages/core/test/{vectors,addendum}.test.ts.
type J = any;

export function goldenSelfTest(V: J, A: J, C?: J): { pass: number; fail: string[] } {
  let pass = 0;
  const fail: string[] = [];
  const t = (name: string, fn: () => boolean) => {
    try { if (fn()) pass++; else fail.push(name); } catch (e) { fail.push(`${name}: ${(e as Error).message}`); }
  };
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  for (const [v, s] of V.canon.accept) t(`canon accepts ${s}`, () => canon(v) === s && canon(parseCanon(s)) === s);
  for (const s of V.canon.reject) t(`canon rejects ${s}`, () => { try { parseCanon(s); return false; } catch { return true; } });
  t('genesis prev', () => genesisPrev(V.ctx) === V.genesisPrev);
  t('body commit', () => bodyCommit(hexToBytes(V.body.salt), V.body.body) === V.body.bodyCommit);
  t('entry message', () => toHex(tagged(D.ENTRY, headerArray(V.entry.header))) === V.entry.m);
  t('entry hash', () => toHex(entryHash(V.entry.header)) === V.entry.h);
  t('finalHash', () => finalHash(V.ctx, V.final.form, V.final.responses) === V.final.finalHash);
  t('counts', () => same(counts(V.final.responses), { attempted: V.receipt.in.attempted, answered: V.receipt.in.answered, marked: V.receipt.in.marked }));
  t('receipt code', () => receiptCode(V.receipt.in) === V.receipt.code);
  t('key commitment', () => kcf(hexToBytes(V.kcf.K)) === V.kcf.kc);
  const L: Uint8Array[] = V.merkle.leafHashes.map(hexToBytes);
  t('merkle roots', () => V.merkle.roots.every((r: string, i: number) => toHex(rootOf(L.slice(0, i + 1))) === r));
  t('inclusion proofs', () => V.merkle.inclusion.every(({ size, index, proof }: J) =>
    same(inclusionProof(L.slice(0, size), index).map(toHex), proof) && verifyInclusion(index, size, L[index], proof.map(hexToBytes), hexToBytes(V.merkle.roots[size - 1]))));
  t('consistency proofs', () => V.merkle.consistency.every(({ size1, size2, proof }: J) =>
    same(consistencyProof(L.slice(0, size2), size1).map(toHex), proof)
    && verifyConsistency(size1, size2, proof.map(hexToBytes), hexToBytes(V.merkle.roots[size1 - 1]), hexToBytes(V.merkle.roots[size2 - 1]))));
  const seat = nobleVerifier(hexToBytes(V.signatures.pub));
  t('16 seat signatures (noble)', () => V.signatures.items.every(({ m, sig }: J) => seat(hexToBytes(m), hexToBytes(sig))));
  t('signed chain (noble)', () => verifyChain(V.ctx, V.chain.lines, seat).ok);

  t('A.4 pseudonym', () => pseudOf(hexToBytes(A.pseud.key), A.pseud.roll) === A.pseud.pseud);
  t('A.5 replayed responses', () => {
    const rs = responsesOf(A.responses.form, A.responses.bodies.map(bodyFromArray));
    return same(rs, A.responses.responses) && finalHash(A.ctx, A.responses.formName, rs) === A.responses.finalHash && same(counts(rs), A.responses.counts);
  });
  t('A.2 STH message and id', () => new TextDecoder().decode(sthMessage(A.sth.sth)) === A.sth.canon && sthId(A.sth.sth) === A.sth.id);
  t('A.1 STH signature (noble)', () => nobleVerifier(hexToBytes(A.sth.pub))(sthMessage(A.sth.sth), hexToBytes(A.sth.sig)));
  t('A.1 receipt countersignature (noble)', () => nobleVerifier(hexToBytes(A.receiptSig.pub))(receiptMessage(A.receiptSig.in), hexToBytes(A.receiptSig.sig)));
  t('A.1 ack signature (noble)', () => nobleVerifier(hexToBytes(A.ack.pub))(ackMessage(A.ack.in), hexToBytes(A.ack.sig)));
  t('A.3 leaf hash', () => leafHashHex(A.leaf.in) === A.leaf.hash);
  if (C) {
    const cellV = nobleVerifier(hexToBytes(C.keys.cell));
    t('C.2 handover claim (noble)', () => canon(handoverArray(C.claim.in)) === C.claim.text && nobleVerifier(hexToBytes(C.keys.oldSeat))(msg(handoverArray(C.claim.in)), hexToBytes(C.claim.sig)));
    t('C.4 keyEpoch 2 bind (noble)', () => canon(bindArray(C.bind2.in)) === C.bind2.text && cellV(msg(bindArray(C.bind2.in)), hexToBytes(C.bind2.sig)));
    t('C.5 grant (noble)', () => canon(grantArray(C.grant.in)) === C.grant.text && cellV(msg(grantArray(C.grant.in)), hexToBytes(C.grant.sig)));
    t('C.5 respHash', () => respHash(C.responses.rows) === C.responses.hash);
    t('C.1 a moved candidate\'s proof verifies with only the authority key', () => verifyProof(C.proof, C.forms, { authority: C.keys.authority, cells: {}, seats: {} }).ok);
  }
  return { pass, fail };
}
