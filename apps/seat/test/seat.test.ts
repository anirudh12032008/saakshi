import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes, randomBytes, toHex, utf8 } from '@saakshi/core/bytes';
import { canon } from '@saakshi/core/canon';
import { combineBundle } from '@saakshi/core/custody';
import { cellKey, DEV_EXAM, type KeysFile } from '@saakshi/core/dev';
import type { Directory } from '@saakshi/core/directory';
import { bindArray, msg, type BindReq } from '@saakshi/core/enrol';
import { parseSignedLine } from '@saakshi/core/journal';
import { signer } from '@saakshi/core/node';
import { openShareFile, releaseArray, type ReleaseMsg } from '@saakshi/core/paper';
import { signPolicy } from '@saakshi/core/policy';
import { entryHash } from '@saakshi/core/protocol';
import { toB64, type SyncReq } from '@saakshi/core/wire';
import type { Wrapper } from '../src/main/journal-store.ts';
import type { PackageWire } from '../src/main/pkg.ts';
import { Seat } from '../src/main/seat.ts';
import { buildPackage } from '../../../tools/package.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/paper/${f}`, import.meta.url), 'utf8'));
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const cell = cellKey(keys, 'cell-1');
const wrap: Wrapper = { encryptString: (s) => Buffer.from(s).reverse(), decryptString: (b) => Buffer.from(b).reverse().toString() };
const dir = { v: 1, exam: 'DEMO-2026', shift: 'S1', durationMs: 1, demoCentre: 'CEN042', issuedAt: 0, cells: [], cands: {}, centres: { CEN042: { cell: 'cell-1' } } } as unknown as Directory;
const enrol = { pin: '482913', operatorId: 'GATE-42-OP7', method: 'aadhaar-face' as const };
const until = async (ok: () => boolean) => { for (let i = 0; i < 500 && !ok(); i++) await new Promise((r) => setTimeout(r, 10)); assert.equal(ok(), true); };

async function fixture() {
  const p = await buildPackage(dir, { bank: fx('bank.json'), forms: fx('forms.json') }, authority);
  const K = await combineBundle([openShareFile(p.shares.NTA, p.passphrases.NTA), openShareFile(p.shares.OBS, p.passphrases.OBS)]);
  const policy = signPolicy({ v: 1, exam: 'DEMO-2026', shift: 'S1', centre: 'CEN042', cell: { id: 'cell-1', keyId: 'k', pub: keys.cells[0].pub }, durationMs: 1_800_000,
    roster: { C0001: { form: 'F1', extraMs: 600_000, pseud: '7'.repeat(64) } }, issuedAt: 0 }, signer(authority));
  const w: PackageWire = { policy, manifest: p.manifest, paper: { F1: toB64(p.papers.F1), F2: toB64(p.papers.F2) } };
  const kcf1 = p.manifest.manifest.forms[0].kcf;
  const signed = (ts = 5): ReleaseMsg => { const r = { exam: 'DEMO-2026', shift: 'S1', form: 'F1', kcf: kcf1, ts }; return { ...r, key: toHex(K.kF1), sig: toHex(signer(authority)(msg(releaseArray(r)))), via: 'push' }; };
  return { w, kcf1, signed, code: (): ReleaseMsg => ({ ...signed(), sig: '', via: 'code' }), forged: (): ReleaseMsg => ({ ...signed(), key: toHex(randomBytes(32)), sig: '', via: 'code' }) };
}

/** A relay as the seat sees it: package, enrolment (the cell behind it signs), SSE with a snapshot on every connect, pull, sync. */
function fakeRelay(w: PackageWire) {
  const sign = signer(cell), streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  let n = 0;
  const me = {
    releases: [] as ReleaseMsg[], sync: [] as SyncReq[], hs: [] as string[], wanDown: false,
    push(r: ReleaseMsg) {
      me.releases = [...me.releases.filter((x) => x.form !== r.form), r];
      const frame = utf8(`id: b-${++n}\nevent: release\ndata: ${JSON.stringify(r)}\n\n`);
      for (const c of streams) c.enqueue(frame);
    },
    drop() { for (const c of streams) c.close(); streams.clear(); },
    fetch: (async (url: URL, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      if (path === '/v1/package') return Response.json(w);
      if (path === '/v1/enrol') {
        if (me.wanDown) return Response.json({ provisional: true, reason: 'the centre has no WAN link' }, { status: 202 });
        const req = JSON.parse(String(init!.body)) as BindReq, cert = canon(bindArray(req));
        return Response.json({ bind: { cert, sig: toHex(sign(utf8(cert))), cell: 'cell-1', pinBox: req.pinBox } });
      }
      if (path === '/release/current') return Response.json({ releases: me.releases });
      if (path === '/v1/release/events') return new Response(new ReadableStream<Uint8Array>({ start(c) {
        streams.add(c);
        c.enqueue(utf8(`id: b-${n}\nevent: snapshot\ndata: ${JSON.stringify({ releases: me.releases })}\n\n`));
      } }), { headers: { 'content-type': 'text/event-stream' } });
      if (path === '/v1/sync') {
        const req = JSON.parse(String(init!.body)) as SyncReq;
        me.sync.push(req);
        for (const e of req.entries) { const p = parseSignedLine(e.line); if (p.ok && p.header.seq === me.hs.length + 1) me.hs.push(toHex(entryHash(p.header))); }
        return Response.json({ streams: [{ ...req.streams[0], head: me.hs.length, headH: me.hs.at(-1) ?? '', need: false }], rejected: [] });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch,
  };
  return me;
}
function mkSeat(f: typeof fetch, d = mkdtempSync(join(tmpdir(), 'saakshi-seat-'))) {
  return { d, seat: new Seat({ dir: d, relayUrl: 'http://relay:7070', ctx: { ...DEV_EXAM, cand: 'C0001' }, seatId: 'CEN042-S01', authorityPub: authority.pub, wrap, camera: false, testMode: false, fetch: f, retryMs: 20 }) };
}
const unlocks = (s: Seat) => s.exam!.journal.headers.filter((h) => h.kind === 'unlock').length;

test('package → enrol → locked (the commitment shown) → a pushed release → ready → start journals the unlock with [form, kc_f, "push"]', async () => {
  const x = await fixture(), relay = fakeRelay(x.w), { seat } = mkSeat(relay.fetch);
  await seat.open();
  assert.equal(seat.boot().phase, 'enrol');
  assert.equal(seat.start().ok, false);
  assert.deepEqual(await seat.enrol(enrol), { ok: true, bind: 'bound' });
  assert.deepEqual([seat.boot().phase, seat.boot().commitment, seat.paper()], ['locked', x.kcf1, null]);
  relay.push(x.signed());
  await until(() => seat.boot().phase === 'ready');
  assert.equal(seat.paper()!.items[0].id, 'I01');
  assert.deepEqual(seat.start(), { ok: true, seq: 1, activeMs: 0 });
  assert.deepEqual(seat.exam!.journal.recs[0].body.meta, ['F1', x.kcf1, 'push']);
  assert.deepEqual([seat.boot().phase, seat.boot().durationMs], ['exam', 1_800_000 + 600_000]);   // D_i = D + compensatory time
  seat.close();
});

test('Review Focus #4: the same release by SSE, by snapshot after a reconnect, by pull, and then the phoned code — one unlock entry', async () => {
  const x = await fixture(), relay = fakeRelay(x.w), { seat } = mkSeat(relay.fetch);
  await seat.open(); await seat.enrol(enrol);
  relay.push(x.signed());
  await until(() => seat.boot().phase === 'ready');
  seat.start();
  relay.push(x.signed(6));                                                          // re-sent by the cell
  relay.drop();                                                                     // relay restart: pull + snapshot on reconnect
  await new Promise((r) => setTimeout(r, 150));
  relay.push(x.code());                                                             // the phoned code, after the push
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(unlocks(seat), 1);
  assert.equal(seat.boot().release!.via, 'push');
  assert.equal(seat.boot().notice, '');
  seat.close();
});

test('exit check — kc_f on both paths: a forged key is rejected with a notice and changes nothing; the phoned-code key unlocks', async () => {
  const x = await fixture(), relay = fakeRelay(x.w), { seat } = mkSeat(relay.fetch);
  await seat.open(); await seat.enrol(enrol);
  relay.push(x.forged());
  await until(() => /Rejected a key/.test(seat.boot().notice ?? ''));
  assert.equal(seat.boot().phase, 'locked');
  relay.push(x.code());
  await until(() => seat.boot().phase === 'ready');
  seat.start();
  assert.deepEqual(seat.exam!.journal.recs[0].body.meta, ['F1', x.kcf1, 'code']);
  relay.push(x.forged());
  await until(() => /Rejected a key/.test(seat.boot().notice ?? ''));
  assert.equal(unlocks(seat), 1);
  seat.close();
});

test('provisional (no WAN at check-in): the candidate sits the exam on the phoned code; nothing is sent until the cell ratifies the seat; then the backlog syncs', async () => {
  const x = await fixture(), relay = fakeRelay(x.w), { seat } = mkSeat(relay.fetch);
  relay.wanDown = true;
  await seat.open();
  assert.deepEqual(await seat.enrol(enrol), { ok: true, bind: 'provisional' });
  relay.push(x.code());
  await until(() => seat.boot().phase === 'ready');
  seat.start();
  assert.equal(seat.act({ kind: 'answer', item: 'I01', state: 'A', answer: 'D', dwellMs: 1000 }).ok, true);
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual([relay.sync.length, seat.boot().sync.provisional, seat.boot().bind], [0, true, 'provisional']);
  relay.wanDown = false;
  await until(() => seat.boot().bind === 'bound');
  await until(() => relay.hs.length === seat.exam!.head());
  assert.equal(relay.sync[0].binds?.[0].cell, 'cell-1');
  seat.close();
});

test('restart with no relay: package, identity, key and journal all come back from disk', async () => {
  const x = await fixture(), relay = fakeRelay(x.w), a = mkSeat(relay.fetch);
  await a.seat.open(); await a.seat.enrol(enrol);
  relay.push(x.signed());
  await until(() => a.seat.boot().phase === 'ready');
  a.seat.start();
  a.seat.act({ kind: 'answer', item: 'I01', state: 'A', answer: 'D', dwellMs: 1000 });
  a.seat.close();
  const b = mkSeat((async () => { throw new Error('offline'); }) as unknown as typeof fetch, a.d);
  await b.seat.open();
  const boot = b.seat.boot();
  assert.deepEqual([boot.phase, boot.bind, boot.items.I01?.answer, boot.release?.via], ['exam', 'bound', 'D', 'push']);
  b.seat.close();
});
