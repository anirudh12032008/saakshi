// Back to a clean slate for the demo (macOS or Linux). It stops every Saakshi process on the demo ports and quits the seat app (so the
// camera is never left on). It deletes the demo state under data/, keeping data/g1 (the cohort takes a while to regenerate). With
// --seat it also deletes the seat app's journal and its test-mode key.
//   bun tools/reset.ts [--data data] [--seat]
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const PORTS = [7070, 7080, 7081, 7082, 7090, 7099];
export function seatDataDir(platform: string = process.platform, env: Record<string, string | undefined> = process.env): string {
  if (platform === 'darwin') return join(homedir(), 'Library/Application Support/Saakshi');
  if (platform === 'win32') return join(env.APPDATA ?? join(homedir(), 'AppData/Roaming'), 'Saakshi');
  return join(homedir(), '.config/Saakshi');
}

if (import.meta.main) {
  const i = process.argv.indexOf('--data'), data = resolve(i > 0 ? process.argv[i + 1] : 'data');
  for (const port of PORTS) {
    const pids = new TextDecoder().decode(Bun.spawnSync(['lsof', '-ti', `tcp:${port}`, '-sTCP:LISTEN']).stdout).split(/\s+/).filter(Boolean);
    for (const pid of pids) { try { process.kill(Number(pid), 'SIGKILL'); console.log(`stopped pid ${pid} on :${port}`); } catch { /* already gone */ } }
  }
  Bun.spawnSync(['pkill', '-f', 'tools/swarm.ts']);
  Bun.spawnSync(['pkill', '-f', 'Saakshi.app/Contents/MacOS/Saakshi']);
  if (existsSync(data)) for (const f of readdirSync(data)) if (f !== 'g1') { rmSync(join(data, f), { recursive: true, force: true }); console.log(`deleted ${join(data, f)}`); }
  if (process.argv.includes('--seat')) for (const f of ['journal', 'test-mode.key']) { rmSync(join(seatDataDir(), f), { recursive: true, force: true }); console.log(`deleted ${join(seatDataDir(), f)}`); }
  console.log('RESET done');
}
