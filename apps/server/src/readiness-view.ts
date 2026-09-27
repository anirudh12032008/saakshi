// The readiness board (plan §3.11, Act 1), pure and browser-safe: each centre is as bad as its worst seat. A seat that has not
// reported is "missing"; a report older than staleMs counts as review (we do not know it is still clean).
import type { IntegrityFinding, SignedReadiness, Verdict } from '@saakshi/core/integrity';

export interface SeatRow { cand: string; seatId: string; verdict: Verdict; at: number; findings: IntegrityFinding[]; stale: boolean }
export interface CentreReadiness { centre: string; verdict: Verdict; counts: Record<Verdict, number>; missing: number; seats: SeatRow[] }
export interface ReadinessBoard { at: number; centres: CentreReadiness[] }
export const VERDICT_WORD: Record<Verdict, string> = { green: 'Ready', amber: 'Amber', review: 'Review', block: 'Blocked' };
const RANK: Record<Verdict, number> = { green: 0, amber: 1, review: 2, block: 3 };

export function readinessBoard(o: { at: number; centre: string; roster: string[]; seats: SignedReadiness[]; staleMs: number }): CentreReadiness {
  const rows: SeatRow[] = o.seats.filter((s) => o.roster.includes(s.r.cand)).map(({ r }) => {
    const stale = o.at - r.at > o.staleMs;
    return { cand: r.cand, seatId: r.seatId, at: r.at, findings: r.findings, stale, verdict: stale && r.verdict !== 'block' ? 'review' : r.verdict };
  }).sort((a, b) => RANK[b.verdict] - RANK[a.verdict] || a.cand.localeCompare(b.cand));
  const counts: Record<Verdict, number> = { green: 0, amber: 0, review: 0, block: 0 };
  for (const r of rows) counts[r.verdict]++;
  const verdict = rows.reduce<Verdict>((w, r) => (RANK[r.verdict] > RANK[w] ? r.verdict : w), 'green');
  return { centre: o.centre, verdict, counts, missing: o.roster.length - rows.length, seats: rows };
}

export function seatLine(r: SeatRow): string {
  const names = [...new Set(r.findings.filter((f) => f.level !== 'info').flatMap((f) => f.names.length ? f.names : [f.code]))];
  return `${r.cand} · ${r.seatId} · ${VERDICT_WORD[r.verdict]}${r.stale ? ' (no recent report)' : ''}${names.length ? ` — ${names.join(', ')}` : ''}`;
}
