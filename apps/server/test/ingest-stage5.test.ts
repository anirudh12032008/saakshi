import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { hexToBytes } from '@saakshi/core/bytes';
import { cellKey, devForm, devPseud, type KeysFile } from '@saakshi/core/dev';
import { newKeyPair } from '@saakshi/core/node';
import type { SyncRes } from '@saakshi/core/wire';
import { createIngest, type IngestOpts } from '../src/ingest.ts';
import { openDb } from '../src/store.ts';
import { FORMS, SimSeat } from '../../../tools/sim-seat.ts';

const keys = JSON.parse(readFileSync(new URL('../../../fixtures/keys.json', import.meta.url), 'utf8')) as KeysFile;
const cell = cellKey(keys, 'cell-1');
const A = newKeyPair();
const seatKey = (c: string, e: number) => (c === 'C0001' ? (e === 1 ? A.pub : undefined) : undefined);

function node(mode: 'cell' | 'relay', o: Partial<IngestOpts> = {}) {
  const { db } = openDb(':memory:');
  const n = createIngest({ mode, db, fresh: false, seatKey, cell: mode === 'cell' ? cell : { pub: cell.pub }, forms: FORMS, formOf: devForm, pseud: devPseud, ...o });
  return { n, db };
}

const rej = (r: SyncRes | 'REBUILDING') => { if (r === 'REBUILDING') throw new Error('REBUILDING'); return r.rejected; };

test('an integrity entry becomes an INTEGRITY event carrying code, level and names', async () => {
  const { n } = node('cell', { now: () => 5_000 });
  const s = new SimSeat(keys, 'C0001', cell.pub, 1, A);
  s.add(1);
  s.append('unlock', { item: '', state: '', answer: '', meta: [] });
  s.append('integrity', { item: '', state: '', answer: '', meta: ['blocklisted', 'block', 'AnyDesk (pid 4242)', ['AnyDesk', 'overlay-sim']] });
  expect(rej(await n.sync({ entries: s.entries, streams: [] }))).toEqual([]);
  const ev = n.events(0, 50).find((e) => e.code === 'INTEGRITY')!;
  expect(ev.data).toEqual({ code: 'blocklisted', level: 'block', names: 'AnyDesk, overlay-sim' });
  n.close();
});

test('the B.9 test-mode entry still reads as code test-mode, level info', async () => {
  const { n } = node('cell', { now: () => 5_000 });
  const s = new SimSeat(keys, 'C0001', cell.pub, 1, A);
  s.add(1);
  s.append('unlock', { item: '', state: '', answer: '', meta: [] });
  s.append('integrity', { item: '', state: '', answer: '', meta: ['test-mode', 'journal key not in the OS keychain'] });
  expect(rej(await n.sync({ entries: s.entries, streams: [] }))).toEqual([]);
  const ev = n.events(0, 50).find((e) => e.code === 'INTEGRITY')!;
  expect(ev.data).toEqual({ code: 'test-mode', level: 'info', names: '' });
  n.close();
});
