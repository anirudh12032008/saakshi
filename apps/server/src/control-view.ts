import type { Finding, ReconRow } from '@saakshi/core/sheet';
import type { CentreTile, FleetView, ReleaseStatus } from '@saakshi/core/directory';
import type { Manifest } from '@saakshi/core/paper';
import type { Verdict } from '@saakshi/core/integrity';
import { RUNGS, type ArchiveReport, type Incident, type LinkView, type Notice, type Severity, type TimeRow } from '@saakshi/core/ops';
import type { RadarFlag, ScoreRow } from '@saakshi/core/analytics';
import { blastText, mmss } from './incidents.ts';
import type { CentreReadiness } from './readiness-view.ts';
import { VERDICT_WORD } from './readiness-view.ts';
import type { ReviewItem } from './review.ts';

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

export const SEV_WORD: Record<Severity, string> = { P0: 'P0 critical', P1: 'P1 major', P2: 'P2 minor', P3: 'P3 notice' };
const TOP: Record<Severity, number> = { P0: 3, P1: 3, P2: 2, P3: 0 };
export interface Card { badge: string; tone: string; title: string; blast: string; age: string; ladder: string; next: string; detail: string; canAck: boolean; canResolve: boolean }
const STATEFUL = new Set(['CELL_DOWN', 'CENTRE_OUTAGE', 'SEAT_SILENT', 'RELAY_WAN_DOWN', 'SYNC_LAG', 'KEY_RELEASE_DELAY']);

export function incidentCard(i: Incident, now: number, ladderMs: Record<Severity, number>): Card {
  const top = TOP[i.severity], every = ladderMs[i.severity], last = i.ladder[i.ladder.length - 1]?.at ?? i.openedAt;
  const next = i.resolvedAt ? 'closed' : i.ack ? `acknowledged by ${i.ack.by} (${i.ack.rung})` : !every || top === 0 ? 'stays with the invigilator'
    : i.rung >= top ? `at the top rung (${RUNGS[i.rung]})` : `escalates to ${RUNGS[i.rung + 1]} in ${Math.max(0, Math.ceil((last + every - now) / 1000))} s unless acknowledged`;
  return {
    badge: SEV_WORD[i.severity], tone: i.severity.toLowerCase(), title: i.title, blast: blastText(i.blast),
    age: i.resolvedAt ? `closed after ${mmss(i.resolvedAt - i.openedAt)}` : `open ${mmss(now - i.openedAt)}`,
    ladder: RUNGS.map((r, k) => (k === i.rung ? `[${r}]` : r)).join(' · '), next, detail: i.detail,
    canAck: !i.resolvedAt && !i.ack, canResolve: !i.resolvedAt && !STATEFUL.has(i.kind),
  };
}
export function linkLine(v: LinkView): { text: string; tone: 'good' | 'bad' } {
  return { text: `${v.centre} link: ${v.reason} · backlog ${fmt(v.backlog)} · round trip ${(v.rttMs / 1000).toFixed(1)} s`, tone: v.risk === 'ok' ? 'good' : 'bad' };
}
export function timeCells(r: TimeRow): ReconCell[] {
  const gaps = r.gaps.map((g) => `entry ${g.seq} ${g.cause} ${mmss(g.measuredMs)} ${g.approved ? `✓ ${g.approvedBy}` : '(needs approval)'}`).join('; ') || '—';
  return [
    { label: 'Candidate', value: r.cand, ok: true }, { label: 'Wall (relay clock)', value: mmss(r.wallMs), ok: true }, { label: 'Active (seat)', value: mmss(r.activeMs), ok: true },
    { label: 'Gaps and moves', value: gaps, ok: r.gaps.every((g) => g.approved) }, { label: 'Credited', value: `+${mmss(r.creditedMs)}`, ok: true },
    { label: 'Review', value: r.changedAfterMove.length ? `changed after the move: ${r.changedAfterMove.map((c) => `Q${c.q}`).join(', ')}` : '—', ok: true },
    { label: 'Flags', value: r.flags.join(', ') || '—', ok: r.flags.length === 0 },
  ];
}
const CHANNEL = { sms: 'SMS', email: 'e-mail', digilocker: 'DigiLocker' } as const;
export function noticeText(n: Notice): string {
  const ch = n.channels.map((c) => CHANNEL[c]);
  return `To ${fmt(n.audience)} candidates at ${n.centres.length === 1 ? n.centres[0] : `${n.centres.length} centres`} by ${ch.slice(0, -1).join(', ')}${ch.length > 1 ? ' and ' : ''}${ch.at(-1)} (mock): ${n.en}`;
}
export function readinessTile(c: CentreReadiness): { title: string; word: string; line: string; tone: Verdict; aria: string } {
  const k = c.counts, line = `${k.green} ready · ${k.amber} amber · ${k.review} review · ${k.block} blocked · ${c.missing} not reported`;
  return { title: c.centre, word: VERDICT_WORD[c.verdict], tone: c.verdict, line, aria: `${c.centre}: ${VERDICT_WORD[c.verdict]}. ${line.replaceAll(' ·', ',')}` };
}
export function reviewCard(i: ReviewItem, now: number): { title: string; line: string; alt: string; canDecide: boolean } {
  const what = i.code === 'face-none' ? 'no face for 10 s or more' : `${i.faces} faces seen, ${i.expected} expected${i.expected > 1 ? ' (scribe)' : ''}`;
  const state = i.decision ? `${i.decision} by ${i.by}` : 'awaiting review';
  return { title: `${i.cand} · ${i.seatId}`, line: `${what} · ${mmss(now - i.at)} ago · ${state}`, alt: i.thumb ? `face check frame, ${what}` : 'no image kept', canDecide: !i.decision };
}

const LEVEL_WORD = { watch: 'Watch', review: 'Review', escalate: 'Escalate' } as const;
export interface FlagRow { cand: string; centre: string; level: string; signals: string; reasons: string[]; history: string }

/** Corroboration only, per the user rule: history never raises a flag on its own. */
export function flagRows(flags: RadarFlag[]): FlagRow[] {
  return flags.map((f) => ({
    cand: f.cand, centre: f.centre, level: LEVEL_WORD[f.level],
    signals: f.signals.map((s) => s.signal).join(' + '),
    reasons: f.signals.map((s) => s.reason),
    history: f.history ? `corroboration only — ${f.history.note}` : f.level === 'watch' ? '' : 'no registry record',
  }));
}

const RISK_TONE = { allot: 'ok', 'add observer': 'watch', 'do not allot': 'stop' } as const;
export function riskChip(row?: ScoreRow): { text: string; tone: 'ok' | 'watch' | 'stop' } | undefined {
  if (!row) return undefined;
  return { text: `${row.decision} · risk ${Math.round(row.risk * 100)}%`, tone: RISK_TONE[row.decision] };
}

export function noticeCard(n: Notice): { en: string; hi: string; ta: string; complete: boolean } {
  const ta = n.ta ?? '';
  return { en: n.en, hi: n.hi, ta, complete: Boolean(n.en && n.hi && ta) };
}

export function archiveLines(a: ArchiveReport): string[] {
  return [
    a.ok ? `Both stores verify against the signed register head (${a.size} leaves, root ${group(a.root.slice(0, 16))} …).` : 'NOT verified — no purge until both stores verify.',
    ...a.stores.map((s) => `${s.store}: ${s.ok ? '✓' : '✗'} ${s.detail}`),
    `${a.writtenMs !== undefined ? `Written in ${a.writtenMs} ms · ` : ''}verified in ${a.verifyMs} ms.`.replace(/^v/, 'V'),
  ];
}

/** S6: the cosign status line, from GET /v1/witness (undefined when there is no witness). */
export const witnessLine = (w?: { cosig?: { size: number; ts: number } }): string =>
  w?.cosig ? `Witness cosigned STH #${w.cosig.size} at ${new Date(w.cosig.ts).toISOString()}` : 'Witness: not cosigned';
