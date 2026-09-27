// Tamper lab: build a signed answer chain, flip one byte, and show which entry the verifier pins.
//   node tools/tamper-lab.ts [--entries 40] [--offset N]      build + flip + verify
//   node tools/tamper-lab.ts verify <journal.jsonl>             verify a file (reads <file>.pub.json)
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { hexToBytes, toHex } from '../packages/core/src/bytes.ts';
import { buildChain, demoEntries, verifyChain, type ChainResult } from '../packages/core/src/journal.ts';
import { newKeyPair, signer, verifier } from '../packages/core/src/node.ts';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { entries: { type: 'string', default: '40' }, offset: { type: 'string' } } });
const ctx = { exam: 'DEMO-2026', shift: 'S1', attempt: 1, cand: 'C0001' };
const report = (label: string, r: ChainResult) =>
  console.log(r.ok ? `✓ ${label}: ${r.count} entries verify, head ${r.head.slice(0, 16)}…`
    : `✗ ${label}: entry seq ${r.index + 1} (line ${r.index + 1}) — ${r.fault}: ${r.detail}`);
const read = (f: string) => { const l = readFileSync(f, 'utf8').split('\n'); if (l.at(-1) === '') l.pop(); return l; };

if (positionals[0] === 'verify') {
  const file = positionals[1];
  const { ctx: c, pub } = JSON.parse(readFileSync(`${file}.pub.json`, 'utf8'));
  const r = verifyChain(c, read(file), verifier(hexToBytes(pub)));
  report(file, r);
  process.exit(r.ok ? 0 : 1);
}

const key = newKeyPair();
const { lines } = buildChain(ctx, 1, demoEntries(Number(values.entries)), signer(key));
const file = join(tmpdir(), 'saakshi-journal.jsonl');
const text = lines.join('\n') + '\n';
const pubJson = JSON.stringify({ ctx, pub: toHex(key.pub) });
writeFileSync(file, text);
writeFileSync(`${file}.pub.json`, pubJson);
report('original', verifyChain(ctx, lines, verifier(key.pub)));

const bytes = Buffer.from(text);
const off = values.offset ? Number(values.offset) : Math.floor(Math.random() * bytes.length);
const line = text.slice(0, off).split('\n').length;
const before = String.fromCharCode(bytes[off]);
bytes[off] ^= 0x01;
writeFileSync(`${file}.tampered`, bytes);
writeFileSync(`${file}.tampered.pub.json`, pubJson);
console.log(`flipped byte ${off} (line ${line}): ${JSON.stringify(before)} → ${JSON.stringify(String.fromCharCode(bytes[off]))}`);
const r = verifyChain(ctx, read(`${file}.tampered`), verifier(key.pub));
report('tampered', r);
console.log(!r.ok && r.index + 1 === line ? `located exactly: line ${line}` : 'MISMATCH — investigate');
console.log(`files: ${file}  (edit by hand, then: node tools/tamper-lab.ts verify ${file})`);
