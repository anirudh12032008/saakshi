import crypto from 'node:crypto';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { concat, randomBytes, utf8 } from './bytes.ts';
import { canon, parseCanon } from './canon.ts';
import { V, bodyArray, bodyCommit, bodyFromArray, type Body, type Ctx } from './protocol.ts';
import { toLowS, type Verify } from './sig.ts';

export interface KeyPair { priv: Uint8Array; pub: Uint8Array }

const b64u = (b: Uint8Array): string => Buffer.from(b).toString('base64url');
const xy = (pub: Uint8Array) => {
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('pub must be a 65-byte uncompressed P-256 point');
  return { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) };
};

export function newKeyPair(): KeyPair {
  const e = crypto.createECDH('prime256v1');
  e.generateKeys();
  const priv = new Uint8Array(32);
  const p = e.getPrivateKey();
  priv.set(p, 32 - p.length); // left-pad: Node drops leading zero bytes
  return { priv, pub: new Uint8Array(e.getPublicKey()) };
}

export function signer(k: KeyPair): (m: Uint8Array) => Uint8Array {
  const key = crypto.createPrivateKey({ key: { ...xy(k.pub), d: b64u(k.priv) }, format: 'jwk' });
  return (m) => toLowS(new Uint8Array(crypto.sign('sha256', m, { key, dsaEncoding: 'ieee-p1363' })));
}

export function verifier(pub: Uint8Array): Verify {
  const key = crypto.createPublicKey({ key: xy(pub), format: 'jwk' });
  return (m, sig) => {
    if (sig.length !== 64) return false;
    try { return crypto.verify('sha256', m, { key, dsaEncoding: 'ieee-p1363' }, sig); } catch { return false; }
  };
}

export function ecdh(priv: Uint8Array, peerPub: Uint8Array): Uint8Array {
  const e = crypto.createECDH('prime256v1');
  e.setPrivateKey(priv);
  return new Uint8Array(e.computeSecret(peerPub));
}

export interface BodyCtx extends Ctx { seq: number }

const bodyKey = (shared: Uint8Array, c: BodyCtx): Uint8Array =>
  hkdf(sha256, shared, undefined, utf8(canon(['saakshi-body', V, c.exam, c.shift, c.attempt, c.cand, c.seq])), 32);

/** Envelope = ephPub(65) ‖ nonce(24) ‖ XChaCha20-Poly1305(salt(16) ‖ canon(body)). Only the cell can open it; the relay cannot. */
export function sealBody(cellPub: Uint8Array, c: BodyCtx, salt: Uint8Array, body: Body): { envelope: Uint8Array; bodyCommit: string } {
  const commit = bodyCommit(salt, body);
  const eph = newKeyPair();
  const nonce = randomBytes(24);
  const ct = xchacha20poly1305(bodyKey(ecdh(eph.priv, cellPub), c), nonce).encrypt(concat(salt, utf8(canon(bodyArray(body)))));
  return { envelope: concat(eph.pub, nonce, ct), bodyCommit: commit };
}

export function openBody(cellPriv: Uint8Array, c: BodyCtx, envelope: Uint8Array, expectCommit: string): { salt: Uint8Array; body: Body } {
  if (envelope.length < 65 + 24 + 16 + 16) throw new Error('envelope too short');
  const key = bodyKey(ecdh(cellPriv, envelope.subarray(0, 65)), c);
  const pt = xchacha20poly1305(key, envelope.subarray(65, 89)).decrypt(envelope.subarray(89));
  const salt = pt.slice(0, 16);
  const body = bodyFromArray(parseCanon(new TextDecoder('utf-8', { fatal: true }).decode(pt.subarray(16))));
  if (bodyCommit(salt, body) !== expectCommit) throw new Error('bodyCommit mismatch');
  return { salt, body };
}
