// Stage 3 test helpers: a DEV manifest with known keys and control-signed releases, and enrolment requests that share one PIN
// record (scrypt costs ~150 ms; a simulation shortcut — real seats salt their own).
import { hexToBytes, randomBytes, toHex } from '../packages/core/src/bytes.ts';
import { DEV_EXAM, type KeysFile } from '../packages/core/src/dev.ts';
import { attestHash, makeBindReq, msg, pinRecord, type BindReq } from '../packages/core/src/enrol.ts';
import { nativeBox, signer, type KeyPair } from '../packages/core/src/node.ts';
import { manifestArray, releaseArray, type Manifest, type ReleaseMsg, type SignedManifest } from '../packages/core/src/paper.ts';
import { kcf } from '../packages/core/src/protocol.ts';

type Exam = { exam: string; shift: string };
export const SIM_PIN = '123456';
let rec: string | undefined;
export const simPinRecord = (): string => (rec ??= pinRecord(SIM_PIN));

export function simBindReq(cand: string, seat: KeyPair, cellPub: Uint8Array, seatId = `SIM-${cand}`, x: Exam = DEV_EXAM): BindReq {
  const b = {
    exam: x.exam, shift: x.shift, attempt: 1, cand, seatId, pub: toHex(seat.pub), keyEpoch: 1, fromSeq: 0,
    attestHash: attestHash({ exam: x.exam, shift: x.shift, operatorId: 'SIM-GATE', time: 0, method: 'aadhaar-face', cand }),
  };
  return makeBindReq(b, cellPub, simPinRecord(), nativeBox);
}

export interface SimCustody { manifest: SignedManifest; K: Record<'F1' | 'F2', Uint8Array>; release(form: 'F1' | 'F2', ts?: number): ReleaseMsg }
export function simCustody(keys: KeysFile, x: Exam = DEV_EXAM): SimCustody {
  const K = { F1: randomBytes(32), F2: randomBytes(32) };
  const sign = signer({ priv: hexToBytes(keys.authority.priv), pub: hexToBytes(keys.authority.pub) });
  const m: Manifest = { exam: x.exam, shift: x.shift, ts: 1, forms: (['F1', 'F2'] as const).map((form) => ({ form, ciphertextHash: '0'.repeat(64), kcf: kcf(K[form]) })) };
  return {
    manifest: { manifest: m, sig: toHex(sign(msg(manifestArray(m)))) }, K,
    release(form, ts = 2) {
      const r = { exam: m.exam, shift: m.shift, form, kcf: kcf(K[form]), ts };
      return { ...r, key: toHex(K[form]), sig: toHex(sign(msg(releaseArray(r)))), via: 'push' };
    },
  };
}
