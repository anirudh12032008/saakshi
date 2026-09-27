// Incident rules (plan §3.10): P0–P3, blast radius, the escalation ladder with acknowledgement timers, debounce, and the CERT-In hook at
// the regulator rung. Pure and browser-safe: control's monitor feeds snapshots; the control page and /status render the results.
// Nothing here is persisted: state rules re-derive from live state, event rules from the cells' evidence (Decision 6).
import type { Directory, FleetView, ReleaseStatus } from '@saakshi/core/directory';
import { RUNGS, type Blast, type CellEvent, type Incident, type IncidentKind, type LinkView, type Ops, type Severity } from '@saakshi/core/ops';
import type { Finding } from '@saakshi/core/sheet';
import type { HeadsRes } from '@saakshi/core/wire';

export interface Snapshot { now: number; fleet?: FleetView; events?: CellEvent[]; link?: LinkView; relay?: HeadsRes; release?: ReleaseStatus; findings?: Finding[] }

export const SEVERITY: Record<IncidentKind, Severity> = {
  TAMPER: 'P0', CELL_DOWN: 'P1', CENTRE_OUTAGE: 'P1', KEY_RELEASE_DELAY: 'P1', INTEGRITY_CRITICAL: 'P1',
  RELAY_WAN_DOWN: 'P2', SYNC_LAG: 'P2', BAD_SUBMISSION: 'P2', LATE: 'P2', SEAT_SILENT: 'P3', HANDOVER: 'P3', GAP: 'P3', ORPHANED: 'P3',
};
const TOP: Record<Severity, number> = { P0: 3, P1: 3, P2: 2, P3: 0 };                 // the highest rung each severity climbs to
const AT_CONTROL = new Set<IncidentKind>(['CELL_DOWN', 'TAMPER', 'KEY_RELEASE_DELAY']);  // national scope starts at control
const CERT_IN = new Set<IncidentKind>(['TAMPER', 'INTEGRITY_CRITICAL']);
const STATEFUL = new Set<IncidentKind>(['CELL_DOWN', 'CENTRE_OUTAGE', 'SEAT_SILENT', 'RELAY_WAN_DOWN', 'SYNC_LAG', 'KEY_RELEASE_DELAY']);

export const dcName = (cell: string): string => cell.replace(/^cell-(\d+)$/, 'Data Centre $1');
const fmt = (n: number): string => n.toLocaleString('en-IN');
const plural = (n: number, w: string): string => `${fmt(n)} ${w}${n === 1 ? '' : 's'}`;
export const mmss = (ms: number): string => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
export function blastText(b: Blast): string {
  return [b.cells.length ? plural(b.cells.length, 'cell') : '', plural(b.centres.length, 'centre'), plural(b.candidates, 'candidate'),
    b.answersLost === null ? 'answers lost: not known yet' : `answers lost ${fmt(b.answersLost)}`].filter(Boolean).join(' · ');
}

interface Want { kind: IncidentKind; key: string; title: string; detail: string; blast: Blast; cand?: string; data?: Record<string, string | number> }

export class Incidents {
  #dir: Directory;
  #ops: Ops;
  #regulator?: (i: Incident) => string | undefined;
  #list: Incident[] = [];
  #n = 0;
  #reg = new Map<string, number>();                 // centre → registered candidates
  #peak = new Map<string, number>();                // cell → entries when last seen LIVE
  #clear = new Map<string, number>();               // incident key → since when its condition has been clear
  #seen = new Set<string>();                        // cell events and audit findings already applied
  #warned = new Map<string, number>();              // centre → when SYNC_LAG last opened

  constructor(dir: Directory, ops: Ops, hooks: { regulator?: (i: Incident) => string | undefined } = {}) {
    this.#dir = dir; this.#ops = ops; this.#regulator = hooks.regulator;
    for (const c of Object.values(dir.cands)) this.#reg.set(c.centre, (this.#reg.get(c.centre) ?? 0) + 1);
  }

  all(): Incident[] { return [...this.#list]; }
  open(): Incident[] { return this.#list.filter((i) => !i.resolvedAt); }
  get(id: string): Incident | undefined { return this.#list.find((i) => i.id === id); }

  /** Apply one snapshot; returns the incidents that opened, changed, climbed or closed. */
  evaluate(s: Snapshot): Incident[] {
    const changed = new Set<Incident>();
    const wants = this.#stateWants(s), live = new Set(wants.map((w) => w.key));
    for (const w of wants) {
      this.#clear.delete(w.key);
      const cur = this.#openFor(w.key);
      if (!cur) changed.add(this.#open(w, s.now));
      else if (cur.title !== w.title || cur.detail !== w.detail || JSON.stringify(cur.blast) !== JSON.stringify(w.blast)) {
        Object.assign(cur, { title: w.title, detail: w.detail, blast: w.blast, updatedAt: s.now });
        changed.add(cur);
      }
    }
    for (const i of this.open()) {
      if (!STATEFUL.has(i.kind) || live.has(i.key)) continue;
      const since = this.#clear.get(i.key) ?? s.now;
      this.#clear.set(i.key, since);
      if (s.now - since >= this.#ops.clearMs) { this.#close(i, s); changed.add(i); }
    }
    for (const w of this.#eventWants(s)) {
      const cur = this.#openFor(w.key);
      if (cur) { cur.data.count = Number(cur.data.count ?? 1) + 1; cur.updatedAt = s.now; changed.add(cur); }
      else changed.add(this.#open(w, s.now));
    }
    for (const i of this.#list) if (this.#climb(i, s.now)) changed.add(i);
    for (const c of s.fleet?.cells ?? []) if (c.state === 'LIVE') this.#peak.set(c.id, c.entries);
    return [...changed];
  }

  ack(id: string, by: string, now: number): Incident {
    const i = this.get(id);
    if (!i) throw new Error(`no incident ${id}`);
    const who = by.trim();
    if (!who || who.length > 64) throw new Error('say who acknowledges (1–64 characters)');
    i.ack ??= { by: who, rung: RUNGS[i.rung], at: now };
    i.updatedAt = now;
    return i;
  }

  resolve(id: string, now: number): Incident {
    const i = this.get(id);
    if (!i) throw new Error(`no incident ${id}`);
    if (STATEFUL.has(i.kind) && !i.resolvedAt) throw new Error('this incident closes by itself when its condition clears');
    i.resolvedAt ??= now;
    i.updatedAt = now;
    return i;
  }

  #openFor(key: string): Incident | undefined { return this.#list.find((i) => i.key === key && !i.resolvedAt); }

  #open(w: Want, now: number): Incident {
    const rung = AT_CONTROL.has(w.kind) ? 2 : 0;
    const i: Incident = { id: `${w.kind}-${++this.#n}`, kind: w.kind, severity: SEVERITY[w.kind], key: w.key, title: w.title, detail: w.detail, blast: w.blast,
      openedAt: now, updatedAt: now, rung, ladder: [{ rung: RUNGS[rung], at: now }], ...(w.cand ? { cand: w.cand } : {}), data: { ...w.data } };
    const centre = w.blast.centres[0] ?? '';
    if (w.kind === 'CELL_DOWN') i.data.before = this.#peak.get(w.blast.cells[0]) ?? 0;
    if (w.kind === 'SYNC_LAG') this.#warned.set(centre, now);
    if (w.kind === 'RELAY_WAN_DOWN') { const at = this.#warned.get(centre); if (at !== undefined && now - at < 10 * 60_000) i.data.warnedMs = now - at; }
    this.#list.push(i);
    return i;
  }

  #close(i: Incident, s: Snapshot): void {
    i.resolvedAt = s.now;
    i.updatedAt = s.now;
    if (i.kind === 'CELL_DOWN') {
      const after = s.fleet?.cells.find((c) => c.id === i.blast.cells[0])?.entries ?? 0;
      i.blast = { ...i.blast, answersLost: Math.max(0, Number(i.data.before ?? 0) - after) };
      i.data.after = after;
    }
  }

  #climb(i: Incident, now: number): boolean {
    const every = this.#ops.ladderMs[i.severity];
    if (i.resolvedAt || i.ack || !every || i.rung >= TOP[i.severity] || now - i.ladder[i.ladder.length - 1].at < every) return false;
    i.rung++;
    i.ladder.push({ rung: RUNGS[i.rung], at: now });
    i.updatedAt = now;
    if (i.rung === 3 && CERT_IN.has(i.kind)) i.certIn = this.#regulator?.(i);
    return true;
  }

  #cands(centres: string[]): number { return centres.reduce((n, c) => n + (this.#reg.get(c) ?? 0), 0); }

  #stateWants(s: Snapshot): Want[] {
    const out: Want[] = [];
    for (const c of s.fleet?.cells ?? []) {
      if (c.state === 'LIVE') continue;
      const centres = Object.entries(this.#dir.centres).filter(([, x]) => x.cell === c.id).map(([id]) => id).sort();
      out.push({ kind: 'CELL_DOWN', key: `CELL_DOWN:${c.id}`, title: c.state === 'DOWN' ? `${dcName(c.id)} is down` : `${dcName(c.id)} is rebuilding from the relays`,
        detail: c.state === 'DOWN' ? 'no answer from it; every relay keeps each answer (✓✓) and replays it when it returns'
          : c.rebuild ? `${c.rebuild.done} of ${c.rebuild.expected} relays have replayed` : 'the relays are replaying',
        blast: { cells: [c.id], centres, candidates: this.#cands(centres), answersLost: null } });
    }
    const L = s.link;
    if (L && L.risk !== 'ok') {
      const blast: Blast = { cells: [], centres: [L.centre], candidates: this.#cands([L.centre]), answersLost: 0 };
      if (L.risk === 'down') out.push({ kind: 'RELAY_WAN_DOWN', key: `RELAY_WAN_DOWN:${L.centre}`, title: `${L.centre} has lost its link to the exam server`,
        detail: `${L.cut ? 'the link is cut' : 'no answer from the exam server'}. The centre continues offline; answers wait at its relay (✓✓); its offline code is ready to reveal.`, blast });
      else out.push({ kind: 'SYNC_LAG', key: `SYNC_LAG:${L.centre}`, title: `WAN failure likely at ${L.centre} (predicted)`, detail: `${L.reason}. Pre-stage ${L.centre}'s offline code.`, blast });
    }
    if (s.relay) out.push(...this.#silence(s, s.relay));
    const r = s.release?.released;
    if (r && s.fleet && s.now - r.at > this.#ops.releaseDelayMs) {
      const late = s.fleet.centres.filter((t) => t.registered > 0 && t.tone === 'locked').map((t) => t.centre);
      if (late.length) out.push({ kind: 'KEY_RELEASE_DELAY', key: 'KEY_RELEASE_DELAY', title: `${plural(late.length, 'centre')} still locked after the release`,
        detail: `${late.slice(0, 10).join(', ')}${late.length > 10 ? ', …' : ''}: phone the superintendent; reveal the centre's offline code if its link is down.`,
        blast: { cells: [], centres: late, candidates: this.#cands(late), answersLost: 0 } });
    }
    return out;
  }

  #silence(s: Snapshot, relay: HeadsRes): Want[] {
    const centre = s.link?.centre ?? this.#dir.demoCentre;
    const seen = relay.streams.filter((v) => v.seenAt > 0 && !v.submitted);
    const silent = seen.filter((v) => s.now - v.seenAt > this.#ops.silentMs);
    if (!silent.length) return [];
    const at = silent.map((v) => v.seenAt);
    if (silent.length >= 2 && silent.length * 2 >= seen.length && Math.max(...at) - Math.min(...at) <= this.#ops.silentMs)
      return [{ kind: 'CENTRE_OUTAGE', key: `CENTRE_OUTAGE:${centre}`, title: `${centre}: ${silent.length} of ${seen.length} seats went silent together`,
        detail: 'likely power or the network inside the centre; each seat keeps its answers and is not charged the lost time', blast: { cells: [], centres: [centre], candidates: silent.length, answersLost: null } }];
    return silent.map((v): Want => ({ kind: 'SEAT_SILENT', key: `SEAT_SILENT:${v.cand}`, cand: v.cand, title: `${v.cand}'s seat is silent`,
      detail: `no heartbeat for over ${Math.round(this.#ops.silentMs / 1000)} s — check the seat`, blast: { cells: [], centres: [centre], candidates: 1, answersLost: null } }));
  }

  #eventWants(s: Snapshot): Want[] {
    const out: Want[] = [];
    const one = (centre: string, lost: number | null = 0): Blast => ({ cells: [], centres: centre ? [centre] : [], candidates: 1, answersLost: lost });
    for (const e of s.events ?? []) {
      const k = `${e.cell}/${e.code}/${e.cand}/${e.seq}/${e.reason}`;
      if (this.#seen.has(k)) continue;
      this.#seen.add(k);
      const d = e.data ?? {}, c = e.cand;
      if (e.code === 'FORK') out.push({ kind: 'TAMPER', key: `TAMPER:${c}`, cand: c, title: `Two different signed entries for ${c}`, detail: `${dcName(e.cell)}, seq ${e.seq}: ${e.reason}`, blast: one(e.centre, null) });
      else if (e.code === 'BAD_SUBMISSION') out.push({ kind: 'BAD_SUBMISSION', key: `BAD_SUBMISSION:${c || e.cell}`, cand: c || undefined, title: `Refused entries${c ? ` for ${c}` : ''}`, detail: e.reason, blast: one(e.centre), data: { count: 1 } });
      else if (e.code === 'ORPHANED') out.push({ kind: 'ORPHANED', key: `ORPHANED:${c}`, cand: c, title: `${c}'s old seat is still sending`, detail: 'its entries after the move are kept as evidence (ORPHANED), not counted', blast: one(e.centre), data: { count: 1 } });
      else if (e.code === 'LATE') out.push({ kind: 'LATE', key: `LATE:${c}`, cand: c, title: `Entries after the hard stop for ${c}`, detail: `${e.reason}; kept as evidence for a human decision`, blast: one(e.centre), data: { count: 1 } });
      else if (e.code === 'HANDOVER') out.push({ kind: 'HANDOVER', key: `HANDOVER:${c}:${d.keyEpoch}`, cand: c,
        title: `${c} moved to ${d.seatId} (${d.via === 'pin' ? `PIN + invigilator ${d.approvedBy}` : 'old seat key'})`,
        detail: `+${mmss(Number(d.creditedMs ?? 0))} credited${d.approvedBy ? `, approved by ${d.approvedBy}` : ' — needs approval'}; continues from entry ${d.fromSeq}`, blast: one(e.centre), data: { ...d } });
      else if (e.code === 'GAP') out.push({ kind: 'GAP', key: `GAP:${c}:${e.seq}`, cand: c, title: `${c} paused (${d.cause})`,
        detail: `the seat reports ${mmss(Number(d.pausedMs ?? 0))}; the credit is measured by the relay's clock and needs approval`, blast: one(e.centre), data: { ...d, seq: e.seq } });
      else if (e.code === 'INTEGRITY' && this.#ops.criticalIntegrity.includes(String(d.code)))
        out.push({ kind: 'INTEGRITY_CRITICAL', key: `INTEGRITY_CRITICAL:${c}`, cand: c, title: `${d.code} at ${c}'s seat`, detail: 'never auto-submitted: move the candidate or clear the finding', blast: one(e.centre), data: { ...d } });
    }
    for (const f of s.findings ?? []) {
      const k = `audit/${f.cand}/${f.seq}/${f.kind}/${f.detail}`;
      if (this.#seen.has(k)) continue;
      this.#seen.add(k);
      out.push({ kind: 'TAMPER', key: `TAMPER:${f.cand}`, cand: f.cand, title: `The record for ${f.cand} was altered`, detail: `entry ${f.seq}: ${f.detail}`,
        blast: one(this.#dir.cands[f.cand]?.centre ?? '', f.recovered ? 0 : null) });
    }
    return out;
  }
}
