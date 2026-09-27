// Saakshi server: MODE=relay|cell|control, DEV=1 only. With EXAM=<dir> (Stage 3) keys, roster, policy and paper come from the
// provisioned and packaged exam directory, and seats are trusted only through cell-signed bindings. Without EXAM, every mode
// behaves exactly as in Stage 2 (fixture seat keys, DEV roster): the Stage 1–2 tests and tools rely on that.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import { cellKey, DEV_CENTRE, DEV_EXAM, devForm, devPseud, devRoster, devSeat, devSeatKey, trustFromKeys, type KeysFile } from '@saakshi/core/dev';
import { FILES, rosterOf } from '@saakshi/core/directory';
import { checkWireBind, type WireBind } from '@saakshi/core/enrol';
import { INTEGRITY_DEFAULT } from '@saakshi/core/integrity';
import { verifier } from '@saakshi/core/node';
import { opsOf } from '@saakshi/core/ops';
import type { Policy } from '@saakshi/core/policy';
import { genesisPrev } from '@saakshi/core/protocol';
import { formsOf } from '@saakshi/core/sheet';
import { purgeRoute } from './archive.ts';
import { Bindings } from './bindings.ts';
import { cellRoutes } from './cell-routes.ts';
import consoleHtml from './console.html';
import controlHtml from './control.html';
import { controlRoutes } from './control.ts';
import custodianHtml from './custodian.html';
import { codesFile, loadCellKey, loadExam, relayFiles } from './exam-env.ts';
import { fleet } from './fleet.ts';
import { Forwarder, httpCellSend } from './forward.ts';
import { cellHandover } from './handover.ts';
import { createIngest } from './ingest.ts';
import { integrityRoutes } from './integrity-routes.ts';
import { LinkMonitor } from './link.ts';
import { opsMonitor } from './ops-monitor.ts';
import { opsRoutes } from './ops-routes.ts';
import { relayHandover } from './relay-handover.ts';
import { relayIntegrity } from './relay-integrity.ts';
import { relayOps } from './relay-ops.ts';
import { relayRoutes, Wan } from './relay-routes.ts';
import { releaseControl } from './release-control.ts';
import { ReleaseStore } from './release-store.ts';
import { heads, serve, type Routes } from './serve.ts';
import { rogueEdit, type RogueIn, shiftExport } from './sheet-export.ts';
import { Hub } from './sse.ts';
import statusHtml from './status.html';
import { openDb, pragmas } from './store.ts';

const env = process.env;
const mode = env.MODE;
if (mode !== 'cell' && mode !== 'relay' && mode !== 'control') { console.error('MODE must be cell, relay or control'); process.exit(2); }
if (env.DEV !== '1') { console.error('Saakshi runs only with DEV=1 (demo keys; see docs/threat-model.md)'); process.exit(2); }
// ponytail: cell and control have unauthenticated routes (/v1/shift, the DEV rogue edit, /v1/enrol, /v1/release) until control↔cell
// auth (S7 mTLS) lands, so they refuse to bind anywhere but loopback. Only the relay faces the centre LAN.
const LOOPBACK = ['127.0.0.1', 'localhost', '::1'];
if (mode !== 'relay' && env.HOST && !LOOPBACK.includes(env.HOST)) {
  console.error(`MODE=${mode} must bind loopback until control↔cell auth exists (got HOST=${env.HOST})`); process.exit(2);
}

const fixtures = resolve(import.meta.dir, '../../../fixtures');
const keys = (await Bun.file(env.KEYS ?? `${fixtures}/keys.json`).json()) as KeysFile;
const forms = formsOf(await Bun.file(env.FORMS ?? `${fixtures}/paper/forms.json`).json());
const authorityPub = hexToBytes(keys.authority.pub);
const X = env.EXAM ? loadExam(resolve(env.EXAM), authorityPub) : undefined;       // throws (exit ≠ 0) if anything fails to verify
const exam = X ? { exam: X.dir.exam, shift: X.dir.shift } : { exam: DEV_EXAM.exam, shift: DEV_EXAM.shift };
const formOf = (cand: string) => (X ? X.dir.cands[cand]?.form : devSeat(keys, cand) ? devForm(cand) : undefined);
const pseud = (cand: string) => (X ? X.dir.cands[cand]?.pseud ?? '' : devPseud(cand));
const json = (body: unknown, status = 200) => Response.json(body, { status });
const ops = opsOf(X?.dir.ops);
/** Addendum C.8: D_i + gap cap + slack, from the provisioned directory. DEV (no EXAM): no hard stop. */
const deadlineMs = X ? (cand: string) => { const c = X.dir.cands[cand]; return c ? X.dir.durationMs + c.extraMs + ops.gapCapMs + ops.slackMs : undefined; } : undefined;

if (mode === 'control') {
  const dir = resolve(env.DIR ?? 'data/control');
  const authority = { priv: hexToBytes(keys.authority.priv), pub: authorityPub };
  const demo = X?.dir.demoCentre ?? DEV_CENTRE;
  const demoCell = X?.dir.cells.find((c) => c.id === X.dir.centres[demo]?.cell);
  const cellUrl = env.CELL_URL ?? demoCell?.url ?? 'http://127.0.0.1:7080';
  const seatKeys = demoCell && (async () => {
    const r = await fetch(`${cellUrl}/v1/binds`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`${cellUrl}/v1/binds answered ${r.status}`);
    const out: Record<string, string> = {};
    for (const wb of ((await r.json()) as { binds: WireBind[] }).binds) {
      try { const b = checkWireBind(wb, hexToBytes(demoCell.pub), verifier); out[`${b.cand}/${b.keyEpoch}`] = b.pub; } catch { /* not certified by that cell: not trusted */ }
    }
    return out;
  });
  const rc = X && releaseControl({ dir, ...exam, authority, manifest: X.manifest, codes: codesFile(X), cells: X.dir.cells.map((c) => ({ id: c.id, url: c.url })) });
  const fl = X && fleet({ dir: X.dir });
  fl?.start();
  const relayUrl = env.RELAY_URL ?? 'http://127.0.0.1:7070';
  mkdirSync(dir, { recursive: true });
  const custody = (action: string, detail: Record<string, unknown>) =>
    appendFileSync(join(dir, 'custody.jsonl'), JSON.stringify({ at: new Date().toISOString(), actor: 'control (DEV)', action, ...exam, ...detail }) + '\n');
  const mon = X && fl ? opsMonitor({ dir: X.dir, ops, controlDir: dir, fleet: () => fl.view(), relayUrl, release: rc ? () => rc.status() : undefined }) : undefined;
  const rkPath = X && join(X.root, FILES.reviewKey);
  const integ = rkPath && existsSync(rkPath)
    ? integrityRoutes({ relayUrl, dir: X!.dir, centre: demo, controlDir: dir, reviewPriv: hexToBytes((JSON.parse(readFileSync(rkPath, 'utf8')) as { priv: string }).priv), retentionMs: INTEGRITY_DEFAULT.retentionMs })
    : undefined;
  if (rkPath && !integ) console.log(`review key missing: re-run tools/provision.ts (${rkPath})`);
  const server = Bun.serve({
    port: Number(env.PORT ?? 7090),
    hostname: env.HOST ?? '127.0.0.1',
    maxRequestBodySize: 64 * 1024,
    routes: {
      ...controlRoutes({
        dir, authority, forms, formOf, pseud, ...exam, centre: demo, cellUrl, relayUrl,
        trust: X ? { ...trustFromKeys(keys), seats: {} } : trustFromKeys(keys),              // EXAM: seat keys come only from cell-signed bindings
        seatKeys, roster: X ? rosterOf(X.dir, demo) : devRoster(keys),
        cells: X?.dir.cells.map(({ id, keyId, pub, cert }) => ({ id, keyId, pub, cert })),
        onFindings: mon ? (f) => mon.noteFindings(f) : undefined,
      }, controlHtml),
      ...rc?.routes,
      ...fl?.routes,
      ...((X ? { '/custodian': custodianHtml } : {}) as Record<string, typeof custodianHtml>),
      ...(X && mon ? opsRoutes({ monitor: mon, dir: X.dir, ops, controlDir: dir, authority, cellUrl, relayUrl, stackUrl: env.STACK_URL, forms,
          roster: rosterOf(X.dir, demo), recPath: join(dir, `sth-${exam.exam}-${exam.shift}.json`),
          stores: [env.ARCHIVE_A ?? join(dir, 'worm-a'), env.ARCHIVE_B ?? join(dir, 'worm-b')], custody }) : {}),
      ...((X ? { '/status': statusHtml } : {}) as Record<string, typeof statusHtml>),
      ...integ?.routes,
    },
    fetch: () => json({ error: 'not found' }, 404),
  });
  mon?.start();
  integ?.start();
  console.log(`READY ${JSON.stringify({ mode, port: server.port, state: 'LIVE', exam: X?.root ?? null, ops: ops.demo ? 'demo' : 'default' })}`);
  const stop = () => { mon?.stop(); integ?.stop(); fl?.stop(); rc?.close(); server.stop(true); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} else {
  const dbPath = resolve(env.DB ?? `data/${mode}.db`);
  mkdirSync(dirname(dbPath), { recursive: true });
  const { db, fresh } = openDb(dbPath);
  const p = pragmas(db);
  if (p.journal_mode !== 'wal' || p.synchronous !== 2 || (process.platform === 'darwin' && p.fullfsync !== 1)) {
    console.error('durability pragmas did not apply (try Database.setCustomSQLite with Homebrew sqlite)', p);
    process.exit(3);
  }
  const centre = env.CENTRE ?? X?.dir.demoCentre ?? DEV_CENTRE;
  const rf = X && mode === 'relay' ? relayFiles(X, centre) : undefined;
  // The cell's key lives outside its DB: the certified key file (EXAM) or the fixture keys file (DEV).
  const cell = mode === 'cell'
    ? (X ? loadCellKey(X, env.CELL_ID ?? 'cell-1') : cellKey(keys, env.CELL_ID ?? 'cell-1'))
    : { id: rf?.cell.id ?? 'cell-1', pub: rf ? hexToBytes(rf.cell.pub) : cellKey(keys, 'cell-1').pub };
  const cellUrl = env.CELL_URL ?? rf?.cell.url ?? 'http://127.0.0.1:7080';
  const bindings = X ? new Bindings(db, { ...exam, cell }) : undefined;
  const releaseHub = new Hub(() => ({ releases: releases?.list() ?? [] }));
  const releases = X ? new ReleaseStore(db, { ...exam, manifest: X.manifest.manifest, authority: X.authority, requireSig: mode === 'cell', onNew: (r) => releaseHub.publish('release', r) }) : undefined;
  const seatKey = bindings ? bindings.seatKey : devSeatKey(keys);                       // EXAM: only cell-certified seat keys, never the fixtures

  let hub: Hub | undefined;
  const served = X && mode === 'cell' ? Object.values(X.dir.centres).filter((c) => c.cell === cell.id).length : 1;
  const rebuildRelays = Number(env.REBUILD_RELAYS ?? Math.max(1, served));
  const link = mode === 'relay' ? new LinkMonitor({ centre }) : undefined;
  const ingest = createIngest({
    mode, db, fresh, seatKey,
    acceptBinds: bindings && ((b) => bindings.acceptAll(b)),
    fromSeq: bindings ? bindings.fromSeqOf : undefined, deadlineMs,
    releases: mode === 'cell' && releases ? () => releases.list() : undefined,
    cell: mode === 'cell' ? cell : { pub: cell.pub },
    rebuildRelays, rebuildGraceMs: ops.rebuildGraceMs,
    forms, formOf, pseud, cellId: cell.id,
    onView: (v) => hub?.publish('stream', v),
    onState: (s) => hub?.publish('state', { state: s }),
  });
  hub = new Hub(() => heads(ingest));
  const wan = new Wan();
  const modeRoutes: Routes = mode === 'cell' ? {
    '/v1/shift': { GET: (req) => {
      const u = new URL(req.url), qExam = u.searchParams.get('exam'), qShift = u.searchParams.get('shift');
      if (!qExam || !qShift) return json({ error: 'need ?exam=&shift=' }, 400);
      return json(shiftExport(db, { exam: qExam, shift: qShift, cell: cell.id, formOf, pseud, seatKey, binds: bindings ? (c: string) => bindings.forCand(c) : undefined }));
    } },
    // DEV chaos only — the "rogue insider" button. Prints the SQL so the cell's terminal shows the edit.
    '/v1/dev/rogue': { POST: async (req) => {
      const b = (await req.json().catch(() => null)) as RogueIn | null;
      if (!b || typeof b.exam !== 'string' || typeof b.shift !== 'string' || !Number.isSafeInteger(b.attempt) || typeof b.cand !== 'string'
        || typeof b.item !== 'string' || !['A', 'B', 'C', 'D'].includes(b.answer)) return json({ error: 'need {exam, shift, attempt, cand, item, answer}' }, 400);
      try { const r = rogueEdit(db, b); console.log(`ROGUE ${r.sql}`); return json(r); }
      catch (e) { return json({ error: (e as Error).message }, 404); }
    } },
    ...(X && bindings && releases ? cellRoutes({
      cellId: cell.id, dir: X.dir, bindings, releases, state: () => ingest.state(), views: () => ingest.views(),
      submitted: () => (db.query('SELECT cand FROM receipts WHERE exam = ? AND shift = ?').all(exam.exam, exam.shift) as { cand: string }[]).map((r) => r.cand),
      handover: cellHandover({ ...exam, cell: cell as { id: string; pub: Uint8Array; priv: Uint8Array }, bindings, forms, formOf: (c) => formOf(c),
        stream: (c) => ingest.snapshot(c), record: (c, seq, data) => ingest.note('HANDOVER', c, seq, data), pinTries: ops.pinTries }),
      events: (after, limit) => ingest.events(after, limit),
      rebuild: () => ingest.rebuild(),
    }) : {}),
  } : {
    ...(X && rf && bindings && releases ? {
      ...relayRoutes({ ...exam, centre, policy: rf.policy, manifest: X.manifest, papers: rf.papers, wrap: rf.wrap, cellUrl, bindings, releases, hub: releaseHub, wan, dev: true }),
      ...relayHandover({ ...exam, cellUrl, bindings, head: (c) => { const s = ingest.snapshot(c); return s ? { seq: s.head, h: s.headH } : { seq: 0, h: genesisPrev(c) }; } }),
      ...purgeRoute({ ...exam, authority: X.authority, db }),
      ...relayIntegrity({ ...exam, dir: join(dirname(dbPath), 'integrity'), bindings, cellPub: hexToBytes((JSON.parse(rf.policy.text) as Policy).cell.pub) }),
    } : {}),
    ...relayOps({ centre, link: link!, wan, dev: true, events: (after, limit) => ingest.events(after, limit) }),
  };
  const server = serve(ingest, hub, {
    port: Number(env.PORT ?? (mode === 'relay' ? 7070 : 7080)),
    hostname: env.HOST ?? (mode === 'relay' ? '0.0.0.0' : '127.0.0.1'),
    consoleHtml: mode === 'relay' ? consoleHtml : undefined,
    routes: modeRoutes,
  });
  const fwd = mode === 'relay'
    ? new Forwarder(ingest, wan.wrap(httpCellSend(cellUrl)), { ...(bindings && releases ? { releases, bindFor: (c) => bindings.forCand(c.cand) } : {}), onRound: (r) => link!.record(r) })
    : undefined;
  fwd?.start();

  console.log(`READY ${JSON.stringify({ mode, port: server.port, state: ingest.state(), db: dbPath, pragmas: p, exam: X?.root ?? null, ops: ops.demo ? 'demo' : 'default', ...(mode === 'relay' ? { centre } : { rebuildRelays }) })}`);

  const stop = async () => { await fwd?.stop(); server.stop(true); ingest.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
