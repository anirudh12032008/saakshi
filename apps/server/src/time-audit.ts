// The time audit (plan §3.6, Addendum C.9). Wall time comes from the relay's rxWall and active time from the seat's signed activeMs,
// never compared across key epochs. Each gap or move is credited by what the relay's clock saw (not what the seat claims), only once
// approved, and at most gapCapMs in total. Two or more gaps → review; over the cap → re-test eligible; time nobody explains → flagged.
// Pure and browser-safe; control runs it on the cell's export. It also lists answers changed after a move (plan §3.2, the review queue).
import { parseSignedLine } from '@saakshi/core/journal';
import type { Approval, GapLine, Ops, TimeFlag, TimeRow } from '@saakshi/core/ops';
import { bodyFromArray, type Body } from '@saakshi/core/protocol';
import type { ResponseSheet } from '@saakshi/core/sheet';

interface E { seq: number; kind: string; keyEpoch: number; activeMs: number; rx: number; body?: Body }

export function timeAudit(sheet: ResponseSheet, form: readonly string[], approvals: Approval[], ops: Ops): TimeRow {
  const es: E[] = [];
  for (const e of sheet.entries) {
    const p = parseSignedLine(e.line);
    if (!p.ok) continue;
    let body: Body | undefined;
    try { body = bodyFromArray(e.body); } catch { /* a missing or unreadable row */ }
    es.push({ seq: p.header.seq, kind: p.header.kind, keyEpoch: p.header.keyEpoch, activeMs: p.header.activeMs, rx: e.rx?.[0] ?? 0, body });
  }
  const cand = sheet.ctx.cand, gaps: GapLine[] = [];
  let activeMs = 0;
  for (let i = 1; i < es.length; i++) {
    const p = es[i - 1], n = es[i];
    const dA = n.keyEpoch === p.keyEpoch ? Math.max(0, n.activeMs - p.activeMs) : 0;
    activeMs += dA;
    if (n.kind !== 'gap' && n.kind !== 'handover') continue;
    const meta = n.body?.meta ?? [];
    const a = approvals.find((x) => x.cand === cand && x.seq === n.seq);
    gaps.push({
      seq: n.seq, kind: n.kind, cause: n.kind === 'gap' ? String(meta[0] ?? '') : `moved (${String(meta[0] ?? '')})`,
      pausedMs: n.kind === 'gap' && typeof meta[1] === 'number' ? meta[1] : 0,
      measuredMs: p.rx && n.rx ? Math.max(0, n.rx - p.rx - dA) : 0, approved: !!a, approvedBy: a?.by ?? '',
    });
  }
  const first = es[0], last = es[es.length - 1];
  const wallMs = first?.rx && last?.rx ? last.rx - first.rx : activeMs;
  const unaccountedMs = Math.max(0, wallMs - activeMs);
  const explained = gaps.reduce((n, g) => n + g.measuredMs, 0);
  const approvedMs = gaps.filter((g) => g.approved).reduce((n, g) => n + g.measuredMs, 0);
  const flags: TimeFlag[] = [];
  if (gaps.length >= 2) flags.push('REVIEW_GAPS');
  if (approvedMs > ops.gapCapMs) flags.push('RETEST_ELIGIBLE');
  if (gaps.some((g) => !g.approved)) flags.push('PENDING_APPROVAL');
  if (unaccountedMs - explained > ops.gapTolMs) flags.push('UNEXPLAINED_TIME');
  return { cand, wallMs, activeMs, unaccountedMs, gaps, creditedMs: Math.min(approvedMs, ops.gapCapMs), flags, changedAfterMove: changedAfterMove(es, form) };
}

/** Items answered (A/AMR) before a move whose state or answer changed after it. */
function changedAfterMove(es: E[], form: readonly string[]): { item: string; q: number }[] {
  const out = new Map<string, number>();
  for (const at of es.filter((e) => e.kind === 'handover').map((e) => e.seq)) {
    const before = new Map<string, Body>();
    for (const e of es) if (e.seq < at && e.body?.item) before.set(e.body.item, e.body);
    for (const e of es) {
      const b = e.body, was = b?.item ? before.get(b.item) : undefined;
      if (e.seq > at && b && was && (was.state === 'A' || was.state === 'AMR') && (b.answer !== was.answer || b.state !== was.state)) out.set(b.item, form.indexOf(b.item) + 1);
    }
  }
  return [...out].map(([item, q]) => ({ item, q })).sort((a, b) => a.q - b.q);
}
