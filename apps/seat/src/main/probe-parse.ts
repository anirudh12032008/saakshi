import { execFile } from 'node:child_process';
import type { ToolRule } from '@saakshi/core/integrity';

export type ProbeResult<T = unknown> = { status: 'ok'; value: T } | { status: 'unknown'; error: string };

export function run(cmd: string, args: string[], timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

export async function probe<T>(fn: () => T | Promise<T>): Promise<ProbeResult<T>> {
  try { return { status: 'ok', value: await fn() }; } catch (e) { return { status: 'unknown', error: String((e as Error).message ?? e) }; }
}

export function parseTasklistCsv(csv: string): { name: string; pid: number }[] {
  return csv.split(/\r?\n/).filter(Boolean).map((line) => {
    const cols = [...line.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    return { name: cols[0], pid: Number(cols[1]) };
  });
}

export function parsePs(out: string): { name: string; pid: number }[] {
  return out.split('\n').map((l) => l.match(/^\s*(\d+)\s+(.+)$/)).filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ pid: Number(m[1]), name: m[2] }));
}

export const baseName = (n: string): string => n.split(/[\\/]/).pop()!.replace(/\.exe$/i, '');

export function matchRules(procs: { name: string; bundleId?: string }[], rules: ToolRule[]): { rule: string; name: string }[] {
  const out: { rule: string; name: string }[] = [], seen = new Set<string>();
  for (const p of procs) {
    const b = baseName(p.name), lb = b.toLowerCase();
    const r = rules.find((x) => x.procs.includes(lb) || (p.bundleId !== undefined && x.bundleIds.includes(p.bundleId)));
    if (r && !seen.has(`${r.name}/${b}`)) { seen.add(`${r.name}/${b}`); out.push({ rule: r.name, name: b }); }
  }
  return out;
}

export function parseNetstat(out: string, platform: 'darwin' | 'win32'): string[] {
  const set = new Set<string>();
  for (const line of out.split(/\r?\n/)) {
    const c = line.trim().split(/\s+/);
    if (platform === 'win32') { if (c[0] === 'TCP' && c[3] === 'ESTABLISHED') set.add(c[2]); continue; }
    if (!/^tcp[46]?$/.test(c[0]) || c[5] !== 'ESTABLISHED') continue;
    const i = c[4].lastIndexOf('.'); // macOS writes host.port
    set.add(`${c[4].slice(0, i)}:${c[4].slice(i + 1)}`);
  }
  return [...set];
}

const regValue = (out: string, key: string) => out.match(new RegExp(`^\\s*${key}\\s+REG_SZ\\s+(.+?)\\s*$`, 'm'))?.[1];
export const parseRegBios = (out: string): string =>
  ['SystemManufacturer', 'SystemProductName', 'BIOSVendor', 'BIOSVersion'].map((k) => regValue(out, k)).filter(Boolean).join(' | ');

export const parseIoregPlatform = (out: string): string =>
  ['manufacturer', 'model'].map((k) => out.match(new RegExp(`"${k}" = <"([^"]*)">`))?.[1]).filter(Boolean).join(' | ');

export const vmMacs = (macs: string[], prefixes: string[]): string[] =>
  macs.map((m) => m.toLowerCase()).filter((m) => m !== '00:00:00:00:00:00' && !m.startsWith('00:15:5d') && prefixes.some((p) => m.startsWith(p)));
