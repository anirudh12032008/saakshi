import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocklistHits, parsePs, parseTasklistCsv, probe, run } from '../src/main/probe-parse.ts';

test('parses tasklist /FO CSV /NH output', () => {
  const csv = '"System Idle Process","0","Services","0","8 K"\r\n"AnyDesk.exe","4242","Console","1","12,345 K"\r\n';
  assert.deepEqual(parseTasklistCsv(csv), [{ name: 'System Idle Process', pid: 0 }, { name: 'AnyDesk.exe', pid: 4242 }]);
});

test('parses ps -axo pid=,comm= output (paths with spaces)', () => {
  const out = '    1 /sbin/launchd\n  812 /System/Library/CoreServices/RemoteManagement/screensharingd.bundle/Contents/MacOS/screensharingd\n 9001 /Applications/OBS.app/Contents/MacOS/OBS Studio\n';
  assert.deepEqual(parsePs(out).map((p) => p.pid), [1, 812, 9001]);
  assert.equal(parsePs(out)[2].name, '/Applications/OBS.app/Contents/MacOS/OBS Studio');
});

test('blocklist matches by lowercase basename without .exe', () => {
  assert.deepEqual(blocklistHits(['C:\\x\\AnyDesk.exe', '/usr/bin/zsh', 'obs64.exe', '/Applications/TeamViewer.app/Contents/MacOS/TeamViewer']), ['anydesk', 'obs64', 'teamviewer']);
});

test('a hanging probe returns unknown after its timeout', async () => {
  const t0 = Date.now();
  const r = await probe(() => run(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], 200));
  assert.equal(r.status, 'unknown');
  assert.ok(Date.now() - t0 < 3000);
});
