import { closeSync, existsSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hexToBytes, randomBytes, toHex, utf8 } from '@saakshi/core/bytes';
import { canon, parseCanon } from '@saakshi/core/canon';
import { parseSignedLine, verifyChainKeyed } from '@saakshi/core/journal';
import { bodyArray, bodyFromArray, entryHash, genesisPrev, type Body, type Ctx, type Header } from '@saakshi/core/protocol';
import type { Verify } from '@saakshi/core/sig';

/** Electron's safeStorage has exactly this shape. */
export interface Wrapper { encryptString(s: string): Buffer; decryptString(b: Buffer): string }
/** What the seat keeps per entry: the signed line and envelope (to resend) and its own plaintext body (to resume). */
export interface Rec { line: string; env: Uint8Array; salt: Uint8Array; body: Body }

const SAFE = /^[A-Za-z0-9-]{1,64}$/;
const aad = (c: Ctx, seq: number): Uint8Array => utf8(canon(['aad', c.exam, c.shift, c.attempt, c.cand, seq]));

function syncDir(dir: string): void {
  if (process.platform === 'win32') return;          // Windows cannot open a directory for fsync
  const fd = openSync(dir, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

export function writeDurable(path: string, data: Uint8Array): void {
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, 'w');
  try { writeSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, path);
  syncDir(dirname(path));
}

/**
 * Append-only seat journal. Each line: base64(nonce24 ‖ XChaCha20-Poly1305(sessionKey, nonce, AAD=["aad",…,seq])(canon(["rec",…]))).
 * Every append is fsynced. (Honest limit: on macOS, Node's fsync is not F_FULLFSYNC.)
 */
export class SeatJournal {
  readonly recs: Rec[] = [];
  readonly headers: Header[] = [];
  #hs: string[] = [];
  #ctx: Ctx;
  #key: Uint8Array;
  #fd: number;
  #size: number;
  #base: { seq: number; head: string };

  /** Use SeatJournal.open. */
  constructor(ctx: Ctx, key: Uint8Array, fd: number, size: number, base: { seq: number; head: string }) {
    this.#ctx = ctx; this.#key = key; this.#fd = fd; this.#size = size; this.#base = base;
  }

  /** base: where a moved candidate's chain continues (Addendum C.6); the default is the genesis. */
  static open(dir: string, ctx: Ctx, wrap: Wrapper, verify: Verify, base = { seq: 0, head: genesisPrev(ctx) }): SeatJournal {
    for (const f of [ctx.exam, ctx.shift, ctx.cand]) if (!SAFE.test(f)) throw new Error(`journal: unsafe name ${f}`);
    mkdirSync(dir, { recursive: true });
    const stem = join(dir, `${ctx.exam}_${ctx.shift}_${ctx.attempt}_${ctx.cand}`);
    const jPath = `${stem}.journal`, kPath = `${stem}.key`;
    const existed = existsSync(jPath);
    const buf = existed ? readFileSync(jPath) : Buffer.alloc(0);
    let key: Uint8Array;
    if (existsSync(kPath)) key = hexToBytes(wrap.decryptString(readFileSync(kPath)));
    else if (buf.length > 0) throw new Error('journal: the session key is missing; refusing to start over an existing journal');
    else { key = randomBytes(32); writeDurable(kPath, wrap.encryptString(toHex(key))); }

    const end = buf.lastIndexOf(0x0a) + 1;            // a torn tail has no newline yet
    const fd = openSync(jPath, existed ? 'r+' : 'w+');
    if (!existed) syncDir(dir);
    if (end < buf.length) { ftruncateSync(fd, end); fsyncSync(fd); }
    const j = new SeatJournal(ctx, key, fd, end, base);
    const lines = buf.subarray(0, end).toString('latin1').split('\n');
    lines.pop();
    lines.forEach((l, i) => j.#push(j.#decrypt(l, base.seq + i + 1)));
    const chain = verifyChainKeyed(ctx, j.recs.map((r) => r.line), () => verify, base);
    if (!chain.ok) { closeSync(fd); throw new Error(`journal: chain broken at seq ${base.seq + chain.index + 1} (${chain.fault})`); }
    return j;
  }

  /** recs, headers and #hs are relative to the base; everything outside uses absolute seqs. */
  get base(): number { return this.#base.seq; }
  get head(): number { return this.#base.seq + this.recs.length; }
  hashAt(seq: number): string { return seq === this.#base.seq ? this.#base.head : this.#hs[seq - this.#base.seq - 1]; }
  recAt(seq: number): Rec | undefined { return this.recs[seq - this.#base.seq - 1]; }

  append(rec: Rec): void {
    const seq = this.head + 1;
    const p = parseSignedLine(rec.line);
    if (!p.ok || p.header.seq !== seq || p.header.prev !== this.hashAt(seq - 1)) throw new Error(`journal: expected seq ${seq} extending the chain`);
    const pt = utf8(canon(['rec', rec.line, Buffer.from(rec.env).toString('base64'), toHex(rec.salt), bodyArray(rec.body)]));
    const nonce = randomBytes(24);
    const ct = xchacha20poly1305(this.#key, nonce, aad(this.#ctx, seq)).encrypt(pt);
    const data = Buffer.from(Buffer.concat([nonce, ct]).toString('base64') + '\n', 'latin1');
    writeSync(this.#fd, data, 0, data.length, this.#size);
    fsyncSync(this.#fd);
    this.#size += data.length;
    this.#push(rec);
  }

  close(): void { closeSync(this.#fd); }

  #push(rec: Rec): void {
    const p = parseSignedLine(rec.line);
    if (!p.ok) throw new Error(`journal: ${p.detail}`);
    this.recs.push(rec);
    this.headers.push(p.header);
    this.#hs.push(toHex(entryHash(p.header)));
  }

  #decrypt(l: string, seq: number): Rec {
    let pt: Uint8Array;
    try {
      const raw = Buffer.from(l, 'base64');
      pt = xchacha20poly1305(this.#key, raw.subarray(0, 24), aad(this.#ctx, seq)).decrypt(raw.subarray(24));
    } catch { throw new Error(`journal: line ${seq} does not decrypt (corrupted, reordered, or from another candidate)`); }
    const a = parseCanon(new TextDecoder('utf-8', { fatal: true }).decode(pt));
    const [tag, line, env, salt, body] = a;
    if (a.length !== 5 || tag !== 'rec' || typeof line !== 'string' || typeof env !== 'string' || typeof salt !== 'string' || !Array.isArray(body))
      throw new Error(`journal: line ${seq} is not a record`);
    return { line, env: new Uint8Array(Buffer.from(env, 'base64')), salt: hexToBytes(salt), body: bodyFromArray(body) };
  }
}
