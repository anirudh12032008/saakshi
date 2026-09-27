import { expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { summarise, type RunLog } from '../../../tools/chaos.ts';
import { seatDataDir } from '../../../tools/reset.ts';
import { demoSpecs } from '../../../tools/stack.ts';

test('chaos summary: all runs ok only if every run lost nothing; RTO p50 and max per scenario', () => {
  const r = (run: number, scenario: RunLog['scenario'], rtoMs: number, lost = 0): RunLog => ({ run, scenario, seats: 8, sent: 800, relayAcked: 800, cellAcked: 800, stored: 800 - lost, lost, rpo: 0, rtoMs, ok: lost === 0 });
  const s = summarise([r(1, 'kill-cell', 900), r(2, 'wipe-cell', 2_000), r(3, 'spare-relay', 1_500), r(4, 'kill-cell', 1_100), r(5, 'kill-cell', 1_000)]);
  expect(s).toEqual({ runs: 5, ok: true, lost: 0, rtoMs: { 'kill-cell': { n: 3, p50: 1_000, max: 1_100 }, 'wipe-cell': { n: 1, p50: 2_000, max: 2_000 }, 'spare-relay': { n: 1, p50: 1_500, max: 1_500 } } });
  expect(summarise([r(1, 'wipe-cell', 10, 3)])).toMatchObject({ ok: false, lost: 3 });
});

test('the demo stack: three cells, the Centre 42 relay, control pointed at the supervisor, the swarm only with a cohort', () => {
  const s = demoSpecs({ exam: '/x/exam', data: '/x/data', stackUrl: 'http://127.0.0.1:7099' });
  expect(s.map((n) => n.name)).toEqual(['cell-1', 'cell-2', 'cell-3', 'relay', 'control']);
  expect(s[1]).toMatchObject({ db: join(resolve('/x/data'), 'cell-2.db'), env: { MODE: 'cell', CELL_ID: 'cell-2', PORT: '7081', EXAM: resolve('/x/exam') } });   // Windows CI too
  expect(s[4].env).toMatchObject({ MODE: 'control', STACK_URL: 'http://127.0.0.1:7099', RELAY_URL: 'http://127.0.0.1:7070' });
  expect(demoSpecs({ exam: '/x/exam', data: '/x/data', stackUrl: 'u', cohort: '/x/g1.jsonl' }).at(-1)).toMatchObject({ name: 'swarm', ready: 'SWARM ' });
  expect(seatDataDir('darwin')).toMatch(/Library[\\/]Application Support[\\/]Saakshi$/);
  expect(seatDataDir('win32', { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' })).toMatch(/Saakshi$/);
});
