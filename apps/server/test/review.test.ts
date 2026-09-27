import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sealThumb, thumbHashOf, type SignedFace } from '@saakshi/core/integrity';
import { newKeyPair } from '@saakshi/core/node';
import { ReviewQueue } from '../src/review.ts';

const ctx = { exam: 'E', shift: 'S1', attempt: 1, cand: 'C0001' }, DAY = 24 * 3600_000;
function flag(review: { pub: Uint8Array }, id: number, at: number): SignedFace & { id: number } {
  const thumb = sealThumb(review.pub, ctx, at, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  return { id, sig: '0'.repeat(128), f: { ...ctx, seatId: 'CEN042-S01', at, code: 'face-none', faces: 0, expected: 1, thumb, thumbHash: thumbHashOf(thumb) } };
}

test('flags open with the review key; a human decides; decisions persist across a restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-')), review = newKeyPair();
  let t = 40 * DAY;
  const q = new ReviewQueue({ dir, reviewPriv: review.priv, retentionMs: 30 * DAY, now: () => t });
  q.add(flag(review, 1, 39 * DAY)); q.add(flag(review, 1, 39 * DAY));
  expect(q.items()).toHaveLength(1);
  expect(q.items()[0].thumb.startsWith('data:image/jpeg;base64,')).toBe(true);
  expect(q.decide('1', 'cleared', 'REVIEWER-1').decision).toBe('cleared');
  expect(() => q.decide('1', 'confirmed', 'X')).toThrow(/already decided/);
  expect(() => q.decide('9', 'cleared', 'X')).toThrow(/no such item/);
  const again = new ReviewQueue({ dir, reviewPriv: review.priv, retentionMs: 30 * DAY, now: () => t });
  expect(again.items()[0].by).toBe('REVIEWER-1');
  rmSync(dir, { recursive: true, force: true });
});

test('thumbnails are deleted after the retention period; the record stays', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-')), review = newKeyPair();
  let t = 1 * DAY;
  const q = new ReviewQueue({ dir, reviewPriv: review.priv, retentionMs: 30 * DAY, now: () => t });
  q.add(flag(review, 1, 1 * DAY));
  expect(existsSync(join(dir, 'thumbs', '1.jpg'))).toBe(true);
  t = 32 * DAY;
  expect(q.items()[0].thumb).toBe('');
  expect(existsSync(join(dir, 'thumbs', '1.jpg'))).toBe(false);
  rmSync(dir, { recursive: true, force: true });
});
