"""Decision engine (M12 + S2): the NEET-UG 2024 Supreme Court tier-1 test and leak branches, per-candidate rules,
TOST comparability, percentile re-scoring, a greedy re-test allocator and dispute tickets.

python -m saakshi_analytics.decide --policy P.json --incident I.json --cohort COHORT.jsonl [--flags F.json]
    [--key key.json] [--centres centres.json] [--tickets T.jsonl] [--admit-cards CARDS.txt] [--json OUT]
Deterministic, no LLM. The report is advisory until a human signs it off; nobody is penalised by it.
"""

import argparse
import hashlib
import json

import numpy as np
from scipy import stats


def load_roster(path):
    """Cohort or cell-export JSONL -> {cand: "centre/shift"}. Streams; only the first row per candidate matters."""
    return load_cohort(path)[0]


def load_cohort(path):
    """-> (roster {cand: "centre/shift"}, people {cand: {"lang", "pwd"}}), from the first row per candidate."""
    roster, people = {}, {}
    for line in open(path):
        if line.strip():
            r = json.loads(line)
            if r["cand"] not in roster:
                roster[r["cand"]] = f"{r['centre']}/{r['shift']}"
                people[r["cand"]] = {"lang": r["lang"], "pwd": int(r["pwd"])}
    return roster, people


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


def leak_signals(t):
    """policy.tier1.leakSignal: one signal name, or a list (A4: speed-accuracy OR cusum)."""
    return {t["leakSignal"]} if isinstance(t["leakSignal"], str) else set(t["leakSignal"])


def tier1(policy, breach, roster, flags, n_items=None):
    rooms = set(roster.values())
    if not breach:
        return {"breach": False, "systemic": False, "separable": None, "fullReconduct": False, "branch": "none",
                "reasons": ["no breach alleged: tier 1 does not apply"]}, set(), []
    t = policy["tier1"]
    items = breach.get("items", [])
    if items and not n_items:
        raise ValueError("breach.items needs the cohort's responses to re-score: pass --key")
    sigs = leak_signals(t)
    names = " or ".join([t["leakSignal"]] if isinstance(t["leakSignal"], str) else t["leakSignal"])
    if breach.get("perimeter") == "unknown":
        per, outside, systemic, separable = set(), [], True, False
        reasons = ["(a) perimeter unknown: the breach cannot be bounded",
                   "(b) no perimeter, so beneficiaries cannot be separated"]
    else:
        per = expand(breach["perimeter"], rooms)
        leak = [f for f in flags if any(s["signal"] in sigs for s in f["signals"])]
        outside = [f for f in leak if roster[f["cand"]] not in per]
        share_out = len(outside) / len(leak) if leak else 0.0
        evidenced = per | {roster[f["cand"]] for f in leak}
        share_rooms = len(evidenced) / len(rooms)
        systemic = bool(breach.get("systemic")) or share_rooms >= t["systemicRoomShare"]
        separable = share_out <= t["maxLeakFlagShareOutsidePerimeter"]
        why_a = []
        if breach.get("systemic"):
            why_a.append(f"committee finding: {breach.get('evidence', 'systemic')}")
        why_a.append(f"breach evidenced in {len(evidenced)}/{len(rooms)} centre-shifts = {share_rooms:.0%} "
                     f"(systemic at >= {t['systemicRoomShare']:.0%})")
        why_b = (f"{len(outside)}/{len(leak)} radar {names} flags fall outside the declared perimeter = "
                 f"{share_out:.0%} (separable at <= {t['maxLeakFlagShareOutsidePerimeter']:.0%})"
                 if leak else "no radar leak flags supplied: separability rests on the declared perimeter")
        reasons = [f"(a) {'yes' if systemic else 'no'}: " + "; ".join(why_a), f"(b) {'yes' if separable else 'no'}: {why_b}"]
    share_items = len(items) / n_items if items else None
    cap = t["maxLeakedItemShare"]
    if systemic and items and share_items <= cap:
        branch, rc = "rescore", set()
        why_c = (f"re-score: {len(items)}/{n_items} items leaked = {share_items:.0%} (<= {cap:.0%}) and widespread: re-score "
                 f"everyone without them, equated by percentile within each shift; nothing is re-conducted")
    elif systemic and not separable:
        branch, rc = "full", rooms
        why_c = "full re-conduct: systemic and not separable" + (
            f" ({len(items)}/{n_items} items leaked = {share_items:.0%} > {cap:.0%}, too much of the paper to drop)"
            if items else "")
    else:
        branch, rc = ("separable" if systemic else "localised"), per
        why_c = (f"{'separable' if systemic else 'localised'}: re-conduct the perimeter's "
                 f"{len(per)} centre-shifts")
    reasons.append(f"(c) leak branch, {why_c}")
    return {"breach": True, "systemic": systemic, "separable": separable, "fullReconduct": branch == "full",
            "branch": branch, "reasons": reasons}, rc, outside


def raw_scores(c, marks, drop=()):
    """Marking scheme from policy.scoring (e.g. +4 / -1), over every item not in `drop`."""
    keep = ~np.isin(c["items"], list(drop))
    answered = (c["state"] == 2) | (c["state"] == 4)
    right = answered & (c["answer"] == c["key"])
    return marks["correct"] * right[:, keep].sum(1) + marks["wrong"] * (answered & ~right)[:, keep].sum(1)


def percentile(raw, group):
    """NTA-style percentile within each session: 100 x (number in the session with raw <= yours) / session size."""
    raw, group, out = np.asarray(raw), np.asarray(group), np.empty(len(raw))
    for g in np.unique(group):
        i = group == g
        out[i] = 100 * np.searchsorted(np.sort(raw[i]), raw[i], "right") / i.sum()
    return np.round(out, 4)


def rescore(policy, c, items):
    before, after = raw_scores(c, policy["scoring"]), raw_scores(c, policy["scoring"], items)
    pb, pa = percentile(before, c["shift"]), percentile(after, c["shift"])
    d = pa - pb
    worst = int(np.argmin(d))
    return {"items": list(items), "share": len(items) / len(c["items"]),
            "method": f"raw = {policy['scoring']['correct']:+d} per correct, {policy['scoring']['wrong']:+d} per wrong, "
                      "over the remaining items; percentile within each shift",
            "medianAbsDeltaPct": round(float(np.median(np.abs(d))), 2),
            "maxDrop": {"cand": str(c["cand"][worst]), "deltaPct": round(float(d[worst]), 2)},
            "candidates": [{"cand": x, "rawBefore": int(b), "rawAfter": int(a), "pctBefore": float(p), "pctAfter": float(q)}
                           for x, b, a, p, q in zip(c["cand"].tolist(), before, after, pb, pa)]}


def tost(x, y, delta, alpha):
    """Two one-sided Welch t-tests: equivalent if the mean difference is shown to lie inside (-delta, +delta)."""
    x, y = np.asarray(x, float), np.asarray(y, float)
    lo = stats.ttest_ind(x + delta, y, equal_var=False, alternative="greater").pvalue
    hi = stats.ttest_ind(x - delta, y, equal_var=False, alternative="less").pvalue
    p = float(max(lo, hi))
    return {"diff": round(float(x.mean() - y.mean()), 4), "p": p, "equivalent": bool(p <= alpha)}


def comparability(policy, c, comp, roster, start_min, exclude):
    """TOST on post-disruption residual scores: per candidate, mean(correct - P(correct | item, ability decile)) over
    items first answered after the disruption began; each compensated room vs every undisturbed candidate."""
    from saakshi_analytics import radar

    q = policy["comparability"]
    answered, correct, _, dec, p_cor, *_ = radar.features(c)
    resid = correct - p_cor[dec]
    idx = {x: i for i, x in enumerate(c["cand"].tolist())}
    groups = {}
    for x in comp:
        groups.setdefault(roster[x["cand"]], []).append(idx[x["cand"]])
    ctrl = np.array([i for x, i in idx.items() if x not in exclude])
    out = []
    for room, rows in sorted(groups.items()):
        use = answered & (c["tfirst"] >= start_min.get(room, 0) * 60_000)
        with np.errstate(invalid="ignore", divide="ignore"):
            r = (resid * use).sum(1) / use.sum(1)
        x, y = r[rows], r[ctrl]
        x, y = x[np.isfinite(x)], y[np.isfinite(y)]
        g = {"room": room, "n": len(x), "fromMin": start_min.get(room, 0)}
        if len(x) < q["nMin"]:
            out.append(g | {"result": "committee", "reason": f"n = {len(x)} < N_min = {q['nMin']}"})
            continue
        t = tost(x, y, q["deltaResidual"], q["alpha"])
        out.append(g | t | {"result": "equivalent" if t["equivalent"] else "not equivalent"}
                   | ({} if t["equivalent"] else {"reason": "compensation may not have restored comparability: committee"}))
    return out


def dist(a, b):
    return float(np.hypot(a["km"][0] - b["km"][0], a["km"][1] - b["km"][1]))


def allocate(cands, people, roster, centres):
    """Greedy re-test allocator: PwD candidates first (accessible seats are scarce), then by id; each takes the
    nearest centre (from their home centre) with a spare seat, their language, and PwD access if they need it."""
    seats = {k: v["spareSeats"] for k, v in centres.items()}
    out = []
    for x in sorted(cands, key=lambda x: (-people[x]["pwd"], x)):
        home, p = roster[x].split("/")[0], people[x]
        if home not in centres:
            raise ValueError(f"home centre {home!r} of {x} is not in the centres fixture")
        ok = [k for k, v in centres.items()
              if seats[k] > 0 and p["lang"] in v["langs"] and (v["pwdAccessible"] or not p["pwd"])]
        row = {"cand": x, "from": home, "lang": p["lang"], "pwd": p["pwd"]}
        if not ok:
            out.append(row | {"to": None, "km": None, "reason": "no centre with a spare seat, this language and the "
                                                                "access needed: committee"})
            continue
        k = min(ok, key=lambda k: (dist(centres[home], centres[k]), k))
        seats[k] -= 1
        out.append(row | {"to": k, "km": round(dist(centres[home], centres[k]), 1)})
    return sorted(out, key=lambda r: r["cand"])


def admit_cards(roster, centres, policy):
    """Mock admit cards (text), one per allocated re-test candidate, each with a short integrity hash."""
    rt, cards = policy["retest"], []
    for r in roster:
        if not r["to"]:
            continue
        cen = centres[r["to"]]
        body = [f"Candidate   {r['cand']}", f"Session     {rt['session']} · report by {rt['reportingTime']}",
                f"Centre      {r['to']} · {cen['name']}", f"Travel      {r['km']} km from {r['from']}",
                f"Medium      {r['lang']}",
                f"PwD         {'yes: accessible room, compensatory time, scribe on request' if r['pwd'] else 'no'}",
                "Scoring     percentile-normalised within the re-test session"]
        h = hashlib.sha256("\n".join(body).encode()).hexdigest()[:16]
        cards.append("\n".join(["==== SAAKSHI RE-TEST ADMIT CARD (MOCK) ====", *body, f"Card hash   {h}", ""]))
    return "\n".join(cards)


TICKET_FIELDS = ("cand", "item", "receipt", "reason")


def ticket_hash(t):
    return hashlib.sha256(json.dumps({k: t[k] for k in TICKET_FIELDS}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def objection(cand, item, receipt, reason):
    """A candidate's "raise objection" -> a minimal dispute ticket. The hash binds cand, item, receipt and reason."""
    t = {"cand": cand, "item": item, "receipt": receipt, "reason": reason}
    h = ticket_hash(t)
    return {"ticket": f"OBJ-{h[:10]}", **t, "status": "open", "hash": h}


def verify_ticket(t):
    return t.get("hash") == ticket_hash(t) and t.get("ticket") == f"OBJ-{t['hash'][:10]}"


def decide(policy, incident, roster, flags=(), c=None, people=None, centres=None, tickets=()):
    """c: the cohort arrays (radar.load) for comparability and re-scoring; people {cand: {lang, pwd}} and centres
    (the fixture) for the re-test allocator; tickets: dispute tickets to list. All optional."""
    rooms = set(roster.values())
    for x in [*incident.get("left", []), *incident.get("gaps", {}), *(f["cand"] for f in flags),
              *(t["cand"] for t in tickets)]:
        if x not in roster:
            raise ValueError(f"candidate {x!r} is not in the cohort")
    window, start = {}, {}
    for d in incident.get("disruptions", []):
        room = f"{d['centre']}/{d['shift']}"
        if room not in rooms:
            raise ValueError(f"disruption at {room!r}: no such centre-shift in the cohort")
        window[room] = window.get(room, 0) + d["toMin"] - d["fromMin"]
        start[room] = min(start.get(room, d["fromMin"]), d["fromMin"])

    t1, rc, outside = tier1(policy, incident.get("breach"), roster, list(flags), None if c is None else len(c["items"]))
    cap, n_review = policy["gapCapMin"], policy["reviewGapCount"]
    left, journal = set(incident.get("left", [])), incident.get("gaps", {})
    comp, retest, review = [], [], []
    for x in sorted(left | set(journal) | {x for x, r in roster.items() if r in window}):
        if roster[x] in rc:
            continue  # the whole centre-shift is re-conducted
        if x in left:
            retest.append({"cand": x, "reason": "left the centre or could not resume"})
            continue
        g = journal.get(x)
        g = [window[roster[x]]] if g is None else ([g] if isinstance(g, (int, float)) else g)
        total = sum(g)
        if total > cap:
            why = "never resumed (no gap-journal entry), so the whole window" if x not in journal else "credited gap"
            retest.append({"cand": x, "reason": f"{why} {total} min is beyond the {cap}-min cap"})
        else:
            comp.append({"cand": x, "extraMin": total})
        if len(g) >= n_review:
            review.append({"cand": x, "reason": f"{len(g)} gaps (review at >= {n_review})"})
    out_ids = {f["cand"] for f in outside}
    for f in flags:
        sig = ", ".join(s["signal"] for s in f["signals"])
        where = "outside the breach perimeter, " if f["cand"] in out_ids else ""
        review.append({"cand": f["cand"], "reason": f"radar {f['level']} ({sig}); {where}referred to the committee"})
    review.sort(key=lambda x: (x["cand"], x["reason"]))

    rc_cands = {x for x, r in roster.items() if r in rc}
    re_exam = rc_cands | {x["cand"] for x in retest}
    base = set(roster) if t1["breach"] else {x for x, r in roster.items() if r in window}
    spared = len(base - re_exam)
    per = policy["cost"]["reexamPerCandidateInr"]
    extra = {}
    if c is not None:
        exclude = {x for x, r in roster.items() if r in window or r in rc} | left | set(journal) | {f["cand"] for f in flags}
        extra["comparability"] = comparability(policy, c, comp, roster, start, exclude)
        if t1["branch"] == "rescore":
            extra["rescore"] = rescore(policy, c, incident["breach"]["items"])
    if people is None and c is not None:
        people = {x: {"lang": str(la), "pwd": int(pw)} for x, la, pw in zip(c["cand"].tolist(), c["lang"], c["pwd"])}
    if centres is not None and people is not None:
        extra["roster"] = allocate([x["cand"] for x in retest], people, roster, centres)
    tick = [{**t, "hashOk": verify_ticket(t)} for t in sorted(tickets, key=lambda t: (t["cand"], t["ticket"]))
            if t.get("status") == "open"]
    return {
        "incident": incident.get("id", ""),
        "policy": f"{policy['policy']} v{policy['version']}", "policyLabel": policy["label"],
        "summary": {
            "compensated": len(comp), "retested": len(retest),
            "reconductedCentres": len({r.split("/")[0] for r in rc}), "reconductedCentreShifts": len(rc),
            "reconductedCandidates": len(rc_cands), "baseline": len(base), "spared": spared,
            "inrAvoided": spared * per, "extraMinTotal": sum(x["extraMin"] for x in comp),
            "rescored": len(extra["rescore"]["candidates"]) if "rescore" in extra else 0, "openTickets": len(tick),
        },
        "tier1": t1, "reconduct": sorted(rc), "compensate": comp, "retest": retest, "review": review, **extra,
        "tickets": tick,
        "assumptions": [
            f"₹ avoided = spared × ₹{inr(per)} per candidate re-exam, from policy.cost. {policy['cost']['note']}",
            "spared = candidates in the counterfactual who are not re-examined; counterfactual = "
            + ("a full re-conduct of the whole cohort (a breach puts it on the table)" if t1["breach"]
               else "a blanket re-exam of every candidate in the disrupted centre-shifts"),
            f"credited gaps come from the M6 gap journal; a candidate in a disrupted centre-shift with no journal "
            f"entry is credited the whole window; compensation = extra time equal to the credited gap (cap {cap} min)",
            "comparability: TOST (two one-sided Welch t-tests) on post-disruption residual scores, each compensated "
            f"centre-shift vs every undisturbed candidate, margin ±{policy['comparability']['deltaResidual']}, "
            f"alpha {policy['comparability']['alpha']}; groups under N_min = {policy['comparability']['nMin']} go to the committee",
            "re-test seats: greedy, PwD first, nearest centre with a spare seat, the candidate's language and access "
            "(mock centre fixture); re-test scores are percentile-normalised within the re-test session",
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
        f"  => {'FULL RE-CONDUCT' if t['fullReconduct'] else 'RE-SCORE, no re-conduct' if t['branch'] == 'rescore' else 'no full re-conduct'}",
        f"Re-conduct: {s['reconductedCentreShifts']} centre-shifts, {s['reconductedCandidates']} candidates"
        + (f": {', '.join(r['reconduct'])}" if r["reconduct"] else ""),
    ]
    if r["compensate"]:
        ex = [x["extraMin"] for x in r["compensate"]]
        lines.append(f"Compensate {len(ex)}: extra time = credited gap, {min(ex)}-{max(ex)} min "
                     f"(total {s['extraMinTotal']} min); per-candidate list in --json")
    if "rescore" in r:
        rs = r["rescore"]
        lines.append(f"RE-SCORE {s['rescored']} candidates without {len(rs['items'])} items ({rs['share']:.0%}): "
                     f"{', '.join(rs['items'])}")
        lines.append(f"  {rs['method']}; median |Δ percentile| {rs['medianAbsDeltaPct']}, largest drop "
                     f"{rs['maxDrop']['cand']} {rs['maxDrop']['deltaPct']:+}; per-candidate list in --json")
    lines.append(f"Re-test {len(r['retest'])}:")
    lines += [f"  {x['cand']}  {x['reason']}" for x in r["retest"]]
    if "roster" in r:
        lines.append(f"Re-test roster ({len(r['roster'])}; greedy: PwD first, nearest centre with a seat, language, access):")
        lines.append("  cand     from    -> to       km    lang pwd")
        lines += [f"  {x['cand']}  {x['from']} -> {x['to'] or 'NONE':7} {'' if x['km'] is None else x['km']:>5}  "
                  f"{x['lang']:4} {'yes' if x['pwd'] else 'no'}" + (f"  {x['reason']}" if not x["to"] else "")
                  for x in r["roster"]]
    if r.get("comparability"):
        lines.append("Comparability (TOST on post-disruption residual scores):")
        for g in r["comparability"]:
            stat = f"diff {g['diff']:+.3f}, p {g['p']:.1e}" if "p" in g else g["reason"]
            lines.append(f"  {g['room']:10} n={g['n']:<4} from {g['fromMin']} min: {g['result']} ({stat})"
                         + (f"; {g['reason']}" if "p" in g and "reason" in g else ""))
    lines.append(f"Human review {len(r['review'])} (nothing is auto-penalised):")
    lines += [f"  {x['cand']}  {x['reason']}" for x in r["review"]]
    lines.append(f"Open dispute tickets {len(r['tickets'])}:")
    lines += [f"  {x['ticket']}  {x['cand']} {x['item']} receipt {x['receipt']}: {x['reason']}"
              f"  [{'hash ok' if x['hashOk'] else 'HASH MISMATCH'}]" for x in r["tickets"]]
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
    ap.add_argument("--key", help="answer key: loads the responses for comparability (TOST) and re-scoring")
    ap.add_argument("--centres", help="centre fixture (location, spare seats, PwD access, languages) for re-test seats")
    ap.add_argument("--tickets", help="dispute tickets JSONL (decide.objection)")
    ap.add_argument("--admit-cards", help="write mock re-test admit cards (text) here; needs --centres")
    ap.add_argument("--json", help="also write the report as JSON")
    a = ap.parse_args(argv)
    files = {"policy": a.policy, "incident": a.incident, "cohort": a.cohort, "flags": a.flags, "key": a.key,
             "centres": a.centres, "tickets": a.tickets}
    files = {k: v for k, v in files.items() if v}
    load = lambda p: json.loads(open(p).read())  # noqa: E731
    roster, people = load_cohort(a.cohort)
    c = None
    if a.key:
        from saakshi_analytics import radar
        c = radar.load(a.cohort, load(a.key))
    tickets = [json.loads(x) for x in open(a.tickets) if x.strip()] if a.tickets else []
    centres = load(a.centres) if a.centres else None
    policy = load(a.policy)
    r = decide(policy, load(a.incident), roster, load(a.flags) if a.flags else [], c=c, people=people,
               centres=centres, tickets=tickets)
    r["evidence"] = {k: sha256(p) for k, p in files.items()}
    print(render(r))
    if a.admit_cards:
        if "roster" not in r:
            raise SystemExit("--admit-cards needs --centres")
        open(a.admit_cards, "w").write(admit_cards(r["roster"], centres, policy))
    if a.json:
        open(a.json, "w").write(json.dumps(r, indent=1, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
