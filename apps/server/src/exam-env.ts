// Loads an exam directory written by tools/provision.ts and tools/package.ts, checking every certificate and the manifest against
// the exam authority's key. A node refuses to start on a directory that does not verify.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import { FILES, type CellEntry, type CellKeyFile, type Directory } from '@saakshi/core/directory';
import { cellKeyArray, cellKeyId, msg } from '@saakshi/core/enrol';
import { verifier } from '@saakshi/core/node';
import { checkManifest, type SignedManifest } from '@saakshi/core/paper';
import type { SignedPolicy } from '@saakshi/core/policy';
import type { Verify } from '@saakshi/core/sig';

export interface ExamEnv { root: string; dir: Directory; manifest: SignedManifest; authority: Verify }
const readJson = <T>(root: string, rel: string): T => JSON.parse(readFileSync(join(root, rel), 'utf8')) as T;

export function loadExam(root: string, authorityPub: Uint8Array): ExamEnv {
  const authority = verifier(authorityPub);
  const dir = readJson<Directory>(root, FILES.directory);
  const manifest = readJson<SignedManifest>(root, FILES.manifest);
  const m = checkManifest(manifest, authority);
  if (m.exam !== dir.exam || m.shift !== dir.shift) throw new Error(`the package is for ${m.exam} ${m.shift}, the directory for ${dir.exam} ${dir.shift}`);
  for (const c of dir.cells) {
    const ok = cellKeyId(hexToBytes(c.pub)) === c.keyId && /^[0-9a-f]{128}$/.test(c.cert)
      && authority(msg(cellKeyArray({ exam: dir.exam, cellId: c.id, keyId: c.keyId, pub: c.pub })), hexToBytes(c.cert));
    if (!ok) throw new Error(`the certificate for ${c.id} does not verify`);
  }
  return { root, dir, manifest, authority };
}

/** A cell's private key: from its key file (outside the DB), which must hold exactly the key the directory certifies. */
export function loadCellKey(env: ExamEnv, id: string): { id: string; keyId: string; priv: Uint8Array; pub: Uint8Array } {
  const e = env.dir.cells.find((c) => c.id === id);
  if (!e) throw new Error(`no cell ${id} in the directory`);
  const f = readJson<CellKeyFile>(env.root, FILES.cellKey(id));
  if (f.pub !== e.pub || f.keyId !== e.keyId) throw new Error(`${FILES.cellKey(id)} is not the key the directory certifies`);
  return { id, keyId: f.keyId, priv: hexToBytes(f.priv), pub: hexToBytes(f.pub) };
}

/** What a centre's relay holds: its signed policy, both paper ciphertexts, its own wrap W_c, and its cell's entry. */
export function relayFiles(env: ExamEnv, centre: string): { policy: SignedPolicy; papers: Record<string, Uint8Array>; wrap: Uint8Array; cell: CellEntry } {
  const c = env.dir.centres[centre];
  if (!c) throw new Error(`no centre ${centre} in the directory`);
  const wraps = readJson<Record<string, string>>(env.root, FILES.wraps);
  if (!wraps[centre]) throw new Error(`the package has no wrap for ${centre}`);
  const papers = Object.fromEntries(env.manifest.manifest.forms.map((f) => [f.form, new Uint8Array(readFileSync(join(env.root, FILES.paper(f.form))))]));
  return { policy: readJson<SignedPolicy>(env.root, FILES.policy(centre)), papers, wrap: hexToBytes(wraps[centre]), cell: env.dir.cells.find((x) => x.id === c.cell)! };
}

export const codesFile = (env: ExamEnv): Uint8Array => new Uint8Array(readFileSync(join(env.root, FILES.codes)));
