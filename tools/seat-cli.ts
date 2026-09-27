// The seat's own code (Seat), in this process, against a relay: for the demo checklist and quick checks without the packaged app.
// Test mode: the journal key is a file (no keychain), no camera. It prints `SEAT {…}` every 2 s.
//   bun tools/seat-cli.ts --relay http://127.0.0.1:7070 --cand C0001 --seat CEN042-S01 [--dir data/seats/S01] [--pin 482913]
//        [--answers 5] [--move] [--quit-when-synced] [--suspend 20]
//   --move              after a refused check-in (the candidate is bound elsewhere), ask to continue here with the PIN; prints MOVE-KEY
//   --quit-when-synced  exit (like a force-quit) once every answer is acknowledged by the exam server (✓✓ blue, backlog 0)
//   --suspend S         after answering, pause as if the laptop slept for S seconds, then resume (a gap entry)
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hexToBytes } from '../packages/core/src/bytes.ts';
import { DEV_EXAM } from '../packages/core/src/dev.ts';
import { fileWrapper } from '../apps/seat/src/main/keystore.ts';
import { Seat } from '../apps/seat/src/main/seat.ts';
import { ROOT } from './procs.ts';

const arg = (f: string, d = '') => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const has = (f: string) => process.argv.includes(f);
const cand = arg('--cand', 'C0001'), seatId = arg('--seat', 'CEN042-S01'), pin = arg('--pin', '482913');
const dir = resolve(arg('--dir', join('data', 'seats', seatId)));
mkdirSync(dir, { recursive: true });
const authorityPub = hexToBytes((JSON.parse(readFileSync(join(ROOT, 'fixtures/trust-dev.json'), 'utf8')) as { authority: string }).authority);
const seat = new Seat({ dir: join(dir, 'journal'), relayUrl: arg('--relay', 'http://127.0.0.1:7070'), ctx: { ...DEV_EXAM, cand }, seatId, authorityPub,
  wrap: fileWrapper(dir), camera: false, testMode: true, retryMs: 500 });
const say = () => { const b = seat.boot(); console.log(`SEAT ${JSON.stringify({ cand, seatId, phase: b.phase, bind: b.bind, ...b.sync, credited: b.credited, status: b.status, notice: b.notice })}`); };
const wait = async (ok: () => boolean) => { while (!ok()) await Bun.sleep(200); };
const stop = () => { seat.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

await seat.open();
setInterval(say, 2_000);
await wait(() => seat.boot().phase !== 'connecting');
if (seat.boot().phase === 'enrol' && !seat.boot().moveable) await seat.enrol({ pin, operatorId: 'GATE-42-OP7', method: 'aadhaar-face' });
if (has('--move')) {
  await wait(() => !!seat.boot().moveable || seat.boot().phase === 'exam');
  if (seat.boot().moveable) { await seat.handover(pin); console.log(`MOVE-KEY ${seat.boot().moveKey}`); }
}
await wait(() => ['ready', 'exam', 'submitted'].includes(seat.boot().phase ?? ''));
if (seat.boot().phase === 'ready') seat.start();
const items = seat.paper()!.items.map((i) => i.id);
for (let i = 0; i < Number(arg('--answers', '0')); i++) {
  seat.act({ kind: 'answer', item: items[i % items.length], state: 'A', answer: 'A', dwellMs: 3_000 });
  await Bun.sleep(1_000);
}
const s = Number(arg('--suspend', '0'));
if (s > 0) { seat.pause('suspend'); console.log(`SUSPENDED ${s} s`); await Bun.sleep(s * 1_000); seat.resume(); console.log('RESUMED'); }
say();
if (has('--quit-when-synced')) {
  await wait(() => { const v = seat.boot().sync; return v.cell >= v.local && v.local > 0; });
  console.log('SYNCED (blue ✓✓, backlog 0): quitting as if force-quit');
  stop();
}
