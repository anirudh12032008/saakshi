import { join } from 'node:path';
import { INTEGRITY_DEFAULT } from '@saakshi/core/integrity';
import { matchRules, parsePs, parseTasklistCsv, probe, run, type ProbeResult } from './probe-parse.ts';

const blocklistHits = (names: string[]): string[] => matchRules(names.map((name) => ({ name })), INTEGRITY_DEFAULT.blocklist).map((h) => h.name);

export interface Selftest { app: 'saakshi-seat'; platform: string; arch: string; electron: string; ok: boolean; ms: number; probes: Record<string, ProbeResult> }

async function winProbes(): Promise<Record<string, ProbeResult>> {
  const win = await import('./probes-win.ts');
  const tasklist = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tasklist.exe');
  return {
    remoteSession: await probe(() => win.remoteSession()),
    captureExcluded: await probe(() => win.captureExcludedWindows()),
    processes: await probe(async () => {
      const ps = parseTasklistCsv(await run(tasklist, ['/FO', 'CSV', '/NH']));
      return { count: ps.length, blocklistHits: blocklistHits(ps.map((p) => p.name)) };
    }),
  };
}

async function macProbes(): Promise<Record<string, ProbeResult>> {
  return {
    processes: await probe(async () => {
      const ps = parsePs(await run('/bin/ps', ['-axo', 'pid=,comm=']));
      // Apple's own daemons live under /System and can share names with blocklisted tools (e.g. CoreParsec's parsecd).
      const thirdParty = ps.map((p) => p.name).filter((n) => !n.startsWith('/System/'));
      return { count: ps.length, blocklistHits: blocklistHits(thirdParty), screensharing: ps.some((p) => p.name.endsWith('/screensharingd')) };
    }),
    hvVmmPresent: await probe(async () => (await run('/usr/sbin/sysctl', ['-n', 'kern.hv_vmm_present'])).trim() === '1'),
  };
}

export async function runSelftest(): Promise<Selftest> {
  const t0 = Date.now();
  const probes = process.platform === 'win32' ? await winProbes() : process.platform === 'darwin' ? await macProbes() : {};
  const ok = Object.keys(probes).length > 0 && Object.values(probes).every((p) => p.status === 'ok');
  return { app: 'saakshi-seat', platform: process.platform, arch: process.arch, electron: process.versions.electron ?? '', ok, ms: Date.now() - t0, probes };
}
