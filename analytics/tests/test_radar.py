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
        assert f["level"] == {1: "watch", 2: "review"}[len(f["signals"])]
        for s in f["signals"]:
            assert set(s) >= {"signal", "reason", "observed", "expected", "p"} and s["reason"]
            assert s["observed"] > s["expected"]
            assert 0 <= s["p"] <= {"speed-accuracy": radar.ALPHA_SPEED, "same-room": radar.ALPHA_ROOM}[s["signal"]]
    rings = [f for f in flags if any(s["signal"] == "same-room" for s in f["signals"])]
    assert all(len(s["ring"]) >= 2 for f in rings for s in f["signals"] if s["signal"] == "same-room")


def test_cli_report(small, capsys):
    out, _, _ = small
    radar.main([str(out / "cohort.jsonl"), "--key", str(out / "key.json"), "--truth", str(out / "truth.json")])
    text = capsys.readouterr().out
    for word in ["watch", "precision", "recall", "FPR", "hindi", "pwd", "rapid", "improvers", "auto-penalised"]:
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
def test_mvp_full_20k(tmp_path):
    cohort, key, truth = generate.generate(n=20000, n_centres=100, seed=7)
    m = check_mvp(radar.run(cohort), truth, cohort)
    assert m["signals"]["speed-accuracy"]["recall_mid"] >= 0.5
