// Control's provisioning for one exam-shift (DEV): the directory, each cell's key file (outside any DB) with an authority
// certificate and cellKeyId, a fresh pseudonym key, and one signed policy per centre that pins that centre's cell key.
//   bun tools/provision.ts --out data/exam [--cohort data/g1/cohort.jsonl] [--demo-centre CEN042] [--cell-urls u1,u2,u3] [--demo]
// --demo writes OPS_DEMO (10 s ladder timers) into the directory; without it the defaults (OPS) apply.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { hexToBytes, randomBytes, toHex } from '../packages/core/src/bytes.ts';
import { DEV_EXAM, devForm, devRoster, type KeysFile } from '../packages/core/src/dev.ts';
import { FILES, type CellEntry, type CellKeyFile, type Directory } from '../packages/core/src/directory.ts';
import { cellKeyArray, cellKeyId, msg } from '../packages/core/src/enrol.ts';
import { INTEGRITY_DEFAULT, type Accommodation } from '../packages/core/src/integrity.ts';
import { pseudOf } from '../packages/core/src/log.ts';
import { newKeyPair, signer } from '../packages/core/src/node.ts';
import { OPS_DEMO, type Ops } from '../packages/core/src/ops.ts';
import { signPolicy, type Policy, type RosterEntry } from '../packages/core/src/policy.ts';
import { readCohort } from './cohort.ts';

export interface CohortCand { cand: string; centre: string; form: 'F1' | 'F2'; pwd: 0 | 1 }
export interface ProvisionOpts {
  out: string; keys: KeysFile; cands: CohortCand[]; demoCentre?: string; cellUrls?: string[]; durationMs?: number; now?: number; ops?: Ops;
  /** centre → "host:port" the seats at that centre use for the relay; default 127.0.0.1:7070 for every centre */
  relayHosts?: Record<string, string>;
  /** candidate → accommodation; default (when omitted) marks the demo centre's second candidate (sorted) as a 2-face scribe seat with NVDA/VoiceOver */
  acc?: Record<string, Accommodation>;
  /** merged over INTEGRITY_DEFAULT; the computed egress and reviewPub always win */
  integrity?: Partial<import('../packages/core/src/integrity.ts').IntegrityPolicy>;
}

/** Compensatory time: PwD candidates get 20 minutes per hour, so D_i = D + D/3. */
export const extraFor = (pwd: 0 | 1, durationMs: number): number => (pwd ? Math.round(durationMs / 3) : 0);

/** One row per candidate (their first row in the cohort). */
export async function cohortCands(path: string): Promise<CohortCand[]> {
  const seen = new Map<string, CohortCand>();
  for await (const r of readCohort(path)) if (!seen.has(r.cand)) seen.set(r.cand, { cand: r.cand, centre: r.centre, form: r.form, pwd: r.pwd });
  return [...seen.values()];
}

export function provision(o: ProvisionOpts): Directory {
  const out = resolve(o.out);
  if (existsSync(join(out, FILES.directory))) throw new Error(`${out} is already provisioned; delete that directory first so old keys and packages are never mixed`);
  const demo = o.demoCentre ?? 'CEN042', durationMs = o.durationMs ?? 30 * 60_000, now = o.now ?? Date.now();
  const signA = signer({ priv: hexToBytes(o.keys.authority.priv), pub: hexToBytes(o.keys.authority.pub) });
  const pseudKey = randomBytes(32);
  const write = (rel: string, data: string) => { const p = join(out, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, data); };

  // DEV reuses the fixture cell keys (so trust-dev.json and /verify still pin them); control certifies each with a keyId.
  const cells: CellEntry[] = o.keys.cells.map((c, i) => {
    const keyId = cellKeyId(hexToBytes(c.pub));
    write(FILES.cellKey(c.id), JSON.stringify({ id: c.id, keyId, priv: c.priv, pub: c.pub } satisfies CellKeyFile, null, 2));
    const cert = toHex(signA(msg(cellKeyArray({ exam: DEV_EXAM.exam, cellId: c.id, keyId, pub: c.pub }))));
    return { id: c.id, url: o.cellUrls?.[i] ?? `http://127.0.0.1:${7080 + i}`, keyId, pub: c.pub, cert };
  });

  const cands: Directory['cands'] = {};
  for (const cand of devRoster(o.keys)) cands[cand] = { centre: demo, form: devForm(cand), extraMs: 0, pseud: pseudOf(pseudKey, cand) };
  let skipped = 0;
  for (const c of o.cands) {
    if (c.centre === demo) { skipped++; continue; }                   // the demo centre is real; G1's rows there are not replayed
    cands[c.cand] ??= { centre: c.centre, form: c.form, extraMs: extraFor(c.pwd, durationMs), pseud: pseudOf(pseudKey, c.cand) };
  }
  const byCentre = new Map<string, [string, RosterEntry][]>();
  for (const [cand, c] of Object.entries(cands)) {
    let a = byCentre.get(c.centre);
    if (!a) byCentre.set(c.centre, (a = []));
    a.push([cand, { form: c.form, extraMs: c.extraMs, pseud: c.pseud }]);
  }
  const centres: Directory['centres'] = { [demo]: { cell: cells[0].id } };
  [...byCentre.keys()].filter((c) => c !== demo).sort().forEach((c, i) => { centres[c] = { cell: cells[i % cells.length].id }; });

  // Addendum D: the review key is written once and reused across provisioning runs (e.g. a retry after a crash).
  const rkPath = join(out, FILES.reviewKey);
  if (!existsSync(rkPath)) { const k = newKeyPair(); write(FILES.reviewKey, JSON.stringify({ priv: toHex(k.priv), pub: toHex(k.pub) })); }
  const reviewPub = (JSON.parse(readFileSync(rkPath, 'utf8')) as { pub: string }).pub;
  const demoRoster = [...(byCentre.get(demo) ?? [])].map(([cand]) => cand).sort();
  const acc: Record<string, Accommodation> = o.acc ?? (demoRoster[1] ? { [demoRoster[1]]: { faces: 2, assistive: ['NVDA', 'VoiceOver'] } } : {});

  const dir: Directory = { v: 1, exam: DEV_EXAM.exam, shift: DEV_EXAM.shift, durationMs, demoCentre: demo, issuedAt: now, cells, centres, cands, ...(o.ops ? { ops: o.ops } : {}) };
  for (const [centre, { cell: cellId }] of Object.entries(centres)) {
    const cell = cells.find((c) => c.id === cellId)!;
    const roster = Object.fromEntries((byCentre.get(centre) ?? []).map(([cand, entry]) => [cand, acc[cand] ? { ...entry, acc: acc[cand] } : entry]));
    const integrity = { ...INTEGRITY_DEFAULT, ...o.integrity, egress: [o.relayHosts?.[centre] ?? '127.0.0.1:7070'], reviewPub };
    const policy: Policy = { v: 1, exam: dir.exam, shift: dir.shift, centre, cell: { id: cell.id, keyId: cell.keyId, pub: cell.pub }, durationMs, roster, issuedAt: now, integrity };
    write(FILES.policy(centre), JSON.stringify(signPolicy(policy, signA)));
  }
  write(FILES.pseudKey, toHex(pseudKey));
  write(FILES.directory, JSON.stringify(dir));
  pseudKey.fill(0);
  if (skipped) console.log(`provision: ${skipped} cohort candidates at ${demo} not replayed (${demo} is the real centre)`);
  return dir;
}

if (import.meta.main) {
  const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
  const keys = JSON.parse(readFileSync(resolve(import.meta.dirname, '../fixtures/keys.json'), 'utf8')) as KeysFile;
  const cohort = arg('--cohort'), out = arg('--out') ?? 'data/exam';
  const d = provision({ out, keys, cands: cohort ? await cohortCands(cohort) : [], demoCentre: arg('--demo-centre'), cellUrls: arg('--cell-urls')?.split(','), ops: process.argv.includes('--demo') ? OPS_DEMO : undefined });
  console.log(`provisioned ${Object.keys(d.cands).length} candidates at ${Object.keys(d.centres).length} centres on ${d.cells.length} cells → ${out}`);
}
