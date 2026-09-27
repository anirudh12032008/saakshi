// The real probe collector (plan §3.4): OS I/O → a ProbeSnapshot for the pure evaluator (integrity.ts). Every probe is independent:
// one that fails or hangs is `unknown` (→ a review finding), never a crash and never green. koffi loads only behind a platform check.
import { statfs } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import type { Proc, ProbeSnapshot, VmSignals } from './integrity.ts';
import { parseIoregPlatform, parseNetstat, parsePs, parseRegBios, parseTasklistCsv, probe, run } from './probe-parse.ts';

/** Host facts only Electron knows (screens, power, camera, the relay's clock); tests pass neutral ones. */
export interface HostInputs { displays: () => number; onBattery: () => boolean; camera: () => 'on' | 'none' | 'off'; skewMs: () => number | null; dataDir: string }

const bundleIds = new Map<string, string | undefined>();
async function bundleIdOf(app: string): Promise<string | undefined> {
  if (!bundleIds.has(app)) {
    const id = await run('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleIdentifier', join(app, 'Contents', 'Info.plist')], 1000).then((s) => s.trim() || undefined, () => undefined);
    bundleIds.set(app, id);
  }
  return bundleIds.get(app);
}

async function macProcs(t: number): Promise<Proc[]> {
  const ps: Proc[] = parsePs(await run('/bin/ps', ['-axo', 'pid=,comm='], t));
  const appOf = (n: string) => n.match(/^(\/Applications\/.*?\.app)\//)?.[1];
  const ids = new Map(await Promise.all([...new Set(ps.map((p) => appOf(p.name)).filter((a): a is string => !!a))].map(async (a) => [a, await bundleIdOf(a)] as const)));
  return ps.map((p) => { const b = ids.get(appOf(p.name) ?? ''); return b ? { ...p, bundleId: b } : p; });
}

const macs = (): string[] => Object.values(networkInterfaces()).flat().filter((i) => i && !i.internal && i.mac).map((i) => i!.mac);

export async function collect(h: HostInputs, timeoutMs = 5000): Promise<ProbeSnapshot> {
  const t = timeoutMs, pf = process.platform, win = pf === 'win32', mac = pf === 'darwin';
  const sys32 = (exe: string) => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', exe);
  const biosKey = 'HKLM\\HARDWARE\\DESCRIPTION\\System\\BIOS';
  const [procs, captureExcluded, remoteSession, vm, egress, freeBytes] = await Promise.all([
    probe<Proc[]>(async () => (win ? parseTasklistCsv(await run(sys32('tasklist.exe'), ['/FO', 'CSV', '/NH'], t)) : mac ? macProcs(t) : parsePs(await run('/bin/ps', ['-axo', 'pid=,comm='], t)))),
    probe<number[]>(async () => {
      if (win) return (await import('./probes-win.ts')).captureExcludedWindows().excluded.map((w) => w.pid);
      if (mac) return (await import('./probes-mac.ts')).captureExcludedWindowsMac().excluded.map((w) => w.pid);  // throws in a sandbox → unknown
      throw new Error(`no capture probe on ${pf}`);
    }),
    probe<boolean>(async () => (win ? (await import('./probes-win.ts')).remoteSession() : false)),   // macOS: screensharingd is judged from procs
    probe<VmSignals>(async () => {
      if (mac) {
        const [hv, model, io] = await Promise.all([run('/usr/sbin/sysctl', ['-n', 'kern.hv_vmm_present'], t), run('/usr/sbin/sysctl', ['-n', 'hw.model'], t), run('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], t)]);
        return { hv: hv.trim() === '1', model: model.trim(), bios: parseIoregPlatform(io), macs: macs() };
      }
      if (win) {
        // hv false: no cheap, reliable hypervisor signal without CPUID (honest); the other classes still count.
        const bios = await run(sys32('reg.exe'), ['query', biosKey], t);
        const model = bios.match(/^\s*SystemProductName\s+REG_SZ\s+(.+?)\s*$/m)?.[1] ?? '';
        return { hv: false, model, bios: parseRegBios(bios), macs: macs() };
      }
      throw new Error(`no VM probe on ${pf}`);
    }),
    probe<string[]>(async () => (win ? parseNetstat(await run(sys32('NETSTAT.EXE'), ['-ano', '-p', 'TCP'], t), 'win32') : parseNetstat(await run('/usr/sbin/netstat', ['-anp', 'tcp'], t), 'darwin'))),
    statfs(h.dataDir).then((s) => s.bavail * s.bsize, () => null),
  ]);
  return { platform: win ? 'win32' : mac ? 'darwin' : 'linux', at: Date.now(), procs, captureExcluded, remoteSession, vm, egress,
    displays: h.displays(), camera: h.camera(), onBattery: h.onBattery(), freeBytes, skewMs: h.skewMs() };
}
