// Addendum E.1: a cell's record → the frozen cohort schema, so the radar and the decision engine read what the system stored.
import { toHex } from '@saakshi/core/bytes';
import type { ExportRow } from '@saakshi/core/analytics';
import type { Directory } from '@saakshi/core/directory';
import { findingFromMeta } from '@saakshi/core/integrity';
import { parseSignedLine } from '@saakshi/core/journal';
import { OPS } from '@saakshi/core/ops';
import { entryHash, type Header } from '@saakshi/core/protocol';
import type { Forms, ResponseSheet, ShiftExport } from '@saakshi/core/sheet';

const Z = '0'.repeat(64);
interface E { h: Header; item: string; state: string; answer: string; meta: unknown[]; rx: number }

function entries(s: ResponseSheet): E[] {
  const out: E[] = [];
  for (const e of s.entries) {
    const p = parseSignedLine(e.line);
    if (!p.ok) continue;
    const b = e.body; // ['body', item, state, answer, meta] or ['missing'] / ['unreadable']
    if (b[0] !== 'body') continue;
    out.push({ h: p.header, item: String(b[1]), state: String(b[2]), answer: String(b[3]), meta: Array.isArray(b[4]) ? b[4] : [], rx: e.rx?.[0] ?? 0 });
  }
  return out.sort((a, b) => a.h.seq - b.h.seq);
}

/** One sheet per candidate: the fullest; ties → the highest attempt. */
function pick(exports: ShiftExport[]): Map<string, { sheet: ResponseSheet; shift: string }> {
  const m = new Map<string, { sheet: ResponseSheet; shift: string }>();
  for (const x of exports) {
    for (const s of x.sheets) {
      const cur = m.get(s.ctx.cand)?.sheet;
      if (!cur || s.entries.length > cur.entries.length || (s.entries.length === cur.entries.length && s.ctx.attempt > cur.ctx.attempt)) {
        m.set(s.ctx.cand, { sheet: s, shift: x.shift });
      }
    }
  }
  return m;
}
const nat = (x: unknown): number => (typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 ? x : 0);

export function cohortRows(exports: ShiftExport[], dir: Directory, forms: Forms): ExportRow[] {
  const rows: ExportRow[] = [];
  for (const [cand, { sheet, shift }] of [...pick(exports)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const d = dir.cands[cand];
    if (!d) continue; // not in this exam's directory: never analysed
    const items = forms[d.form] ?? [];
    const es = entries(sheet);
    for (const item of items) {
      const on = es.filter((e) => e.item === item);
      const last = on.at(-1);
      const first = on.find((e) => e.answer !== '');
      let changes = 0;
      for (let i = 1; i < on.length; i++) if (on[i].answer !== on[i - 1].answer) changes++;
      rows.push({
        cand, centre: d.centre, shift, form: d.form, lang: d.lang ?? 'en', pwd: d.pwd ?? 0, item,
        state: (last?.state || 'NV') as ExportRow['state'], answer: last?.answer ?? '',
        dwellMs: on.reduce((t, e) => t + nat(e.meta[0]), 0), visits: on.length, changes,
        tFirstMs: first ? first.h.activeMs : -1,
        seq: last?.h.seq ?? 0, rxWall: last?.rx ?? 0, h: last ? toHex(entryHash(last.h)) : Z,
      });
    }
  }
  return rows;
}

export function deviceEvidence(exports: ShiftExport[]): string[] {
  const out = new Set<string>();
  for (const [cand, { sheet }] of pick(exports)) {
    for (const e of entries(sheet)) {
      if (e.h.kind === 'integrity') {
        const f = findingFromMeta(e.meta as never);
        if (f && OPS.criticalIntegrity.includes(f.code as never)) out.add(cand);
      }
      const prov = e.meta[1];
      if (Array.isArray(prov) && prov[0] === 'prov' && nat(prov[5]) > 0) out.add(cand);
    }
  }
  return [...out].sort();
}

const KEYS = ['cand', 'centre', 'shift', 'form', 'lang', 'pwd', 'item', 'state', 'answer', 'dwellMs', 'visits', 'changes', 'tFirstMs', 'seq', 'rxWall', 'h'] as const;
export const toJsonl = (rows: ExportRow[]): string => rows.map((r) => JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, r[k]])))).join('\n') + '\n';
