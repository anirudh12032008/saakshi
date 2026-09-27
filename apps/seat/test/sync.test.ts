import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ackMessage } from '@saakshi/core/ack';
import { toHex } from '@saakshi/core/bytes';
import { cellKey, devSeat, type KeysFile } from '@saakshi/core/dev';
import type { WireBind } from '@saakshi/core/enrol';
import { parseSignedLine } from '@saakshi/core/journal';
import { signer, verifier } from '@saakshi/core/node';
import { entryHash } from '@saakshi/core/protocol';
import type { SyncReq, SyncRes } from '@saakshi/core/wire';
import { SeatSync, type SyncSource } from '../src/main/sync.ts';
import { SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');

/** An in-memory relay that also hands out cell acks — good or deliberately bad. */
function fakeRelay() {
  const cellSign = signer(cell);
  const r = {
    hs: [] as string[], up: true, lieHead: false, forgeAck: false, ackOtherH: false, seen: [] as SyncReq[],
    async send(req: SyncReq): Promise<SyncRes> {
      r.seen.push(req);
      if (!r.up) throw new Error('connect ECONNREFUSED');
      for (const e of req.entries) { const p = parseSignedLine(e.line); if (p.ok && p.header.seq === r.hs.length + 1) r.hs.push(toHex(entryHash(p.header))); }
      const c = req.streams[0], head = r.hs.length, h = r.hs[head - 1] ?? '';
      const ackH = r.ackOtherH ? 'ee'.repeat(32) : h;
      const sign = r.forgeAck ? signer(devSeat(keys, 'C0002')!) : cellSign;
      const ctx = { exam: c.exam, shift: c.shift, attempt: c.attempt, cand: c.cand };
      const ack = head ? { keyEpoch: 1, seq: head, h: ackH, sig: toHex(sign(ackMessage({ ...ctx, keyEpoch: 1, seq: head, h: ackH }))) } : undefined;
      return { streams: [{ ...ctx, head, headH: r.lieHead ? 'f'.repeat(64) : h, need: false, ...(ack ? { ack } : {}) }], rejected: [] };
    },
  };
  return r;
}
const source = (s: SimSeat): SyncSource => ({ ctx: s.ctx, head: () => s.head, hashAt: (q) => s.hs[q - 1], entriesAfter: (a, l) => s.after(a, l) });
function setup() {
  const sim = new SimSeat(keys, 'C0001', cell.pub), relay = fakeRelay(), views: unknown[] = [];
  const sync = new SeatSync(source(sim), (q) => relay.send(q), verifier(cell.pub), (v) => views.push(v));
  return { sim, relay, sync, views };
}

test('first round only says hello; the next sends the backlog; ticks go ✓ → ✓✓ → blue', async () => {
  const { sim, relay, sync, views } = setup();
  sim.add(5);
  assert.deepEqual(sync.view(), { local: 5, relay: 0, cell: 0, online: false, error: '' });
  await sync.round();
  assert.equal(relay.seen[0].entries.length, 0);
  assert.deepEqual(relay.seen[0].streams, [{ ...sim.ctx, head: 5 }]);
  await sync.round();
  assert.equal(relay.seen[1].entries.length, 5);
  assert.deepEqual(sync.view(), { local: 5, relay: 5, cell: 5, online: true, error: '' });
  assert.equal(views.length, 2);
});

test('offline: ✓ keeps growing, nothing is lost, and the backlog drains on return', async () => {
  const { sim, relay, sync } = setup();
  sim.add(5); await sync.round(); await sync.round();
  relay.up = false;
  sim.add(3); await sync.round();
  assert.deepEqual(sync.view(), { local: 8, relay: 5, cell: 5, online: false, error: 'connect ECONNREFUSED' });
  relay.up = true;
  await sync.round();
  assert.deepEqual(sync.view(), { local: 8, relay: 8, cell: 8, online: true, error: '' });
});

test('a forged or mismatched ack never turns a tick blue', async () => {
  const { sim, relay, sync } = setup();
  sim.add(4);
  relay.forgeAck = true;
  await sync.round(); await sync.round();
  assert.equal(sync.view().relay, 4);
  assert.equal(sync.view().cell, 0);
  relay.forgeAck = false; relay.ackOtherH = true;
  await sync.round();
  assert.equal(sync.view().cell, 0);
  relay.ackOtherH = false;
  await sync.round();
  assert.equal(sync.view().cell, 4);
});

test('a relay that disagrees about our chain does not advance ✓✓', async () => {
  const { sim, relay, sync } = setup();
  sim.add(3);
  relay.lieHead = true;
  await sync.round(); await sync.round();
  assert.equal(sync.view().relay, 0);
  assert.match(sync.view().error, /disagrees/);
  assert.equal(relay.seen[1].entries.length, 1);                  // still unsure of the relay's head: only our last entry, as a probe (Stage 4)
});

test('a fresh (spare) relay gets the whole journal again; ✓✓ already shown stays', async () => {
  const { sim, relay, sync } = setup();
  sim.add(5); await sync.round(); await sync.round();
  relay.hs = [];
  await sync.round();                                             // learns head 0
  assert.equal(sync.view().relay, 5);
  await sync.round();
  assert.equal(relay.seen.at(-1)!.entries.length, 5);
  assert.equal(relay.hs.length, 5);
});

test('kick() drains a backlog larger than one batch without waiting for the timer', async () => {
  const { sim, sync } = setup();
  sim.add(1200);
  sync.kick();
  const t0 = Date.now();
  while (sync.view().cell !== 1200) {
    if (Date.now() - t0 > 20_000) assert.fail(`stuck at ${JSON.stringify(sync.view())}`);
    await new Promise((r) => setTimeout(r, 10));
  }
});

test('Stage 3 provisional: nothing leaves the seat until the binding exists; then the first request carries it', async () => {
  const sim = new SimSeat(keys, 'C0001', cell.pub);
  sim.add(3);
  const seen: SyncReq[] = [];
  let bind: WireBind | undefined;
  const sync = new SeatSync(source(sim), async (req) => { seen.push(req); return { streams: [{ ...sim.ctx, head: 0, headH: '', need: false }], rejected: [] }; }, verifier(cell.pub), () => {}, { bind: () => bind });
  await sync.round();
  assert.equal(seen.length, 0);
  assert.equal(sync.view().provisional, true);
  bind = { cert: '["bind"]', sig: 'a'.repeat(128), cell: 'cell-1', pinBox: 'ab' };
  await sync.round();
  assert.deepEqual(seen[0].binds, [bind]);
  assert.equal(sync.view().provisional, false);
  await sync.round();
  assert.deepEqual(seen[1].binds, [bind]);                                          // Stage 4: the relay still reports head 0 (a spare), so it gets the binding again
});
