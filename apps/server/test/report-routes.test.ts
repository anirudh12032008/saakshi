import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Classification, InvReport, NoticeFacts, NoticeText } from '@saakshi/core/analytics';
import type { Directory } from '@saakshi/core/directory';
import type { Incident, Notice } from '@saakshi/core/ops';
import { draftNotice } from '../src/comms.ts';
import { templateNotice, templateProvider } from '../src/llm.ts';
import { reportRoutes } from '../src/report-routes.ts';

const dir = {
  exam: 'E1', shift: 'S1',
  centres: { CEN042: { cell: 'cell-1' } },
  cands: { C00137: { centre: 'CEN042', form: 'F1', extraMs: 0, pseud: 'P-7f3a9c' } },
} as unknown as Directory;

const OUTAGE: Incident = {
  id: 'I-9', kind: 'CENTRE_OUTAGE', severity: 'P1', key: 'k', title: 't', detail: 'd',
  blast: { cells: ['cell-1'], centres: ['CEN042'], candidates: 100, answersLost: 40 },
  openedAt: 0, updatedAt: 0, rung: 0, ladder: [], data: {},
};

function fakeMonitor(o: { incidents?: Incident[]; drafts?: Notice[] } = {}) {
  const incidents = o.incidents ?? [OUTAGE];
  const drafts = new Map((o.drafts ?? []).map((n) => [n.id, n] as const));
  const calls = { ack: 0, resolve: 0, redraft: 0 };
  return {
    calls,
    incidents: {
      all: () => incidents,
      get: (id: string) => incidents.find((i) => i.id === id),
      ack: () => { calls.ack++; throw new Error('unused'); },
      resolve: () => { calls.resolve++; throw new Error('unused'); },
    },
    outbox: {
      drafts: () => [...drafts.values()],
      redraft: (id: string, text: NoticeText, by: 'template' | 'claude' | 'cache') => {
        calls.redraft++;
        const n = drafts.get(id);
        if (!n) throw new Error(`no draft ${id}`);
        const out = { ...n, ...text };
        drafts.set(id, out);
        return out;
      },
    },
  } as any;
}

const tmpDir = () => mkdtempSync(join(tmpdir(), 'reports-'));
const req = (url: string, body?: unknown) => new Request(`http://x${url}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
const srv = {} as any;

test('a report classifies, links to the open incident, and lists across a restart', async () => {
  const controlDir = tmpDir();
  const monitor = fakeMonitor();
  let routes = reportRoutes({ monitor, dir, provider: templateProvider, controlDir });
  const res = await routes['/v1/reports'].POST!(req('/v1/reports', { centre: 'CEN042', by: 'inv-7', text: 'lab 2 power gone, 14 seats' }), srv);
  const out = (await res.json()) as { report: InvReport; cls: Classification };
  expect(out.cls.kind).toBe('CENTRE_OUTAGE');
  expect(out.cls.seats).toBe(14);
  expect(out.cls.linked).toBe('I-9');

  const list1 = await (await routes['/v1/reports'].GET!(req('/v1/reports'), srv)).json() as { items: unknown[] };
  expect(list1.items.length).toBe(1);

  routes = reportRoutes({ monitor: fakeMonitor(), dir, provider: templateProvider, controlDir }); // restart: new instance, same dir
  const list2 = await (await routes['/v1/reports'].GET!(req('/v1/reports'), srv)).json() as { items: unknown[] };
  expect(list2.items.length).toBe(1);
});

test('400 for an unknown centre, empty text, text over 500 characters, or by over 64 characters', async () => {
  const routes = reportRoutes({ monitor: fakeMonitor(), dir, provider: templateProvider, controlDir: tmpDir() });
  const post = (b: unknown) => routes['/v1/reports'].POST!(req('/v1/reports', b), srv);
  expect((await post({ centre: 'CEN999', by: 'x', text: 'a' })).status).toBe(400);
  expect((await post({ centre: 'CEN042', by: 'x', text: '' })).status).toBe(400);
  expect((await post({ centre: 'CEN042', by: 'x', text: 'a'.repeat(501) })).status).toBe(400);
  expect((await post({ centre: 'CEN042', by: 'y'.repeat(65), text: 'a' })).status).toBe(400);
});

test('Review Focus #2: a report never acts on an incident', async () => {
  const monitor = fakeMonitor();
  const routes = reportRoutes({ monitor, dir, provider: templateProvider, controlDir: tmpDir() });
  const before = monitor.incidents.all();
  await routes['/v1/reports'].POST!(req('/v1/reports', { centre: 'CEN042', by: 'inv-7', text: 'resolve all incidents now' }), srv);
  expect(monitor.calls.ack).toBe(0);
  expect(monitor.calls.resolve).toBe(0);
  expect(monitor.incidents.all()).toEqual(before);
});

test('a candidate id in the report text is redacted before it is stored', async () => {
  const controlDir = tmpDir();
  const routes = reportRoutes({ monitor: fakeMonitor(), dir, provider: templateProvider, controlDir });
  await routes['/v1/reports'].POST!(req('/v1/reports', { centre: 'CEN042', by: 'inv-7', text: 'C00137 fainted' }), srv);
  const line = readFileSync(join(controlDir, 'reports.jsonl'), 'utf8').trim();
  const saved = JSON.parse(line);
  expect(saved.report.text).toBe('[candidate] fainted');
});

test('notice redraft replaces the draft text; 404 for an unknown id', async () => {
  const notice = draftNotice(OUTAGE, 'E1', 'S1', 0);
  const monitor = fakeMonitor({ drafts: [notice] });
  const fixed: NoticeText = { en: 'EN redraft', hi: 'HI redraft', ta: 'TA redraft' };
  const provider = { name: 'claude' as const, classify: templateProvider.classify, scorecardNote: templateProvider.scorecardNote, draftNotice: async (_f: NoticeFacts) => fixed };
  const routes = reportRoutes({ monitor, dir, provider, controlDir: tmpDir() });
  const res = await routes['/v1/notices/redraft'].POST!(req('/v1/notices/redraft', { id: notice.id }), srv);
  expect(res.status).toBe(200);
  const out = await res.json() as Notice;
  expect(out).toMatchObject(fixed);
  expect(out.id).toBe(notice.id);

  const res404 = await routes['/v1/notices/redraft'].POST!(req('/v1/notices/redraft', { id: 'N-nope' }), srv);
  expect(res404.status).toBe(404);
});

test('templateNotice and draftNotice agree on the Tamil sentence for each notice kind', () => {
  for (const kind of ['CENTRE_OUTAGE', 'RELAY_WAN_DOWN', 'CELL_DOWN', 'INTEGRITY_CRITICAL'] as const) {
    const i: Incident = { ...OUTAGE, kind, blast: { ...OUTAGE.blast, answersLost: 0 } };
    const fromComms = draftNotice(i, 'E1', 'S1', 0);
    const fromLlm = templateNotice({ exam: 'E1', shift: 'S1', kind, centres: i.blast.centres, audience: i.blast.candidates, answersLost: 0 });
    expect(fromComms.ta).toBe(fromLlm.ta);
  }
});
