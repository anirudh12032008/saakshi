import { useState, type FormEvent } from 'react';
import type { ExamBoot, GateMethod, GateView, Lang } from '../../shared/ipc.ts';
import { enrolProblem, GATE, shortHex } from './enrol-state.ts';
import type { Strings } from './i18n.ts';

interface P { boot: ExamBoot; t: Strings; lang: Lang; setLang: (l: Lang) => void }

/**
 * The integrity gate panel (plan §3.4): the verdict as a word (never colour alone), every finding naming its
 * level and the tools involved, and a re-check button once the candidate has closed the named tools.
 * `review` and `amber` never disable Start — only `block` does (Decision 2).
 */
export function GatePanel({ gate, t, onRecheck }: { gate: GateView; t: Strings; onRecheck: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const findings = gate.findings;
  async function recheck() { setBusy(true); try { await onRecheck(); } finally { setBusy(false); } }
  return (
    <section className={`gate-panel lvl-${gate.verdict}`} aria-labelledby="gate-h">
      <h2 id="gate-h">{t.gate.title}</h2>
      <p className="badge" role="status">{t.gate.verdict[gate.verdict]}</p>
      {findings.length > 0 && (
        <ul className="gate-findings">
          {findings.map((f, i) => (
            <li key={i} className={`lvl-${f.level}`}>
              <span className="lvl-word">{t.gate.level[f.level]}</span>{' '}
              <span>{f.detail}</span>
              {f.names.length > 0 && <span className="names"> · {f.names.join(' · ')}</span>}
            </li>
          ))}
        </ul>
      )}
      {gate.verdict === 'block' && <p>{t.gate.blockedNote}</p>}
      <button onClick={recheck} disabled={busy}>{t.gate.recheck}</button>
      <p className="checked-at">{t.gate.checkedAt(gate.checkedAt)}</p>
    </section>
  );
}

export function TestBanner({ t }: { t: Strings }) {
  return <div className="test-banner" role="note">{t.testBanner}</div>;
}

export function LangToggle({ lang, setLang, t }: { lang: Lang; setLang: (l: Lang) => void; t: Strings }) {
  return (
    <div className="lang" role="group" aria-label={t.lang}>
      <button aria-pressed={lang === 'en'} lang="en" onClick={() => setLang('en')}>English</button>
      <button aria-pressed={lang === 'hi'} lang="hi" onClick={() => setLang('hi')}>हिन्दी</button>
      <button aria-pressed={lang === 'ta'} lang="ta" onClick={() => setLang('ta')}>தமிழ்</button>
    </div>
  );
}

export function Connecting({ boot, t, lang, setLang }: P) {
  return (
    <main className="start">
      <h1>{t.title}</h1>
      <LangToggle lang={lang} setLang={setLang} t={t} />
      <p role="status">{t.connecting}</p>
      <p className="notice">{boot.notice}</p>
    </main>
  );
}

export function Enrol({ boot, t, lang, setLang }: P) {
  const [pin, setPin] = useState(''), [confirm, setConfirm] = useState(''), [op, setOp] = useState('');
  const [method, setMethod] = useState<GateMethod>('aadhaar-face');
  const [problem, setProblem] = useState(''), [busy, setBusy] = useState(false);
  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const p = enrolProblem(pin, confirm, op);
    if (p) { setProblem(t.problems[p]); return; }
    setBusy(true);
    const r = await window.saakshi.enrol({ pin, operatorId: op, method });
    setBusy(false);
    setPin(''); setConfirm('');
    setProblem(r.ok ? '' : r.error);
  }
  return (
    <main className="start" aria-labelledby="enrol-h">
      <h1 id="enrol-h">{t.enrolTitle}</h1>
      <p>{t.candidate}: {boot.cand} · {boot.seatId} · {boot.centre}</p>
      <LangToggle lang={lang} setLang={setLang} t={t} />
      <p>{t.enrolNote}</p>
      <form className="gate" onSubmit={submit} noValidate>
        <fieldset disabled={boot.moveable}>
          <label>{t.pin}
            <input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value)} aria-describedby="enrol-problem" required />
          </label>
          <label>{t.pinConfirm}
            <input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-describedby="enrol-problem" required />
          </label>
          <fieldset>
            <legend>{t.gateCheck}</legend>
            <label>{t.operator}<input value={op} onChange={(e) => setOp(e.target.value)} autoComplete="off" aria-describedby="enrol-problem" required /></label>
            <label>{t.method}
              <select value={method} onChange={(e) => setMethod(e.target.value as GateMethod)}>
                {GATE.map((m) => <option key={m} value={m}>{t.methods[m]}</option>)}
              </select>
            </label>
          </fieldset>
          <button className="primary" disabled={busy}>{t.enrol}</button>
        </fieldset>
      </form>
      <p id="enrol-problem" role="alert" className="problem">{problem || boot.notice}</p>
      {boot.moveable && <Move t={t} />}
    </main>
  );
}

function Move({ t }: { t: Strings }) {
  const [pin, setPin] = useState(''), [problem, setProblem] = useState(''), [busy, setBusy] = useState(false);
  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!/^[0-9]{6}$/.test(pin)) { setProblem(t.problems.pinDigits); return; }
    setBusy(true);
    const r = await window.saakshi.handover(pin);
    setBusy(false); setPin('');
    setProblem(r.ok ? '' : r.error);
  }
  return (
    <section className="move" aria-labelledby="move-h">
      <h2 id="move-h">{t.moveTitle}</h2>
      <p>{t.moveNote}</p>
      <form className="gate" onSubmit={submit} noValidate>
        <label>{t.pin}<input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value)} aria-describedby="move-problem" required /></label>
        <button className="primary" disabled={busy}>{t.moveButton}</button>
      </form>
      <p id="move-problem" role="alert" className="problem">{problem}</p>
    </section>
  );
}

export function Locked({ boot, t, lang, setLang }: P) {
  const bind = boot.bind ?? 'none';
  return (
    <main className="start" aria-labelledby="locked-h">
      <h1 id="locked-h">{t.lockedTitle}</h1>
      <p>{t.candidate}: {boot.cand} · {boot.seatId} · {t.form} {boot.form}</p>
      <LangToggle lang={lang} setLang={setLang} t={t} />
      <p className={`badge ${bind}`}>{t.bind[bind]}</p>
      <p>{t.lockedNote}</p>
      <p className="commit"><span className="sr-only">{t.commitment}: </span>{shortHex(boot.commitment)}</p>
      <p role="status" className="notice">{boot.notice}</p>
    </main>
  );
}

export function Moving({ boot, t, lang, setLang }: P) {
  return (
    <main className="start" aria-labelledby="moving-h">
      <h1 id="moving-h">{t.movingTitle}</h1>
      <p>{t.candidate}: {boot.cand} · {boot.seatId}</p>
      <LangToggle lang={lang} setLang={setLang} t={t} />
      <p>{t.movingNote}</p>
      <p className="commit"><span>{t.yourKey}: </span>{shortHex(boot.moveKey)}</p>
      <p role="status" className="notice">{boot.notice}</p>
    </main>
  );
}

export function Moved({ boot, t }: P) {
  return (
    <main className="start" aria-labelledby="moved-h">
      <h1 id="moved-h">{t.movedTitle}</h1>
      <p>{t.candidate}: {boot.cand} · {boot.seatId}</p>
      <p role="alert">{t.movedNote}</p>
    </main>
  );
}
