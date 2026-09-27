// The paper package a seat takes from its relay at T−1 h (plan §3.3): the signed policy, the signed manifest (the public
// commitment) and the paper ciphertexts. Everything is checked against the exam authority's key built into the app, and a seat
// never runs on an unsigned policy. Nothing here is readable before T0.
import { existsSync, readFileSync } from 'node:fs';
import { verifier } from '@saakshi/core/node';
import { checkManifest, ciphertextHash, type Manifest, type SignedManifest } from '@saakshi/core/paper';
import { openPolicy, type Policy, type SignedPolicy } from '@saakshi/core/policy';
import { fromB64 } from '@saakshi/core/wire';
import { writeDurable } from './journal-store.ts';

export interface PackageWire { policy: SignedPolicy; manifest: SignedManifest; paper: Record<string, string> }
export interface SeatPackage { policy: Policy; manifest: Manifest; papers: Record<string, Uint8Array> }

export function verifyPackage(raw: unknown, authorityPub: Uint8Array, want: { exam: string; shift: string; cand: string }): SeatPackage {
  const w = raw as PackageWire;
  const authority = verifier(authorityPub);
  const policy = openPolicy(w?.policy, authority, want);
  const manifest = checkManifest(w.manifest, authority);
  if (manifest.exam !== want.exam || manifest.shift !== want.shift) throw new Error(`the manifest is for ${manifest.exam} ${manifest.shift}`);
  const papers: Record<string, Uint8Array> = {};
  for (const f of manifest.forms) {
    const b64 = w.paper?.[f.form];
    if (typeof b64 !== 'string') throw new Error(`the package has no paper for ${f.form}`);
    papers[f.form] = fromB64(b64);
    if (ciphertextHash(papers[f.form]) !== f.ciphertextHash) throw new Error(`the ${f.form} paper is not the one the manifest commits to`);
  }
  const me = policy.roster[want.cand];
  if (!me) throw new Error(`${want.cand} is not on ${policy.centre}'s roster`);
  if (!papers[me.form]) throw new Error(`the manifest has no form ${me.form}`);
  return { policy, manifest, papers };
}

export async function loadPackage(o: { path: string; relayUrl: string; authorityPub: Uint8Array; want: { exam: string; shift: string; cand: string }; fetch?: typeof fetch }): Promise<SeatPackage> {
  if (existsSync(o.path)) return verifyPackage(JSON.parse(readFileSync(o.path, 'utf8')), o.authorityPub, o.want);
  const r = await (o.fetch ?? fetch)(new URL('/v1/package', o.relayUrl), { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`the centre server answered ${r.status}`);
  const text = await r.text();
  const pkg = verifyPackage(JSON.parse(text), o.authorityPub, o.want);
  writeDurable(o.path, new TextEncoder().encode(text));                           // only a package that verified is kept
  return pkg;
}
