// Seat bindings (plan §3.2, protocol Addendum B.2): the cell signs a bind certificate at enrolment, and relays and cells trust a
// seat key only through one. A binding is self-proving, so a relay can replay it to a rebuilding cell. The PIN record stays
// sealed to the cell key (which lives outside this DB) even at rest. ponytail: one exam-shift, attempt 1, per node.
import type { Database, Statement } from 'bun:sqlite';
import { hexToBytes, toHex, utf8 } from '@saakshi/core/bytes';
import { canon } from '@saakshi/core/canon';
import { bindArray, checkWireBind, isP256Pub, openPinBox, type Bind, type BindReq, type WireBind } from '@saakshi/core/enrol';
import { nativeBox, signer, verifier } from '@saakshi/core/node';

export type EnrolCode = 'NOT_REGISTERED' | 'ALREADY_BOUND' | 'UNSUPPORTED' | 'BAD';
export type EnrolResult = { ok: true; bind: WireBind } | { ok: false; code: EnrolCode; error: string };
export interface BindingsOpts { exam: string; shift: string; cell: { id: string; pub: Uint8Array; priv?: Uint8Array } }
interface Row { cand: string; key_epoch: number; pub: string; cert: string; sig: string; cell: string; pin_box: string }
const wire = (r: Row): WireBind => ({ cert: r.cert, sig: r.sig, cell: r.cell, pinBox: r.pin_box });

export class Bindings {
  #o: BindingsOpts;
  #db: Database;
  #rows = new Map<string, Row>();
  #keys = new Map<string, Uint8Array>();
  #insert: Statement;
  #sign?: (m: Uint8Array) => Uint8Array;

  constructor(db: Database, o: BindingsOpts) {
    this.#o = o;
    this.#db = db;
    db.run(`CREATE TABLE IF NOT EXISTS bindings (exam TEXT NOT NULL, shift TEXT NOT NULL, attempt INTEGER NOT NULL, cand TEXT NOT NULL,
      key_epoch INTEGER NOT NULL, pub TEXT NOT NULL, cert TEXT NOT NULL, sig TEXT NOT NULL, cell TEXT NOT NULL, pin_box TEXT NOT NULL,
      PRIMARY KEY (exam, shift, attempt, cand, key_epoch)) WITHOUT ROWID`);
    this.#insert = db.query('INSERT OR IGNORE INTO bindings (exam, shift, attempt, cand, key_epoch, pub, cert, sig, cell, pin_box) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of db.query('SELECT cand, key_epoch, pub, cert, sig, cell, pin_box FROM bindings WHERE exam = ? AND shift = ? AND attempt = 1').all(o.exam, o.shift) as Row[]) this.#put(r);
    if (o.cell.priv) this.#sign = signer({ priv: o.cell.priv, pub: o.cell.pub });
  }

  /** The key a relay or cell trusts for (cand, keyEpoch): only one this cell certified. */
  seatKey = (cand: string, keyEpoch: number): Uint8Array | undefined => this.#keys.get(`${cand}/${keyEpoch}`);
  get(cand: string, keyEpoch: number): WireBind | undefined { const r = this.#rows.get(`${cand}/${keyEpoch}`); return r && wire(r); }
  all(): WireBind[] { return [...this.#rows.values()].map(wire); }
  /** Candidates bound at keyEpoch 1: the reconciliation's "checked in". */
  cands(): string[] { return [...this.#rows.values()].filter((r) => r.key_epoch === 1).map((r) => r.cand).sort(); }
  tx<T>(fn: () => T): T { return this.#db.transaction(fn)(); }

  /** Relay and cell: store a binding this cell signed. Idempotent; a second key for the same (cand, keyEpoch) is refused. */
  accept(wb: WireBind): string | undefined {
    let b: Bind;
    try { b = checkWireBind(wb, this.#o.cell.pub, verifier); } catch (e) { return (e as Error).message; }
    if (wb.cell !== this.#o.cell.id) return `bind signed by ${wb.cell}, not ${this.#o.cell.id}`;
    if (b.exam !== this.#o.exam || b.shift !== this.#o.shift || b.attempt !== 1) return 'bind for another exam, shift or attempt';
    if (this.#o.cell.priv) { try { openPinBox(this.#o.cell.priv, { ...b, pinBox: wb.pinBox }, nativeBox); } catch { return 'the PIN box does not open with this cell key'; } }
    const cur = this.#rows.get(`${b.cand}/${b.keyEpoch}`);
    if (cur) return cur.pub === b.pub ? undefined : `${b.cand} is already bound to another key at keyEpoch ${b.keyEpoch}`;
    this.#store({ cand: b.cand, key_epoch: b.keyEpoch, pub: b.pub, cert: wb.cert, sig: wb.sig, cell: wb.cell, pin_box: wb.pinBox });
    return undefined;
  }
  acceptAll(wbs: WireBind[]): (string | undefined)[] { return this.tx(() => wbs.map((wb) => this.accept(wb))); }

  /** Cell only: enrol a seat at keyEpoch 1. The same request again returns the same certificate. */
  enrol(req: BindReq, registered: boolean): EnrolResult {
    const no = (code: EnrolCode, error: string): EnrolResult => ({ ok: false, code, error });
    if (!this.#sign || !this.#o.cell.priv) throw new Error('enrol runs on the cell');
    if (req.exam !== this.#o.exam || req.shift !== this.#o.shift || req.attempt !== 1) return no('BAD', `this cell enrols ${this.#o.exam} ${this.#o.shift} attempt 1 only`);
    if (!registered) return no('NOT_REGISTERED', `${req.cand} is not registered at a centre this cell serves`);
    if (req.keyEpoch !== 1 || req.fromSeq !== 0) return no('UNSUPPORTED', 'moving to another seat (handover) arrives in Stage 4');
    if (!isP256Pub(req.pub)) return no('BAD', 'pub is not a P-256 public key');
    try { openPinBox(this.#o.cell.priv, req, nativeBox); } catch { return no('BAD', 'the PIN box does not open with this cell key'); }
    const cur = this.#rows.get(`${req.cand}/1`);
    if (cur) return cur.pub === req.pub ? { ok: true, bind: wire(cur) } : no('ALREADY_BOUND', `${req.cand} is already bound to another seat — call the invigilator`);
    const b: Bind = { exam: req.exam, shift: req.shift, attempt: 1, cand: req.cand, seatId: req.seatId, pub: req.pub, keyEpoch: 1, fromSeq: 0, attestHash: req.attestHash };
    const cert = canon(bindArray(b));
    const row: Row = { cand: b.cand, key_epoch: 1, pub: b.pub, cert, sig: toHex(this.#sign(utf8(cert))), cell: this.#o.cell.id, pin_box: req.pinBox };
    this.#store(row);
    return { ok: true, bind: wire(row) };
  }

  #put(r: Row): void { const k = `${r.cand}/${r.key_epoch}`; this.#rows.set(k, r); this.#keys.set(k, hexToBytes(r.pub)); }
  #store(r: Row): void { this.#insert.run(this.#o.exam, this.#o.shift, r.cand, r.key_epoch, r.pub, r.cert, r.sig, r.cell, r.pin_box); this.#put(r); }
}
