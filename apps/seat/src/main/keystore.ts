// DEV test keystore. Every pack:mac re-signs the app ad hoc, so macOS asks "Saakshi wants to use Saakshi Safe Storage" at launch
// and safeStorage blocks until a human clicks. In test mode (--test-mode or SAAKSHI_TEST_MODE=1) the journal session key is
// wrapped with a local file key instead. It is never silent: the seat shows a permanent banner, and ExamSession journals an
// integrity entry at unlock so the cell and the audit see a test-mode seat.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes } from '@saakshi/core/bytes';
import { writeDurable, type Wrapper } from './journal-store.ts';

export const TEST_MODE_NOTE = 'journal key not in the OS keychain';
export const testMode = (argv: readonly string[], env: Record<string, string | undefined>): boolean =>
  argv.includes('--test-mode') || env.SAAKSHI_TEST_MODE === '1';

/** A Wrapper backed by a random 32-byte key in <dir>/test-mode.key. DEV only: whoever can read that file can read the journal key. */
export function fileWrapper(dir: string): Wrapper {
  const path = join(dir, 'test-mode.key');
  if (!existsSync(path)) { mkdirSync(dir, { recursive: true }); writeDurable(path, randomBytes(32)); }
  const key = new Uint8Array(readFileSync(path));
  if (key.length !== 32) throw new Error(`${path} must hold exactly 32 bytes`);
  return {
    encryptString: (s) => { const n = randomBytes(24); return Buffer.concat([n, xchacha20poly1305(key, n).encrypt(Buffer.from(s, 'utf8'))]); },
    decryptString: (b) => Buffer.from(xchacha20poly1305(key, b.subarray(0, 24)).decrypt(b.subarray(24))).toString('utf8'),
  };
}

export interface SafeStorage extends Wrapper { isEncryptionAvailable(): boolean }
/** Test mode → the file key. Otherwise safeStorage, which must be available (unchanged Stage 1 behaviour). */
export function pickWrapper(o: { testMode: boolean; safeStorage: SafeStorage; dir: string }): Wrapper {
  if (o.testMode) return fileWrapper(o.dir);
  if (!o.safeStorage.isEncryptionAvailable()) throw new Error('OS key storage (safeStorage) is unavailable, so the journal cannot be encrypted.');
  return o.safeStorage;
}
