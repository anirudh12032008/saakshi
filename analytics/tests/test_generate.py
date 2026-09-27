import hashlib
import json

import numpy as np

from saakshi_analytics import generate
from test_schema import ROOT, SPEC, check


def test_rows_match_frozen_schema(small):
    out, cohort, _ = small
    lines = (out / "cohort.jsonl").read_text().splitlines()
    assert len(lines) == 2000 * 100
    for line in lines[::97]:  # a spread sample; every row is built by the same code path
        assert check(json.loads(line), SPEC["cohort"]) == [], line


def test_ground_truth_is_not_in_the_rows(small):
    out, _, truth = small
    first = json.loads((out / "cohort.jsonl").read_text().splitlines()[0])
    assert set(first) == set(SPEC["cohort"])  # nothing beyond the frozen fields
    assert len(truth["leak"]["items"]) == 20 and len(truth["leak"]["centres"]) == 3
    assert len(truth["leak"]["cands"]) == 30  # 300 scaled to 2k
    assert len(truth["rings"]) == 6
    planted = set(truth["leak"]["cands"]) | set(truth["midLeak"]["cands"]) | {c for r in truth["rings"] for c in r["members"]}
    looks = set(truth["lookalikes"]["rapid"]) | set(truth["lookalikes"]["flyers"]) | {x["cand"] for x in truth["lookalikes"]["improvers"]}
    assert not planted & looks


def test_deterministic_per_seed(tmp_path):
    digest = []
    for name, seed in [("a", 3), ("b", 3), ("c", 4)]:
        generate.main([str(tmp_path / name), "--n", "600", "--centres", "10", "--seed", str(seed)])
        digest.append(hashlib.sha256((tmp_path / name / "cohort.jsonl").read_bytes()).hexdigest())
    assert digest[0] == digest[1] != digest[2]


def test_key_extends_the_demo_paper(small):
    out, _, _ = small
    key = json.loads((out / "key.json").read_text())
    paper = json.loads((ROOT / "fixtures/paper/key.json").read_text())
    assert len(key) == 100 and all(key[i] == a for i, a in paper.items())


def test_planted_leak_is_fast_and_correct(small):
    _, c, truth = small
    rows = np.isin(c["cand"], truth["leak"]["cands"])
    cols = np.isin(c["items"], truth["leak"]["items"])
    leaked = c["dwell"][np.ix_(rows, cols)]
    others = c["dwell"][np.ix_(~rows, cols)]
    assert np.median(leaked) < 0.4 * np.median(others)
    assert (c["answer"][np.ix_(rows, cols)] == c["key"][cols]).mean() > 0.9
