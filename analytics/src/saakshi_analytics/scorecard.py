"""S4: predicted centre risk from T-1 mock-drill telemetry, and the centre scorecard (allot / add observer / do not allot).

python -m saakshi_analytics.scorecard [--centres 10] [--seed 7] [--train-seed 1] [--eval-seed 2] [--telemetry T.json] [--json OUT]
Synthetic centre histories come from a seeded generator. The model (logistic regression on four drill features)
is fitted on one set of histories and its precision measured on an independent set. Deterministic, no LLM:
the explanatory note goes through `claude_note_hook`, which returns template text for now.
"""

import argparse
import json

import numpy as np
from scipy import optimize

FEATURES = ["jitterMs", "upsMin", "diskFreePct", "pastIncidents"]
# Transform so that "higher = riskier" for every feature before standardising.
RISKWARD = {"jitterMs": np.log, "upsMin": np.negative, "diskFreePct": np.negative, "pastIncidents": lambda v: v}
LABEL = {"jitterMs": "heartbeat jitter p95 {v:.0f} ms (fleet median {m:.0f})",
         "upsMin": "UPS/battery backup {v:.0f} min (fleet median {m:.0f})",
         "diskFreePct": "disk free {v:.0f}% (fleet median {m:.0f}%)",
         "pastIncidents": "{v:.0f} incident(s) in the last 5 exams (fleet median {m:.0f})"}
OBSERVER, DO_NOT_ALLOT = 0.2, 0.5  # committee parameters: predicted P(incident) cut-offs. "At risk" = >= OBSERVER
HISTORY_N = 4000  # centre-histories per synthetic set


def sig(x):
    return 1 / (1 + np.exp(-x))


def simulate(n, seed):
    """Seeded synthetic centre histories: T-1 drill telemetry plus whether the centre had an exam-day incident.
    Latent fragilities (network, power, disk, management) drive both the telemetry (noisily) and the incident."""
    rng = np.random.default_rng(seed)
    net, pw, dk, mg = rng.normal(0, 1, (4, n))
    tel = {"jitterMs": 30 * np.exp(0.45 * net + 0.15 * mg + rng.normal(0, 0.3, n)),
           "upsMin": np.clip(40 - 12 * pw - 4 * mg + rng.normal(0, 8, n), 0, 120),
           "diskFreePct": np.clip(55 - 15 * dk + rng.normal(0, 10, n), 1, 99),
           "pastIncidents": rng.poisson(0.4 * np.exp(0.4 * net + 0.4 * pw + 0.6 * mg))}
    p_cause = np.array([sig(-3.6 + 1.4 * net + 0.5 * mg), sig(-3.6 + 1.4 * pw + 0.5 * mg), sig(-4.5 + 1.2 * dk)])
    incident = rng.random(n) < 1 - np.prod(1 - p_cause, 0)
    return [{"centre": f"CEN{i + 1:03d}", **{k: round(float(tel[k][i]), 1) for k in FEATURES},
             "incident": bool(incident[i])} for i in range(n)]


def design(rows):
    return np.array([[RISKWARD[k](float(r[k])) for k in FEATURES] for r in rows])


def fit(histories, l2=1e-2):
    """Logistic regression (L2) on standardised, risk-ward features."""
    X, y = design(histories), np.array([r["incident"] for r in histories], float)
    mu, sd = X.mean(0), X.std(0)
    Z = np.hstack([np.ones((len(X), 1)), (X - mu) / sd])

    def nll(w):
        z = Z @ w
        return np.sum(np.logaddexp(0, z) - y * z) + l2 * w[1:] @ w[1:]

    w = optimize.minimize(nll, np.zeros(Z.shape[1]), method="BFGS").x
    med = {k: float(np.median([r[k] for r in histories])) for k in FEATURES}
    return {"w": w, "mu": mu, "sd": sd, "median": med}


def predict(model, rows):
    """-> (P(incident) per row, per-feature contribution w_k * z_k per row)."""
    contrib = (design(rows) - model["mu"]) / model["sd"] * model["w"][1:]
    return sig(model["w"][0] + contrib.sum(1)), contrib


def precision(model, histories, threshold=OBSERVER):
    """Precision of the "at risk" label (P >= threshold) against the centres that later had an incident."""
    p, _ = predict(model, histories)
    at, inc = p >= threshold, np.array([r["incident"] for r in histories])
    return {"n": len(histories), "baseRate": float(inc.mean()), "atRisk": int(at.sum()),
            "truePositives": int((at & inc).sum()), "precision": float((at & inc).sum() / max(at.sum(), 1)),
            "recall": float((at & inc).sum() / max(inc.sum(), 1)), "threshold": threshold}


def claude_note_hook(row):
    """HOOK (S3): Claude writes the explanatory note here, from aggregated, pseudonymous centre facts only (never
    PII). No LLM is called in the analytics track; this returns template text. Swap it via scorecard(note=...)."""
    return (f"{row['centre']} is ranked {row['rank']} with predicted incident risk {row['risk']:.0%}: "
            f"{row['decision']}. Main drivers: {'; '.join(row['reasons'])}.")


def scorecard(model, telemetry, note=claude_note_hook):
    """Ranking with reasons: allot / add observer / do not allot. Top 3 reasons = the largest risk contributions."""
    p, contrib = predict(model, telemetry)
    rows = []
    for i in np.argsort(-p, kind="stable"):
        t = telemetry[i]
        top = np.argsort(-contrib[i], kind="stable")[:3]
        rows.append({
            "centre": t["centre"], "risk": round(float(p[i]), 3),
            "decision": "do not allot" if p[i] >= DO_NOT_ALLOT else "add observer" if p[i] >= OBSERVER else "allot",
            "reasons": [("raises risk: " if contrib[i][k] > 0 else "lowers risk: ")
                        + LABEL[FEATURES[k]].format(v=t[FEATURES[k]], m=model["median"][FEATURES[k]]) for k in top],
            "telemetry": {k: t[k] for k in FEATURES},
        })
    for rank, r in enumerate(rows, 1):
        r["rank"] = rank
        r["note"] = note(r)
    return rows


def render(rows, ms, train_seed, eval_seed):
    lines = ["SAAKSHI CENTRE SCORECARD (predicted risk from T-1 mock-drill telemetry; ILLUSTRATIVE cut-offs)",
             f"do not allot at P >= {DO_NOT_ALLOT:.0%} · add observer at P >= {OBSERVER:.0%} · otherwise allot", ""]
    for r in rows:
        lines.append(f"{r['rank']:>3}. {r['centre']}  risk {r['risk']:5.1%}  {r['decision'].upper()}")
        lines += [f"       {x}" for x in r["reasons"]]
        lines.append(f"       note: {r['note']}")
    lines += ["", f"Risk-model precision (fitted on {HISTORY_N} synthetic centre-histories, seed {train_seed}; measured on "
                  f"{ms[0]['n']} independent ones, seed {eval_seed}; base rate {ms[0]['baseRate']:.3f}):"]
    lines += [f"  {name} (P >= {m['threshold']:.0%}): {m['atRisk']} centres, {m['truePositives']} later had an incident"
              f" -> precision {m['precision']:.3f}, recall {m['recall']:.3f} (lift {m['precision'] / m['baseRate']:.1f}x)"
              for name, m in zip(("at risk", "do not allot"), ms)]
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--centres", type=int, default=10, help="synthetic fleet size (when no --telemetry)")
    ap.add_argument("--seed", type=int, default=7, help="seed of the fleet's synthetic drill telemetry")
    ap.add_argument("--train-seed", type=int, default=1)
    ap.add_argument("--eval-seed", type=int, default=2)
    ap.add_argument("--telemetry", help="JSON list of {centre, jitterMs, upsMin, diskFreePct, pastIncidents}")
    ap.add_argument("--json", help="also write the scorecard and precision as JSON")
    a = ap.parse_args(argv)
    model = fit(simulate(HISTORY_N, a.train_seed))
    held_out = simulate(HISTORY_N, a.eval_seed)
    ms = [precision(model, held_out), precision(model, held_out, DO_NOT_ALLOT)]
    fleet = json.loads(open(a.telemetry).read()) if a.telemetry else [
        {k: v for k, v in r.items() if k != "incident"} for r in simulate(a.centres, a.seed)]
    rows = scorecard(model, fleet)
    print(render(rows, ms, a.train_seed, a.eval_seed))
    if a.json:
        open(a.json, "w").write(json.dumps({"scorecard": rows, "precision": ms[0], "precisionDoNotAllot": ms[1]}, indent=1) + "\n")


if __name__ == "__main__":
    main()
