import { useState, type FormEvent } from 'react';
import type { ExamBoot, GateMethod, Lang } from '../../shared/ipc.ts';
import { enrolProblem, GATE, shortHex } from './enrol-state.ts';
import type { Strings } from './i18n.ts';

interface P { boot: ExamBoot; t: Strings; lang: Lang; setLang: (l: Lang) => void }

export function TestBanner({ t }: { t: Strings }) {
  return <div className="test-banner" role="note">{t.testBanner}</div>;
}

export function LangToggle({ lang, setLang, t }: { lang: Lang; setLang: (l: Lang) => void; t: Strings }) {
  return (
    <div className="lang" role="group" aria-label={t.lang}>
      <button aria-pressed={lang === 'en'} lang="en" onClick={() => setLang('en')}>English</button>
      <button aria-pressed={lang === 'hi'} lang="hi" onClick={() => setLang('hi')}>हिन्दी</button>
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
      </form>
      <p id="enrol-problem" role="alert" className="problem">{problem || boot.notice}</p>
    </main>
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
