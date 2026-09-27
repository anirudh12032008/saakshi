import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { combine, split } from 'shamir-secret-sharing';
import { concat, crockford80, decodeCrockford80, randomBytes, utf8 } from './bytes.ts';
import { canon } from './canon.ts';

export interface CentreCtx { exam: string; shift: string; centre: string }
export interface Bundle { kF1: Uint8Array; kF2: Uint8Array; L: Uint8Array }

const need32 = (...ks: Uint8Array[]) => { for (const k of ks) if (k.length !== 32) throw new Error('keys must be 32 bytes'); };

/** 80-bit per-centre, per-shift code: 16 Crockford symbols + check symbol. */
export const newOfflineCode = (): string => crockford80(randomBytes(10));

const wrapKey = (code: string, c: CentreCtx): Uint8Array =>
  hkdf(sha256, decodeCrockford80(code), undefined, utf8(canon(['saakshi-offline', c.exam, c.shift, c.centre])), 32);

/** W_c = nonce(24) ‖ XChaCha20-Poly1305(HKDF(code, info), kF1 ‖ kF2). */
export function wrapForCentre(code: string, c: CentreCtx, kF1: Uint8Array, kF2: Uint8Array): Uint8Array {
  need32(kF1, kF2);
  const nonce = randomBytes(24);
  return concat(nonce, xchacha20poly1305(wrapKey(code, c), nonce).encrypt(concat(kF1, kF2)));
}

export function unwrapForCentre(code: string, c: CentreCtx, wrap: Uint8Array): { kF1: Uint8Array; kF2: Uint8Array } {
  const pt = xchacha20poly1305(wrapKey(code, c), wrap.subarray(0, 24)).decrypt(wrap.subarray(24));
  return { kF1: pt.slice(0, 32), kF2: pt.slice(32, 64) };
}

/** Shamir 2-of-3 over kF1 ‖ kF2 ‖ L — one share each for NTA, NIC and the independent observer. */
export async function splitBundle(b: Bundle): Promise<Uint8Array[]> {
  need32(b.kF1, b.kF2, b.L);
  return split(concat(b.kF1, b.kF2, b.L), 3, 2);
}

export async function combineBundle(shares: Uint8Array[]): Promise<Bundle> {
  if (shares.length < 2) throw new Error('need 2 of 3 shares');
  const s = await combine(shares);
  if (s.length !== 96) throw new Error('bundle must be 96 bytes');
  return { kF1: s.slice(0, 32), kF2: s.slice(32, 64), L: s.slice(64) };
}
