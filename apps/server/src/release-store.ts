// Paper releases held by a cell or a relay (plan §3.3): control's signed release, or — on a relay — its own unwrap on the
// phoned-code path. Each one passes the seat's own check (kc_f against the signed manifest) before it is kept or passed on.
import type { Database, Statement } from 'bun:sqlite';
import { checkRelease, type Manifest, type ReleaseMsg } from '@saakshi/core/paper';
import type { Verify } from '@saakshi/core/sig';

export interface ReleaseStoreOpts {
  exam: string; shift: string; manifest: Manifest; authority: Verify;
  /** Cell: only control's signed release is accepted. */
  requireSig?: boolean;
  /** Called once per release that is new (or that upgrades an offline-code release to control's signed one). */
  onNew?: (r: ReleaseMsg) => void;
}

export class ReleaseStore {
  #o: ReleaseStoreOpts;
  #m = new Map<string, ReleaseMsg>();
  #set: Statement;

  constructor(db: Database, o: ReleaseStoreOpts) {
    this.#o = o;
    db.run('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    this.#set = db.query('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v');
    for (const r of db.query('SELECT v FROM meta WHERE k LIKE ?').all(`release/${o.exam}/${o.shift}/%`) as { v: string }[]) {
      const m = JSON.parse(r.v) as ReleaseMsg;
      this.#m.set(m.form, m);
    }
  }

  list(): ReleaseMsg[] { return [...this.#m.values()].sort((a, b) => (a.form < b.form ? -1 : 1)); }
  /** Signed releases held — what a relay reports as SyncReq.have. */
  count(): number { return [...this.#m.values()].filter((r) => r.sig).length; }

  accept(r: ReleaseMsg): string | undefined {
    if (this.#o.requireSig && !r.sig) return 'only a release signed by control is accepted here';
    const c = checkRelease(r, this.#o.manifest, r.form, this.#o.authority);
    if (!c.ok) return c.error;
    const cur = this.#m.get(r.form);
    if (cur && (cur.sig || !r.sig)) return undefined;                              // same key (kc_f): nothing new
    const kcf = this.#o.manifest.forms.find((f) => f.form === r.form)!.kcf;
    const clean: ReleaseMsg = { exam: r.exam, shift: r.shift, form: r.form, kcf, ts: r.ts, key: r.key, sig: r.sig, via: r.via };
    this.#set.run(`release/${r.exam}/${r.shift}/${r.form}`, JSON.stringify(clean));
    this.#m.set(r.form, clean);
    this.#o.onNew?.(clean);
    return undefined;
  }
}
