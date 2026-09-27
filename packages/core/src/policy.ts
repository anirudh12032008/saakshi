// The signed per-centre policy (plan §3.4; Stage 3 fields only — Stage 5 adds the integrity rules). A seat never runs on an
// unsigned or altered policy. It pins the centre's cell key, D and each candidate's form, compensatory time and pseudonym.
import { hexToBytes, toHex } from './bytes.ts';
import { msg } from './enrol.ts';
import type { Verify } from './sig.ts';

export interface RosterEntry { form: 'F1' | 'F2'; extraMs: number; pseud: string }
export interface Policy {
  v: 1; exam: string; shift: string; centre: string;
  cell: { id: string; keyId: string; pub: string };
  durationMs: number; roster: Record<string, RosterEntry>; issuedAt: number;
}
export interface SignedPolicy { text: string; sig: string }
const pm = (exam: string, shift: string, centre: string, text: string) => msg(['policy', exam, shift, centre, text]);

export function signPolicy(p: Policy, sign: (m: Uint8Array) => Uint8Array): SignedPolicy {
  const text = JSON.stringify(p);
  return { text, sig: toHex(sign(pm(p.exam, p.shift, p.centre, text))) };
}

export function openPolicy(sp: SignedPolicy, authority: Verify, want: { exam: string; shift: string }): Policy {
  if (typeof sp?.text !== 'string' || typeof sp.sig !== 'string' || !/^[0-9a-f]{128}$/.test(sp.sig)) throw new Error('the policy is not signed');
  let p: Policy;
  try { p = JSON.parse(sp.text) as Policy; } catch { throw new Error('the policy is not JSON'); }
  if (typeof p?.exam !== 'string' || typeof p.shift !== 'string' || typeof p.centre !== 'string' || !authority(pm(p.exam, p.shift, p.centre, sp.text), hexToBytes(sp.sig)))
    throw new Error('the policy signature does not verify');
  if (p.v !== 1 || p.exam !== want.exam || p.shift !== want.shift) throw new Error(`the policy is for ${p.exam} ${p.shift}, not ${want.exam} ${want.shift}`);
  if (typeof p.cell?.id !== 'string' || !/^04[0-9a-f]{128}$/.test(p.cell.pub ?? '') || !Number.isSafeInteger(p.durationMs) || p.durationMs <= 0
    || typeof p.roster !== 'object' || p.roster === null) throw new Error('the policy is malformed');
  return p;
}
