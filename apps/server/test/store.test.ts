import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GroupCommit, openDb, pragmas, type Row } from '../src/store.ts';

let dir: string, path: string, db: Database;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'saakshi-store-')); path = join(dir, 's.db'); db = openDb(path).db; });
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

const row = (seq: number): Row => ({ exam: 'E', shift: 'S', attempt: 1, cand: 'C', seq, keyEpoch: 1, h: 'a'.repeat(64), line: `l${seq}`, env: new Uint8Array([seq % 256]) });
const count = (): number => { const d = new Database(path); try { return (d.query('SELECT count(*) AS n FROM entries').get() as { n: number }).n; } finally { d.close(); } };

test('durability pragmas apply: WAL, synchronous=FULL, fullfsync on macOS', () => {
  const p = pragmas(db);
  expect(p.journal_mode).toBe('wal');
  expect(p.synchronous).toBe(2);
  if (process.platform === 'darwin') { expect(p.fullfsync).toBe(1); expect(p.checkpoint_fullfsync).toBe(1); }
});

test('openDb reports a fresh file once', () => {
  const a = openDb(join(dir, 'new.db')); a.db.close();
  const b = openDb(join(dir, 'new.db')); b.db.close(); // close both: Windows can't delete a dir holding open DBs
  expect(a.fresh).toBe(true);
  expect(b.fresh).toBe(false);
});

test('rows are invisible to other readers until the group commits; the promise resolves only after COMMIT', async () => {
  let committed = 0;
  const gc = new GroupCommit(db, (rows) => { committed += rows.length; });
  const done = gc.add([row(1), row(2), row(3)]);
  expect(count()).toBe(0);
  expect(committed).toBe(0);
  await done;
  expect(count()).toBe(3);
  expect(committed).toBe(3);
});

test('500 pending rows flush at once, without waiting for the timer', () => {
  const gc = new GroupCommit(db, () => {}, { ms: 10_000, max: 500 });
  void gc.add(Array.from({ length: 500 }, (_, i) => row(i + 1)));
  expect(count()).toBe(500);
  expect(gc.transactions).toBe(1);
});

test('concurrent adds inside one 10 ms window share one transaction', async () => {
  const gc = new GroupCommit(db, () => {});
  await Promise.all(Array.from({ length: 20 }, (_, i) => gc.add([row(i + 1)])));
  expect(gc.transactions).toBe(1);
  expect(count()).toBe(20);
});

test('a failed commit rejects its waiters and calls onFatal (crash-only)', async () => {
  let fatal: unknown;
  const gc = new GroupCommit(db, () => {}, { ms: 1, onFatal: (e) => { fatal = e; } });
  await gc.add([row(1)]);
  await expect(gc.add([row(1)])).rejects.toThrow();
  expect(fatal).toBeDefined();
});
