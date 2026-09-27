import { expect, test } from 'bun:test';
import { Hub } from '../src/sse.ts';

test('frames are valid SSE: id, event, one JSON data line, blank line', () => {
  const hub = new Hub(() => ({ snap: 1 }));
  hub.publish('stream', { cand: 'C0001', head: 3 });
  const [frame] = hub.catchUp(`${hub.boot}-0`);
  expect(frame).toBe(`id: ${hub.boot}-1\nevent: stream\ndata: {"cand":"C0001","head":3}\n\n`);
  expect(hub.lastId).toBe(`${hub.boot}-1`);
});

test('Last-Event-ID inside the ring replays only the missed events', () => {
  const hub = new Hub(() => ({}));
  for (let i = 1; i <= 5; i++) hub.publish('stream', { i });
  const frames = hub.catchUp(`${hub.boot}-3`);
  expect(frames.map((f) => f.split('\n')[0])).toEqual([`id: ${hub.boot}-4`, `id: ${hub.boot}-5`]);
  expect(hub.catchUp(hub.lastId)).toEqual([]);
});

test('first connect, another boot, a future id, or an id older than the ring get a snapshot', () => {
  const hub = new Hub(() => ({ mode: 'relay' }), { ring: 3 });
  for (let i = 1; i <= 6; i++) hub.publish('stream', { i });
  const snap = `id: ${hub.boot}-6\nevent: snapshot\ndata: {"mode":"relay"}\n\n`;
  for (const id of [null, 'zzz-2', `${hub.boot}-99`, `${hub.boot}-1`, 'garbage']) expect(hub.catchUp(id)).toEqual([snap]);
  expect(hub.catchUp(`${hub.boot}-3`).length).toBe(3);   // oldest kept is 4; 3 is exactly one before it
});
