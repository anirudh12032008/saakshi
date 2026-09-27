import { mismatchText, type CheckName, type SheetReport } from '@saakshi/core/verify';

const LABEL: Record<CheckName, string> = {
  keys: 'Seat keys (one per key epoch, pinned)',
  chain: 'Signed hash chain',
  bodies: 'Answers vs. what the seat committed',
  finalHash: 'Final answer hash (replayed)',
  receipt: 'Receipt code and cell countersignature',
  slip: 'Code on the candidate\'s slip',
  sth: 'Register head signed by the exam authority',
  inclusion: 'Included in the sealed public register',
};

export interface View { verdict: 'match' | 'altered' | 'invalid'; title: string; headline: string; rows: { label: string; ok: boolean; detail: string }[]; more: string[] }

export function viewOf(r: SheetReport): View {
  const altered = r.mismatches.length > 0;
  const firstBad = r.checks.find((c) => !c.ok);
  return {
    verdict: r.ok ? 'match' : altered ? 'altered' : 'invalid',
    title: r.ok ? 'The record matches what the seat committed' : altered ? 'The record was altered after the seat committed it' : 'This record does not verify',
    headline: altered ? mismatchText(r.mismatches[0]) : firstBad ? firstBad.detail : `Receipt ${r.receipt?.code ?? ''} — every check passes`,
    rows: r.checks.map((c) => ({ label: LABEL[c.name], ok: c.ok, detail: c.detail })),
    more: r.mismatches.slice(1).map(mismatchText),
  };
}
