"""A4 (S4): predicted centre risk from T-1 mock-drill telemetry, its precision, and the centre scorecard."""

import json


from saakshi_analytics import scorecard as sc


def test_histories_are_seeded_and_deterministic():
    a, b = sc.simulate(50, seed=3), sc.simulate(50, seed=3)
    assert a == b and a != sc.simulate(50, seed=4)
    assert set(a[0]) == {"centre", *sc.FEATURES, "incident"}


def test_precision_on_independent_histories_beats_the_base_rate():
    model = sc.fit(sc.simulate(4000, seed=1))
    m = sc.precision(model, sc.simulate(4000, seed=2))
    assert m["atRisk"] > 0
    # measured: precision 0.290 vs base rate 0.138 at P >= 0.2 (README). Guard the lift, not a tuned number.
    assert m["precision"] >= 1.8 * m["baseRate"] and m["precision"] >= 0.25
    hi = sc.precision(model, sc.simulate(4000, seed=2), sc.DO_NOT_ALLOT)
    assert hi["precision"] > m["precision"]  # the stricter label is the more precise one


def test_every_centre_gets_a_risk_three_reasons_and_a_monotone_decision():
    model = sc.fit(sc.simulate(4000, seed=1))
    rows = sc.scorecard(model, sc.simulate(30, seed=7))
    risks = [r["risk"] for r in rows]
    assert risks == sorted(risks, reverse=True) and [r["rank"] for r in rows] == list(range(1, 31))
    order = {"do not allot": 2, "add observer": 1, "allot": 0}
    assert [order[r["decision"]] for r in rows] == sorted((order[r["decision"]] for r in rows), reverse=True)
    assert all(len(r["reasons"]) == 3 for r in rows)
    assert all("incident" not in r for r in rows)  # the outcome is never an input


def test_riskier_telemetry_raises_the_risk():
    model = sc.fit(sc.simulate(4000, seed=1))
    ok = {"centre": "X", "jitterMs": 25, "upsMin": 60, "diskFreePct": 70, "pastIncidents": 0}
    bad = ok | {"jitterMs": 120, "upsMin": 5, "pastIncidents": 3}
    lo, hi = sc.scorecard(model, [ok, bad | {"centre": "Y"}])[::-1]
    assert hi["centre"] == "Y" and hi["risk"] > lo["risk"]
    assert any("UPS" in x for x in hi["reasons"]) and any("jitter" in x for x in hi["reasons"])


def test_claude_note_hook_is_template_text_and_replaceable():
    model = sc.fit(sc.simulate(2000, seed=1))
    rows = sc.scorecard(model, sc.simulate(5, seed=7))
    assert all(r["note"] and r["centre"] in r["note"] for r in rows)
    rows = sc.scorecard(model, sc.simulate(5, seed=7), note=lambda row: "from claude")
    assert {r["note"] for r in rows} == {"from claude"}


def test_cli_prints_the_scorecard_and_precision(tmp_path, capsys):
    sc.main(["--centres", "10", "--json", str(tmp_path / "s.json")])
    text = capsys.readouterr().out
    assert "CENTRE SCORECARD" in text and "precision" in text and "CEN001" in text
    out = json.loads((tmp_path / "s.json").read_text())
    assert len(out["scorecard"]) == 10 and 0 <= out["precision"]["precision"] <= 1


def test_cli_scores_supplied_telemetry(tmp_path, capsys):
    tel = [{"centre": "CEN777", "jitterMs": 200, "upsMin": 2, "diskFreePct": 3, "pastIncidents": 4}]
    (tmp_path / "t.json").write_text(json.dumps(tel))
    sc.main(["--telemetry", str(tmp_path / "t.json")])
    assert "CEN777" in capsys.readouterr().out
