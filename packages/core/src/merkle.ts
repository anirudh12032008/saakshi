import { sha256 } from '@noble/hashes/sha2.js';
import { concat, equal } from './bytes.ts';

export const leafHash = (data: Uint8Array): Uint8Array => sha256(concat(Uint8Array.of(0x00), data));
const node = (l: Uint8Array, r: Uint8Array): Uint8Array => sha256(concat(Uint8Array.of(0x01), l, r));
const half = (x: number): number => Math.floor(x / 2);
const odd = (x: number): boolean => x % 2 === 1;
/** Largest power of two strictly less than n (n >= 2). */
const split = (n: number): number => { let k = 1; while (k * 2 < n) k *= 2; return k; };
const isPow2 = (x: number): boolean => { let p = 1; while (p < x) p *= 2; return p === x; };

// ponytail: proofs recompute subtree roots from all leaf hashes (O(n) per proof). Fine for one shift; cache subtree roots if STH issuance gets slow.
export function rootOf(hs: Uint8Array[]): Uint8Array {
  if (hs.length === 0) return sha256(new Uint8Array());
  if (hs.length === 1) return hs[0];
  const k = split(hs.length);
  return node(rootOf(hs.slice(0, k)), rootOf(hs.slice(k)));
}

export function inclusionProof(hs: Uint8Array[], m: number): Uint8Array[] {
  if (m < 0 || m >= hs.length) throw new RangeError('leaf index out of range');
  if (hs.length === 1) return [];
  const k = split(hs.length);
  return m < k
    ? [...inclusionProof(hs.slice(0, k), m), rootOf(hs.slice(k))]
    : [...inclusionProof(hs.slice(k), m - k), rootOf(hs.slice(0, k))];
}

export function verifyInclusion(index: number, size: number, leaf: Uint8Array, proof: Uint8Array[], root: Uint8Array): boolean {
  if (index >= size) return false;
  let fn = index, sn = size - 1, r = leaf;
  for (const p of proof) {
    if (sn === 0) return false;
    if (odd(fn) || fn === sn) {
      r = node(p, r);
      while (!odd(fn) && fn !== 0) { fn = half(fn); sn = half(sn); }
    } else {
      r = node(r, p);
    }
    fn = half(fn); sn = half(sn);
  }
  return sn === 0 && equal(r, root);
}

export function consistencyProof(hs: Uint8Array[], m: number): Uint8Array[] {
  if (m < 1 || m > hs.length) throw new RangeError('old size out of range');
  return subproof(hs, m, true);
}

function subproof(hs: Uint8Array[], m: number, b: boolean): Uint8Array[] {
  const n = hs.length;
  if (m === n) return b ? [] : [rootOf(hs)];
  const k = split(n);
  return m <= k
    ? [...subproof(hs.slice(0, k), m, b), rootOf(hs.slice(k))]
    : [...subproof(hs.slice(k), m - k, false), rootOf(hs.slice(0, k))];
}

export function verifyConsistency(size1: number, size2: number, proof: Uint8Array[], root1: Uint8Array, root2: Uint8Array): boolean {
  if (size1 < 1 || size1 > size2) return false;
  if (size1 === size2) return proof.length === 0 && equal(root1, root2);
  if (proof.length === 0) return false;
  const path = isPow2(size1) ? [root1, ...proof] : proof;
  let fn = size1 - 1, sn = size2 - 1;
  while (odd(fn)) { fn = half(fn); sn = half(sn); }
  let fr = path[0], sr = path[0];
  for (const c of path.slice(1)) {
    if (sn === 0) return false;
    if (odd(fn) || fn === sn) {
      fr = node(c, fr); sr = node(c, sr);
      while (!odd(fn) && fn !== 0) { fn = half(fn); sn = half(sn); }
    } else {
      sr = node(sr, c);
    }
    fn = half(fn); sn = half(sn);
  }
  return sn === 0 && equal(fr, root1) && equal(sr, root2);
}
