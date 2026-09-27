// Self-tests over the real probe host: `--probe-selftest` (does every probe run here?) and `--gate-selftest` (does the gate block
// the named tools? — the Windows CI check, which asserts names, not the whole verdict: the runner is itself a VM).
import { tmpdir } from 'node:os';
import { INTEGRITY_DEFAULT, verdictOf, type IntegrityFinding, type Verdict } from '@saakshi/core/integrity';
import { evaluate, type ProbeResult, type ProbeSnapshot } from './integrity.ts';
import { collect, type HostInputs } from './probe-host.ts';

export interface Selftest { app: 'saakshi-seat'; platform: string; arch: string; electron: string; ok: boolean; ms: number; probes: Record<string, ProbeResult> }

const NEUTRAL: HostInputs = { displays: () => 1, onBattery: () => false, camera: () => 'off', skewMs: () => null, dataDir: tmpdir() };
const probesOf = (s: ProbeSnapshot): Record<string, ProbeResult> =>
  ({ processes: s.procs, captureExcluded: s.captureExcluded, remoteSession: s.remoteSession, vm: s.vm, egress: s.egress });

export async function runSelftest(): Promise<Selftest> {
  const t0 = Date.now(), probes = probesOf(await collect(NEUTRAL));
  const ok = Object.values(probes).every((p) => p.status === 'ok');
  return { app: 'saakshi-seat', platform: process.platform, arch: process.arch, electron: process.versions.electron ?? '', ok, ms: Date.now() - t0, probes };
}

export async function runGateSelftest(expect: string[]): Promise<{ ok: boolean; verdict: Verdict; findings: IntegrityFinding[]; missing: string[] }> {
  const findings = evaluate(await collect(NEUTRAL), { ...INTEGRITY_DEFAULT, egress: [], reviewPub: '' }, {}, { testMode: false, defaulted: false });
  const blocked = new Set(findings.filter((f) => f.level === 'block').flatMap((f) => f.names.map((n) => n.toLowerCase())));
  const missing = expect.filter((n) => !blocked.has(n.toLowerCase()));
  return { ok: missing.length === 0, verdict: verdictOf(findings), findings, missing };
}
