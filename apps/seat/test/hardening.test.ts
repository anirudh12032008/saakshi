import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E2E, launchRefusal, windowMode, argValue } from '../src/main/hardening.ts';

test('the release build refuses debugging switches; the e2e build allows them', () => {
  for (const a of ['--remote-debugging-port=9222', '--remote-debugging-port', '--inspect', '--inspect=9229', '--inspect-brk=0', '--remote-debugging-pipe'])
    assert.match(launchRefusal(['Saakshi', a], false) ?? '', /refused/, a);
  assert.equal(launchRefusal(['Saakshi', '--remote-debugging-port=0', '--inspect=0'], true), undefined);
  assert.equal(launchRefusal(['Saakshi', '--test-mode', '--no-camera'], false), undefined);
});

test('window mode: exam seats are kiosk + fullscreen + on top; content protection only on Windows; devtools only in e2e', () => {
  assert.deepEqual(windowMode({ test: false, e2e: false, platform: 'win32' }), { kiosk: true, fullscreen: true, alwaysOnTop: true, contentProtection: true, devtools: false });
  assert.equal(windowMode({ test: false, e2e: false, platform: 'darwin' }).contentProtection, false);
  assert.deepEqual(windowMode({ test: true, e2e: true, platform: 'darwin' }), { kiosk: false, fullscreen: false, alwaysOnTop: false, contentProtection: false, devtools: true });
  assert.equal(E2E, false);
});

test('argValue reads --flag value and --flag=value (Windows needs the = form for URLs)', () => {
  const argv = ['exe', '--relay=http://127.0.0.1:7070', '--cand', 'C0001'];
  assert.equal(argValue(argv, '--relay'), 'http://127.0.0.1:7070');
  assert.equal(argValue(argv, '--cand'), 'C0001');
  assert.equal(argValue(argv, '--seat'), undefined);
});
