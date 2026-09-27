// Saakshi server: MODE=relay|cell|control. DEV=1 until Stage 3 (fixture keys and roster, no enrolment).
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { hexToBytes } from '@saakshi/core/bytes';
import { cellKey, DEV_CENTRE, DEV_EXAM, devForm, devPseud, devRoster, devSeat, devSeatKey, trustFromKeys, type KeysFile } from '@saakshi/core/dev';
import { formsOf } from '@saakshi/core/sheet';
import consoleHtml from './console.html';
import controlHtml from './control.html';
import { controlRoutes } from './control.ts';
import { Forwarder, httpCellSend } from './forward.ts';
import { createIngest } from './ingest.ts';
import { heads, serve } from './serve.ts';
import { rogueEdit, type RogueIn, shiftExport } from './sheet-export.ts';
import { Hub } from './sse.ts';
import { openDb, pragmas } from './store.ts';

const env = process.env;
const mode = env.MODE;
if (mode !== 'cell' && mode !== 'relay' && mode !== 'control') { console.error('MODE must be cell, relay or control'); process.exit(2); }
if (env.DEV !== '1') { console.error('Saakshi trusts the fixture keys only with DEV=1 (enrolment arrives in Stage 3)'); process.exit(2); }

const fixtures = resolve(import.meta.dir, '../../../fixtures');
const keys = (await Bun.file(env.KEYS ?? `${fixtures}/keys.json`).json()) as KeysFile;
const forms = formsOf(await Bun.file(env.FORMS ?? `${fixtures}/paper/forms.json`).json());
const formOf = (cand: string) => (devSeat(keys, cand) ? devForm(cand) : undefined);
const json = (body: unknown, status = 200) => Response.json(body, { status });

// ponytail: cell and control have unauthenticated routes (/v1/shift, the DEV rogue edit) until control↔cell auth (S7 mTLS)
// lands, so they refuse to bind anywhere but loopback. Only the relay faces the centre LAN.
const LOOPBACK = ['127.0.0.1', 'localhost', '::1'];
if (mode !== 'relay' && env.HOST && !LOOPBACK.includes(env.HOST)) {
  console.error(`MODE=${mode} must bind loopback until control↔cell auth exists (got HOST=${env.HOST})`); process.exit(2);
}

if (mode === 'control') {
  const server = Bun.serve({
    port: Number(env.PORT ?? 7090),
    hostname: env.HOST ?? '127.0.0.1',
    maxRequestBodySize: 64 * 1024,
    routes: controlRoutes({
      dir: resolve(env.DIR ?? 'data/control'),
      authority: { priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) },
      trust: trustFromKeys(keys), forms, formOf, pseud: devPseud, roster: devRoster(keys), centre: DEV_CENTRE,
      exam: DEV_EXAM.exam, shift: DEV_EXAM.shift,
      cellUrl: env.CELL_URL ?? 'http://127.0.0.1:7080', relayUrl: env.RELAY_URL ?? 'http://127.0.0.1:7070',
    }, controlHtml),
    fetch: () => json({ error: 'not found' }, 404),
  });
  console.log(`READY ${JSON.stringify({ mode, port: server.port, state: 'LIVE' })}`);
  const stop = () => { server.stop(true); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} else {
  const cell = cellKey(keys, env.CELL_ID ?? 'cell-1');          // the key lives in the keys file, never in the DB
  const dbPath = resolve(env.DB ?? `data/${mode}.db`);
  mkdirSync(dirname(dbPath), { recursive: true });
  const { db, fresh } = openDb(dbPath);
  const p = pragmas(db);
  if (p.journal_mode !== 'wal' || p.synchronous !== 2 || (process.platform === 'darwin' && p.fullfsync !== 1)) {
    console.error('durability pragmas did not apply (try Database.setCustomSQLite with Homebrew sqlite)', p);
    process.exit(3);
  }

  let hub: Hub | undefined;
  const ingest = createIngest({
    mode, db, fresh,
    seatKey: devSeatKey(keys),
    cell: mode === 'cell' ? cell : { pub: cell.pub },
    rebuildRelays: Number(env.REBUILD_RELAYS ?? 1),
    forms, formOf, pseud: devPseud, cellId: cell.id,
    onView: (v) => hub?.publish('stream', v),
    onState: (s) => hub?.publish('state', { state: s }),
  });
  hub = new Hub(() => heads(ingest));
  const cellRoutes = mode === 'cell' ? {
    '/v1/shift': { GET: (req: Request) => {
      const u = new URL(req.url), exam = u.searchParams.get('exam'), shift = u.searchParams.get('shift');
      if (!exam || !shift) return json({ error: 'need ?exam=&shift=' }, 400);
      return json(shiftExport(db, { exam, shift, cell: cell.id, formOf, pseud: devPseud, seatKey: devSeatKey(keys) }));
    } },
    // DEV chaos only — the "rogue insider" button. Prints the SQL so the cell's terminal shows the edit.
    '/v1/dev/rogue': { POST: async (req: Request) => {
      const b = (await req.json().catch(() => null)) as RogueIn | null;
      if (!b || typeof b.exam !== 'string' || typeof b.shift !== 'string' || !Number.isSafeInteger(b.attempt) || typeof b.cand !== 'string'
        || typeof b.item !== 'string' || !['A', 'B', 'C', 'D'].includes(b.answer)) return json({ error: 'need {exam, shift, attempt, cand, item, answer}' }, 400);
      try { const r = rogueEdit(db, b); console.log(`ROGUE ${r.sql}`); return json(r); }
      catch (e) { return json({ error: (e as Error).message }, 404); }
    } },
  } : undefined;
  const server = serve(ingest, hub, {
    port: Number(env.PORT ?? (mode === 'relay' ? 7070 : 7080)),
    hostname: env.HOST ?? (mode === 'relay' ? '0.0.0.0' : '127.0.0.1'),
    consoleHtml: mode === 'relay' ? consoleHtml : undefined,
    routes: cellRoutes,
  });
  const fwd = mode === 'relay' ? new Forwarder(ingest, httpCellSend(env.CELL_URL ?? 'http://127.0.0.1:7080')) : undefined;
  fwd?.start();

  console.log(`READY ${JSON.stringify({ mode, port: server.port, state: ingest.state(), db: dbPath, pragmas: p })}`);

  const stop = async () => { await fwd?.stop(); server.stop(true); ingest.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
