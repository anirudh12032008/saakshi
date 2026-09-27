import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Incident } from '@saakshi/core/ops';
import { draftNotice, Outbox } from '../src/comms.ts';

const inc = (o: Partial<Incident>): Incident => ({ id: 'W-3', kind: 'RELAY_WAN_DOWN', severity: 'P2', key: 'k', title: 'CEN042 has lost its link', detail: 'd',
  blast: { cells: [], centres: ['CEN042'], candidates: 8, answersLost: 0 }, openedAt: 5, updatedAt: 5, rung: 2, ladder: [], data: {}, ...o });

test('draftNotice includes a Tamil-script ta sentence alongside en/hi', () => {
  const n = draftNotice(inc({}), 'DEMO-2026', 'S1', 6);
  expect(n.ta).toBeTruthy();
  expect(n.ta).toMatch(/[஀-௿]/);                     // Tamil Unicode block
  expect(n.ta).toContain('DEMO-2026');
});

test('Outbox.redraft replaces a draft\'s text and keeps id/audience; throws for a sent or unknown id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-out-'));
  const path = join(dir, 'outbox.jsonl');
  const ob = new Outbox(path);
  const n = draftNotice(inc({}), 'DEMO-2026', 'S1', 6);
  ob.draft(n);
  const redrafted = ob.redraft(n.id, { en: 'new en', hi: 'new hi', ta: 'new ta' }, 'claude');
  expect(redrafted).toMatchObject({ id: n.id, audience: n.audience, en: 'new en', hi: 'new hi', ta: 'new ta' });
  expect(ob.drafts()[0]).toMatchObject({ en: 'new en', hi: 'new hi', ta: 'new ta' });
  expect(() => ob.redraft('N-unknown', { en: 'x', hi: 'y', ta: 'z' }, 'template')).toThrow(/no draft/);
  ob.approve(n.id, 'CONTROL-1', 7);
  expect(() => ob.redraft(n.id, { en: 'x', hi: 'y', ta: 'z' }, 'template')).toThrow(/no draft/);
  rmSync(dir, { recursive: true, force: true });
});

test('Outbox.approve refuses a draft missing en, hi or ta', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-out-'));
  const ob = new Outbox(join(dir, 'outbox.jsonl'));
  const n = draftNotice(inc({}), 'DEMO-2026', 'S1', 6);
  ob.draft(n);
  ob.redraft(n.id, { en: 'ok', hi: 'ok', ta: '' } as any, 'template');
  expect(() => ob.approve(n.id, 'CONTROL-1', 7)).toThrow(/EN, HI and TA/);
  rmSync(dir, { recursive: true, force: true });
});
