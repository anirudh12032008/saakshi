import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTEGRITY_DEFAULT, openThumb, type FaceFlag, type IntegrityFinding, type IntegrityPolicy, type Readiness } from '@saakshi/core/integrity';
import { newKeyPair } from '@saakshi/core/node';
import { Gate } from '../src/main/gate.ts';
import type { ProbeSnapshot } from '../src/main/integrity.ts';

const review = newKeyPair();
const pol: IntegrityPolicy = { ...INTEGRITY_DEFAULT, egress: ['127.0.0.1:7070'], reviewPub: Buffer.from(review.pub).toString('hex') };
const ctx = { exam: 'E', shift: 'S1', attempt: 1, cand: 'C0001' };
const ok = <T>(value: T) => ({ status: 'ok' as const, value });
const snap = (procs: string[] = [], excluded: number[] = []): ProbeSnapshot => ({ platform: 'win32', at: 0,
  procs: ok(procs.map((name, i) => ({ pid: 100 + i, name }))), captureExcluded: ok(excluded), remoteSession: ok(false),
  vm: ok({ hv: false, model: 'x', bios: '', macs: [] }), egress: ok([]), displays: 1, camera: 'on', onBattery: false, freeBytes: 50e9, skewMs: 0 });

function harness(first: ProbeSnapshot, o: Partial<{ started: boolean; faceUp: boolean }> = {}) {
  let s = first, t = 1_000, started = o.started ?? false, faceUp = o.faceUp ?? true;
  const journaled: IntegrityFinding[] = [], reports: Readiness[] = [], faces: FaceFlag[] = [];
  const g = new Gate({ pol, acc: {}, defaulted: false, testMode: false, ctx, seatId: 'CEN042-S01', now: () => t, key: () => ({ keyEpoch: 1 }),
    collect: async () => s, journal: (f) => (started ? (journaled.push(f), journaled.length) : undefined),
    report: async (r) => { reports.push(r); return true; }, face: async (f) => { if (!faceUp) return false; faces.push(f); return true; } });
  return { g, journaled, reports, faces, set: (x: ProbeSnapshot) => { s = x; }, tick: (ms: number) => { t += ms; }, start: () => { started = true; }, relay: (up: boolean) => { faceUp = up; } };
}

test('Act 1: blocked by name before start; closing the tools turns the seat green; every check is reported', async () => {
  const h = harness(snap(['C:\\t\\AnyDesk.exe', 'C:\\s\\overlay-sim.exe'], [101]));
  const v = await h.g.check();
  assert.equal(v.verdict, 'block');
  assert.equal(h.g.blocked(), true);
  assert.deepEqual(v.findings.flatMap((f) => f.names).sort(), ['AnyDesk', 'overlay-sim']);
  h.set(snap()); h.tick(10_000);
  assert.equal((await h.g.check()).verdict, 'green');
  assert.deepEqual(h.reports.map((r) => r.verdict), ['block', 'green']);
  assert.equal(h.journaled.length, 0);                                   // nothing is journaled before the exam starts
});

test('Review Focus #2: a persistent finding is journaled once; cleared and back is journaled again', async () => {
  const h = harness(snap(), { started: true });
  await h.g.check();
  h.set(snap(['AnyDesk.exe']));
  for (let i = 0; i < 5; i++) { h.tick(10_000); await h.g.check(); }
  assert.equal(h.journaled.filter((f) => f.code === 'blocklisted').length, 1);
  h.set(snap()); h.tick(10_000); await h.g.check();
  h.set(snap(['AnyDesk.exe'])); h.tick(10_000); await h.g.check();
  assert.equal(h.journaled.filter((f) => f.code === 'blocklisted').length, 2);
  assert.equal(h.g.blocked(), false, 'during the exam nothing blocks');
});

test('Review Focus #1: a hanging collect() times out; the gate reports probe-unknown and keeps monitoring', async () => {
  const g = new Gate({ pol: { ...pol, probeMs: 1_000 }, acc: {}, defaulted: false, testMode: false, ctx, seatId: 'S', key: () => ({ keyEpoch: 1 }),
    collect: () => new Promise(() => {}), journal: () => undefined, report: async () => true, face: async () => true });
  const t0 = Date.now(), v = await g.check();
  assert.ok(Date.now() - t0 < 2_500);
  assert.equal(v.verdict, 'review');
  assert.deepEqual(v.findings.map((f) => f.code), ['probe-unknown']);
});

test('Review Focus #4: a face flag is retried until the relay takes it; the thumb opens only with the review key', async () => {
  const h = harness(snap(), { started: true, faceUp: false });
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
  for (let i = 0; i <= 20; i++) h.g.faceSample({ faces: 0, at: 1_000 + i * 500, thumb: jpeg });
  await h.g.retry();
  assert.equal(h.faces.length, 0);
  assert.deepEqual(h.journaled.map((f) => f.code), ['face-none']);
  h.relay(true); await h.g.retry(); await h.g.retry();
  assert.equal(h.faces.length, 1);
  assert.deepEqual([...openThumb(review.priv, ctx, h.faces[0].at, h.faces[0].thumb)], [0xff, 0xd8, 0xff, 0xd9]);
  assert.equal(h.journaled[0].names[0], h.faces[0].thumbHash);
});

test('window blur over 3 s is a review finding; shorter blurs are ignored', async () => {
  const h = harness(snap(), { started: true });
  h.g.blur(2_000); h.g.blur(4_500);
  assert.deepEqual(h.journaled.map((f) => [f.code, f.level]), [['blur', 'review']]);
});
