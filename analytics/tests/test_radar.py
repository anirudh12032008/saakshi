import itertools
import json

import numpy as np
import pytest
from scipy import stats

from saakshi_analytics import generate, radar


def test_pb_sf_matches_brute_force_and_binomial():
    p = np.array([[0.1, 0.5, 0.9, 0.3], [0.2, 0.2, 0.2, 0.2]])
    for k in range(6):
        brute = sum(np.prod([pj if x else 1 - pj for pj, x in zip(p[0], xs)])
                    for xs in itertools.product([0, 1], repeat=4) if sum(xs) >= k)
        got = radar.pb_sf(p, np.array([k, k]))
        assert got[0] == pytest.approx(brute)
        assert got[1] == pytest.approx(stats.binom.sf(k - 1, 4, 0.2))


def check_mvp(flags, truth, cohort):
    m = radar.evaluate(flags, truth, cohort)
    assert m["signals"]["speed-accuracy"]["recall_leak"] >= 0.8
    assert m["signals"]["same-room"]["recall"] >= 0.8
    assert m["honest_fpr"] <= 0.005
    for name, g in m["lookalikes"].items():
        assert g["n"] > 0, name
        assert g["p_vs_baseline"] > 0.01, (name, g)  # not significantly above honest baseline
    return m


def test_mvp_small_cohort(small):
    _, cohort, truth = small
    check_mvp(radar.run(cohort), truth, cohort)


def test_every_flag_explains_itself(small):
    _, cohort, _ = small
    flags = radar.run(cohort)
    assert flags
    for f in flags:
        assert f["level"] == radar.level(len(f["signals"]))
        for s in f["signals"]:
            assert set(s) >= {"signal", "reason", "observed", "expected", "p"} and s["reason"]
            assert s["observed"] > s["expected"]
            assert 0 <= s["p"] <= {"speed-accuracy": radar.ALPHA_SPEED, "same-room": radar.ALPHA_ROOM, "cusum": radar.ALPHA_CUSUM_CAND}[s["signal"]]
    rings = [f for f in flags if any(s["signal"] == "same-room" for s in f["signals"])]
    assert all(len(s["ring"]) >= 2 for f in rings for s in f["signals"] if s["signal"] == "same-room")


def test_cli_report(small, capsys):
    out, _, _ = small
    radar.main([str(out / "cohort.jsonl"), "--key", str(out / "key.json"), "--truth", str(out / "truth.json"),
                "--registry", str(out / "registry.json")])
    text = capsys.readouterr().out
    for word in ["watch", "precision", "recall", "FPR", "hindi", "pwd", "rapid", "improvers", "auto-penalised",
                 "cusum", "history:", "annotation only"]:
        assert word in text


def test_radar_reads_cell_export_rows(small, tmp_path):
    """Stage 6 feeds the cells' export: every cohort field plus seq/rxWall/h. Extra fields are ignored."""
    out, cohort, _ = small
    lines = (out / "cohort.jsonl").read_text().splitlines()[:300]
    ext = tmp_path / "export.jsonl"
    ext.write_text("\n".join(json.dumps(json.loads(l) | {"seq": i, "rxWall": 0, "h": "0" * 64}) for i, l in enumerate(lines)))
    c = radar.load(ext, json.loads((out / "key.json").read_text()))
    assert c["answer"].shape == (3, 100)


@pytest.mark.full
def test_full_20k_calibrate_g1_evaluate_g2():
    """The one full-size test: A1's MVP on G1, the CUSUM gain on the mid-exam leak, and G2 out of sample."""
    from saakshi_analytics import evaluate

    r = evaluate.run(20000, 100, 7, 2026)
    g1, g2, mid = r["g1"], r["g2"], r["mid_recall"]
    assert g1["signals"]["speed-accuracy"]["recall_leak"] >= 0.8 and g1["signals"]["same-room"]["recall"] >= 0.8
    a1 = mid["G1, A1 thresholds"]
    assert a1["before (signal 1)"] >= 0.5 and a1["after (signal 1 or 3)"] >= a1["before (signal 1)"] + 0.3
    assert mid["G2, calibrated"]["after (signal 1 or 3)"] >= mid["G2, calibrated"]["before (signal 1)"] + 0.3
    for m in (g1, g2):
        assert m["honest_fpr"] <= 0.005
        assert all(g["p_vs_baseline"] > 0.01 for g in m["lookalikes"].values())
    assert g2["signals"]["leak (1 or 3)"]["recall"] >= 0.8 and g2["signals"]["same-room"]["recall"] >= 0.6
    for dim in ("lang", "pwd"):
        assert all(g["honest_rate"] <= 0.005 for g in r["fairness"][dim].values())
