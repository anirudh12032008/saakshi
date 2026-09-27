"""G1 synthetic cohort: 3PL items, lognormal response times, honest look-alikes, planted cheating.

python -m saakshi_analytics.generate OUT [--n 20000] [--centres 100] [--seed 7] [--profile G1|G2]
writes OUT/cohort.jsonl (frozen schema v1), OUT/key.json (answer key), OUT/truth.json (what was planted),
OUT/registry.json (mock APAAR-keyed registry of past percentiles, for history corroboration).
Deterministic per seed. Ground truth never goes into the cohort rows.
G2 is the independent evaluation cohort: different response-time distribution and different cheater pacing.
"""

import argparse
import hashlib
import json
import pathlib

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[3]
STATES = ["NV", "NA", "A", "MR", "AMR"]  # index = state code
OPTS = "ABCD"
M = 100  # items I01..I100; I01..I20 are the demo paper
N_FULL = 20000

# Effect sizes (documented in README). Tuned to be realistic but detectable.
C_GUESS = 0.2  # 3PL lower asymptote
SIGMA_T = 0.35  # sd of log response time
HI_SLOW, PWD_SLOW = 1.15, 1.5  # Hindi-medium read slower; PwD get extra time and use it
LEAK_SPEEDUP = 4.0  # leaked items answered 4x faster than the candidate's own pace
LEAK_ACC = 0.95  # leaked key is followed (and remembered) 95% of the time
LEAK_N, MID_N = 300, 60  # per 20k candidates
CHEAT_THETA = -0.6  # mean ability of leak buyers and ring members (cohort: mean 0, sd 1)
MID_LEAK_S = 45 * 60  # mid-exam leak lands 45 min in (typical pace: ~100 min for the paper)
COPY_FRAC = 0.9  # copiers take the source's response on 90% of items (answers relayed in the room)
RAPID_TAIL = 0.35  # rapid guessers click through the last 35% of their form
RAPID_S = 6.0  # ~6 s per rapid guess
MISTRANSLATED = "I12"  # Hindi text of I12 points to a wrong option half the time
HISTORY_FRAC = 0.4  # share of candidates with a prior attempt in the registry (all improvers have one)

# G1 = the calibration cohort (the constants above). G2 = the independent evaluation cohort, fixed a priori:
# gamma response times (log-sd ~0.47, heavier fast tail than G1's lognormal 0.35) with a time-pressure drift
# (everyone speeds up through the exam), and cheaters who pace themselves: per-leaker speedup U(2.5, 4.5),
# a mid-exam leak that lands at 60 min and reaches each recipient over the next 20 min, looser copying.
PROFILES = {
    "G1": {"rt": "lognormal", "drift": 0.0, "speedup": (LEAK_SPEEDUP, LEAK_SPEEDUP), "acc": LEAK_ACC,
           "midAtS": MID_LEAK_S, "midSpreadS": 0, "copyFrac": COPY_FRAC},
    "G2": {"rt": "gamma(k=5)", "drift": 0.25, "speedup": (2.5, 4.5), "acc": 0.9,
           "midAtS": 60 * 60, "midSpreadS": 20 * 60, "copyFrac": 0.8},
}


def generate(n=N_FULL, n_centres=100, seed=7, profile="G1"):
    pr = PROFILES[profile]
    rng = np.random.default_rng(seed)
    items = [f"I{j + 1:02d}" for j in range(M)]
    paper = json.loads((ROOT / "fixtures/paper/key.json").read_text())
    key = np.array([OPTS.index(paper[i]) if i in paper else rng.integers(4) for i in items])

    a, b = rng.lognormal(0, 0.25, M), rng.normal(0, 1, M)
    beta = np.log(60) + 0.3 * b + rng.normal(0, 0.2, M)  # item time intensity, log seconds
    distract = rng.dirichlet([1, 1, 1], M)  # attractiveness of the 3 wrong options

    centre = rng.integers(n_centres, size=n)
    shift = rng.integers(3, size=n)
    form = rng.integers(2, size=n)
    p_hi = np.where(centre < 0.3 * n_centres, 0.7, 0.15)  # 30% of centres are Hindi-belt
    u = rng.random(n)
    lang = np.where(u < p_hi, "hi", np.where(u < p_hi + 0.1, "ta", "en"))
    pwd = (rng.random(n) < 0.03).astype(int)
    theta = rng.normal(0, 1, n)
    tau = rng.normal(0, 0.25, n) - np.log(HI_SLOW) * (lang == "hi") - np.log(PWD_SLOW) * pwd

    # --- who is planted / who is a look-alike (disjoint) ---
    free = np.ones(n, bool)
    cs = rng.permutation(n_centres)
    leak_centres, mid_centre = cs[:3], cs[3]
    pool = np.flatnonzero(np.isin(centre, leak_centres))
    leak = rng.choice(pool, min(len(pool), round(LEAK_N * n / N_FULL)), replace=False)
    free[leak] = False
    mid_shift = rng.integers(3)
    pool = np.flatnonzero((centre == mid_centre) & (shift == mid_shift))
    mid = rng.choice(pool, min(len(pool), max(5, round(MID_N * n / N_FULL))), replace=False)
    free[mid] = False
    leak_items = np.sort(rng.choice(np.argsort(b)[-40:], 20, replace=False))  # leaked solutions skew to the tough half

    rooms = [(c, s) for c in cs[4:] for s in range(3)]
    rings = []
    for r in rng.choice(len(rooms), 6, replace=False):
        c, s = rooms[r]
        pool = np.flatnonzero((centre == c) & (shift == s) & free)
        members = rng.choice(pool, rng.integers(3, 6), replace=False)
        free[members] = False
        rings.append((c, s, members))
    cheats = np.flatnonzero(~free)
    theta[cheats] = rng.normal(CHEAT_THETA, 0.8, len(cheats))  # those who cheat skew weaker

    def pick(frac):
        got = rng.choice(np.flatnonzero(free), round(frac * n), replace=False)
        free[got] = False
        return got

    rapid, flyers, improvers = pick(0.02), pick(0.01), pick(0.02)
    theta[flyers] = rng.normal(2.8, 0.2, len(flyers))
    tau[flyers] += 0.3
    past = theta[improvers].copy()
    theta[improvers] += 0.8  # genuine gain since their last attempt
    past_pct = [round(100 * float((theta < t).mean()), 1) for t in past]

    # --- honest responses ---
    P = C_GUESS + (1 - C_GUESS) / (1 + np.exp(-1.7 * a * (theta[:, None] - b)))
    correct = rng.random((n, M)) < P
    wrong_k = (rng.random((n, M, 1)) > np.cumsum(distract, 1)[None]).sum(-1).clip(max=2)  # 0..2
    answer = np.where(correct, key, (key + 1 + wrong_k) % 4)
    mt = items.index(MISTRANSLATED)
    mt_opt = (key[mt] + 1) % 4
    hit = (lang == "hi") & (rng.random(n) < 0.5)
    answer[hit, mt] = mt_opt

    state = np.full((n, M), 2)
    omit = (P < 0.35) & (rng.random((n, M)) < 0.3)  # skip what you can't do (negative marking)
    state[omit] = np.where(rng.random(omit.sum()) < 0.3, 3, 1)
    state[rng.random((n, M)) < 0.005] = 0
    state[(state == 2) & (rng.random((n, M)) < 0.05)] = 4
    pos = np.where(form[:, None] == 0, np.arange(M), M - 1 - np.arange(M))  # F2 is F1 reversed
    if pr["rt"] == "lognormal":
        logt = beta - tau[:, None] + rng.normal(0, SIGMA_T, (n, M))
    else:  # G2: gamma(5) multiplicative noise, and a time-pressure drift that speeds everyone up late in the form
        logt = beta - tau[:, None] + np.log(rng.gamma(5.0, 1 / 5.0, (n, M))) - pr["drift"] * pos / M
    tail = np.isin(np.arange(n), rapid)[:, None] & (pos >= (1 - RAPID_TAIL) * M)
    logt[tail] = np.log(RAPID_S) + rng.normal(0, 0.3, tail.sum())
    answer[tail] = rng.integers(4, size=tail.sum())
    state[tail] = 2

    speed = np.full(n, pr["speedup"][0])
    if pr["speedup"][0] != pr["speedup"][1]:
        speed[cheats] = rng.uniform(*pr["speedup"], len(cheats))

    def use_leak(rows, cols_mask):
        sel = np.zeros((n, M), bool)
        sel[rows] = cols_mask[rows] if cols_mask.ndim == 2 else cols_mask
        sel &= np.isin(np.arange(M), leak_items)
        follow = rng.random(sel.sum()) < pr["acc"]
        answer[sel] = np.where(follow, key[np.nonzero(sel)[1]], rng.integers(4, size=sel.sum()))
        state[sel] = 2
        logt[sel] -= np.log(speed[np.nonzero(sel)[0]])

    use_leak(leak, np.ones(M, bool))
    # mid-exam leak: only items reached after the leak lands (honest pacing up to then)
    t_end = timeline(np.exp(logt), state, pos)
    lands = pr["midAtS"] + (rng.uniform(0, pr["midSpreadS"], (n, 1)) if pr["midSpreadS"] else 0)
    use_leak(mid, t_end - np.exp(logt) > lands)

    for _, _, members in rings:
        src = members[0]
        for cp in members[1:]:
            take = rng.random(M) < pr["copyFrac"]
            answer[cp, take], state[cp, take] = answer[src, take], state[src, take]

    # --- derived fields ---
    dwell = np.rint(np.exp(logt) * 1000).astype(int)
    answered = (state == 2) | (state == 4)
    answer = np.where(answered, answer, -1)
    dwell[state == 0] = 0
    visits = np.where(state == 0, 0, 1 + (state >= 3) + rng.poisson(0.2, (n, M)))
    changes = np.where(answered, rng.poisson(0.15, (n, M)), 0)
    tfirst = np.where(answered, np.rint(timeline(dwell, state, pos)).astype(int), -1)

    ids = np.array([f"C{i + 1:05d}" for i in range(n)])
    cohort = {
        "cand": ids, "centre": np.array([f"CEN{c + 1:03d}" for c in centre]),
        "shift": np.array([f"S{s + 1}" for s in shift]), "form": np.array(["F1", "F2"])[form],
        "lang": lang, "pwd": pwd, "items": np.array(items), "key": key,
        "state": state, "answer": answer, "dwell": dwell, "visits": visits, "changes": changes, "tfirst": tfirst,
    }
    room = lambda c, s: {"centre": f"CEN{c + 1:03d}", "shift": f"S{s + 1}"}
    truth = {
        "seed": seed, "n": n,
        "effects": {"profile": profile, "rt": pr["rt"], "rtDrift": pr["drift"], "leakSpeedup": list(pr["speedup"]),
                    "leakAcc": pr["acc"], "cheatTheta": CHEAT_THETA, "copyFrac": pr["copyFrac"],
                    "midLeakAtS": pr["midAtS"], "midLeakSpreadS": pr["midSpreadS"],
                    "rapidTail": RAPID_TAIL, "hiSlow": HI_SLOW, "pwdSlow": PWD_SLOW},
        "leak": {"items": [items[j] for j in leak_items], "centres": [f"CEN{c + 1:03d}" for c in leak_centres],
                 "cands": ids[np.sort(leak)].tolist()},
        "midLeak": room(mid_centre, mid_shift) | {"tLeakMs": pr["midAtS"] * 1000, "cands": ids[np.sort(mid)].tolist()},
        "rings": [room(c, s) | {"source": ids[m[0]], "members": ids[m].tolist()} for c, s, m in rings],
        "lookalikes": {
            "rapid": ids[np.sort(rapid)].tolist(), "flyers": ids[np.sort(flyers)].tolist(),
            "improvers": [{"cand": ids[i], "pastPct": p} for i, p in zip(improvers, past_pct)],
            "mistranslated": {"item": MISTRANSLATED, "lang": "hi", "option": OPTS[mt_opt]},
        },
    }
    # --- mock history registry (drawn last, so the cohort stream above is unchanged) ---
    prior = rng.random(n) < HISTORY_FRAC
    prior[improvers] = False
    past_theta = theta[prior] + rng.normal(0, 0.3, prior.sum())  # true ability then, measured with noise
    past = dict(zip(ids[prior], (round(100 * float((theta < t).mean()), 1) for t in past_theta)))
    past |= {ids[i]: p for i, p in zip(improvers, past_pct)}
    truth["registry"] = {"apaar": {c: apaar(c, seed) for c in sorted(past)},
                         "pastPct": {apaar(c, seed): p for c, p in sorted(past.items())}}
    return cohort, {i: OPTS[k] for i, k in zip(items, key)}, truth


def apaar(cand, seed):
    """Mock 12-digit APAAR id. The registry knows candidates only by APAAR; the admit card links the two."""
    return str(int(hashlib.sha256(f"{seed}:{cand}".encode()).hexdigest(), 16) % 10**12).zfill(12)


def timeline(dwell, state, pos):
    """Clock at the end of each item's dwell, walking the candidate's form order."""
    order = np.argsort(pos, 1)
    d = np.take_along_axis(np.where(state == 0, 0, dwell), order, 1)
    out = np.empty(dwell.shape)
    np.put_along_axis(out, order, np.cumsum(d, 1), 1)
    return out


def write_jsonl(c, path):
    with open(path, "w") as f:
        for i in range(len(c["cand"])):
            head = (f'{{"cand":"{c["cand"][i]}","centre":"{c["centre"][i]}","shift":"{c["shift"][i]}",'
                    f'"form":"{c["form"][i]}","lang":"{c["lang"][i]}","pwd":{c["pwd"][i]},')
            st, an, dw, vi, ch, tf = (c[k][i].tolist() for k in ("state", "answer", "dwell", "visits", "changes", "tfirst"))
            f.writelines(
                f'{head}"item":"{it}","state":"{STATES[st[j]]}","answer":"{OPTS[an[j]] if an[j] >= 0 else ""}",'
                f'"dwellMs":{dw[j]},"visits":{vi[j]},"changes":{ch[j]},"tFirstMs":{tf[j]}}}\n'
                for j, it in enumerate(c["items"])
            )


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("out")
    ap.add_argument("--n", type=int, default=N_FULL)
    ap.add_argument("--centres", type=int, default=100)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--profile", choices=sorted(PROFILES), default="G1")
    args = ap.parse_args(argv)
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    cohort, key, truth = generate(args.n, args.centres, args.seed, args.profile)
    (out / "registry.json").write_text(json.dumps(truth.pop("registry")))
    write_jsonl(cohort, out / "cohort.jsonl")
    (out / "key.json").write_text(json.dumps(key, indent=0))
    (out / "truth.json").write_text(json.dumps(truth, indent=1))
    print(f"wrote {len(cohort['cand'])} candidates x {M} items to {out}")


if __name__ == "__main__":
    main()
