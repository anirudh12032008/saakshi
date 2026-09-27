# Saakshi threat model

This document is honest about the limits. It reflects the code at commit `cec0ebb`: Stages 0–3 and analytics A1–A4 are built; Stages 4–8 are not.

**Status tags** used throughout:

| Tag | Meaning |
|---|---|
| **Built** | The code exists and a test covers it |
| **Primitive** | The cryptography exists and is tested, but the flow around it does not |
| **Stage N** | Planned; not built |

> **Key sentence:** *A seat signature proves the record wasn't altered after the device produced it — not that the candidate chose it.*

Everything below follows from that. The seat signature and the cell's countersignature stop a **server-side** insider from rewriting or injecting answers without detection. They do nothing against someone who controls the **seat itself**. That threat is handled by detection: probes, provenance and statistics. It is never handled by a claim of prevention.

## Trust boundaries

| Component | Trusted for | Not trusted for |
|---|---|---|
| **Seat** (Electron, `apps/seat`) | Producing and signing entries; computing the receipt | Proving who pressed the key. The seat holder can extract a key held on the device (DEV keys are published outright) |
| **Centre relay** (`MODE=relay`) | Availability only | Anything else. It stores, forwards and acks (✓✓). It cannot read bodies, forge seat entries or forge the cell's blue ack |
| **Cell** (`MODE=cell`) | Opening bodies, verifying chains, countersigning | Its database. Every row is checked against the seat's signatures, the relay's heads, the sealed archive and the register |
| **Control / authority** (`MODE=control`) | Signing the STH (sealing the register); running the audit | Acting alone. It is the known single point of failure at T0 release (Stage 3). The independent witness that co-signs STHs is Stage 7 (S6) |

## Actors

### 1. Candidate

**Capability:**
- Sits at a seat with ordinary user rights.
- May run remote-access or overlay tools, a VM or a second display, or use a phone.
- May copy within a room, or arrive with leaked items.
- May power-cycle the seat to gain time.
- May dispute their own record.

**Prevents:**
- The seat journal is encrypted at rest (XChaCha20-Poly1305 under a session key wrapped by `safeStorage`), so the next candidate on the seat cannot read earlier answers. **Built:** `apps/seat/src/main/journal-store.ts`.
- The timer's `activeMs` never runs backwards across a restart. **Built:** `apps/seat/src/main/exam.ts`.

**Detects:**
- Radar signal 1 catches pre-knowledge (speed-accuracy); signal 2 catches same-room copying rings; signal 3 (CUSUM) catches item leaks by centre and shift. **Built on synthetic data:** `analytics/src/saakshi_analytics/radar.py`.
- The integrity gate and in-exam monitor. **Built**: blocks before start by name (Windows CI, `act1.ts`); in-exam probes journal findings and raise `INTEGRITY_CRITICAL` for critical codes (see the detection matrix). Detection is proven against a renamed copy of another binary and the seat's own overlay-sim, not a genuine remote-access tool on real hardware (Stage 7).
- Face presence: the face count runs on the device (**Built**, `FaceChip.tsx`); face flags and the review queue are **Built**, scripted end to end in `act1.ts` with synthetic samples; live with the camera is Stage 7.
- Suspend and clock tricks: `rxWall` stamps and gap entries are **Stage 4**.

**Recovers:**
- Resume on the same seat from the local journal. **Built:** `exam.ts`, with the test "resume: … never backwards".
- Resume on another seat is **Stage 4**.

**Dispute:**
- The receipt code is computed on the seat at submit, even offline.
- `/verify` lets the candidate check their own record, offline.
- **Built:** `packages/core/src/verify.ts`, `apps/server/src/verify-page.ts`.

**Residual risk:**
- A phone or smart glasses photographing the screen.
- A VM detector defeated by a determined attacker.
- The radar's recall is below 1 (G2 leak recall 0.93; ring recall 0.77).
- Every flag goes to a human, and nothing is auto-penalised, so a borderline cheat may stand.

### 2. Invigilator

**Capability:**
- Controls the room.
- Approves resumes and gaps, and prints the slip.
- Sees the seat grid.
- Could collude with a candidate, approve a false gap, or let a proxy sit.

**Prevents:**
- The console shows sync state only: tick heads and silence. The relay that hosts it cannot read answers. **Built:** `apps/server/src/console.ts`, `console-view.ts`, `ingest.ts`.
- A handover needs the old key's signature, **or** the candidate's PIN together with the invigilator's approval. An invigilator alone cannot move a candidate. **Stage 4.**

**Detects:**
- Every handover opens an incident. **Stage 4.**
- Two or more gaps go to human review. **Built** in the decision engine (`decide.py`); gap journaling is Stage 4.
- Credited gaps are capped at 30 minutes; beyond that, the candidate is re-tested. **Built** in `decide.py`; enforcement at relay and cell is Stage 4.

**Recovers:**
- The receipt slip is printable and needs no phone. **Built:** `apps/seat/src/renderer/src/Slip.tsx`.

**Residual risk:**
- Identity rests on the existing Aadhaar or biometric gate check, recorded as `attestHash` at enrolment. **Built:** `apps/seat/test/identity.test.ts`, `apps/server/test/bindings.test.ts`.
- Enrolment is first-come: a rogue relay could try to bind a candidate before they arrive. It cannot forge the cell's certificate, and the real candidate's own enrolment is then refused (`ALREADY_BOUND`, "call the invigilator"); matching `attestHash` against the gate's own log is later work.
- Collusion inside the room is visible only statistically.

### 3. Centre operator (vendor staff at the venue)

**Capability:**
- Images and administers the seat PCs.
- Controls power, LAN and WAN.
- Could install remote-access software on the seats (the Bihar CHO pattern in [research.md](research.md#research-landscape)), swap the seat app, or cut power.

**Prevents:**
- The release build flips Electron fuses: no RunAsNode, no NODE_OPTIONS, no inspect arguments, ASAR integrity, load only from ASAR. It also sets `contextIsolation`, `sandbox`, a CSP, and a privileged `app://` scheme. **Built:** `apps/seat/electron-builder.yml`, `apps/seat/src/main/index.ts`.
- The smoke test of the fused build, the single-instance lock and the devtools block. **Proven**: the fused build refuses `--inspect`/`--remote-debugging-port` (exit 3), `ELECTRON_RUN_AS_NODE` is ignored, a second instance exits 0 — on the Mac fused build and on Windows CI ([`evidence/stage5-fuse.txt`](evidence/stage5-fuse.txt)).

**Detects:**
- The blocklist, remote-session and capture-exclusion probes, wired into the gate. **Proven (name matching)**: the Windows CI gate self-test blocks a renamed `AnyDesk.exe` plus `overlay-sim`, naming both ([`evidence/stage5-gate-selftest.json`](evidence/stage5-gate-selftest.json)).
- Per-centre, per-shift offline codes whose use control logs. **Built:** `packages/core/src/custody.ts`; the release flow, the relay's phoned-code route and the custody log entry (`bun tools/act2.ts`, step 11: `grep -E '"action":"(release|keys-zeroised|offline-code-revealed|chaos-wan)"'`).

**Recovers:**
- Power loss or a crash: the seat resumes from its fsynced journal. **Built.**
- WAN loss: the seat keeps ✓ and the relay buffers ✓✓. **Built.**
- Loss of the relay host: seats resync to a fresh relay from their journals. **Built:** `sync.test.ts` "a fresh (spare) relay gets the whole journal again". Spare-relay operations are Stage 4.

**Residual risk:**
- An operator with admin rights on a seat PC can extract the seat key and sign entries. This is the key sentence again.
- The production answer is managed PCs (Assigned Access or MDM) and TPM- or Secure-Enclave-held keys. Both are on the roadmap.

### 4. Relay operator (the centre server)

The SSC CGL 2025 Dhanbad case was a **server manager** at a centre.

**Capability:**
- Full control of the relay process and its database.
- Can drop, delay, reorder or replay traffic.
- Can read everything the relay stores.

**Prevents:**
- The relay stores only headers and sealed envelopes. **Built:** `ingest.test.ts` "relay: stores only headers and sealed envelopes — no answer text reaches its disk".
- It cannot forge a seat entry. The cell rejects a bad signature as `BAD_SUBMISSION`. **Built.**
- It cannot fake a blue tick, because the seat verifies the cell's signature on the ack. **Built:** `sync.test.ts` "a forged or mismatched ack never turns a tick blue".

**Detects:**
- Two validly signed entries at one seq raise `FORK`. **Built:** `ingest.test.ts`.
- Relay head vs cell head for every candidate, in the reconciliation report. **Built:** `apps/server/src/recon.ts`.
- A relay that disagrees with the seat about its chain does not advance ✓✓. **Built:** `sync.test.ts`.

**Recovers:**
- The seat keeps its own journal and resends from the head each destination has acknowledged (the NEED/gap protocol). **Built:** `apps/seat/src/main/sync.ts`.

**Residual risk:**
- Denial of service: the relay can stall a whole centre. Seats keep answering at ✓; the spare relay is Stage 4.
- Metadata leaks: headers show the entry kind, `seq`, `tMonoMs` and `activeMs`, so the relay learns *when* a candidate answers, but not *what*.
- Until Stage 7 (S7), relay → cell traffic is plain HTTP.
- A rogue relay could try to bind a candidate before they arrive; it cannot forge the cell's certificate, and the real candidate's enrolment is then refused (see the invigilator actor's residual risk, above).
- While `DEV=1`, the relay's chaos routes (`/v1/dev/wan`, `/v1/dev/forge`, exercised by `tools/act2.ts`) are reachable on the centre LAN. Production builds must not ship with `DEV=1`.

### 5. Cell insider (national data-centre DBA)

**Capability:**
- Edits, deletes or truncates rows.
- Changes signatures or headers.
- Deletes the whole database.
- Holds the cell's private key, so can read answer bodies. The cell has to read them in order to score.

**Prevents:**
- Tampering by itself cannot be prevented; tamper **evidence** is the design.
- Cell keys live in the keys file, outside the database, so a wiped database does not invalidate earlier acks. **Built:** `apps/server/src/main.ts`.

**Detects:** each of the following cases is **located**. **Built:** `apps/server/src/audit.ts`; `tamper.test.ts` (7 cases); `audit.test.ts`.

| Tampering | How it is caught |
|---|---|
| An edited answer | Its `bodyCommit` no longer matches the seat's signature |
| A deleted row | Chain gap; relay count and archive count |
| A truncated chain | The register leaf for the submit |
| A changed signature | Located at its seq |
| An edited header | Located at its seq |

**Candidate-side check:**
- `/verify` shows *"Q17: record says C — the seat committed B"*.
- **Built:** `packages/core/src/verify.ts`; `tools/act4.ts`.

**Recovers:**
- Recovery order: the sealed archive, then `next.prev`, then option search using the salt. An answer-only edit is recovered even with no archive.
- A wiped cell enters REBUILDING and the relay replays from genesis. Result: sent = stored, lost = 0. **Built:** `forward.ts`, `ingest.ts`, `tools/chaos-kill.ts`.

**Residual risk:**
- The insider can **read** answers. That is by design: the cell has to score.
- Before the seal, an insider who also controls the relay and the single archive could rewrite consistently. There are only two archive stores in Stage 4, and a witness only in Stage 7.
- `/v1/shift` and the DEV rogue route are unauthenticated and bound to loopback (commit `6e0c31e`). mTLS is on the roadmap.
- `/verify` still pins the seat keys from `fixtures/trust-dev.json`. An **enrolled** candidate's key is not in that file, so `/verify` shows the keys row failing for them (chain, bodies, receipt, STH and inclusion still verify) until Addendum C (Stage 4) extends the proof with the candidate's bind certificate and the cell's key certificate, and `/verify` pins only the authority key.

### 6. Printing-press insider, and anyone upstream of T0

NEET-UG 2026 leaked from inside the paper's custody chain before the exam ([research.md](research.md#research-india)). In CBT, the equivalent people are setters, translators, packagers, and anyone who touches the key material.

**Prevents:**
- The paper keys are split Shamir 2-of-3 between NTA, NIC and an independent observer. Custodians hold their own shares.
- A public key commitment `kc_f` is published in advance.
- An offline code only unwraps its own centre and shift.
- **Built:** `packages/core/src/custody.ts`; `custody.test.ts` "any 2 of 3 … 1 share does not", "a corrupted share is caught by the published key commitment", "offline code unwraps only its own centre and shift"; the packager (`tools/package.ts`), `/custodian` (`apps/server/src/custodian-view.ts`) and the release flow (`release-control.test.ts`, `relay-routes.test.ts`, `bun tools/act2.ts`).

**Detects:**
- Beneficiaries of a leak are found statistically: signals 1 and 3 locate the items, centres and shifts affected. **Built on synthetic data.**

**Responds:**
- The decision engine picks one branch:
  - localised re-conduct;
  - re-score without at most 10% of the items;
  - full re-conduct, only when the leak is systemic **and** the beneficiaries cannot be separated (the NEET-UG 2024 Supreme Court test).
- **Built:** `decide.py`, with golden cases in `analytics/golden/`.

**Residual risk:**
- **Setters see the plaintext paper.** Custody cannot stop a setter leak; only detection and response can.
- Control sees `K_f` at T0 and zeroises it after every cell has the release — best effort in a garbage-collected runtime, not a guarantee. Control restarting before the release completes makes a new release key, and the custodians re-send.
- The `/custodian` page is served by control, so a compromised control could serve a page that captures a custodian's passphrase. Production: a signed, offline custodian app.
- The packager destroying its material is a procedural control.
- A leak to strong candidates shows up weakly in the statistics.

### 7. Remote-access rackets

The cases in [research.md](research.md#research-landscape):
- **SSC CGL 2025, Dhanbad:** answers were auto-selected while candidates "moved the mouse".
- **Bihar CHO:** a proxy server and remote-view software; 37 arrests.

**Capability:** a solver elsewhere drives the seat, through AnyDesk, TeamViewer, RDP or VNC, or through the centre server.

**Prevents:**
- Injection **through the centre server** fails: the relay cannot forge seat-signed entries. **Built.**
- Injection **on the seat** is not prevented. See the key sentence.

**Detects:**
- Blocklisted processes, among them AnyDesk, TeamViewer, RustDesk, Parsec, VNC, OBS and Cluely. **Built as a self-test.**
- Windows `SM_REMOTESESSION` and macOS `screensharingd`. **Built as a self-test.**
- The blocking gate, in-exam probes every 10 s, pointer-path provenance (S5) and the egress allowlist. **Built.** The gate self-test on Windows CI blocks a renamed `notepad.exe` (as `AnyDesk.exe`) plus `overlay-sim`, naming both ([`evidence/stage5-gate-selftest.json`](evidence/stage5-gate-selftest.json)); egress is **review only**, not blocking (a VM-score-2 runner and out-of-allowlist connections are flagged, not refused). Pointer provenance (D.5) travels inside the sealed body; **analysis is Stage 6**.
- The radar's speed-accuracy signal. **Built on synthetic data.**

**Residual risk:**
- Process-name matching is a heuristic, so a renamed binary evades it. The Windows CI test uses a renamed `AnyDesk.exe` to show matching by name — and the same renaming would evade it if the label were also changed.
- A hardware KVM or HDMI capture device is invisible to software.
- RemoteFX can hide RDP from `SM_REMOTESESSION`.
- The VM score is a heuristic (2+ signal classes among hypervisor flag, VM model, BIOS/ioreg strings, VM MAC prefix, guest-tools process); GitHub's own `windows-latest` runner scores 2 (model, bios), so CI can only assert names, not a clean verdict, on that runner.
- The relay appends readiness reports and face flags to `faces.jsonl` / its store without an fsync barrier on every write; the durable record of a finding is the seat's own `integrity` journal entry (with `thumbHash` for a face flag), which is chained and signed.

### 8. Overlay tools (capture-excluded AI overlays)

**Capability:** a window that hides itself from screen capture, such as Cluely, reads the question and suggests answers ([research.md](research.md#research-landscape)).

**Detects:**
- Windows: `EnumWindows` + `GetWindowDisplayAffinity` finds other processes' windows that are excluded from capture. **Built as a self-test**; the CI artifact on a clean runner shows `excluded: []`; on a runner with `overlay-sim` and a renamed `AnyDesk.exe` running, the gate self-test names both and blocks ([`evidence/stage5-gate-selftest.json`](evidence/stage5-gate-selftest.json)).
- macOS: `kCGWindowSharingState == 0`. **Built.** On macOS 27.0, a `setContentProtection` + `alwaysOnTop` window (`overlay-sim`) reports `kCGWindowSharingState=0` on window layer 3, not layer 0; the probe was fixed to count app layers 0–19, not only layer 0 ([`evidence/stage5-mac-capture.txt`](evidence/stage5-mac-capture.txt)). `overlay-sim` **was seen** excluded on this macOS version.
- "Cluely" is on the blocklist. **Built.**

**Residual risk:**
- An overlay on a second device is invisible.
- On macOS 15+ Apple may change or restrict what CoreGraphics reports for `kCGWindowSharingState`; this probe's continued accuracy depends on that API's future behaviour, which is outside our control. `setContentProtection` (the *prevention* half, not just detection) is Windows only.

### Also in scope: the exam authority (control)

- Control signs the STH and, at T0, briefly sees `K_f`.
- Until the witness (S6, Stage 7), an authority that re-issues a register is caught only by candidates' receipts and inclusion proofs, not by an independent co-signer.

## Non-adversarial failures

| Failure | What happens | Status |
|---|---|---|
| Seat app crash or power loss | The seat resumes from its fsynced journal; torn tails are cut back to the last whole line | **Built** (`journal-store.test.ts`, `exam.test.ts`) |
| Centre WAN down | The seat keeps ✓ and the relay keeps ✓✓; the backlog drains when the link returns | **Built** (`sync.test.ts`, `forward.test.ts`) |
| Cell crash, or its database deleted | REBUILDING; 503 for live traffic; the relay replays; lost = 0 | **Built** (kill test) |
| Relay dies | Seats resync to a fresh relay from their journals | Seat side **Built**; spare-relay operations **Stage 4** |
| Seat hardware dies | Resume on another seat; loss is at most the time since the last ✓✓ | **Stage 4** |
| Paper keys can't reach a centre at T0 | Per-centre offline code, read out and typed at the relay console | **Built** (`bun tools/act2.ts`) |

## Detection matrix (current)

The full matrix, filled in on both laptops (AnyDesk, TeamViewer, overlay-sim, second display, RDP / Screen Sharing, a VM, NVDA, a scribe seat), is **Stage 7** — Stage 5 proved detection and blocking by name in CI and in `act1.ts`, not on real physical laptops side by side. Today:

| Check | macOS | Windows | Where |
|---|---|---|---|
| Blocklisted process | `ps` probe, self-test (Apple's `/System` daemons excluded) | `tasklist` probe; CI gate self-test blocks a renamed `AnyDesk.exe` by name ([`evidence/stage5-gate-selftest.json`](evidence/stage5-gate-selftest.json)) | `probes.ts`, `probe-parse.ts` |
| Capture-excluded window | `kCGWindowSharingState`, self-test; `overlay-sim` observed excluded on macOS 27.0 ([`evidence/stage5-mac-capture.txt`](evidence/stage5-mac-capture.txt)) | `GetWindowDisplayAffinity` via koffi; CI gate self-test blocks `overlay-sim` by name | `probes-win.ts`, `probes-mac.ts` |
| Remote session | `screensharingd` present, self-test | `SM_REMOTESESSION`, self-test in CI | `probes.ts`, `probes-win.ts` |
| VM | `kern.hv_vmm_present` (one signal of the score) | Score ≥ 2 blocks, 1 is review; CI's own `windows-latest` runner scores 2 (model, bios) ([`evidence/stage5-gate-selftest.json`](evidence/stage5-gate-selftest.json)) | `probes.ts`, `integrity.ts` |
| Egress allowlist | Review only (never blocks); flags connections outside `Policy.integrity.egress` | Same, review only; CI's runner shows Azure infra IPs flagged | `gate.ts` |
| Pointer provenance | Recorded in the sealed `answer`/`mark`/`clear` body (D.5); **not checked, not yet analysed** (Stage 6) | Same | `act1.ts`, protocol Addendum D.5 |
| Face presence | Live count on the device in the packaged app (MediaPipe on CPU; [evidence](evidence/stage0-seat-faces-1.png)); flags and the review queue scripted in `act1.ts` with synthetic samples (no camera); live with the camera is Stage 7 by hand | Stage 7 (laptop) | `FaceChip.tsx`, `face.ts` |
| Assistive tech allowlist (NVDA, VoiceOver), scribe seat expects 2 faces | NVDA/VoiceOver allowed as an `info` finding, scribe accommodation (2 faces) scripted in `act1.ts` | Same | `integrity.ts` |
| Blocks before start / flags during the exam | **Built**: `block` refuses `start()`; during the exam nothing blocks — new findings are journaled and critical codes raise `INTEGRITY_CRITICAL` (candidate never auto-submitted, never locked out) | Same | `gate.ts`, cell events |

No probe has yet been exercised against a *real* AnyDesk, TeamViewer or overlay on physical hardware — CI and `act1.ts` prove name matching against a renamed copy of another binary and the seat's own overlay-sim, not the genuine tool. The Windows CI artifact ([`evidence/stage0-windows-probe.json`](evidence/stage0-windows-probe.json)) shows the probes run in the packaged exe; [`evidence/stage5-gate-selftest.json`](evidence/stage5-gate-selftest.json) shows they now also detect and block by name in that same CI run. In the agents' own Seatbelt sandbox, the process/window/VM probes return `unknown` rather than a false clean verdict — handled explicitly as `probe-unknown`, not silently treated as clean.

## Stage 4 honest limits

- **Moves:**
  - A PIN move needs the exam server, so it waits for the WAN; the plan's "continue provisionally while restoring" is not built.
  - A PIN guess needs an invigilator's approval each time, and after 3 wrong PINs control must verify the candidate.
  - The relay cannot read the PIN or the restored answers, and cannot forge the grant.
- **Spare relay after a move:** the new seat holds only the entries after `fromSeq`. A spare relay with an empty DB therefore cannot be refilled with the entries before the move from that seat. The cell has them; a relay that pulls a prefix from its cell is later work.
- **rxWall is the relay's claim.** It is unsigned. A lying relay can move credited time and the hard stop within what the seat's signed `activeMs` allows. It cannot change an answer.
- **The hard stop** rejects late entries but keeps them. A seat cut off from its own centre for longer than the gap cap plus the slack will have its late entries held for a human decision.
- **Incidents and chaos:**
  - Incidents live in control's memory and are rebuilt from live state and the cells' evidence; `incidents.json` is a record, not a source.
  - The chaos routes are DEV-only, and the supervisor binds 127.0.0.1.
  - The relay's degrade and purge routes are on the centre LAN. Purge needs an authority signature; degrade is DEV-only.
- **The archive's WORM is simulated.** Production would use object lock or WORM media. Retention and DPDP deletion are not built.
- **SEAT_SILENT and CENTRE_OUTAGE** are evaluated for the relays control can reach (the demo relay). The simulated centres report through their cells only.
- **A spare relay's evidence event ids restart at 1.** Control's `/v1/events` cursor is per-relay and keyed by event id; when a dead relay is replaced by a spare, the spare's own event ids start over at 1, so a cursor left past that point on the old relay can miss the spare's first events until the next full poll. A cursor reset on relay replacement is later work.
- **A provisional (not yet bound) seat that starts the exam keeps running even after an "already bound" refusal.** If a provisional seat (no WAN at check-in) lets its candidate start before the real binding lands, and the WAN then returns and refuses the seat as `ALREADY_BOUND`, the exam already under way on that seat is not itself halted — only the *binding* is refused. The started exam needs an operator to notice and intervene; nothing today force-stops it automatically.
