export { bytesToHex as toHex, hexToBytes, concatBytes as concat, utf8ToBytes as utf8, randomBytes } from '@noble/hashes/utils.js';

export const equal = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

// Crockford base32 for 80-bit codes: 16 symbols + 1 check symbol (value mod 37).
const SYM = '0123456789ABCDEFGHJKMNPQRSTVWXYZ*~$=U';

export function crockford80(bytes: Uint8Array): string {
  if (bytes.length < 10) throw new Error('crockford80 needs at least 10 bytes');
  let n = 0n;
  for (const b of bytes.subarray(0, 10)) n = (n << 8n) | BigInt(b);
  let s = '';
  for (let i = 15; i >= 0; i--) s += SYM[Number((n >> BigInt(5 * i)) & 31n)];
  return s + SYM[Number(n % 37n)];
}

export function decodeCrockford80(code: string): Uint8Array {
  const c = code.toUpperCase().replace(/-/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (c.length !== 17) throw new Error('code must be 17 symbols');
  let n = 0n;
  for (const ch of c.slice(0, 16)) {
    const v = SYM.indexOf(ch);
    if (v < 0 || v > 31) throw new Error(`bad symbol ${ch}`);
    n = (n << 5n) | BigInt(v);
  }
  if (SYM[Number(n % 37n)] !== c[16]) throw new Error('check symbol mismatch');
  const out = new Uint8Array(10);
  for (let i = 9; i >= 0; i--) { out[i] = Number(n & 255n); n >>= 8n; }
  return out;
}
