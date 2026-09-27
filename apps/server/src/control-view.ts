import type { Finding, ReconRow } from '@saakshi/core/sheet';

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
