// Generates frozen demo fixtures. Refuses to overwrite: deleting a file to regenerate it is a fixture change.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { toHex } from '../packages/core/src/bytes.ts';
import { newKeyPair } from '../packages/core/src/node.ts';

const out = (path: string, text: string) => {
  if (existsSync(path)) { console.log(`keep ${path} (frozen)`); return; }
  writeFileSync(path, text); console.log(`wrote ${path}`);
};
const kp = () => { const k = newKeyPair(); return { priv: toHex(k.priv), pub: toHex(k.pub) }; };

out('fixtures/keys.json', JSON.stringify({
  _warning: 'DEMO KEYS — published in the repo; never use outside the demo',
  authority: kp(),
  cells: [1, 2, 3].map((i) => ({ id: `cell-${i}`, ...kp() })),
  seats: Array.from({ length: 8 }, (_, i) => ({ seatId: `CEN042-S${String(i + 1).padStart(2, '0')}`, ...kp() })),
}, null, 2) + '\n');

// Deterministic stub cohort: 3 candidates × 20 items (mulberry32, seed 42).
let seed = 42;
const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
const forms = JSON.parse(readFileSync('fixtures/paper/forms.json', 'utf8')) as Record<string, string[]>;
const cands = [
  { cand: 'C0001', form: 'F1', lang: 'en', pwd: 0 },
  { cand: 'C0002', form: 'F2', lang: 'hi', pwd: 0 },
  { cand: 'C0003', form: 'F1', lang: 'en', pwd: 1 },
];
const rows: string[] = [];
for (const c of cands) {
  let t = 0;
  for (const item of forms[c.form]) {
    const state = (['A', 'A', 'A', 'NA', 'MR', 'AMR', 'NV'] as const)[int(0, 6)];
    const answered = state === 'A' || state === 'AMR';
    t += int(20_000, 90_000);
    rows.push(JSON.stringify({
      cand: c.cand, centre: 'CEN042', shift: 'S1', form: c.form, lang: c.lang, pwd: c.pwd, item, state,
      answer: answered ? 'ABCD'[int(0, 3)] : '', dwellMs: state === 'NV' ? 0 : int(5_000, 90_000),
      visits: state === 'NV' ? 0 : int(1, 3), changes: answered ? int(0, 2) : 0, tFirstMs: answered ? t : -1,
    }));
  }
}
out('fixtures/cohort-stub.jsonl', rows.join('\n') + '\n');
