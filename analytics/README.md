# saakshi-analytics: G1/G2 generators, radar (A1 / M11, A3 / S1), decision engine (A2 / M12, A4 / S2) and centre scorecard (A4 / S4)

## Generate a cohort

```sh
cd analytics
uv run python -m saakshi_analytics.generate OUT            # 20k candidates, 100 centres, seed 7
uv run python -m saakshi_analytics.generate OUT --n 2000 --centres 10 --seed 3
uv run python -m saakshi_analytics.generate OUT2 --profile G2 --seed 2026   # the independent evaluation cohort (A3)
```

This writes four files:

- `OUT/cohort.jsonl`: one row per candidate × item, following the frozen `fixtures/schemas/v1.json`. The full run is 2M rows (about 350 MB).
- `OUT/key.json`: the answer key. I01–I20 are the demo paper (`fixtures/paper/key.json`); I21–I100 are seeded. F2 is F1 in reverse order.
- `OUT/truth.json`: what was planted (the leak, the mid-exam leak, the rings and the look-alikes). **None of it appears in the cohort rows.**
- `OUT/registry.json`: the mock APAAR registry for history corroboration (A3): `apaar` maps candidate → 12-digit APAAR id, `pastPct` maps APAAR id → past percentile. It covers every improver (with `truth.json`'s `pastPct`) plus ~40% of everyone else, drawn from their true ability. It is drawn last, so the G1 cohort stream is byte-identical to A1's.

The generator is deterministic for a given seed.

## Run the radar

```sh
uv run python -m saakshi_analytics.radar OUT/cohort.jsonl --key OUT/key.json [--truth OUT/truth.json] [--registry OUT/registry.json]
uv run python -m saakshi_analytics.evaluate            # A3: calibrate on honest G1, print the G2 table (in memory, ~2 min at 20k)
uv run python -m saakshi_analytics.evaluate --n 2000 --centres 10 --json eval.json
```

- It prints every flag with its reason, observed vs expected, and p-value.
- With `--truth`, it adds precision, recall and FPR per signal, plus flag rates for the look-alike groups.
- It also reads the cells' export rows (the cohort fields plus `seq/rxWall/h`); the extra fields are ignored.
- With `--json flags.json`, it also writes the flags for the decision engine's `--flags`.
- With `--registry`, each queued flag gets a `history` note (annotation only, see below).
- **Nothing is auto-penalised:** 1 signal → `watch`, 2 or more → `review`, 2 or more plus device or camera evidence → `escalate`. That evidence is the named input `radar.run(..., device_camera_evidence=set_of_cand_ids)` / `radar.level(n, device_camera_evidence=...)`; nothing produces it yet, so the CLI never escalates.

## Tests

- `uv run pytest -q` runs everything, including the one full 20k test (`-m full`: calibrate on honest G1, evaluate on G2).
- `uv run pytest -q -m "not full"` runs only the fast suite (2k candidates).

## Stage 6: the live pipeline

```sh
bun tools/act5.ts          # 2k twin (seed 7), CI-sized
bun tools/act5.ts --full   # 20k engine run
```

Control fetches `/v1/shift` from every cell in the directory (refusing 409 unless all answer and none is `REBUILDING`), turns the export into cohort rows (Addendum E.1), and runs one pipeline: radar → history annotation → decision engine → scorecard → one `AnalyticsRun` JSON, signed off over the exact `run.json` bytes (Addendum E.2). **One demo shift**: every comparison against "the generator's cohort" uses the generator cohort with `shift` rewritten to the directory shift and the demo centre's rows removed, so the swarm's simulated centres and the one real demo centre are compared on the same footing.

Act 5 headline (2k, seed 7): "Compensated 0 · Re-tested 193 · Re-conducted 3 centres · Spared 1,190 · ₹ avoided 17,85,000" — export rows match the replayed cohort row by row on every radar field (200,000 rows checked); 53 flags, CEN005/CEN008/CEN009/CEN010 flagged, no honest candidate flagged; history annotates 53 flags and corroborates 4; scorecard: "CEN042 → add observer" (risk 0.36); an invigilator's report "lab 2 power gone, 14 seats" classifies as `CENTRE_OUTAGE` (14 seats) and links to the open `RELAY_WAN_DOWN` incident at CEN042; the notice is approved and appears on `/status` in EN, HI and TA. See [`../docs/evidence/stage6-act5.txt`](../docs/evidence/stage6-act5.txt) for the exact run and [`../docs/evidence/stage6-act5-full.txt`](../docs/evidence/stage6-act5-full.txt) for the 20k live run, which is **pending**: the export matched on 1,981,100 rows, but the pipeline refused the script's CEN042 disruption because CEN042 is not in the 20k swarm cohort. The 20k engine golden (pytest `-m full`) passes.

**"Compensated 0" is not a bug.** With no measured gaps in the disruption window, every affected candidate is credited the full 120-minute window — over the 30-minute compensation cap — so each one is re-tested rather than compensated. The report prints this reasoning; the numbers are not tuned to avoid a zero.

`drill.mock.json` is the T−1 mock-drill telemetry behind the scorecard; CEN042's row there is what makes CEN042 the readiness board's top risk ("add observer") in the Act 5 run above.

## Signals

| # | What | Test | Threshold |
|---|---|---|---|
| 1 | Speed–accuracy residual. Among a candidate's *fast* answers (log-time residual < −2 robust sd, after removing item time intensity and the candidate's own pace) on *hard* items (expected P(correct) ≤ 0.8 for their ability decile), count the correct ones | Exact Poisson-binomial tail | p ≤ 1e-5 |
| 2 | Identical wrong answers for every same-room (centre+shift) pair, vs the expectation from per-decile, per-item distractor rates. Rapid responses are left out on both sides. networkx connected components → rings | Exact Poisson-binomial (after a Poisson pre-screen at 1e-3), Bonferroni over **all** same-room pairs in the cohort (665,768 at 20k) | p_adj ≤ 0.01 |

| 3 (S1) | CUSUM per item × centre × shift. In each cell, order the answers by `tFirstMs` and run Page's Bernoulli CUSUM on "fast **and** correct" (in control: that form × ability decile × item's cohort rate, floored at 1e-3; out of control: 0.5). The segment from the change point to the CUSUM peak is tested; the change point dates the leak. A candidate is flagged only inside significant cells | Exact Poisson-binomial on the segment × n(n+1)/2 (Bonferroni over every segment the scan could pick), then **Benjamini–Hochberg across all cells** (30,000 at 20k); per candidate, exact Poisson-binomial on their fast-and-correct answers in significant cells | BH q ≤ 0.01 (cell), p ≤ 1e-3 (candidate) |

**Ability decile.** It is the difficulty-adjusted score on the candidate's normal-paced items only. That way a leak can't inflate its own baseline, and dropping a leaker's fast, hard items doesn't make them look stronger.

## Planted effect sizes (in `generate.py`)

| Plant | Size |
|---|---|
| Item model | 3PL: a ~ logN(0, .25), b ~ N(0, 1), c = 0.2. Lognormal RT: log t = β_j − τ_i + N(0, .35²), with β_j around 60 s |
| Leak | 20 items (drawn from the hardest 40), given to 300 candidates at 3 centres. Leaked items are answered 4× faster than the candidate's own pace, and the leaked key is followed 95% of the time |
| Mid-exam leak | Same 20 items, 60 candidates in one room. The leak lands at 45 min, so only items first reached after that are affected |
| Rings | 6 rings of 3–5 in distinct rooms. Copiers take the source's response on 90% of items |
| Cheaters' ability | θ ~ N(−0.6, 0.8), for both leak buyers and ring members (the cohort is N(0, 1)) |
| Hindi-medium | 70% of candidates in 30% of centres, 15% elsewhere. They read 1.15× slower. Item I12's Hindi text points to one wrong option for half of them |
| PwD | 3% of candidates, 1.5× slower |
| Rapid guessers | 2%. The last 35% of their form is answered in ~6 s each, at random |
| High flyers | 1%, θ ~ N(2.8, 0.2), faster |
| Improvers | 2%, θ + 0.8 over their past attempt (`pastPct` is in `truth.json` for the A3 history registry) |

The look-alikes are disjoint from the planted cheaters. Hindi-medium and PwD candidates are identified from the rows.

## Results: full G1 run, signals 1–2 at A1 thresholds (seed 7, 20k candidates, via JSONL)

| Signal | Flagged | Precision | Recall | FPR (honest) |
|---|---|---|---|---|
| 1 speed-accuracy (all leak recipients) | 305 | 1.000 | 0.847 | 0.00% |
| — full leak (300) | | | 0.893 | |
| — mid-exam leak (60) | | | 0.617 | |
| 2 same-room (22 ring members) | 22 | 1.000 | 1.000 | 0.00% |
| Any signal, on 19,618 honest candidates | | | | **0.00%** |

| Look-alike group (honest only) | n | Flagged | Rate | p (> baseline, Fisher) |
|---|---|---|---|---|
| Baseline (no look-alike trait) | 12,393 | 0 | 0% | — |
| Hindi-medium | 6,150 | 0 | 0% | 1.0 |
| PwD | 555 | 0 | 0% | 1.0 |
| Rapid guessers | 400 | 0 | 0% | 1.0 |
| Improvers | 400 | 0 | 0% | 1.0 |
| High flyers | 200 | 0 | 0% | 1.0 |

Other seeds at 20k (11, 13):

- Full-leak recall is 0.86 and 0.95.
- Mid-exam recall is 0.67 and 0.70.
- Ring recall is 1.0.
- Honest FPR is 0 in both.

**Tests assert:** leak recall ≥ 0.8, ring-member recall ≥ 0.8, honest FPR ≤ 0.5%, and no look-alike group above baseline at p ≤ 0.01. The 20k test also asserts mid-exam recall ≥ 0.5.

## Honest caveats

- **The radar and G1 share assumptions.** Both use conditional independence of speed and accuracy, and distractor pull that is the same within a decile. G1 is a calibration set, not independent evidence; see the G2 results in A3 below. The 0% FPR is a model result, not a field result.
- **The thresholds are strict.** The most extreme honest candidate reaches p ≈ 1e-3 on signal 1, against the 1e-5 bar. The price of that strictness is below.
- **Strong cheaters are hard to catch.** A leak gives little to someone who could solve most items anyway. A ring of strong students shares few *wrong* answers. We therefore plant cheaters at θ ≈ −0.6 and draw the leak from the tougher half. During tuning, with leaked items drawn uniformly and buyers at average ability, leak recall was 0.3–0.5; that was measured with an earlier ability estimate, not the final one.
- **The mid-exam leak is only partly caught by signal 1 (~0.6).** Signal 1 sees only the ~half of leaked items reached after the leak lands. Signal 3 (A3) takes it to 1.0 on G1 and 0.70 on G2.
- **Answer key.** The radar needs the answer key as a separate input (`--key`); it isn't part of the frozen row schema.
- **Wall clock.** The 20k JSONL run uses about 18 s of CPU. On a heavily loaded machine the wall clock can be several minutes.

## A3 (S1): CUSUM, history, independent G2, calibration, fairness

### G2, the independent evaluation cohort (`--profile G2`, fixed before it was ever scored)

Same design and look-alikes as G1, but different in exactly the places the radar leans on:

| | G1 (calibration) | G2 (evaluation) |
|---|---|---|
| Response-time noise | lognormal, log-sd 0.35 | gamma(k = 5) multiplicative, log-sd ≈ 0.47 with a heavier *fast* tail |
| Pacing | constant | time-pressure drift: everyone speeds up through the form (−0.25 log-time by the last item) |
| Leak speedup | 4× for every buyer | per buyer U(2.5×, 4.5×): some pace themselves |
| Leak accuracy | 95% | 90% |
| Mid-exam leak | lands at 45 min for the whole room | lands at 60 min and reaches each recipient over the next 20 min |
| Ring copying | 90% of items | 80% of items |

### Calibration (honest G1 only)

`radar.calibrate` sees only honest G1 candidates (it refuses a cohort containing planted ones when given `truth`). Each threshold is the loosest power of ten at least 10× below the most extreme honest value, capped (signal 1 ≤ 1e-3, signal 2 ≤ 0.05, signal 3 q ≤ 0.05). At 20k (seed 7) this gives **signal 1 p ≤ 1e-4** (the most extreme honest p is ~1e-3), **signal 2 p_adj ≤ 0.05** and **signal 3 q ≤ 0.05** (both at the cap: no honest pair or cell comes close). The per-candidate signal 3 bar (1e-3) is a fixed committee parameter, because honest data never reaches the stage that uses it.

### Results: calibrated on honest G1 (seed 7), evaluated on G2 (seed 2026), 20k candidates, 100 centres

`uv run python -m saakshi_analytics.evaluate`

| G2 signal | Flagged | Precision | Recall | FPR (19,614 honest) |
|---|---|---|---|---|
| 1 speed-accuracy (360 leak recipients) | 214 | 1.000 | 0.594 (full 0.670, mid 0.217) | 0.00% |
| 2 same-room (26 ring members) | 20 | 1.000 | 0.769 | 0.00% |
| 3 CUSUM (360 leak recipients) | 336 | 1.000 | 0.933 (full 0.980, mid 0.700) | 0.00% |
| Leak, signal 1 or 3 | 336 | 1.000 | 0.933 | 0.00% |
| **Any signal** | 356 | 1.000 | | **0.00%** |

Levels on G2: 142 watch, 214 review (every signal-1 flag is also a signal-3 flag), 0 escalate.

**Mid-exam leak recall, before and after CUSUM:**

| Cohort, thresholds | Before (signal 1) | After (signal 1 or 3) |
|---|---|---|
| G1, A1 thresholds | 0.617 | **1.000** |
| G1, calibrated | 0.667 | **1.000** |
| G2, calibrated | 0.217 | **0.700** |

On G1 the CUSUM dates the mid-exam leak at 45 min, which is when it was planted.

**Fairness breakdown (G2, calibrated).** "Rate" counts every flag, planted included. "Honest rate" is that group's false-positive rate.

| Group | n | Flagged | Rate | Honest n | Honest flagged | Honest rate |
|---|---|---|---|---|---|---|
| lang = en | 11,653 | 209 | 1.79% | 11,425 | 0 | 0.00% |
| lang = hi | 6,321 | 113 | 1.79% | 6,198 | 0 | 0.00% |
| lang = ta | 2,026 | 34 | 1.68% | 1,991 | 0 | 0.00% |
| PwD = 0 | 19,363 | 336 | 1.74% | 18,997 | 0 | 0.00% |
| PwD = 1 | 637 | 20 | 3.14% | 617 | 0 | 0.00% |
| Centre | 100 centres | | | | 0 centres with any honest flag | max 0.00% |

- The PwD overall rate is higher only because planted cheaters include PwD candidates; no honest PwD candidate is flagged.
- The highest overall centre rates are the planted ones: the three leak centres at 49–54%, and the mid-exam centre at 19%.
- G2 look-alikes (honest Hindi-medium, PwD, rapid guessers, improvers, high flyers): 0 flagged in each group, against a 0 baseline.
- The same holds on G1 with the calibrated thresholds: 0 honest flags.

### History: corroboration only

- `history.annotate(flags, cohort, registry)` returns copies of the queued flags, each with a `history` note: past percentile, typical gain (registry median), expected = past + gain, observed, and whether observed − expected ≥ 2 robust sd of the registry's changes.
- **It never creates, removes, escalates or de-escalates a flag.** `test_history_only_annotates_queued_flags` pins this with the real registry *and* an adversarial one where every candidate looks like a huge jump. It checks that levels, signals and the candidate list are unchanged, the input isn't mutated, and no flags in means no flags out.
- On G2, 138 of the 356 planted flags have a registry record and 50 of those are corroborated. There are no honest flags to annotate.
- **Why corroboration only:** a genuine improver (+0.8 sd) jumps 20–40 percentile points, *more* than a typical leak buyer (10–20). History cannot tell them apart, so it may only annotate a flag that other evidence already raised.

### A3 caveats

- **G2 is independent in its noise and pacing, not in its structure.** It shares G1's item model, room layout and look-alike design, and it was written by the same team as the radar. It is a stronger out-of-sample check than G1, not field data.
- **The G2 misses are real.** Leak buyers who pace themselves at 2.5× sit inside G2's heavier fast tail, so signal 1 recall falls to 0.59. The staggered 60-min mid-exam leak reaches each candidate's items late, so 30% of mid-exam recipients are missed (most likely too few of their fast-and-correct answers fall after the detected change point). Ring recall falls to 0.77 with 80% copying.
- **Signal 3 needs density.** One cell has only one room's answers (~67), so a leak shows up only when several people in that room have it. In the 2k test cohort, 6 mid-exam recipients per room are invisible to it. The tests therefore plant a dense mid-exam leak in an honest room.
- **Since A4, the decision engine's tier-1 test counts signal 1 OR signal 3 as leak evidence** (`policy.tier1.leakSignal`). See "Controller decision" in the A4 section for the effect on each golden case.

## Decision engine (A2 / M12)

```sh
uv run python -m saakshi_analytics.radar OUT/cohort.jsonl --key OUT/key.json --json OUT/flags.json   # optional
uv run python -m saakshi_analytics.decide --policy policy.illustrative.json \
    --incident golden/cuet-2026.incident.json --cohort OUT/cohort.jsonl [--flags OUT/flags.json] [--json report.json]
```

It prints the report and, with `--json`, writes it. The output is deterministic (no timestamps, sorted lists) and no LLM is involved. The report is advisory until a human signs it off, and nobody is penalised by it.

### Inputs

- **Cohort** (`--cohort`): the G1 cohort or the cells' export JSONL (frozen schema v1). Only `cand`, `centre` and `shift` are read. A *room* is one centre-shift, `CENTRE/SHIFT`.
- **Radar flags** (`--flags`, optional): the A1 radar output as written by `radar --json`, used unchanged.
- **Incident** (`--incident`). Every field is optional, and unknown candidates, centres or centre-shifts are rejected.

```jsonc
{
  "id": "CUET-2026 replay",
  "disruptions": [{"centre": "CEN002", "shift": "S1", "fromMin": 40, "toMin": 160}],  // window on the exam clock
  "gaps": {"C00012": [18], "C00354": [12, 10]},  // credited gaps (minutes) per candidate, from the M6 gap journal
  "left": ["C00137"],                              // left the centre, or cannot resume
  "breach": {                                      // omit when no breach is alleged
    "perimeter": ["CEN005", "CEN008/S2"],          // a centre (all its shifts) or one centre-shift; or "unknown"
    "systemic": false,                             // the committee's finding from outside evidence
    "evidence": "FIR ..."
  }
}
```

### Policy (`policy.illustrative.json`)

It is labelled **ILLUSTRATIVE**: every threshold is a committee parameter. The real file is signed (`signature` is null here) and published before the exam.

| Key | Value | Meaning |
|---|---|---|
| `gapCapMin` | 30 | Credited gaps up to this total are compensated; beyond it, the candidate is re-tested (§3.6) |
| `reviewGapCount` | 2 | Two or more gaps raise a review flag |
| `tier1.systemicRoomShare` | 0.5 | (a) holds if the breach is evidenced (perimeter ∪ rooms with radar leak flags) in at least this share of centre-shifts |
| `tier1.leakSignal` | `["speed-accuracy", "cusum"]` | The radar signals that mark leak beneficiaries (signal 1 OR signal 3, since A4). A single string still works |
| `tier1.maxLeakFlagShareOutsidePerimeter` | 0.1 | (b) holds if at most this share of leak flags falls outside the declared perimeter |
| `tier1.maxLeakedItemShare` | 0.1 | Re-score branch: a widespread leak of at most this share of the paper is dropped for everyone (A4) |
| `comparability` | δ ±0.05, α 0.05, N_min 30 | TOST margin on the post-disruption residual score, its α, and the smallest group tested (A4) |
| `scoring` | +4 / −1 | Marking scheme for re-scoring (A4) |
| `retest` | RT1, 08:30 | Re-test session printed on the mock admit cards (A4) |
| `cost.reexamPerCandidateInr` | 1500 | Illustrative per-candidate re-exam cost for "₹ avoided". Not an NTA figure |

### Rules

1. **Tier 1, the NEET-UG 2024 Supreme Court test.**
   - (a) *Systemic*: the committee declares it, **or** the perimeter is `"unknown"`, **or** the evidenced rooms reach `systemicRoomShare`.
   - (b) *Separable*: a perimeter is declared **and** the radar's leak flags stay inside it (at most `maxLeakFlagShareOutsidePerimeter` outside). With no flags, it rests on the declared perimeter.
   - Full re-conduct only when (a) holds and (b) does not. Otherwise only the perimeter's centre-shifts are re-conducted, and leak flags outside it are referred to the committee.
   - (c) Leak branch (A4): see "Leak branches" below. The one override is re-scoring: a widespread leak of at most 10% of the items is dropped for everyone, and nothing is re-conducted.
2. **Per candidate** (not in a re-conducted room):
   - Left, or cannot resume → re-test.
   - Credited gap within the cap → compensate, with extra time equal to the gap.
   - Beyond the cap → re-test. A candidate in a disrupted room with no journal entry is credited the whole window.
   - Two or more gaps, or any radar flag → human review.
3. **Spared and ₹ avoided.**
   - Spared = the candidates in the counterfactual who are not re-examined.
   - The counterfactual is a blanket re-exam of the disrupted rooms when there is no breach, and a full re-conduct of the cohort when there is one.
   - ₹ avoided = spared × `reexamPerCandidateInr`. The report prints this assumption.
4. **Evidence:** the sha256 of the policy, incident, cohort and flags files. The sign-off line stays `PENDING` until a human signs.

### Golden cases (`golden/`, on the G1 small cohort: seed 7, 2k candidates, 10 centres × 3 shifts)

| Case | Incident | Result |
|---|---|---|
| `cuet-2026` | 2-hour outage (40–160 min) at 3 centre-shifts (189 candidates). 21 left, 4 never resumed, 4 resumed after 45 min, 7 had two gaps, and the rest resumed on spare seats after 8–30 min. One unrelated 15-min seat gap elsewhere | Compensated 161 · Re-tested 29 · Re-conducted 0 centres · Spared 160 · ₹ avoided 2,40,000. 7 go to review |
| `neet-2024-separable` | Leak with a declared perimeter: CEN005, CEN009, CEN010 and CEN008/S2 (the G1 leak and mid-exam leak); not declared systemic. Radar flags supplied | (a) no: 10/30 rooms. (b) yes: 0/29 leak flags outside. No full re-conduct; 10 centre-shifts (682 candidates) are re-conducted. Spared 1,318 · ₹ avoided 19,77,000 |
| `systemic` | Paper on a public channel (declared systemic); the FIR names only CEN005. Radar flags supplied | (a) yes. (b) no: 20/29 leak flags fall outside. **Full re-conduct**, all 10 centres. Spared 0 |

Sample output (`cuet-2026`, lists trimmed):

```
SAAKSHI DECISION REPORT: CUET-2026 replay
policy saakshi-decision-policy v1: ILLUSTRATIVE: every threshold here is a committee parameter, ...

Compensated 161 · Re-tested 29 · Re-conducted 0 centres · Spared 160 · ₹ avoided 2,40,000

Tier 1, the NEET-UG 2024 Supreme Court test (full re-conduct only if (a) systemic AND NOT (b) separable):
  no breach alleged: tier 1 does not apply
  => no full re-conduct
Re-conduct: 0 centre-shifts, 0 candidates
Compensate 161: extra time = credited gap, 8-30 min (total 3048 min); per-candidate list in --json
Re-test 29:
  C00137  left the centre or could not resume
  C00454  never resumed (no gap-journal entry), so the whole window 120 min is beyond the 30-min cap
  C00664  credited gap 45 min is beyond the 30-min cap
  ...
Human review 7 (nothing is auto-penalised):
  C00354  2 gaps (review at >= 2)
  ...
Assumptions:
  - ₹ avoided = spared × ₹1,500 per candidate re-exam, from policy.cost. Illustrative marginal cost ... Not an NTA figure.
  - spared = candidates in the counterfactual who are not re-examined; counterfactual = a blanket re-exam of every candidate in the disrupted centre-shifts
  - credited gaps come from the M6 gap journal; ...
Evidence (sha256):
  policy    7aa6c174...
  incident  0b5ec76e...
  cohort    4ce16872...
Human sign-off: PENDING  name / role / date: ______________
```

### Decision-engine caveats

- **Separability is a proxy.** It rests on the declared perimeter plus the radar's leak flags, whose recall is about 0.85. It says the known beneficiaries sit inside the perimeter; it cannot prove that none sit outside it.
- **The ₹ figure is only as good as `cost.reexamPerCandidateInr`,** and the counterfactual is stated in the report.

## A4 (S2): decision hardening

```sh
uv run python -m saakshi_analytics.decide --policy policy.illustrative.json \
    --incident golden/cuet-2026.incident.json --cohort OUT/cohort.jsonl \
    --key OUT/key.json --centres centres.mock.json --tickets golden/tickets.jsonl \
    --admit-cards cards.txt [--flags OUT/flags.json] [--json report.json]
```

Each new input is optional. The M12 report is unchanged without them.

- `--key` loads the responses and turns on comparability and re-scoring.
- `--centres` turns on the re-test allocator.
- `--tickets` lists the open dispute tickets.
- Every file passed is hashed into the evidence block.

### What S2 adds

- **Comparability (TOST).** Each compensated centre-shift is one group.
  - Per candidate, the residual score is the mean of (correct − P(correct | item, ability decile)) over the items first answered after the disruption began. The decile and P come from the radar's `features`.
  - The group is compared with every undisturbed candidate on the same items and window, using two one-sided Welch t-tests with margin ±0.05 (5 points of proportion correct) and α 0.05.
  - The result is *equivalent* when both one-sided tests reject.
  - A group smaller than `N_min` = 30, or one that is *not equivalent*, goes to the committee. Nothing is automatic.
- **Leak branches** (tier-1 reason (c)):

  | Situation | Branch | Action |
  |---|---|---|
  | Not systemic | `localised` | Re-conduct the perimeter's centre-shifts |
  | Systemic, `breach.items` declared and ≤ 10% of the paper | `rescore` | Re-score everyone without those items; nothing is re-conducted |
  | Systemic and not separable (and no re-scorable item list) | `full` | Full re-conduct |
  | Systemic but separable | `separable` | Re-conduct the perimeter's centre-shifts |

  `breach.items` is the committee's list of leaked items (for example, the items on the leaked copy). With items but no `--key`, the engine refuses to run.
- **Scoring.**
  - Raw = +4 per correct and −1 per wrong (`policy.scoring`).
  - Equating is NTA-style percentile normalisation *within each shift*: 100 × (number in the shift with raw ≤ yours) / shift size.
  - The re-test session is percentile-normalised within itself, as stated on each admit card.
- **Re-test allocator** (greedy).
  - PwD candidates go first, then the rest by id.
  - Each candidate takes the nearest centre (from their home centre) that has a spare seat, offers their language, and has PwD access if they need it.
  - If no centre qualifies, the candidate goes to the committee.
  - Centre locations (a km grid), spare seats, access and languages are mocked in `centres.mock.json`.
  - The output is the roster (in the report and the JSON) plus mock text admit cards (`--admit-cards`), each with a short integrity hash.
- **Dispute tickets.**
  - A candidate's "raise objection" calls `decide.objection(cand, item, receipt, reason)`.
  - It returns `{"ticket": "OBJ-<hash[:10]>", "cand", "item", "receipt", "reason", "status": "open", "hash"}`, where `hash` = sha256 of the canonical JSON of cand, item, receipt and reason.
  - The engine lists every open ticket and re-checks its hash (`hash ok` / `HASH MISMATCH`). A ticket for an unknown candidate is rejected.
  - `golden/tickets.jsonl` holds two examples.
- **Report line** kept verbatim: `Compensated N · Re-tested M · Re-conducted K centres · Spared S · ₹ avoided`. JSON `summary` also has `rescored` and `openTickets`.

### Full decision report: CUET-2026 replay with roster, comparability and tickets (G1 small cohort, seed 7)

```
SAAKSHI DECISION REPORT: CUET-2026 replay
policy saakshi-decision-policy v1: ILLUSTRATIVE: every threshold here is a committee parameter, ...

Compensated 161 · Re-tested 29 · Re-conducted 0 centres · Spared 160 · ₹ avoided 2,40,000

Tier 1, the NEET-UG 2024 Supreme Court test (full re-conduct only if (a) systemic AND NOT (b) separable):
  no breach alleged: tier 1 does not apply
  => no full re-conduct
Re-conduct: 0 centre-shifts, 0 candidates
Compensate 161: extra time = credited gap, 8-30 min (total 3048 min); per-candidate list in --json
Re-test 29:
  C00137  left the centre or could not resume
  ... (29 rows, as in A2)
Re-test roster (29; greedy: PwD first, nearest centre with a seat, language, access):
  cand     from    -> to       km    lang pwd
  C00137  CEN007 -> CEN008   15.6  hi   no
  C00200  CEN002 -> CEN002    0.0  hi   no
  C00220  CEN004 -> CEN004    0.0  en   no
  C00454  CEN007 -> CEN007    0.0  en   no
  C00487  CEN007 -> CEN007    0.0  en   no
  C00542  CEN002 -> CEN002    0.0  en   no
  C00603  CEN004 -> CEN004    0.0  en   no
  C00664  CEN004 -> CEN004    0.0  en   no
  C00760  CEN002 -> CEN002    0.0  hi   no
  C00796  CEN007 -> CEN006   18.7  ta   no
  C00863  CEN004 -> CEN004    0.0  en   no
  C00954  CEN004 -> CEN004    0.0  en   no
  C01020  CEN002 -> CEN002    0.0  hi   no
  C01115  CEN004 -> CEN005   14.4  en   no
  C01160  CEN002 -> CEN001    8.5  en   no
  C01291  CEN007 -> CEN007    0.0  en   no
  C01312  CEN004 -> CEN005   14.4  en   no
  C01329  CEN002 -> CEN001    8.5  hi   no
  C01352  CEN007 -> CEN008   15.6  en   no
  C01396  CEN002 -> CEN001    8.5  en   no
  C01519  CEN007 -> CEN008   15.6  en   no
  C01529  CEN004 -> CEN005   14.4  hi   no
  C01545  CEN002 -> CEN001    8.5  en   no
  C01739  CEN007 -> CEN008   15.6  en   no
  C01782  CEN004 -> CEN005   14.4  en   no
  C01938  CEN007 -> CEN008   15.6  en   no
  C01955  CEN004 -> CEN005   14.4  en   no
  C01962  CEN002 -> CEN001    8.5  hi   no
  C01964  CEN007 -> CEN008   15.6  en   no
Comparability (TOST on post-disruption residual scores):
  CEN001/S3  n=1    from 0 min: committee (n = 1 < N_min = 30)
  CEN002/S1  n=55   from 40 min: equivalent (diff -0.011, p 4.9e-05)
  CEN004/S1  n=55   from 40 min: equivalent (diff +0.004, p 1.6e-10)
  CEN007/S1  n=50   from 40 min: equivalent (diff -0.007, p 1.8e-05)
Human review 7 (nothing is auto-penalised):
  C00354  2 gaps (review at >= 2)
  C00672  2 gaps (review at >= 2)
  C00720  2 gaps (review at >= 2)
  C01131  2 gaps (review at >= 2)
  C01424  2 gaps (review at >= 2)
  C01649  2 gaps (review at >= 2)
  C01844  2 gaps (review at >= 2)
Open dispute tickets 2:
  OBJ-2eeaaefcd1  C00036 I07 receipt RC-2B91-E04D: After resuming on a spare seat my timer showed 15 minutes less than the credited gap  [hash ok]
  OBJ-3714f3e903  C00200 I12 receipt RC-7F3A-19C2: The Hindi text of I12 points to a different option than the English text  [hash ok]
Assumptions:
  - ₹ avoided = spared × ₹1,500 per candidate re-exam, from policy.cost. ...
  - spared = candidates in the counterfactual who are not re-examined; counterfactual = a blanket re-exam of every candidate in the disrupted centre-shifts
  - credited gaps come from the M6 gap journal; a candidate in a disrupted centre-shift with no journal ...
  - comparability: TOST (two one-sided Welch t-tests) on post-disruption residual scores, each compensated centre-shift vs every undisturbed candidate, margin ±0.05, alpha 0.05; groups under N_min = 30 go to the committee
  - re-test seats: greedy, PwD first, nearest centre with a spare seat, the candidate's language and access (mock centre fixture); re-test scores are percentile-normalised within the re-test session
Evidence (sha256): policy, incident, cohort, key, centres, tickets
Human sign-off: PENDING  name / role / date: ______________
```

Notes on this report:

- All 29 re-test candidates get a seat. Home centres fill first: CEN007 has only 3 spare seats, so the other English-medium candidates move 15.6 km to CEN008.
- C00137 (Hindi) moves because CEN007 has no Hindi medium. C00796 (Tamil) goes to CEN006, the nearest Tamil centre.
- No re-test candidate in this case is PwD. The PwD-first rule is pinned by `test_allocator_is_greedy_nearest_with_seats_pwd_and_language`.
- The one unrelated 15-min seat gap (CEN001/S3, n = 1) is below N_min, so it goes to the committee.
- All three disrupted rooms pass TOST: the synthetic cohort has no real disruption effect. `test_comparability_catches_a_group_that_was_hurt_after_the_disruption` doctors CEN002/S1 (every post-40-min correct answer made wrong) and checks that the room turns *not equivalent* while the others stay *equivalent*.

One mock admit card:

```
==== SAAKSHI RE-TEST ADMIT CARD (MOCK) ====
Candidate   C00137
Session     RT1 (illustrative date) · report by 08:30
Centre      CEN008 · Mock Centre 8 (illustrative)
Travel      15.6 km from CEN007
Medium      hi
PwD         no
Scoring     percentile-normalised within the re-test session
Card hash   28d44927eb7c8c23
```

### Golden case `rescore-items` (new)

- **Incident:** 10 items (I02 … I56, half of G1's leaked set) circulated on a public channel an hour before the exam. The perimeter is unknown and the leak is declared systemic.
- **Result:** 10/100 = 10% ≤ 10%, so the **re-score** branch applies.
- **Headline:** Compensated 0 · Re-tested 0 · Re-conducted 0 centres · Spared 2000 · ₹ avoided 30,00,000. The same incident with 11 items goes to full re-conduct (`test_leak_branches`).
- **Effect on scores:**
  - The 30 G1 leak buyers drop **−9.4 percentile points** on average.
  - Everyone else moves **+0.17** on average (median |Δ| 1.3, which is equating noise).
  - The largest single drop is −13.9.

### Controller decision: tier-1 leak evidence = signal 1 OR signal 3

`policy.tier1.leakSignal` is now `["speed-accuracy", "cusum"]`, because signal 3 is the item-leak detector. The table shows the effect on each golden case (2k G1 cohort, radar at its default thresholds, flags supplied).

| Case | Before (signal 1 only) | After (signal 1 or 3) | Effect |
|---|---|---|---|
| `cuet-2026` | no breach; 161 / 29 / 0 / 160 | identical | None: tier 1 does not apply |
| `neet-2024-separable` | (a) no, 10/30; (b) yes, 0/29 outside; re-conduct 10 centre-shifts, spared 1318 | identical, (b) now reads "0/29 radar speed-accuracy or cusum flags" | None |
| `systemic` | (a) yes; (b) no, 20/29 outside; full re-conduct | identical, 20/29 | None |
| `rescore-items` | perimeter unknown; re-score | identical | None: an unknown perimeter uses no flags |

- **Why nothing moves:** on the 2k cohort the radar raises **0** signal-3 flags. It raises 29 signal-1 and 24 signal-2 flags. At 2k a cell holds about 67 answers, and the leak is too sparse per room for the CUSUM (see the A3 caveat "Signal 3 needs density"). So the leak-flag set is the same under both policies.
- **Where the change does bite:** `test_cusum_flags_now_count_towards_separability` shows CUSUM-only flags outside the perimeter now make (b) fail. `test_a_single_string_leak_signal_still_works` shows they did not count under the old policy.
- **At 20k (not run as a golden case):** signal 3 catches the mid-exam leak that signal 1 half-misses (A3). Those extra flags sit inside the NEET perimeter (CEN008/S2 in the 2k layout), which would strengthen (b) rather than break it. This is an expectation, not a measurement.

## A4 (S4): predicted centre risk and the scorecard

```sh
uv run python -m saakshi_analytics.scorecard [--centres 10] [--seed 7] [--telemetry drill.json] [--json scorecard.json]
```

- **Synthetic centre histories** (`scorecard.simulate(n, seed)`).
  - Each centre has four latent fragilities: network, power, disk and management.
  - They drive both its T−1 mock-drill telemetry and whether it has an exam-day incident.
  - The telemetry is heartbeat jitter p95 (ms), UPS/battery backup (min), free disk (%), and past incidents in the last 5 exams.
  - The telemetry is noisy, and incidents are Bernoulli: any cause can fire.
- **Model.** Logistic regression (L2, scipy BFGS) on standardised, risk-ward features. It is fitted on 4,000 histories (seed 1).
  - The top 3 reasons for a centre are its three largest per-feature contributions w·z, each shown against the fleet median.
- **Scorecard.** The ranking puts P ≥ 0.5 at **do not allot**, P ≥ 0.2 at **add observer**, and the rest at **allot**. These are illustrative committee cut-offs.
  - `scorecard.claude_note_hook(row)` is the named hook for Claude's explanatory note (S3: aggregated, pseudonymous facts only). No LLM is called; it returns template text, and `scorecard(model, telemetry, note=...)` swaps it.
- **`--telemetry`** scores real drill telemetry, given as a JSON list of `{centre, jitterMs, upsMin, diskFreePct, pastIncidents}`, instead of the synthetic fleet.

### Risk-model precision (fitted on seed 1, measured on 4,000 independent histories, seed 2)

| Label | Centres | Later had an incident | Precision | Recall | Lift over base rate 0.138 |
|---|---|---|---|---|---|
| At risk (P ≥ 0.2: add observer or worse) | 787 | 228 | **0.290** | 0.413 | 2.1× |
| Do not allot (P ≥ 0.5) | 44 | 23 | **0.523** | 0.042 | 3.8× |

The tests assert precision ≥ 1.8× the base rate and ≥ 0.25, and that the stricter label is the more precise.

### Scorecard sample (synthetic fleet, seed 7, 10 centres; notes shown for the first row only)

```
SAAKSHI CENTRE SCORECARD (predicted risk from T-1 mock-drill telemetry; ILLUSTRATIVE cut-offs)
do not allot at P >= 50% · add observer at P >= 20% · otherwise allot

  1. CEN005  risk 23.2%  ADD OBSERVER
       raises risk: 2 incident(s) in the last 5 exams (fleet median 0)
       raises risk: heartbeat jitter p95 43 ms (fleet median 30)
       raises risk: UPS/battery backup 35 min (fleet median 40)
       note: CEN005 is ranked 1 with predicted incident risk 23%: add observer. Main drivers: ...
  2. CEN002  risk 18.2%  ALLOT
       raises risk: UPS/battery backup 28 min (fleet median 40)
       raises risk: 1 incident(s) in the last 5 exams (fleet median 0)
       raises risk: heartbeat jitter p95 33 ms (fleet median 30)
  3. CEN008  risk 17.3%  ALLOT
       raises risk: heartbeat jitter p95 65 ms (fleet median 30)
       raises risk: 2 incident(s) in the last 5 exams (fleet median 0)
       lowers risk: disk free 74% (fleet median 55%)
  ...
 10. CEN009  risk  2.2%  ALLOT
       raises risk: disk free 42% (fleet median 55%)
       lowers risk: 0 incident(s) in the last 5 exams (fleet median 0)
       lowers risk: heartbeat jitter p95 18 ms (fleet median 30)

Risk-model precision (fitted on 4000 synthetic centre-histories, seed 1; measured on 4000 independent ones, seed 2; base rate 0.138):
  at risk (P >= 20%): 787 centres, 228 later had an incident -> precision 0.290, recall 0.413 (lift 2.1x)
  do not allot (P >= 50%): 44 centres, 23 later had an incident -> precision 0.523, recall 0.042 (lift 3.8x)
```

### A4 caveats

- **The risk model and its histories come from the same author**, just as G1 and the radar do. Precision 0.29 is a model result on a generator whose noise levels we chose. It shows that the pipeline and the lift work, not a field precision.
- **Comparability has no real disruption to find** in the synthetic cohort. It is exercised by the doctored-room test. The ±0.05 margin is a committee parameter.
- **Re-scoring trusts the committee's item list.** The radar does not yet name the leaked items per flag, so `breach.items` is declared, not inferred.
- **The allocator is greedy, not optimal.** An early candidate can take a seat that a later one needed more. PwD-first ordering covers the scarce-access case; a min-cost assignment would be the upgrade. It also sends candidates back to the centre that had the outage (the re-test is another day).
- **Tier-1 with signal 3 changes nothing on the 2k golden cases** (above). Its effect is shown only by the unit tests.
