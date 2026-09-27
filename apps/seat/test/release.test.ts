import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hexToBytes, randomBytes, toHex, utf8 } from '@saakshi/core/bytes';
import { combineBundle } from '@saakshi/core/custody';
import type { KeysFile } from '@saakshi/core/dev';
import type { Directory } from '@saakshi/core/directory';
import { msg } from '@saakshi/core/enrol';
import { signer } from '@saakshi/core/node';
import { openShareFile, releaseArray, type ReleaseMsg } from '@saakshi/core/paper';
import { signPolicy } from '@saakshi/core/policy';
import { toB64 } from '@saakshi/core/wire';
import { verifyPackage, type PackageWire } from '../src/main/pkg.ts';
import { acceptRelease, parseSse, ReleaseWatcher } from '../src/main/release.ts';
import type { Paper } from '../src/shared/ipc.ts';
import { buildPackage } from '../../../tools/package.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/paper/${f}`, import.meta.url), 'utf8'));
const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
const want = { exam: 'DEMO-2026', shift: 'S1', cand: 'C0001' };
const dir = { v: 1, exam: 'DEMO-2026', shift: 'S1', durationMs: 1, demoCentre: 'CEN042', issuedAt: 0, cells: [], cands: {}, centres: { CEN042: { cell: 'cell-1' } } } as unknown as Directory;
async function fixture(): Promise<{ w: PackageWire; K: { kF1: Uint8Array; kF2: Uint8Array } }> {
  const p = await buildPackage(dir, { bank: fx('bank.json'), forms: fx('forms.json') }, authority);
  const K = await combineBundle([openShareFile(p.shares.NTA, p.passphrases.NTA), openShareFile(p.shares.NIC, p.passphrases.NIC)]);
  const policy = signPolicy({ v: 1, exam: 'DEMO-2026', shift: 'S1', centre: 'CEN042', cell: { id: 'cell-1', keyId: 'k', pub: keys.cells[0].pub }, durationMs: 1_800_000,
    roster: { C0001: { form: 'F1', extraMs: 0, pseud: '7'.repeat(64) } }, issuedAt: 0 }, signer(authority));
  return { w: { policy, manifest: p.manifest, paper: { F1: toB64(p.papers.F1), F2: toB64(p.papers.F2) } }, K };
}
function signedRelease(w: PackageWire, form: 'F1' | 'F2', key: Uint8Array): ReleaseMsg {
  const r = { exam: 'DEMO-2026', shift: 'S1', form, kcf: w.manifest.manifest.forms.find((f) => f.form === form)!.kcf, ts: 5 };
  return { ...r, key: toHex(key), sig: toHex(signer(authority)(msg(releaseArray(r)))), via: 'push' };
}
const until = async (ok: () => boolean) => { for (let i = 0; i < 300 && !ok(); i++) await new Promise((r) => setTimeout(r, 10)); assert.equal(ok(), true); };

test('exit check — kc_f on both paths: the pushed release and the phoned-code key open the paper; a key off kc_f, a forged signature or another form are refused', async () => {
  const { w, K } = await fixture();
  const pkg = verifyPackage(w, authority.pub, want);
  const push = signedRelease(w, 'F1', K.kF1), code: ReleaseMsg = { ...push, sig: '', via: 'code' };
  const ok = acceptRelease(push, pkg, 'F1', authority.pub);
  assert.deepEqual((ok as { paper: Paper }).paper.items.map((i) => i.id), fx('forms.json').F1);
  assert.equal(acceptRelease(code, pkg, 'F1', authority.pub).ok, true);
  for (const bad of [{ ...push, key: toHex(randomBytes(32)) }, { ...code, key: toHex(randomBytes(32)) }])
    assert.match((acceptRelease(bad, pkg, 'F1', authority.pub) as { error: string }).error, /kc_f/);
  assert.match((acceptRelease({ ...push, ts: 6 }, pkg, 'F1', authority.pub) as { error: string }).error, /signature/);
  assert.equal(acceptRelease(push, pkg, 'F2', authority.pub).ok, false);
});

test('parseSse: frames split across chunks, comments and bare retry lines skipped, ids and event names kept', () => {
  const a = parseSse('retry: 2000\n\nid: b-1\nevent: snapshot\ndata: {"releases":[]}\n\n:ping\n\nid: b-2\nevent: rel');
  assert.deepEqual(a.events, [{ id: 'b-1', event: 'snapshot', data: '{"releases":[]}' }]);
  assert.deepEqual(parseSse(a.rest + 'ease\ndata: {"x":1}\n\n'), { events: [{ id: 'b-2', event: 'release', data: '{"x":1}' }], rest: '' });
});

test('the watcher pulls /release/current, listens on SSE, and reconnects with Last-Event-ID — only ever to its relay', async () => {
  const { w, K } = await fixture();
  const r = signedRelease(w, 'F1', K.kF1);
  const calls: { url: string; lastId: string | null }[] = [];
  let ctl: ReadableStreamDefaultController<Uint8Array> | undefined;
  const f = (async (url: URL, init?: RequestInit) => {
    calls.push({ url: String(url), lastId: new Headers(init?.headers).get('last-event-id') });
    if (String(url).endsWith('/release/current')) return Response.json({ releases: [] });
    return new Response(new ReadableStream<Uint8Array>({ start(c) { ctl = c; } }), { headers: { 'content-type': 'text/event-stream' } });
  }) as unknown as typeof fetch;
  const got: ReleaseMsg[] = [];
  const watcher = new ReleaseWatcher({ relayUrl: 'http://relay:7070', fetch: f, retryMs: 10, onRelease: (x) => got.push(x) });
  watcher.start();
  await until(() => !!ctl);
  ctl!.enqueue(utf8(`id: b-3\nevent: release\ndata: ${JSON.stringify(r)}\n\n`));
  await until(() => got.length === 1);
  ctl!.close(); ctl = undefined;                                                    // the relay restarts
  await until(() => !!ctl);
  watcher.stop(); ctl!.close();
  assert.deepEqual(calls.map((c) => c.url), ['http://relay:7070/release/current', 'http://relay:7070/v1/release/events', 'http://relay:7070/release/current', 'http://relay:7070/v1/release/events']);
  assert.deepEqual(calls.map((c) => c.lastId), [null, null, null, 'b-3']);
  assert.deepEqual(got, [r]);
});
