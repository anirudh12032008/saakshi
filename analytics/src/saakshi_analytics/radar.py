"""Thin radar (M11): signal 1 speed-accuracy, signal 2 same-room identical wrong answers.

python -m saakshi_analytics.radar COHORT.jsonl --key key.json [--truth truth.json] [--json flags.json]
Flags are for human review only: each carries its reasons, observed vs expected and a p-value.
"""

import argparse
import json
from array import array

import networkx as nx
import numpy as np
from scipy import stats

STATES = ["NV", "NA", "A", "MR", "AMR"]
OPTS = "ABCD"
FAST_Z = -2.0  # "fast" = log-time residual below -2 robust sd (after item and candidate speed)
HARD_P = 0.8  # "hard" = expected P(correct | item, ability decile) <= 0.8
ALPHA_SPEED = 1e-5  # signal 1: Poisson-binomial tail, per candidate
ALPHA_ROOM = 0.01  # signal 2: family-wise over every same-room pair in the cohort (Bonferroni)
SCREEN = 1e-3  # signal 2: Poisson pre-screen before the exact Poisson-binomial


def load(path, key):
    """Cohort (or cell-export) JSONL -> arrays [cand x item]. Streams the file; extra fields are ignored."""
    items = sorted(key)
    ii = {it: j for j, it in enumerate(items)}
    ci, meta = {}, []
    cols = {k: array("q") for k in ("i", "j", "state", "answer", "dwell", "visits", "changes", "tfirst")}
    for line in open(path):
        if not line.strip():
            continue
        r = json.loads(line)
        i = ci.get(r["cand"])
        if i is None:
            i = ci[r["cand"]] = len(meta)
            meta.append(r)
        for k, v in (("i", i), ("j", ii[r["item"]]), ("state", STATES.index(r["state"])),
                     ("answer", OPTS.index(r["answer"]) if r["answer"] else -1), ("dwell", r["dwellMs"]),
                     ("visits", r["visits"]), ("changes", r["changes"]), ("tfirst", r["tFirstMs"])):
            cols[k].append(v)
    n, m = len(meta), len(items)
    i, j = np.frombuffer(cols.pop("i"), np.int64), np.frombuffer(cols.pop("j"), np.int64)
    c = {}
    for k, col in cols.items():
        c[k] = np.full((n, m), {"state": 0, "answer": -1, "tfirst": -1}.get(k, 0))  # missing row = never visited
        c[k][i, j] = np.frombuffer(col, np.int64)
    for k in ("cand", "centre", "shift", "form", "lang", "pwd"):
        c[k] = np.array([r[k] for r in meta])
    c["items"], c["key"] = np.array(items), np.array([OPTS.index(key[it]) for it in items])
    return c


def pb_sf(P, k):
    """P(X >= k) per row, X = sum of independent Bernoulli(P[row, j]). Exact DP."""
    n, m = P.shape
    pmf = np.zeros((n, m + 1))
    pmf[:, 0] = 1
    for j in range(m):
        p = P[:, j : j + 1]
        pmf[:, 1:] = pmf[:, 1:] * (1 - p) + pmf[:, :-1] * p
        pmf[:, 0] *= 1 - p[:, 0]
    tail = np.hstack([np.cumsum(pmf[:, ::-1], 1)[:, ::-1], np.zeros((n, 1))])
    return tail[np.arange(n), np.clip(k, 0, m + 1)]


def features(c):
    answered = (c["state"] == 2) | (c["state"] == 4)
    correct = answered & (c["answer"] == c["key"])
    logt = np.where(answered, np.log(np.maximum(c["dwell"], 1)), np.nan)
    r = logt - np.nanmedian(logt, 0)  # item time intensity
    r -= np.nanmedian(r, 1, keepdims=True)  # candidate's own pace
    sd = 1.4826 * np.nanmedian(np.abs(r - np.nanmedian(r, 0)), 0)
    fast = np.nan_to_num(r / sd, nan=0) < FAST_Z
    # ability from normal-paced items only (a leak must not inflate its own baseline), difficulty-adjusted
    # so that dropping a leaker's fast (often hard) items does not make them look stronger
    slow = ~fast
    score = ((correct - correct.mean(0)) * slow).sum(1) / np.maximum(slow.sum(1), 1)
    dec = np.minimum((stats.rankdata(score) - 1) * 10 // len(score), 9).astype(int)
    p_cor = np.array([correct[dec == d].mean(0) for d in range(10)])  # [decile, item]
    wrong = answered[..., None] & (c["answer"][..., None] == np.arange(4)) & (c["key"][:, None] != np.arange(4))
    q_wrong = np.array([wrong[dec == d].mean(0) for d in range(10)])  # [decile, item, option]
    return answered, correct, fast, dec, p_cor, wrong, q_wrong


def speed_accuracy(correct, fast, dec, p_cor):
    expect = p_cor[dec]
    use = fast & (expect <= HARD_P)
    obs = (correct & use).sum(1)
    P = np.where(use, expect, 0)
    return obs, P.sum(1), use.sum(1), pb_sf(P, obs)


def same_room(c, fast, dec, wrong, q_wrong):
    """All same-room pairs: identical wrong answers vs expectation for their two ability deciles.
    Rapid (fast) responses are effortless guesses and are left out on both sides, so two rapid guessers
    who happen to share a room do not look like a ring."""
    n, m = wrong.shape[:2]
    keep = ~fast[..., None]
    W = (wrong & keep).reshape(n, -1).astype(float)
    Q = (q_wrong[dec] * keep).reshape(n, -1)
    room = np.char.add(np.char.add(c["centre"], "/"), c["shift"])
    hits, n_pairs = [], 0
    for r in np.unique(room):
        idx = np.flatnonzero(room == r)
        a, b = np.triu_indices(len(idx), 1)
        n_pairs += len(a)
        obs = (W[idx] @ W[idx].T)[a, b]
        lam = (Q[idx] @ Q[idx].T)[a, b]
        # ponytail: Poisson screen (heavier tail than the Poisson-binomial) keeps the exact DP to a few pairs
        s = stats.poisson.sf(obs - 1, lam) < SCREEN
        if s.any():
            ia, ib = idx[a[s]], idx[b[s]]
            pi = (Q[ia] * Q[ib]).reshape(-1, m, 4).sum(-1)
            hits += zip(ia, ib, obs[s], lam[s], pb_sf(pi, obs[s].astype(int)))
    return [(i, j, o, e, min(1.0, p * n_pairs)) for i, j, o, e, p in hits], n_pairs


def run(c):
    answered, correct, fast, dec, p_cor, wrong, q_wrong = features(c)
    obs, exp, n_used, p1 = speed_accuracy(correct, fast, dec, p_cor)
    sig = {}
    for i in np.flatnonzero((p1 <= ALPHA_SPEED) & (obs > exp)):
        sig.setdefault(i, []).append({
            "signal": "speed-accuracy",
            "reason": f"correct on {obs[i]} of {n_used[i]} hard items answered unusually fast "
                      f"(ability decile {dec[i] + 1}; expected {exp[i]:.1f})",
            "observed": int(obs[i]), "expected": round(float(exp[i]), 2), "p": float(p1[i]),
        })
    pairs, n_pairs = same_room(c, fast, dec, wrong, q_wrong)
    g = nx.Graph()
    for i, j, o, e, p in pairs:
        if p <= ALPHA_ROOM and o > e:
            g.add_edge(i, j, obs=int(o), exp=float(e), p=p)
    for ring in nx.connected_components(g):
        names = sorted(c["cand"][list(ring)].tolist())
        for i in ring:
            j, e = min(g[i].items(), key=lambda kv: kv[1]["p"])
            sig.setdefault(i, []).append({
                "signal": "same-room",
                "reason": f"{e['obs']} identical wrong answers with {c['cand'][j]} in {c['centre'][i]}/{c['shift'][i]} "
                          f"(expected {e['exp']:.1f} for their ability deciles; Bonferroni over {n_pairs} pairs)",
                "observed": e["obs"], "expected": round(e["exp"], 2), "p": e["p"], "ring": names,
            })
    return [
        {"cand": str(c["cand"][i]), "centre": str(c["centre"][i]), "shift": str(c["shift"][i]),
         "level": "review" if len(s) >= 2 else "watch", "signals": s}
        for i, s in sorted(sig.items(), key=lambda kv: min(x["p"] for x in kv[1]))
    ]


def evaluate(flags, truth, c):
    by = {name: {f["cand"] for f in flags if any(s["signal"] == name for s in f["signals"])}
          for name in ("speed-accuracy", "same-room")}
    anyf = {f["cand"] for f in flags}
    leak, mid = set(truth["leak"]["cands"]), set(truth["midLeak"]["cands"])
    ring = {x for r in truth["rings"] for x in r["members"]}
    honest = set(c["cand"].tolist()) - leak - mid - ring
    sig = {}
    for name, target in [("speed-accuracy", leak | mid), ("same-room", ring)]:
        got = by[name]
        sig[name] = {"flagged": len(got), "precision": len(got & target) / max(len(got), 1),
                     "recall": len(target & got) / len(target), "fpr": len(got & honest) / len(honest)}
    sig["speed-accuracy"] |= {"recall_leak": len(leak & by["speed-accuracy"]) / len(leak),
                              "recall_mid": len(mid & by["speed-accuracy"]) / len(mid)}
    lk = truth["lookalikes"]
    groups = {
        "hindi": set(c["cand"][c["lang"] == "hi"].tolist()), "pwd": set(c["cand"][c["pwd"] == 1].tolist()),
        "rapid": set(lk["rapid"]), "improvers": {x["cand"] for x in lk["improvers"]}, "flyers": set(lk["flyers"]),
    }
    base = honest - set().union(*groups.values())
    b_flag = len(base & anyf)
    looks = {}
    for name, g in groups.items():
        g &= honest
        k = len(g & anyf)
        _, p = stats.fisher_exact([[k, len(g) - k], [b_flag, len(base) - b_flag]], alternative="greater")
        looks[name] = {"n": len(g), "flagged": k, "rate": k / max(len(g), 1), "p_vs_baseline": float(p)}
    return {"signals": sig, "honest_fpr": len(anyf & honest) / len(honest), "n_honest": len(honest),
            "baseline": {"n": len(base), "flagged": b_flag, "rate": b_flag / len(base)}, "lookalikes": looks}


def report(flags, m=None):
    print(f"{len(flags)} flags ({sum(f['level'] == 'review' for f in flags)} review, "
          f"{sum(f['level'] == 'watch' for f in flags)} watch). Flags are for human review; nothing is auto-penalised.")
    for f in flags:
        for s in f["signals"]:
            print(f"  {f['level']:6} {f['cand']} {f['centre']}/{f['shift']}  [{s['signal']}] {s['reason']}  "
                  f"obs={s['observed']} exp={s['expected']} p={s['p']:.2e}")
    if m is None:
        return
    print("\nsignal          flagged  precision  recall  FPR(honest)")
    for name, s in m["signals"].items():
        print(f"{name:15} {s['flagged']:7}  {s['precision']:9.3f}  {s['recall']:6.3f}  {s['fpr']:.4%}")
    s = m["signals"]["speed-accuracy"]
    print(f"  speed-accuracy recall: full leak {s['recall_leak']:.3f}, mid-exam leak {s['recall_mid']:.3f}")
    print(f"any signal: FPR on {m['n_honest']} honest candidates = {m['honest_fpr']:.4%}")
    print("\nlook-alike group  n      flagged  rate     p(> baseline)")
    b = m["baseline"]
    print(f"{'baseline':16} {b['n']:6} {b['flagged']:7}  {b['rate']:.4%}")
    for name, g in m["lookalikes"].items():
        print(f"{name:16} {g['n']:6} {g['flagged']:7}  {g['rate']:.4%}  {g['p_vs_baseline']:.3f}")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("cohort")
    ap.add_argument("--key", required=True)
    ap.add_argument("--truth")
    ap.add_argument("--json", help="also write the flags as JSON (input to the decision engine's --flags)")
    args = ap.parse_args(argv)
    c = load(args.cohort, json.loads(open(args.key).read()))
    flags = run(c)
    if args.json:
        open(args.json, "w").write(json.dumps(flags, indent=1) + "\n")
    report(flags, evaluate(flags, json.loads(open(args.truth).read()), c) if args.truth else None)


if __name__ == "__main__":
    main()
