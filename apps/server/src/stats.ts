// Per-centre numbers for the control room, computed on the cell from what it holds (plan §3.10). Pure.
import type { CellStats, CentreStats, Directory } from '@saakshi/core/directory';
import type { NodeState, StreamView } from '@saakshi/core/wire';

export function cellStats(i: { cellId: string; state: NodeState; dir: Directory; views: StreamView[]; bound: string[]; submitted: string[] }): CellStats {
  const centres: Record<string, CentreStats> = {};
  for (const [id, c] of Object.entries(i.dir.centres)) if (c.cell === i.cellId) centres[id] = { registered: 0, bound: 0, unlocked: 0, submitted: 0, entries: 0 };
  const at = (cand: string): CentreStats | undefined => { const c = i.dir.cands[cand]; return c && centres[c.centre]; };
  for (const cand of Object.keys(i.dir.cands)) { const s = at(cand); if (s) s.registered++; }
  for (const cand of i.bound) { const s = at(cand); if (s) s.bound++; }
  for (const cand of i.submitted) { const s = at(cand); if (s) s.submitted++; }
  let entries = 0;
  for (const v of i.views) {
    if (v.exam !== i.dir.exam || v.shift !== i.dir.shift) continue;
    const s = at(v.cand);
    if (!s) continue;
    s.entries += v.head;
    entries += v.head;
    if (v.head >= 1) s.unlocked++;                                                 // seq 1 is always the unlock
  }
  return { cell: i.cellId, state: i.state, entries, centres };
}
