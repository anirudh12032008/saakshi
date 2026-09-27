// The public status page's data (plan §3.10). No PII by construction: only centre codes, counts, times and fixed sentences leave this
// function — never a roll number, seat id, pseudonym, name or staff id, whatever the incidents carry. EN and HI. Browser-safe.
import type { FleetView, TileTone } from '@saakshi/core/directory';
import type { Incident, IncidentKind, Notice, PublicStatus } from '@saakshi/core/ops';

const TONE: Record<TileTone, { en: string; hi: string }> = {
  green: { en: 'Running normally', hi: 'सामान्य रूप से चल रहा है' },
  partial: { en: 'Starting', hi: 'शुरू हो रहा है' },
  locked: { en: 'Not started yet', hi: 'अभी शुरू नहीं हुआ' },
  down: { en: 'Exam server being restored', hi: 'परीक्षा सर्वर बहाल किया जा रहा है' },
};
const lost = (n: number | null) => (n === 0 ? { en: ' No answers were lost.', hi: ' कोई उत्तर नहीं खोया।' } : { en: '', hi: '' });
/** Centre-level kinds only: candidate-level incidents never reach the public page. */
const PUBLIC: Partial<Record<IncidentKind, (i: Incident) => { en: string; hi: string }>> = {
  CELL_DOWN: (i) => ({
    en: `An exam server is being restored from the centres' copies. ${i.blast.centres.length} centres affected. Candidates' time and answers are preserved.${lost(i.blast.answersLost).en}`,
    hi: `एक परीक्षा सर्वर को केंद्रों की प्रतियों से बहाल किया जा रहा है। ${i.blast.centres.length} केंद्र प्रभावित। अभ्यर्थियों का समय और उत्तर सुरक्षित हैं।${lost(i.blast.answersLost).hi}`,
  }),
  RELAY_WAN_DOWN: (i) => ({
    en: `Centre ${i.blast.centres[0]} has lost its network link. The exam continues at the centre; answers are saved there and reach the exam server when the link returns.`,
    hi: `केंद्र ${i.blast.centres[0]} का नेटवर्क संपर्क टूट गया है। परीक्षा केंद्र पर जारी है; उत्तर वहीं सहेजे जा रहे हैं और संपर्क लौटने पर परीक्षा सर्वर तक पहुँचेंगे।`,
  }),
  CENTRE_OUTAGE: (i) => ({
    en: `Centre ${i.blast.centres[0]}: several computers stopped at once. Answers saved before the stop are kept, and the lost time is not counted against candidates.`,
    hi: `केंद्र ${i.blast.centres[0]}: कई कंप्यूटर एक साथ रुक गए। रुकने से पहले सहेजे गए उत्तर सुरक्षित हैं, और खोया समय अभ्यर्थियों के विरुद्ध नहीं गिना जाएगा।`,
  }),
  KEY_RELEASE_DELAY: (i) => ({
    en: `${i.blast.centres.length} centres have not started yet. Every candidate still gets the full exam time.`,
    hi: `${i.blast.centres.length} केंद्रों में परीक्षा अभी शुरू नहीं हुई है। हर अभ्यर्थी को पूरा परीक्षा समय मिलेगा।`,
  }),
};

export function publicStatus(i: { exam: string; shift: string; now: number; fleet: FleetView; incidents: Incident[]; notices: Notice[] }): PublicStatus {
  const green = i.fleet.centres.filter((c) => c.tone === 'green').length, total = i.fleet.centres.length;
  return {
    exam: i.exam, shift: i.shift, at: i.now,
    summary: { en: `${green} of ${total} centres running normally`, hi: `${total} में से ${green} केंद्र सामान्य रूप से चल रहे हैं` },
    centres: i.fleet.centres.map((c) => ({ centre: c.centre, tone: c.tone, ...TONE[c.tone] })),
    incidents: i.incidents.filter((x) => !x.resolvedAt && PUBLIC[x.kind]).map((x) => ({
      kind: x.kind, severity: x.severity, since: x.openedAt, centres: [...x.blast.centres], answersLost: x.blast.answersLost, ...PUBLIC[x.kind]!(x),
    })),
    notices: i.notices.filter((n) => n.approvedAt !== undefined).map((n) => ({ at: n.approvedAt!, en: n.en, hi: n.hi })),
  };
}
