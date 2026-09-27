import type { Receipt, SyncView } from '../../shared/ipc.ts';
import { GLYPH, slipCode, tickOf } from './exam-state.ts';
import type { Strings } from './i18n.ts';

/** The receipt slip: computed on this seat at submit (works offline); the invigilator prints it with window.print. */
export function Slip({ r, sync, t }: { r: Receipt; sync: SyncView; t: Strings }) {
  const tick = tickOf(r.seq, sync);
  return (
    <main className="slip" aria-labelledby="slip-h">
      <h1 id="slip-h">{t.receiptTitle}</h1>
      <dl className="slip-meta">
        <dt>{t.candidate}</dt><dd>{r.cand}</dd>
        <dt>{t.exam}</dt><dd>{r.exam} · {r.shift}</dd>
        <dt>{t.form}</dt><dd>{r.form}</dd>
      </dl>
      <p className="code-label">{t.receiptCode}</p>
      <p className="code">{slipCode(r.code)}</p>
      <table className="slip-counts">
        <tbody>
          <tr><th scope="row">{t.attempted}</th><td>{t.of(r.attempted, r.total)}</td></tr>
          <tr><th scope="row">{t.answered}</th><td>{t.of(r.answered, r.total)}</td></tr>
          <tr><th scope="row">{t.marked}</th><td>{r.marked}</td></tr>
        </tbody>
      </table>
      <p>{t.keepCode}</p>
      <p className="slip-sync">
        <span className={`tick ${tick}`} aria-hidden="true">{GLYPH[tick]} </span>{t.submission}: {t.tick[tick]}
      </p>
      <button className="primary no-print" onClick={() => window.print()}>{t.print}</button>
    </main>
  );
}
