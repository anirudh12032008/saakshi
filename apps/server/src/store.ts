import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import type { Ctx } from '@saakshi/core/protocol';

/** The cell's opened copy of a body — "the record". meta is JSON.stringify(body.meta). */
export interface BodyRow { item: string; state: string; answer: string; meta: string; salt: Uint8Array }
/** The cell's countersigned receipt B (protocol Addendum A.1/A.5). */
export interface ReceiptRow { seq: number; h: string; finalHash: string; pseud: string; attempted: number; answered: number; marked: number; code: string; cell: string; sig: string }
export interface Row extends Ctx { seq: number; keyEpoch: number; h: string; line: string; env: Uint8Array; body?: BodyRow; receipt?: ReceiptRow; rx?: number; cellRx?: number }

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
  db.run(`CREATE TABLE IF NOT EXISTS bodies (
    exam TEXT NOT NULL, shift TEXT NOT NULL, attempt INTEGER NOT NULL, cand TEXT NOT NULL, seq INTEGER NOT NULL,
    item TEXT NOT NULL, state TEXT NOT NULL, answer TEXT NOT NULL, meta TEXT NOT NULL, salt BLOB NOT NULL,
    PRIMARY KEY (exam, shift, attempt, cand, seq)) WITHOUT ROWID`);
  db.run(`CREATE TABLE IF NOT EXISTS receipts (
    exam TEXT NOT NULL, shift TEXT NOT NULL, attempt INTEGER NOT NULL, cand TEXT NOT NULL,
    seq INTEGER NOT NULL, h TEXT NOT NULL, final_hash TEXT NOT NULL, pseud TEXT NOT NULL,
    attempted INTEGER NOT NULL, answered INTEGER NOT NULL, marked INTEGER NOT NULL, code TEXT NOT NULL, cell TEXT NOT NULL, sig TEXT NOT NULL,
    PRIMARY KEY (exam, shift, attempt, cand)) WITHOUT ROWID`);
  db.run(`CREATE TABLE IF NOT EXISTS evidence (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, code TEXT NOT NULL,
    stream TEXT NOT NULL, seq INTEGER NOT NULL, reason TEXT NOT NULL, line TEXT NOT NULL)`);
  db.run('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  // Stage 4 (Addendum C.7, C.4/C.8): rxWall stamps on entries; the envelope of ORPHANED/LATE evidence. Added in place to older DBs.
  const cols = (t: string) => (db.query(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
  if (!cols('entries').includes('rx_wall')) db.run('ALTER TABLE entries ADD COLUMN rx_wall INTEGER NOT NULL DEFAULT 0');
  if (!cols('entries').includes('cell_rx')) db.run('ALTER TABLE entries ADD COLUMN cell_rx INTEGER NOT NULL DEFAULT 0');
  if (!cols('evidence').includes('env')) db.run('ALTER TABLE evidence ADD COLUMN env BLOB');
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
    const ins = db.query('INSERT INTO entries (exam, shift, attempt, cand, seq, key_epoch, h, line, env, rx_wall, cell_rx) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const insBody = db.query('INSERT INTO bodies (exam, shift, attempt, cand, seq, item, state, answer, meta, salt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const insReceipt = db.query(`INSERT OR REPLACE INTO receipts (exam, shift, attempt, cand, seq, h, final_hash, pseud, attempted, answered, marked, code, cell, sig)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    this.#insert = db.transaction((rows: Row[]) => {
      for (const r of rows) {
        ins.run(r.exam, r.shift, r.attempt, r.cand, r.seq, r.keyEpoch, r.h, r.line, r.env, r.rx ?? 0, r.cellRx ?? 0);
        const b = r.body;
        if (b) insBody.run(r.exam, r.shift, r.attempt, r.cand, r.seq, b.item, b.state, b.answer, b.meta, b.salt);
        const x = r.receipt;
        if (x) insReceipt.run(r.exam, r.shift, r.attempt, r.cand, x.seq, x.h, x.finalHash, x.pseud, x.attempted, x.answered, x.marked, x.code, x.cell, x.sig);
      }
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
