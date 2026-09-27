"""Act 5 goldens: the committee input on G1 as the cells export it (one shift, demo centre removed), and T-1 drill telemetry."""

import json

import pytest

from saakshi_analytics import generate, pipeline
from saakshi_analytics import scorecard as sc

DEMO_CENTRE = "CEN042"  # provision's default demo centre: real seats, so the swarm skips its G1 rows
SHIFT = "S1"  # the directory shift (Decision 3)
LEAK_SIGNALS = ("speed-accuracy", "cusum")

SMALL_HEADLINE = "Compensated 0 · Re-tested 193 · Re-conducted 3 centres · Spared 1,190 · ₹ avoided 17,85,000"
FULL_HEADLINE = "Compensated 0 · Re-tested 225 · Re-conducted 3 centres · Spared 18,994 · ₹ avoided 2,84,91,000"


def _merged(path, out):
    """Decision 3: one shift; the demo centre's rows removed."""
    with open(path) as f, open(out, "w") as o:
        for line in f:
            r = json.loads(line)
            if r["centre"] != DEMO_CENTRE:
                o.write(json.dumps(r | {"shift": SHIFT}) + "\n")
    return out


def truth_leak_centres(truth):
    """Planted leak centres still in the merged cohort: the declared leak's, plus the mid-exam leak's."""
    return sorted({*truth["leak"]["centres"], truth["midLeak"]["centre"]} - {DEMO_CENTRE})


def honest_flags(flags, truth):
    """Flags on candidates in no planted set (look-alikes included)."""
    planted = {*truth["leak"]["cands"], *truth["midLeak"]["cands"], *(m for r in truth["rings"] for m in r["members"])}
    return [f for f in flags if f["cand"] not in planted]


def _act5(out, tmp_path, incident):
    r = pipeline.run(_merged(out / "cohort.jsonl", tmp_path / "export.jsonl"), json.loads((out / "key.json").read_text()),
                     json.loads(open("policy.illustrative.json").read()), json.loads(open(incident).read()))
    truth = json.loads((out / "truth.json").read_text())
    leak_flagged = {f["centre"] for f in r["flags"] if any(s["signal"] in LEAK_SIGNALS for s in f["signals"])}
    return r, truth, leak_flagged


def _check_incident(path, truth, centre):
    inc = json.loads(open(path).read())
    assert inc["id"] == "Act 5 — Centre 42 outage and the declared leak"
    assert inc["disruptions"] == [{"centre": centre, "shift": SHIFT, "fromMin": 40, "toMin": 160}]
    assert "gaps" not in inc and "left" not in inc
    assert inc["breach"]["perimeter"] == truth["leak"]["centres"] and inc["breach"]["systemic"] is False


def test_act5_small_pinned(small, tmp_path):
    """2k G1 (seed 7), one shift: the Act 5 committee input gives exactly these numbers."""
    out, _, _ = small
    r, truth, leak_flagged = _act5(out, tmp_path, "golden/act5-small.incident.json")
    _check_incident("golden/act5-small.incident.json", truth, "CEN002")
    assert r["headline"] == SMALL_HEADLINE
    assert set(truth_leak_centres(truth)) <= leak_flagged  # every planted leak centre carries a leak flag
    assert honest_flags(r["flags"], truth) == []  # look-alikes and honest candidates: nothing


@pytest.mark.full
def test_act5_20k_pinned(tmp_path):
    """The deck's numbers: 20k G1 (seed 7), one shift, CEN042 removed (it is the real demo centre)."""
    out = tmp_path / "g1"
    generate.main([str(out), "--seed", "7"])
    r, truth, leak_flagged = _act5(out, tmp_path, "golden/act5.incident.json")
    _check_incident("golden/act5.incident.json", truth, "CEN002")  # CEN042 has no export rows
    assert r["headline"] == FULL_HEADLINE
    assert set(truth_leak_centres(truth)) <= leak_flagged
    assert honest_flags(r["flags"], truth) == []


def test_drill_scorecard_puts_cen042_at_add_observer():
    model = sc.fit(sc.simulate(sc.HISTORY_N, 1))
    rows = sc.scorecard(model, json.loads(open("drill.mock.json").read()))
    by = {r["centre"]: r for r in rows}
    assert len(rows) == 100 and by["CEN042"]["decision"] == "add observer"
    assert sum(r["decision"] == "do not allot" for r in rows) <= 2
