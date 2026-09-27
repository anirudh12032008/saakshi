// The e2e stack (Bun): a temp exam (provision + package, as tools/act3.ts does) and cell ×3, the Centre 42 relay and control on free
// ports through tools/stack.ts. The Playwright test drives the packaged e2e seat against it. Needs local ports (run unsandboxed).
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hexToBytes } from '../../../packages/core/src/bytes.ts';
import type { KeysFile } from '../../../packages/core/src/dev.ts';
import type { FleetView, ReleaseStatus } from '../../../packages/core/src/directory.ts';
import { formsOf, type Proof } from '../../../packages/core/src/sheet.ts';
import { verifyProof } from '../../../packages/core/src/verify.ts';
import { shareRequest, type ReleaseKey } from '../../server/src/custodian-view.ts';
import { buildPackage, writePackage, zeroise } from '../../../tools/package.ts';
import { call, freePort, ROOT, until } from '../../../tools/procs.ts';
import { provision } from '../../../tools/provision.ts';
import { demoSpecs, Stack } from '../../../tools/stack.ts';

export interface E2EStack {
  relayUrl: string; controlUrl: string;
  release(): Promise<void>; cutLink(down: boolean): Promise<void>; seal(): Promise<void>;
  verified(cand: string, code?: string): Promise<boolean>; stop(): Promise<void>;
}

const read = (f: string) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));

export async function startStack(): Promise<E2EStack> {
  const keys = read('fixtures/keys.json') as KeysFile;
  const authority = { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) };
  const dir = mkdtempSync(join(tmpdir(), 'saakshi-e2e-')), exam = join(dir, 'exam');
  const ports = { cells: [freePort(), freePort(), freePort()], relay: freePort(), control: freePort(), stack: freePort() };
  const R = `http://127.0.0.1:${ports.relay}`, C = `http://127.0.0.1:${ports.control}`;

  // The dev roster already seats C0001 at CEN042. The CI runner is itself a VM: without the string/MAC/guest-tool signals the VM score
  // is at most 1 (hypervisor flag) → review, so the gate lets the e2e seat start. The gate's own blocking is proven by --gate-selftest.
  const X = provision({ out: exam, keys, cands: [], cellUrls: ports.cells.map((p) => `http://127.0.0.1:${p}`),
    relayHosts: { CEN042: `127.0.0.1:${ports.relay}` }, integrity: { vmStrings: [], vmMacPrefixes: [], guestTools: [] } });
  const pkg = await buildPackage(X, { bank: read('fixtures/paper/bank.json'), forms: read('fixtures/paper/forms.json') }, authority);
  writePackage(exam, pkg);
  const custodians = { NTA: { file: pkg.shares.NTA, pass: pkg.passphrases.NTA }, NIC: { file: pkg.shares.NIC, pass: pkg.passphrases.NIC } };
  zeroise(pkg);

  const specs = demoSpecs({ exam, data: join(dir, 'data'), stackUrl: `http://127.0.0.1:${ports.stack}`, cellPorts: ports.cells, relayPort: ports.relay, controlPort: ports.control });
  specs.find((s) => s.name === 'relay')!.env.HOST = '127.0.0.1';
  mkdirSync(join(dir, 'data'), { recursive: true });
  const stack = new Stack(specs, { cwd: dir, log: () => {} });
  try { for (const s of specs) await stack.start(s.name); }
  catch (e) { await stack.stopAll(); rmSync(dir, { recursive: true, force: true }); throw e; }

  return {
    relayUrl: R, controlUrl: C,
    async release() {
      const key = await call<ReleaseKey>(`${C}/v1/release/key`);
      for (const c of ['NTA', 'NIC'] as const) await call(`${C}/v1/release/share`, 'POST', shareRequest(custodians[c].file, custodians[c].pass, key));
      await until(async () => (await call<ReleaseStatus>(`${C}/v1/release/status`)).zeroised, 30_000, 'the release reaching every cell');
    },
    async cutLink(down) { await call(`${R}/v1/dev/wan`, 'POST', { up: !down }); },
    async seal() {
      await until(async () => (await call<FleetView>(`${C}/v1/fleet`)).submitted >= 1, 60_000, 'the submit reaching the cell', 500);
      await call(`${C}/v1/seal`, 'POST');
    },
    async verified(cand, code) {
      const proof = await call<Proof>(`${C}/v1/proof?cand=${encodeURIComponent(cand)}`);
      const v = verifyProof(proof, formsOf(read('fixtures/paper/forms.json')), { authority: keys.authority.pub, cells: {}, seats: {} }, code);
      if (!v.ok) console.error(`/verify: ${JSON.stringify(v.checks.filter((c) => !c.ok))}`);
      return v.ok;
    },
    async stop() { await stack.stopAll(); rmSync(dir, { recursive: true, force: true }); },
  };
}

// Playwright's Electron driver hangs under Bun (its CDP connection never completes), so the spec runs under node --test and drives
// this stack as a Bun child: one JSON line out on start, then one command per stdin line, one JSON reply line each.
if (import.meta.main) {
  const s = await startStack();
  console.log(JSON.stringify({ relayUrl: s.relayUrl, controlUrl: s.controlUrl }));
  const cmds: Record<string, (...a: string[]) => Promise<unknown>> = {
    release: () => s.release(), 'wan-down': () => s.cutLink(true), 'wan-up': () => s.cutLink(false), seal: () => s.seal(),
    verified: (cand, code) => s.verified(cand, code),
  };
  const quit = async () => { await s.stop(); process.exit(0); };
  process.on('SIGTERM', quit);
  for await (const line of console) {
    const [cmd, ...args] = line.trim().split(' ');
    if (cmd === 'stop') await quit();
    try { console.log(JSON.stringify({ ok: true, value: (await cmds[cmd]!(...args)) ?? null })); }
    catch (e) { console.log(JSON.stringify({ ok: false, error: (e as Error).message })); }
  }
  await quit();
}
