// The seat's key and its binding (plan §3.2). The key is made here, never leaves, and is saved wrapped by the OS keystore (or
// the DEV test keystore) before anything is sent. Enrolment goes seat → relay → cell; the relay never sees the PIN, which travels
// sealed to the cell. With no WAN the binding is provisional: the seat retries until the cell ratifies it.
import { existsSync, readFileSync } from 'node:fs';
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { attestHash, checkWireBind, GATE_METHODS, isPin, makeBindReq, pinRecord, type Bind, type BindReq, type GateMethod, type WireBind } from '@saakshi/core/enrol';
import { nativeBox, newKeyPair, verifier, type KeyPair } from '@saakshi/core/node';
import type { Ctx } from '@saakshi/core/protocol';
import { checkGrant, sealHandoverPin, type HandoverGrant, type HandoverReq } from '@saakshi/core/handover';
import type { Response } from '@saakshi/core/protocol';
import type { BindState, Credit, EnrolResult } from '../shared/ipc.ts';
import type { Restore } from './exam.ts';
import { writeDurable, type Wrapper } from './journal-store.ts';

export type Post = (path: string, body: unknown) => Promise<{ status: number; body: Record<string, unknown> }>;
export function httpPost(relayUrl: string, timeoutMs = 5000, f: typeof fetch = fetch): Post {
  return async (path, body) => {
    const r = await f(new URL(path, relayUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  };
}

export interface IdentityOpts {
  path: string; ctx: Ctx; seatId: string; wrap: Wrapper;
  /** The cell key the signed policy pins: the only key a bind certificate may be signed with. */
  cell: { id: string; pub: Uint8Array };
  post: Post; now?: () => number;
}
interface Move { req: HandoverReq; grant?: HandoverGrant; responses?: Response[]; refused?: string }
interface Saved { priv: string; pub: string; req: BindReq; bind?: WireBind; refused?: string; refusedCode?: string; move?: Move }
const FIELDS = ['exam', 'shift', 'attempt', 'cand', 'seatId', 'pub', 'keyEpoch', 'fromSeq', 'attestHash'] as const;

export class SeatIdentity {
  error = '';
  #o: IdentityOpts;
  #s?: Saved;

  private constructor(o: IdentityOpts) { this.#o = o; }
  static open(o: IdentityOpts): SeatIdentity {
    const id = new SeatIdentity(o);
    if (existsSync(o.path)) id.#s = JSON.parse(o.wrap.decryptString(readFileSync(o.path))) as Saved;
    if (id.#s?.refused) id.error = id.#s.move?.refused ?? id.#s.refused;
    return id;
  }

  get key(): KeyPair | undefined { return this.#s && { priv: hexToBytes(this.#s.priv), pub: hexToBytes(this.#s.pub) }; }
  get bind(): WireBind | undefined { return this.#s?.bind; }
  get state(): BindState {
    const s = this.#s;
    return !s ? 'none' : s.bind ? 'bound' : s.move && !s.move.refused ? 'moving' : s.refused || s.move?.refused ? 'refused' : 'provisional';
  }
  /** Refused because the candidate is bound to another seat: this seat may ask to take over (plan §3.2). */
  get moveable(): boolean { const s = this.#s; return !!s && !s.bind && (s.refusedCode === 'ALREADY_BOUND' || !!s.move); }
  /** 16 hex of this seat's key: the invigilator compares it with the console before approving. */
  get moveKey(): string { return this.#s?.pub.slice(2, 18) ?? ''; }
  get keyEpoch(): number { return this.#s?.move?.grant?.grant.keyEpoch ?? 1; }
  get restore(): Restore | undefined {
    const m = this.#s?.move, g = m?.grant;
    return g && m.responses && { seq: g.grant.fromSeq, head: g.grant.fromHead, activeMs: g.grant.activeMs, responses: m.responses, via: g.via, creditedMs: g.grant.creditedMs };
  }
  get credit(): Credit | undefined {
    const g = this.#s?.move?.grant;
    return g && { ms: g.grant.creditedMs, via: g.via, approvedBy: g.approvedBy, fromSeq: g.grant.fromSeq };
  }

  async enrol(pin: string, gate: { operatorId: string; method: GateMethod }): Promise<EnrolResult> {
    if (this.#s) return { ok: true, bind: await this.retry() };                   // one key per seat and candidate: never a second
    if (!isPin(pin)) return { ok: false, error: 'The PIN must be exactly 6 digits.' };
    const operatorId = gate.operatorId.trim();
    if (!operatorId || operatorId.length > 64) return { ok: false, error: "Enter the gate operator's ID." };
    if (!(GATE_METHODS as readonly string[]).includes(gate.method)) return { ok: false, error: 'Choose how the gate checked identity.' };
    const k = newKeyPair(), c = this.#o.ctx;
    const b: Bind = { ...c, seatId: this.#o.seatId, pub: toHex(k.pub), keyEpoch: 1, fromSeq: 0,
      attestHash: attestHash({ exam: c.exam, shift: c.shift, operatorId, time: (this.#o.now ?? Date.now)(), method: gate.method, cand: c.cand }) };
    // Saved before it is sent: after a crash or a lost answer, the retry sends the same key and gets the same certificate.
    this.#save({ priv: toHex(k.priv), pub: toHex(k.pub), req: makeBindReq(b, this.#o.cell.pub, pinRecord(pin), nativeBox) });
    return { ok: true, bind: await this.retry() };
  }

  /** Send (or resend) the saved request: 200 bound, 202 provisional, 409/400 refused. */
  async retry(): Promise<BindState> {
    const s = this.#s;
    if (!s || s.bind || s.refused) return this.state;
    let r;
    try { r = await this.#o.post('/v1/enrol', s.req); }
    catch (e) { this.error = `the centre server did not answer: ${(e as Error).message}`; return this.state; }
    if (r.status === 200) {
      const wb = r.body.bind as WireBind;
      try { this.#check(wb); } catch (e) { this.error = `the exam server's certificate was rejected: ${(e as Error).message}`; return this.state; }
      this.error = '';
      this.#save({ ...s, bind: wb });
    } else if (r.status === 409 || r.status === 400) {
      this.error = String(r.body.error ?? `refused (${r.status})`);
      this.#save({ ...s, refused: this.error, refusedCode: String(r.body.code ?? '') });
    } else this.error = String(r.body.reason ?? r.body.error ?? `the centre server answered ${r.status}`);
    return this.state;
  }

  /** Ask to continue here (Addendum C.3): the PIN sealed to the cell, a fresh PIN record for this seat, this seat's key. */
  async handover(pin: string): Promise<EnrolResult> {
    const s = this.#s;
    if (!s || s.bind || !this.moveable) return { ok: false, error: 'Check in first; a move is only for a candidate bound to another seat.' };
    if (!isPin(pin)) return { ok: false, error: 'The PIN must be exactly 6 digits.' };
    const c = this.#o.ctx, seatId = this.#o.seatId, cellPub = this.#o.cell.pub;
    const b: Bind = { ...c, seatId, pub: s.pub, keyEpoch: 1, fromSeq: 0, attestHash: s.req.attestHash };
    const req: HandoverReq = { ...c, seatId, pub: s.pub, attestHash: s.req.attestHash, pinBox: makeBindReq(b, cellPub, pinRecord(pin), nativeBox).pinBox,
      proof: { via: 'pin', pin: sealHandoverPin(cellPub, c, seatId, s.pub, pin, nativeBox) } };
    this.#save({ ...s, move: { req } });
    return { ok: true, bind: await this.poll() };
  }

  /** Send (or resend) the move: 200 granted (checked here), 202 waiting for the invigilator, 409/400 refused (the PIN may be retyped). */
  async poll(): Promise<BindState> {
    const s = this.#s, m = s?.move;
    if (!s || !m || m.grant || m.refused) return this.state;
    let r;
    try { r = await this.#o.post('/v1/handover', m.req); }
    catch (e) { this.error = `the centre server did not answer: ${(e as Error).message}`; return this.state; }
    if (r.status === 200) {
      const g = r.body.grant as HandoverGrant;
      try {
        if (g?.bind?.cell !== this.#o.cell.id) throw new Error(`signed by ${g?.bind?.cell}, not ${this.#o.cell.id}`);
        const c = checkGrant(g, { ...this.#o.ctx, seatId: this.#o.seatId, pub: s.pub }, this.#o.cell.pub, hexToBytes(s.priv), verifier, nativeBox);
        this.error = '';
        this.#save({ ...s, bind: g.bind, refused: undefined, move: { ...m, grant: g, responses: c.responses } });
      } catch (e) { this.error = `the move was rejected: ${(e as Error).message}`; }
    } else if (r.status === 202) this.error = String(r.body.error ?? 'waiting for the invigilator to approve the move');
    else { this.error = String(r.body.error ?? `refused (${r.status})`); this.#save({ ...s, move: { ...m, refused: this.error } }); }
    return this.state;
  }

  #check(wb: WireBind): void {
    const got = checkWireBind(wb, this.#o.cell.pub, verifier);
    if (wb.cell !== this.#o.cell.id) throw new Error(`signed by ${wb.cell}, not ${this.#o.cell.id}`);
    for (const f of FIELDS) if (got[f] !== this.#s!.req[f]) throw new Error(`its ${f} is not this seat's`);
  }
  #save(s: Saved): void { writeDurable(this.#o.path, this.#o.wrap.encryptString(JSON.stringify(s))); this.#s = s; }
}
