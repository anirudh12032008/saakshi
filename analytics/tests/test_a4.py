"""A4 (S2): TOST comparability, leak branches, percentile equating, re-test allocator, dispute tickets,
and tier-1 leak evidence = signal 1 OR signal 3."""

import copy
import json
import pathlib

import numpy as np
import pytest

from saakshi_analytics import decide

HERE = pathlib.Path(__file__).resolve().parents[1]
POLICY = HERE / "policy.illustrative.json"
GOLDEN = HERE / "golden"
CENTRES = HERE / "centres.mock.json"
ROSTER = {f"c{r}{i}": room for r, room in enumerate(["A/S1", "B/S1", "C/S1"]) for i in range(4)}


def policy():
    return json.loads(POLICY.read_text())


def flag(cand, room, signal):
    centre, shift = room.split("/")
    return {"cand": cand, "centre": centre, "shift": shift, "level": "watch",
            "signals": [{"signal": signal, "reason": "r", "observed": 9, "expected": 1.0, "p": 1e-9}]}


# ---- tier 1: leak evidence is signal 1 OR signal 3 ------------------------------------------------
def test_policy_counts_speed_accuracy_or_cusum_as_leak_evidence():
    assert set(policy()["tier1"]["leakSignal"]) == {"speed-accuracy", "cusum"}


@pytest.mark.parametrize("signal,separable", [("cusum", False), ("speed-accuracy", False), ("same-room", True)])
def test_cusum_flags_now_count_towards_separability(signal, separable):
    flags = [flag(c, room, signal) for c, room in ROSTER.items() if room != "A/S1"]
    r = decide.decide(policy(), {"id": "t", "breach": {"perimeter": ["A"], "systemic": True}}, ROSTER, flags)
    assert r["tier1"]["separable"] is separable and r["tier1"]["fullReconduct"] is (not separable)


def test_a_single_string_leak_signal_still_works():
    p = policy()
    p["tier1"]["leakSignal"] = "speed-accuracy"
    flags = [flag(c, room, "cusum") for c, room in ROSTER.items() if room != "A/S1"]
    r = decide.decide(p, {"id": "t", "breach": {"perimeter": ["A"], "systemic": True}}, ROSTER, flags)
    assert r["tier1"]["separable"] is True  # cusum not counted under the old single-signal policy


# ---- percentile equating --------------------------------------------------------------------------
def test_percentile_is_nta_style_within_each_session():
    raw = np.array([10, 20, 20, 30, 5, 50])
    grp = np.array(["S1", "S1", "S1", "S1", "S2", "S2"])
    assert decide.percentile(raw, grp).tolist() == [25.0, 75.0, 75.0, 100.0, 50.0, 100.0]


# ---- TOST -----------------------------------------------------------------------------------------
def test_tost_equivalent_only_when_both_one_sided_tests_reject():
    rng = np.random.default_rng(0)
    y = rng.normal(0, 0.1, 2000)
    assert decide.tost(rng.normal(0, 0.1, 200), y, 0.05, 0.05)["equivalent"]
    assert not decide.tost(rng.normal(0.15, 0.1, 200), y, 0.05, 0.05)["equivalent"]  # 3 delta off
    assert not decide.tost(rng.normal(0, 0.1, 4), y, 0.05, 0.05)["equivalent"]  # too few to show equivalence


# ---- leak branches on the G1 small cohort ----------------------------------------------------------
def roster_of(c):
    return {x: f"{a}/{b}" for x, a, b in zip(c["cand"].tolist(), c["centre"].tolist(), c["shift"].tolist())}


@pytest.mark.parametrize("n_items,systemic,branch", [
    (10, True, "rescore"),     # <= 10% of items and widespread -> re-score without them
    (11, True, "full"),        # 11% > 10%: re-scoring would drop too much; systemic, not separable
    (10, False, "localised"),  # localised -> re-conduct the perimeter's centre-shifts
])
def test_leak_branches(small, n_items, systemic, branch):
    _, c, truth = small
    per = "unknown" if systemic else ["CEN005"]
    inc = {"id": "t", "breach": {"perimeter": per, "systemic": systemic, "items": truth["leak"]["items"][:n_items]}}
    r = decide.decide(policy(), inc, roster_of(c), c=c)
    assert r["tier1"]["branch"] == branch
    s = r["summary"]
    if branch == "rescore":
        assert r["reconduct"] == [] and s["spared"] == 2000 and s["rescored"] == 2000
    elif branch == "full":
        assert s["reconductedCentreShifts"] == 30 and "rescore" not in r
    else:
        assert r["reconduct"] == ["CEN005/S1", "CEN005/S2", "CEN005/S3"] and "rescore" not in r


def test_rescore_takes_the_leak_benefit_away_from_the_buyers_not_the_honest(small):
    _, c, truth = small
    inc = {"id": "t", "breach": {"perimeter": "unknown", "systemic": True, "items": truth["leak"]["items"][:10]}}
    rs = decide.decide(policy(), inc, roster_of(c), c=c)["rescore"]
    d = {x["cand"]: x["pctAfter"] - x["pctBefore"] for x in rs["candidates"]}
    buyers = set(truth["leak"]["cands"])
    assert np.mean([v for k, v in d.items() if k in buyers]) < -3
    assert abs(np.mean([v for k, v in d.items() if k not in buyers])) < 0.5
    assert rs["items"] == truth["leak"]["items"][:10] and rs["share"] == 0.1


def test_items_without_responses_are_rejected():
    with pytest.raises(ValueError, match="--key"):
        decide.decide(policy(), {"id": "t", "breach": {"perimeter": "unknown", "items": ["I01"]}}, ROSTER)


# ---- comparability --------------------------------------------------------------------------------
def cuet():
    return json.loads((GOLDEN / "cuet-2026.incident.json").read_text())


def test_comparability_on_the_cuet_replay(small):
    _, c, _ = small
    comp = decide.decide(policy(), cuet(), roster_of(c), c=c)["comparability"]
    rooms = {g["room"]: g for g in comp}
    for room in ("CEN002/S1", "CEN004/S1", "CEN007/S1"):
        assert rooms[room]["result"] == "equivalent" and rooms[room]["n"] >= policy()["comparability"]["nMin"]
    small_groups = [g for g in comp if g["n"] < policy()["comparability"]["nMin"]]
    assert small_groups and all(g["result"] == "committee" for g in small_groups)


def test_comparability_catches_a_group_that_was_hurt_after_the_disruption(small):
    _, c, _ = small
    c = copy.deepcopy(c)
    inc = cuet()
    room = (c["centre"] == "CEN002") & (c["shift"] == "S1")
    late = room[:, None] & (c["tfirst"] >= 40 * 60_000)
    c["answer"][late & (c["answer"] == c["key"])] = (c["key"][None, :].repeat(len(room), 0)[late & (c["answer"] == c["key"])] + 1) % 4
    comp = {g["room"]: g for g in decide.decide(policy(), inc, roster_of(c), c=c)["comparability"]}
    assert comp["CEN002/S1"]["result"] == "not equivalent" and comp["CEN004/S1"]["result"] == "equivalent"


# ---- re-test allocator ----------------------------------------------------------------------------
TOY = {
    "H": {"name": "Home", "km": [0, 0], "spareSeats": 1, "pwdAccessible": False, "langs": ["en"]},
    "N": {"name": "Near", "km": [5, 0], "spareSeats": 2, "pwdAccessible": True, "langs": ["en", "hi"]},
    "F": {"name": "Far", "km": [50, 0], "spareSeats": 10, "pwdAccessible": True, "langs": ["en", "ta"]},
}


def test_allocator_is_greedy_nearest_with_seats_pwd_and_language():
    roster = {k: "H/S1" for k in ("a", "b", "p", "t", "u")}
    people = {"a": {"lang": "en", "pwd": 0}, "b": {"lang": "en", "pwd": 0}, "p": {"lang": "en", "pwd": 1},
              "t": {"lang": "ta", "pwd": 0}, "u": {"lang": "ur", "pwd": 0}}
    got = {x["cand"]: x["to"] for x in decide.allocate(["a", "b", "p", "t", "u"], people, roster, TOY)}
    # PwD first: H has no access, so p -> N; a takes H's only seat; b -> N (1 left); t needs Tamil -> F
    assert got == {"a": "H", "b": "N", "p": "N", "t": "F", "u": None}


def test_allocator_rejects_a_home_centre_missing_from_the_fixture():
    with pytest.raises(ValueError, match="Z"):
        decide.allocate(["a"], {"a": {"lang": "en", "pwd": 0}}, {"a": "Z/S1"}, TOY)


# ---- dispute tickets ------------------------------------------------------------------------------
def test_objection_ticket_hash_and_listing():
    t = decide.objection("c00", "I12", "RC-1A2B-3C4D", "Hindi text points to a different option")
    assert t["status"] == "open" and t["ticket"].startswith("OBJ-") and decide.verify_ticket(t)
    bad = t | {"reason": "edited later"}
    assert not decide.verify_ticket(bad)
    r = decide.decide(policy(), {"id": "t"}, ROSTER, tickets=[t, bad])
    assert [x["hashOk"] for x in r["tickets"]] == [True, False]
    assert r["tickets"][0]["receipt"] == "RC-1A2B-3C4D"
    with pytest.raises(ValueError, match="zz"):
        decide.decide(policy(), {"id": "t"}, ROSTER, tickets=[decide.objection("zz", "I01", "RC", "x")])


# ---- the full golden report through the CLI -------------------------------------------------------
def test_full_cuet_report_with_roster_admit_cards_and_tickets(small, tmp_path, capsys):
    out, _, _ = small
    argv = ["--policy", str(POLICY), "--incident", str(GOLDEN / "cuet-2026.incident.json"),
            "--cohort", str(out / "cohort.jsonl"), "--key", str(out / "key.json"), "--centres", str(CENTRES),
            "--tickets", str(GOLDEN / "tickets.jsonl"), "--admit-cards", str(tmp_path / "cards.txt"),
            "--json", str(tmp_path / "r.json")]
    decide.main(argv)
    r = json.loads((tmp_path / "r.json").read_text())
    text = capsys.readouterr().out
    assert "Compensated 161 · Re-tested 29 · Re-conducted 0 centres · Spared 160 · ₹ avoided 2,40,000" in text
    roster = r["roster"]
    assert len(roster) == 29 and all(x["to"] for x in roster)
    centres = json.loads(CENTRES.read_text())
    used = {}
    for x in roster:
        used[x["to"]] = used.get(x["to"], 0) + 1
        assert x["lang"] in centres[x["to"]]["langs"]
    assert all(n <= centres[k]["spareSeats"] for k, n in used.items())
    assert "Re-test roster" in text and "C00796" in text
    cards = (tmp_path / "cards.txt").read_text()
    assert cards.count("ADMIT CARD") == 29 and "C00137" in cards
    assert len(r["tickets"]) == 2 and all(t["hashOk"] for t in r["tickets"]) and "Open dispute tickets 2" in text
    assert {"tickets", "centres", "key"} <= set(r["evidence"])
    assert "Comparability" in text


def test_golden_rescore_case(small, tmp_path, capsys):
    out, _, truth = small
    inc = json.loads((GOLDEN / "rescore-items.incident.json").read_text())
    assert set(inc["breach"]["items"]) <= set(truth["leak"]["items"]) and len(inc["breach"]["items"]) == 10
    decide.main(["--policy", str(POLICY), "--incident", str(GOLDEN / "rescore-items.incident.json"),
                 "--cohort", str(out / "cohort.jsonl"), "--key", str(out / "key.json"), "--json", str(tmp_path / "r.json")])
    r = json.loads((tmp_path / "r.json").read_text())
    assert r["tier1"]["branch"] == "rescore" and r["summary"]["spared"] == 2000 and r["summary"]["inrAvoided"] == 2000 * 1500
    assert "RE-SCORE" in capsys.readouterr().out
