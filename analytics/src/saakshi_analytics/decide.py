"""Thin decision engine (M12): the NEET-UG 2024 Supreme Court tier-1 test, then per-candidate rules.

python -m saakshi_analytics.decide --policy P.json --incident I.json --cohort COHORT.jsonl [--flags F.json] [--json OUT]
Deterministic, no LLM. The report is advisory until a human signs it off; nobody is penalised by it.
"""

import argparse
import hashlib
import json


def load_roster(path):
    """Cohort or cell-export JSONL -> {cand: "centre/shift"}. Streams; only the first row per candidate matters."""
    roster = {}
    for line in open(path):
        if line.strip():
            r = json.loads(line)
            roster.setdefault(r["cand"], f"{r['centre']}/{r['shift']}")
    return roster


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def expand(perimeter, rooms):
    """["CEN005", "CEN008/S2"] -> the matching rooms. A bare centre means all its shifts."""
    out = set()
    for p in perimeter:
        hit = {r for r in rooms if r == p or r.split("/")[0] == p}
        if not hit:
            raise ValueError(f"perimeter entry {p!r} matches no centre-shift in the cohort")
        out |= hit
    return out


def tier1(policy, breach, roster, flags):
    rooms = set(roster.values())
    if not breach:
        return {"breach": False, "systemic": False, "separable": None, "fullReconduct": False,
                "reasons": ["no breach alleged: tier 1 does not apply"]}, set(), []
    t = policy["tier1"]
    if breach.get("perimeter") == "unknown":
        return {"breach": True, "systemic": True, "separable": False, "fullReconduct": True,
                "reasons": ["(a) perimeter unknown: the breach cannot be bounded",
                            "(b) no perimeter, so beneficiaries cannot be separated"]}, rooms, []
    per = expand(breach["perimeter"], rooms)
    leak = [f for f in flags if any(s["signal"] == t["leakSignal"] for s in f["signals"])]
    outside = [f for f in leak if roster[f["cand"]] not in per]
    share_out = len(outside) / len(leak) if leak else 0.0
    evidenced = per | {roster[f["cand"]] for f in leak}
    share_rooms = len(evidenced) / len(rooms)
    systemic = bool(breach.get("systemic")) or share_rooms >= t["systemicRoomShare"]
    separable = share_out <= t["maxLeakFlagShareOutsidePerimeter"]
    full = systemic and not separable
    why_a = []
    if breach.get("systemic"):
        why_a.append(f"committee finding: {breach.get('evidence', 'systemic')}")
    why_a.append(f"breach evidenced in {len(evidenced)}/{len(rooms)} centre-shifts = {share_rooms:.0%} "
                 f"(systemic at >= {t['systemicRoomShare']:.0%})")
    why_b = (f"{len(outside)}/{len(leak)} radar {t['leakSignal']} flags fall outside the declared perimeter = "
             f"{share_out:.0%} (separable at <= {t['maxLeakFlagShareOutsidePerimeter']:.0%})"
             if leak else "no radar leak flags supplied: separability rests on the declared perimeter")
    return {"breach": True, "systemic": systemic, "separable": separable, "fullReconduct": full,
            "reasons": [f"(a) {'yes' if systemic else 'no'}: " + "; ".join(why_a),
                        f"(b) {'yes' if separable else 'no'}: {why_b}"]}, (rooms if full else per), outside


def decide(policy, incident, roster, flags=()):
    rooms = set(roster.values())
    for c in [*incident.get("left", []), *incident.get("gaps", {}), *(f["cand"] for f in flags)]:
        if c not in roster:
            raise ValueError(f"candidate {c!r} is not in the cohort")
    window = {}
    for d in incident.get("disruptions", []):
        room = f"{d['centre']}/{d['shift']}"
        if room not in rooms:
            raise ValueError(f"disruption at {room!r}: no such centre-shift in the cohort")
        window[room] = window.get(room, 0) + d["toMin"] - d["fromMin"]

    t1, rc, outside = tier1(policy, incident.get("breach"), roster, list(flags))
    cap, n_review = policy["gapCapMin"], policy["reviewGapCount"]
    left, journal = set(incident.get("left", [])), incident.get("gaps", {})
    comp, retest, review = [], [], []
    for c in sorted(left | set(journal) | {c for c, r in roster.items() if r in window}):
        if roster[c] in rc:
            continue  # the whole centre-shift is re-conducted
        if c in left:
            retest.append({"cand": c, "reason": "left the centre or could not resume"})
            continue
        g = journal.get(c)
        g = [window[roster[c]]] if g is None else ([g] if isinstance(g, (int, float)) else g)
        total = sum(g)
        if total > cap:
            why = "never resumed (no gap-journal entry), so the whole window" if c not in journal else "credited gap"
            retest.append({"cand": c, "reason": f"{why} {total} min is beyond the {cap}-min cap"})
        else:
            comp.append({"cand": c, "extraMin": total})
        if len(g) >= n_review:
            review.append({"cand": c, "reason": f"{len(g)} gaps (review at >= {n_review})"})
    out_ids = {f["cand"] for f in outside}
    for f in flags:
        sig = ", ".join(s["signal"] for s in f["signals"])
        where = "outside the breach perimeter, " if f["cand"] in out_ids else ""
        review.append({"cand": f["cand"], "reason": f"radar {f['level']} ({sig}); {where}referred to the committee"})
    review.sort(key=lambda x: (x["cand"], x["reason"]))

    rc_cands = {c for c, r in roster.items() if r in rc}
    re_exam = rc_cands | {x["cand"] for x in retest}
    base = set(roster) if t1["breach"] else {c for c, r in roster.items() if r in window}
    spared = len(base - re_exam)
    per = policy["cost"]["reexamPerCandidateInr"]
    return {
        "incident": incident.get("id", ""),
        "policy": f"{policy['policy']} v{policy['version']}", "policyLabel": policy["label"],
        "summary": {
            "compensated": len(comp), "retested": len(retest),
            "reconductedCentres": len({r.split("/")[0] for r in rc}), "reconductedCentreShifts": len(rc),
            "reconductedCandidates": len(rc_cands), "baseline": len(base), "spared": spared,
            "inrAvoided": spared * per, "extraMinTotal": sum(x["extraMin"] for x in comp),
        },
        "tier1": t1, "reconduct": sorted(rc), "compensate": comp, "retest": retest, "review": review,
        "assumptions": [
            f"₹ avoided = spared × ₹{inr(per)} per candidate re-exam, from policy.cost. {policy['cost']['note']}",
            "spared = candidates in the counterfactual who are not re-examined; counterfactual = "
            + ("a full re-conduct of the whole cohort (a breach puts it on the table)" if t1["breach"]
               else "a blanket re-exam of every candidate in the disrupted centre-shifts"),
            f"credited gaps come from the M6 gap journal; a candidate in a disrupted centre-shift with no journal "
            f"entry is credited the whole window; compensation = extra time equal to the credited gap (cap {cap} min)",
        ],
        "signoff": {"status": "PENDING", "by": None},
    }


def inr(n):
    """Indian digit grouping: 2400000 -> 24,00,000."""
    s = str(int(n))
    head, tail = s[:-3], s[-3:]
    parts = [head[max(i - 2, 0):i] for i in range(len(head), 0, -2)][::-1]
    return ",".join([*parts, tail]) if head else tail


def render(r):
    s, t = r["summary"], r["tier1"]
    lines = [
        f"SAAKSHI DECISION REPORT: {r['incident']}",
        f"policy {r['policy']}: {r['policyLabel']}",
        "",
        f"Compensated {s['compensated']} · Re-tested {s['retested']} · Re-conducted {s['reconductedCentres']} centres"
        f" · Spared {s['spared']} · ₹ avoided {inr(s['inrAvoided'])}",
        "",
        "Tier 1, the NEET-UG 2024 Supreme Court test (full re-conduct only if (a) systemic AND NOT (b) separable):",
        *(f"  {x}" for x in t["reasons"]),
        f"  => {'FULL RE-CONDUCT' if t['fullReconduct'] else 'no full re-conduct'}",
        f"Re-conduct: {s['reconductedCentreShifts']} centre-shifts, {s['reconductedCandidates']} candidates"
        + (f": {', '.join(r['reconduct'])}" if r["reconduct"] else ""),
    ]
    if r["compensate"]:
        ex = [x["extraMin"] for x in r["compensate"]]
        lines.append(f"Compensate {len(ex)}: extra time = credited gap, {min(ex)}-{max(ex)} min "
                     f"(total {s['extraMinTotal']} min); per-candidate list in --json")
    lines.append(f"Re-test {len(r['retest'])}:")
    lines += [f"  {x['cand']}  {x['reason']}" for x in r["retest"]]
    lines.append(f"Human review {len(r['review'])} (nothing is auto-penalised):")
    lines += [f"  {x['cand']}  {x['reason']}" for x in r["review"]]
    lines += ["Assumptions:", *(f"  - {a}" for a in r["assumptions"])]
    if "evidence" in r:
        lines += ["Evidence (sha256):", *(f"  {k:9} {v}" for k, v in r["evidence"].items())]
    lines.append(f"Human sign-off: {r['signoff']['status']}  name / role / date: ______________")
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--policy", required=True)
    ap.add_argument("--incident", required=True)
    ap.add_argument("--cohort", required=True, help="cohort or cell-export JSONL")
    ap.add_argument("--flags", help="radar flags JSON (python -m saakshi_analytics.radar ... --json)")
    ap.add_argument("--json", help="also write the report as JSON")
    a = ap.parse_args(argv)
    files = {"policy": a.policy, "incident": a.incident, "cohort": a.cohort} | ({"flags": a.flags} if a.flags else {})
    load = lambda p: json.loads(open(p).read())  # noqa: E731
    r = decide(load(a.policy), load(a.incident), load_roster(a.cohort), load(a.flags) if a.flags else [])
    r["evidence"] = {k: sha256(p) for k, p in files.items()}
    print(render(r))
    if a.json:
        open(a.json, "w").write(json.dumps(r, indent=1, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
