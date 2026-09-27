// Sealed box to a P-256 public key (protocol Addendum B.4). Browser-safe: noble by default; node.ts exports nativeBox, which
// produces the same bytes with native ECDH (≈30× faster), for seat main, the server and the swarm.
import { p256 } from '@noble/curves/nist.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concat, randomBytes, utf8 } from './bytes.ts';
import { canon, type Canon } from './canon.ts';

export interface BoxKeys { newKey(): { priv: Uint8Array; pub: Uint8Array }; ecdh(priv: Uint8Array, pub: Uint8Array): Uint8Array }
export const nobleBox: BoxKeys = {
  newKey: () => { const priv = p256.utils.randomSecretKey(); return { priv, pub: p256.getPublicKey(priv, false) }; },
  ecdh: (priv, pub) => p256.getSharedSecret(priv, pub).slice(1),          // the x-coordinate, as node's ECDH returns it
};
export const BOX_MIN = 65 + 24 + 16;
const boxKey = (shared: Uint8Array, info: Canon[]): Uint8Array => hkdf(sha256, shared, undefined, utf8(canon(info)), 32);

/** ephPub(65) ‖ nonce(24) ‖ XChaCha20-Poly1305(HKDF(ECDH x, info), nonce)(pt). */
export function sealBox(pub: Uint8Array, info: Canon[], pt: Uint8Array, k: BoxKeys = nobleBox): Uint8Array {
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('box: the recipient must be a 65-byte uncompressed P-256 key');
  const eph = k.newKey(), nonce = randomBytes(24);
  return concat(eph.pub, nonce, xchacha20poly1305(boxKey(k.ecdh(eph.priv, pub), info), nonce).encrypt(pt));
}

export function openBox(priv: Uint8Array, info: Canon[], env: Uint8Array, k: BoxKeys = nobleBox): Uint8Array {
  if (env.length < BOX_MIN) throw new Error('box: too short');
  return xchacha20poly1305(boxKey(k.ecdh(priv, env.subarray(0, 65)), info), env.subarray(65, 89)).decrypt(env.subarray(89));
}
