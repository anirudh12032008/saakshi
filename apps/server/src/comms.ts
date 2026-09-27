// Candidate notices (plan §3.10): a template draft for each centre-level incident, a human approval, then the outbox — mock SMS, e-mail
// and DigiLocker, one JSON line each in outbox.jsonl. The audience is a count of candidates at the affected centres; no contact
// details live here. Stage 6 adds Claude-drafted notices and Tamil; a human still approves every one.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import type { NoticeText } from '@saakshi/core/analytics';
import type { Incident, IncidentKind, Notice } from '@saakshi/core/ops';

export const NOTICE_KINDS = new Set<IncidentKind>(['CELL_DOWN', 'RELAY_WAN_DOWN', 'CENTRE_OUTAGE', 'KEY_RELEASE_DELAY']);

export function draftNotice(i: Incident, exam: string, shift: string, now: number): Notice {
  const c = i.blast.centres;
  const where = c.length === 1 ? `centre ${c[0]}` : `${c.length} centres`, whereHi = c.length === 1 ? `केंद्र ${c[0]}` : `${c.length} केंद्रों`;
  const whereTa = c.length === 1 ? `மையம் ${c[0]}-ஐ` : `${c.length} மையங்களை`;
  return {
    id: `N-${i.id}`, incident: i.id, kind: i.kind, centres: [...c], audience: i.blast.candidates, channels: ['sms', 'email', 'digilocker'], draftedAt: now,
    en: `Saakshi ${exam} ${shift}: a technical problem affected ${where}. Your answers and your exam time are preserved. You do not need to do anything; you will be told if anything changes.`,
    hi: `साक्षी ${exam} ${shift}: एक तकनीकी समस्या ने ${whereHi} को प्रभावित किया। आपके उत्तर और परीक्षा का समय सुरक्षित हैं। आपको कुछ करने की आवश्यकता नहीं है; कुछ बदला तो आपको बताया जाएगा।`,
    // Kept byte-for-byte identical to llm.ts's templateNotice (answersLost === 0 branch): Task 10's test asserts the two match.
    ta: `சாக்ஷி ${exam} ${shift}: ஒரு தொழில்நுட்பச் சிக்கல் ${whereTa} பாதித்தது. உங்கள் பதில்களும் தேர்வு நேரமும் பாதுகாக்கப்பட்டுள்ளன. நீங்கள் எதுவும் செய்ய வேண்டியதில்லை; ஏதேனும் மாறினால் உங்களுக்குத் தெரிவிக்கப்படும்.`,
  };
}

export class Outbox {
  #path: string;
  #drafts = new Map<string, Notice>();
  #draftedBy = new Map<string, 'template' | 'claude' | 'cache'>();
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
  /** Replaces a draft's en/hi/ta text (e.g. a Claude redraft); keeps id/audience/etc. Throws for a sent or unknown id. */
  redraft(id: string, text: NoticeText, by: 'template' | 'claude' | 'cache'): Notice {
    const n = this.#drafts.get(id);
    if (!n) throw new Error(`no draft ${id}`);
    const out: Notice = { ...n, en: text.en, hi: text.hi, ta: text.ta };
    this.#drafts.set(id, out);
    this.#draftedBy.set(id, by);
    return out;
  }
  approve(id: string, by: string, now: number): Notice {
    const n = this.#drafts.get(id);
    if (!n) throw new Error(`no draft ${id}`);
    if (!n.en || !n.hi || !n.ta) throw new Error('the notice needs EN, HI and TA text');
    const who = by.trim();
    if (!who || who.length > 64) throw new Error('say who approves (1–64 characters)');
    const out: Notice = { ...n, approvedBy: who, approvedAt: now };
    appendFileSync(this.#path, JSON.stringify(out) + '\n');                          // the mock send: SMS, e-mail, DigiLocker
    this.#drafts.delete(id);
    this.#draftedBy.delete(id);
    this.#sent.push(out);
    return out;
  }
}
