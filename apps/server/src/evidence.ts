// One-click evidence pack (plan §3.7): printable report, BSA 2023 s.63 certificate TEMPLATE, the proof, the STH,
// audit findings, the chain-of-custody log, the offline verifier and a SHA-256 manifest — as files and as one .tar.gz.
import { createHash } from 'node:crypto';
import { parseSignedLine } from '@saakshi/core/journal';
import { verifier } from '@saakshi/core/node';
import type { Finding, Forms, Proof, Trust } from '@saakshi/core/sheet';
import { mismatchText, verifyProof, type SheetReport } from '@saakshi/core/verify';

export interface PackIn { proof: Proof; findings: Finding[]; custody: string[]; verifyHtml: string; forms: Forms; trust: Trust; now: number }
export interface Pack { name: string; files: Record<string, string>; tgz: Uint8Array }

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const page = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
body{font:14px/1.5 system-ui,sans-serif;color:#202124;max-width:60rem;margin:1.5rem auto;padding:0 1rem}
h1{font-size:1.5rem}h2{font-size:1.125rem;margin-top:1.5rem}table{border-collapse:collapse;width:100%}
th,td{border:1px solid #bbb;padding:.25rem .5rem;text-align:left;vertical-align:top}code{font:12px ui-monospace,Menlo,monospace;overflow-wrap:anywhere}
.bad{color:#b3261e;font-weight:700}.good{color:#1e6b25;font-weight:700}.blank{display:inline-block;min-width:16rem;border-bottom:1px solid #202124}
.note{border:1px solid #b06000;background:#fef7e0;padding:.5rem .75rem}@media print{.note{border-color:#000;background:none}}
</style></head><body>${body}</body></html>
`;

const readme = (name: string) => `Saakshi evidence pack ${name}

1. Check integrity:   shasum -a 256 -c manifest.sha256     (Windows: CertUtil -hashfile <file> SHA256)
2. Verify offline:    open verify.html in any browser, choose proof.json, type the receipt code from the slip.
                      It needs no network and pins the exam authority's public key.
3. Read:              report.html (what was checked, entry by entry) and certificate-s63.html (to be completed and signed).

proof.json      the official response sheet (entries, signatures, bodies with salts), the signed register head and the inclusion proof
sth.json        the signed register head (STH) alone
audit.json      the audit findings for this candidate
custody.jsonl   the chain-of-custody log up to this export
`;

function reportHtml(p: PackIn, r: SheetReport): string {
  const { sheet, sth, index, inclusion } = p.proof;
  const { ctx } = sheet;
  const form = p.forms[sheet.form] ?? [];
  const bad = new Set(r.mismatches.map((m) => m.seq));
  const rows = sheet.entries.map((e) => {
    const l = parseSignedLine(e.line);
    const [, item = '', state = '', answer = ''] = e.body;
    const seq = l.ok ? l.header.seq : '?';
    const q = typeof item === 'string' && form.indexOf(item) >= 0 ? `Q${form.indexOf(item) + 1} (${item})` : '';
    const sig = e.line.match(/"([0-9a-f]{128})"\]$/)?.[1] ?? '';
    return `<tr><td>${esc(seq)}</td><td>${esc(l.ok ? l.header.kind : 'unparseable')}</td><td>${esc(q)}</td><td>${esc(state)} ${esc(answer)}</td>`
      + `<td class="${bad.has(Number(seq)) ? 'bad">✗ differs' : 'good">✓ matches'}</td><td><code>${esc(sig)}</code></td></tr>`;
  }).join('\n');
  const verdict = r.ok ? 'The record matches what the seat committed.' : r.mismatches.length ? mismatchText(r.mismatches[0]) : 'The record does not verify.';
  return page(`Evidence report — ${ctx.cand}`, `
<h1>Evidence report: ${esc(ctx.cand)} · ${esc(ctx.exam)} · ${esc(ctx.shift)} · attempt ${esc(ctx.attempt)}</h1>
<p class="${r.ok ? 'good' : 'bad'}">${esc(verdict)}</p>
${r.mismatches.slice(1).map((m) => `<p class="bad">${esc(mismatchText(m))}</p>`).join('')}
<h2>Checks</h2>
<table><tr><th>Check</th><th>Result</th><th>Detail</th></tr>
${r.checks.map((c) => `<tr><td>${esc(c.name)}</td><td class="${c.ok ? 'good">pass' : 'bad">fail'}</td><td>${esc(c.detail)}</td></tr>`).join('\n')}</table>
<h2>Receipt</h2>
<p>Recomputed from the committed record: <code>${esc(r.receipt?.code ?? 'none')}</code> · attempted ${esc(r.receipt?.attempted ?? '–')} · answered ${esc(r.receipt?.answered ?? '–')} · marked ${esc(r.receipt?.marked ?? '–')}.
Cell countersignature: <code>${esc(sheet.receipt?.sig ?? 'none')}</code> (${esc(sheet.receipt?.cell ?? '')}).</p>
<h2>Sealed register</h2>
<p>STH: ${esc(sth.sth.size)} leaves · root <code>${esc(sth.sth.root)}</code> · prevSTH <code>${esc(sth.sth.prevSTH)}</code> · issued ${esc(new Date(sth.sth.ts).toISOString())}<br>
Authority signature <code>${esc(sth.sig)}</code><br>
This submission is leaf ${esc(index + 1)}; inclusion path: ${inclusion.map((h) => `<code>${esc(h)}</code>`).join(' ') || '(single leaf)'}</p>
<h2>Entries as recorded (${esc(sheet.entries.length)})</h2>
<table><tr><th>Seq</th><th>Kind</th><th>Question</th><th>Recorded state / answer</th><th>vs. seat's commitment</th><th>Seat signature (P-256, IEEE-P1363)</th></tr>
${rows}</table>
<h2>Audit findings</h2>
${p.findings.length ? `<ul>${p.findings.map((f) => `<li>entry ${esc(f.seq)} · ${esc(f.kind)}: ${esc(f.detail)}${f.recovered ? ` — recovered from ${esc(f.recovered.from)}: ${esc(f.recovered.value)}` : ''}</li>`).join('')}</ul>` : '<p>None.</p>'}
<p>Check it yourself: open <code>verify.html</code> (offline) and load <code>proof.json</code>.</p>`);
}

const DESCRIBE: Record<string, string> = {
  'proof.json': 'Official response sheet with signed entries, recorded bodies and salts; signed register head; inclusion proof',
  'sth.json': 'Signed register head (STH) of the sealed per-shift log',
  'audit.json': 'Audit findings for this candidate',
  'custody.jsonl': 'Chain-of-custody log up to this export',
  'report.html': 'Human-readable verification report',
  'verify.html': 'Offline verifier used to check the records',
  'README.txt': 'How to check this pack',
};

function certificateHtml(p: PackIn, hashes: Record<string, string>): string {
  const { ctx } = p.proof.sheet;
  const rows = Object.keys(DESCRIBE).filter((f) => hashes[f]).map((f) => `<tr><td><code>${esc(f)}</code></td><td>${esc(DESCRIBE[f])}</td><td><code>${esc(hashes[f])}</code></td></tr>`).join('\n');
  const blank = '<span class="blank">&nbsp;</span>';
  return page(`Certificate under Section 63 — ${ctx.cand}`, `
<h1>Certificate under Section 63(4)(c), Bharatiya Sakshya Adhiniyam, 2023</h1>
<p class="note">TEMPLATE generated by Saakshi on ${esc(new Date(p.now).toISOString())}. It must be completed, reviewed by counsel and signed by the responsible persons before use. It is not legal advice.</p>
<h2>Part A — to be completed by the party producing the electronic records</h2>
<p>I, ${blank} (name), ${blank} (designation), of ${blank} (organisation), state as follows:</p>
<ol>
<li>The electronic records listed below relate to candidate roll number ${esc(ctx.cand)}, examination ${esc(ctx.exam)}, shift ${esc(ctx.shift)}, attempt ${esc(ctx.attempt)}.</li>
<li>They were produced by the Saakshi examination system (seat application, centre relay, exam cell and control) running on computer systems under my lawful control, in the ordinary course of conducting the examination.</li>
<li>Throughout the material period these systems were operating properly, or any period in which they were not did not affect the accuracy of these records. Details, if any: ${blank}</li>
<li>Each record is identified below by its hash value, computed with the SHA-256 algorithm. Anyone can recompute these values to confirm that a copy is identical.</li>
<li>The chain of custody of the records is set out in <code>custody.jsonl</code>.</li>
</ol>
<table><tr><th>File</th><th>Description</th><th>SHA-256</th></tr>
${rows}</table>
<p>Signature: ${blank} &nbsp; Date: ${blank} &nbsp; Place: ${blank}</p>
<h2>Part B — to be completed by the expert</h2>
<p>I, ${blank} (name), ${blank} (designation and qualification), have examined the electronic records listed in Part A and state:</p>
<ol>
<li>I computed the SHA-256 hash value of each record and it matches the value in Part A: &#9744; yes &#9744; no. Details: ${blank}</li>
<li>I checked the records with the offline verifier supplied with them (<code>verify.html</code>). Its result: ${blank}</li>
</ol>
<p>Signature: ${blank} &nbsp; Date: ${blank} &nbsp; Place: ${blank}</p>`);
}

export async function buildPack(p: PackIn): Promise<Pack> {
  const { ctx } = p.proof.sheet;
  const name = `evidence-${ctx.exam}-${ctx.shift}-${ctx.cand}-${stamp(p.now)}`;
  const report = verifyProof(p.proof, p.forms, p.trust, undefined, verifier);
  const files: Record<string, string> = {
    'README.txt': readme(name),
    'proof.json': JSON.stringify(p.proof, null, 2) + '\n',
    'sth.json': JSON.stringify(p.proof.sth, null, 2) + '\n',
    'audit.json': JSON.stringify(p.findings, null, 2) + '\n',
    'custody.jsonl': p.custody.map((l) => `${l}\n`).join(''),
    'verify.html': p.verifyHtml,
  };
  files['report.html'] = reportHtml(p, report);
  files['certificate-s63.html'] = certificateHtml(p, Object.fromEntries(Object.entries(files).map(([f, c]) => [f, sha(c)])));
  files['manifest.sha256'] = Object.keys(files).sort().map((f) => `${sha(files[f])}  ${f}`).join('\n') + '\n';
  const tgz = await new Bun.Archive(Object.fromEntries(Object.entries(files).map(([f, c]) => [`${name}/${f}`, c])), { compress: 'gzip' }).bytes();
  return { name, files, tgz };
}
