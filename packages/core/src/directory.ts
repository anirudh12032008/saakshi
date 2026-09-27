// The exam directory written by tools/provision.ts and tools/package.ts, and the control room's view types. Types and paths only.
import type { Manifest } from './paper.ts';
import type { RosterEntry } from './policy.ts';
import type { NodeState } from './wire.ts';

/** NTA, NIC and the independent observer each hold one Shamir share. */
export const CUSTODIANS = ['NTA', 'NIC', 'OBS'] as const;
export interface CellEntry { id: string; url: string; keyId: string; pub: string; /** authority signature over cellKeyArray */ cert: string }
export interface CellKeyFile { id: string; keyId: string; priv: string; pub: string }
export interface Directory {
  v: 1; exam: string; shift: string; durationMs: number; demoCentre: string; issuedAt: number;
  cells: CellEntry[]; centres: Record<string, { cell: string }>; cands: Record<string, RosterEntry & { centre: string }>;
}
export const FILES = {
  directory: 'directory.json',
  cellKey: (id: string) => `cells/${id}.key.json`,
  policy: (centre: string) => `policies/${centre}.json`,
  pseudKey: 'control/pseud.key',
  manifest: 'package/manifest.json',
  paper: (form: string) => `package/paper-${form}.bin`,
  wraps: 'package/wraps.json',
  codes: 'package/codes.bin',
  share: (custodian: string) => `custodians/${custodian}.share.json`,
} as const;
export const rosterOf = (d: Directory, centre: string): string[] => Object.keys(d.cands).filter((c) => d.cands[c].centre === centre).sort();

export interface CentreStats { registered: number; bound: number; unlocked: number; submitted: number; entries: number }
export interface CellStats { cell: string; state: NodeState; entries: number; centres: Record<string, CentreStats> }
export type TileTone = 'green' | 'partial' | 'locked' | 'down';
export interface CentreTile extends CentreStats { centre: string; cell: string; tone: TileTone }
export interface FleetView {
  at: number; registered: number; bound: number; unlocked: number; submitted: number; entries: number; entriesPerSec: number;
  cells: { id: string; state: NodeState | 'DOWN'; entries: number }[]; centres: CentreTile[];
}
export interface ReleaseStatus {
  exam: string; shift: string; keyId: string; custodians: string[]; received: string[]; needed: number;
  released?: { at: number; custodians: string[]; forms: { form: string; kcf: string }[] };
  pushed: Record<string, boolean>; zeroised: boolean; reveals: { at: number; centre: string; superintendent: string }[]; manifest: Manifest;
}
