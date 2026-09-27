import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileWrapper, pickWrapper, testMode, type SafeStorage } from '../src/main/keystore.ts';

const safe = (available: boolean): SafeStorage => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from('OS' + s), decryptString: (b) => b.toString().slice(2),
});

test('test mode is --test-mode or SAAKSHI_TEST_MODE=1, and nothing else', () => {
  assert.equal(testMode(['electron', '.'], {}), false);
  assert.equal(testMode(['electron', '.', '--test-mode'], {}), true);
  assert.equal(testMode(['electron', '.'], { SAAKSHI_TEST_MODE: '1' }), true);
  assert.equal(testMode(['electron', '.'], { SAAKSHI_TEST_MODE: 'true' }), false);
});

test('without the flag the behaviour is unchanged: safeStorage is used and required, and no key file appears', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-ks-'));
  try {
    const s = safe(true);
    assert.equal(pickWrapper({ testMode: false, safeStorage: s, dir }), s);
    assert.throws(() => pickWrapper({ testMode: false, safeStorage: safe(false), dir }), /safeStorage/);
    assert.equal(existsSync(join(dir, 'test-mode.key')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('test mode: a file key, created once, that survives a restart; safeStorage is never touched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-ks-'));
  try {
    const untouchable = { ...safe(true), isEncryptionAvailable: (): boolean => { throw new Error('safeStorage must not be touched in test mode'); } };
    const w = pickWrapper({ testMode: true, safeStorage: untouchable, dir });
    const box = w.encryptString('session-key-hex');
    assert.equal(box.toString('latin1').includes('session-key-hex'), false);
    const key = readFileSync(join(dir, 'test-mode.key'));
    assert.equal(key.length, 32);
    assert.equal(fileWrapper(dir).decryptString(box), 'session-key-hex');       // a restart reads the same key
    assert.deepEqual(readFileSync(join(dir, 'test-mode.key')), key);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
