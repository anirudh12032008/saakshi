// The packager (plan §3.3), run offline at T−3 days for one exam-shift. It makes K_F1, K_F2 and L, a per-centre offline code,
// the wraps W_c, the code list under L, the paper ciphertext per form, and the signed manifest {ciphertextHash, kc_f} — the
// public commitment. It splits {K_F1, K_F2, L} Shamir 2-of-3 into passphrase-sealed share files for NTA, NIC and the observer,
// prints the passphrases once, and then zeroises everything it generated.
//   bun tools/package.ts --exam data/exam
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { hexToBytes, randomBytes, toHex, utf8 } from '../packages/core/src/bytes.ts';
import { newOfflineCode, splitBundle, wrapForCentre } from '../packages/core/src/custody.ts';
import type { KeysFile } from '../packages/core/src/dev.ts';
import { CUSTODIANS, FILES, type Directory } from '../packages/core/src/directory.ts';
import { msg } from '../packages/core/src/enrol.ts';
import { signer, type KeyPair } from '../packages/core/src/node.ts';
import { ciphertextHash, manifestArray, sealCodes, sealPaper, sealShareFile, type Manifest, type ManifestForm, type ShareFile, type SignedManifest } from '../packages/core/src/paper.ts';
import { kcf } from '../packages/core/src/protocol.ts';

export interface PaperIn { bank: { items: { id: string }[] }; forms: Record<string, unknown> }
export interface Package {
  manifest: SignedManifest; papers: Record<string, Uint8Array>; wraps: Record<string, string>; codes: Uint8Array;
  shares: Record<string, ShareFile>; passphrases: Record<string, string>;
  /** Every secret byte array this packager generated; zeroise() wipes them. */
  secrets: Uint8Array[];
}

export async function buildPackage(dir: Directory, paper: PaperIn, authority: KeyPair, now = Date.now()): Promise<Package> {
  const X = { exam: dir.exam, shift: dir.shift };
  const kF1 = randomBytes(32), kF2 = randomBytes(32), L = randomBytes(32);
  const K: Record<'F1' | 'F2', Uint8Array> = { F1: kF1, F2: kF2 };
  const bank = new Map(paper.bank.items.map((i) => [i.id, i]));
  const papers: Record<string, Uint8Array> = {}, forms: ManifestForm[] = [];
  for (const form of ['F1', 'F2'] as const) {
    const order = paper.forms[form];
    if (!Array.isArray(order)) throw new Error(`forms.json has no ${form}`);
    const items = order.map((id: string) => { const it = bank.get(id); if (!it) throw new Error(`${form} names ${id}, which is not in the bank`); return it; });
    papers[form] = sealPaper(K[form], { ...X, form }, utf8(JSON.stringify({ exam: dir.exam, form, items })));
    forms.push({ form, ciphertextHash: ciphertextHash(papers[form]), kcf: kcf(K[form]) });
  }
  const codeList: Record<string, string> = {}, wraps: Record<string, string> = {};
  for (const centre of Object.keys(dir.centres).sort()) {
    codeList[centre] = newOfflineCode();                                          // 80 bits; only this centre, only this shift
    wraps[centre] = toHex(wrapForCentre(codeList[centre], { ...X, centre }, kF1, kF2));
  }
  const raw = await splitBundle({ kF1, kF2, L });
  const shares: Record<string, ShareFile> = {}, passphrases: Record<string, string> = {};
  CUSTODIANS.forEach((c, i) => { passphrases[c] = newOfflineCode(); shares[c] = sealShareFile(raw[i], passphrases[c], { ...X, custodian: c }); });
  const manifest: Manifest = { ...X, forms, ts: now };
  return {
    manifest: { manifest, sig: toHex(signer(authority)(msg(manifestArray(manifest)))) },
    papers, wraps, codes: sealCodes(L, X.exam, X.shift, codeList), shares, passphrases, secrets: [kF1, kF2, L, ...raw],
  };
}

export function writePackage(root: string, p: Package): void {
  const write = (rel: string, data: string | Uint8Array) => { const f = join(root, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, data); };
  write(FILES.manifest, JSON.stringify(p.manifest, null, 2));
  for (const [form, ct] of Object.entries(p.papers)) write(FILES.paper(form), ct);
  write(FILES.wraps, JSON.stringify(p.wraps));
  write(FILES.codes, p.codes);
  for (const [c, f] of Object.entries(p.shares)) write(FILES.share(c), JSON.stringify(f, null, 2));
}

/** Best effort in a garbage-collected runtime: the key bytes are overwritten; the code strings go with the package object. */
export function zeroise(p: Package): void {
  for (const s of p.secrets) s.fill(0);
  for (const k of Object.keys(p.passphrases)) delete p.passphrases[k];
}

if (import.meta.main) {
  const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
  const root = resolve(arg('--exam') ?? 'data/exam');
  if (existsSync(join(root, FILES.manifest))) throw new Error(`${root} is already packaged`);
  const fx = resolve(import.meta.dirname, '../fixtures');
  const paper = resolve(arg('--paper') ?? join(fx, 'paper'));
  const read = (f: string) => JSON.parse(readFileSync(f, 'utf8'));
  const keys = read(join(fx, 'keys.json')) as KeysFile;
  const p = await buildPackage(read(join(root, FILES.directory)) as Directory, { bank: read(join(paper, 'bank.json')), forms: read(join(paper, 'forms.json')) },
    { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) });
  writePackage(root, p);
  console.log('Manifest (the public commitment):');
  for (const f of p.manifest.manifest.forms) console.log(`  ${f.form}  kc_f ${f.kcf}  ciphertext ${f.ciphertextHash}`);
  console.log('Custodian passphrases — shown ONCE. Hand each one to its custodian with their share file:');
  for (const c of CUSTODIANS) console.log(`  ${c}: ${p.passphrases[c]}   (${FILES.share(c)})`);
  zeroise(p);
  console.log('packager: K_F1, K_F2, L, the offline codes and the shares are zeroised in this process (best effort in a garbage-collected runtime).');
}
