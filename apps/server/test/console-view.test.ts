import { expect, test } from 'bun:test';
import type { StreamView } from '@saakshi/core/wire';
import type { ReleaseMsg } from '@saakshi/core/paper';
import { applyEvent, paperStatus, SILENT_MS, tile } from '../src/console-view.ts';

const v = (o: Partial<StreamView>): StreamView => ({ exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001', head: 10, cellHead: 10, senderHead: 10, seenAt: 1_000, ...o });

test('tones: in sync, syncing when the seat or the cell is behind, silent after 30 s or never heard', () => {
  expect(tile(v({}), 2_000)).toMatchObject({ tone: 'ok', text: 'seat 10 · relay 10 · cell 10' });
  expect(tile(v({ senderHead: 12 }), 2_000).tone).toBe('lag');
  expect(tile(v({ cellHead: 7 }), 2_000).tone).toBe('lag');
  expect(tile(v({ cellHead: -1 }), 2_000)).toMatchObject({ tone: 'lag', text: 'seat 10 · relay 10 · cell ?' });
  expect(tile(v({}), 1_000 + SILENT_MS + 1).tone).toBe('silent');
  expect(tile(v({ seenAt: 0, senderHead: -1 }), 2_000)).toMatchObject({ tone: 'silent', text: 'seat ? · relay 10 · cell 10' });
  expect(tile(v({}), 2_000).aria).toBe('C0001: in sync; seat 10 · relay 10 · cell 10');
});

test('snapshot replaces the grid, stream upserts one tile, state reports the node state', () => {
  const views = new Map<string, StreamView>();
  expect(applyEvent(views, 'snapshot', { mode: 'relay', state: 'LIVE', streams: [v({}), v({ cand: 'C0002' })] })).toEqual({ mode: 'relay', state: 'LIVE' });
  expect(views.size).toBe(2);
  applyEvent(views, 'stream', v({ cand: 'C0002', head: 11 }));
  applyEvent(views, 'stream', v({ cand: 'C0003' }));
  expect([...views.values()].map((x) => [x.cand, x.head])).toEqual([['C0001', 10], ['C0002', 11], ['C0003', 10]]);
  expect(applyEvent(views, 'state', { state: 'REBUILDING' })).toEqual({ state: 'REBUILDING' });
  applyEvent(views, 'snapshot', { mode: 'relay', state: 'LIVE', streams: [] });
  expect(views.size).toBe(0);
});

test('paper status: locked, released by control, or unlocked here with the phoned code', () => {
  const r = (via: 'push' | 'code', form = 'F1'): ReleaseMsg => ({ exam: 'DEMO-2026', shift: 'S1', form, kcf: '', ts: Date.UTC(2026, 8, 27, 4, 30), key: '', sig: via === 'push' ? 'ab' : '', via });
  expect(paperStatus([])).toEqual({ text: 'Paper locked — waiting for T0 (or for the code phoned in by control if this centre is offline).', tone: 'locked' });
  expect(paperStatus([r('push'), r('push', 'F2')]).text).toBe('Paper released by control at T0 (F1, F2) at 04:30:00 UTC. Every seat checks the key against the published commitment.');
  expect(paperStatus([r('code'), r('code', 'F2')]).text).toBe('Paper unlocked here with the phoned code (F1, F2) at 04:30:00 UTC. Every seat checks the key against the published commitment.');
});
