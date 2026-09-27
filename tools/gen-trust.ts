// Writes fixtures/trust-dev.json: the PUBLIC half of fixtures/keys.json, which /verify pins. Refuses to overwrite.
//   node tools/gen-trust.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { trustFromKeys, type KeysFile } from '../packages/core/src/dev.ts';

const OUT = 'fixtures/trust-dev.json';
if (existsSync(OUT)) { console.log(`keep ${OUT}`); process.exit(0); }
writeFileSync(OUT, JSON.stringify(trustFromKeys(JSON.parse(readFileSync('fixtures/keys.json', 'utf8')) as KeysFile), null, 2) + '\n');
console.log(`wrote ${OUT}`);
