"""History corroboration (S1). A mock APAAR-keyed registry of past percentiles (OUT/registry.json).

Expected percentile = past + typical gain (the registry-wide median change). History ONLY annotates flags that
the radar already queued: it never creates, removes, escalates or de-escalates a flag (hard user decision).
It is weak evidence by construction: a genuine improver jumps as far as a leak buyer does.
"""

import copy

import numpy as np
from scipy import stats

Z_GAP = 2.0  # "corroborates" when observed - expected >= Z_GAP robust sd of the registry's changes (committee parameter)


def annotate(flags, c, registry):
    """Returns deep copies of `flags`, each with a "history" note. Levels and signals are untouched."""
    out = copy.deepcopy(flags)
    if not out:
        return out
    answered = (c["state"] == 2) | (c["state"] == 4)
    score = (answered & (c["answer"] == c["key"])).sum(1)
    pct = dict(zip(c["cand"].tolist(), np.round(100 * (stats.rankdata(score, "min") - 1) / len(score), 1)))
    apaar, past = registry["apaar"], registry["pastPct"]
    known = [x for x in apaar if x in pct]
    d = np.array([pct[x] - past[apaar[x]] for x in known] or [0.0])
    gain, sd = float(np.median(d)), float(1.4826 * np.median(np.abs(d - np.median(d)))) or 1.0
    for f in out:
        a = apaar.get(f["cand"])
        if a is None or a not in past:
            f["history"] = {"note": "no prior attempt in the registry: nothing to corroborate"}
            continue
        exp = min(100.0, past[a] + gain)
        gap = round(float(pct[f["cand"]]) - exp, 1)
        yes = bool(gap >= Z_GAP * sd)
        f["history"] = {
            "apaar": a, "pastPct": past[a], "typicalGain": round(gain, 1), "expectedPct": round(exp, 1),
            "observedPct": float(pct[f["cand"]]), "gap": gap, "gapSd": round(gap / sd, 2), "corroborates": yes,
            "note": (f"observed P{pct[f['cand']]:.0f} vs expected P{exp:.0f} (past P{past[a]:.0f} + typical gain "
                     f"{gain:+.0f}): {'corroborates' if yes else 'does not corroborate'} the flag; annotation only"),
        }
    return out
