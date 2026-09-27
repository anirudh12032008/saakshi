// Stage 6 Task 6: the engine's incident from the committee's input plus measured gaps and outages. Pure; no I/O.
import type { Directory } from '@saakshi/core/directory';
import type { Disruption, IncidentIn } from '@saakshi/core/analytics';
import type { Incident, TimeRow } from '@saakshi/core/ops';

const OUTAGE_KINDS = new Set<Incident['kind']>(['CENTRE_OUTAGE', 'RELAY_WAN_DOWN']);

function mergeDisruptions(rows: Disruption[]): Disruption[] {
  const byCentre = new Map<string, Disruption[]>();
  for (const d of rows) {
    const list = byCentre.get(d.centre) ?? [];
    list.push(d);
    byCentre.set(d.centre, list);
  }
  const out: Disruption[] = [];
  for (const [centre, list] of byCentre) {
    const sorted = [...list].sort((a, b) => a.fromMin - b.fromMin);
    for (const d of sorted) {
      const last = out[out.length - 1];
      if (last && last.centre === centre && d.fromMin <= last.toMin) {
        last.toMin = Math.max(last.toMin, d.toMin);
      } else {
        out.push({ ...d });
      }
    }
  }
  return out.sort((a, b) => (a.centre === b.centre ? a.fromMin - b.fromMin : a.centre < b.centre ? -1 : 1));
}

export function buildIncident(o: { input: IncidentIn; time: TimeRow[]; incidents: Incident[]; dir: Directory; startMs: number }): IncidentIn {
  const { input, time, incidents, dir, startMs } = o;
  if (!input.id) throw new Error('id: missing');
  const durationMin = Math.round(dir.durationMs / 60_000);

  for (const d of input.disruptions ?? []) {
    if (!dir.centres[d.centre]) throw new Error(`disruptions: centre not in directory: ${d.centre}`);
    if (d.fromMin > d.toMin) throw new Error(`disruptions: fromMin > toMin (${d.fromMin} > ${d.toMin})`);
  }
  for (const cand of input.left ?? []) {
    if (!dir.cands[cand]) throw new Error(`left: candidate not in directory: ${cand}`);
  }
  for (const cand of Object.keys(input.gaps ?? {})) {
    if (!dir.cands[cand]) throw new Error(`gaps: candidate not in directory: ${cand}`);
  }

  // gaps: input's gaps win per named candidate; else derive from approved gap lines, ceiled to minutes.
  const gaps: Record<string, number[]> = { ...(input.gaps ?? {}) };
  for (const row of time) {
    if (!dir.cands[row.cand]) continue;
    if (input.gaps && row.cand in input.gaps) continue;
    const minutes = row.gaps.filter((g) => g.approved).map((g) => Math.ceil(g.measuredMs / 60_000));
    if (minutes.length) gaps[row.cand] = minutes;
  }

  // left: input's ∪ RETEST_ELIGIBLE candidates, sorted unique.
  const left = new Set(input.left ?? []);
  for (const row of time) if (row.flags.includes('RETEST_ELIGIBLE')) left.add(row.cand);

  // disruptions: input's, plus one per outage/WAN-down incident per centre in its blast, clamped, merged.
  const built: Disruption[] = [...(input.disruptions ?? [])];
  for (const incident of incidents) {
    if (!OUTAGE_KINDS.has(incident.kind)) continue;
    const end = incident.resolvedAt ?? incident.openedAt;
    for (const centre of incident.blast.centres) {
      const fromMin = Math.min(Math.max(Math.floor((incident.openedAt - startMs) / 60_000), 0), durationMin);
      const toMin = Math.min(Math.max(Math.ceil((end - startMs) / 60_000), 0), durationMin);
      built.push({ centre, shift: dir.shift, fromMin, toMin });
    }
  }

  return {
    id: input.id,
    gaps,
    left: [...left].sort(),
    disruptions: mergeDisruptions(built),
    breach: input.breach,
  };
}
