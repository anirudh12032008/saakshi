// The demo supervisor (Stage 4). It runs every Saakshi process for the Act 3 demo and lets control's chaos buttons SIGKILL a node —
// optionally deleting its database ("pull the plug") — start it again, or swap the relay for a spare. DEV only; it binds 127.0.0.1.
//   bun tools/stack.ts --exam data/exam [--data data] [--cohort data/g1/cohort.jsonl] [--speed 20] [--port 7099]
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT, spawnNode, type Proc } from './procs.ts';

export interface NodeSpec { name: string; env: Record<string, string>; db?: string; cmd?: string[]; ready?: string }

export class Stack {
  #specs: Map<string, NodeSpec>;
  #procs = new Map<string, Proc>();
  #restarts = new Map<string, number>();
  #cwd: string;
  #log: (name: string, line: string) => void;

  constructor(specs: NodeSpec[], o: { cwd: string; log?: (name: string, line: string) => void }) {
    this.#specs = new Map(specs.map((s) => [s.name, s]));
    this.#cwd = o.cwd;
    this.#log = o.log ?? (() => {});
  }

  async start(name: string): Promise<{ node: string; pid: number }> {
    const s = this.#specs.get(name);
    if (!s) throw new Error(`no node ${name}`);
    const cur = this.#procs.get(name);
    if (cur && cur.proc.exitCode === null) return { node: name, pid: cur.proc.pid };
    const p = await spawnNode({ env: s.env, cwd: this.#cwd, cmd: s.cmd, ready: s.ready, echo: (l) => this.#log(name, l) });
    this.#procs.set(name, p);
    this.#restarts.set(name, (this.#restarts.get(name) ?? -1) + 1);
    return { node: name, pid: p.proc.pid };
  }

  /** SIGKILL, like pulling the plug; with wipe, the node's database (and its WAL) is deleted too. */
  async kill(name: string, wipe = false): Promise<{ node: string; killed: boolean; wiped: string[] }> {
    const s = this.#specs.get(name);
    if (!s) throw new Error(`no node ${name}`);
    const p = this.#procs.get(name);
    let killed = false;
    if (p && p.proc.exitCode === null) { p.proc.kill('SIGKILL'); await p.proc.exited; killed = true; }
    const wiped: string[] = [];
    if (wipe && s.db) for (const f of [s.db, `${s.db}-wal`, `${s.db}-shm`]) if (existsSync(f)) { rmSync(f); wiped.push(f); }
    this.#log(name, `PLUG PULLED (SIGKILL)${wiped.length ? `; deleted ${wiped.join(', ')}` : ''}`);
    return { node: name, killed, wiped };
  }

  nodes(): { node: string; pid: number | null; up: boolean; restarts: number }[] {
    return [...this.#specs.keys()].map((node) => {
      const p = this.#procs.get(node);
      return { node, pid: p?.proc.pid ?? null, up: !!p && p.proc.exitCode === null, restarts: Math.max(0, this.#restarts.get(node) ?? 0) };
    });
  }

  serve(port = 7099) {
    const json = (b: unknown, status = 200) => Response.json(b, { status });
    const act = (fn: (b: { node?: unknown; wipe?: unknown }) => Promise<unknown>) => async (req: Request) => {
      const b = (await req.json().catch(() => ({}))) as { node?: unknown; wipe?: unknown };
      if (typeof b.node !== 'string' || !this.#specs.has(b.node)) return json({ error: `need {node}: one of ${[...this.#specs.keys()].join(', ')}` }, 400);
      try { return json(await fn(b)); } catch (e) { return json({ error: (e as Error).message }, 500); }
    };
    return Bun.serve({ hostname: '127.0.0.1', port, fetch: () => json({ error: 'not found' }, 404), routes: {
      '/nodes': { GET: () => json(this.nodes()) },
      '/kill': { POST: act((b) => this.kill(b.node as string, b.wipe === true)) },
      '/start': { POST: act((b) => this.start(b.node as string)) },
    } });
  }

  async stopAll(): Promise<void> {
    for (const p of this.#procs.values()) if (p.proc.exitCode === null) p.proc.kill();
    await Promise.all([...this.#procs.values()].map((p) => p.proc.exited));
  }
}

export function demoSpecs(o: { exam: string; data: string; stackUrl: string; cohort?: string; speed?: number; cellPorts?: number[]; relayPort?: number; controlPort?: number }): NodeSpec[] {
  const exam = resolve(o.exam), data = resolve(o.data), relayPort = o.relayPort ?? 7070;
  const specs: NodeSpec[] = (o.cellPorts ?? [7080, 7081, 7082]).map((port, i) => {
    const db = join(data, `cell-${i + 1}.db`);
    return { name: `cell-${i + 1}`, db, env: { MODE: 'cell', CELL_ID: `cell-${i + 1}`, PORT: String(port), EXAM: exam, DB: db } };
  });
  specs.push({ name: 'relay', db: join(data, 'relay.db'), env: { MODE: 'relay', PORT: String(relayPort), EXAM: exam, DB: join(data, 'relay.db') } });
  specs.push({ name: 'control', env: { MODE: 'control', PORT: String(o.controlPort ?? 7090), EXAM: exam, DIR: join(data, 'control'), STACK_URL: o.stackUrl, RELAY_URL: `http://127.0.0.1:${relayPort}` } });
  if (o.cohort) specs.push({ name: 'swarm', cmd: ['bun', join(ROOT, 'tools/swarm.ts'), '--exam', exam, '--cohort', resolve(o.cohort), '--speed', String(o.speed ?? 20)], ready: 'SWARM ', env: {} });
  return specs;
}

if (import.meta.main) {
  const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
  const port = Number(arg('--port') ?? 7099), data = resolve(arg('--data') ?? 'data');
  mkdirSync(data, { recursive: true });
  const specs = demoSpecs({ exam: arg('--exam') ?? 'data/exam', data, stackUrl: `http://127.0.0.1:${port}`, cohort: arg('--cohort'), speed: Number(arg('--speed') ?? 20) });
  const stack = new Stack(specs, { cwd: ROOT, log: (n, l) => console.log(`[${n}] ${l}`) });
  for (const s of specs) await stack.start(s.name);
  stack.serve(port);
  console.log(`STACK ${JSON.stringify(stack.nodes())}`);
  const stop = async () => { await stack.stopAll(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
