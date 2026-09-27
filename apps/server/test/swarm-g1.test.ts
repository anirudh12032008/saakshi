import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import type { Directory } from '@saakshi/core/directory';
import { formsOf } from '@saakshi/core/sheet';
import type { CohortRow } from '../../../tools/cohort.ts';
import { genPaperG1, type Bank } from '../../../tools/gen-paper-g1.ts';
import { plan, swarmCohort } from '../../../tools/swarm.ts';

const demoKey = JSON.parse(readFileSync(new URL('../../../fixtures/paper/key.json', import.meta.url), 'utf8')) as Record<string, string>;
const demoBank = JSON.parse(readFileSync(new URL('../../../fixtures/paper/bank.json', import.meta.url), 'utf8')) as Bank;

async function stubRows(cand: string): Promise<CohortRow[]> {
  const rows: CohortRow[] = [];
  for await (const line of createInterface({ input: createReadStream(new URL('../../../fixtures/cohort-stub.jsonl', import.meta.url)), crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as CohortRow;
    if (r.cand === cand) rows.push(r);
  }
  return rows;
}

test('gen-paper-g1: I01-I20 are the demo bank; I21-I100 are placeholders; F2 is F1 reversed', () => {
  const g = genPaperG1(demoKey, demoBank);
  expect(g.bank.items.length).toBe(100);
  expect(g.bank.items.slice(0, 20).map((i) => i.id)).toEqual(demoBank.items.map((i) => i.id));
  expect(g.bank.items.slice(0, 20)).toEqual(demoBank.items);
  const extra = g.bank.items[20];
  expect(extra).toMatchObject({ id: 'I21', subject: 'practice' });
  expect(extra.en.q).toContain('placeholder');
  expect(extra.en.o.length).toBe(4);
  expect(g.forms.F1.length).toBe(100);
  expect(g.forms.F2).toEqual([...g.forms.F1].reverse());
  expect(g.forms.durationMin).toBe(180);
  expect(g.key.I01).toBe(demoKey.I01);
  expect(Object.keys(g.key).length).toBe(100);
});

test('gen-paper-g1 refuses a key whose I01-I20 differ from the demo paper', () => {
  expect(() => genPaperG1({ ...demoKey, I01: demoKey.I01 === 'A' ? 'B' : 'A' }, demoBank)).toThrow(/demo paper/);
});

test('plan replays on the cohort clock: activeMs = tFirstMs, strictly increasing, dwell in meta[0]', async () => {
  const rows = await stubRows('C0001');
  const forms = formsOf(JSON.parse(readFileSync(new URL('../../../fixtures/paper/forms.json', import.meta.url), 'utf8')));
  const steps = plan({ exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001' }, 'F1', forms.F1, rows);
  for (const s of steps) {
    if (s.kind === 'submit') continue;
    const r = rows.find((x) => x.item === s.body.item)!;
    if (r.tFirstMs >= 0) expect(s.at).toBe(r.tFirstMs);
    expect(s.body.meta[0]).toBe(r.dwellMs);
  }
  expect(steps.every((s, i) => i === 0 || s.at > steps[i - 1].at)).toBe(true);
  expect(steps.filter((s) => rows.find((r) => r.item === s.body.item)?.state === 'NV').length).toBe(0);
});

test('swarmCohort drops the demo centre, keeps form items, rewrites the shift', async () => {
  const dir = {
    v: 1, exam: 'DEMO-2026', shift: 'S9', durationMs: 1, demoCentre: 'CEN042', issuedAt: 0, cells: [],
    centres: {}, cands: { C0001: { centre: 'CEN042', form: 'F1', pseud: '' }, C9001: { centre: 'CEN001', form: 'F1', pseud: '' } },
  } as unknown as Directory;
  const forms = formsOf(JSON.parse(readFileSync(new URL('../../../fixtures/paper/forms.json', import.meta.url), 'utf8')));
  async function* rows(): AsyncIterable<CohortRow> {
    for (const r of await stubRows('C0001')) yield r;
    for (const r of await stubRows('C0001')) yield { ...r, cand: 'C9001', centre: 'CEN001' };
    yield { cand: 'C9001', centre: 'CEN001', shift: 'S1', form: 'F1', lang: 'en', pwd: 0, item: 'I99', state: 'NV', answer: '', dwellMs: 0, visits: 0, changes: 0, tFirstMs: -1 };
  }
  const out = await swarmCohort(rows(), dir, forms);
  expect(out.every((r) => r.centre !== 'CEN042')).toBe(true);
  expect(out.every((r) => r.shift === 'S9')).toBe(true);
  expect(out.every((r) => forms[r.form]?.includes(r.item))).toBe(true);
  expect(out.some((r) => r.item === 'I99')).toBe(false);
});
