import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toHex, utf8 } from '@saakshi/core/bytes';
import { canon } from '@saakshi/core/canon';
import { cellKey, DEV_EXAM, type KeysFile } from '@saakshi/core/dev';
import { bindArray, checkPin, openPinBox, type BindReq, type WireBind } from '@saakshi/core/enrol';
import { nativeBox, newKeyPair, signer } from '@saakshi/core/node';
import { SeatIdentity, type Post } from '../src/main/identity.ts';
import type { Wrapper } from '../src/main/journal-store.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1'), cell2 = cellKey(keys, 'cell-2');
const wrap: Wrapper = { encryptString: (s) => Buffer.from(s).reverse(), decryptString: (b) => Buffer.from(b).reverse().toString() };
const ctx = { ...DEV_EXAM, cand: 'C0001' };
const gate = { operatorId: 'GATE-42-OP7', method: 'aadhaar-face' as const };

/** The relay (and the cell behind it) as the seat sees them. */
function relay(mode: { down?: boolean; lose?: boolean; refuse?: boolean; tamper?: 'otherPub' | 'otherCell' | 'badSig' } = {}) {
  const issued = new Map<string, WireBind>(), seen: BindReq[] = [];
  const sign = signer(mode.tamper === 'otherCell' ? cell2 : cell);
  const post: Post = async (_path, body) => {
    const req = body as BindReq;
    seen.push(req);
    if (mode.down) return { status: 202, body: { provisional: true, reason: 'the centre has no WAN link' } };
    if (mode.refuse) return { status: 409, body: { error: 'C0001 is already bound to another seat — call the invigilator', code: 'ALREADY_BOUND' } };
    let wb = issued.get(req.cand);
    if (!wb) {
      const cert = canon(bindArray(mode.tamper === 'otherPub' ? { ...req, pub: toHex(newKeyPair().pub) } : req));
      wb = { cert, sig: mode.tamper === 'badSig' ? '0'.repeat(128) : toHex(sign(utf8(cert))), cell: 'cell-1', pinBox: req.pinBox };
      issued.set(req.cand, wb);
    }
    if (mode.lose) { mode.lose = false; throw new Error('socket hang up'); }        // the cell signed, but the answer never arrived
    return { status: 200, body: { bind: wb } };
  };
  return { post, seen, issued, mode };
}
const open = (post: Post, path = join(mkdtempSync(join(tmpdir(), 'saakshi-id-')), 'C0001.identity')) =>
  SeatIdentity.open({ path, ctx, seatId: 'CEN042-S01', wrap, cell: { id: 'cell-1', pub: cell.pub }, post, now: () => 1_790_000_000_000 });

test('enrol: bound with a verified certificate; only the cell can read the PIN; the key is saved wrapped and reopens offline', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'saakshi-id-')), 'C0001.identity');
  const r = relay(), id = open(r.post, path);
  assert.equal(id.state, 'none');
  assert.deepEqual(await id.enrol('482913', gate), { ok: true, bind: 'bound' });
  assert.deepEqual(id.bind, r.issued.get('C0001'));
  const req = r.seen[0];
  assert.equal(req.pub, toHex(id.key!.pub));
  assert.equal(checkPin(openPinBox(cell.priv, req, nativeBox), '482913'), true);
  assert.equal(JSON.stringify(req).includes('482913'), false);
  assert.equal(readFileSync(path, 'utf8').includes(toHex(id.key!.priv)), false);
  const again = open(async () => { throw new Error('offline'); }, path);
  assert.equal(again.state, 'bound');
  assert.deepEqual(again.key, id.key);
});

test('no WAN at check-in: provisional; the retry ratifies it with the same saved request', async () => {
  const r = relay({ down: true }), id = open(r.post);
  assert.deepEqual(await id.enrol('482913', gate), { ok: true, bind: 'provisional' });
  assert.match(id.error, /WAN/);
  r.mode.down = false;
  assert.equal(await id.retry(), 'bound');
  assert.equal(r.seen.length, 2);
  assert.deepEqual(r.seen[0], r.seen[1]);
});

test('Review Focus #2: a lost response — the retry gets the same certificate; enrolling again never makes a second key', async () => {
  const r = relay({ lose: true }), id = open(r.post);
  assert.deepEqual(await id.enrol('482913', gate), { ok: true, bind: 'provisional' });
  assert.equal(await id.retry(), 'bound');
  assert.deepEqual(id.bind, r.issued.get('C0001'));
  const pub = toHex(id.key!.pub);
  assert.deepEqual(await id.enrol('111111', gate), { ok: true, bind: 'bound' });
  assert.equal(toHex(id.key!.pub), pub);
  assert.equal(new Set(r.seen.map((s) => s.pub)).size, 1);
});

test('a certificate for another key, from another cell, or with a bad signature is rejected; the seat stays provisional', async () => {
  for (const tamper of ['otherPub', 'otherCell', 'badSig'] as const) {
    const id = open(relay({ tamper }).post);
    assert.deepEqual(await id.enrol('482913', gate), { ok: true, bind: 'provisional' });
    assert.match(id.error, /rejected/);
    assert.equal(id.bind, undefined);
  }
});

test('refused (already bound): the reason is kept and it is not retried', async () => {
  const r = relay({ refuse: true }), id = open(r.post);
  assert.deepEqual(await id.enrol('482913', gate), { ok: true, bind: 'refused' });
  assert.match(id.error, /already bound/);
  assert.equal(await id.retry(), 'refused');
  assert.equal(r.seen.length, 1);
});

test('the PIN and the gate check are validated before any key is made', async () => {
  const r = relay(), id = open(r.post);
  const bad = async (pin: string, g: { operatorId: string; method: string }) => ((await id.enrol(pin, g as typeof gate)) as { error: string }).error;
  assert.match(await bad('12345', gate), /6 digits/);
  assert.match(await bad('123456', { ...gate, operatorId: '  ' }), /operator/);
  assert.match(await bad('123456', { ...gate, method: 'palm-reading' }), /identity/);
  assert.equal(id.state, 'none');
  assert.equal(r.seen.length, 0);
});
