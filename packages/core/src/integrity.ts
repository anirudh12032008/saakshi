// Protocol Addendum D (Stage 5, plan §3.4–§3.5): the integrity section of the signed policy, findings, the signed readiness report,
// the signed face flag with its thumbnail sealed to control's review key, and the provenance slot. Browser-safe.
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes, toHex, utf8 } from './bytes.ts';
import { nobleBox, openBox, sealBox, type BoxKeys } from './box.ts';
import { canon, type Canon } from './canon.ts';
import type { Ctx } from './protocol.ts';

export type Level = 'block' | 'review' | 'amber' | 'info';
export const LEVELS: readonly Level[] = ['block', 'review', 'amber', 'info'];
export const FINDING_CODES = ['blocklisted', 'capture-excluded', 'remote-session', 'vm', 'vm-signal', 'displays', 'no-camera', 'probe-unknown',
  'egress', 'battery', 'disk', 'clock-skew', 'blur', 'face-none', 'face-extra', 'assistive', 'test-mode', 'policy-default'] as const;
export type FindingCode = (typeof FINDING_CODES)[number];
export interface IntegrityFinding { code: FindingCode; level: Level; detail: string; names: string[] }
export type Verdict = 'green' | 'amber' | 'review' | 'block';
export const VERDICTS: readonly Verdict[] = ['green', 'amber', 'review', 'block'];

export function verdictOf(fs: readonly IntegrityFinding[]): Verdict {
  if (fs.some((f) => f.level === 'block')) return 'block';
  if (fs.some((f) => f.level === 'review')) return 'review';
  return fs.some((f) => f.level === 'amber') ? 'amber' : 'green';
}

export interface ToolRule { name: string; procs: string[]; bundleIds: string[] }
export interface IntegrityPolicy {
  v: 1; blocklist: ToolRule[]; assistive: ToolRule[]; guestTools: string[]; vmMacPrefixes: string[]; vmStrings: string[];
  /** "host:port" the seat may talk to (its relay). Loopback is always allowed. */
  egress: string[];
  probeMs: number; blurMs: number; face: { noFaceMs: number; window: number; over: number };
  amber: { minFreeBytes: number; maxSkewMs: number };
  /** Control's review key (130 hex): face thumbnails are sealed to it. */
  reviewPub: string; retentionMs: number;
}
export interface Accommodation { faces?: number; assistive?: string[] }

const rule = (name: string, procs: string[], bundleIds: string[] = []): ToolRule => ({ name, procs, bundleIds });
export const INTEGRITY_DEFAULT: Omit<IntegrityPolicy, 'reviewPub' | 'egress'> = {
  v: 1,
  blocklist: [
    rule('AnyDesk', ['anydesk'], ['com.philandro.anydesk']), rule('TeamViewer', ['teamviewer', 'teamviewer_service'], ['com.teamviewer.TeamViewer']),
    rule('RustDesk', ['rustdesk'], ['com.carriez.rustdesk']), rule('Parsec', ['parsecd'], ['tv.parsec.www']),
    rule('Chrome Remote Desktop', ['remoting_host'], ['com.google.chrome.remote_desktop']), rule('VNC server', ['vncserver', 'tvnserver', 'winvnc']),
    rule('OBS Studio', ['obs', 'obs64', 'obs studio'], ['com.obsproject.obs-studio']), rule('Cluely', ['cluely'], ['com.cluely.app']),
  ],
  assistive: [
    rule('NVDA', ['nvda']), rule('JAWS', ['jfw']), rule('Narrator', ['narrator']), rule('Magnifier', ['magnify']),
    rule('VoiceOver', ['voiceover'], ['com.apple.VoiceOver']),
  ],
  guestTools: ['vmtoolsd', 'vboxservice', 'vboxtray', 'prl_tools_service', 'prl_client_app', 'qemu-ga', 'spice-vdagent', 'vmware-tools-daemon'],
  vmMacPrefixes: ['00:05:69', '00:0c:29', '00:1c:14', '00:50:56', '08:00:27', '00:1c:42', '52:54:00', '00:16:3e'],
  vmStrings: ['vmware', 'virtualbox', 'vbox', 'parallels', 'qemu', 'virtual machine', 'apple virtual', 'xen', 'kvm', 'bochs'],
  probeMs: 10_000, blurMs: 3_000, face: { noFaceMs: 10_000, window: 5, over: 3 },
  amber: { minFreeBytes: 1024 ** 3, maxSkewMs: 120_000 }, retentionMs: 30 * 24 * 3600_000,
};
/** Decision 4: a policy without the integrity section runs on the defaults and says so (the seat adds `policy-default`). */
export function integrityOf(p?: IntegrityPolicy): { pol: IntegrityPolicy; defaulted: boolean } {
  return p ? { pol: p, defaulted: false } : { pol: { ...INTEGRITY_DEFAULT, egress: [], reviewPub: '' }, defaulted: true };
}

// D.2
export const findingMeta = (f: IntegrityFinding): Canon[] => [f.code, f.level, f.detail, [...f.names]];
export function findingFromMeta(meta: Canon[]): IntegrityFinding | undefined {
  const [code, a, b, names] = meta;
  if (typeof code !== 'string' || !(FINDING_CODES as readonly string[]).includes(code)) return undefined;
  if (meta.length === 2 && typeof a === 'string') return { code: code as FindingCode, level: 'info', detail: a, names: [] };   // B.9 test-mode
  if (typeof a !== 'string' || !(LEVELS as readonly string[]).includes(a) || typeof b !== 'string' || !Array.isArray(names)) return undefined;
  return { code: code as FindingCode, level: a as Level, detail: b, names: names.filter((n): n is string => typeof n === 'string') };
}
export const findingKey = (f: IntegrityFinding): string => `${f.code}:${[...f.names].sort().join(',')}`;
export const findingsHash = (fs: readonly IntegrityFinding[]): string => toHex(sha256(utf8(canon(['findings', fs.map(findingMeta)]))));

// D.3
export interface Readiness extends Ctx { seatId: string; keyEpoch: number; at: number; verdict: Verdict; findings: IntegrityFinding[] }
export const readinessArray = (r: Readiness): Canon[] =>
  ['readiness', r.exam, r.shift, r.attempt, r.cand, r.seatId, r.keyEpoch, r.at, r.verdict, findingsHash(r.findings)];
export interface SignedReadiness { r: Readiness; sig: string }

// D.4
export interface FaceFlag extends Ctx {
  seatId: string; at: number; code: 'face-none' | 'face-extra'; faces: number; expected: number;
  /** hex B.4 box to reviewPub, '' when no frame was available */ thumb: string; thumbHash: string;
}
export const faceArray = (f: FaceFlag): Canon[] =>
  ['face', f.exam, f.shift, f.attempt, f.cand, f.seatId, f.at, f.code, f.faces, f.expected, f.thumbHash];
export interface SignedFace { f: FaceFlag; sig: string }
export const faceInfo = (c: Ctx, at: number): Canon[] => ['saakshi-face', 1, c.exam, c.shift, c.attempt, c.cand, at];
export const thumbHashOf = (thumbHex: string): string => (thumbHex ? toHex(sha256(hexToBytes(thumbHex))) : '');
export const sealThumb = (reviewPub: Uint8Array, c: Ctx, at: number, jpeg: Uint8Array, k: BoxKeys = nobleBox): string =>
  toHex(sealBox(reviewPub, faceInfo(c, at), jpeg, k));
export const openThumb = (priv: Uint8Array, c: Ctx, at: number, box: string, k: BoxKeys = nobleBox): Uint8Array =>
  openBox(priv, faceInfo(c, at), hexToBytes(box), k);

// D.5
export interface ProvSummary { moves: number; pathPx: number; clicks: number; keys: number; untrusted: number; lastMoveMs: number }
export const provArray = (p?: ProvSummary): Canon[] =>
  p ? ['prov', ...[p.moves, p.pathPx, p.clicks, p.keys, p.untrusted, p.lastMoveMs].map((n) => Math.max(0, Math.round(n)))] : [];
