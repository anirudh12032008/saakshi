import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { resolveAppPath } from '../src/main/app-path.ts';

const root = join('/opt', 'seat', 'renderer');

test('resolves files inside the renderer dir', () => {
  assert.equal(resolveAppPath(root, '/'), join(root, 'index.html'));
  assert.equal(resolveAppPath(root, '/index.html'), join(root, 'index.html'));
  assert.equal(resolveAppPath(root, '/mediapipe/wasm/vision_wasm_internal.wasm'), join(root, 'mediapipe', 'wasm', 'vision_wasm_internal.wasm'));
});

test('never escapes the renderer dir', () => {
  for (const p of ['/../secret', '/%2e%2e/secret', '/..%2fsecret', '/a/../../secret', '/%E0%A4', '/x%00y'])
    assert.equal(resolveAppPath(root, p), null, p);
});
