import type { GateMethod } from '../../shared/ipc.ts';

export type EnrolProblem = '' | 'pinDigits' | 'pinMatch' | 'operator';
export function enrolProblem(pin: string, confirm: string, operatorId: string): EnrolProblem {
  if (!/^[0-9]{6}$/.test(pin)) return 'pinDigits';
  if (pin !== confirm) return 'pinMatch';
  if (!operatorId.trim()) return 'operator';
  return '';
}
export const GATE: readonly GateMethod[] = ['aadhaar-face', 'aadhaar-fingerprint', 'id-document'];
/** 6065a397d8b6299b… → "6065 a397 d8b6 299b": the first 16 hex of a commitment, for reading aloud. */
export const shortHex = (h = ''): string => h.slice(0, 16).replace(/(.{4})(?=.)/g, '$1 ');
