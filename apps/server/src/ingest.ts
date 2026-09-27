import type { Database } from 'bun:sqlite';
import { ackMessage } from '@saakshi/core/ack';
import type { WireBind } from '@saakshi/core/enrol';
import type { ReleaseMsg } from '@saakshi/core/paper';
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { parseSignedLine } from '@saakshi/core/journal';
import { openBody, signer, verifier } from '@saakshi/core/node';
import { receiptMessage, responsesOf } from '@saakshi/core/log';
import { counts, entryHash, finalHash, genesisPrev, receiptCode, type Body, type Ctx, type Header, type State } from '@saakshi/core/protocol';
import type { Forms } from '@saakshi/core/sheet';
import type { Verify } from '@saakshi/core/sig';
import {
  fromB64, streamKey, toB64,
  type NodeState, type Rejection, type RejectCode, type StreamStatus, type StreamView, type SyncReq, type SyncRes, type WireAck, type WireEntry,
} from '@saakshi/core/wire';
import { GroupCommit, type ReceiptRow, type Row } from './store.ts';

export type Mode = 'cell' | 'relay';

export interface IngestOpts {
  mode: Mode;
  db: Database;
  /** The DB file did not exist: a cell starts REBUILDING. */
  fresh: boolean;
  /** Which seat key signs (cand, keyEpoch). DEV: devSeatKey(keys). */
  seatKey: (cand: string, keyEpoch: number) => Uint8Array | undefined;
  /** relay: the cell public key (to check its acks); cell: its key pair (read from the keys file, never the DB). */
  cell: { pub: Uint8Array; priv?: Uint8Array };
  /** cell: how many relays must send `done` before REBUILDING ends (default 1). */
  rebuildRelays?: number;
  onView?: (v: StreamView) => void;
  onState?: (s: NodeState) => void;
  now?: () => number;
  commit?: { ms?: number; max?: number };
  /** cell: the form item lists (forms.json without durationMin). Without them every submit is rejected. */
  forms?: Forms;
  /** cell: the form the roster assigns to a candidate (DEV: devForm). */
  formOf?: (cand: string) => string | undefined;
  /** cell: the candidate's pseudonym for receipts (DEV: devPseud). */
  pseud?: (cand: string) => string;
  /** cell: the id stamped on countersigned receipts. Default 'cell-1'. */
  cellId?: string;
  /** Stage 3: store the cell-signed bindings a request carries, before its entries are checked. One error (or undefined) per bind. */
  acceptBinds?: (binds: WireBind[]) => (string | undefined)[];
  /** Stage 3, cell: the releases it holds; sent in the response when the relay has fewer (SyncReq.have). */
  releases?: () => ReleaseMsg[];
}

export interface Ingest {
  readonly mode: Mode;
  state(): NodeState;
  sync(req: SyncReq): Promise<SyncRes | 'REBUILDING'>;
  views(): StreamView[];
  /** Committed entries after `after`, oldest first (what the relay forwards). */
  entriesAfter(c: Ctx, after: number, limit: number): WireEntry[];
  /** relay: record what the cell reported; keeps the ack only if it verifies over our own h. */
  setCellStatus(st: StreamStatus): boolean;
  /** relay: the cell is REBUILDING — forget its heads and acks. */
  resetCell(): void;
  close(): void;
}

/** bodies[seq-1] = the opened body (cell only); submitSeq = seq of the submit, 0 while the chain is open. */
interface Stream { ctx: Ctx; hs: string[]; durable: number; epoch: number; ack?: WireAck; cellHead: number; senderHead: number; seenAt: number; bodies: Body[]; submitSeq: number; active: number; activeEpoch: number }

const ENV_MIN = 65 + 24 + 16 + 16;
const SIG_HEX = /^[0-9a-f]{128}$/;
const ctxOf = (x: Ctx): Ctx => ({ exam: x.exam, shift: x.shift, attempt: x.attempt, cand: x.cand });

export function createIngest(o: IngestOpts): Ingest {
  const { db, mode } = o;
  const now = o.now ?? Date.now;
  if (mode === 'cell' && !o.cell.priv) throw new Error('cell mode needs the cell private key');
  const cellSign = mode === 'cell' ? signer({ priv: o.cell.priv!, pub: o.cell.pub }) : undefined;
  const cellVerify = verifier(o.cell.pub);
  const streams = new Map<string, Stream>();
  const verifiers = new Map<string, Verify>();
  const getMeta = db.query('SELECT v FROM meta WHERE k = ?');
  const setMeta = db.query('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v');
  const addEvidence = db.query('INSERT INTO evidence (at, code, stream, seq, reason, line) VALUES (?, ?, ?, ?, ?, ?)');
  const readAfter = db.query('SELECT line, env FROM entries WHERE exam = ? AND shift = ? AND attempt = ? AND cand = ? AND seq > ? ORDER BY seq LIMIT ?');
  let closed = false;

  let state: NodeState = mode === 'cell' && (o.fresh || (getMeta.get('state') as { v: string } | null)?.v === 'REBUILDING') ? 'REBUILDING' : 'LIVE';
  if (state === 'REBUILDING') setMeta.run('state', 'REBUILDING');
  let dones = 0;

  const get = (c: Ctx): Stream => {
    const k = streamKey(c);
    let s = streams.get(k);
    if (!s) streams.set(k, (s = { ctx: ctxOf(c), hs: [], durable: 0, epoch: 0, cellHead: mode === 'cell' ? 0 : -1, senderHead: -1, seenAt: 0, bodies: [], submitSeq: 0, active: 0, activeEpoch: 0 }));
    return s;
  };
  const view = (s: Stream): StreamView => ({ ...s.ctx, head: s.durable, cellHead: mode === 'cell' ? s.durable : s.cellHead, senderHead: s.senderHead, seenAt: s.seenAt });
  const emit = (s: Stream) => o.onView?.(view(s));

  // ponytail: every h stays in memory (~100 B per entry); page from the DB if one node outgrows RAM.
  for (const r of db.query('SELECT exam, shift, attempt, cand, seq, h, key_epoch FROM entries ORDER BY exam, shift, attempt, cand, seq').all() as (Ctx & { seq: number; h: string; key_epoch: number })[]) {
    const s = get(r);
    s.hs.push(r.h);
    s.durable = r.seq;
    s.epoch = r.key_epoch;
  }
  if (mode === 'cell') {
    // ponytail: replay state is rebuilt from the bodies table, so a post-startup DB edit only affects later submits; the audit catches edits regardless.
    for (const r of db.query('SELECT exam, shift, attempt, cand, seq, item, state, answer, meta FROM bodies ORDER BY exam, shift, attempt, cand, seq').all() as (Ctx & { seq: number; item: string; state: string; answer: string; meta: string })[])
      get(r).bodies[r.seq - 1] = { item: r.item, state: r.state as State | '', answer: r.answer, meta: JSON.parse(r.meta) };
  }
  const lineAt = db.query('SELECT line FROM entries WHERE exam = ? AND shift = ? AND attempt = ? AND cand = ? AND seq = ?');
  for (const s of streams.values()) {
    const row = s.durable ? (lineAt.get(s.ctx.exam, s.ctx.shift, s.ctx.attempt, s.ctx.cand, s.durable) as { line: string } | null) : null;
    const p = row ? parseSignedLine(row.line) : undefined;
    if (p?.ok) { s.active = p.header.activeMs; s.activeEpoch = p.header.keyEpoch; if (p.header.kind === 'submit') s.submitSeq = s.durable; }
  }
  const cellId = o.cellId ?? 'cell-1';

  /** Protocol Addendum A.5: replay the committed bodies; the submit's finalHash must match. Returns the countersigned receipt, or why not. */
  function checkSubmit(s: Stream, hd: Header, h: string, body: Body): ReceiptRow | string {
    const [form, fh] = body.meta;
    if (body.item || body.state || body.answer || body.meta.length !== 2 || typeof form !== 'string' || typeof fh !== 'string')
      return 'submit body must be ["body","","","",[form, finalHash]]';
    const want = o.formOf?.(hd.cand);
    const items = o.forms?.[form];
    if (!items || form !== want) return `submit names form ${form}; the roster says ${want ?? 'nothing'}`;
    if (!o.pseud) return 'this cell has no pseudonym key';
    for (let i = 0; i < hd.seq - 1; i++) if (!s.bodies[i]) return `cannot replay: no body for seq ${i + 1}`;
    let responses;
    try { responses = responsesOf(items, s.bodies.slice(0, hd.seq - 1)); } catch (e) { return `submit: ${(e as Error).message}`; }
    if (finalHash(hd, form, responses) !== fh) return 'submit: finalHash does not match the replayed chain';
    const B = { exam: hd.exam, shift: hd.shift, attempt: hd.attempt, pseud: o.pseud(hd.cand), seq: hd.seq, h, finalHash: fh, ...counts(responses) };
    return { seq: B.seq, h, finalHash: fh, pseud: B.pseud, attempted: B.attempted, answered: B.answered, marked: B.marked, code: receiptCode(B), cell: cellId, sig: toHex(cellSign!(receiptMessage(B))) };
  }

  const commit = new GroupCommit(db, (rows) => {
    const touched = new Set<Stream>();
    for (const r of rows) { const s = get(r); s.durable = r.seq; s.epoch = r.keyEpoch; touched.add(s); }
    for (const s of touched) emit(s);
  }, o.commit);

  const verifierFor = (cand: string, keyEpoch: number): Verify | undefined => {
    const k = `${cand}\u0000${keyEpoch}`;
    let v = verifiers.get(k);
    if (!v) {
      const pub = o.seatKey(cand, keyEpoch);
      if (!pub) return undefined;
      verifiers.set(k, (v = verifier(pub)));
    }
    return v;
  };

  /** cell: sign lazily, once per new durable head. relay: the last verified cell ack. */
  const ackOf = (s: Stream): WireAck | undefined => {
    if (!cellSign) return s.ack;
    if (s.durable === 0) return undefined;
    if (s.ack?.seq !== s.durable) {
      const a = { ...s.ctx, keyEpoch: s.epoch, seq: s.durable, h: s.hs[s.durable - 1] };
      s.ack = { keyEpoch: a.keyEpoch, seq: a.seq, h: a.h, sig: toHex(cellSign(ackMessage(a))) };
    }
    return s.ack;
  };

  async function sync(req: SyncReq): Promise<SyncRes | 'REBUILDING'> {
    if (state === 'REBUILDING' && !req.replay) return 'REBUILDING';
    const t = now();
    const touched = new Map<Stream, boolean>();            // stream → a gap was seen (NEED)
    const rejected: Rejection[] = [];
    const evidence: [RejectCode, string, number, string, string][] = [];
    const rows: Row[] = [];

    for (const hl of req.streams) {
      const s = get(hl);
      const changed = s.senderHead !== hl.head || t - s.seenAt > 5_000;
      s.senderHead = hl.head;
      s.seenAt = t;
      if (changed) emit(s);
      touched.set(s, touched.get(s) ?? false);
    }

    // Stage 3: bindings first, so the entries below are checked against the keys they certify. A bad bind is evidence, not an error.
    if (req.binds?.length && o.acceptBinds) {
      o.acceptBinds(req.binds).forEach((err, i) => { if (err) evidence.push(['BAD_SUBMISSION', '', 0, `bind: ${err}`, req.binds![i].cert]); });
    }

    // Synchronous from here to commit.add: no other request interleaves with this validation.
    req.entries.forEach((e, index) => {
      const reject = (code: RejectCode, reason: string, key = '', seq = 0) => { rejected.push({ index, code, reason }); evidence.push([code, key, seq, reason, e.line]); };
      const p = parseSignedLine(e.line);
      if (!p.ok) return reject('BAD_SUBMISSION', `${p.fault}: ${p.detail}`);
      const hd = p.header, key = streamKey(hd), s = get(hd);
      touched.set(s, touched.get(s) ?? false);
      const bad = (reason: string) => reject('BAD_SUBMISSION', reason, key, hd.seq);
      // 1. signature under the key for this keyEpoch — an invalid entry is never a FORK
      const v = verifierFor(hd.cand, hd.keyEpoch);
      if (!v) return bad(`no seat key for ${hd.cand} at keyEpoch ${hd.keyEpoch}`);
      if (!v(p.m, p.sig)) return bad('signature does not verify');
      if (hd.seq < 1) return bad('seq must start at 1');
      if (s.submitSeq && hd.seq > s.submitSeq) return bad(`entry after submit (the chain closed at seq ${s.submitSeq})`);
      const head = s.hs.length;
      if (hd.seq > head + 1) { touched.set(s, true); return; }            // gap → NEED{cand, head}
      // 2. prev against the stored chain
      const h = toHex(entryHash(hd));
      if (hd.prev !== (hd.seq === 1 ? genesisPrev(hd) : s.hs[hd.seq - 2])) return reject('FORK', `seq ${hd.seq}: prev does not match the stored chain`, key, hd.seq);
      // 3. fork or duplicate
      if (hd.seq <= head) return s.hs[hd.seq - 1] === h ? undefined : reject('FORK', `seq ${hd.seq} already holds a different signed entry`, key, hd.seq);
      // Addendum B.8: active time never runs backwards within a key epoch (plan §3.6).
      if (hd.keyEpoch === s.activeEpoch && hd.activeMs < s.active) return bad(`activeMs went backwards (${s.active} → ${hd.activeMs}) within keyEpoch ${hd.keyEpoch}`);
      let env: Uint8Array;
      try { env = fromB64(e.env); } catch { return bad('envelope is not base64'); }
      if (env.length < ENV_MIN) return bad('envelope too short');
      let body: Body | undefined, rec: Row['body'], receipt: ReceiptRow | undefined;
      if (mode === 'cell') {
        let opened: { salt: Uint8Array; body: Body };
        try { opened = openBody(o.cell.priv!, { ...hd }, env, hd.bodyCommit); } catch (err) { return bad(`body: ${(err as Error).message}`); }
        body = opened.body;
        if (body.item && o.forms && !o.forms[o.formOf?.(hd.cand) ?? '']?.includes(body.item)) return bad(`item ${body.item} is not in ${hd.cand}'s form`);
        if (hd.kind === 'submit') {
          const r = checkSubmit(s, hd, h, body);
          if (typeof r === 'string') return bad(r);
          receipt = r;
        }
        rec = { item: body.item, state: body.state, answer: body.answer, meta: JSON.stringify(body.meta), salt: opened.salt };
      }
      s.hs.push(h);
      s.active = hd.activeMs; s.activeEpoch = hd.keyEpoch;
      if (body) s.bodies[hd.seq - 1] = body;
      if (hd.kind === 'submit') s.submitSeq = hd.seq;
      rows.push({ ...ctxOf(hd), seq: hd.seq, keyEpoch: hd.keyEpoch, h, line: e.line, env, body: rec, receipt });
    });

    if (evidence.length) db.transaction(() => { for (const ev of evidence) addEvidence.run(t, ...ev); })();
    if (rows.length) await commit.add(rows);
    if (req.replay && req.done && state === 'REBUILDING' && ++dones >= (o.rebuildRelays ?? 1)) {
      state = 'LIVE';
      setMeta.run('state', 'LIVE');
      o.onState?.(state);
    }
    const rel = o.releases?.() ?? [];
    return {
      streams: [...touched].map(([s, need]) => ({ ...s.ctx, head: s.durable, headH: s.durable ? s.hs[s.durable - 1] : '', need, ack: ackOf(s) })),
      rejected,
      ...(rel.length > (req.have ?? 0) ? { releases: rel } : {}),
    };
  }

  return {
    mode,
    state: () => state,
    sync,
    views: () => [...streams.values()].map(view),
    entriesAfter: (c, after, limit) =>
      (readAfter.all(c.exam, c.shift, c.attempt, c.cand, after, limit) as { line: string; env: Uint8Array }[]).map((r) => ({ line: r.line, env: toB64(r.env) })),
    setCellStatus(st) {
      const s = streams.get(streamKey(st));
      if (!s || mode !== 'relay') return false;
      s.cellHead = st.head;
      const a = st.ack;
      if (a && a.seq === st.head && a.seq >= 1 && s.hs[a.seq - 1] === a.h && SIG_HEX.test(a.sig)
        && cellVerify(ackMessage({ ...s.ctx, keyEpoch: a.keyEpoch, seq: a.seq, h: a.h }), hexToBytes(a.sig))) {
        s.ack = { keyEpoch: a.keyEpoch, seq: a.seq, h: a.h, sig: a.sig };
      }
      emit(s);
      return true;
    },
    resetCell() {
      for (const s of streams.values()) { s.cellHead = 0; s.ack = undefined; emit(s); }
    },
    close() {
      if (closed) return;
      closed = true;
      commit.flush();
      db.close();
    },
  };
}
