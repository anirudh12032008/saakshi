import { test } from 'node:test';
import assert from 'node:assert/strict';

test('macOS: lists on-screen windows and returns excluded owners with pids (darwin only)', { skip: process.platform !== 'darwin' }, async () => {
  const { captureExcludedWindowsMac } = await import('../src/main/probes-mac.ts');
  const r = captureExcludedWindowsMac();
  assert.ok(Number.isInteger(r.visibleWindows) && r.visibleWindows >= 0);
  for (const w of r.excluded) { assert.ok(w.pid > 0 && w.pid !== process.pid); assert.equal(w.sharing, 0); assert.equal(typeof w.owner, 'string'); }
});
