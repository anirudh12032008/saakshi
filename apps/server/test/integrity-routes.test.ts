import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Directory } from '@saakshi/core/directory';
import { faceArray, sealThumb, thumbHashOf, type FaceFlag, type Readiness, type SignedFace, type SignedReadiness } from '@saakshi/core/integrity';
import { newKeyPair } from '@saakshi/core/node';
import { integrityRoutes } from '../src/integrity-routes.ts';

const DAY = 24 * 3600_000;
const ctx = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001' };
const review = newKeyPair();

const dir: Directory = {
  v: 1, exam: 'DEMO-2026', shift: 'S1', durationMs: 3600_000, demoCentre: 'CEN042', issuedAt: 0,
  cells: [], centres: { CEN042: { cell: 'cell-1' } },
  cands: {
    C0001: { centre: 'CEN042', name: 'A', seatId: 'CEN042-S01' } as any,
    C0002: { centre: 'CEN042', name: 'B', seatId: 'CEN042-S02' } as any,
    C0003: { centre: 'CEN042', name: 'C', seatId: 'CEN042-S03' } as any,
  },
};

function readiness(verdict: Readiness['verdict']): SignedReadiness {
  const r: Readiness = { ...ctx, seatId: 'CEN042-S01', keyEpoch: 1, at: 10, verdict, findings: [{ code: 'blocklisted', level: 'block', detail: 'AnyDesk', names: ['AnyDesk'] }] };
  return { r, sig: '0'.repeat(128) };
}
function face(id: number): SignedFace & { id: number } {
  const thumb = sealThumb(review.pub, ctx, 50, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  const f: FaceFlag = { ...ctx, seatId: 'CEN042-S01', at: 50, code: 'face-none', faces: 0, expected: 1, thumb, thumbHash: thumbHashOf(thumb) };
  void faceArray(f);
  return { id, sig: '0'.repeat(128), f };
}

function fakeFetch(state: { down: boolean }) {
  return async (url: string | URL) => {
    if (state.down) throw new Error('ECONNREFUSED');
    const u = String(url);
    if (u.includes('/v1/readiness')) return new Response(JSON.stringify({ at: 1, seats: [readiness('block')] }));
    if (u.includes('/v1/faces')) {
      const after = Number(new URL(u).searchParams.get('after') ?? '0');
      if (after === 0) return new Response(JSON.stringify({ flags: [face(1)], last: 1 }));
      return new Response(JSON.stringify({ flags: [], last: after }));
    }
    return new Response('not found', { status: 404 });
  };
}

test('polls the relay, builds the board, queues face flags once, and decides', async () => {
  const controlDir = mkdtempSync(join(tmpdir(), 'integrity-routes-'));
  const x = integrityRoutes({ relayUrl: 'http://relay', dir, centre: 'CEN042', controlDir, reviewPriv: review.priv, retentionMs: 30 * DAY, fetch: fakeFetch({ down: false }) as any, now: () => 1_000 });
  await x.poll(); await x.poll();

  const board = await (await (x.routes['/v1/readiness'] as any).GET(new Request('http://c/v1/readiness'))).json();
  expect(board.centres[0].verdict).toBe('block');
  expect(board.relayReachable).toBe(true);

  const items = (await (await (x.routes['/v1/review'] as any).GET(new Request('http://c/v1/review'))).json()).items;
  expect(items).toHaveLength(1);

  const r = await (x.routes['/v1/review/decide'] as any).POST(new Request('http://c/v1/review/decide', { method: 'POST', body: JSON.stringify({ id: '1', decision: 'cleared', by: 'REVIEWER-1' }) }));
  expect((await r.json()).decision).toBe('cleared');

  const bad = await (x.routes['/v1/review/decide'] as any).POST(new Request('http://c/', { method: 'POST', body: JSON.stringify({ id: '1', decision: 'maybe', by: 'X' }) }));
  expect(bad.status).toBe(400);

  x.stop();
  rmSync(controlDir, { recursive: true, force: true });
});

test('an unreachable relay keeps the last board and says so', async () => {
  const controlDir = mkdtempSync(join(tmpdir(), 'integrity-routes-'));
  const state = { down: false };
  const x = integrityRoutes({ relayUrl: 'http://relay', dir, centre: 'CEN042', controlDir, reviewPriv: review.priv, retentionMs: 30 * DAY, fetch: fakeFetch(state) as any, now: () => 1_000 });
  await x.poll();
  let board = await (await (x.routes['/v1/readiness'] as any).GET(new Request('http://c/v1/readiness'))).json();
  expect(board.relayReachable).toBe(true);
  expect(board.centres[0].verdict).toBe('block');

  state.down = true;
  await x.poll();
  board = await (await (x.routes['/v1/readiness'] as any).GET(new Request('http://c/v1/readiness'))).json();
  expect(board.relayReachable).toBe(false);
  expect(board.centres[0].verdict).toBe('block');

  x.stop();
  rmSync(controlDir, { recursive: true, force: true });
});
