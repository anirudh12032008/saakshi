// Saakshi server: MODE=relay|cell. Stage 1 trusts the fixture seat keys only with DEV=1.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { cellKey, devSeatKey, type KeysFile } from '@saakshi/core/dev';
import consoleHtml from './console.html';
import { Forwarder, httpCellSend } from './forward.ts';
import { createIngest } from './ingest.ts';
import { heads, serve } from './serve.ts';
import { Hub } from './sse.ts';
import { openDb, pragmas } from './store.ts';

const env = process.env;
const mode = env.MODE;
if (mode !== 'cell' && mode !== 'relay') { console.error('MODE must be cell or relay'); process.exit(2); }
if (env.DEV !== '1') { console.error('Stage 1 trusts the fixture seat keys only with DEV=1 (enrolment arrives in Stage 3)'); process.exit(2); }

const keys = (await Bun.file(env.KEYS ?? resolve(import.meta.dir, '../../../fixtures/keys.json')).json()) as KeysFile;
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
  onView: (v) => hub?.publish('stream', v),
  onState: (s) => hub?.publish('state', { state: s }),
});
hub = new Hub(() => heads(ingest));
const server = serve(ingest, hub, {
  port: Number(env.PORT ?? (mode === 'relay' ? 7070 : 7080)),
  hostname: env.HOST ?? (mode === 'relay' ? '0.0.0.0' : '127.0.0.1'),
  consoleHtml: mode === 'relay' ? consoleHtml : undefined,
});
const fwd = mode === 'relay' ? new Forwarder(ingest, httpCellSend(env.CELL_URL ?? 'http://127.0.0.1:7080')) : undefined;
fwd?.start();

console.log(`READY ${JSON.stringify({ mode, port: server.port, state: ingest.state(), db: dbPath, pragmas: p })}`);

const stop = async () => { await fwd?.stop(); server.stop(true); ingest.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
