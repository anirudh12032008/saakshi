// Builds docs/deck/saakshi-submission.pptx: the submission deck, two slides per required topic, black and white.
// Numbers come only from docs/evidence/* and docs/claims-ledger.md (via README.md and build.cjs). Anything not built is marked "Next".
const pptxgen = require(process.env.PPTXGENJS || 'pptxgenjs');
const pres = new pptxgen();
pres.layout = 'LAYOUT_16x9'; // 10 x 5.625
pres.title = 'Saakshi: a resilient, provable CBT ecosystem';
const BLACK = '000000', WHITE = 'FFFFFF', GREY = '555555', LIGHT = 'F2F2F2', RULE = 'BFBFBF';
const F = 'Arial', MONO = 'Courier New';

let n = 0;
function mk(section, t) {
  const s = pres.addSlide(); s.background = { color: WHITE }; n++;
  s.addText(section.toUpperCase(), { x: 0.5, y: 0.22, w: 7.5, h: 0.25, fontFace: F, fontSize: 9, bold: true, color: GREY, charSpacing: 1, margin: 0, isTextBox: true });
  s.addText(t, { x: 0.5, y: 0.47, w: 9, h: 0.6, fontFace: F, fontSize: 24, bold: true, color: BLACK, margin: 0, isTextBox: true });
  s.addShape(pres.shapes.LINE, { x: 0.5, y: 1.12, w: 9, h: 0, line: { color: BLACK, width: 1 } });
  s.addText(String(n), { x: 8.8, y: 5.22, w: 0.7, h: 0.28, fontFace: F, fontSize: 9, color: GREY, align: 'right', margin: 0, isTextBox: true });
  return s;
}
function src(s, t) {
  s.addText(t, { x: 0.5, y: 5.22, w: 8.2, h: 0.28, fontFace: F, fontSize: 8, italic: true, color: GREY, margin: 0, isTextBox: true });
}
function bullets(s, items, x, y, w, h, size) {
  s.addText(items.map((t, i) => {
    const runs = Array.isArray(t) ? t : [t];
    return runs.map((r, j) => ({ text: typeof r === 'string' ? r : r.t, options: { bold: typeof r !== 'string', bullet: j === 0, breakLine: j === runs.length - 1 && i < items.length - 1 } }));
  }).flat(), { x, y, w, h, fontFace: F, fontSize: size || 14, color: BLACK, paraSpaceAfter: 7, valign: 'top', margin: 0, isTextBox: true });
}
function box(s, x, y, w, h, head, body, opts = {}) {
  s.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { color: opts.fill ? BLACK : (opts.light ? LIGHT : WHITE) }, line: { color: BLACK, width: 1, dashType: opts.dash ? 'dash' : 'solid' } });
  const c = opts.fill ? WHITE : BLACK;
  const hh = opts.hh || 0.36;
  s.addText(head, { x: x + 0.12, y: y + 0.08, w: w - 0.24, h: hh, fontFace: F, fontSize: opts.hs || 14, bold: true, color: c, align: opts.center ? 'center' : 'left', margin: 0, isTextBox: true });
  if (body) s.addText(body, { x: x + 0.12, y: y + hh + 0.1, w: w - 0.24, h: h - hh - 0.18, fontFace: F, fontSize: opts.bs || 11, color: opts.fill ? WHITE : GREY, align: opts.center ? 'center' : 'left', valign: 'top', margin: 0, isTextBox: true });
}
function stat(s, x, y, w, big, label) {
  s.addShape(pres.shapes.RECTANGLE, { x, y, w, h: 1.15, fill: { color: WHITE }, line: { color: BLACK, width: 1 } });
  s.addText(big, { x: x + 0.12, y: y + 0.1, w: w - 0.24, h: 0.55, fontFace: F, fontSize: big.length > 9 ? 18 : 24, bold: true, color: BLACK, margin: 0, isTextBox: true });
  s.addText(label, { x: x + 0.12, y: y + 0.65, w: w - 0.24, h: 0.45, fontFace: F, fontSize: 10, color: GREY, valign: 'top', margin: 0, isTextBox: true });
}
const td = (t, o = {}) => ({ text: t, options: { fontFace: F, fontSize: o.size || 10, bold: !!o.b, color: o.c || BLACK, fill: o.head ? { color: BLACK } : undefined, valign: 'middle' } });
const th = t => td(t, { b: true, c: WHITE, head: true });
function table(s, head, rows, x, y, w, colW, rowH, size) {
  s.addTable([head.map(th)].concat(rows.map(r => r.map((c, i) => td(c, { b: i === 0, size })))),
    { x, y, w, colW, rowH: rowH || 0.36, border: { type: 'solid', color: RULE, pt: 0.75 }, fill: { color: WHITE }, margin: 0.05 });
}
function arrow(s, x, y) { s.addText('→', { x, y, w: 0.3, h: 0.4, fontFace: F, fontSize: 18, bold: true, color: BLACK, align: 'center', valign: 'middle', margin: 0, isTextBox: true }); }

// ---------- Title ----------
let s = pres.addSlide(); s.background = { color: BLACK }; n++;
s.addText('साक्षी', { x: 0.6, y: 0.9, w: 8.8, h: 0.6, fontFace: 'Noto Sans Devanagari', fontSize: 24, color: WHITE, margin: 0, isTextBox: true });
s.addText('Saakshi', { x: 0.6, y: 1.5, w: 8.8, h: 1.0, fontFace: F, fontSize: 54, bold: true, color: WHITE, margin: 0, isTextBox: true });
s.addText('A resilient, provable computer-based testing ecosystem', { x: 0.6, y: 2.55, w: 8.8, h: 0.5, fontFace: F, fontSize: 20, color: WHITE, margin: 0, isTextBox: true });
s.addShape(pres.shapes.LINE, { x: 0.6, y: 3.3, w: 3.0, h: 0, line: { color: WHITE, width: 1.5 } });
s.addText('Hackathon Challenge 6  ·  Solution submission', { x: 0.6, y: 3.45, w: 8.8, h: 0.35, fontFace: F, fontSize: 13, color: 'BBBBBB', margin: 0, isTextBox: true });
s.addText('"We can\'t promise zero failures. We make every failure recoverable, contained, provable."', { x: 0.6, y: 4.5, w: 8.8, h: 0.5, fontFace: F, fontSize: 13, italic: true, color: WHITE, margin: 0, isTextBox: true });

// ---------- 1. Solution synopsis / executive summary ----------
s = mk('1 · Solution synopsis', 'Executive summary');
s.addText('Saakshi ("witness") is trust infrastructure for India\'s high-stakes computer-based exams (JEE, NEET from 2027, CUET). Every answer is signed and hash-chained at the seat, end-to-end encrypted to the data centre, and countersigned on arrival, so no one in between can read, alter or lose it without leaving proof.',
  { x: 0.5, y: 1.3, w: 9, h: 1.05, fontFace: F, fontSize: 14, color: BLACK, margin: 0, valign: 'top', isTextBox: true });
[['Monitor the machine', 'Integrity gate before T0; kernel-level monitoring (anti-cheat style) to catch VMs and relay software.'],
 ['Protect every answer', 'Signer + reader signatures on a git-like hash chain; end-to-end encryption the centre cannot open.'],
 ['Survive every failure', 'Relays buffer through crashes and outages; a cluster of 3 data-centre cells rebuilds itself.'],
 ['Decide fairly', 'Evidence locates tampering and harm, so only the affected candidates are re-tested.']].forEach(([h, b], i) => {
  box(s, 0.5 + i * 2.28, 2.6, 2.12, 1.85, h, b, { bs: 11, hh: 0.55, light: i % 2 === 1 });
});
src(s, 'Kernel-level monitoring is the next phase; today\'s gate detects by process/window name and a VM score. See slide 7.');

s = mk('1 · Solution synopsis', 'The solution at a glance');
stat(s, 0.5, 1.35, 2.1, '0 / 16,000', 'answers lost across 20 chaos runs');
stat(s, 2.8, 1.35, 2.1, '~1 s', 'median recovery time after killing or wiping a cell');
stat(s, 5.1, 1.35, 2.1, '1,000 / 1,000', 'one-byte tamper edits located to their entry');
stat(s, 7.4, 1.35, 2.1, '19,803', 'candidates unlocked in a 20k load run (of 19,803)');
bullets(s, [
  [{ t: 'Who: ' }, 'NTA (policy, keys, decisions), NIC (data centres), exam vendors (centres), independent witnesses.'],
  [{ t: 'What: ' }, 'Seat app, untrusted centre relay, 3-cell data-centre cluster, control, witness; open protocol v1.'],
  [{ t: 'Status: ' }, 'Working prototype, tested on macOS and Windows CI; all 12 challenge focus areas traced to code and tests.'],
  [{ t: 'Ask: ' }, 'A shadow-mode pilot on one small NTA exam, then a conformance kit written into the CBT vendor RFP.'],
], 0.5, 2.8, 9, 2.3, 13);
src(s, 'Evidence: docs/evidence/stage8-chaos.txt, stage0-tamper-lab.txt, stage7-load.txt; docs/traceability.md. One Mac, loopback, synthetic cohort.');

// ---------- 2. Solution presentation ----------
s = mk('2 · Solution presentation', 'Concept: five parts, each distrusting the next');
[['Seat', 'Exam PC app.\nSigns + chains every answer; works offline.'],
 ['Centre relay', 'Untrusted. Stores and forwards sealed envelopes; cannot read.'],
 ['Cells ×3', 'Data-centre cluster. Opens, verifies, countersigns.'],
 ['Control', 'Custody, incidents, Merkle register, audit, analytics.']].forEach(([h, b], i) => {
  const x = 0.5 + i * 2.35;
  box(s, x, 1.4, 1.95, 1.55, h, b, { center: true, hs: 15, bs: 10.5, fill: i === 0 });
  if (i < 3) arrow(s, x + 1.98, 1.95);
});
box(s, 7.55, 3.2, 1.95, 1.05, 'Witness', 'Independent co-signer of the register', { center: true, dash: true, bs: 10 });
bullets(s, [
  'Answers get WhatsApp-style ticks: ✓ saved on seat, ✓✓ relay has it, blue ✓✓ data centre countersigned.',
  'Question papers sit encrypted on disk; any 2 of 3 custodians (NTA, NIC, observer) release the key.',
  'A failure anywhere is contained to its own part and recovered from the parts around it.',
], 0.5, 3.2, 6.8, 1.9, 13);
src(s, 'Source: README.md architecture; docs/plan.md §2.');

s = mk('2 · Solution presentation', 'Approach: the path of one answer');
const steps = [
  ['1', 'Candidate clicks B on Q17', 'Seat signs the entry header, links it to the previous entry\'s hash, encrypts the body to the cell, fsyncs.  ✓'],
  ['2', 'Relay receives', 'Checks signature and chain, stores durably, acks. It never sees "B".  ✓✓'],
  ['3', 'Cell reads and countersigns', 'Decrypts, checks the body commitment, commits, returns a signed ack.  blue ✓✓'],
  ['4', 'Candidate submits', 'Seat shows a receipt code at once, even offline; the cell countersigns it later.'],
  ['5', 'Shift closes', 'Entries go into a Merkle register; control signs the tree head; the witness co-signs it.'],
  ['6', 'Anyone verifies', 'Candidate opens /verify offline: "Q17: record says C, the seat committed B" if anyone edited it.'],
];
steps.forEach(([k, h, b], i) => {
  const y = 1.3 + i * 0.63;
  s.addShape(pres.shapes.OVAL, { x: 0.5, y: y + 0.05, w: 0.42, h: 0.42, fill: { color: BLACK }, line: { color: BLACK } });
  s.addText(k, { x: 0.5, y: y + 0.05, w: 0.42, h: 0.42, fontFace: F, fontSize: 13, bold: true, color: WHITE, align: 'center', valign: 'middle', margin: 0, isTextBox: true });
  s.addText(h, { x: 1.1, y, w: 2.6, h: 0.52, fontFace: F, fontSize: 13, bold: true, color: BLACK, valign: 'middle', margin: 0, isTextBox: true });
  s.addText(b, { x: 3.75, y, w: 5.75, h: 0.52, fontFace: F, fontSize: 11, color: BLACK, valign: 'middle', margin: 0, isTextBox: true });
});
src(s, 'Source: docs/plan.md "Path of one answer"; docs/protocol-v1.md.');

// ---------- 3. Problem statement & proposed solution ----------
s = mk('3 · Problem statement', 'Key problems with current CBT (JEE)');
box(s, 0.5, 1.35, 4.35, 1.15, 'No layer-zero monitoring', 'Checks run in user space. A virtual machine or specialised relay software underneath the exam is invisible to it.', { bs: 11 });
box(s, 0.5, 2.62, 4.35, 1.15, 'Web embed is vulnerable to backdoors', 'An embedded web client inherits the browser\'s attack surface: injected scripts, debug ports, patched pages.', { bs: 11 });
box(s, 0.5, 3.89, 4.35, 1.15, 'Weak AES encryption', 'Symmetric keys shared along the chain protect secrecy only; nothing proves who wrote or who read a record.', { bs: 11 });
s.addText('What it costs today', { x: 5.2, y: 1.35, w: 4.3, h: 0.35, fontFace: F, fontSize: 14, bold: true, color: BLACK, margin: 0, isTextBox: true });
bullets(s, [
  'JEE Main 2025: a candidate\'s pop-up said 46 attempted, the response sheet said 29. It went to the Delhi High Court: their word against the vendor\'s PDF.',
  'CUET-UG 2026: a vendor-side glitch delayed a shift; 3,765 candidates needed a re-test.',
  'NEET-UG 2026: cancelled after a leak for ~22.7 lakh candidates; NEET moves to CBT from 2027.',
  'No candidate can check their own recorded answers.',
], 5.2, 1.8, 4.3, 3.3, 11.5);
src(s, 'Sources: docs/research.md [2], [6], [10]. Left column: team analysis of the current CBT stack.');

s = mk('3 · Proposed solution', 'Each problem, and how Saakshi answers it');
table(s, ['Problem', 'Saakshi\'s answer', 'Status'], [
  ['No layer-zero monitoring (VM, relay software)', 'Kernel-level monitoring, like a game anti-cheat, under a pre-exam gate that already blocks named tools and scores VMs', 'Gate built; kernel next'],
  ['Web embed open to backdoors', 'Native, fused seat app that refuses --inspect and remote-debugging; signed integrity policy; the network path is untrusted by design', 'Built'],
  ['Weak AES encryption', 'End-to-end encryption plus signer + reader signatures on a git-like hash chain (GPG-style signed commits)', 'Built'],
  ['System crashes, network drops', 'Relay-based store-and-forward: seat journal → centre relay → cell; resume on any seat; offline unlock code', 'Built'],
  ['Server failure', 'Cluster of 3 independent data-centre cells; a wiped cell rebuilds from the relays with nothing lost', 'Built'],
  ['Candidate cannot check the record', 'Receipt code at submit, offline /verify page, Merkle register co-signed by a witness', 'Built'],
], 0.5, 1.3, 9, [2.6, 5.0, 1.4], [0.36, 0.58, 0.58, 0.58, 0.58, 0.58, 0.58], 10);
src(s, 'Sources: docs/threat-model.md, docs/claims-ledger.md, .github/workflows/windows.yml (fuse check).');

// ---------- 4. Innovation & differentiation ----------
s = mk('4 · Innovation', 'What is new');
[['Signer + reader signatures', 'Every answer is signed by the seat that wrote it and countersigned by the cell that read it, chained like git commits. Forgery or silent edits break the chain at a named entry.'],
 ['Kernel-level exam monitoring', 'Anti-cheat techniques from online gaming applied to exams: see VMs, hooks and relay software below the app, not just process names.'],
 ['Candidate-verifiable receipts', 'A UPI-style receipt code at submit and an 84 KB offline /verify page. No production CBT gives candidates this.'],
 ['Decisions from evidence', 'A published rule re-tests only harmed candidates. Past history can corroborate a flag, never create one.']].forEach(([h, b], i) => {
  box(s, 0.5 + (i % 2) * 4.6, 1.35 + Math.floor(i / 2) * 1.9, 4.4, 1.75, h, b, { bs: 11.5, light: i === 1 });
});
src(s, 'Sources: docs/research.md (no production CBT uses verifiable-exam protocols); claims-ledger T1, T5, T9–T11, D4–D6.');

s = mk('4 · Differentiation', 'Current CBT vs Saakshi');
table(s, ['', 'Current CBT (JEE)', 'Saakshi'], [
  ['Machine monitoring', 'User-space checks; VM and relay software can hide', 'Pre-exam gate now; kernel-level monitor next'],
  ['Exam client', 'Web embed', 'Native fused app; debugging refused'],
  ['Encryption', 'AES; keys shared along the chain', 'End-to-end to the cell; relay cannot read'],
  ['Proof of each answer', 'None visible to the candidate', 'Seat signature + cell countersignature, hash-chained'],
  ['Network outage', 'Centre server syncs later', 'Relay buffers; offline unlock code; outage predicted'],
  ['Server failure', 'Single data-centre path', '3-cell cluster, rebuild from relays, 0 lost'],
  ['Disputed response sheet', 'Candidate\'s word vs vendor PDF', 'Receipt + offline /verify names the edited question'],
  ['Re-exam decision', 'Ad hoc, often everyone', 'Published rule; only the harmed are re-tested'],
], 0.5, 1.3, 9, [2.2, 3.3, 3.5], 0.42, 10.5);
src(s, 'Current-CBT column: docs/research.md (TCS iON AEC model, JEE Main 2025) and team analysis.');

// ---------- 5. Impact & benefits ----------
s = mk('5 · Impact & benefits', 'Who benefits, and how');
[['Candidates', 'No acknowledged answer is ever lost. Each can verify their own record. No one is re-tested for someone else\'s failure; time lost is credited.'],
 ['Governance (NTA, courts)', 'Court-ready evidence pack and audit trail, in time for the 5-month investigate-and-try window of the 2026 Amendment Bill.'],
 ['Economic', 'Contained re-tests instead of nationwide ones save exam fees, travel and months of delay for lakhs of families.'],
 ['Social & educational', 'Trust in exams restored. Look-alike groups (Hindi-medium, PwD, improvers) are protected; notices in English, Hindi and Tamil.']].forEach(([h, b], i) => {
  box(s, 0.5 + (i % 2) * 4.6, 1.35 + Math.floor(i / 2) * 1.9, 4.4, 1.75, h, b, { bs: 11.5, light: i === 0 || i === 3 });
});
src(s, 'Sources: docs/research.md; claims-ledger D4–D6, D17 (HI/TA notices are machine drafts pending native review).');

s = mk('5 · Impact & benefits', 'Measured impact on a 20,000-candidate exam');
s.addText('Re-tested 225  ·  Re-conducted 3 centres  ·  Spared 18,994  ·  ₹ avoided 2,84,91,000', { x: 0.5, y: 1.3, w: 9, h: 0.55, fontFace: F, fontSize: 15, bold: true, color: BLACK, margin: 0, isTextBox: true });
stat(s, 0.5, 2.0, 2.1, '19,811', 'live candidates in the run');
stat(s, 2.8, 2.0, 2.1, '322', 'flags, each with a stated reason');
stat(s, 5.1, 2.0, 2.1, '0.00%', 'honest candidates wrongly flagged');
stat(s, 7.4, 2.0, 2.1, '813 / 1,563', 'took the blanket 2024 NEET re-test offered');
bullets(s, [
  'Without evidence, every incident escalates to "re-test everyone"; in 2024 only about half of those offered a re-test took it.',
  'With Saakshi, a named human signs off a decision backed by per-candidate evidence.',
], 0.5, 3.45, 9, 1.6, 13);
src(s, 'Evidence: docs/evidence/stage6-act5-full.txt. Synthetic cohort; ₹1,500 per candidate is an illustrative policy value.');

// ---------- 6. Implementation / feasibility ----------
s = mk('6 · Implementation plan', 'Phased rollout');
[['Phase 0', 'Today', 'Working prototype: seat, relay, 3-cell cluster, control, witness. macOS + Windows CI.'],
 ['Phase 1', 'Shadow mode', 'Run beside the live system on one small NTA exam; compare records, measure real WAN.'],
 ['Phase 2', 'Harden', 'Kernel-level monitor, HSM-held keys, pinned TLS, WORM archive, independent witness.'],
 ['Phase 3', 'Scale', 'Relays at every centre, cell cluster at NIC data centres; NEET-size load test.'],
 ['Phase 4', 'Mandate', 'Conformance kit in the CBT vendor RFP: any vendor must pass the same tests.']].forEach(([p, h, b], i) => {
  const x = 0.5 + i * 1.84;
  box(s, x, 1.4, 1.7, 2.75, p, null, { fill: i === 0, center: true });
  s.addText(h, { x: x + 0.1, y: 1.85, w: 1.5, h: 0.35, fontFace: F, fontSize: 12, bold: true, color: i === 0 ? WHITE : BLACK, align: 'center', margin: 0, isTextBox: true });
  s.addText(b, { x: x + 0.1, y: 2.25, w: 1.5, h: 1.8, fontFace: F, fontSize: 10.5, color: i === 0 ? WHITE : GREY, align: 'center', valign: 'top', margin: 0, isTextBox: true });
});
s.addText('Roles: NTA owns policy, keys and decisions · NIC runs control and cells · vendors run centres · witnesses sit outside the operational path.', { x: 0.5, y: 4.35, w: 9, h: 0.6, fontFace: F, fontSize: 12, color: BLACK, margin: 0, isTextBox: true });
src(s, 'Source: docs/plan.md §6–§7; README.md "Limits and roadmap".');

s = mk('6 · Feasibility', 'Why it can be implemented');
bullets(s, [
  [{ t: 'Runs on today\'s centre PCs: ' }, 'seat uses 2.3% median CPU and 166 MiB.'],
  [{ t: 'Standard cryptography: ' }, 'SHA-256, ECDSA P-256, ECDH, XChaCha20-Poly1305, RFC 9162 Merkle proofs.'],
  [{ t: 'Open: ' }, 'Apache-2.0 (GoI open-source policy); frozen protocol with golden test vectors.'],
  [{ t: 'Fits policy direction: ' }, 'two-key paper release matches the Nilekani task force; NEET moves to CBT in 2027.'],
], 0.5, 1.35, 4.6, 3.7, 12.5);
table(s, ['Risk', 'Mitigation'], [
  ['Kernel driver signing and stability', 'Microsoft/Apple signing programmes; staged rollout in shadow mode first'],
  ['Control is a single point at T0 release', 'Replicate control; offline unlock code already works'],
  ['Real WAN differs from lab', 'Phase 1 measures throughput and recovery on real links'],
  ['Analytics tuned on synthetic data', 'Field pilot; humans decide every flag'],
], 5.4, 1.35, 4.1, [1.7, 2.4], 0.78, 10);
src(s, 'Evidence: docs/evidence/stage7-load.txt; docs/protocol-v1.md; docs/research.md [3]; docs/threat-model.md.');

// ---------- 7. Technology architecture ----------
s = mk('7 · Technology architecture', 'Architecture and technology choices');
const layers = [
  ['Seat', 'Electron + React exam app, fused build', 'Signed journal (fsync), offline mode, integrity probes, on-device face presence; kernel monitor (next)'],
  ['Centre relay', 'Bun server, MODE=relay, SQLite (WAL, full fsync)', 'Untrusted store-and-forward; invigilator console; spare relay takes over'],
  ['Cell cluster ×3', 'Bun server, MODE=cell, sharded by centre', 'Decrypt, verify chain, group commit, countersign; REBUILDING from relays'],
  ['Control', 'Bun server, MODE=control', 'Custody release, incidents, Merkle register (STH), audit, evidence pack'],
  ['Witness', 'Bun server, MODE=witness', 'Co-signs only register heads with a valid consistency proof'],
  ['Analytics', 'Python (numpy, scipy, networkx)', 'Cheating radar, decision engine; reads the cells\' own export'],
];
table(s, ['Layer', 'Technology', 'Responsibility'], layers, 0.5, 1.3, 9, [1.6, 3.0, 4.4], 0.5, 10);
src(s, 'Source: docs/plan.md §2; README.md. Web UIs (control, console, custodian, status, /verify) are one Vite/React build.');

s = mk('7 · Technical approach', 'E2E encryption with signer + reader hash');
const chain = [['Entry n-1', 'h(n-1)'], ['Entry n', 'prev = h(n-1)'], ['Entry n+1', 'prev = h(n)']];
chain.forEach(([h, b], i) => {
  const x = 0.5 + i * 1.55;
  box(s, x, 1.4, 1.3, 0.95, h, b, { center: true, hs: 12, bs: 10, fill: i === 1 });
  if (i < 2) arrow(s, x + 1.28, 1.65);
});
s.addText('Like git: each entry commits to the one before it.', { x: 0.5, y: 2.45, w: 4.6, h: 0.3, fontFace: F, fontSize: 10.5, italic: true, color: GREY, margin: 0, isTextBox: true });
bullets(s, [
  [{ t: 'Signer: ' }, 'seat signs each header with its own key (ECDSA P-256), like a GPG-signed commit.'],
  [{ t: 'Reader: ' }, 'cell countersigns the entry hash it opened and verified: proof of who read it.'],
  [{ t: 'End-to-end: ' }, 'body sealed to the cell (ECDH + HKDF + XChaCha20-Poly1305); the relay carries ciphertext.'],
  [{ t: 'Register: ' }, 'Merkle tree head signed by control, co-signed by the witness.'],
], 0.5, 2.9, 4.6, 2.2, 11.5);
s.addText('Scale and redundancy', { x: 5.4, y: 1.35, w: 4.1, h: 0.35, fontFace: F, fontSize: 14, bold: true, color: BLACK, margin: 0, isTextBox: true });
bullets(s, [
  'Cells sharded by centre: each is its own failure domain.',
  'Any cell can be killed or wiped and rebuilt from relays: sent = verified = stored.',
  'Relay dies → spare relay; seats resync from their journals.',
  'Relay → cell ingest: p50 44 ms, p99 168 ms; 227,882 entries stored, 0 rejected at 20k candidates.',
  'Keys live outside databases; a wiped cell\'s old acks stay valid.',
], 5.4, 1.8, 4.1, 3.3, 11.5);
src(s, 'Sources: docs/protocol-v1.md §3–§7, addendum B; docs/evidence/stage7-load.txt, stage8-chaos.txt.');

// ---------- 8. Prototype / demo ----------
s = mk('8 · Prototype / demo', 'Five live demo acts on real processes');
table(s, ['Act', 'What we do', 'Result'], [
  ['1 · Before', 'Seat runs AnyDesk and an overlay tool', 'Gate names both and blocks; green once closed'],
  ['2 · T0', 'Cut Centre 42\'s link, release paper keys', '2-of-3 custodians; phoned code unlocks only Centre 42; forged key rejected'],
  ['3 · During', 'Kill and wipe a data-centre cell; force-quit a seat', 'Candidates keep answering; rebuilt with 0 lost; seat resumes elsewhere'],
  ['4 · After', 'Insider edits an answer in the cell database', 'Audit locates it; /verify: "Q17: record says C, the seat committed B"'],
  ['5 · Decide', 'Analytics on the cells\' own export', 'Only harmed candidates re-tested; human sign-off verified'],
], 0.5, 1.3, 9, [1.3, 3.4, 4.3], 0.62, 10.5);
src(s, 'Evidence: docs/evidence/stage5-act1.txt, stage8-act2.txt, stage4-act3.txt, stage0-tamper-lab.txt, stage6-act5-full.txt.');

s = mk('8 · Proof of concept', 'Measured numbers');
table(s, ['Measure', 'Result', 'Evidence (docs/evidence/)'], [
  ['Ingest latency, relay to cell', 'p50 44 ms · p99 168 ms', 'stage7-load.txt'],
  ['Stored / rejected at 20k candidates', '227,882 entries · 0 rejected', 'stage7-load.txt'],
  ['Candidates unlocked', '19,803 / 19,803', 'stage7-load.txt'],
  ['Chaos drill, 20 runs', '0 of 16,000 answers lost · RTO medians 0.96–1.23 s', 'stage8-chaos.txt'],
  ['Offline-start act', '308 candidates, 7 centres, 6,586 entries', 'stage8-act2.txt'],
  ['Tamper lab', '1,000 / 1,000 byte flips located', 'stage0-tamper-lab.txt'],
  ['Windows CI', 'Packaged seat end-to-end; renamed AnyDesk.exe blocked', 'stage5-gate-selftest.json'],
], 0.5, 1.3, 9, [3.0, 3.9, 2.1], 0.46, 10.5);
src(s, 'One Apple M5 Mac, 3 real cells on loopback, 99 simulated centres, synthetic cohort. Not real WAN.');

// ---------- 9. Why select ----------
s = mk('9 · Why select this solution', 'Five reasons');
[['Built, not drawn', 'A working system with tests, CI on Windows and five scripted live demos. Break anything and watch it recover.'],
 ['Every claim is cited', 'Each number traces to an evidence file; limits are written down in a claims ledger and threat model.'],
 ['Solves the real failures', 'JEE\'s response-sheet dispute, CUET\'s vendor glitch, NEET\'s blanket re-test: each maps to a built feature.'],
 ['A protocol, not a product', 'Open, frozen spec with a conformance kit. NTA can hold any vendor to it.'],
 ['Covers all 12 focus areas', 'Monitoring to AI risk analytics: 7 built, 5 partly built, each traced to code and tests.']].forEach(([h, b], i) => {
  const y = 1.3 + i * 0.77;
  s.addText(String(i + 1), { x: 0.5, y, w: 0.5, h: 0.65, fontFace: F, fontSize: 26, bold: true, color: BLACK, margin: 0, valign: 'middle', isTextBox: true });
  s.addText(h, { x: 1.05, y, w: 2.9, h: 0.65, fontFace: F, fontSize: 14, bold: true, color: BLACK, margin: 0, valign: 'middle', isTextBox: true });
  s.addText(b, { x: 4.0, y, w: 5.5, h: 0.65, fontFace: F, fontSize: 11, color: GREY, margin: 0, valign: 'middle', isTextBox: true });
  if (i < 4) s.addShape(pres.shapes.LINE, { x: 0.5, y: y + 0.71, w: 9, h: 0, line: { color: RULE, width: 0.75 } });
});
src(s, 'Sources: docs/traceability.md, docs/claims-ledger.md, docs/threat-model.md.');

s = pres.addSlide(); s.background = { color: BLACK }; n++;
s.addText('9 · WHY SELECT THIS SOLUTION', { x: 0.6, y: 0.4, w: 8, h: 0.3, fontFace: F, fontSize: 9, bold: true, color: 'BBBBBB', charSpacing: 1, margin: 0, isTextBox: true });
s.addText('We can\'t promise zero failures.\nWe make every failure recoverable, contained, provable.', { x: 0.6, y: 1.1, w: 8.8, h: 1.5, fontFace: F, fontSize: 28, bold: true, color: WHITE, margin: 0, isTextBox: true });
[['Recoverable', 'No acknowledged answer is ever lost.'], ['Contained', 'Only the harmed are re-tested.'], ['Provable', 'Every candidate can verify their record.']].forEach(([h, b], i) => {
  const x = 0.6 + i * 3.0;
  s.addShape(pres.shapes.LINE, { x, y: 3.05, w: 2.6, h: 0, line: { color: WHITE, width: 1 } });
  s.addText(h, { x, y: 3.15, w: 2.7, h: 0.4, fontFace: F, fontSize: 16, bold: true, color: WHITE, margin: 0, isTextBox: true });
  s.addText(b, { x, y: 3.55, w: 2.7, h: 0.5, fontFace: F, fontSize: 11.5, color: 'BBBBBB', margin: 0, isTextBox: true });
});
s.addText('Our ask: a shadow-mode pilot on one NTA exam, and the Saakshi conformance kit in the next CBT vendor RFP.', { x: 0.6, y: 4.5, w: 8.8, h: 0.5, fontFace: F, fontSize: 13, color: WHITE, margin: 0, isTextBox: true });
s.addText(String(n), { x: 8.8, y: 5.22, w: 0.7, h: 0.28, fontFace: F, fontSize: 9, color: 'BBBBBB', align: 'right', margin: 0, isTextBox: true });

pres.writeFile({ fileName: __dirname + '/saakshi-submission.pptx' }).then(f => console.log('wrote', f, n, 'slides'));
