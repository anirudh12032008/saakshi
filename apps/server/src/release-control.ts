// Control's side of the T0 release (plan §3.3). An ephemeral release key held only in memory; custodian shares arrive sealed to
// it; once two DISTINCT custodians have sent theirs, control rebuilds {K_F1, K_F2, L}, checks both keys against the manifest's
// kc_f, signs a release per form and pushes it to every cell (retrying until each has it), then zeroises the keys. The offline
// code list stays in memory for the phoned-in fallback; each reveal is logged. Nothing secret is written to disk.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { openBox } from '@saakshi/core/box';
import { combineBundle } from '@saakshi/core/custody';
import { CUSTODIANS, type ReleaseStatus } from '@saakshi/core/directory';
import { cellKeyId, msg } from '@saakshi/core/enrol';
import { nativeBox, newKeyPair, signer, type KeyPair } from '@saakshi/core/node';
import { openCodes, releaseArray, shareInfo, type ReleaseMsg, type SignedManifest } from '@saakshi/core/paper';
import { kcf } from '@saakshi/core/protocol';
import type { Routes } from './serve.ts';

export interface ReleaseCtlOpts {
  dir: string; exam: string; shift: string; authority: KeyPair; manifest: SignedManifest; codes: Uint8Array;
  cells: { id: string; url: string }[];
  push?: (url: string, releases: ReleaseMsg[]) => Promise<void>;
  now?: () => number; retryMs?: number;
}
const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function httpPush(url: string, releases: ReleaseMsg[]): Promise<void> {
  const r = await fetch(`${url}/v1/release`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ releases }), signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`${url} answered ${r.status}: ${await r.text()}`);
}

export function releaseControl(o: ReleaseCtlOpts) {
  const now = o.now ?? Date.now, push = o.push ?? httpPush, m = o.manifest.manifest;
  mkdirSync(o.dir, { recursive: true });
  const custody = (action: string, detail: Record<string, unknown> = {}) =>
    appendFileSync(join(o.dir, 'custody.jsonl'), JSON.stringify({ at: new Date(now()).toISOString(), actor: 'control (DEV)', action, exam: o.exam, shift: o.shift, ...detail }) + '\n');

  const eph: KeyPair = newKeyPair();                     // ponytail: control restarting before T0 needs a new key; custodians re-send
  const keyId = cellKeyId(eph.pub);                      // same fingerprint rule as cell keys (first 16 hex of SHA-256(pub))
  const shares = new Map<string, Uint8Array>();
  const received: string[] = [];
  const pushed: Record<string, boolean> = Object.fromEntries(o.cells.map((c) => [c.id, false]));
  const reveals: ReleaseStatus['reveals'] = [];
  let released: ReleaseStatus['released'];
  let codes: Record<string, string> | undefined;
  let pending: ReleaseMsg[] = [];
  let zeroised = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  custody('release-key', { keyId });

  const status = (): ReleaseStatus => ({ exam: o.exam, shift: o.shift, keyId, custodians: [...CUSTODIANS], received: [...received], needed: 2, released, pushed: { ...pushed }, zeroised, reveals: [...reveals], manifest: m });

  async function pushAll(): Promise<void> {
    timer = undefined;
    for (const c of o.cells) {
      if (pushed[c.id]) continue;
      try { await push(c.url, pending); pushed[c.id] = true; custody('release-pushed', { cell: c.id }); }
      catch (e) { custody('release-push-failed', { cell: c.id, error: (e as Error).message }); }
    }
    if (Object.values(pushed).every(Boolean)) {
      pending = [];                                      // the keys now live only in cells, relays and seats: the paper is out
      zeroised = true;
      custody('keys-zeroised', { note: 'control holds no paper key (best effort in a garbage-collected runtime)' });
    } else timer = setTimeout(() => void pushAll(), o.retryMs ?? 2000);
  }

  /** Any pair of distinct custodians whose shares rebuild both committed keys releases the paper. */
  async function tryRelease(): Promise<boolean> {
    const got = [...shares.entries()];
    for (let i = 0; i < got.length; i++) for (let j = i + 1; j < got.length; j++) {
      let b;
      try { b = await combineBundle([got[i][1], got[j][1]]); } catch { continue; }
      if (released) { b.kF1.fill(0); b.kF2.fill(0); b.L.fill(0); return true; }   // a concurrent share (double click) released during the await
      const K: Record<string, Uint8Array> = { F1: b.kF1, F2: b.kF2 };
      if (!m.forms.every((f) => K[f.form] && kcf(K[f.form]) === f.kcf)) { b.kF1.fill(0); b.kF2.fill(0); b.L.fill(0); continue; }
      const at = now(), sign = signer(o.authority);
      pending = m.forms.map((f) => {
        const r = { exam: o.exam, shift: o.shift, form: f.form, kcf: f.kcf, ts: at };
        return { ...r, key: toHex(K[f.form]), sig: toHex(sign(msg(releaseArray(r)))), via: 'push' as const };
      });
      codes = openCodes(b.L, o.exam, o.shift, o.codes);
      released = { at, custodians: [got[i][0], got[j][0]], forms: m.forms.map((f) => ({ form: f.form, kcf: f.kcf })) };
      for (const x of [b.kF1, b.kF2, b.L, ...shares.values()]) x.fill(0);
      shares.clear();
      custody('release', { custodians: released.custodians, forms: released.forms });
      await pushAll();
      return true;
    }
    return false;
  }

  const routes: Routes = {
    '/v1/manifest': { GET: () => json(o.manifest) },
    '/v1/release/key': { GET: () => json({ exam: o.exam, shift: o.shift, keyId, pub: toHex(eph.pub) }) },
    '/v1/release/status': { GET: () => json(status()) },
    '/v1/release/share': { POST: async (req) => {
      const b = (await req.json().catch(() => null)) as { custodian?: unknown; keyId?: unknown; box?: unknown } | null;
      const c = typeof b?.custodian === 'string' ? b.custodian : '';
      if (!(CUSTODIANS as readonly string[]).includes(c)) return json({ error: `custodian must be one of ${CUSTODIANS.join(', ')}` }, 400);
      if (b!.keyId !== keyId) return json({ error: 'That share was sealed to an old release key. Reload the custodian page and send it again.' }, 409);
      if (released) { custody('share-after-release', { custodian: c }); return json(status()); }
      let share: Uint8Array;
      try { share = openBox(eph.priv, shareInfo(o.exam, o.shift, c, keyId), hexToBytes(String(b!.box)), nativeBox); }
      catch { return json({ error: 'The share does not open with control\'s release key.' }, 400); }
      if (share.length !== 97) return json({ error: 'A share is 97 bytes.' }, 400);
      shares.get(c)?.fill(0);
      shares.set(c, share);                              // one custodian twice is still one custodian
      if (!received.includes(c)) received.push(c);
      custody('share-received', { custodian: c });
      if (shares.size >= 2 && !(await tryRelease())) {
        custody('shares-rejected', { custodians: [...shares.keys()] });
        return json({ ...status(), error: 'These shares do not rebuild the committed keys: one is damaged or from another exam. A third custodian can still release.' }, 409);
      }
      return json(status());
    } },
    '/v1/release/code': { POST: async (req) => {
      const b = (await req.json().catch(() => null)) as { centre?: unknown; superintendent?: unknown; callback?: unknown } | null;
      if (!codes) return json({ error: 'The offline codes stay sealed until two custodians release the paper.' }, 409);
      const centre = String(b?.centre ?? ''), sup = String(b?.superintendent ?? '').trim();
      if (!sup || sup.length > 64 || b?.callback !== true) return json({ error: 'Need the superintendent\'s ID and a confirmed call-back to the registered number.' }, 400);
      const code = codes[centre];
      if (!code) return json({ error: `No centre ${centre} in this shift.` }, 400);
      const at = now();
      reveals.push({ at, centre, superintendent: sup });
      custody('offline-code-revealed', { centre, superintendent: sup, note: 'this centre only, this shift only' });
      return json({ centre, shift: o.shift, code, at });
    } },
  };
  return { routes, status, close: () => clearTimeout(timer) };
}
