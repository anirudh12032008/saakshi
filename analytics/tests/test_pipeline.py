import json
from saakshi_analytics import decide, pipeline, radar

def _run(small, tmp_path, **kw):
    out, cohort, _ = small
    return pipeline.run(out / "cohort.jsonl", json.loads((out / "key.json").read_text()),
                        json.loads(open("policy.illustrative.json").read()),
                        json.loads(open("golden/cuet-2026.incident.json").read()), **kw)

def test_pipeline_equals_the_separate_clis(small, tmp_path):
    """radar.run + decide.decide on the same inputs give the same flags and summary as the pipeline."""
    out, _, _ = small
    r = _run(small, tmp_path)
    c = radar.load(out / "cohort.jsonl", json.loads((out / "key.json").read_text()))
    flags = radar.run(c)
    roster, people = decide.load_cohort(out / "cohort.jsonl")
    d = decide.decide(json.loads(open("policy.illustrative.json").read()), json.loads(open("golden/cuet-2026.incident.json").read()),
                      roster, flags, c=c, people=people)
    assert [f["cand"] for f in r["flags"]] == [f["cand"] for f in flags]
    assert r["summary"] == d["summary"]
    assert r["headline"] in r["report"]

def test_review_focus_1_history_never_changes_the_pipeline_flag_set(small, tmp_path):
    out, _, _ = small
    reg = json.loads((out / "registry.json").read_text())
    adversarial = {"apaar": reg["apaar"], "pastPct": {a: 0.0 for a in reg["pastPct"]}}   # everyone "jumped" from P0
    strip = lambda fs: [{k: v for k, v in f.items() if k != "history"} for f in fs]  # noqa: E731
    base = _run(small, tmp_path)["flags"]
    assert strip(_run(small, tmp_path, registry=reg)["flags"]) == strip(base)
    assert strip(_run(small, tmp_path, registry=adversarial)["flags"]) == strip(base)
    assert all(f["signals"] for f in _run(small, tmp_path, registry=adversarial)["flags"])

def test_evidence_escalates_only_multi_signal_flags(small, tmp_path):
    base = _run(small, tmp_path)["flags"]
    everyone = [f["cand"] for f in base]
    ev = _run(small, tmp_path, evidence=everyone)["flags"]
    for a, b in zip(base, ev):
        assert b["level"] == ("escalate" if len(a["signals"]) >= 2 else a["level"])

def test_the_json_is_deterministic(small, tmp_path):
    out, _, _ = small
    args = ["--cohort", str(out / "cohort.jsonl"), "--key", str(out / "key.json"), "--policy", "policy.illustrative.json",
            "--incident", "golden/cuet-2026.incident.json"]
    pipeline.main([*args, "--json", str(tmp_path / "a.json")]); pipeline.main([*args, "--json", str(tmp_path / "b.json")])
    assert (tmp_path / "a.json").read_bytes() == (tmp_path / "b.json").read_bytes()

def test_export_rows_with_extra_fields_and_one_shift_give_the_same_decision(small, tmp_path):
    """What the cells export (merged shift, seq/rxWall/h added) is what the pipeline decides on."""
    out, _, _ = small
    rows = [json.loads(l) | {"shift": "S1", "seq": 1, "rxWall": 0, "h": "0" * 64} for l in (out / "cohort.jsonl").read_text().splitlines()]
    p = tmp_path / "export.jsonl"; p.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    inc = {"id": "one-shift", "disruptions": [{"centre": "CEN002", "shift": "S1", "fromMin": 40, "toMin": 160}]}
    r = pipeline.run(p, json.loads((out / "key.json").read_text()), json.loads(open("policy.illustrative.json").read()), inc)
    assert r["inputs"]["rows"] == len(rows) and r["summary"]["compensated"] + r["summary"]["retested"] > 0

def test_bad_input_exits_2(tmp_path, capsys):
    import pytest
    with pytest.raises(SystemExit) as e:
        pipeline.main(["--cohort", str(tmp_path / "nope.jsonl"), "--key", "x", "--policy", "x", "--incident", "x", "--json", str(tmp_path / "o")])
    assert e.value.code == 2


def test_headline_equals_core_headlineOf(small, tmp_path):
    """Every count uses Indian grouping, as core headlineOf does, so the report line and the TS headline agree."""
    r = _run(small, tmp_path); s, g = r["summary"], decide.inr
    assert r["headline"] == (f"Compensated {g(s['compensated'])} · Re-tested {g(s['retested'])} · Re-conducted "
                             f"{s['reconductedCentres']} centres · Spared {g(s['spared'])} · ₹ avoided {g(s['inrAvoided'])}")
    assert g(19488) == "19,488" and g(1840) == "1,840"
