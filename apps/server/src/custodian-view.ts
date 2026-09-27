// /custodian logic (browser-safe, pure): decrypt a custodian's share on their own device and seal it to control's in-memory
// release key (protocol Addendum B.4). The plaintext share never leaves shareRequest and is wiped before it returns.
import { hexToBytes, toHex } from '@saakshi/core/bytes';
import { sealBox } from '@saakshi/core/box';
import type { ReleaseStatus } from '@saakshi/core/directory';
import { openShareFile, shareInfo, type ShareFile } from '@saakshi/core/paper';

export interface ReleaseKey { exam: string; shift: string; keyId: string; pub: string }

export function parseShareFile(text: string): ShareFile {
  let f: ShareFile;
  try { f = JSON.parse(text) as ShareFile; } catch { throw new Error('This is not a share file (it is not JSON).'); }
  if (f?.v !== 1 || typeof f.custodian !== 'string' || typeof f.box !== 'string' || typeof f.exam !== 'string' || typeof f.shift !== 'string') throw new Error('This is not a Saakshi share file.');
  return f;
}

export function shareRequest(f: ShareFile, pass: string, k: ReleaseKey): { custodian: string; keyId: string; box: string } {
  if (f.exam !== k.exam || f.shift !== k.shift) throw new Error(`This share is for ${f.exam} ${f.shift}; control is releasing ${k.exam} ${k.shift}.`);
  const share = openShareFile(f, pass);
  try { return { custodian: f.custodian, keyId: k.keyId, box: toHex(sealBox(hexToBytes(k.pub), shareInfo(k.exam, k.shift, f.custodian, k.keyId), share)) }; }
  finally { share.fill(0); }
}

export function statusText(s: ReleaseStatus): string {
  if (s.released) return `Released at ${new Date(s.released.at).toISOString().slice(11, 19)} UTC by ${s.released.custodians.join(' + ')}. Thank you.`;
  const more = Math.max(0, s.needed - s.received.length);
  return `Control has ${s.received.length} of ${s.needed} shares${s.received.length ? ` (${s.received.join(', ')})` : ''}.${more ? ` ${more} more needed.` : ''}`;
}

export const fingerprint = (keyId: string): string => keyId.replace(/(.{4})(?=.)/g, '$1 ');
