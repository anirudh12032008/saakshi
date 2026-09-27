import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes, toHex, utf8 } from '@saakshi/core/bytes';
import { canon } from '@saakshi/core/canon';
import { combineBundle } from '@saakshi/core/custody';
import { cellKey, DEV_EXAM, type KeysFile } from '@saakshi/core/dev';
import type { Directory } from '@saakshi/core/directory';
import { bindArray, checkPin, msg, openPinBox, type Bind } from '@saakshi/core/enrol';
import { grantArray, openHandoverPin, respHash, sealRestore, type Grant, type HandoverGrant, type HandoverReq } from '@saakshi/core/handover';
import { parseSignedLine } from '@saakshi/core/journal';
import { nativeBox, signer } from '@saakshi/core/node';
import { openShareFile, releaseArray, type ReleaseMsg } from '@saakshi/core/paper';
import { signPolicy } from '@saakshi/core/policy';
import { entryHash, type Response } from '@saakshi/core/protocol';
import { toB64, type SyncReq, type SyncRes } from '@saakshi/core/wire';
import { SeatIdentity, type Post } from '../src/main/identity.ts';
import type { Wrapper } from '../src/main/journal-store.ts';
import type { PackageWire } from '../src/main/pkg.ts';
import { Seat } from '../src/main/seat.ts';
import { SeatSync } from '../src/main/sync.ts';
import { buildPackage } from '../../../tools/package.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/paper/${f}`, import.meta.url), 'utf8'));
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const cell = cellKey(keys, 'cell-1');
const wrap: Wrapper = { encryptString: (s) => Buffer.from(s).reverse(), decryptString: (b) => Buffer.from(b).reverse().toString() };
const ctx = { ...DEV_EXAM, cand: 'C0001' }, gate = { operatorId: 'GATE-42-OP7', method: 'aadhaar-face' as const };
const PIN = '482913', FROM = 6, HEAD = 'e'.repeat(64);
const R: Response[] = [['I01', 'A', 'B'], ['I02', 'NA', '']];
const until = async (ok: () => boolean) => { for (let i = 0; i < 500 && !ok(); i++) await new Promise((r) => setTimeout(r, 10)); assert.equal(ok(), true); };
const refusedEnrol = { status: 409, body: { error: 'C0001 is already bound to another seat — call the invigilator', code: 'ALREADY_BOUND' } };

/** The exam server's side, through the relay: check the PIN, then sign keyEpoch 2 and the grant, and seal the answers to the new key. */
function grantFor(req: HandoverReq, o: { swap?: boolean } = {}): HandoverGrant | { error: string; code: string } {
  if (openHandoverPin(cell.priv, req, req.seatId, req.pub, (req.proof as { pin: string }).pin, nativeBox) !== PIN) return { error: 'wrong PIN — 2 tries left', code: 'PIN_WRONG' };
  assert.equal(checkPin(openPinBox(cell.priv, req, nativeBox), PIN), true);                // the new record carries the same PIN
  const b: Bind = { ...ctx, seatId: req.seatId, pub: req.pub, keyEpoch: 2, fromSeq: FROM, attestHash: req.attestHash };
  const cert = canon(bindArray(b)), sign = signer(cell);
  const grant: Grant = { ...ctx, keyEpoch: 2, fromSeq: FROM, fromHead: HEAD, activeMs: 60_000, creditedMs: 108_000, respHash: respHash(R) };
  return { bind: { cert, sig: toHex(sign(utf8(cert))), cell: 'cell-1', pinBox: req.pinBox }, grant, sig: toHex(sign(msg(grantArray(grant)))),
    restore: sealRestore(hexToBytes(req.pub), ctx, 2, FROM, o.swap ? [['I01', 'A', 'D']] : R, nativeBox), via: 'pin', approvedBy: 'INV-42-A' };
}

test('identity: refused as bound elsewhere → move by PIN; pending; a wrong PIN can be retyped; then a grant the seat checks', async () => {
  let approved = false;
  const seen: HandoverReq[] = [];
  const post: Post = async (path, body) => {
    if (path === '/v1/enrol') return refusedEnrol;
    seen.push(body as HandoverReq);
    if (!approved) return { status: 202, body: { state: 'pending' } };
    const g = grantFor(body as HandoverReq);
    return 'error' in g ? { status: 409, body: { state: 'refused', ...g } } : { status: 200, body: { state: 'granted', grant: g } };
  };
  const path = join(mkdtempSync(join(tmpdir(), 'saakshi-id-')), 'id');
  const open = () => SeatIdentity.open({ path, ctx, seatId: 'CEN042-S02', wrap, cell: { id: 'cell-1', pub: cell.pub }, post });
  const id = open();
  await id.enrol(PIN, gate);
  assert.deepEqual([id.state, id.moveable], ['refused', true]);
  assert.deepEqual(await id.handover('12345'), { ok: false, error: 'The PIN must be exactly 6 digits.' });
  assert.deepEqual(await id.handover('999999'), { ok: true, bind: 'moving' });
  assert.equal(id.moveKey, seen[0].pub.slice(2, 18));
  approved = true;
  assert.equal(await id.poll(), 'refused');
  assert.match(id.error, /wrong PIN/);
  assert.equal(id.moveable, true);
  assert.deepEqual(await id.handover(PIN), { ok: true, bind: 'bound' });
  assert.equal(seen.at(-1)!.proof.via, 'pin');
  assert.equal(id.keyEpoch, 2);
  assert.deepEqual(id.restore, { seq: FROM, head: HEAD, activeMs: 60_000, responses: R, via: 'pin', creditedMs: 108_000 });
  assert.deepEqual(id.credit, { ms: 108_000, via: 'pin', approvedBy: 'INV-42-A', fromSeq: FROM });
  assert.deepEqual([open().state, open().keyEpoch], ['bound', 2]);                     // survives a restart
});

test('identity: a relay that swaps the restored answers is caught, and the seat keeps waiting', async () => {
  const post: Post = async (path, body) => path === '/v1/enrol' ? refusedEnrol : { status: 200, body: { state: 'granted', grant: grantFor(body as HandoverReq, { swap: true }) } };
  const id = SeatIdentity.open({ path: join(mkdtempSync(join(tmpdir(), 'saakshi-id-')), 'id'), ctx, seatId: 'CEN042-S02', wrap, cell: { id: 'cell-1', pub: cell.pub }, post });
  await id.enrol(PIN, gate);
  await id.handover(PIN);
  assert.equal(id.state, 'moving');
  assert.match(id.error, /do not match the signed hash/);
});

test('sync: a spare relay that reports head 0 gets the binding again; a relay that disagrees gets our last entry as a probe; ORPHANED marks this seat as moved', async () => {
  const src = { ctx, head: () => 3, hashAt: (s: number) => `h${s}`, entriesAfter: (a: number) => [{ line: `l${a + 1}`, env: 'AAAA' }] };
  const reqs: SyncReq[] = [];
  let rejected: SyncRes['rejected'] = [];
  const send = async (req: SyncReq): Promise<SyncRes> => { reqs.push(req); return { streams: [{ ...ctx, head: 0, headH: '', need: false }], rejected }; };
  const s = new SeatSync(src, send, () => false, () => {}, { bind: () => ({ cert: 'c', sig: 's'.repeat(128), cell: 'cell-1', pinBox: 'ab' }) });
  await s.round(); await s.round();
  assert.deepEqual(reqs.map((r) => r.binds?.length ?? 0), [1, 1]);
  assert.equal(s.view().moved, undefined);
  rejected = [{ index: 0, code: 'ORPHANED', reason: 'keyEpoch 1 was replaced at seq 2' }];
  await s.round();
  assert.equal(s.view().moved, true);
  // A seat that restarts after its candidate moved (cursor −1) meets a relay ahead on the new key's chain: it probes with its last entry.
  const reqs2: SyncReq[] = [];
  let rejected2: SyncRes['rejected'] = [];
  const s2 = new SeatSync(src, async (req) => { reqs2.push(req); return { streams: [{ ...ctx, head: 5, headH: 'x'.repeat(64), need: false }], rejected: rejected2 }; }, () => false);
  await s2.round();
  rejected2 = [{ index: 0, code: 'ORPHANED', reason: 'keyEpoch 1 was replaced at seq 2' }];
  await s2.round();
  assert.deepEqual(reqs2.map((r) => r.entries.map((e) => e.line)), [[], ['l3']]);
  assert.equal(s2.view().moved, true);
});

test('the seat, moved: refused → move → moving (with its key) → approved → the exam restored from the grant; banner status; pause; Review Focus #2: ORPHANED → moved', async () => {
  const dir = { v: 1, exam: 'DEMO-2026', shift: 'S1', durationMs: 1, demoCentre: 'CEN042', issuedAt: 0, cells: [], cands: {}, centres: { CEN042: { cell: 'cell-1' } } } as unknown as Directory;
  const p = await buildPackage(dir, { bank: fx('bank.json'), forms: fx('forms.json') }, authority);
  const K = await combineBundle([openShareFile(p.shares.NTA, p.passphrases.NTA), openShareFile(p.shares.OBS, p.passphrases.OBS)]);
  const policy = signPolicy({ v: 1, exam: 'DEMO-2026', shift: 'S1', centre: 'CEN042', cell: { id: 'cell-1', keyId: 'k', pub: keys.cells[0].pub }, durationMs: 1_800_000,
    roster: { C0001: { form: 'F1', extraMs: 0, pseud: '7'.repeat(64) } }, issuedAt: 0 }, signer(authority));
  const w: PackageWire = { policy, manifest: p.manifest, paper: { F1: toB64(p.papers.F1), F2: toB64(p.papers.F2) } };
  const r0 = { exam: 'DEMO-2026', shift: 'S1', form: 'F1', kcf: p.manifest.manifest.forms[0].kcf, ts: 5 };
  const release: ReleaseMsg = { ...r0, key: toHex(K.kF1), sig: toHex(signer(authority)(msg(releaseArray(r0)))), via: 'push' };
  let approved = false, orphan = false;
  const hs: string[] = [], syncs: SyncReq[] = [];
  const fetch = (async (url: URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (path === '/v1/package') return Response.json(w);
    if (path === '/v1/enrol') return Response.json(refusedEnrol.body, { status: 409 });
    if (path === '/v1/handover') return approved ? Response.json({ state: 'granted', grant: grantFor(JSON.parse(String(init!.body))) }) : Response.json({ state: 'pending' }, { status: 202 });
    if (path === '/release/current') return Response.json({ releases: [release] });
    if (path === '/v1/release/events') return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(utf8(`id: b-1\nevent: snapshot\ndata: ${JSON.stringify({ releases: [release] })}\n\n`)); } }), { headers: { 'content-type': 'text/event-stream' } });
    if (path === '/v1/status') return Response.json({ link: 'down', cell: 'LIVE', at: 1 });
    if (path === '/v1/sync') {
      const req = JSON.parse(String(init!.body)) as SyncReq;
      syncs.push(req);
      for (const e of req.entries) { const q = parseSignedLine(e.line); if (!orphan && q.ok && q.header.seq === FROM + hs.length + 1) hs.push(toHex(entryHash(q.header))); }
      const rejected = orphan ? req.entries.map((_, index) => ({ index, code: 'ORPHANED', reason: 'the candidate moved' })) : [];
      return Response.json({ streams: [{ ...req.streams[0], head: FROM + hs.length, headH: hs.at(-1) ?? HEAD, need: false }], rejected });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  const seat = new Seat({ dir: mkdtempSync(join(tmpdir(), 'saakshi-seatB-')), relayUrl: 'http://relay:7070', ctx, seatId: 'CEN042-S02', authorityPub: authority.pub, wrap, camera: false, testMode: false, fetch, retryMs: 20 });
  await seat.open();
  await until(() => seat.boot().phase === 'enrol');
  await seat.enrol({ pin: PIN, ...gate });
  await until(() => seat.paper() !== null);                                                // the paper is released, but no exam: this seat is not bound
  assert.deepEqual([seat.boot().phase, seat.boot().moveable, seat.exam], ['enrol', true, undefined]);
  assert.deepEqual(await seat.handover(PIN), { ok: true, bind: 'moving' });
  assert.deepEqual([seat.boot().phase, /^[0-9a-f]{16}$/.test(seat.boot().moveKey ?? '')], ['moving', true]);
  approved = true;
  await until(() => seat.boot().phase === 'exam');
  const b = seat.boot();
  assert.deepEqual(b.items.I01, { state: 'A', answer: 'B', seq: FROM });
  assert.deepEqual(b.credited, { ms: 108_000, via: 'pin', approvedBy: 'INV-42-A', fromSeq: FROM });
  assert.ok(b.activeMs >= 60_000);
  const first = seat.exam!.journal.headers[0];
  assert.deepEqual([first.seq, first.kind, first.keyEpoch, first.prev], [FROM + 1, 'handover', 2, HEAD]);
  await until(() => seat.boot().status?.link === 'down');
  await until(() => hs.length >= 1);                                                       // the relay took the handover entry from seq 7
  seat.pause('suspend');
  assert.equal(seat.boot().paused, true);
  seat.resume();
  assert.equal(seat.exam!.journal.headers.at(-1)!.kind, 'gap');
  orphan = true;
  seat.act({ kind: 'answer', item: 'I03', state: 'A', answer: 'C', dwellMs: 1 });
  await until(() => seat.boot().phase === 'moved');
  assert.deepEqual(seat.act({ kind: 'answer', item: 'I04', state: 'A', answer: 'D', dwellMs: 1 }), { ok: false, error: 'This candidate has moved to another seat. Please call the invigilator.' });
  seat.close();
});
