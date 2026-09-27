# Plan: **Saakshi** (साक्षी, "witness") — a resilient, provable CBT ecosystem (Challenge 6)

## Context

**The challenge.** Challenge 6 asks for a large-scale CBT ecosystem, driven by technology, that covers Prevention → Detection → Response → Recovery → Trust. It should reduce disruptions, avoid unnecessary re-exams and keep candidates' trust.

**What the team proposed:**
- a Bluebook-style exam client that monitors background apps and virtual machines, with camera checks
- responses that work offline first and are stored encrypted
- servers partitioned by groups of candidates, with Redis and RAID5
- cheat detection that compares a student against their own history
- Rust and sharding

**How this plan was produced.** It comes out of two workflow rounds.
- **Round 1:** 4 research sweeps, then 3 competing plans, then 3 judges (an NTA official, a principal SRE and a pitch coach). The judges picked the risk-first plan (B) as the base. We grafted on the trust features from plan C and the framing from plan A.
- **Round 2:** 3 critics tried to break the combined plan, looking at protocol and cryptography, schedule and toolchain, and jury coverage. They found 45 issues and all of them are fixed below. The two blockers were: bindings and handovers authorised by the relay, and offline codes that would leak across shifts.

**Confirmed with the user:**
- **Build window:** 1–2 weeks, with Claude doing most of the building.
- **Deliverables:** a live demo on macOS and Windows, a PPT deck, a demo video, and a README/report.
- **Stack:** TypeScript now. The Rust port of the cell ingest path is a timeboxed stretch goal.
- **Windows:** a laptop only near the end. Until then, CI covers Windows.
- **LLM:** a Claude API key is available.
- **Past-performance history:** used only as a corroborating signal.

**Environment:**
- Repo `/Users/anirudh/probtester`, currently empty.
- arm64 Mac with node 25, bun 1.3.14, pnpm 11.5, uv, Python 3.14, sqlite3 3.54, git and gh. `gh auth` needs a re-login because it times out on the keychain.
- Not installed: Rust, Docker, Redis, mprocs, oha, ffmpeg.

**Thesis (the spine of the deck and the demo):** *"We can't promise zero failures. We make every failure **recoverable, contained, provable**."*

**Why now.** Re-verify every figure against its primary source before it goes in the deck.
- **NEET-UG 2026** was cancelled on 12 May and re-held on 21 June, affecting about 22.7 lakh candidates. NEET moves to CBT from 2027. Treat this soberly: there were protests and the minister resigned.
- **CUET-UG 2026:** a TCS iON glitch led to a re-test for 3,765 candidates.
- **SSC Phase 13 (2025):** 59,500 candidates were re-examined. At SSC CGL 2025 in Dhanbad, a server manager was arrested for remote answer injection.
- **JEE Main 2025:** a candidate's pop-up said 46 questions attempted while the response sheet said 29. The dispute went to the Delhi High Court.
- **Bluebook, March 2025:** about 10.1k tests were auto-submitted by a security setting.
- **41 paper leaks in 5 years**, affecting about 1.4 crore applicants.
- **Public Examinations (Prevention of Unfair Means) Amendment Act 2026:** investigations must finish in 2 months and trials in 3.
- **Nilekani task force (July 2026):** its mandate is "leak-proof, tamper-resistant, DPI".

---

## 1. Scope

### Team ideas: kept, changed, cut (also a deck slide)

| Team idea | Decision | Why |
|---|---|---|
| Desktop app monitors background apps, VMs and the camera | **Kept.** Layered monitoring where every finding becomes evidence, plus on-device face *presence* | Prevention story; the user's core idea |
| Technical anomaly → machine marked ineligible | **Changed.** Hard block only *before* the exam starts. During the exam: flag it and move the candidate to another seat; never auto-submit | Bluebook, March 2025: a security setting auto-submitted about 10k tests |
| Camera anomaly → AI or manual review | **Kept.** Detection runs on the device and a human reviews every flag. Accommodation-aware (a scribe means 2 expected faces) | DPDP; lessons from ProctorU and Respondus |
| Timestamped offline storage | **Upgraded** to a signed, hash-chained journal with WhatsApp-style ticks | Tamper evidence and reconciliation come for free |
| Encrypt all assets | **Kept, strengthened.** Paper under split custody. Answer bodies are encrypted to the cell, so the centre relay cannot read them. The seat journal is encrypted at rest | Answers stay unreadable to the next candidate and to centre IT staff |
| One server per 33% of students, plus sharding | **Changed** to **cells**, sharded by centre. Each cell is its own failure domain and can be rebuilt from the edges | Blast radius shown live |
| RAID5 / Redis | **Cut.** Durability comes from fsync on seat, relay and cell. Signed per-shift archives go to 2 stores | RAID5 rebuild risk; Redis is not durable |
| Response-time delta vs. past performance | **Changed.** Main signal is an in-exam response-time model. History is **corroboration only**, against a baseline that expects growth | Cold start; it penalises students who improve; DPDP rules for minors |
| Year-round performance record | **Mock registry** keyed to APAAR. DigiLocker/APAAR integration on the roadmap | Consent under DPDP |
| Rust under the hood | **Stretch goal (C1).** Rust cell ingest checked against the same golden vectors, then benchmarked | The measured bottleneck is fsync, not CPU; 35% of the score is the working prototype |

### MoSCoW scoping

**Stage codes:** P = Prevention, D = Detection, Rs = Response, Rc = Recovery, T = Trust.

**Focus-area numbers** refer to the 12 areas in the brief (see the matrix in §1.3).

| ID | Feature | Stage | Focus areas |
|---|---|---|---|
| **M1** | Seat journal. Each entry has a signed header and a body encrypted to the cell. Tick states ✓ / ✓✓ / blue ✓✓. Idempotent sync using a NEED/gap protocol | Rc, T | 5, 7 |
| **M2** | **Untrusted centre relay.** Store-and-forward; cannot read answer bodies; hosts the invigilator console; pushes to seats over the LAN; a spare relay can take over | Rc | 1, 4 |
| **M3** | **Cells ×3.** Verify, group commit, countersign. REBUILDING mode rebuilds from the relays. Signed per-shift archive to 2 stores (RPO and RTO measured) | Rc | 4 |
| **M4** | Integrity gate and in-exam monitor on macOS and Windows. Signed policy with accommodation profiles. Face presence. Hardened Electron | P, D | 1, 6 |
| **M5** | Split-custody paper release: Shamir 2-of-3 with custodian-held shares, a public commitment, a key commitment `kc_f`, and per-centre, per-shift offline codes held only at control | P | 5 |
| **M6** | Active-time timer with gaps checked against the wall clock. Resume on another seat, authorised by an old-key signature or by candidate PIN + invigilator. Caps apply; D_i is per candidate | Rc, Rs | 10 |
| **M7** | Receipts (code and counts computed on the seat, countersigned later), RFC 9162 Merkle log, `/verify`, audit (including truncation), per centre-shift **reconciliation report**, and a one-click **evidence pack** | T | 5, 7, 11 |
| **M8** | Control room: readiness with predicted risk, live tiles, entries/s, incidents P0–P3 with blast radius and an escalation ladder, labelled chaos buttons, review queue | D, Rs | 1, 2, 3 |
| **M9** | Candidate comms: in-exam banner, public status page, notice outbox. Strings in an i18n catalogue (EN / HI / TA) | Rs | 8 |
| **M10** | Swarm (replays the cohort JSONL), chaos scripts, reset script | — | 4 |
| **M11** | **Thin radar:** speed-accuracy and same-room similarity signals, deterministic | D | 6 |
| **M12** | **Thin decision engine:** Supreme Court tier-1 test, per-candidate compensate or re-test, CUET golden case | Rs | 9, 10 |
| **S1** | Radar hardening: CUSUM, independent generator G2, history corroboration, fairness breakdown | D | 6, 12 |
| **S2** | Decision hardening: TOST equivalence test, leak branches, re-test allocator, "spared" count and ₹ saved, dispute tickets | Rs | 9, 10 |
| **S3** | Claude, behind a provider interface with templates as the default: classify invigilator reports, draft notices, write per-centre notes | Rs, D | 3, 8, 12 |
| **S4** | Centre risk scorecard (allot / add observer / do not allot) and a predicted-risk model trained on mock-drill telemetry | P | 2, 12 |
| **S5** | Pointer-path provenance per answer, and an egress allowlist | D | 6 |
| **S6** | One witness process that co-signs STHs, but only when given a consistency proof | T | 5, 11 |
| **S7** | TLS with pinned certificates on seat→relay and relay→cell (mTLS is on the roadmap) | T | 5 |
| **C1** | Rust cell ingest plus benchmark (the user's stretch goal; optional Stage R, only if time remains after Stage 7) | — | — |
| **C2–C5** | drand/tlock release path; Windows injected-input hook helper; jury-picked leak seed; USB HID diff | — | — |
| **Won't** | Face recognition, video, blockchain, auto-disqualification, kernel drivers, Redis, RAID5, real SMS or DigiLocker | — | Roadmap slide |

**If time runs short:**
1. Inside a stage, drop Should and Could items in this order: C* → S7 → S6 (fall back to a single signed STH) → S5 → S4 extras (keep the ranking) → S2 → S1. **M1–M12 are never cut.**
2. If that still isn't enough, ship after the last stage that is finished (§5). Every stage ends in a demo that stands on its own.

### 1.3 Traceability matrix (deck slide 5 and README)

| # | Focus area in the brief | Features | Demo act |
|---|---|---|---|
| 1 | Real-time monitoring | M8, M2, M4 | 0, 3 |
| 2 | Early failure prediction | M8 readiness, S4 predicted risk, SYNC_LAG warning | 1, 2 |
| 3 | Incident detection, classification, escalation | M8 rules and ladder, S3 classification | 3 |
| 4 | Backup and DR | M2, M3 rebuild and archive | 3 |
| 5 | Tamper-evident storage | M1, M5, M7, S6 | 4 |
| 6 | Suspicious patterns | M4, M11, S1, S5 | 1, 5 |
| 7 | Reconciliation and validation | M1 NEED protocol, M7 reconciliation report | 3, 4 |
| 8 | Candidate communication | M9, S3 notices | 2, 5 |
| 9 | Re-schedule / re-conduct decision | M12, S2 | 5 |
| 10 | Fairness when disrupted | M6, M12 | 3, 5 |
| 11 | Audit trail and evidence reports | M7 evidence pack, S6 | 4 |
| 12 | AI analytics for systemic risk | S1, S3, S4 scorecard | 5 |

---

## 2. Architecture

```
Seat (Electron) ──LAN──► Centre relay (Bun MODE=relay) ──WAN──► Cells ×3 (Bun MODE=cell) ──► Control (Bun MODE=control)
 renderer: exam UI        untrusted: verifies headers,           decrypt bodies, verify,        directory, enrolment/bindings,
  (NTA style), MediaPipe  stores, forwards; cannot read          group commit, countersign,     custody release, incidents,
 main: journal, sync,     answers; invigilator console;          REBUILDING, archive            Merkle/STH, audit, evidence,
  timer, probes (koffi)   SSE key push; heartbeats in memory                                    Claude, analytics subprocess
                                                          Witness (MODE=witness) ◄── STH + consistency proof
Analytics (Python/uv): cohort generators, radar, history, decision engine, scorecard — reads cell exports (JSON)
Web (Vite/React, one multi-page build): /control /console /custodian /status /verify
```

| Layer | Choice | Notes |
|---|---|---|
| Seat | Electron via electron-vite and electron-builder; React renderer | Same Chromium on both OSes, and nothing native to compile on Windows |
| Crypto | **SHA-256, ECDSA P-256, HKDF, scrypt, ECDH:** `node:crypto` (native) on seat main, relay, cell and control. **XChaCha20-Poly1305: `@noble/ciphers` everywhere** (node:crypto and Electron's BoringSSL don't have it). **Browser verifier:** `@noble/hashes` and `@noble/curves`. **Secret sharing:** `shamir-secret-sharing` | Native verify is fast enough for cell ingest |
| Server | One Bun binary with `MODE=cell\|relay\|control\|witness`. `Bun.serve` routes. SSE uses `server.timeout(req,0)`, a 15 s `:ping`, event ids, Last-Event-ID replay, and a pull endpoint `GET /release/current`. Storage is `bun:sqlite` (WAL, `synchronous=FULL`, `fullfsync=ON`, verified in Stage 1, otherwise `setCustomSQLite` → Homebrew sqlite) | — |
| Windows probes | **koffi** calling user32 (`EnumWindows`, `GetWindowDisplayAffinity`, `GetWindowThreadProcessId`, `GetSystemMetrics(SM_REMOTESESSION)`), plus absolute-path `tasklist.exe`, `reg.exe`, `netstat.exe`. koffi is a `dependency` kept external to the Vite bundle, with `asarUnpack: ['**/node_modules/koffi/**']`, and non-target binaries pruned in afterPack | No PowerShell `Add-Type` |
| macOS probes | Absolute paths: `/bin/ps`, `/usr/sbin/sysctl`, `/usr/sbin/ioreg`, `/usr/sbin/netstat`, and JXA through `/usr/bin/osascript` | Each probe runs as a subprocess with a 5 s timeout and returns `unknown` on failure; never blocking |
| Analytics | Python 3.14 via uv: numpy, scipy, networkx. Control calls it as a subprocess and reads JSON back | — |
| LLM | Provider interface. **Templates are the default**; the Claude provider uses `@anthropic-ai/sdk` with `SAAKSHI_MODEL` (default `claude-sonnet-5`) and a cache. **Load the `claude-api` skill before writing it** | The LLM can be switched off (demo toggle) |
| Monorepo | pnpm 11 with settings in **`pnpm-workspace.yaml`**, not `.npmrc`. Set `nodeLinker: hoisted` and a build-script allowlist for electron and esbuild (check the pnpm 11 key name in Stage 0). Pin `packageManager` | — |
| Licence | Apache-2.0, aligned with the GoI open-source policy | Supports the DPI story |

### Path of one answer

1. The candidate clicks B on Q17.
2. The seat builds and signs the header. It encrypts the body to the cell, appends to the journal and fsyncs. The UI shows **✓**.
3. The relay verifies the header's signature and chain, group-commits and acks. The UI shows **✓✓**.
4. The cell decrypts the body, checks `bodyCommit`, commits and returns a countersigned ack. The UI shows **blue ✓✓**.
5. When the candidate submits, the seat computes the receipt code and the counts at once and shows them on screen, **even offline**. The cell countersigns later.
6. At shift close, a Merkle tree and STH are published and the witness co-signs.

### Failure handling

| Failure | Result |
|---|---|
| Seat app crashes, or power is lost | Resume from the local journal on the same seat. The gap is logged and needs approval |
| Seat hardware dies | Loss is at most the time since the last ✓✓. The seat warns the invigilator if ✓✓ lags more than 30 s. The candidate resumes on another seat (§3.5) |
| Centre loses WAN | Relay buffers (✓✓). Unlock uses the offline code. SYNC_LAG predicts the failure first |
| Relay dies | Seats keep ✓. A **spare relay** (same binary) starts, and seats resync from their journals starting at the last head each destination acknowledged |
| Cell crash, or its DB is deleted | The cell enters REBUILDING and returns 503 for live traffic. Relays replay from genesis. Result: sent = verified = stored, lost = 0. Cell keys live outside the DB, so old acks stay valid |
| Insider edits the cell DB | Audit locates the edited entry. The original is recovered from a replica, or by option search when only the answer field was changed |
| Remote-access tool, overlay, extra display | Flag, journal entry, incident, reseat |
| Clock or sleep tricks | `rxWall` stamps from relay and cell; wall-clock vs activeMs check; suspend and lock-screen events become gaps |

**Known single point of failure:** control during the T0 release. Disclosed on the slide; in production it is replicated.

---

## 3. Protocol spec v1 (frozen in Stage 0, before any golden vectors are generated)

### Encoding and signatures

- **Canonical encoding:** every hashed or signed structure is a **type-tagged JSON array**.
  - Allowed values: strings, integers ≤ 2^53−1, and nested arrays.
  - No objects, no floats, no −0.
  - `meta` is a fixed-position nested array.
  - Every structure carries `exam`, `shift` and `attempt`.
  - Domain bytes: `0x02` entry, `0x03` genesis, `0x04` body commit, `0x05` receipt, `0x06` finalHash, `0x07` key commitment, `0x00`/`0x01` Merkle.
- **Signatures:** `sig = ECDSA-P256-SHA256(key, m)`, where `m` is the domain byte followed by the UTF-8 JSON. The internal digest therefore equals the hash `h`.
  - Encoding: IEEE-P1363. Signers normalise to **low-S**.
  - Native verify: `crypto.verify('sha256', m, …)`.
  - noble verify: `{prehash:true, lowS:false}`.
  - Signing is **not deterministic**, so golden vectors assert *cross-implementation verification*, not byte-identical signatures.
  - P-256 was chosen so seat keys can live in TPM or Secure Enclave later.

### 3.1 Journal entries

- **Header:** `["entry",v,exam,shift,attempt,cand,keyEpoch,seq,prev,kind,tMonoMs,activeMs,bodyCommit]`
  - `h = SHA-256(0x02‖json)`
  - genesis `prev = SHA-256(0x03‖["saakshi-genesis",v,exam,shift,attempt,cand])`
- **Body:** `bodyCommit = SHA-256(0x04‖salt128‖json(["body",item,state,answer,meta]))`.
  - Stored as `AEAD(ECDH(seatEphemeral, cellShiftPub) → HKDF, salt‖body)`.
  - **The relay verifies headers only and cannot read answers.** This blocks a live crowd-sourced answer key built from centre traffic.
  - The seat also keeps its own copy of the body under `sessionKey` so it can resume locally.
- **Kinds:** `unlock`, `answer`, `clear`, `mark`, `integrity`, `gap`, `handover`, `idle` (only after 60 s with no entry), `submit`.
  - Navigation and heartbeats are not entries.
  - `answer.meta` holds `[dwellMs, pointerSummary]`.
  - `state` is one of NV, NA, A, MR, AMR; NTA's rule for which states are evaluated goes into the spec.
- **Seat at rest:** each line is XChaCha with AAD `["aad",exam,shift,attempt,cand,seq]`.
  - `sessionKey` is random per (shift, attempt, cand) and wrapped by `safeStorage`.
  - The seat wipes its journal only after **both** the relay and the cell have acked the submit head and the shift is archived.
- **Check order at relay and cell:**
  1. Verify the signature under the key for that `keyEpoch`.
  2. Check `prev`.
  3. Check for a fork or duplicate.
- **Outcomes:**
  - An unsigned or invalid entry becomes `BAD_SUBMISSION` against its source. It **never** raises FORK.
  - The same seq with the same `h` is a no-op.
  - The same seq with a different, validly signed `h` raises `FORK`.
  - A gap is answered with `NEED{cand, head}`. The sender resends from `head+1` and tracks the acked head for each destination.
- **Group commit:** a single writer queue commits every 10 ms or every 500 entries, and acks only after the commit.
- **Ack:** a cell signature over `["ack",exam,shift,attempt,cand,keyEpoch,seq,h]`.
  - Cell keys are provisioned by control with an authority cert and a `cellKeyId`, and stored **outside the cell DB**.
- **Honest durability claim:** process-crash durability is measured. Power-loss durability holds by design. On macOS, Node's fsync on the seat is not F_FULLFSYNC.

### 3.2 Binding, identity and handover

- **Check-in:**
  - The gate's existing Aadhaar or biometric check produces `attestHash = SHA-256(operatorId, time, method, cand)`.
  - The candidate sets a **6-digit PIN** on the seat. It is sent encrypted to the cell as a salted hash and never reaches the relay.
  - The cell signs the cert `["bind",exam,shift,attempt,cand,seatId,pubkey,keyEpoch,fromSeq,attestHash]`.
  - The seat checks the cert against the **cell key pinned in the signed policy**. There is no ✓✓ until that check passes.
  - If the WAN is down, the binding is **provisional**: the ticks say "provisional" until the cell ratifies it.
- **Handover** (resuming on another seat) needs one of:
  - (i) the old key signing `["handover",…,fromSeq,fromHead,newPub]`, or
  - (ii) the candidate's PIN, encrypted to the cell, **plus** the invigilator's approval.
- **Every handover opens an incident.**
  - Entries from the old key with `seq > fromSeq` are stored as `ORPHANED` evidence, not treated as tampering.
  - Any change after the handover to an item answered before it is highlighted in the review queue.
- **Restoring answers:** the cell re-encrypts the candidate's answer state to the new seat key.
  - If the WAN is down, the candidate continues and earlier answers show "safe at exam server, restoring".
  - **Demo choreography:** wait for ✓✓ with backlog 0 before force-quitting seat A.

### 3.3 Split-custody paper release (honest framing, not a "time lock")

- **Packager, per shift:**
  - Generates random `K_F1` and `K_F2`, and a random code `C_{c,shift}` for each centre.
  - Each code is 80 bits: 16 Crockford characters plus a check character.
  - Computes wraps `W_c = XChaCha(HKDF(C_{c,shift}, ["saakshi-offline",exam,shift,c]), {K_F1,K_F2})`.
  - Encrypts the code list under a random `L`.
  - Splits the bundle `{K_F1,K_F2,L}` Shamir **2-of-3** and gives one share to each custodian: NTA, NIC and an independent observer. Each custodian holds their share themselves, as a file or printed QR, never on control's disk.
  - The packager then destroys everything it generated. The slide says so.
- **Manifest:** a signed manifest `{ciphertextHash, kc_f = SHA-256(0x07‖K_f)}` is published at T−3 days as the commitment. Packages reach relays at T−3 days and seats at T−1 hour.
- **Release at T0:**
  - Two custodians decrypt their shares locally in `/custodian` and send them encrypted to control's ephemeral release key.
  - Control reconstructs the keys, then pushes a release signed over `["release",exam,shift,form,kc_f,ts]`: control → cells → relays (SSE) → seats. **Seats never poll the national cells.**
  - Control then zeroises the keys and logs the release with the custodian IDs.
- **Offline fallback:**
  - The superintendent phones in and is authenticated.
  - Control reveals **only that centre's code for that shift** and logs the use.
  - The relay console unwraps the keys and pushes them to the seats.
- **Seat check:** the seat verifies the key against `kc_f` before unlocking, whichever path the key came by.
- **Claims ledger entries:**
  - Control sees `K_f` at T0.
  - Setters see the plaintext paper.
  - TCS iON already releases a password shortly before the exam. What is new here is custody split across institutions, a public commitment, and audited per-centre fallback.

### 3.4 Integrity policy (signed; the client rejects unsigned policy)

- **BLOCK before start** (resolve, then re-check):
  - Blocklisted remote-access, recording or overlay tools, matched by process name and, on macOS, bundle ID.
  - Another app's window that is **excluded from capture**: `GetWindowDisplayAffinity ≠ 0` on Windows, `kCGWindowSharingState == 0` on macOS.
  - A remote session: `SM_REMOTESESSION` on Windows, `screensharingd` on macOS.
  - **A VM score of 2 or more**, from these signals:
    - `kern.hv_vmm_present`
    - a `VirtualMac*` model
    - BIOS or ioreg strings
    - a VM MAC prefix, excluding 00:15:5D
    - guest-tools processes

    CPUID is not used.
- **REVIEW:**
  - VM score of 1
  - more than one display
  - no camera
  - a probe returning `unknown`
  - egress to anything outside the allowlist (relay and cells)
- **AMBER readiness:**
  - running on battery
  - less than 1 GB free disk
  - clock skew over 2 minutes
- **Accommodation profile per candidate** (signed):
  - A scribe means 2 expected faces.
  - Assistive technology is allowlisted by signed bundle ID or hash: NVDA, JAWS, Narrator, Magnifier, VoiceOver.
  - Per-candidate duration is `D_i = D + compensatory time`.
- **During the exam:**
  - Probes run every 10 s.
  - Each finding becomes an `integrity` entry and an incident; the system **never auto-submits or locks a candidate out**.
  - Critical findings reach the invigilator within 5 s.
  - Window blur over 3 s is counted.
- **Lockdown claim is "deterrence + detection".**
  - Controls: kiosk mode, fullscreen, `alwaysOnTop('screen-saver')`, `setContentProtection` (Windows only; claim nothing on macOS 15+), and blur and display events.
  - In production, centres use managed PCs with Assigned Access or MDM.
- **Electron hardening:**
  - Apply fuses **only in the release build**, through electron-builder `electronFuses`:
    - RunAsNode off
    - NodeOptions off
    - inspect args off
    - embedded ASAR integrity on
    - OnlyLoadAppFromAsar on
  - Also set contextIsolation and sandbox, and a CSP of `script-src 'self' 'wasm-unsafe-eval'`.
  - Register `app://` as privileged (standard, secure, supportFetchAPI) before `ready`.
  - Allow no devtools, take a single-instance lock, and refuse `--remote-debugging-port`.
  - A separate **e2e build** has fuses off, set by a build-time flag.
- **Threat model sentence:** "A seat signature proves the record wasn't altered after the device produced it — not that the candidate chose it." Pointer provenance (S5) and the remote-session probes target the SSC 2025 pattern.

### 3.5 Face presence

- MediaPipe `FaceDetector` runs on CPU at 2 fps, bundled and served over `app://`.
- **Flags:**
  - no face for 10 s or more
  - more faces than expected in 3 of 5 samples
- Each flag carries **one** 160×120 thumbnail, encrypted to control and deleted after 30 days, and goes to human review. No face recognition, no video.
- **macOS:**
  - The demo build uses ad-hoc signing (`identity '-'`) with `hardenedRuntime: false`, which avoids the reported frameless-camera bug.
  - `NSCameraUsageDescription` and `askForMediaAccess`.
  - A reset script (`tccutil reset Camera`, delete the safe-storage keychain item).
  - Re-grant camera and keychain access ("Always Allow") after the final build; run `xattr -cr` on copies.
- **Windows:** `setPermissionRequestHandler` plus `setPermissionCheckHandler`.
- If the face check fails, fall back to invigilator attestation.

### 3.6 Time and resume

- **Timer:** remaining = `D_i − activeMs`. `activeMs` is monotonic within a key epoch and never compared across epochs.
- **rxWall stamps:** the relay stamps `rxWall` on every entry and the cell stores it.
- **Gap check:** the cell checks that (wall-clock time since unlock) − activeMs ≈ Σ(approved gapMs) ± tolerance.
- **Gap events:** `powerMonitor` suspend and resume, and lock-screen events, are journaled as `gap` entries that need approval.
- **Caps** (policy parameters):
  - Credited gaps total at most 30 minutes; beyond that the candidate is eligible for a re-test.
  - Two or more gaps raise a review flag.
  - Hard stop at the centre's unlock `rxWall` + D_i + gap cap + slack, enforced by both relay and cell.

### 3.7 Receipts, log, audit, evidence

- **finalHash:** `SHA-256(0x06‖["final",exam,shift,attempt,cand,form,[[itemId,state,answer]…sorted by itemId]])`.
  - The cell **recomputes it by replaying the chain**, rejects a submit that doesn't match, and rejects any entry after the submit.
- **Receipt body:** `B = ["receipt",exam,shift,attempt,pseud,seq,h,finalHash,attempted,answered,marked]`.
  - `code = Crockford(SHA-256(0x05‖B))[:16]` plus a check character.
  - The code is **computed on the seat at submit**. It appears on screen and on an HTML slip in plain text, with the attempted, answered and marked counts, and the invigilator prints it with `window.print`.
  - No phone is needed: the candidate copies the code onto the admit card.
  - The cell countersigns `B` later.
  - The full receipt and the answer vector go to the outbox **only after all shifts close**.
- **Log:**
  - One tree per shift, built per the RFC 9162 MTH (largest-power-of-two split, no duplicated leaves).
  - Leaf: `SHA-256(0x00‖["leaf",exam,shift,attempt,pseud,h,finalHash])`, where `pseud = HMAC(K_pseud, roll)` with its own key.
  - STH: `["sth",exam,shift,size,root,prevSTH,ts]`, signed by the authority.
  - A re-issued STH (late leaves, re-tests) needs an **RFC 9162 consistency proof** before the witness (S6) will co-sign.
  - On screen these are called the "sealed public register" and "independent auditor".
- **Audit:**
  - Hash-chain sweep.
  - Every chain must end in a `submit` whose `h` matches the receipt head and the leaf head. This catches truncation.
  - Per-candidate entry counts must match the relay and the archive.
  - Full signature and `bodyCommit` checks at scoring. **Scoring reads only a verified replay.**
  - Recovery order: replica or archive, then `next.prev`, then option search using `salt`.
  - Honest claim: "located; original recovered from a replica, or by option search when only the answer was edited".
- **/verify** (static, noble, works offline; HTTPS in production):
  - Inputs: the receipt code or `B`, the official response sheet (headers, signatures, bodies with salts, the cert chain) and the STH with proofs.
  - It checks the chain, the per-epoch keys, `bodyCommit`, `finalHash`, inclusion and the signatures. It then shows **"Q17: record says C — the seat committed B"**.
  - It is framed as the tool for NTA's response-sheet challenge window. A "raise objection" button creates a signed dispute ticket.
- **Reconciliation report** (per centre-shift):
  - Counts: registered / checked-in / unlocked / submitted / receipts / STH leaves.
  - Heads: relay head = cell head for every candidate.
  - Any mismatch raises an incident.
- **Evidence pack** (per incident or candidate): one click exports a zip plus PDF containing the entries and signatures, the inclusion proof, the STH and co-signature, probe results and thumbnails, a hash manifest, a chain-of-custody log, and a **BSA 2023 s.63 certificate template**.
- **Archive:**
  - Before any relay purge, a signed per-shift bundle is written to **2 independent stores** (two directories simulating WORM stores).
  - Purge happens only after both stores hash-verify against the STH.
  - Retention runs until results plus the grievance window, then deletion under DPDP.
  - RPO and RTO are measured.

### 3.8 Radar and history (M11, then S1; `analytics/`)

- **Shared cohort schema (JSONL):** `cand, centre, shift, form, lang, pwd, item, state, answer, dwellMs, …`. Frozen in Stage 0.
  - The swarm replays it.
  - Generators G1 and G2 write it.
  - The radar and the decision engine read **the cells' export**. The demo therefore analyses what actually flowed through the system.
- **G1 synthetic cohort:**
  - 20k candidates, 100 centres, 3 shifts, 2 forms, 100 items.
  - Item model: 3PL with lognormal response times.
  - Honest look-alikes: Hindi-medium, PwD, a mistranslated item, rapid guessers, high flyers, candidates who genuinely improved.
  - Planted cheating: 20 items leaked to 300 candidates at 3 centres, 6 copying rings, and a leak that starts mid-exam.
- **Signals:**
  1. A speed-accuracy residual on hard items, tested with a Poisson-binomial at p ≤ 1e-5.
  2. Identical wrong answers within a room, adjusted per score decile, with Bonferroni correction; networkx then extracts the rings.
  3. (S1) CUSUM per item × centre × shift, with Benjamini–Hochberg correction.
- **Escalation:** 1 signal → watch. 2 signals → review. 2 signals plus device or camera evidence → escalate.
- **History (corroboration only):**
  - A mock registry keyed to APAAR holds past percentiles.
  - Expected score = past + typical gain.
  - History only annotates flags that are already queued.
- **Calibration:** calibrate on honest G1 data and **evaluate on an independent G2** (different response-time distribution, different cheater pacing).
- **Reporting:** precision, recall, false-positive rate, and flag rates by language, PwD and centre.
- **Every flag** shows its reasons, the observed vs. expected values and the p-value. The candidate has a right to respond, and nothing is auto-penalised.

### 3.9 Decision engine (M12, then S2)

- **Policy:** signed and published before the exam. Thresholds are committee parameters, labelled "illustrative" in the demo.
- **Tier 1: the NEET-UG 2024 Supreme Court test.**
  - (a) Is there evidence of a *systemic* breach?
  - (b) Can the beneficiaries be *separated*?
  - Full re-conduct only when (a) holds and (b) does not.
- **Per candidate:**
  - Credited gap within the cap → compensate.
  - Candidate left, or cannot resume → re-test this subset.
- **S2 additions:**
  - **Comparability:** TOST equivalence on post-disruption residual scores. Groups smaller than N_min go to the committee.
  - **Leak branches:**
    - localised → re-conduct those centre-shifts
    - ≤ 10% of items and widespread → re-score without them
    - systemic and not separable → full re-conduct
  - **Scoring and re-tests:**
    - Equate scores with percentile normalisation.
    - A **greedy re-test allocator** picks the nearest centre with spare seats that respects PwD needs and language.
    - Output a roster and mock admit cards.
- **Output:** a signed report, **"Compensated N · Re-tested M · Re-conducted K centres · Spared S · ₹ avoided"**, with evidence hashes. A human signs off. This part is deterministic and uses no LLM.
- **Golden tests:**
  - A CUET-2026 replay (2-hour delay, some candidates left) → compensate + re-test those who left.
  - The NEET-2024 separable case → no full re-conduct.

### 3.10 Incidents, prediction and comms

- **Rules:**
  - `SEAT_SILENT` (30 s)
  - `CENTRE_OUTAGE`: half or more of a centre's seats go silent within 30 s. This is **one** incident.
  - `RELAY_WAN_DOWN`, `CELL_DOWN`, `INTEGRITY_CRITICAL`, `TAMPER`, `BAD_SUBMISSION`, `KEY_RELEASE_DELAY`
  - `SYNC_LAG`: an EWMA on backlog and latency that **predicts** WAN failure.
- **Severity P0–P3.** Each incident shows its blast radius, e.g. "1 cell · 33 centres · 6.6k candidates · answers lost 0".
- **Escalation ladder with acknowledgement timers:** invigilator → superintendent → control → regulator.
  - The regulator rung auto-drafts a CERT-In 6-hour report template on TAMPER or INTEGRITY_CRITICAL.
  - A signed DEMO policy shortens the timers to 10 s.
- **S4 predicted risk:**
  - A per-centre score from T−1 mock-drill telemetry: heartbeat jitter, battery/UPS, disk, past incidents.
  - Shows the top 3 reasons.
  - Its precision is measured on synthetic centre histories.
- **S4 scorecard:** a ranking with reasons → allot / add observer / do not allot. Claude writes the explanatory note.
- **Comms:**
  - In-exam banner: cause, ETA, "your time and answers are preserved" with the tick counts.
  - Public status page with no PII.
  - Outbox for SMS, email and DigiLocker (mock).
  - An i18n catalogue with EN, HI and TA. Other languages use human-reviewed templates; Bhashini is on the roadmap.
- **Claude (S3):**
  - Uses only aggregated, pseudonymous facts and **never PII**.
  - Output is cached. A human approves every notice.
  - Tasks:
    1. Classify free-text invigilator reports with structured output, and link each to the matching telemetry incident.
    2. Draft notices.
    3. Write scorecard notes.

### 3.11 UIs

- **Exam UI:**
  - Follows NTA conventions: Save & Next, Mark for Review & Next, Clear Response.
  - Palette colours: grey / red / green / purple / purple + green.
  - Language toggle for EN / HI / TA, with a bundled Noto Sans Devanagari and Tamil font.
  - Built to **WCAG 2.1 AA / GIGW 3.0**: keyboard-only use, ARIA, 200% zoom, high contrast.
  - Shows the ticks.
- **Invigilator console:** seat grid, acknowledgements, offline code, handover approval, slip printing, free-text report box.
- **Control room:**
  - tiles, cells, entries/s
  - incident feed with SLA timers
  - readiness and predicted risk
  - custody panel
  - review queue
  - decision report
  - register panel
  - **labelled chaos buttons** ("Pull the plug on Data Centre 2", "Degrade Centre 42's link", "Rogue insider edits an answer"), with the terminal visible alongside
- **Charts:** load the `dataviz` skill first.

---

## 4. Repo layout

```
apps/seat/        Electron (main: journal/sync/timer/probes; renderer: exam UI + MediaPipe)
apps/server/      Bun binary MODE=cell|relay|control|witness
apps/web/         Vite React multi-page: /control /console /custodian /status /verify
packages/core/    protocol v1: encoding, hashes, sigs, body crypto, Merkle (RFC 9162), custody, receipts; golden vectors
analytics/        Python (uv): generators G1/G2, radar, history, decision engine, allocator, scorecard, risk model
tools/            swarm, chaos.ts, reset.ts, packager, overlay-sim (capture-excluded test window)
policy/           signed integrity/decision/accommodation policies, blocklists, allowlists
fixtures/         seat-keys, paper F1/F2 (EN/HI/TA), stub cohort JSONL
docs/             report, threat model, claims ledger, traceability matrix, detection matrix, deck assets
.github/workflows Windows-only CI (path-filtered; cached; NSIS on dispatch/tag)
```

---

## 5. Build stages (each stage ends in an MVP you can see)

**How the stages work**
- **Every stage adds to the one before and ends in a working MVP.** I demo it to you with a recording or screenshots via SendUserFile, or you run it yourself. You approve before the next stage starts.
- **Stages are ordered by value.** If time runs out, we ship after the last stage that's finished, and it is still a coherent demo:
  - Stages 0–2 are the minimum pitch: "never lose an answer, and prove it".
  - Stages 0–6 contain every Must.
- **Two tracks run side by side.**
  - The main stages (systems, TypeScript) run in order.
  - **Analytics stages A1–A4 (Python)** run alongside them in a separate worktree, against the schemas frozen in Stage 0. Stage 6 connects the two tracks.
- **Method:** every stage is broken into steps with `superpowers:writing-plans` and built test-first.
- **Your part:** you steer, test on the macOS side, and start the deck and video drafts after Stage 2 with placeholder numbers.

### Stage 0: Foundations and risk spikes
- **Build:**
  - **Setup, which needs your approval:**
    - `git init`.
    - A GitHub repo. **Public with Apache-2.0** gets free CI minutes and fits the DPI story; a private repo bills Windows at 2× minutes.
    - `gh auth login`.
    - The pnpm 11 workspace config.
    - `brew install mprocs oha ffmpeg`.
    - A uv project.
    - This plan copied to `docs/plan.md`.
  - **Packaging spikes:**
    - A packaged macOS app, launched from Finder, shows a MediaPipe face count (`app://`, CSP, ad-hoc signing, fuses through electron-builder, safeStorage).
    - Windows CI builds `Saakshi.exe --probe-selftest`, which prints JSON from koffi and tasklist.
  - **Protocol v1 core (§3):**
    - encoding and hashes;
    - P-256 signatures cross-verified between native and noble;
    - body ECDH + XChaCha;
    - Shamir, the offline wrap and `kc_f`;
    - RFC 9162 Merkle trees with proofs;
    - the receipt code.
  - **Frozen:** protocol v1, the cohort and export schemas, and the fixtures (seat keys; paper F1 and F2 in EN/HI).
- **MVP to show: "feasibility proven".**
  - The installed macOS app counts faces live.
  - The CI artifact shows the Windows probe JSON.
  - A CLI tamper lab: flip any byte in a journal and the exact entry is located.
- **Exit check:**
  - `pnpm -r test` passes: golden vectors, 1,000 byte flips all detected, 1,000 native signatures verified by noble.
  - CI is green on windows-latest, including `pnpm install --frozen-lockfile`.

### Stage 1: "Never lose an answer" (the recovery core)
- **Build:**
  - `MODE=cell` and `MODE=relay`: check order, the NEED/gap protocol, group commit, `fullfsync` verified, countersigned acks, and the SSE rules.
  - The seat journal: encrypted at rest, fsync, torn-tail recovery.
  - The exam UI: NTA layout and palette, ticks, EN/HI i18n, Devanagari font, WCAG basics.
  - A minimal `/console` seat grid.
  - Until Stage 3, the cell trusts the fixture seat keys behind a DEV flag.
- **MVP to show:** sit a real exam on the Mac. Answers tick ✓ → ✓✓ → blue ✓✓. Turn Wi-Fi off and it keeps working. `kill -9` the cell: nothing acknowledged is lost, and everything syncs on return.
- **Exit check:**
  - `bun test apps/server` passes the sync rules: `BAD_SUBMISSION` versus FORK, gap resend, duplicate no-op.
  - The kill test passes.

### Stage 2: "Prove it" (Trust)
- **Build:**
  - Submit, with `finalHash` recomputed by replay.
  - The receipt code, and an HTML slip showing the attempted, answered and marked counts.
  - A per-shift Merkle tree and STH.
  - `/verify`, with golden vectors checked in the browser.
  - The audit: edits, truncation, count mismatches, and the recovery order.
  - A "Rogue insider" button.
  - The per-centre-shift **reconciliation report**.
  - The one-click **evidence pack**, including the BSA s.63 template.
- **MVP to show (Act 4):**
  - Submit, and the receipt code appears on the slip.
  - The rogue insider edits an answer. The audit locates it, and `/verify` shows **"Q17: record says C — the seat committed B"**.
  - The reconciliation row is green, and the evidence pack exports.
- **Exit check:**
  - Tests catch every kind of tampering: an edit, a deleted row, a truncated chain, a changed signature.
  - `/verify` works offline.

### Stage 3: "Start on time, anywhere" (Prevention: custody and enrolment)
- **Build:**
  - Enrolment and binding certificates: attestHash, PIN, provisional state.
  - The directory, and cell keys provisioned outside the cell DB.
  - Signed policies.
  - The packager, the manifest and the public commitment.
  - `/custodian`, with the shares held by the custodians themselves.
  - Release by push, with a pull fallback.
  - Offline codes per centre and per shift.
  - The active-time timer.
  - Swarm v1: 99 simulated centres **in one process, in memory**, replaying the G1 cohort.
  - Control room tiles and an entries/s counter.
- **MVP to show (Act 2):**
  - The live dashboard shows 20k candidates.
  - Two of the three custodians release. 99 centres go green.
  - The centre that is cut off unlocks with the phoned code, and the log records the fallback.
  - The paper cannot be read before T0: a hexdump shows ciphertext, a wrong code fails, and a key that doesn't match `kc_f` is rejected.
- **Exit check:**
  - Tests: a code works only for its own centre and shift; the release stays idempotent across SSE reconnects; the seat checks `kc_f` on both paths.

### Stage 4: "Contain every failure" (Detection, Response, Recovery ops)
- **Build:**
  - Resume on another seat and handover:
    - old-key signature, or PIN plus the invigilator;
    - `rxWall` stamps;
    - `powerMonitor` gaps;
    - caps and `D_i`;
    - ORPHANED entries.
  - Chaos testing: kill a cell or delete its DB, which puts it in REBUILDING and replays it; a spare relay; an archive to 2 stores; `tools/reset.ts`.
  - Incidents P0–P3 with blast radius, the escalation ladder, and the CERT-In template.
  - Labelled chaos buttons, including "Degrade Centre 42's link", plus SYNC_LAG prediction.
  - The in-exam banner and the public status page.
- **MVP to show (Act 3):**
  - "Pull the plug on Data Centre 2" also deletes its DB. A P1 card shows the blast radius, and candidates keep answering. The rebuild ends with sent = verified = stored.
  - Degrading a link produces a failure prediction.
  - An unacknowledged alert climbs the escalation ladder.
  - A seat resumes elsewhere with a PIN, and the time credited is approved.
- **Exit check:**
  - `bun tools/chaos.ts --runs 20` records lost = 0 on every run, and logs the RTO.
  - Handover tests pass.

### Stage 5: "Clean seats only" (the integrity layer from your notes)
- **Why it comes fifth:** every existing system already has lockdown. The unique value is recovery and proof. Its riskiest parts, the camera and the Windows probes, were already de-risked in Stage 0.
- **Build:**
  - The integrity gate and monitor on macOS.
  - Windows via a CI self-test: **overlay-sim plus a copy of notepad renamed `AnyDesk.exe` must BLOCK, naming both**.
  - The VM score.
  - The egress allowlist and the accommodation allowlist (NVDA / VoiceOver; a scribe seat expects 2 faces).
  - Pointer provenance (S5).
  - Face flags and the review queue.
  - The readiness board.
  - Electron hardening: release fuses, and a separate e2e build.
  - Playwright end-to-end tests.
- **MVP to show (Act 1, on the Mac):**
  - The readiness board shows amber.
  - AnyDesk and the overlay are blocked by name. The screen reader is allowed.
  - A face flag appears in the review queue.
  - `--inspect` is refused.
- **Exit check:** the CI gate self-test, the smoke test of the fused build, and the Playwright e2e all pass.

### Stage 6: "Decide fairly" (joining the analytics; ends with **M1–M12 frozen**)
- **Build:**
  - The radar and the decision engine read the **cells' export**.
  - The Claude provider (S3; load the `claude-api` skill first) classifies reports, drafts notices and writes scorecard notes. It is cached, and the LLM can be switched off.
  - The scorecard and predicted risk go on the readiness board.
  - The UI, banner and notices gain Tamil.
- **MVP to show (Act 5):**
  - The radar finds the planted centres and rings, and leaves the look-alikes alone.
  - The result reads **"Compensated 1,840 · Re-tested 212 · Spared 19,488"**.
  - The scorecard says "Centre 42 → add observer".
  - A Claude-drafted notice is approved and appears in EN/HI/TA.
- **Exit check:** `uv run pytest analytics` passes, including the golden decision cases, and the full demo runs end to end on the Mac.

### Stage 7: Windows and measured scale (whenever the laptop arrives)
- **Build:**
  - Windows laptop bring-up: install, camera privacy toggle, a recording of kiosk keys (Alt-Tab, Win, Ctrl+Alt+Del), and router and firewall setup (allow bun on macOS; set the Windows network profile to Private).
  - The detection matrix on both OSes, and Windows fixes.
  - Measured load: cell counters, p50/p99, RPO/RTO, relay WAN bytes per candidate-hour, and seat CPU/RSS in power-saver mode.
  - S6 witness with consistency proofs, and S7 TLS, if there is time.
- **Rule:** if seat A is not green by the end of this stage, Act 1 runs on the Mac.
- **MVP to show:** the full 5-act demo across both laptops, plus a slide of measured numbers.
- **Exit check:** the detection matrix is filled in, and the swarm and chaos numbers are logged.

### Optional Stage R: the Rust stretch (C1)
- **When:** only if Stage 7 finishes with time to spare.
- **Build:** cell ingest in Rust (Axum + rusqlite), with the same API and golden vectors.
- **MVP to show:** a TypeScript-vs-Rust benchmark slide, reported honestly.

### Stage 8: Ship
- **Build:**
  - 20 logged chaos runs.
  - 3 timed rehearsals, each in a 3-min and a 7-min cut.
  - A fallback clip for every act.
  - README/report, threat model, claims ledger, traceability matrix and detection matrix.
  - The deck (`anthropic-skills:pptx`) with the measured numbers.
  - The video (ffmpeg, captions).
  - Final builds on both laptops plus a spare; camera (TCC) and keychain grants; SmartScreen cleared.
- **MVP to show:** the complete submission package.

### Analytics track, alongside (each stage with its own MVP)

| Stage | Runs during | Build | MVP to show |
|---|---|---|---|
| **A1** | Stages 1–2 | G1 cohort generator (look-alikes plus planted cheating); thin radar (M11: signals 1 and 2) | CLI report: finds the planted leak and rings, and leaves the look-alikes unflagged |
| **A2** | Stage 3 | Thin decision engine (M12): Supreme Court tier-1 test, per-candidate rules, CUET and NEET-2024 golden cases | Decision report for a replayed CUET-style incident |
| **A3** | Stage 4 | S1: CUSUM, history corroboration, independent G2, calibration, fairness breakdown | Precision / recall / false-positive table on G2, with flag rates by language and PwD |
| **A4** | Stage 5 | S2: TOST, leak branches, re-test allocator, spared / ₹, dispute tickets; S4: scorecard and predicted-risk model | Full decision report with re-test roster, plus a centre scorecard |

---

## 6. Live demo: at most 7 minutes, with 30 s slack

- **Timing:** 6:30 of acts, plus a 3-minute cut. Confirm the slot length with the organisers.
- **Fallbacks:** every act has a recorded clip, and every act ends on a plain-words caption card.
- **Setup:**
  - The Mac runs control, 3 cells, the witness, the demo centre relay, 99 simulated centres (20k candidates) and the UIs.
  - Seat A is the Windows laptop. Seat B runs on the Mac with a signed DEMO watermark.
  - We bring our own router and an Ethernet cable.

| Act | What happens (★ marks the wow moment) | Caption card |
|---|---|---|
| 0 Hook (0:30) | NEET 2026 → "recoverable, contained, provable". Dashboard: 20k live candidates, 100 centres, 3 data centres | — |
| 1 Before (1:00) | Readiness board: Centre 7 is amber with **predicted risk and its top reasons**. Seat A: AnyDesk and overlay-sim are running, so the gate names both and blocks ★ "invisible to screen share, visible to us". Close them and the seat turns green. NVDA running → allowed. | "Risky seats caught before T0" |
| 2 T0 (1:10) | Press "Degrade Centre 42's link" → ★ SYNC_LAG warns "WAN failure likely, offline code pre-staged" → the link is cut. Two of three custodians approve → 99 centres go green and Centre 42 stays locked. The superintendent types the phoned code → both seats unlock, and the log records the fallback | "Exam started on time — even offline" |
| 3 During (1:20) | Answer ticks go ✓ → ✓✓ → blue. **A judge presses "Pull the plug on Data Centre 2" and deletes its database** ★ → a P1 card appears ("33 centres · 6.6k candidates · answers lost 0") and candidates keep answering. A judge types "lab 2 power gone, 14 seats" → it is classified and linked, and an unacknowledged alert escalates up the ladder. Restart → rebuild → sent = verified = stored. With ✓✓ at backlog 0, force-quit seat A → PIN + invigilator → it resumes on seat B with "+1:48 credited · approved" | "Data centre destroyed. 0 answers lost." |
| 4 After (1:00) | Submit → the slip shows the code and counts (46 attempted…). **A judge presses "Rogue insider edits an answer"** (the terminal shows the UPDATE) → the audit locates the edit → `/verify` ★ shows "Q17: record says C — the seat committed B". Reconciliation row is all green; one click produces the evidence pack (BSA s.63) | "Altered answer caught in 2 s — court-ready" |
| 5 Decide (1:00) | The radar finds the planted centres and rings; look-alikes are *not* flagged; history corroborates one flag. ★ "Compensated 1,840 · Re-tested 212 · Re-conducted 3 centres · **Spared 19,488**". Scorecard: "Centre 42 → add observer". Claude drafts the notice → it is approved → shown in the EN / HI / TA toggle on the status page and in the banner | "Only the harmed are re-tested" |
| Close (0:30) | Measured numbers, cost per candidate, "a protocol, not a product" (vendor conformance kit in NTA's RFP), rollout path | — |

**Held back for Q&A or the video:**
- `--inspect` refused
- the Wi-Fi-off seat
- the history registry
- the evidence pack, opened in full

---

## 7. Deliverables

- **Pitch deck (.pptx), about 15 slides, mostly free of jargon.** Say "two-key locker", "WhatsApp ticks for answers", "a receipt like a UPI reference". The slides:
  1. Hook
  2. Problem and stakeholders
  3. Root causes
  4. Thesis
  5. **Traceability matrix** combined with the lifecycle map
  6. Architecture
  7. Ticks and receipts
  8. Custody
  9. Radar and fairness
  10. Decision engine
  11. Measured results (RPO/RTO, throughput, WAN kbps per centre, seat CPU on low-end hardware, ₹ per candidate vs. the cost of one re-exam)
  12. **Sustainability:** cost; RACI (NTA owns policy, keys and decisions; NIC runs control and cells; vendors run centres and pass the conformance kit; witnesses sit outside the operational path); Apache-2.0 under the GoI open-source policy; rollout (shadow mode on a small NTA exam → relays and cells → mandate)
  13. Privacy (DPDP) plus identity (check-in attestation) plus limits
  14. Roadmap (Rust, TPM keys, APAAR/DigiLocker, managed PCs, an on-prem Indic LLM, Bhashini)
  15. Ask
- **Demo video (3–5 min):** cut from the rehearsal clips with ffmpeg, with captions.
- **README and `docs/`:**
  - report
  - protocol spec v1
  - threat model with honest limits
  - traceability matrix
  - detection matrix (checks × OS, including NVDA and a scribe seat)
  - measured numbers
  - DPDP notes (retention, minors, pseudonymisation)
  - minimum seat spec (Win10 x64 / macOS 12, 4 GB RAM, dual core, camera optional)
  - runbook
- **Claims ledger:** each claim → its evidence → *measured / by design / roadmap*.
  - **Banned words:** "tamper-proof", "lockdown" on its own, "time-lock" for the custody scheme, "blockchain".

---

## 8. Top risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | Camera or MediaPipe fails in the packaged build, or signing resets permissions | Stage 0 packaged spike; ad-hoc signing with hardenedRuntime off; reset script; re-grant after the final build; invigilator-attestation fallback |
| 2 | Windows hardware only arrives late | CI self-tests of the **packaged exe** from Stage 0, with the gate test added in Stage 5. Stage 7 starts the moment the laptop arrives, and can run earlier if it comes sooner. If seat A isn't green by the end of Stage 7, Act 1 runs on the Mac |
| 3 | Protocol churn breaks the golden vectors | Freeze protocol v1 (§3) in Stage 0, before any golden vectors are generated; cross-verify signatures instead of comparing bytes |
| 4 | Throughput or durability claims fall apart | Group commit; publish only measured numbers; simulated centres run in memory, and only the demo relay and cells fsync; durability labelled honestly |
| 5 | A judge pokes holes in a claim | Threat model, claims ledger, banned words |
| 6 | "You planted it, so of course you found it" | Independent G2; false-positive rate on look-alikes; the radar reads the system's own export |
| 7 | Scope creep, or a half-built feature on stage | Each stage ends in a demoable MVP that you approve. M1–M12 are frozen at the end of Stage 6. Cut order is in §1. Anything shaky becomes a clip |
| 8 | CI minutes or venue network | Public repo or path filters; own router; signed DEMO policy |

---

## 9. Verification

- **`pnpm -r test`:**
  - byte-exact golden vectors for encoding, hashes, Merkle, XChaCha and HKDF
  - signatures cross-verified between node, Bun, Electron main and browser (noble), with 1,000 native signatures verified by noble
  - 1,000 byte flips all detected
  - idempotent replay
  - torn tail
  - offline code works only for its own centre and shift
- **`bun test apps/server`:**
  - check order (unsigned same-seq → `BAD_SUBMISSION`, never FORK)
  - NEED/gap resend
  - REBUILDING returns 503, then produces identical heads
  - handover requires an old-key signature or PIN
  - ORPHANED entries
  - provisional binding
  - finalHash recompute
  - truncation caught
- **`uv run pytest analytics`:**
  - radar false-positive rate on honest G2 within target, and all plants detected
  - history never creates a flag on its own
  - CUET and NEET-2024 golden cases pass
  - allocator respects PwD and language
- **`bun tools/chaos.ts --runs 20`** (kill cell, delete DB, kill relay mid-batch, spare relay) → every run logs `sent = verified = stored`, `lost = 0`, and the RTO.
- **`bun tools/swarm.ts`** → events/s, p50/p99, CPU and RSS per cell, WAN bytes per candidate-hour. All labelled as measured on the hardware used.
- **CI on windows-latest:**
  - `Saakshi.exe --probe-selftest`
  - gate self-test must BLOCK overlay-sim and the renamed AnyDesk.exe
  - fused build ignores `--inspect` and exits on `--remote-debugging-port`
- **Playwright on the e2e build** with fake media flags: enrol → unlock → answer offline → sync → submit → `/verify` green.
- **`docs/detection-matrix.md`** filled in on both laptops: AnyDesk, TeamViewer, overlay-sim, second display, RDP / Screen Sharing, VM (UTM), NVDA, scribe seat.
