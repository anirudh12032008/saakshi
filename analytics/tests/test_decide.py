import hashlib
import json
import pathlib

import pytest

from saakshi_analytics import decide, radar

HERE = pathlib.Path(__file__).resolve().parents[1]
POLICY = HERE / "policy.illustrative.json"
GOLDEN = HERE / "golden"


def policy():
    return json.loads(POLICY.read_text())


# ---- tiny hand-built cohort: 3 rooms of 4 -------------------------------------------------------
ROSTER = {f"c{r}{i}": room for r, room in enumerate(["A/S1", "B/S1", "C/S1"]) for i in range(4)}


def leak_flag(cand, room):
    centre, shift = room.split("/")
    return {"cand": cand, "centre": centre, "shift": shift, "level": "watch",
            "signals": [{"signal": "speed-accuracy", "reason": "r", "observed": 9, "expected": 1.0, "p": 1e-9}]}


def test_policy_is_labelled_illustrative_with_committee_parameters():
    p = policy()
    assert "ILLUSTRATIVE" in p["label"]
    assert p["gapCapMin"] == 30 and p["reviewGapCount"] == 2
    assert p["cost"]["reexamPerCandidateInr"] > 0


def test_per_candidate_gap_rules():
    inc = {"id": "t", "disruptions": [{"centre": "A", "shift": "S1", "fromMin": 10, "toMin": 130}],
           "gaps": {"c00": [30], "c01": [31], "c02": [12, 10], "c10": [5]}, "left": ["c03", "c11"]}
    r = decide.decide(policy(), inc, ROSTER)
    comp = {x["cand"]: x["extraMin"] for x in r["compensate"]}
    rete = {x["cand"]: x["reason"] for x in r["retest"]}
    assert comp == {"c00": 30, "c02": 22, "c10": 5}  # at the cap is within it; extra time = credited gap
    assert set(rete) == {"c01", "c03", "c11"}
    assert "beyond" in rete["c01"] and "left" in rete["c03"]
    assert [x["cand"] for x in r["review"]] == ["c02"]  # 2 gaps -> review flag
    s = r["summary"]
    assert (s["compensated"], s["retested"], s["reconductedCentres"]) == (3, 3, 0)
    # counterfactual for a disruption-only incident = blanket re-exam of the disrupted room (4 candidates)
    assert s["baseline"] == 4 and s["spared"] == 2  # c00, c02 spared; c01, c03 re-tested
    assert s["inrAvoided"] == 2 * policy()["cost"]["reexamPerCandidateInr"]


def test_no_journal_entry_in_disrupted_room_means_the_whole_window():
    inc = {"id": "t", "disruptions": [{"centre": "A", "shift": "S1", "fromMin": 0, "toMin": 20}]}
    r = decide.decide(policy(), inc, ROSTER)
    assert {x["cand"]: x["extraMin"] for x in r["compensate"]} == {f"c0{i}": 20 for i in range(4)}


@pytest.mark.parametrize("declared,flag_rooms,systemic,separable", [
    (False, ["A/S1"], False, True),           # localised, leak flags inside the perimeter
    (True, ["A/S1"], True, True),             # systemic but separable -> no full re-conduct
    (True, ["A/S1", "B/S1", "C/S1"], True, False),  # systemic, and leak flags escape the perimeter
    (False, ["A/S1", "B/S1"], True, False),   # not declared, but the flags alone cover >= half the rooms
])
def test_tier1_full_reconduct_only_when_systemic_and_not_separable(declared, flag_rooms, systemic, separable):
    inc = {"id": "t", "breach": {"perimeter": ["A"], "systemic": declared}}
    flags = [leak_flag(c, room) for c, room in ROSTER.items() if room in flag_rooms]
    r = decide.decide(policy(), inc, ROSTER, flags)
    full = systemic and not separable
    assert (r["tier1"]["systemic"], r["tier1"]["separable"], r["tier1"]["fullReconduct"]) == (systemic, separable, full)
    assert r["reconduct"] == (["A/S1", "B/S1", "C/S1"] if full else ["A/S1"])


def test_not_systemic_and_not_separable_reconducts_perimeter_and_refers_the_rest():
    p = policy()
    p["tier1"]["systemicRoomShare"] = 0.9
    flags = [leak_flag(c, room) for c, room in ROSTER.items() if room in ("A/S1", "B/S1")]
    r = decide.decide(p, {"id": "t", "breach": {"perimeter": ["A"]}}, ROSTER, flags)
    assert (r["tier1"]["systemic"], r["tier1"]["separable"], r["tier1"]["fullReconduct"]) == (False, False, False)
    assert r["reconduct"] == ["A/S1"]
    assert {x["cand"] for x in r["review"]} == {c for c, room in ROSTER.items() if room in ("A/S1", "B/S1")}


def test_unknown_perimeter_is_systemic_and_not_separable():
    r = decide.decide(policy(), {"id": "t", "breach": {"perimeter": "unknown"}}, ROSTER)
    t = r["tier1"]
    assert (t["systemic"], t["separable"], t["fullReconduct"]) == (True, False, True)
    assert r["summary"]["spared"] == 0 and r["summary"]["inrAvoided"] == 0


def test_breach_spread_over_half_the_rooms_is_systemic_evidence():
    r = decide.decide(policy(), {"id": "t", "breach": {"perimeter": ["A", "B"]}}, ROSTER)
    assert r["tier1"]["systemic"] and r["tier1"]["separable"] and not r["tier1"]["fullReconduct"]


def test_reconducted_rooms_trump_per_candidate_rules():
    inc = {"id": "t", "breach": {"perimeter": ["A/S1"]}, "gaps": {"c00": [5], "c10": [5]}, "left": ["c01"]}
    r = decide.decide(policy(), inc, ROSTER)
    assert [x["cand"] for x in r["compensate"]] == ["c10"] and r["retest"] == []


def test_rejects_unknown_candidates_and_centres():
    with pytest.raises(ValueError, match="zz"):
        decide.decide(policy(), {"id": "t", "left": ["zz"]}, ROSTER)
    with pytest.raises(ValueError, match="Q"):
        decide.decide(policy(), {"id": "t", "breach": {"perimeter": ["Q"]}}, ROSTER)
    with pytest.raises(ValueError, match="Q/S9"):
        decide.decide(policy(), {"id": "t", "disruptions": [{"centre": "Q", "shift": "S9", "fromMin": 0, "toMin": 1}]}, ROSTER)


# ---- golden cases on the G1 small cohort (seed 7, 2k candidates, 10 centres x 3 shifts) ---------
@pytest.fixture(scope="module")
def g1(small, tmp_path_factory):
    out, cohort, truth = small
    flags = tmp_path_factory.mktemp("flags") / "flags.json"
    radar.main([str(out / "cohort.jsonl"), "--key", str(out / "key.json"), "--json", str(flags)])
    return out / "cohort.jsonl", flags, truth


def run_golden(g1, name, with_flags, tmp_path):
    cohort, flags, _ = g1
    out = tmp_path / f"{name}.json"
    argv = ["--policy", str(POLICY), "--incident", str(GOLDEN / f"{name}.incident.json"), "--cohort", str(cohort),
            "--json", str(out)] + (["--flags", str(flags)] if with_flags else [])
    decide.main(argv)
    return json.loads(out.read_text())


def test_golden_cuet_2026_replay(g1, tmp_path, capsys):
    r = run_golden(g1, "cuet-2026", False, tmp_path)
    inc = json.loads((GOLDEN / "cuet-2026.incident.json").read_text())
    left = set(inc["left"])
    assert {x["cand"] for x in r["retest"]} >= left
    assert all(x["extraMin"] <= 30 for x in r["compensate"])
    assert not left & {x["cand"] for x in r["compensate"]}
    assert r["tier1"]["fullReconduct"] is False and r["reconduct"] == []
    s = r["summary"]
    assert (s["compensated"], s["retested"], s["reconductedCentres"], s["spared"]) == (161, 29, 0, 160)
    assert s["inrAvoided"] == 160 * 1500
    text = capsys.readouterr().out
    assert "Compensated 161 · Re-tested 29 · Re-conducted 0 centres · Spared 160 · ₹ avoided" in text
    assert "ILLUSTRATIVE" in text and "sign-off" in text


def test_golden_neet_2024_separable(g1, tmp_path):
    r = run_golden(g1, "neet-2024-separable", True, tmp_path)
    t = r["tier1"]
    assert (t["systemic"], t["separable"], t["fullReconduct"]) == (False, True, False)
    assert set(r["reconduct"]) == {f"{c}/S{s}" for c in ("CEN005", "CEN009", "CEN010") for s in (1, 2, 3)} | {"CEN008/S2"}
    s = r["summary"]
    assert s["reconductedCentres"] == 4 and s["reconductedCentreShifts"] == 10
    assert 0 < s["reconductedCandidates"] < 2000 / 2 and s["spared"] == 2000 - s["reconductedCandidates"]
    # leak beneficiaries the radar found are all inside the perimeter; rings go to human review, not penalties
    assert r["review"] and all(x["reason"].startswith("radar") for x in r["review"])


def test_golden_systemic_not_separable(g1, tmp_path):
    r = run_golden(g1, "systemic", True, tmp_path)
    t = r["tier1"]
    assert (t["systemic"], t["separable"], t["fullReconduct"]) == (True, False, True)
    s = r["summary"]
    assert (s["reconductedCentres"], s["reconductedCentreShifts"], s["reconductedCandidates"]) == (10, 30, 2000)
    assert (s["compensated"], s["retested"], s["spared"], s["inrAvoided"]) == (0, 0, 0, 0)


def test_report_is_deterministic_and_carries_evidence_hashes(g1, tmp_path):
    (tmp_path / "a").mkdir(), (tmp_path / "b").mkdir()
    a = run_golden(g1, "neet-2024-separable", True, tmp_path / "a")
    b = run_golden(g1, "neet-2024-separable", True, tmp_path / "b")
    assert (tmp_path / "a/neet-2024-separable.json").read_bytes() == (tmp_path / "b/neet-2024-separable.json").read_bytes()
    cohort, flags, _ = g1
    for k, path in [("policy", POLICY), ("incident", GOLDEN / "neet-2024-separable.incident.json"),
                    ("cohort", cohort), ("flags", flags)]:
        assert a["evidence"][k] == hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
    assert a["signoff"]["status"] == "PENDING"
