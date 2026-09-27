# saakshi-analytics: G1 generator and thin radar (A1 / M11)

## Generate a cohort

```sh
cd analytics
uv run python -m saakshi_analytics.generate OUT            # 20k candidates, 100 centres, seed 7
uv run python -m saakshi_analytics.generate OUT --n 2000 --centres 10 --seed 3
```

This writes three files:

- `OUT/cohort.jsonl`: one row per candidate × item, following the frozen `fixtures/schemas/v1.json`. The full run is 2M rows (about 350 MB).
- `OUT/key.json`: the answer key. I01–I20 are the demo paper (`fixtures/paper/key.json`); I21–I100 are seeded. F2 is F1 in reverse order.
- `OUT/truth.json`: what was planted (the leak, the mid-exam leak, the rings and the look-alikes). **None of it appears in the cohort rows.**

The generator is deterministic for a given seed.

## Run the radar

```sh
uv run python -m saakshi_analytics.radar OUT/cohort.jsonl --key OUT/key.json [--truth OUT/truth.json]
```

- It prints every flag with its reason, observed vs expected, and p-value.
- With `--truth`, it adds precision, recall and FPR per signal, plus flag rates for the look-alike groups.
- It also reads the cells' export rows (the cohort fields plus `seq/rxWall/h`); the extra fields are ignored.
- **Nothing is auto-penalised:** 1 signal → `watch`, 2 signals → `review`. The "escalate" rung needs device or camera evidence, which A1 doesn't have.

## Tests

- `uv run pytest -q` runs everything, including the one full 20k test (`-m full`).
- `uv run pytest -q -m "not full"` runs only the fast suite (2k candidates).

## Signals

| # | What | Test | Threshold |
|---|---|---|---|
| 1 | Speed–accuracy residual. Among a candidate's *fast* answers (log-time residual < −2 robust sd, after removing item time intensity and the candidate's own pace) on *hard* items (expected P(correct) ≤ 0.8 for their ability decile), count the correct ones | Exact Poisson-binomial tail | p ≤ 1e-5 |
| 2 | Identical wrong answers for every same-room (centre+shift) pair, vs the expectation from per-decile, per-item distractor rates. Rapid responses are left out on both sides. networkx connected components → rings | Exact Poisson-binomial (after a Poisson pre-screen at 1e-3), Bonferroni over **all** same-room pairs in the cohort (665,768 at 20k) | p_adj ≤ 0.01 |

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

## Results: full G1 run (seed 7, 20k candidates, via JSONL)

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

- **The radar and G1 share assumptions.** Both use conditional independence of speed and accuracy, and distractor pull that is the same within a decile. G1 is a calibration set, not independent evidence; the independent G2 comes in A3. The 0% FPR is a model result, not a field result.
- **The thresholds are strict.** The most extreme honest candidate reaches p ≈ 1e-3 on signal 1, against the 1e-5 bar. The price of that strictness is below.
- **Strong cheaters are hard to catch.** A leak gives little to someone who could solve most items anyway. A ring of strong students shares few *wrong* answers. We therefore plant cheaters at θ ≈ −0.6 and draw the leak from the tougher half. During tuning, with leaked items drawn uniformly and buyers at average ability, leak recall was 0.3–0.5; that was measured with an earlier ability estimate, not the final one.
- **The mid-exam leak is only partly caught (~0.6).** Signal 1 sees only the ~half of leaked items reached after the leak lands. The S1 CUSUM per item × centre × shift (A3) is the tool for this.
- **No `review` flags in G1.** No planted candidate trips both signals, and there is no device or camera evidence yet.
- **Answer key.** The radar needs the answer key as a separate input (`--key`); it isn't part of the frozen row schema.
- **Wall clock.** The 20k JSONL run uses about 18 s of CPU. On a heavily loaded machine the wall clock can be several minutes.
