// /verify in the browser: noble-only core, pinned public keys, golden vectors on load. Untrusted input is rendered as text only.
import formsJson from '../../../fixtures/paper/forms.json' with { type: 'json' };
import trustJson from '../../../fixtures/trust-dev.json' with { type: 'json' };
import V from '../../../fixtures/vectors/protocol-v1.json' with { type: 'json' };
import A from '../../../fixtures/vectors/protocol-v1-addendum-a.json' with { type: 'json' };
import { goldenSelfTest } from '@saakshi/core/selftest';
import { formsOf, type Proof, type Trust } from '@saakshi/core/sheet';
import { parseProof, verifyProof } from '@saakshi/core/verify';
import { viewOf } from './verify-view.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const forms = formsOf(formsJson as Record<string, unknown>);
const trust = trustJson as Trust;
const code = $<HTMLInputElement>('code');
let proof: Proof | undefined;

const st = goldenSelfTest(V, A);
$('selftest').textContent = st.fail.length
  ? `Golden vectors: ${st.fail.length} FAILED in this browser — do not rely on the result below (${st.fail.join('; ')})`
  : `Golden vectors: all ${st.pass} checks pass in this browser (protocol v1 + addendum A).`;
$('selftest').className = st.fail.length ? 'bad' : 'good';

function load(text: string, source: string): void {
  try {
    proof = parseProof(JSON.parse(text));
    const c = proof.sheet.ctx;
    $('loaded').textContent = `Loaded ${source}: candidate ${c.cand}, ${c.exam} ${c.shift}, ${proof.sheet.entries.length} entries.`;
  } catch (e) {
    proof = undefined;
    $('loaded').textContent = `Cannot read ${source}: ${(e as Error).message}`;
  }
  render();
}

function render(): void {
  const box = $('verdict'), table = $('checks');
  box.hidden = table.hidden = !proof;
  if (!proof) return;
  const v = viewOf(verifyProof(proof, forms, trust, code.value));
  box.className = v.verdict;
  $('title').textContent = v.title;
  $('headline').textContent = v.headline;
  $('more').replaceChildren(...v.more.map((m) => { const li = document.createElement('li'); li.textContent = m; return li; }));
  $('rows').replaceChildren(...v.rows.map((r) => {
    const tr = document.createElement('tr');
    const cells = [r.label, r.ok ? '✓ pass' : '✗ fail', r.detail].map((t) => { const td = document.createElement('td'); td.textContent = t; return td; });
    cells[1].className = `state ${r.ok ? 'good' : 'bad'}`;
    tr.append(...cells);
    return tr;
  }));
}

$<HTMLInputElement>('file').addEventListener('change', async (ev) => {
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (f) load(await f.text(), f.name);
});
code.addEventListener('input', render);
$('form').addEventListener('submit', (ev) => ev.preventDefault());

// Served by control: /verify?cand=C0001 loads that candidate's proof from the same origin. Opened from file://, nothing is fetched.
const cand = new URLSearchParams(location.search).get('cand');
if (location.protocol.startsWith('http') && cand) {
  fetch(`/v1/proof?cand=${encodeURIComponent(cand)}`)
    .then(async (r) => (r.ok ? r.text() : Promise.reject(new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`))))
    .then((t) => load(t, `the sealed register (${cand})`), (e) => { $('loaded').textContent = `Cannot load ${cand}: ${(e as Error).message}`; });
}
