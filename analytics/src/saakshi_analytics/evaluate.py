"""Calibrate on honest G1, evaluate on the independent G2 (A3 / S1).

python -m saakshi_analytics.evaluate [--n 20000] [--centres 100] [--g1-seed 7] [--g2-seed 2026] [--json OUT.json]
Prints precision / recall / FPR per signal on G2, the mid-exam recall before and after CUSUM, history
corroboration of the queued flags, and flag rates by language, PwD and centre. Cohorts are generated in memory.
"""

import argparse
import json

import numpy as np

from saakshi_analytics import generate, history, radar


def planted(truth):
    return set(truth["leak"]["cands"]) | set(truth["midLeak"]["cands"]) | {x for r in truth["rings"] for x in r["members"]}


def fairness(flags, truth, c):
    """Flag rates by language, PwD and centre: all candidates, and honest ones only (= that group's FPR)."""
    flagged = np.isin(c["cand"], [f["cand"] for f in flags])
    honest = ~np.isin(c["cand"], list(planted(truth)))

    def rates(col):
        out = {}
        for v in np.unique(col):
            g = col == v
            out[str(v)] = {"n": int(g.sum()), "flagged": int((flagged & g).sum()), "rate": float(flagged[g].mean()),
                           "n_honest": int((g & honest).sum()), "honest_flagged": int((flagged & g & honest).sum()),
                           "honest_rate": float(flagged[g & honest].mean())}
        return out

    cen = rates(c["centre"])
    hr = {k: v["honest_rate"] for k, v in cen.items()}
    return {"lang": rates(c["lang"]), "pwd": rates(c["pwd"]),
            "centre": {"n_centres": len(cen), "with_honest_flags": sum(v > 0 for v in hr.values()),
                       "max_honest_rate": max(hr.values()), "max_honest_centre": max(hr, key=hr.get),
                       "top_by_rate": sorted(({"centre": k} | v for k, v in cen.items()), key=lambda x: -x["rate"])[:5]}}


def corroboration(flags, truth):
    bad = planted(truth)
    out = {}
    for who, keep in (("planted", lambda f: f["cand"] in bad), ("honest", lambda f: f["cand"] not in bad)):
        fs = [f for f in flags if keep(f)]
        known = [f for f in fs if "pastPct" in f["history"]]
        out[who] = {"flags": len(fs), "with_history": len(known), "corroborated": sum(f["history"]["corroborates"] for f in known)}
    return out


def run(n, centres, g1_seed, g2_seed):
    g1, _, t1 = generate.generate(n, centres, g1_seed)
    th = radar.calibrate(radar.subset(g1, ~np.isin(g1["cand"], list(planted(t1)))), truth=t1)
    s1 = radar.scores(g1)
    m1 = radar.evaluate(radar.run(g1, th, s=s1), t1, g1)
    m1_a1 = radar.evaluate(radar.run(g1, s=s1), t1, g1)  # A1's default thresholds
    g2, _, t2 = generate.generate(n, centres, g2_seed, "G2")
    flags = history.annotate(radar.run(g2, th), g2, t2["registry"])
    m2 = radar.evaluate(flags, t2, g2)
    mid = {name: {"before (signal 1)": m["signals"]["speed-accuracy"]["recall_mid"],
                  "after (signal 1 or 3)": m["signals"]["leak (1 or 3)"]["recall_mid"]}
           for name, m in (("G1, A1 thresholds", m1_a1), ("G1, calibrated", m1), ("G2, calibrated", m2))}
    return {"thresholds": th, "g1": m1, "g2": m2, "mid_recall": mid, "fairness": fairness(flags, t2, g2),
            "history": corroboration(flags, t2), "levels": {k: sum(f["level"] == k for f in flags) for k in ("watch", "review", "escalate")},
            "cohort": {"n": n, "centres": centres, "g1_seed": g1_seed, "g2_seed": g2_seed}}


def report(r):
    k = r["cohort"]
    print(f"Calibrated on honest G1 (seed {k['g1_seed']}), evaluated on independent G2 (seed {k['g2_seed']}); "
          f"{k['n']} candidates, {k['centres']} centres.")
    print("calibrated thresholds: " + ", ".join(f"{a}={b:.0e}" for a, b in r["thresholds"].items())
          + f"; signal 3 per candidate p <= {radar.ALPHA_CUSUM_CAND:.0e}")
    m = r["g2"]
    print("\nG2               flagged  precision  recall  FPR(honest)")
    for name, s in m["signals"].items():
        print(f"{name:16} {s['flagged']:7}  {s['precision']:9.3f}  {s['recall']:6.3f}  {s['fpr']:.4%}")
    print(f"any signal: FPR on {m['n_honest']} honest G2 candidates = {m['honest_fpr']:.4%}; "
          f"levels {r['levels']} (nothing is auto-penalised)")
    print("\nG2 look-alike group (honest)  n      flagged  rate     p(> baseline)")
    b = m["baseline"]
    print(f"{'baseline':28} {b['n']:6} {b['flagged']:7}  {b['rate']:.4%}")
    for name, g in m["lookalikes"].items():
        print(f"{name:28} {g['n']:6} {g['flagged']:7}  {g['rate']:.4%}  {g['p_vs_baseline']:.3f}")
    print("\nmid-exam leak recall   before (signal 1)  after (signal 1 or 3)")
    for name, x in r["mid_recall"].items():
        print(f"{name:22} {x['before (signal 1)']:17.3f}  {x['after (signal 1 or 3)']:21.3f}")
    print("\nhistory (annotation only; never creates or escalates a flag):")
    for who, h in r["history"].items():
        print(f"  {who:8} flags {h['flags']:4}  with a registry record {h['with_history']:4}  corroborated {h['corroborated']:4}")
    f = r["fairness"]
    print("\nG2 flag rates      n       flagged  rate      honest n  honest flagged  honest rate (FPR)")
    for dim in ("lang", "pwd"):
        for v, g in f[dim].items():
            print(f"{dim + '=' + v:14} {g['n']:9} {g['flagged']:9}  {g['rate']:.3%}  {g['n_honest']:9} {g['honest_flagged']:15}  {g['honest_rate']:.4%}")
    c = f["centre"]
    print(f"centre: {c['with_honest_flags']} of {c['n_centres']} centres have any honest flag; "
          f"max honest rate {c['max_honest_rate']:.3%} ({c['max_honest_centre']})")
    print("  highest overall flag rates (planted centres expected here): "
          + ", ".join(f"{x['centre']} {x['rate']:.1%}" for x in c["top_by_rate"]))
    print("\nG1 (calibration cohort) with the calibrated thresholds:")
    radar.report(None, r["g1"])


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--n", type=int, default=generate.N_FULL)
    ap.add_argument("--centres", type=int, default=100)
    ap.add_argument("--g1-seed", type=int, default=7)
    ap.add_argument("--g2-seed", type=int, default=2026)
    ap.add_argument("--json")
    a = ap.parse_args(argv)
    r = run(a.n, a.centres, a.g1_seed, a.g2_seed)
    report(r)
    if a.json:
        open(a.json, "w").write(json.dumps(r, indent=1, default=float) + "\n")
    return r


if __name__ == "__main__":
    main()
