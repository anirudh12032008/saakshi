import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes, toHex } from '../src/bytes.ts';
import { canon } from '../src/canon.ts';
import type { KeysFile } from '../src/dev.ts';
import { msg } from '../src/enrol.ts';
import {
  faceArray, findingFromMeta, findingMeta, findingsHash, integrityOf, openThumb, readinessArray, sealThumb, verdictOf, provArray,
  INTEGRITY_DEFAULT, type IntegrityFinding,
} from '../src/integrity.ts';
import { nativeBox, signer, verifier } from '../src/node.ts';
import { nobleVerifier } from '../src/sig.ts';
import { openPolicy, signPolicy, type Policy } from '../src/policy.ts';
import { parseSignedFace, parseSignedReadiness } from '../src/wire.ts';

const json = (f: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/${f}`, import.meta.url), 'utf8'));
const keys = json('keys.json') as KeysFile;
const D = json('vectors/protocol-v1-addendum-d.json');
const seatPub = hexToBytes(keys.seats[0].pub), authPub = hexToBytes(keys.authority.pub);
const ctx = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001' };

test('D.3 readiness and D.4 face flag: canonical text recomputes; signatures verify natively and with noble', () => {
  assert.equal(canon(readinessArray(D.readiness.in)), D.readiness.text);
  assert.equal(findingsHash(D.readiness.in.findings), D.readiness.findingsHash);
  assert.equal(canon(faceArray(D.face.in)), D.face.text);
  for (const v of [verifier(seatPub), nobleVerifier(seatPub)]) {
    assert.equal(v(msg(readinessArray(D.readiness.in)), hexToBytes(D.readiness.sig)), true);
    assert.equal(v(msg(faceArray(D.face.in)), hexToBytes(D.face.sig)), true);
  }
});

test('D.4 thumbnail box opens only with the review key and for its own (cand, at)', () => {
  const review = hexToBytes(D.reviewKey.priv);
  assert.deepEqual(toHex(openThumb(review, ctx, D.face.in.at, D.face.in.thumb)), D.face.jpeg);
  assert.equal(toHex(sha256(hexToBytes(D.face.in.thumb))), D.face.in.thumbHash);
  assert.throws(() => openThumb(review, ctx, D.face.in.at + 1, D.face.in.thumb));
  assert.throws(() => openThumb(review, { ...ctx, cand: 'C0002' }, D.face.in.at, D.face.in.thumb));
  const box = sealThumb(hexToBytes(D.reviewKey.pub), ctx, 5, new Uint8Array([1, 2, 3]), nativeBox);
  assert.deepEqual([...openThumb(review, ctx, 5, box)], [1, 2, 3]);
});

test('D.2 finding meta round-trips; test-mode meta is read leniently; verdict orders block > review > amber > green', () => {
  const f: IntegrityFinding = { code: 'blocklisted', level: 'block', detail: 'AnyDesk (pid 4242)', names: ['AnyDesk'] };
  assert.deepEqual(findingFromMeta(findingMeta(f)), f);
  assert.deepEqual(findingFromMeta(['test-mode', 'journal key not in the OS keychain']), { code: 'test-mode', level: 'info', detail: 'journal key not in the OS keychain', names: [] });
  assert.equal(findingFromMeta([]), undefined);
  const mk = (level: IntegrityFinding['level']): IntegrityFinding => ({ code: 'disk', level, detail: '', names: [] });
  assert.equal(verdictOf([]), 'green');
  assert.equal(verdictOf([mk('info')]), 'green');
  assert.equal(verdictOf([mk('amber'), mk('info')]), 'amber');
  assert.equal(verdictOf([mk('amber'), mk('review')]), 'review');
  assert.equal(verdictOf([mk('review'), mk('block'), mk('amber')]), 'block');
});

test('D.5 provenance array; D.1 policy with integrity signs and opens; a missing section is defaulted, not silent', () => {
  assert.deepEqual(provArray(), []);
  assert.deepEqual(provArray({ moves: 3, pathPx: 120, clicks: 1, keys: 0, untrusted: 0, lastMoveMs: 40 }), ['prov', 3, 120, 1, 0, 0, 40]);
  const p: Policy = { ...D.policy.in };
  const sp = signPolicy(p, signer({ priv: hexToBytes(keys.authority.priv), pub: authPub }));
  const opened = openPolicy(sp, verifier(authPub), { exam: p.exam, shift: p.shift });
  assert.deepEqual(opened.integrity, p.integrity);
  assert.equal(opened.roster.C0002.acc?.faces, 2);
  assert.equal(integrityOf(undefined).defaulted, true);
  assert.equal(integrityOf(undefined).pol.probeMs, INTEGRITY_DEFAULT.probeMs);
  const bad = signPolicy({ ...p, integrity: { ...p.integrity!, reviewPub: 'nope' } }, signer({ priv: hexToBytes(keys.authority.priv), pub: authPub }));
  assert.throws(() => openPolicy(bad, verifier(authPub), { exam: p.exam, shift: p.shift }), /integrity/);
});

test('wire parsers accept the vectors and refuse oversize or malformed input', () => {
  assert.equal(parseSignedReadiness({ r: D.readiness.in, sig: D.readiness.sig }).r.verdict, 'block');
  assert.equal(parseSignedFace({ f: D.face.in, sig: D.face.sig }).f.code, 'face-none');
  assert.throws(() => parseSignedReadiness({ r: { ...D.readiness.in, verdict: 'purple' }, sig: D.readiness.sig }));
  assert.throws(() => parseSignedFace({ f: { ...D.face.in, thumb: 'ab'.repeat(30_000) }, sig: D.face.sig }));
  assert.throws(() => parseSignedFace({ f: { ...D.face.in, code: 'face-who' }, sig: D.face.sig }));
});
