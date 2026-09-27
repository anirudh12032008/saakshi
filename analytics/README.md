# saakshi-analytics: G1/G2 generators, radar (A1 / M11, A3 / S1) and thin decision engine (A2 / M12)

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
- **The decision engine's tier-1 test still reads only `speed-accuracy` as the leak signal** (`policy.tier1.leakSignal`). Signal 3 flags go to human review like any other flag, but they don't yet count towards (a) or (b).

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
| `tier1.leakSignal` | `speed-accuracy` | The radar signal that marks leak beneficiaries |
| `tier1.maxLeakFlagShareOutsidePerimeter` | 0.1 | (b) holds if at most this share of leak flags falls outside the declared perimeter |
| `cost.reexamPerCandidateInr` | 1500 | Illustrative per-candidate re-exam cost for "₹ avoided". Not an NTA figure |

### Rules

1. **Tier 1, the NEET-UG 2024 Supreme Court test.**
   - (a) *Systemic*: the committee declares it, **or** the perimeter is `"unknown"`, **or** the evidenced rooms reach `systemicRoomShare`.
   - (b) *Separable*: a perimeter is declared **and** the radar's leak flags stay inside it (at most `maxLeakFlagShareOutsidePerimeter` outside). With no flags, it rests on the declared perimeter.
   - Full re-conduct only when (a) holds and (b) does not. Otherwise only the perimeter's centre-shifts are re-conducted, and leak flags outside it are referred to the committee.
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
| `neet-2024-separable` | Leak with a declared perimeter: CEN005, CEN009, CEN010 and CEN008/S2 (the G1 leak and mid-exam leak); not declared systemic. Radar flags supplied | (a) no: 10/30 rooms. (b) yes: 0/29 leak flags outside. No full re-conduct; 10 centre-shifts (682 candidates) are re-conducted. Spared 1318 · ₹ avoided 19,77,000 |
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
- **Leak branches are not built yet.** Re-scoring without leaked items, TOST comparability and the re-test allocator are S2 (A4). A separable breach here always re-conducts its perimeter.
- **The ₹ figure is only as good as `cost.reexamPerCandidateInr`,** and the counterfactual is stated in the report.
