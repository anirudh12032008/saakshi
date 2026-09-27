import type { Finding, ReconRow } from '@saakshi/core/sheet';
import type { CentreTile, FleetView, ReleaseStatus } from '@saakshi/core/directory';
import type { Manifest } from '@saakshi/core/paper';

export interface ReconCell { label: string; value: string; ok: boolean }

/** One reconciliation row as table cells, in the page's column order. */
export function reconCells(r: ReconRow): ReconCell[] {
  return [
    { label: 'Registered', value: String(r.registered), ok: true },
    { label: 'Checked in', value: String(r.checkedIn), ok: r.checkedIn <= r.registered },
    { label: 'Unlocked', value: String(r.unlocked), ok: r.unlocked <= r.checkedIn },
    { label: 'Submitted', value: String(r.submitted), ok: r.submitted <= r.unlocked },
    { label: 'Receipts', value: String(r.receipts), ok: r.receipts === r.submitted },
    { label: 'Register leaves', value: String(r.leaves), ok: r.leaves === r.receipts },
    { label: 'Relay = cell heads', value: r.headsEqual ? 'all equal' : r.headMismatches.join('; '), ok: r.headsEqual },
  ];
}

export const findingText = (f: Finding): string =>
  `${f.cand} · ${f.seq ? `entry ${f.seq}` : 'whole chain'} · ${f.kind}: ${f.detail}` + (f.recovered ? ` → recovered from ${f.recovered.from}: ${f.recovered.value}` : '');

export function headline(fs: Finding[]): string {
  if (!fs.length) return 'No tampering found: every record matches what the seats committed.';
  return (fs.find((f) => f.kind === 'body') ?? { detail: findingText(fs[0]) }).detail;
}

export const fmt = (n: number): string => n.toLocaleString('en-IN');
export const group = (s: string, n = 4): string => s.replace(new RegExp(`(.{${n}})(?=.)`, 'g'), '$1 ');
const utc = (ms: number): string => `${new Date(ms).toISOString().slice(11, 19)} UTC`;

export function kpis(f: FleetView): { label: string; value: string }[] {
  return [
    { label: 'Candidates registered', value: fmt(f.registered) },
    { label: 'Seats bound', value: fmt(f.bound) },
    { label: 'Paper unlocked', value: fmt(f.unlocked) },
    { label: 'Submitted', value: fmt(f.submitted) },
    { label: 'Entries per second', value: fmt(f.entriesPerSec) },
  ];
}

const WORD = { green: 'All unlocked', partial: 'Unlocking', locked: 'Locked', down: 'Exam server down' } as const;
export function tileText(t: CentreTile): { title: string; line: string; word: string; aria: string } {
  const word = WORD[t.tone];
  return { title: t.centre, line: `${fmt(t.unlocked)} / ${fmt(t.registered)} unlocked`, word,
    aria: `${t.centre}: ${word}, ${t.unlocked} of ${t.registered} unlocked, ${t.bound} bound, ${t.submitted} submitted, on ${t.cell}` };
}

export function fleetSummary(f: FleetView): string {
  return `${f.centres.filter((c) => c.tone === 'green').length} of ${f.centres.length} centres green · ${f.cells.filter((c) => c.state === 'LIVE').length} of ${f.cells.length} exam servers live`;
}

export function releaseLines(s: ReleaseStatus): string[] {
  const lines = [`Release key ${group(s.keyId)} — held in memory only; confirm this fingerprint with each custodian by phone.`];
  if (!s.released) lines.push(`Shares received: ${s.received.length ? s.received.join(', ') : 'none'} — ${Math.max(0, s.needed - s.received.length)} more needed.`);
  else {
    lines.push(`Released at ${utc(s.released.at)} by ${s.released.custodians.join(' + ')}.`);
    lines.push(s.zeroised ? 'Every exam server has the release; control has zeroised the keys.' : `Pushing to the exam servers: ${Object.entries(s.pushed).map(([c, ok]) => `${c} ${ok ? '✓' : '…'}`).join(' · ')}`);
  }
  for (const r of s.reveals) lines.push(`Offline code for ${r.centre} revealed to superintendent ${r.superintendent} at ${utc(r.at)} (logged).`);
  return lines;
}

export const commitment = (m: Manifest): string[] =>
  m.forms.map((f) => `${f.form}: kc_f ${group(f.kcf.slice(0, 16))} … · ciphertext ${group(f.ciphertextHash.slice(0, 16))} …`);
