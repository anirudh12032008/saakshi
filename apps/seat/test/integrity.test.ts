import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTEGRITY_DEFAULT, verdictOf, type IntegrityPolicy } from '@saakshi/core/integrity';
import { evaluate, vmScore, type ProbeSnapshot } from '../src/main/integrity.ts';

const pol: IntegrityPolicy = { ...INTEGRITY_DEFAULT, egress: ['192.168.1.10:7070'], reviewPub: '04' + 'a'.repeat(128) };
const ok = <T>(value: T) => ({ status: 'ok' as const, value });
const clean = (x: Partial<ProbeSnapshot> = {}): ProbeSnapshot => ({
  platform: 'win32', at: 1, procs: ok([{ pid: 1, name: 'explorer.exe' }]), captureExcluded: ok([]), remoteSession: ok(false),
  vm: ok({ hv: false, model: 'Latitude 5420', bios: 'Dell Inc.', macs: ['a4:83:e7:00:00:01'] }), egress: ok(['192.168.1.10:7070', '127.0.0.1:7070']),
  displays: 1, camera: 'on', onBattery: false, freeBytes: 50e9, skewMs: 200, ...x });
const run = (s: ProbeSnapshot, acc = {}, testMode = false) => evaluate(s, pol, acc, { testMode, defaulted: false });
const codes = (fs: { code: string; level: string }[]) => fs.map((f) => `${f.level}:${f.code}`).sort();

test('a clean seat is green with no findings', () => {
  assert.deepEqual(run(clean()), []);
});

test('Act 1: AnyDesk (renamed notepad) and overlay-sim BLOCK, naming both', () => {
  const fs = run(clean({ procs: ok([{ pid: 4242, name: 'C:\\t\\AnyDesk.exe' }, { pid: 77, name: 'C:\\s\\overlay-sim.exe' }]), captureExcluded: ok([77]) }));
  assert.equal(verdictOf(fs), 'block');
  assert.deepEqual(fs.flatMap((f) => f.names).sort(), ['AnyDesk', 'overlay-sim']);
  assert.match(fs.find((f) => f.code === 'blocklisted')!.detail, /AnyDesk \(pid 4242\)/);
});

test('remote session and screensharingd block', () => {
  assert.deepEqual(codes(run(clean({ remoteSession: ok(true) }))), ['block:remote-session']);
  assert.deepEqual(codes(run(clean({ platform: 'darwin', remoteSession: ok(false),
    procs: ok([{ pid: 9, name: '/System/Library/CoreServices/RemoteManagement/screensharingd.bundle/Contents/MacOS/screensharingd' }]) }))), ['block:remote-session']);
});

test('VM score: 2 signal classes block, 1 is review, Hyper-V MAC alone is nothing', () => {
  const v = (hv: boolean, model: string, macs: string[] = []) => ({ hv, model, bios: '', macs });
  assert.deepEqual(vmScore(v(true, 'VirtualMac2,1'), [], pol).signals, ['hypervisor', 'model']);
  assert.deepEqual(codes(run(clean({ vm: ok(v(true, 'VirtualMac2,1')) }))), ['block:vm']);
  assert.deepEqual(codes(run(clean({ vm: ok(v(true, 'MacBookPro18,3')) }))), ['review:vm-signal']);
  assert.deepEqual(codes(run(clean({ vm: ok(v(false, 'x', ['00:15:5d:00:00:01'])) }))), []);
  assert.equal(vmScore(v(false, 'x'), [{ pid: 3, name: 'VBoxService.exe' }], pol).score, 1);
});

test('review and amber signals', () => {
  assert.deepEqual(codes(run(clean({ displays: 2, camera: 'none', egress: ok(['192.168.1.10:7070', '142.250.1.1:443']) }))), ['review:displays', 'review:egress', 'review:no-camera']);
  assert.deepEqual(codes(run(clean({ onBattery: true, freeBytes: 5e8, skewMs: -180_000 }))), ['amber:battery', 'amber:clock-skew', 'amber:disk']);
  assert.deepEqual(codes(run(clean({ camera: 'off' }), {}, true)), ['info:test-mode']);
  assert.deepEqual(codes(evaluate(clean(), pol, {}, { testMode: false, defaulted: true })), ['review:policy-default']);
});

test('Review Focus #1: an unknown probe is review, never green and never block', () => {
  const u = { status: 'unknown' as const, error: 'timed out' };
  const fs = run(clean({ procs: u, captureExcluded: u }));
  assert.equal(verdictOf(fs), 'review');
  assert.deepEqual(fs.filter((f) => f.code === 'probe-unknown').flatMap((f) => f.names).sort(), ['captureExcluded', 'processes']);
});

test('Review Focus #3: accommodated Magnifier is allowed; unaccommodated capture-excluded Magnifier blocks; NVDA alone is info', () => {
  const s = clean({ procs: ok([{ pid: 5, name: 'C:\\Windows\\System32\\Magnify.exe' }, { pid: 6, name: 'nvda.exe' }]), captureExcluded: ok([5]) });
  assert.equal(verdictOf(run(s, { assistive: ['Magnifier', 'NVDA'] })), 'green');
  assert.deepEqual(run(s, { assistive: ['Magnifier', 'NVDA'] }).find((f) => f.code === 'assistive')!.names.sort(), ['Magnifier', 'NVDA']);
  assert.equal(verdictOf(run(s)), 'block');
  assert.equal(verdictOf(run(clean({ procs: ok([{ pid: 6, name: 'nvda.exe' }]) }))), 'green');
});
