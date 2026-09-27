import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import type { Ctx } from '@saakshi/core/protocol';

export interface Row extends Ctx { seq: number; keyEpoch: number; h: string; line: string; env: Uint8Array }

/** Open (or create) a node DB. `fresh` = the file did not exist, which puts a cell into REBUILDING. */
export function openDb(path: string): { db: Database; fresh: boolean } {
  const fresh = !existsSync(path);
  const db = new Database(path, { create: true, strict: true });
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA synchronous = FULL');
  db.run('PRAGMA fullfsync = ON');            // macOS: F_FULLFSYNC on commit
  db.run('PRAGMA checkpoint_fullfsync = ON');
  db.run(`CREATE TABLE IF NOT EXISTS entries (
    exam TEXT NOT NULL, shift TEXT NOT NULL, attempt INTEGER NOT NULL, cand TEXT NOT NULL, seq INTEGER NOT NULL,
    key_epoch INTEGER NOT NULL, h TEXT NOT NULL, line TEXT NOT NULL, env BLOB NOT NULL,
    PRIMARY KEY (exam, shift, attempt, cand, seq)) WITHOUT ROWID`);
  db.run(`CREATE TABLE IF NOT EXISTS evidence (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, code TEXT NOT NULL,
    stream TEXT NOT NULL, seq INTEGER NOT NULL, reason TEXT NOT NULL, line TEXT NOT NULL)`);
  db.run('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  return { db, fresh };
}

export function pragmas(db: Database): { journal_mode: string; synchronous: number; fullfsync: number; checkpoint_fullfsync: number } {
  const one = <T>(name: string): T => Object.values(db.query(`PRAGMA ${name}`).get() as Record<string, T>)[0];
  return { journal_mode: one<string>('journal_mode'), synchronous: one<number>('synchronous'), fullfsync: one<number>('fullfsync'), checkpoint_fullfsync: one<number>('checkpoint_fullfsync') };
}

interface Waiter { resolve: () => void; reject: (e: unknown) => void }

/** Single-writer group commit: one transaction every `ms` or every `max` rows; waiters resolve only after COMMIT. */
export class GroupCommit {
  transactions = 0;
  #rows: Row[] = [];
  #waiters: Waiter[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;
  #insert: (rows: Row[]) => void;
  #onCommit: (rows: Row[]) => void;
  #ms: number;
  #max: number;
  #onFatal: (e: unknown) => void;

  constructor(db: Database, onCommit: (rows: Row[]) => void, opts: { ms?: number; max?: number; onFatal?: (e: unknown) => void } = {}) {
    const ins = db.query('INSERT INTO entries (exam, shift, attempt, cand, seq, key_epoch, h, line, env) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    this.#insert = db.transaction((rows: Row[]) => {
      for (const r of rows) ins.run(r.exam, r.shift, r.attempt, r.cand, r.seq, r.keyEpoch, r.h, r.line, r.env);
    });
    this.#onCommit = onCommit;
    this.#ms = opts.ms ?? 10;
    this.#max = opts.max ?? 500;
    // ponytail: crash-only — in-memory heads are ahead of disk after a failed COMMIT, so restart and reload.
    this.#onFatal = opts.onFatal ?? ((e) => { console.error('group commit failed; exiting so the chain reloads from disk', e); process.exit(1); });
  }

  add(rows: Row[]): Promise<void> {
    this.#rows.push(...rows);
    const p = new Promise<void>((resolve, reject) => this.#waiters.push({ resolve, reject }));
    if (this.#rows.length >= this.#max) this.flush();
    else this.#timer ??= setTimeout(() => this.flush(), this.#ms);
    return p;
  }

  flush(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const rows = this.#rows, waiters = this.#waiters;
    this.#rows = [];
    this.#waiters = [];
    if (rows.length) {
      try { this.#insert(rows); this.transactions++; }
      catch (e) { for (const w of waiters) w.reject(e); this.#onFatal(e); return; }
      this.#onCommit(rows);
    }
    for (const w of waiters) w.resolve();
  }
}
