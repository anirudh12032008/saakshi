"""Stage 6 pipeline: the cells' export -> radar -> history (annotation only) -> decision engine, as one AnalyticsRun JSON.

Deterministic, no LLM, no network. Nothing here penalises anyone: the output is advisory until a human signs it off.
"""

import argparse
import json
import sys

from saakshi_analytics import decide, history, radar

STRIP = ("history",)


def _core(flags):
    return [{k: v for k, v in f.items() if k not in STRIP} for f in flags]


def run(cohort_path, key, policy, incident, *, registry=None, evidence=(), centres=None, tickets=()):
    c = radar.load(cohort_path, key)
    flags = radar.run(c, device_camera_evidence=frozenset(evidence))
    queued = _core(flags)
    if registry is not None:
        flags = history.annotate(flags, c, registry)
        # The user's rule, enforced here as well as in history.annotate: history never adds, removes or changes a flag.
        if _core(flags) != queued:
            raise AssertionError("history changed the flag set; it may only annotate")
    roster, people = decide.load_cohort(cohort_path)
    d = decide.decide(policy, incident, roster, flags, c=c, people=people, centres=centres, tickets=list(tickets))
    report = decide.render(d)
    headline = next(line for line in report.splitlines() if line.startswith("Compensated "))
    notes = [f["history"] for f in flags if "history" in f]
    return {
        "v": 1, "incident": d["incident"], "headline": headline,
        "inputs": {"rows": int(c["state"].size), "cands": len(roster), "centres": len({r.split("/")[0] for r in roster.values()}),
                   "evidence": len(set(evidence) & set(roster))},
        "flags": flags, "history": {"annotated": len(notes), "corroborated": sum(bool(n.get("corroborates")) for n in notes)},
        "summary": d["summary"], "decision": d, "report": report,
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    for a in ("--cohort", "--key", "--policy", "--incident", "--json"):
        ap.add_argument(a, required=True)
    for a in ("--registry", "--evidence", "--centres", "--tickets"):
        ap.add_argument(a)
    a = ap.parse_args(argv)
    try:
        load = lambda p: json.loads(open(p).read())  # noqa: E731
        r = run(a.cohort, load(a.key), load(a.policy), load(a.incident),
                registry=load(a.registry) if a.registry else None, evidence=load(a.evidence) if a.evidence else (),
                centres=load(a.centres) if a.centres else None,
                tickets=[json.loads(x) for x in open(a.tickets) if x.strip()] if a.tickets else ())
    except (OSError, ValueError, KeyError) as e:
        print(f"pipeline: {e}", file=sys.stderr)
        raise SystemExit(2)
    files = {"cohort": a.cohort, "key": a.key, "policy": a.policy, "incident": a.incident, "registry": a.registry,
             "evidence": a.evidence, "centres": a.centres, "tickets": a.tickets}
    r["inputs"]["sha256"] = {k: decide.sha256(p) for k, p in files.items() if p}
    open(a.json, "w").write(json.dumps(r, indent=1, ensure_ascii=False, sort_keys=True) + "\n")
    print(r["headline"])


if __name__ == "__main__":
    main()
