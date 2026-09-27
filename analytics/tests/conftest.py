import json

import pytest

from saakshi_analytics import generate, radar


@pytest.fixture(scope="session")
def small(tmp_path_factory):
    """2k candidates / 10 centres (same ~67-per-room density as the full 20k), written and read back as JSONL."""
    out = tmp_path_factory.mktemp("g1")
    generate.main([str(out), "--n", "2000", "--centres", "10", "--seed", "7"])
    cohort = radar.load(out / "cohort.jsonl", json.loads((out / "key.json").read_text()))
    truth = json.loads((out / "truth.json").read_text())
    return out, cohort, truth
