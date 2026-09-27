import { execFile } from 'node:child_process';

export type ProbeResult = { status: 'ok'; value: unknown } | { status: 'unknown'; error: string };

// ponytail: fixed spike list; Stage 5 moves it into the signed integrity policy with bundle IDs.
export const BLOCKLIST = ['anydesk', 'teamviewer', 'rustdesk', 'parsecd', 'remoting_host', 'vncserver', 'tvnserver', 'winvnc', 'obs', 'obs64', 'obs studio', 'cluely'];

export function run(cmd: string, args: string[], timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

export async function probe(fn: () => unknown | Promise<unknown>): Promise<ProbeResult> {
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

export function blocklistHits(names: string[]): string[] {
  const base = (n: string) => n.split(/[\\/]/).pop()!.toLowerCase().replace(/\.exe$/, '');
  return [...new Set(names.map(base).filter((b) => BLOCKLIST.includes(b)))];
}
