// Builds docs/deck/saakshi.pptx. Numbers come only from docs/evidence/* and docs/claims-ledger.md.
const pptxgen = require(process.env.PPTXGENJS || 'pptxgenjs');
const pres = new pptxgen();
pres.layout = 'LAYOUT_16x9'; // 10 x 5.625
const INK = '14213D', SAF = 'E07A1F', PAPER = 'FFFFFF', MIST = 'EEF1F6', GREY = '5B6475', GREEN = '1F8A5B';
const H = 'Cambria', B = 'Calibri';

const cell = (t, c, b) => ({ text: t, options: { color: c || INK, bold: !!b, fontFace: B, fontSize: 11 } });
function title(s, t, dark) {
  s.addText(t, { x: 0.5, y: 0.35, w: 9, h: 0.7, fontFace: H, fontSize: 30, bold: true, color: dark ? PAPER : INK, margin: 0, isTextBox: true });
}
function tag(s, t, dark) { // small act label, top-right
  s.addText(t, { x: 7.3, y: 0.12, w: 2.2, h: 0.3, fontFace: B, fontSize: 10, bold: true, color: SAF, align: 'right', margin: 0, isTextBox: true });
}
function stat(s, x, y, w, big, label, dark, col) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h: 1.35, fill: { color: dark ? '1F2F55' : MIST }, rectRadius: 0.08, line: { type: 'none' } });
  s.addText(big, { x: x + 0.15, y: y + 0.12, w: w - 0.3, h: 0.7, fontFace: H, fontSize: big.length > 8 ? 22 : 30, bold: true, color: col || SAF, margin: 0, isTextBox: true });
  s.addText(label, { x: x + 0.15, y: y + 0.82, w: w - 0.3, h: 0.45, fontFace: B, fontSize: 11, color: dark ? 'C9D2E3' : GREY, margin: 0, valign: 'top', isTextBox: true });
}
function bullets(s, items, x, y, w, h, size, dark) {
  s.addText(items.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < items.length - 1 } })),
    { x, y, w, h, fontFace: B, fontSize: size || 15, color: dark ? PAPER : INK, paraSpaceAfter: 8, valign: 'top', margin: 0, isTextBox: true });
}
function src(s, t, dark) {
  s.addText(t, { x: 0.5, y: 5.2, w: 9, h: 0.28, fontFace: B, fontSize: 9, italic: true, color: dark ? '9AA6BD' : GREY, margin: 0, isTextBox: true });
}
function mk(dark) { const s = pres.addSlide(); s.background = { color: dark ? INK : PAPER }; return s; }

// 1 Hook
let s = mk(true);
s.addText('साक्षी  Saakshi', { x: 0.5, y: 0.5, w: 9, h: 0.6, fontFace: H, fontSize: 20, color: SAF, margin: 0, isTextBox: true });
s.addText('NEET-UG 2026 was cancelled nine days after 22.79 lakh candidates sat it.', { x: 0.5, y: 1.2, w: 8.6, h: 1.4, fontFace: H, fontSize: 32, bold: true, color: PAPER, margin: 0, isTextBox: true });
stat(s, 0.5, 2.9, 2.8, '3 May → 12 May', 'held, then cancelled after a leak', true);
stat(s, 3.6, 2.9, 2.8, '~45 hours', 'head start the leaked "guess paper" had', true);
stat(s, 6.7, 2.9, 2.8, 'CBT from 2027', 'NEET moves to computer-based testing', true);
src(s, 'Sources: docs/research.md (Outlook, Gulf News, SCC Online, MedicalDialogues, Wikipedia).', true);
s.addNotes('[0:00–0:15] Open cold. NEET-UG 2026: held 3 May, cancelled 12 May for about 22.79 lakh candidates; the leaked guess paper had roughly a 45-hour head start. NEET goes CBT from 2027 — about 22 lakh candidates are about to go through exactly the pipeline we hardened.');

// 2 Problem
s = mk(false); title(s, 'Every failure becomes a nationwide re-test');
bullets(s, [
  'NEET-UG 2024: 1,563 candidates got grace marks; they were scrapped, a re-test offered, and only 813 took it.',
  'The Supreme Court called the 2024 leak localised (~155 beneficiaries) — but had no fine-grained evidence to separate them.',
  'Wrong paper sets sent to centres, papers moved by e-rickshaw, weak CCTV (recorded by the Court).',
  'NEET needs ~22 lakh seats vs 2–2.5 lakh CBT seats per session: multi-shift, so fairness evidence is core.',
], 0.5, 1.3, 5.6, 3.6, 14);
stat(s, 6.5, 1.3, 3.0, '813 / 1,563', 'took the 2024 re-test they were offered');
stat(s, 6.5, 2.95, 3.0, '5 months', 'to investigate + try under the 2026 Amendment Bill');
src(s, 'Sources: docs/research.md (SCC Online, PW, Upstox, Vajiram).');
s.addNotes('[0:15–0:30] The problem is not just leaks — it is that we cannot contain or prove anything, so every incident escalates to "re-test everyone". 2024: only 813 of 1,563 took the re-test. The new law gives 2+3 months to investigate and try — that needs court-grade logs.');

// 3 Promise
s = mk(true); title(s, 'Not "zero failures". Every failure is:', true);
[['Recoverable', 'No acknowledged answer is ever lost — seat, relay and data centre can each die.'],
 ['Contained', 'Blast radius is shown live; only the harmed candidates are re-tested.'],
 ['Provable', 'Tamper-evident records every candidate can verify offline.']].forEach(([h, b], i) => {
  const x = 0.5 + i * 3.1;
  s.addShape(pres.shapes.OVAL, { x, y: 1.6, w: 0.6, h: 0.6, fill: { color: SAF }, line: { type: 'none' } });
  s.addText(String(i + 1), { x, y: 1.6, w: 0.6, h: 0.6, fontFace: H, fontSize: 20, bold: true, color: PAPER, align: 'center', valign: 'middle', margin: 0, isTextBox: true });
  s.addText(h, { x, y: 2.4, w: 2.8, h: 0.5, fontFace: H, fontSize: 24, bold: true, color: PAPER, margin: 0, isTextBox: true });
  s.addText(b, { x, y: 3.0, w: 2.8, h: 1.4, fontFace: B, fontSize: 14, color: 'C9D2E3', margin: 0, valign: 'top', isTextBox: true });
});
s.addNotes('[0:30–0:40] Our promise is deliberately honest: we never claim cheat-proof or zero failures. We claim recoverable, contained, provable — and the next five slides are measured proof of each.');

// 4 Architecture
s = mk(false); title(s, 'Five parts, each distrusting the next');
const boxes = [['Seat', 'Signs every answer;\nkeeps working offline'], ['Centre relay', 'Untrusted: stores and\nforwards, cannot read'], ['Cells ×3', 'Verify, commit,\ncountersign'], ['Control', 'Custody, incidents,\nMerkle log, analytics']];
boxes.forEach(([h, b], i) => {
  const x = 0.5 + i * 2.3;
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 1.5, w: 1.95, h: 1.6, fill: { color: i === 1 ? 'FCEBDD' : MIST }, rectRadius: 0.08, line: { type: 'none' } });
  s.addText(h, { x: x + 0.1, y: 1.6, w: 1.75, h: 0.45, fontFace: H, fontSize: 17, bold: true, color: INK, align: 'center', margin: 0, isTextBox: true });
  s.addText(b, { x: x + 0.1, y: 2.1, w: 1.75, h: 0.9, fontFace: B, fontSize: 12, color: GREY, align: 'center', margin: 0, isTextBox: true });
  if (i < 3) s.addShape(pres.shapes.RIGHT_ARROW, { x: x + 1.98, y: 2.15, w: 0.3, h: 0.3, fill: { color: SAF }, line: { type: 'none' } });
});
s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 7.4, y: 3.55, w: 1.95, h: 1.1, fill: { color: PAPER }, rectRadius: 0.08, line: { color: GREY, dashType: 'dash', width: 1 } });
s.addText([{ text: 'Witness', options: { bold: true, breakLine: true } }, { text: 'co-signs the log (Built; same host as control)' }], { x: 7.5, y: 3.6, w: 1.75, h: 1.0, fontFace: B, fontSize: 12, color: GREY, align: 'center', valign: 'middle', margin: 0, isTextBox: true });
bullets(s, ['Answers are WhatsApp-style ticks: ✓ relay has it, ✓✓ data centre has it, blue = countersigned.', 'Paper keys are a two-key locker: any 2 of 3 custodians (NTA, NIC, observer).'], 0.5, 3.55, 6.6, 1.3, 14);
s.addNotes('[0:40–0:55] Seat to relay to three independent data-centre cells to control. The relay at the centre is treated as hostile: it cannot read answers or forge a tick. The witness is built and cosigns the log, but in the demo it runs on the same host as control, so it is not yet independent custody — we say so.');

// 5 Act 1
s = mk(false); tag(s, 'ACT 1 · BEFORE'); title(s, 'Risky seats caught before T0');
bullets(s, ['Seat A running AnyDesk and an overlay tool → gate names both and blocks.', 'Close them, press Re-check → green; all three seats start.', 'Scribe seat: NVDA allowed; 2 faces expected, 3 faces raise one flag that a human reviewer clears.', 'In-exam AnyDesk → an integrity entry, never an auto-submit; the seat keeps answering.'], 0.5, 1.3, 5.4, 3.7, 14);
stat(s, 6.3, 1.3, 3.2, '2 of 2', 'tools named and blocked (AnyDesk, overlay-sim)');
stat(s, 6.3, 2.85, 3.2, '5 of 5 → 1 flag', '3-face samples → one face-extra flag, human-cleared');
src(s, 'Evidence: docs/evidence/stage5-act1.txt, stage5-gate-selftest.json. Limit: detection is by name matching only.');
s.addNotes('[0:55–1:10] Act 1. The gate blocks by name, names the tool, and turns green once closed. Accessibility tools are allowed. Face presence runs on the device — no video, no recognition — and every flag goes to a human. Honest limit: name matching only.');

// 6 Act 2
s = mk(false); tag(s, 'ACT 2 · T0'); title(s, 'The exam starts on time — even offline');
bullets(s, ['We degrade Centre 42\'s link: SYNC_LAG warns before the cut.', 'Two of three custodians approve; one alone cannot release the paper.', 'The superintendent types a phoned code: it unlocks only Centre 42, this shift. A typo or another centre\'s code fails.', 'Before T0 the paper is ciphertext on disk; a forged key from the relay is rejected.'], 0.5, 1.3, 5.4, 3.7, 14);
stat(s, 6.3, 1.3, 3.2, '1.0–1.9 s', 'SYNC_LAG warning before the WAN cut (3 runs)');
stat(s, 6.3, 2.85, 3.2, '2 of 3', 'custodians needed to release paper keys');
src(s, 'Evidence: docs/evidence/stage8-act2.txt (PASS, 308 candidates, 7 centres); claims-ledger P1–P4, D16. SYNC_LAG is proven on our chaos drill only, not real WAN data.');
s.addNotes('[1:10–1:25] Act 2. Prediction first: SYNC_LAG raised 1.0 to 1.9 seconds before the cut across three runs — on our drill, not real WAN. Split custody: 2 of 3. The offline code is scoped to one centre and shift, and survives phone dictation.');

// 7 Act 3
s = mk(true); tag(s, 'ACT 3 · DURING', true); title(s, 'We pulled the plug on a data centre', true);
stat(s, 0.5, 1.4, 2.8, '0', 'answers lost — P1 closed with lost 0', true, '6FD3A0');
stat(s, 3.6, 1.4, 2.8, '6,593', 'entries: sent = verified = stored', true);
stat(s, 6.7, 1.4, 2.8, '1.3–1.9 s', 'recovery time (RTO), RPO 0, 3 chaos runs', true);
bullets(s, ['Cell 2 killed with SIGKILL and its database deleted; it rebuilt from the relays.', 'Candidates kept answering; the blast radius (1 cell · 2 centres · 100 candidates) was shown live.', 'A spare relay took over with nothing lost.'], 0.5, 3.1, 9, 1.9, 14, true);
src(s, 'Evidence: docs/evidence/stage4-act3.txt, stage4-chaos.jsonl (8 seats × 100 entries, one Mac). Not measured: RPO/RTO at 20k over real WAN; power loss.', true);
s.addNotes('[1:25–1:45] Act 3, the wow moment. A judge kills Data Centre 2 and deletes its database. The P1 card shows the blast radius; candidates keep answering; it rebuilds from the relays and closes with answers lost 0 — 6,593 entries sent, verified and stored. Chaos runs: RTO 1.3 to 1.9 s, RPO 0. Scale caveat stated.');

// 8 Act 4
s = mk(false); tag(s, 'ACT 4 · AFTER'); title(s, 'An insider edits an answer. We catch it.');
s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 1.35, w: 5.2, h: 1.1, fill: { color: 'FCEBDD' }, rectRadius: 0.08, line: { type: 'none' } });
s.addText('Q17: record says C — the seat committed B', { x: 0.7, y: 1.4, w: 4.8, h: 1.0, fontFace: 'Courier New', fontSize: 16, bold: true, color: INK, valign: 'middle', margin: 0, isTextBox: true });
bullets(s, ['Receipt code computed on the seat at submit, like a UPI reference.', '/verify is one offline 84 KB file: no network, no keys.', 'One-click evidence pack with a BSA s.63 certificate template.'], 0.5, 2.75, 5.2, 2.2, 14);
stat(s, 6.1, 1.35, 3.4, '1,000 / 1,000', 'one-byte flips located at their entry');
stat(s, 6.1, 2.9, 3.4, '30 / 30', 'golden-vector self-checks on every /verify load');
src(s, 'Evidence: claims-ledger T1, T5, T9–T11, T14. Admissibility is not claimed; s.63 file is a template.');
s.addNotes('[1:45–2:00] Act 4. A rogue DBA runs an UPDATE. The audit locates it and /verify shows the candidate what the seat actually committed. Every one of 1,000 single-byte flips is located. Evidence pack is one click; we do not claim court admissibility.');

// 9 Act 5
s = mk(true); tag(s, 'ACT 5 · DECIDE', true); title(s, 'Only the harmed are re-tested', true);
s.addText('Re-tested 225 · Re-conducted 3 centres · Spared 18,994 · ₹ avoided 2,84,91,000', { x: 0.5, y: 1.25, w: 9, h: 0.8, fontFace: H, fontSize: 20, bold: true, color: SAF, margin: 0, isTextBox: true });
stat(s, 0.5, 2.25, 2.1, '19,811', 'live candidates, 20k run', true);
stat(s, 2.8, 2.25, 2.1, '1,981,100', 'export rows analysed', true);
stat(s, 5.1, 2.25, 2.1, '322', 'flags, each explained', true);
stat(s, 7.4, 2.25, 2.1, '0.00%', 'honest false-positive rate (G2)', true);
bullets(s, ['Radar runs on what actually flowed through the cells; the decision applies the NEET-2024 Supreme Court tier-1 test.', 'A named human signs the report hash. The signature records approval — it does not make the report correct.'], 0.5, 3.85, 9, 1.2, 13, true);
src(s, 'Evidence: docs/evidence/stage6-act5-full.txt; ledger D1–D2, D7, D9, D18. Synthetic cohorts; ₹1,500/candidate is an illustrative policy value.', true);
s.addNotes('[2:00–2:20] Act 5. On the full 20k run — 19,811 live candidates, 1,981,100 rows — the engine re-tests 225, re-conducts 3 centres and spares 18,994. Rupee figure uses an illustrative 1,500 per candidate. Honest FPR 0% out of sample, on synthetic data. The headline equals the pinned golden.');

// 10 Fairness
s = mk(false); title(s, 'History corroborates. It never accuses.');
[['Flags come from the exam', 'Every flag shows its reason, observed vs expected, and a p-value.'],
 ['History only annotates', 'Past performance annotates flags already queued — never creates or escalates one (322 annotated, 55 corroborated).'],
 ['Look-alikes protected', 'Hindi-medium, PwD, rapid guessers and improvers are not flagged.'],
 ['Nothing auto-penalised', 'A human decides; time is credited by the relay clock, capped at 30 min.']].forEach(([h, b], i) => {
  const x = 0.5 + (i % 2) * 4.6, y = 1.35 + Math.floor(i / 2) * 1.8;
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: 4.3, h: 1.55, fill: { color: MIST }, rectRadius: 0.08, line: { type: 'none' } });
  s.addText(h, { x: x + 0.2, y: y + 0.12, w: 3.9, h: 0.4, fontFace: H, fontSize: 16, bold: true, color: INK, margin: 0, isTextBox: true });
  s.addText(b, { x: x + 0.2, y: y + 0.55, w: 3.9, h: 0.9, fontFace: B, fontSize: 13, color: GREY, margin: 0, valign: 'top', isTextBox: true });
});
src(s, 'Evidence: claims-ledger D4–D6, R11; docs/evidence/stage6-act5-full.txt. Proven on synthetic data.');
s.addNotes('[2:20–2:30] Fairness. First-time candidates have no history, so history can only corroborate an exam-based flag — tested against an adversarial registry. Look-alike groups are not flagged, and nothing is ever auto-penalised.');

// 11 Honest limits
s = mk(false); title(s, 'What we do not claim');
bullets(s, ['Not cheat-proof: deterrence plus detection; records are tamper-evident.', 'Detection is name matching; the live camera check is manual.', 'Radar and risk model: synthetic cohorts only — no field accuracy.', 'Not measured yet: real WAN, power loss, low-end seat CPU (20k was one Mac, loopback).', 'Archive WORM is simulated; the sign-off key is a DEV key (HSM on roadmap).', 'Witness is Built but on the same host as control, so not independent custody yet; pinned TLS is planned.'], 0.5, 1.3, 9, 3.8, 15);
src(s, 'Sources: docs/threat-model.md, docs/claims-ledger.md ("Claims we deliberately don\'t make").');
s.addNotes('[2:30–2:40] We lead with our limits because a trust system that oversells is worthless. Everything on this slide is written in our threat model and claims ledger.');

// Measured numbers
s = mk(false); title(s, 'Measured numbers');
const mrows = [['Ingest latency, relay to cell', 'p50 44 ms · p99 168 ms', 'stage7-load.txt'], ['Stored / rejected (20k cohort)', '227,882 entries · 0 rejected', 'stage7-load.txt'], ['Candidates unlocked', '19,803 / 19,803', 'stage7-load.txt'], ['Relay traffic per candidate-hour', '≈1.06 MB (60 s window extrapolated)', 'stage7-load.txt'], ['Seat CPU / RSS (Node main process)', '2.3% median · 166 MiB', 'stage7-load.txt'], ['Chaos drill, 20 runs', '0 of 16,000 answers lost · RTO medians 0.96–1.23 s', 'stage8-chaos.txt']];
const mt = [[cell('Measure', GREY, 1), cell('Result', GREY, 1), cell('File (docs/evidence/)', GREY, 1)]].concat(mrows.map(r => [cell(r[0]), cell(r[1], SAF, 1), cell(r[2])]));
s.addTable(mt, { x: 0.5, y: 1.2, w: 9, colW: [3.4, 3.7, 1.9], rowH: 0.45, border: { type: 'solid', color: 'D5DAE3', pt: 0.75 }, fill: { color: PAPER } });
src(s, 'One Apple M5 Mac, 3 real cells on loopback, 99 simulated centres, synthetic cohort. Seat figures cover the Node main process only; not real WAN.');
s.addNotes('Measured numbers, all from docs/evidence. One Mac, loopback, synthetic G1 cohort at 20,000 candidates. Bytes per candidate-hour extrapolates a 60-second window and is not a real exam duty cycle. Seat CPU and memory cover the Node main process only. Chaos: 20 of 20 runs passed, 16,000 sent and stored, RTO medians 1.22 to 1.23 s for kill and wipe and 0.955 s for spare relay.');

// 12 Protocol not product
s = mk(true); title(s, 'A protocol, not a product', true);
bullets(s, ['Vendor conformance kit in NTA\'s RFP: any vendor\'s seat, relay or cell must pass the same chaos and tamper tests.', 'RACI: NTA owns policy, keys and decisions; NIC runs control and cells; vendors run centres; witnesses sit outside the operational path.', 'Apache-2.0 under the GoI open-source policy.', 'Rollout: shadow mode on a small NTA exam → relays and cells → mandate.'], 0.5, 1.3, 9, 3.6, 15, true);
src(s, 'Source: docs/plan.md §6 Close and §7 item 12. Cost per candidate is not yet measured (Stage 7), so it is not shown.', true);
s.addNotes('[2:40–2:50] Close. We are not asking NTA to buy our software; we are offering a protocol and a conformance kit to write into the RFP. Cost per candidate is a Stage 7 measurement — we will not quote a number we have not measured.');

// 13 Traceability
s = mk(false); title(s, 'All 12 focus areas, traced to code and tests');
const rows = [['1 Real-time monitoring', 'Partly'], ['2 Early failure prediction', 'Partly'], ['3 Incident detection & escalation', 'Built'], ['4 Backup and DR', 'Partly'], ['5 Tamper-evident storage', 'Built*'], ['6 Suspicious patterns', 'Partly'], ['7 Reconciliation', 'Built'], ['8 Candidate communication', 'Built'], ['9 Re-conduct decision', 'Built'], ['10 Fairness when disrupted', 'Partly'], ['11 Audit trail & evidence', 'Built*'], ['12 AI systemic-risk analytics', 'Built']];
const tbl = [];
for (let i = 0; i < 6; i++) { const a = rows[i], c = rows[i + 6]; tbl.push([cell(a[0]), cell(a[1], a[1].startsWith('B') ? GREEN : SAF, 1), cell(c[0]), cell(c[1], c[1].startsWith('B') ? GREEN : SAF, 1)]); }
s.addTable(tbl, { x: 0.5, y: 1.3, w: 9, colW: [3.3, 1.2, 3.3, 1.2], rowH: 0.48, border: { type: 'solid', color: 'D5DAE3', pt: 0.75 }, fill: { color: PAPER } });
src(s, 'Source: docs/traceability.md summary table. * witness Built, but on the same host as control (not independent custody). "Partly" rows name their remaining stage there.');
s.addNotes('[2:50–3:00] Every one of the 12 focus areas maps to features, code and tests in traceability.md — seven built, five partly built with the remaining stage named. Thank you — happy to break anything live.');

pres.writeFile({ fileName: __dirname + '/saakshi.pptx' }).then(f => console.log('wrote', f));
