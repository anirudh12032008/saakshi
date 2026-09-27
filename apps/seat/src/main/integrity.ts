// The integrity gate's judgement (plan §3.4), pure: a probe snapshot + the signed policy + the candidate's accommodation → findings.
// No I/O here; probe-host.ts collects, gate.ts schedules and reports.
import type { Accommodation, IntegrityFinding, IntegrityPolicy } from '@saakshi/core/integrity';

import { baseName, matchRules, vmMacs, type ProbeResult } from './probe-parse.ts';
export { baseName, matchRules, vmMacs, type ProbeResult };

export interface Proc { pid: number; name: string; bundleId?: string }
export interface VmSignals { hv: boolean; model: string; bios: string; macs: string[] }
export interface ProbeSnapshot {
  platform: 'darwin' | 'win32' | 'linux'; at: number;
  procs: ProbeResult<Proc[]>; captureExcluded: ProbeResult<number[]>; remoteSession: ProbeResult<boolean>; vm: ProbeResult<VmSignals>;
  egress: ProbeResult<string[]>; displays: number; camera: 'on' | 'none' | 'off'; onBattery: boolean; freeBytes: number | null; skewMs: number | null;
}
const F = (code: IntegrityFinding['code'], level: IntegrityFinding['level'], detail: string, names: string[] = []): IntegrityFinding => ({ code, level, detail, names });
const LOOPBACK = /^(127\.|\[?::1\]?:|localhost:|fe80::1%lo0:)/;

export function vmScore(v: VmSignals, procs: Proc[], pol: IntegrityPolicy): { score: number; signals: string[] } {
  const has = (s: string) => pol.vmStrings.some((x) => s.toLowerCase().includes(x));
  const signals = [
    v.hv && 'hypervisor',
    (/^VirtualMac/i.test(v.model) || has(v.model)) && 'model',
    has(v.bios) && 'bios',
    vmMacs(v.macs, pol.vmMacPrefixes).length > 0 && 'mac',
    procs.some((p) => pol.guestTools.includes(baseName(p.name).toLowerCase())) && 'guest-tools',
  ].filter((s): s is string => typeof s === 'string');
  return { score: signals.length, signals };
}

export function evaluate(s: ProbeSnapshot, pol: IntegrityPolicy, acc: Accommodation, o: { testMode: boolean; defaulted: boolean }): IntegrityFinding[] {
  const out: IntegrityFinding[] = [], unknown: string[] = [];
  const procs = s.procs.status === 'ok' ? s.procs.value : (unknown.push('processes'), []);
  // Apple's own daemons live under /System and share names with tools (CoreParsec's parsecd): not blocklist material.
  const thirdParty = s.platform === 'darwin' ? procs.filter((p) => !p.name.startsWith('/System/')) : procs;
  const hits = matchRules(thirdParty, pol.blocklist);
  if (hits.length) out.push(F('blocklisted', 'block', hits.map((h) => `${h.rule} (pid ${procs.find((p) => baseName(p.name) === h.name)?.pid})`).join(' · '), hits.map((h) => h.name)));

  const allowed = new Set(acc.assistive ?? []), at = matchRules(procs, pol.assistive), atNames = new Set<string>();
  for (const h of at) atNames.add(h.rule);
  if (s.captureExcluded.status === 'ok') {
    const hidden: string[] = [];
    for (const pid of s.captureExcluded.value) {
      const p = procs.find((x) => x.pid === pid), name = p ? baseName(p.name) : `pid ${pid}`;
      const rule = p && matchRules([p], pol.assistive)[0];
      if (rule && allowed.has(rule.rule)) continue;              // Decision 5: exempt only with the signed accommodation
      hidden.push(name);
    }
    if (hidden.length) out.push(F('capture-excluded', 'block', `hidden from screen capture: ${hidden.join(', ')}`, hidden));
  } else unknown.push('captureExcluded');
  if (atNames.size) out.push(F('assistive', 'info', `assistive technology allowed: ${[...atNames].join(', ')}`, [...atNames]));

  const ssd = s.platform === 'darwin' && procs.some((p) => p.name.endsWith('/screensharingd'));
  if (s.remoteSession.status === 'ok' ? s.remoteSession.value || ssd : (unknown.push('remoteSession'), ssd))
    out.push(F('remote-session', 'block', s.platform === 'darwin' ? 'macOS Screen Sharing is active' : 'this is a remote desktop session'));

  if (s.vm.status === 'ok') {
    const v = vmScore(s.vm.value, procs, pol);
    if (v.score >= 2) out.push(F('vm', 'block', `virtual machine (score ${v.score}: ${v.signals.join(', ')})`, v.signals));
    else if (v.score === 1) out.push(F('vm-signal', 'review', `one virtual-machine signal: ${v.signals[0]}`, v.signals));
  } else unknown.push('vm');

  if (s.displays > 1) out.push(F('displays', 'review', `${s.displays} displays connected`));
  if (s.camera === 'none') out.push(F('no-camera', 'review', 'no camera available: invigilator attestation instead'));
  if (s.egress.status === 'ok') {
    const extra = s.egress.value.filter((h) => !LOOPBACK.test(h) && !pol.egress.includes(h));
    if (extra.length) out.push(F('egress', 'review', `connections outside the allowlist: ${extra.slice(0, 5).join(', ')}${extra.length > 5 ? ' …' : ''}`, extra.slice(0, 5)));
  } else unknown.push('egress');
  if (unknown.length) out.push(F('probe-unknown', 'review', `could not check: ${unknown.join(', ')}`, unknown));

  if (s.onBattery) out.push(F('battery', 'amber', 'running on battery'));
  if (s.freeBytes !== null && s.freeBytes < pol.amber.minFreeBytes) out.push(F('disk', 'amber', `${(s.freeBytes / 1024 ** 3).toFixed(1)} GB free`));
  if (s.skewMs !== null && Math.abs(s.skewMs) > pol.amber.maxSkewMs) out.push(F('clock-skew', 'amber', `clock differs from the centre server by ${Math.round(s.skewMs / 1000)} s`));
  if (o.testMode) out.push(F('test-mode', 'info', 'DEV test mode — not for real exams'));
  if (o.defaulted) out.push(F('policy-default', 'review', 'the signed policy has no integrity section; built-in defaults used'));
  return out;
}
