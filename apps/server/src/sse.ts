/** The slice of Bun's Server we need (avoids depending on its generic signature). */
export interface Timeouts { timeout(req: Request, seconds: number): void }

interface Frame { n: number; text: string }

/** SSE fan-out with event ids `<boot>-<n>`, a replay ring for Last-Event-ID, a snapshot fallback and 15 s pings. */
export class Hub {
  readonly boot = Date.now().toString(36);
  #n = 0;
  #ring: Frame[] = [];
  #subs = new Set<(text: string) => void>();
  #snapshot: () => unknown;
  #ringSize: number;
  #pingMs: number;

  constructor(snapshot: () => unknown, opts: { ring?: number; pingMs?: number } = {}) {
    this.#snapshot = snapshot;
    this.#ringSize = opts.ring ?? 1000;
    this.#pingMs = opts.pingMs ?? 15_000;
  }

  get lastId(): string { return `${this.boot}-${this.#n}`; }

  publish(event: string, data: unknown): void {
    const n = ++this.#n;
    const text = `id: ${this.boot}-${n}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    this.#ring.push({ n, text });
    if (this.#ring.length > this.#ringSize) this.#ring.shift();
    for (const send of this.#subs) send(text);
  }

  /** What a (re)connecting client gets first: the missed events if its id is still in the ring, else one snapshot. */
  catchUp(lastEventId: string | null): string[] {
    const m = lastEventId?.match(/^([0-9a-z]+)-(\d+)$/);
    if (m && m[1] === this.boot) {
      const last = Number(m[2]), oldest = this.#ring[0]?.n ?? this.#n + 1;
      if (last <= this.#n && last >= oldest - 1) return this.#ring.filter((f) => f.n > last).map((f) => f.text);
    }
    return [`id: ${this.lastId}\nevent: snapshot\ndata: ${JSON.stringify(this.#snapshot())}\n\n`];
  }

  response(req: Request, server: Timeouts): Response {
    server.timeout(req, 0);                       // SSE must outlive Bun's idleTimeout
    const enc = new TextEncoder();
    let send: ((text: string) => void) | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    const stop = () => { if (send) this.#subs.delete(send); clearInterval(ping); };
    const body = new ReadableStream<Uint8Array>({
      start: (ctrl) => {
        send = (text) => { try { ctrl.enqueue(enc.encode(text)); } catch { stop(); } };
        send('retry: 2000\n\n');
        for (const f of this.catchUp(req.headers.get('last-event-id'))) send(f);
        this.#subs.add(send);
        ping = setInterval(() => send!(':ping\n\n'), this.#pingMs);
      },
      cancel: stop,
    });
    return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
  }
}
