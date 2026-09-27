import { expect, test } from 'bun:test';
import type { CellStats, CentreStats, Directory, FleetView } from '@saakshi/core/directory';
import { fleet, tone } from '../src/fleet.ts';

const e = (centre: string) => ({ centre, form: 'F1' as const, extraMs: 0, pseud: '' });
const cellE = (id: string) => ({ id, url: `http://${id}`, keyId: '', pub: '', cert: '' });
const dir = { v: 1, exam: 'DEMO-2026', shift: 'S1', durationMs: 1, demoCentre: 'CEN042', issuedAt: 0, cells: [cellE('cell-1'), cellE('cell-2')],
  centres: { CEN042: { cell: 'cell-1' }, CEN001: { cell: 'cell-1' }, CEN002: { cell: 'cell-2' } },
  cands: { C0001: e('CEN042'), C0002: e('CEN042'), X1: e('CEN001'), X2: e('CEN002'), X3: e('CEN002') } } as unknown as Directory;
const c = (registered: number, bound: number, unlocked: number, submitted: number, entries: number): CentreStats => ({ registered, bound, unlocked, submitted, entries });

test('tone: green only when every registered candidate unlocked; partial; locked; down', () => {
  expect([tone(c(2, 2, 2, 0, 0), false), tone(c(2, 2, 1, 0, 0), false), tone(c(2, 2, 0, 0, 0), false), tone(c(2, 2, 2, 0, 0), true), tone(c(0, 0, 0, 0, 0), false)])
    .toEqual(['green', 'partial', 'locked', 'down', 'locked']);
});

test('sums every cell per centre; a down cell greys its centres but keeps their registered counts and its last entry count', async () => {
  let t = 0;
  const stats: Record<string, CellStats | Error> = {
    'cell-1': { cell: 'cell-1', state: 'LIVE', entries: 100, centres: { CEN042: c(2, 2, 1, 0, 60), CEN001: c(1, 1, 1, 1, 40) } },
    'cell-2': { cell: 'cell-2', state: 'LIVE', entries: 50, centres: { CEN002: c(2, 2, 2, 0, 50) } },
  };
  const f = fleet({ dir, now: () => t, stats: async (x) => { const s = stats[x.id]; if (s instanceof Error) throw s; return s; } });
  let v = await f.poll();
  expect(v.centres.map((x) => [x.centre, x.tone, x.unlocked, x.registered])).toEqual([['CEN001', 'green', 1, 1], ['CEN002', 'green', 2, 2], ['CEN042', 'partial', 1, 2]]);
  expect(v).toMatchObject({ registered: 5, bound: 5, unlocked: 4, submitted: 1, entries: 150, entriesPerSec: 0 });
  t = 2000;
  stats['cell-1'] = { ...(stats['cell-1'] as CellStats), entries: 300 };
  expect((await f.poll()).entriesPerSec).toBe(100);                               // (300 + 50 − 150) / 2 s
  t = 3000;
  stats['cell-2'] = new Error('connect ECONNREFUSED');
  v = await f.poll();
  expect(v.cells).toEqual([{ id: 'cell-1', state: 'LIVE', entries: 300 }, { id: 'cell-2', state: 'DOWN', entries: 50 }]);
  expect(v.centres.find((x) => x.centre === 'CEN002')).toMatchObject({ tone: 'down', registered: 2, unlocked: 0 });
  expect(v.entriesPerSec).toBe(0);
  const res = await f.routes['/v1/fleet'].GET!(new Request('http://control/v1/fleet'), { timeout() {} });
  expect(((await res.json()) as FleetView).at).toBe(3000);
});
