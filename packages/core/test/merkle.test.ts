import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hexToBytes, toHex, utf8 } from '../src/bytes.ts';
import { canon } from '../src/canon.ts';
import { D, hashTagged, leafArray } from '../src/protocol.ts';
import { consistencyProof, inclusionProof, leafHash, rootOf, verifyConsistency, verifyInclusion } from '../src/merkle.ts';

// RFC 6962 / certificate-transparency test leaves and roots (re-derived independently in Python).
const LEAVES = ['', '00', '10', '2021', '3031', '40414243', '5051525354555657', '606162636465666768696a6b6c6d6e6f'].map(hexToBytes);
const ROOTS = [
  '6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d',
  'fac54203e7cc696cf0dfcb42c92a1d9dbaf70ad9e621f4bd8d98662f00e3c125',
  'aeb6bcfe274b70a14fb067a5e5578264db0fa9b51af5e0ba159158f329e06e77',
  'd37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7',
  '4e3bbb1f7b478dcfe71fb631631519a3bca12c9aefca1612bfce4c13a86264d4',
  '76e67dadbcdf1e10e1b74ddc608abd2f98dfb16fbce75277b5232a127f2087ef',
  'ddb89be403809e325750d3d263cd78929c2942b7942a34b77e122c9594a74c8c',
  '5dc9da79a70659a9ad559cb701ded9a2ab9d823aad2f4960cfe370eff4604328',
];

test('roots match the RFC 6962 vectors', () => {
  assert.equal(toHex(rootOf([])), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  const hs = LEAVES.map(leafHash);
  ROOTS.forEach((r, i) => assert.equal(toHex(rootOf(hs.slice(0, i + 1))), r, `size ${i + 1}`));
});

const tree = (n: number) => Array.from({ length: n }, (_, i) => leafHash(utf8(`leaf-${i}`)));

test('every inclusion proof up to size 33 verifies; tampering fails', () => {
  for (let n = 1; n <= 33; n++) {
    const hs = tree(n), root = rootOf(hs);
    for (let m = 0; m < n; m++) {
      const p = inclusionProof(hs, m);
      assert.ok(verifyInclusion(m, n, hs[m], p, root), `n=${n} m=${m}`);
      assert.ok(!verifyInclusion(m, n, leafHash(utf8('x')), p, root));
      if (n > 1) assert.ok(!verifyInclusion((m + 1) % n, n, hs[m], p, root));
      if (p.length) assert.ok(!verifyInclusion(m, n, hs[m], p.slice(0, -1), root));
    }
    assert.ok(!verifyInclusion(n, n, hs[0], [], root));
  }
});

test('every consistency proof up to size 33 verifies; tampering fails', () => {
  for (let n = 1; n <= 33; n++) {
    const hs = tree(n), r2 = rootOf(hs);
    for (let m = 1; m <= n; m++) {
      const r1 = rootOf(hs.slice(0, m)), p = consistencyProof(hs, m);
      assert.ok(verifyConsistency(m, n, p, r1, r2), `m=${m} n=${n}`);
      if (m < n) {
        assert.ok(!verifyConsistency(m, n, [], r1, r2), 'empty proof');
        assert.ok(!verifyConsistency(m, n, p, leafHash(utf8('x')), r2), 'wrong old root');
        const bad = p.map((x) => x.slice()); bad[0][0] ^= 1;
        assert.ok(!verifyConsistency(m, n, bad, r1, r2), 'flipped proof');
      }
    }
  }
});

test('protocol leaves hash with domain 0x00 over the canonical leaf array', () => {
  const x = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, pseud: '7'.repeat(64), h: 'a'.repeat(64), finalHash: 'b'.repeat(64) };
  assert.deepEqual(leafHash(utf8(canon(leafArray(x)))), hashTagged(D.LEAF, leafArray(x)));
});
