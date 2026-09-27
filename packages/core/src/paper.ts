// Split-custody paper release (plan §3.3, protocol Addendum B.2, B.6, B.7): the manifest (the public commitment), control's
// release, the paper and code-list ciphertexts, custodian share files, and the check every seat runs before it unlocks.
// Browser-safe.
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { scrypt } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concat, hexToBytes, randomBytes, toHex, utf8 } from './bytes.ts';
import { canon, type Canon } from './canon.ts';
import { msg, SCRYPT } from './enrol.ts';
import { kcf } from './protocol.ts';
import type { Verify } from './sig.ts';

const HEX64 = /^[0-9a-f]{64}$/, SIG = /^[0-9a-f]{128}$/;

export interface ManifestForm { form: string; ciphertextHash: string; kcf: string }
export interface Manifest { exam: string; shift: string; forms: ManifestForm[]; ts: number }
export interface SignedManifest { manifest: Manifest; sig: string }
export const manifestArray = (m: Manifest): Canon[] =>
  ['manifest', m.exam, m.shift, [...m.forms].sort((a, b) => (a.form < b.form ? -1 : a.form > b.form ? 1 : 0)).map((f) => [f.form, f.ciphertextHash, f.kcf]), m.ts];

/** Shape and authority signature; returns the manifest. */
export function checkManifest(sm: SignedManifest, authority: Verify): Manifest {
  const m = sm?.manifest;
  if (!m || typeof m.exam !== 'string' || typeof m.shift !== 'string' || !Number.isSafeInteger(m.ts) || !Array.isArray(m.forms) || !m.forms.length
    || !m.forms.every((f) => typeof f?.form === 'string' && HEX64.test(f.ciphertextHash) && HEX64.test(f.kcf))
    || typeof sm.sig !== 'string' || !SIG.test(sm.sig)) throw new Error('the manifest is malformed');
  if (!authority(msg(manifestArray(m)), hexToBytes(sm.sig))) throw new Error('the manifest signature does not verify');
  return m;
}

export interface Release { exam: string; shift: string; form: string; kcf: string; ts: number }
export const releaseArray = (r: Release): Canon[] => ['release', r.exam, r.shift, r.form, r.kcf, r.ts];
/** A release on the wire: control's signed release plus the key. On the offline-code path sig is '' and via is 'code'. */
export interface ReleaseMsg extends Release { key: string; sig: string; via: 'push' | 'code' }

/** Shape only (untrusted input); checkRelease decides whether the key is any good. */
export function parseReleaseMsg(x: unknown): ReleaseMsg {
  const r = x as Record<string, unknown>;
  if (typeof r !== 'object' || r === null) throw new Error('release: not an object');
  const s = (k: string): string => { const v = r[k]; if (typeof v !== 'string' || v.length > 256) throw new Error(`release: bad ${k}`); return v; };
  if (!Number.isSafeInteger(r.ts) || (r.ts as number) < 0) throw new Error('release: bad ts');
  if (r.via !== 'push' && r.via !== 'code') throw new Error('release: bad via');
  return { exam: s('exam'), shift: s('shift'), form: s('form'), kcf: s('kcf'), ts: r.ts as number, key: s('key'), sig: s('sig'), via: r.via };
}

export type ReleaseCheck = { ok: true; key: Uint8Array } | { ok: false; error: string };
/**
 * B.7, the seat's check, on every path: kc_f(key) must equal the signed manifest's kc_f for this form. A release that carries a
 * signature must also verify under the authority key. The offline-code release carries none — the manifest binds its key anyway.
 */
export function checkRelease(r: ReleaseMsg, m: Manifest, form: string, authority: Verify): ReleaseCheck {
  const no = (error: string): ReleaseCheck => ({ ok: false, error });
  if (r.exam !== m.exam || r.shift !== m.shift || r.form !== form) return no(`the key is for ${r.exam} ${r.shift} ${r.form}, not ${m.exam} ${m.shift} ${form}`);
  const f = m.forms.find((x) => x.form === form);
  if (!f) return no(`the manifest has no form ${form}`);
  if (!HEX64.test(r.key)) return no('the key is not 32 bytes');
  const key = hexToBytes(r.key);
  if (kcf(key) !== f.kcf) return no('the key does not match the published commitment kc_f');
  if (r.sig && (r.kcf !== f.kcf || !SIG.test(r.sig) || !authority(msg(releaseArray(r)), hexToBytes(r.sig)))) return no('the release signature does not verify');
  return { ok: true, key };
}

// B.6 symmetric boxes: nonce(24) ‖ XChaCha20-Poly1305(key, nonce, AAD = UTF-8(canon(aad))).
function seal(key: Uint8Array, aad: Canon[], pt: Uint8Array): Uint8Array {
  const nonce = randomBytes(24);
  return concat(nonce, xchacha20poly1305(key, nonce, utf8(canon(aad))).encrypt(pt));
}
function open(key: Uint8Array, aad: Canon[], ct: Uint8Array): Uint8Array {
  if (ct.length < 24 + 16) throw new Error('ciphertext too short');
  return xchacha20poly1305(key, ct.subarray(0, 24), utf8(canon(aad))).decrypt(ct.subarray(24));
}

export interface FormCtx { exam: string; shift: string; form: string }
export const sealPaper = (K: Uint8Array, c: FormCtx, pt: Uint8Array): Uint8Array => seal(K, ['saakshi-paper', c.exam, c.shift, c.form], pt);
export const openPaper = (K: Uint8Array, c: FormCtx, ct: Uint8Array): Uint8Array => open(K, ['saakshi-paper', c.exam, c.shift, c.form], ct);
export const ciphertextHash = (ct: Uint8Array): string => toHex(sha256(ct));

export const sealCodes = (L: Uint8Array, exam: string, shift: string, codes: Record<string, string>): Uint8Array =>
  seal(L, ['saakshi-codes', exam, shift], utf8(JSON.stringify(codes)));
export const openCodes = (L: Uint8Array, exam: string, shift: string, ct: Uint8Array): Record<string, string> =>
  JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(open(L, ['saakshi-codes', exam, shift], ct))) as Record<string, string>;

/** A custodian's share, sealed under their passphrase (B.6). Held by the custodian as a file or printed QR — never by control. */
export interface ShareFile { v: 1; exam: string; shift: string; custodian: string; salt: string; N: number; r: number; p: number; box: string }
const normPass = (p: string): Uint8Array => utf8(p.replace(/[\s-]/g, '').toUpperCase());
export function sealShareFile(share: Uint8Array, pass: string, c: { exam: string; shift: string; custodian: string }): ShareFile {
  const salt = randomBytes(16);
  const box = seal(scrypt(normPass(pass), salt, SCRYPT), ['saakshi-custodian', c.exam, c.shift, c.custodian], share);
  return { v: 1, exam: c.exam, shift: c.shift, custodian: c.custodian, salt: toHex(salt), N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, box: toHex(box) };
}
export function openShareFile(f: ShareFile, pass: string): Uint8Array {
  if (f?.v !== 1 || f.N !== SCRYPT.N || f.r !== SCRYPT.r || f.p !== SCRYPT.p || typeof f.salt !== 'string' || typeof f.box !== 'string') throw new Error('not a Saakshi share file');
  try { return open(scrypt(normPass(pass), hexToBytes(f.salt), SCRYPT), ['saakshi-custodian', f.exam, f.shift, f.custodian], hexToBytes(f.box)); }
  catch { throw new Error('wrong passphrase, or the share file was altered'); }
}
/** B.4 info for a share sealed to control's in-memory release key. */
export const shareInfo = (exam: string, shift: string, custodian: string, keyId: string): Canon[] => ['saakshi-share', 1, exam, shift, custodian, keyId];
