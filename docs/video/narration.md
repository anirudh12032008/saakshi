# Demo video narration

Source for the voiceover and the burned-in captions (`bun tools/video.ts` reads this file). Each line under a `### 7min` or
`### 3min` heading is one spoken sentence and one caption. Every number is from `README.md` or `docs/evidence/`.
Voice: macOS `say -v Rishi` (Indian English).

## Act 0 — Hook
card:
### 7min
NEET 2026 showed what happens when an exam fails and nobody can prove what went wrong.
Saakshi means witness.
We can't promise zero failures.
We make every failure recoverable, contained and provable.
Every answer is signed and hash-chained at the seat, and the system keeps working through relay, cell and link failures.
Here are five acts, each run on real seat, relay, cell and control processes.
### 3min
Saakshi means witness.
We can't promise zero failures.
We make every failure recoverable, contained and provable.

## Act 1 — Before
card: Risky seats caught before T0
### 7min
Act one: before the exam starts.
The readiness board shows every seat at Centre 42.
One seat is amber because it is running on battery.
Seat A has AnyDesk and an overlay tool running.
The gate blocks the seat and names both tools.
The overlay is invisible to screen share, but visible to us.
Until they are closed, the seat refuses to start.
The candidate closes them, presses re-check, and the seat turns green.
The scribe seat runs the NVDA screen reader, and it is allowed.
When three faces appear where two are expected, one face flag goes to the review queue, and a human reviewer clears it.
Nothing is ever penalised automatically.
### 3min
The gate blocks a seat running AnyDesk and an overlay tool, and names both.
Close them, re-check, and the seat turns green.
A screen reader on the scribe seat is allowed.

## Act 2 — T0
card: Exam started on time — even offline
### 7min
Act two: the exam starts.
The paper sits on every centre's disk as ciphertext, with no question text in it.
Centre 42's link to the data centres is cut.
The release is a two-key locker: two of three custodians, NTA and NIC, approve it.
Every other centre goes green, while Centre 42 stays locked because its link is down.
The superintendent phones in, and control reveals only Centre 42's code, and logs that it did.
A typo is refused, and so is another centre's code.
The phoned code unlocks Centre 42, and the seat records that it started through the fallback.
A forged key pushed by the relay is rejected by the seat.
After a relay restart the release arrives again, and the seat still unlocks exactly once.
In the recorded run, 308 candidates at 7 centres started, and about 6,600 answer entries were committed.
### 3min
Centre 42's link is cut, and two of three custodians release the paper.
Every other centre goes green.
The superintendent types a phoned code, and Centre 42 starts on time, offline, with the fallback logged.

## Act 3 — During
card: Data centre destroyed. 0 answers lost.
### 7min
Act three: during the exam, everything breaks.
Answers get WhatsApp-style ticks: saved at the seat, then at the relay, then verified at the data centre.
We degrade Centre 42's link, and a sync-lag warning predicts the failure before the link is actually cut.
When it drops, the seat shows a banner, and an unacknowledged alert climbs the escalation ladder until the superintendent acknowledges it.
Now we pull the plug on Data Centre 2 and delete its database.
A P1 incident card shows the blast radius, and candidates keep answering.
Data Centre 2 restarts and rebuilds itself from the relays.
Sent equals verified equals stored, and answers lost is zero.
Then we force-quit seat A.
The candidate moves to seat B with a PIN and the invigilator's approval, and resumes with the same answers and the lost time credited.
Seat A's leftover entries are marked as orphaned evidence, not tampering.
In the chaos drill, twenty of twenty runs passed, with zero of sixteen thousand answers lost.
The public status page carries the approved notice, with no personal data.
### 3min
We pull the plug on Data Centre 2 and delete its database.
Candidates keep answering, and the data centre rebuilds from the relays with zero answers lost.
A force-quit seat resumes on another seat, with time credited.
In the chaos drill, twenty of twenty runs lost none of sixteen thousand answers.

## Act 4 — After
card: Altered answer caught, located and provable — evidence pack in one click
### 7min
Act four: after the exam.
The candidate submits, and the slip shows a receipt code and the counts, like a UPI reference.
The shift is sealed, and reconciliation is green.
Now a rogue insider edits an answer directly in the data centre's database.
The terminal shows the exact UPDATE statement.
The audit locates the edit and recovers the original answer from the archive.
On the verify page, anyone with the receipt code sees it plainly.
Question 17: the record says C, but the seat committed B.
Every other check still passes: the chain, the keys, the receipt and the sealed register.
One click produces the evidence pack, with a Section 63 certificate template and a manifest that verifies.
### 3min
A rogue insider edits one answer in the data centre's database.
The audit locates it, and the verify page shows question 17: the record says C, but the seat committed B.
One click produces the evidence pack.

## Act 5 — Decide
card: Only the harmed are re-tested
### 7min
Act five: deciding what is fair.
Two thousand synthetic candidates replay through the full stack, and the analytics run on what the data centres actually exported.
The radar flags every planted leak centre, and no honest candidate.
History only annotates the flags; it never changes them.
The headline: compensated zero, re-tested 193, re-conducted 3 centres, spared 1,190.
At the full twenty thousand scale, 225 are re-tested and 18,994 are spared.
The scorecard puts Centre 42 at: add an observer.
An invigilator's power report is classified and linked to the open outage.
The notice is drafted, approved by a human, and shown in English, Hindi and Tamil on the status page.
The decision is signed off, and the signature verifies.
### 3min
The radar flags every planted leak centre and no honest candidate.
Only the harmed are re-tested: 193 re-tested, 1,190 spared.
The notice is approved and shown in English, Hindi and Tamil.

## Close
card:
### 7min
These are measured numbers from one Mac, on loopback, with synthetic data.
Zero entries rejected at twenty thousand candidates, and every candidate unlocked.
Saakshi is a protocol, not a product, under Apache 2.0.
It is tested on macOS and in Windows CI, and every number is cited in the evidence folder.
Recoverable, contained, provable.
### 3min
Measured on one Mac, cited in the evidence folder, and tested on macOS and in Windows CI.
Recoverable, contained, provable.
