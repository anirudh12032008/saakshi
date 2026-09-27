"""A3 (S1): signal 3 CUSUM, history corroboration, G2, calibration, fairness breakdown."""

import copy
import hashlib
import json

import numpy as np
import pytest

from saakshi_analytics import evaluate, generate, history, radar


def planted(truth):
    return set(truth["leak"]["cands"]) | set(truth["midLeak"]["cands"]) | {x for r in truth["rings"] for x in r["members"]}


# ---------- signal 3: CUSUM ----------

def test_page_cusum_finds_the_change_point():
    rng = np.random.default_rng(0)
    inc = np.full((80, 3), -0.3)  # in control: drifts down
    inc[rng.choice(80, 4, replace=False), 1:] = 2.0  # isolated blips in columns 1-2
    inc[50:, 0] = 2.0  # column 0 shifts at row 50 and stays shifted
    start, end = radar.page(inc)
    assert start[0] == 50 and end[0] == 80
    assert (end[1:] - start[1:] <= 8).all()  # blips give short segments, never a sustained one


def inject_mid_leak(c, truth, t_ms=45 * 60_000, frac=0.8, seed=0):
    """Plant a dense mid-exam leak in one honest room of a copy of the cohort: every leaked item first
    reached after t_ms is answered correctly and 4x faster. Returns (cohort, planted candidate ids)."""
    c = copy.deepcopy(c)
    rng = np.random.default_rng(seed)
    room = np.char.add(np.char.add(c["centre"], "/"), c["shift"])
    bad = {f"{x['centre']}/{x['shift']}" for x in [truth["midLeak"], *truth["rings"]]} | {
        f"{cen}/S{s}" for cen in truth["leak"]["centres"] for s in (1, 2, 3)}
    r = next(r for r in np.unique(room) if r not in bad)
    idx = np.flatnonzero(room == r)
    who = rng.choice(idx, round(frac * len(idx)), replace=False)
    cols = np.isin(c["items"], truth["leak"]["items"])
    for i in who:
        after = cols & (c["tfirst"][i] - c["dwell"][i] > t_ms) & (c["state"][i] != 0)
        c["answer"][i, after], c["state"][i, after] = c["key"][after], 2
        c["dwell"][i, after] //= 4
    return c, set(c["cand"][who].tolist()), r


def test_cusum_catches_a_dense_mid_exam_leak_and_dates_it(small):
    _, c, truth = small
    c2, who, room = inject_mid_leak(c, truth)
    flags = radar.run(c2)
    got = {f["cand"] for f in flags if any(s["signal"] == "cusum" for s in f["signals"])}
    assert len(got & who) >= 0.6 * len(who)
    assert got <= who | planted(truth)  # nobody else in that room, or anywhere, is dragged in
    s3 = [s for f in flags if f["cand"] in who for s in f["signals"] if s["signal"] == "cusum"]
    assert all(s["room"] == room for s in s3)
    assert all(35 <= s["changeMin"] <= 60 for s in s3), sorted({s["changeMin"] for s in s3})
    for s in s3:
        assert s["observed"] > s["expected"] and 0 <= s["p"] <= radar.ALPHA_CUSUM_CAND and s["reason"]


def test_cusum_stays_quiet_on_honest_rooms(small):
    _, c, truth = small
    honest = ~np.isin(c["cand"], list(planted(truth)))
    s = radar.scores(radar.subset(c, honest))
    assert s["cells"]["q"].min() > radar.Q_CUSUM
    assert not radar.run(radar.subset(c, honest))


# ---------- escalation ----------

def test_escalation_ladder():
    assert radar.level(1) == "watch"
    assert radar.level(2) == radar.level(3) == "review"
    assert radar.level(1, device_camera_evidence=True) == "watch"  # evidence alone never escalates one signal
    assert radar.level(2, device_camera_evidence=True) == "escalate"


# ---------- history: corroboration only ----------

def test_registry_is_keyed_by_apaar_and_holds_improvers_past(small):
    out, _, truth = small
    reg = json.loads((out / "registry.json").read_text())
    assert all(len(a) == 12 and a.isdigit() for a in reg["apaar"].values())
    for x in truth["lookalikes"]["improvers"]:
        assert reg["pastPct"][reg["apaar"][x["cand"]]] == x["pastPct"]
    assert "registry" not in truth  # the registry is a separate data source, not ground truth


def test_history_only_annotates_queued_flags(small):
    """HARD INVARIANT (user decision): history never creates, removes, escalates or de-escalates a flag."""
    out, c, truth = small
    reg = json.loads((out / "registry.json").read_text())
    flags = radar.run(c)
    before = copy.deepcopy(flags)
    # adversarial registry: everyone has a past at the 1st percentile, so every candidate looks like a jump
    worst = {"apaar": reg["apaar"], "pastPct": {a: 1.0 for a in reg["apaar"].values()}}
    for r in (reg, worst):
        got = history.annotate(flags, c, r)
        assert flags == before  # input untouched
        assert [f["cand"] for f in got] == [f["cand"] for f in before]
        for g, f in zip(got, before):
            assert {k: v for k, v in g.items() if k != "history"} == f
            assert "history" in g and g["history"]["note"]
    assert history.annotate([], c, worst) == []  # no queued flags -> nothing, whatever history says


def test_history_puts_leakers_above_expected(small):
    """Leak buyers score above past + typical gain. So do genuine improvers, which is why history may only
    annotate: it cannot tell the two apart."""
    out, c, truth = small
    reg = json.loads((out / "registry.json").read_text())
    fake = [{"cand": x, "level": "watch", "signals": []} for x in truth["leak"]["cands"]]
    gaps = [f["history"]["gap"] for f in history.annotate(fake, c, reg) if "gap" in f["history"]]
    assert len(gaps) >= 5 and np.median(gaps) > 5


# ---------- G2 ----------

def test_g2_differs_from_g1(tmp_path):
    g1, _, t1 = generate.generate(600, 10, 3)
    g2, _, t2 = generate.generate(600, 10, 3, profile="G2")
    assert t1["effects"]["profile"] == "G1" and t2["effects"]["profile"] == "G2"
    assert t2["effects"]["rt"] != t1["effects"]["rt"] and t2["effects"]["midLeakAtS"] != t1["effects"]["midLeakAtS"]
    assert not np.array_equal(g1["dwell"], g2["dwell"])
    generate.main([str(tmp_path), "--n", "600", "--centres", "10", "--profile", "G2"])
    assert json.loads((tmp_path / "truth.json").read_text())["effects"]["profile"] == "G2"


def test_g1_stream_unchanged_by_a3(small):
    """G1 must stay byte-identical so A1/A2 results (README, golden cases) still hold."""
    out, _, _ = small
    digest = hashlib.sha256((out / "cohort.jsonl").read_bytes()).hexdigest()
    assert digest == "4ce16872eb3fcbaf0d19d748cb54cd873641fa19716ff7f965e9b42810bcc512"  # the A2 golden cases' cohort


def test_calibration_uses_honest_data_only(small):
    _, c, truth = small
    th = radar.calibrate(radar.subset(c, ~np.isin(c["cand"], list(planted(truth)))))
    assert set(th) == set(radar.DEFAULTS)
    for k, cap in radar.CAPS.items():
        assert 0 < th[k] <= cap
    with pytest.raises(ValueError):
        radar.calibrate(c, truth=truth)  # refuses a cohort that still contains planted candidates


def test_evaluate_g2_small(capsys):
    r = evaluate.main(["--n", "2000", "--centres", "10"])
    text = capsys.readouterr().out
    for word in ["G2", "speed-accuracy", "same-room", "cusum", "precision", "recall", "FPR", "lang", "pwd", "centre",
                 "mid-exam", "history", "calibrated"]:
        assert word in text, word
    g2 = r["g2"]
    assert g2["honest_fpr"] <= 0.01
    assert g2["signals"]["same-room"]["recall"] >= 0.5
    fair = r["fairness"]
    assert set(fair["lang"]) == {"en", "hi", "ta"} and set(fair["pwd"]) == {"0", "1"}
    assert fair["centre"]["n_centres"] == 10
