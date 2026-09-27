import type { ReleaseStatus } from '@saakshi/core/directory';
import { fingerprint, parseShareFile, shareRequest, statusText, type ReleaseKey } from './custodian-view.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let key: ReleaseKey | undefined;
async function get<T>(path: string): Promise<T> { const r = await fetch(path); if (!r.ok) throw new Error(`control answered ${r.status}`); return (await r.json()) as T; }
const show = (s: ReleaseStatus) => { $('result').textContent = statusText(s); $('result').className = s.released ? 'good' : ''; };

async function refresh(): Promise<void> {
  try {
    key ??= await get<ReleaseKey>('/v1/release/key');
    $('fp').textContent = fingerprint(key.keyId);
    show(await get<ReleaseStatus>('/v1/release/status'));
  } catch (e) { $('result').textContent = `Cannot reach control: ${(e as Error).message}`; }
}

$('form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  $('error').textContent = '';
  const pass = $<HTMLInputElement>('pass');
  try {
    if (!key) throw new Error("Control's release key is not loaded yet.");
    const file = $<HTMLInputElement>('file').files?.[0];
    if (!file) throw new Error('Choose your share file.');
    const body = shareRequest(parseShareFile(await file.text()), pass.value, key);
    const r = await fetch('/v1/release/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as ReleaseStatus & { error?: string };
    if (r.status === 409 && !j.received) key = undefined;                          // control restarted: a new release key
    if (!r.ok) throw new Error(j.error ?? `control answered ${r.status}`);
    show(j);
  } catch (e) { $('error').textContent = (e as Error).message; }
  finally { pass.value = ''; }
});

void refresh();
setInterval(refresh, 2000);
