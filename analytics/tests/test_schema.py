import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = json.loads((ROOT / "fixtures/schemas/v1.json").read_text())


def check(row: dict, spec: dict) -> list[str]:
    errs = [f"unexpected field {k}" for k in row if k not in spec]
    for k, s in spec.items():
        if k not in row:
            errs.append(f"missing {k}")
            continue
        v = row[k]
        if s == "string":
            ok = isinstance(v, str)
        elif s == "int":
            ok = isinstance(v, int) and not isinstance(v, bool)
        elif s == "hex64":
            ok = isinstance(v, str) and re.fullmatch(r"[0-9a-f]{64}", v) is not None
        else:
            ok = v in s and not isinstance(v, bool)
        if not ok:
            errs.append(f"bad {k}: {v!r}")
    return errs


def test_stub_cohort_matches_frozen_schema():
    rows = [json.loads(l) for l in (ROOT / "fixtures/cohort-stub.jsonl").read_text().splitlines()]
    assert len(rows) == 60
    for r in rows:
        assert check(r, SPEC["cohort"]) == [], r


def test_scientific_stack_imports():
    import networkx, numpy, scipy.stats  # noqa: F401
