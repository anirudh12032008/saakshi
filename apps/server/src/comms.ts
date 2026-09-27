// Candidate notices (plan §3.10): a template draft for each centre-level incident, a human approval, then the outbox — mock SMS, e-mail
// and DigiLocker, one JSON line each in outbox.jsonl. The audience is a count of candidates at the affected centres; no contact
// details live here. Stage 6 adds Claude-drafted notices and Tamil; a human still approves every one.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import type { Incident, IncidentKind, Notice } from '@saakshi/core/ops';

export const NOTICE_KINDS = new Set<IncidentKind>(['CELL_DOWN', 'RELAY_WAN_DOWN', 'CENTRE_OUTAGE', 'KEY_RELEASE_DELAY']);

export function draftNotice(i: Incident, exam: string, shift: string, now: number): Notice {
  const c = i.blast.centres;
  const where = c.length === 1 ? `centre ${c[0]}` : `${c.length} centres`, whereHi = c.length === 1 ? `केंद्र ${c[0]}` : `${c.length} केंद्रों`;
  return {
    id: `N-${i.id}`, incident: i.id, kind: i.kind, centres: [...c], audience: i.blast.candidates, channels: ['sms', 'email', 'digilocker'], draftedAt: now,
    en: `Saakshi ${exam} ${shift}: a technical problem affected ${where}. Your answers and your exam time are preserved. You do not need to do anything; you will be told if anything changes.`,
    hi: `साक्षी ${exam} ${shift}: एक तकनीकी समस्या ने ${whereHi} को प्रभावित किया। आपके उत्तर और परीक्षा का समय सुरक्षित हैं। आपको कुछ करने की आवश्यकता नहीं है; कुछ बदला तो आपको बताया जाएगा।`,
  };
}

export class Outbox {
  #path: string;
  #drafts = new Map<string, Notice>();
  #sent: Notice[];
  constructor(path: string) {
    this.#path = path;
    this.#sent = existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Notice) : [];
  }
  /** false if this notice was already drafted or sent. */
  draft(n: Notice): boolean {
    if (this.#drafts.has(n.id) || this.#sent.some((x) => x.id === n.id)) return false;
    this.#drafts.set(n.id, n);
    return true;
  }
  drafts(): Notice[] { return [...this.#drafts.values()]; }
  sent(): Notice[] { return [...this.#sent]; }
  approve(id: string, by: string, now: number): Notice {
    const n = this.#drafts.get(id);
    if (!n) throw new Error(`no draft ${id}`);
    const who = by.trim();
    if (!who || who.length > 64) throw new Error('say who approves (1–64 characters)');
    const out: Notice = { ...n, approvedBy: who, approvedAt: now };
    appendFileSync(this.#path, JSON.stringify(out) + '\n');                          // the mock send: SMS, e-mail, DigiLocker
    this.#drafts.delete(id);
    this.#sent.push(out);
    return out;
  }
}
