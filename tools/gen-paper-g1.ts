// G1's 100-item paper, generated at run time from the cohort's key.json (Stage 6, Task 3). I01-I20 are the demo bank's real
// items (fixtures/paper/bank.json), and this refuses a key whose I01-I20 differ from the demo paper's own answers
// (fixtures/paper/key.json) — the demo bank's items and answers must not silently drift apart. I21-I100 are labelled
// placeholder stems, as generate.py's demo bank does not go past I20. F1 is I01..I100; F2 is F1 reversed (as generate.py).
//   bun tools/gen-paper-g1.ts --key OUT/key.json --out DIR
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface BankItem { id: string; subject: string; en: { q: string; o: string[] }; hi: { q: string; o: string[] } }
export interface Bank { exam: string; items: BankItem[] }
export interface PaperG1 { bank: Bank; forms: { F1: string[]; F2: string[]; durationMin: number }; key: Record<string, string> }

const N = 100, DEMO_N = 20;
const fx = resolve(import.meta.dirname, '../fixtures');
const demoKey = (): Record<string, string> => JSON.parse(readFileSync(join(fx, 'paper/key.json'), 'utf8'));

function placeholder(n: number): BankItem {
  const id = `I${String(n).padStart(2, '0')}`;
  return {
    id, subject: 'practice',
    en: { q: `Practice question ${n} (synthetic placeholder)`, o: ['A', 'B', 'C', 'D'] },
    hi: { q: `अभ्यास प्रश्न ${n} (कृत्रिम)`, o: ['A', 'B', 'C', 'D'] },
  };
}

export function genPaperG1(key: Record<string, string>, demoBank: Bank): PaperG1 {
  const dk = demoKey();
  for (const id of Object.keys(dk)) if (key[id] !== dk[id]) throw new Error(`key.${id} (${key[id]}) differs from the demo paper's key.${id} (${dk[id]})`);
  const demoItems = demoBank.items.slice(0, DEMO_N);
  const items: BankItem[] = [...demoItems];
  for (let n = DEMO_N + 1; n <= N; n++) items.push(placeholder(n));
  const ids = items.map((i) => i.id);
  const extraKey = Object.fromEntries(items.slice(DEMO_N).map((it) => [it.id, key[it.id] ?? 'A']));
  return { bank: { exam: demoBank.exam, items }, forms: { F1: ids, F2: [...ids].reverse(), durationMin: 180 }, key: { ...key, ...extraKey } };
}

if (import.meta.main) {
  const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
  const keyPath = arg('--key'), outDir = arg('--out');
  if (!keyPath || !outDir) throw new Error('need --key OUT/key.json --out DIR');
  const demoBank = JSON.parse(readFileSync(join(fx, 'paper/bank.json'), 'utf8')) as Bank;
  const key = JSON.parse(readFileSync(resolve(keyPath), 'utf8')) as Record<string, string>;
  const g = genPaperG1(key, demoBank);
  const dir = resolve(outDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const write = (rel: string, data: unknown) => writeFileSync(join(dir, rel), JSON.stringify(data));
  write('bank.json', g.bank);
  write('forms.json', g.forms);
  write('key.json', g.key);
  console.log(`gen-paper-g1: wrote ${dir}/{bank,forms,key}.json (${g.bank.items.length} items)`);
}
