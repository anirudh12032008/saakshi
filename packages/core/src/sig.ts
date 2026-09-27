import { p256 } from '@noble/curves/nist.js';
import { hexToBytes, toHex } from './bytes.ts';

export const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
export type Verify = (m: Uint8Array, sig: Uint8Array) => boolean;

const sOf = (sig: Uint8Array): bigint => BigInt('0x' + toHex(sig.subarray(32)));
export const isLowS = (sig: Uint8Array): boolean => sOf(sig) <= P256_N / 2n;

/** Normalise an IEEE-P1363 signature to low-S (noble v2 has no normalizeS). */
export function toLowS(sig: Uint8Array): Uint8Array {
  if (sig.length !== 64) throw new Error('sig must be 64 bytes (IEEE-P1363)');
  if (isLowS(sig)) return sig;
  const out = sig.slice();
  out.set(hexToBytes((P256_N - sOf(sig)).toString(16).padStart(64, '0')), 32);
  return out;
}

/** Browser-safe verifier; m is domain ‖ canonical JSON, hashed with SHA-256 inside. */
export function nobleVerifier(pub: Uint8Array): Verify {
  return (m, sig) => {
    try { return sig.length === 64 && p256.verify(sig, m, pub, { prehash: true, lowS: false }); } catch { return false; }
  };
}
