// Shared by the Stage 4 tools: start a Saakshi process and wait for its READY line, free ports, JSON calls, polling.
import { join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dir, '..');
export const MAIN = join(ROOT, 'apps/server/src/main.ts');
export const freePort = (): number => { const s = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() }); const p = s.port!; s.stop(true); return p; };
export interface Proc { proc: ReturnType<typeof Bun.spawn>; out: string[] }
/** Still running. Bun leaves exitCode null for a process killed by a signal (SIGKILL sets signalCode), so check both. */
export const alive = (p: Proc): boolean => p.proc.exitCode === null && p.proc.signalCode === null;

/** Spawn (default: the server with DEV=1) and wait for a line starting with `ready` (default "READY "). */
export async function spawnNode(o: { env: Record<string, string>; cwd: string; cmd?: string[]; ready?: string; timeoutMs?: number; echo?: (line: string) => void }): Promise<Proc> {
  const proc = Bun.spawn(o.cmd ?? ['bun', MAIN], { cwd: o.cwd, env: { ...process.env, DEV: '1', ...o.env }, stdout: 'pipe', stderr: 'inherit' });
  const out: string[] = [];
  void (async () => {
    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
      buf += dec.decode(chunk);
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) { const l = buf.slice(0, i); out.push(l); o.echo?.(l); buf = buf.slice(i + 1); }
    }
  })();
  const ready = o.ready ?? 'READY ', deadline = Date.now() + (o.timeoutMs ?? 20_000), what = o.env.MODE ?? o.cmd?.join(' ') ?? 'process';
  while (!out.some((l) => l.startsWith(ready))) {
    if (proc.exitCode !== null || proc.signalCode !== null) throw new Error(`${what} exited before ${ready.trim()}:\n${out.join('\n')}`);
    if (Date.now() > deadline) { proc.kill(); throw new Error(`${what} did not print ${ready.trim()}`); }
    await Bun.sleep(20);
  }
  return { proc, out };
}

export async function call<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

/** Poll until ok() holds; returns the time it took. */
export async function until(ok: () => boolean | Promise<boolean>, ms: number, what: string, everyMs = 100): Promise<number> {
  const t0 = Date.now();
  while (!(await ok())) { if (Date.now() - t0 > ms) throw new Error(`timed out after ${ms} ms: ${what}`); await Bun.sleep(everyMs); }
  return Date.now() - t0;
}
