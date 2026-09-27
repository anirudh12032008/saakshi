"""Radar (M11 + S1): signal 1 speed-accuracy, signal 2 same-room identical wrong answers,
signal 3 CUSUM per item x centre x shift over tFirstMs (Benjamini-Hochberg across cells).

python -m saakshi_analytics.radar COHORT.jsonl --key key.json [--truth truth.json] [--registry registry.json] [--json flags.json]
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
P1_CUSUM = 0.5  # signal 3 design point: rate of "fast and correct" once a leak has landed in a room
P0_FLOOR = 1e-3  # signal 3: floor on the in-control rate, so one lucky response is never infinite evidence
Q_CUSUM = 0.01  # signal 3: BH false-discovery rate over every item x centre x shift cell
ALPHA_CUSUM_CAND = 1e-3  # signal 3: per candidate, counted only inside BH-significant cells (committee parameter)
DEFAULTS = {"speed": ALPHA_SPEED, "room": ALPHA_ROOM, "cusum_q": Q_CUSUM}
CAPS = {"speed": 1e-3, "room": 0.05, "cusum_q": 0.05}  # calibration never loosens past these
MARGIN = 10  # calibrated threshold sits >= 10x below the most extreme honest calibration value


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


def page(inc):
    """Page's CUSUM down each column: S_t = max(0, S_{t-1} + inc_t). Returns, per column, the rows
    [start, end) of the segment that ends at max S (start = the estimated change point)."""
    C = np.vstack([np.zeros((1, inc.shape[1])), np.cumsum(inc, 0)])
    end = (C - np.minimum.accumulate(C, 0)).argmax(0)
    k = np.arange(len(C))[:, None]
    start = np.where(k <= end, C, np.inf).argmin(0)
    return start, end


def cusum(c, answered, correct, fast, dec):
    """Signal 3. For each item x room, order the answers by tFirstMs and run a Bernoulli CUSUM on
    "fast and correct" (in control: this form x ability decile x item's cohort rate; out of control: P1_CUSUM).
    The CUSUM segment [change point, peak] is tested with an exact Poisson-binomial tail, Bonferroni over
    the n(n+1)/2 segments the scan could have picked; then Benjamini-Hochberg across all cells."""
    n, m = answered.shape
    y = fast & correct
    fi = np.unique(c["form"], return_inverse=True)[1]
    g = fi * 10 + dec
    num, den = np.zeros((g.max() + 1, m)), np.zeros((g.max() + 1, m))
    np.add.at(num, g, y)
    np.add.at(den, g, answered)
    p0 = np.clip(np.divide(num, den, out=np.zeros_like(num), where=den > 0)[g], P0_FLOOR, P1_CUSUM / 2)
    inc = np.where(answered, np.where(y, np.log(P1_CUSUM / p0), np.log((1 - P1_CUSUM) / (1 - p0))), 0)
    t = np.where(answered, c["tfirst"], -1)  # unanswered sort first and add nothing
    room = np.char.add(np.char.add(c["centre"], "/"), c["shift"])
    cells = {k: [] for k in ("room", "item", "obs", "exp", "p", "changeMs")}
    seg_of = []  # candidate indices in each cell's segment
    for r in np.unique(room):
        idx = np.flatnonzero(room == r)
        o = np.argsort(t[idx], 0, kind="stable")
        start, end = page(np.take_along_axis(inc[idx], o, 0))
        k = np.arange(len(idx))[:, None]
        seg = (k >= start) & (k < end) & np.take_along_axis(answered[idx], o, 0)
        Y = np.take_along_axis(y[idx], o, 0) & seg
        P = np.where(seg, np.take_along_axis(p0[idx], o, 0), 0)
        n_ans = answered[idx].sum(0)
        p = np.minimum(1, pb_sf(P.T, Y.sum(0)) * n_ans * (n_ans + 1) / 2)
        ts = np.take_along_axis(t[idx], o, 0)
        rows = idx[o]
        for j in range(m):
            for key, v in (("room", r), ("item", j), ("obs", Y[:, j].sum()), ("exp", P[:, j].sum()), ("p", p[j]),
                           ("changeMs", ts[min(start[j], len(idx) - 1), j])):
                cells[key].append(v)
            seg_of.append(rows[seg[:, j], j])
    cells = {k: np.array(v) for k, v in cells.items()}
    cells["q"] = stats.false_discovery_control(cells["p"])
    return cells, seg_of, y, p0


def scores(c):
    """Every signal's statistics before any threshold (what calibration looks at)."""
    answered, correct, fast, dec, p_cor, wrong, q_wrong = features(c)
    pairs, n_pairs = same_room(c, fast, dec, wrong, q_wrong)
    cells, seg_of, y, p0 = cusum(c, answered, correct, fast, dec)
    return {"dec": dec, "speed": speed_accuracy(correct, fast, dec, p_cor), "pairs": pairs, "n_pairs": n_pairs,
            "cells": cells, "seg_of": seg_of, "y": y, "p0": p0}


def subset(c, rows):
    """The cohort restricted to some candidates (boolean mask or indices)."""
    per_cand = {k for k, v in c.items() if k not in ("items", "key") and len(v) == len(c["cand"])}
    return {k: (v[rows] if k in per_cand else v) for k, v in c.items()}


def calibrate(c, truth=None):
    """Thresholds from an HONEST cohort only: each is the loosest power of ten that sits at least MARGIN x
    below the most extreme honest value (signal 1: p per candidate; 2: Bonferroni p per pair; 3: BH q per cell),
    capped at CAPS. Pass `truth` to have it refuse a cohort that still holds planted candidates."""
    if truth is not None:
        planted = set(truth["leak"]["cands"]) | set(truth["midLeak"]["cands"]) | {x for r in truth["rings"] for x in r["members"]}
        if planted & set(c["cand"].tolist()):
            raise ValueError("calibrate on honest candidates only (drop the planted ones first)")
    s = scores(c)
    worst = {"speed": s["speed"][3].min(), "room": min((p for *_, p in s["pairs"]), default=1.0),
             "cusum_q": s["cells"]["q"].min()}
    return {k: float(min(CAPS[k], 10 ** np.floor(np.log10(max(w, 1e-300) / MARGIN)))) for k, w in worst.items()}


def level(n_signals, device_camera_evidence=False):
    """Escalation ladder. 1 signal -> watch, 2+ -> review, 2+ with device or camera evidence -> escalate.
    `device_camera_evidence` is the named input for that evidence; nothing produces it yet."""
    if n_signals >= 2:
        return "escalate" if device_camera_evidence else "review"
    return "watch"


def run(c, th=None, device_camera_evidence=frozenset(), s=None):
    """Flags for human review. th: thresholds (DEFAULTS, or calibrate()'s output). device_camera_evidence:
    candidate ids with device/camera evidence (not built yet). s: precomputed scores(c)."""
    th = DEFAULTS | (th or {})
    s = s or scores(c)
    dec = s["dec"]
    obs, exp, n_used, p1 = s["speed"]
    sig = {}
    for i in np.flatnonzero((p1 <= th["speed"]) & (obs > exp)):
        sig.setdefault(i, []).append({
            "signal": "speed-accuracy",
            "reason": f"correct on {obs[i]} of {n_used[i]} hard items answered unusually fast "
                      f"(ability decile {dec[i] + 1}; expected {exp[i]:.1f})",
            "observed": int(obs[i]), "expected": round(float(exp[i]), 2), "p": float(p1[i]),
        })
    pairs, n_pairs = s["pairs"], s["n_pairs"]
    g = nx.Graph()
    for i, j, o, e, p in pairs:
        if p <= th["room"] and o > e:
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
    cells, y, p0 = s["cells"], s["y"], s["p0"]
    hot = np.flatnonzero(cells["q"] <= th["cusum_q"])
    if len(hot):
        P, first = np.zeros(y.shape), np.full(y.shape, np.inf)
        for h in hot:
            rows, j = s["seg_of"][h], cells["item"][h]
            P[rows, j] = p0[rows, j]
            first[rows, j] = cells["changeMs"][h]
        Y = y & (P > 0)
        o3, e3 = Y.sum(1), P.sum(1)
        p3 = pb_sf(P, o3)
        for i in np.flatnonzero((p3 <= ALPHA_CUSUM_CAND) & (o3 > e3)):
            n_cells = int((P[i] > 0).sum())
            t0 = float(first[i][Y[i]].min()) / 60000
            q = float(cells["q"][hot][np.isin(cells["item"][hot], np.flatnonzero(Y[i]))
                                      & (cells["room"][hot] == f"{c['centre'][i]}/{c['shift'][i]}")].max())
            sig.setdefault(i, []).append({
                "signal": "cusum",
                "reason": f"fast and correct on {o3[i]} of {n_cells} items whose answer streams in "
                          f"{c['centre'][i]}/{c['shift'][i]} shift after a change point (earliest ~{t0:.0f} min); "
                          f"CUSUM per item x room, BH q <= {q:.1e} across {len(cells['q'])} cells",
                "observed": int(o3[i]), "expected": round(float(e3[i]), 2), "p": float(p3[i]),
                "room": f"{c['centre'][i]}/{c['shift'][i]}", "changeMin": round(t0, 1),
            })
    return [
        {"cand": str(c["cand"][i]), "centre": str(c["centre"][i]), "shift": str(c["shift"][i]),
         "level": level(len(v), str(c["cand"][i]) in device_camera_evidence), "signals": v}
        for i, v in sorted(sig.items(), key=lambda kv: min(x["p"] for x in kv[1]))
    ]


def evaluate(flags, truth, c):
    by = {name: {f["cand"] for f in flags if any(s["signal"] == name for s in f["signals"])}
          for name in ("speed-accuracy", "same-room", "cusum")}
    anyf = {f["cand"] for f in flags}
    leak, mid = set(truth["leak"]["cands"]), set(truth["midLeak"]["cands"])
    ring = {x for r in truth["rings"] for x in r["members"]}
    honest = set(c["cand"].tolist()) - leak - mid - ring
    sig = {}
    by["leak (1 or 3)"] = by["speed-accuracy"] | by["cusum"]
    for name, target in [("speed-accuracy", leak | mid), ("same-room", ring), ("cusum", leak | mid), ("leak (1 or 3)", leak | mid)]:
        got = by[name]
        sig[name] = {"flagged": len(got), "precision": len(got & target) / max(len(got), 1),
                     "recall": len(target & got) / len(target), "fpr": len(got & honest) / len(honest)}
    for name in ("speed-accuracy", "cusum", "leak (1 or 3)"):
        sig[name] |= {"recall_leak": len(leak & by[name]) / len(leak), "recall_mid": len(mid & by[name]) / len(mid)}
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
    """flags=None prints only the metrics."""
    if flags is not None:
        print_flags(flags)
    if m is not None:
        print_metrics(m)


def print_flags(flags):
    print(f"{len(flags)} flags ({sum(f['level'] == 'escalate' for f in flags)} escalate, "
          f"{sum(f['level'] == 'review' for f in flags)} review, "
          f"{sum(f['level'] == 'watch' for f in flags)} watch). Flags are for human review; nothing is auto-penalised.")
    for f in flags:
        for s in f["signals"]:
            print(f"  {f['level']:6} {f['cand']} {f['centre']}/{f['shift']}  [{s['signal']}] {s['reason']}  "
                  f"obs={s['observed']} exp={s['expected']} p={s['p']:.2e}")
        if "history" in f:
            print(f"         history: {f['history']['note']}")


def print_metrics(m):
    print("\nsignal          flagged  precision  recall  FPR(honest)")
    for name, s in m["signals"].items():
        print(f"{name:15} {s['flagged']:7}  {s['precision']:9.3f}  {s['recall']:6.3f}  {s['fpr']:.4%}")
    for name in ("speed-accuracy", "cusum", "leak (1 or 3)"):
        s = m["signals"][name]
        print(f"  {name} recall: full leak {s['recall_leak']:.3f}, mid-exam leak {s['recall_mid']:.3f}")
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
    ap.add_argument("--registry", help="APAAR registry of past percentiles: annotates queued flags only")
    ap.add_argument("--json", help="also write the flags as JSON (input to the decision engine's --flags)")
    args = ap.parse_args(argv)
    c = load(args.cohort, json.loads(open(args.key).read()))
    flags = run(c)
    if args.registry:
        from saakshi_analytics import history
        flags = history.annotate(flags, c, json.loads(open(args.registry).read()))
    if args.json:
        open(args.json, "w").write(json.dumps(flags, indent=1) + "\n")
    report(flags, evaluate(flags, json.loads(open(args.truth).read()), c) if args.truth else None)


if __name__ == "__main__":
    main()
