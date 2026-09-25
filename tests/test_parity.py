"""Kernel side of the parity cases shared with the front end (HOST-005).

The same files are run against the TypeScript implementation by
``js/test/parity.test.ts``: a rule implemented on both sides gives the
same results.
"""

from __future__ import annotations

import contextlib
import json
import math
import pathlib
from typing import Any

import numpy as np
import pytest
import traitlets as t

import anywidget_instruments as ai
from anywidget_instruments._alarm_logic import compute_alarm_level

PARITY = pathlib.Path(__file__).parent / "parity"


def _load(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((PARITY / name).read_text())
    return data


def _num(v: Any) -> Any:
    return float(v) if isinstance(v, str) else v


def _same(a: float, b: float) -> bool:
    return (math.isnan(a) and math.isnan(b)) or a == b


ALARM = _load("alarm_level.json")["cases"]


@pytest.mark.parametrize("case", ALARM, ids=[c["name"] for c in ALARM])
def test_alarm_level(case: dict[str, Any]) -> None:
    limits = dict(case["limits"])
    previous = "normal"
    for step in case["steps"]:
        if isinstance(step[0], dict):
            limits.update(step[0])
            step = step[1:]
        value, expected = _num(step[0]), step[1]
        previous = compute_alarm_level(value, previous=previous, **limits)
        assert previous == expected, (case["name"], value)


@pytest.mark.parametrize("case", ALARM, ids=[c["name"] for c in ALARM])
def test_alarm_level_on_a_widget(case: dict[str, Any]) -> None:
    """Same cases through the traits of a widget (observers included)."""
    k = ai.Knob(0, min=-1e12, max=1e12, **case["limits"])
    for step in case["steps"]:
        if isinstance(step[0], dict):
            for name, v in step[0].items():
                setattr(k, name, v)
            step = step[1:]
        k.value = _num(step[0])
        assert k.alarm_level == step[1], (case["name"], step[0])


NUMERIC = _load("numeric.json")


@pytest.mark.parametrize("case", NUMERIC["coerce"])
def test_coerce(case: dict[str, Any]) -> None:
    k = ai.Knob(_num(case["value"]), min=case["min"], max=case["max"], coerce=case["coerce"])
    assert _same(k.value, _num(case["expected"]))


@pytest.mark.parametrize("case", NUMERIC["scale"])
def test_scale_validity(case: dict[str, Any]) -> None:
    kwargs = {"min": case["min"], "max": case["max"], "scale": case["scale"]}
    if case["valid"]:
        ai.Knob(case["max"], **kwargs)
    else:
        with pytest.raises(t.TraitError):
            ai.Knob(case["max"], **kwargs)


STATES = _load("states.json")["states"]


@pytest.mark.parametrize("case", STATES, ids=[f"{s['widget']}-{i}" for i, s in enumerate(STATES)])
def test_states_are_accepted_unchanged(case: dict[str, Any]) -> None:
    cls = getattr(ai, case["widget"])
    # decode as the kernel does when it receives JSON (from_json of each trait)
    decoders = {k: tr.metadata.get("from_json") for k, tr in cls.class_traits().items()}
    traits = {k: decoders[k](v, None) if decoders.get(k) else v for k, v in case["traits"].items()}
    w = cls(**traits)
    state = json.loads(json.dumps(w.get_state()))
    for name, v in case["traits"].items():
        assert state[name] == v, name


@pytest.mark.parametrize("case", NUMERIC["modulo"])
def test_modulo(case: dict[str, Any]) -> None:
    """Values wrapped by the kernel (x-awi-modulo in the schema), e.g. a heading."""
    w = getattr(ai, case["widget"])(_num(case["value"]))
    assert _same(w.value, _num(case["expected"]))


PEAK = _load("peak.json")["cases"]


@pytest.mark.parametrize("case", PEAK, ids=[c["name"] for c in PEAK])
def test_peak_hold(case: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    from anywidget_instruments import _numeric

    clock = {"now": 0.0}
    monkeypatch.setattr(_numeric.time, "monotonic", lambda: clock["now"])
    g = ai.Gauge(0, min=-1e12, max=1e12, peak_hold=case["hold"], peak_decay=case["decay"])
    g.reset_peak()
    for now, value, expected in case["steps"]:
        clock["now"] = now
        g.value = _num(value)
        assert g.peak == expected, (case["name"], now, value)


RESOLVED = _load("resolved.json")


@pytest.mark.parametrize("case", RESOLVED["selector"])
def test_selector_resolved_value(case: dict[str, Any]) -> None:
    sw = ai.SelectorSwitch(
        case.get("value"), positions=case["positions"], default_position=case["default_position"]
    )
    assert sw.value == case["expected"]


@pytest.mark.parametrize("case", RESOLVED["stacklight"])
def test_stacklight_resolved_value(case: dict[str, Any]) -> None:
    if case["value"] is None:
        light = ai.StackLight(tiers=case["tiers"])
    else:  # states of a three-tier light, then the tiers change
        light = ai.StackLight(value=case["value"])
        light.tiers = case["tiers"]
    assert light.value == case["expected"]


BARS = _load("bars.json")


@pytest.mark.parametrize("case", BARS["normalize"])
def test_bars_normalized(case: dict[str, Any]) -> None:
    assert ai.BarGraph(bars=case["bars"]).bars == case["expected"]


@pytest.mark.parametrize("case", BARS["levels"], ids=[c["name"] for c in BARS["levels"]])
def test_bar_levels(case: dict[str, Any]) -> None:
    g = ai.BarGraph(bars=case["bars"], deadband=case["deadband"])
    for values, expected in case["steps"]:
        g.value = [_num(v) for v in values]
        assert g.alarm_levels == expected, (case["name"], values)


PROCESS = _load("process.json")["cases"]


@pytest.mark.parametrize("case", PROCESS, ids=[c["name"] for c in PROCESS])
def test_process_commands(case: dict[str, Any]) -> None:
    w = getattr(ai, case["widget"])(**case["traits"])
    for command, expected in case["steps"]:
        if isinstance(command, list):
            w.demand_position(command[1])
        else:
            w.command(command)
        for name, v in expected.items():
            assert getattr(w, name) == v, (case["name"], command, name)


MACHINE = _load("statemachine.json")


@pytest.mark.parametrize("case", MACHINE["normalize"])
def test_machine_normalized(case: dict[str, Any]) -> None:
    assert ai.StateMachine(case["model"]).machine == case["expected"]


@pytest.mark.parametrize("model", MACHINE["invalid"])
def test_machine_invalid(model: dict[str, Any]) -> None:
    with pytest.raises(t.TraitError):
        ai.StateMachine(model)


@pytest.mark.parametrize(
    "case", MACHINE["sequences"], ids=[c["name"] for c in MACHINE["sequences"]]
)
def test_machine_commands(case: dict[str, Any]) -> None:
    sm = ai.StateMachine(case["model"])
    for command, state, available in case["steps"]:
        if command == "SC":
            sm.state_complete()
        else:
            sm.command(command)
        assert (sm.value, sm.available_commands) == (state, available), (case["name"], command)


PID = _load("pid.json")["cases"]


@pytest.mark.parametrize("case", PID, ids=[c["name"] for c in PID])
def test_pid_operator_rules(case: dict[str, Any]) -> None:
    fp = ai.PIDFaceplate(**{k: _num(v) if k == "pv" else v for k, v in case["traits"].items()})
    for step, expected in case["steps"]:
        if step[0] == "set":
            fp.operator_set(step[1], step[2], confirmed=step[3])
        else:
            fp._handle_front_msg(fp, {"type": "loop_mode", "mode": step[1]}, [])
        for name, v in expected.items():
            assert getattr(fp, name) == v, (case["name"], step, name)


ANN = _load("annunciator.json")


def test_annunciator_transition_table() -> None:
    from anywidget_instruments._annunciator import annunciator_transition

    for state, active, event, sequence, expected in ANN["transitions"]:
        assert annunciator_transition(state, active, event, sequence) == expected


@pytest.mark.parametrize("case", ANN["scenarios"], ids=[c["name"] for c in ANN["scenarios"]])
def test_annunciator_scenarios(case: dict[str, Any]) -> None:
    ann = ai.Annunciator([(tag, tag) for tag in case["windows"]], sequence=case["sequence"])
    ann.first_out = case["first_out"]
    for (action, arg), windows, horn in case["steps"]:
        if action == "set":
            ann.set(*arg)
        else:
            getattr(ann, action)()
        got = {w["tag"]: [w["state"], w["first"]] for w in ann.value}
        assert (got, ann.horn) == (windows, horn), (case["name"], action, arg)


ALARMS = _load("alarms.json")


def _alarm_rows(widget: Any, rows: list[dict[str, Any]], now: float) -> None:
    base = {"timestamp": "", "source": "", "priority": "high", "message": ""}
    for r in rows:
        a = {**base, "id": r["id"], "state": r["state"]}
        if isinstance(widget, ai.AlarmList):
            shelved = r.get("shelved_for")
            a.update(
                shelved_until=None if shelved is None else now + shelved,
                suppressed=r.get("suppressed", False),
                out_of_service=False,
            )
        widget._alarms[r["id"]] = a
    widget._publish()


def _alarm_state(widget: Any) -> dict[str, list[Any]]:
    return {a["id"]: [a["state"], a.get("shelved_until") is not None] for a in widget.value}


@pytest.mark.parametrize("case", ALARMS["banner"], ids=[c["name"] for c in ALARMS["banner"]])
def test_alarm_banner_actions(case: dict[str, Any]) -> None:
    banner = ai.AlarmBanner()
    _alarm_rows(banner, case["rows"], ALARMS["now"])
    for step, expected in case["steps"]:
        if step[0] == "ack":
            banner.acknowledge(step[1])
        else:
            banner.acknowledge_all()
        assert _alarm_state(banner) == expected, (case["name"], step)


@pytest.mark.parametrize("case", ALARMS["list"], ids=[c["name"] for c in ALARMS["list"]])
def test_alarm_list_actions(case: dict[str, Any]) -> None:
    clock = {"now": float(ALARMS["now"])}
    lst = ai.AlarmList(max_shelve=case["max_shelve"])
    lst._clock = lambda: clock["now"]
    _alarm_rows(lst, case["rows"], clock["now"])
    for step, expected in case["steps"]:
        if step[0] == "ack":
            lst.acknowledge(step[1])
        elif step[0] == "shelve":
            with contextlib.suppress(ValueError):  # refused duration
                lst.shelve(step[1], step[2])
        elif step[0] == "unshelve":
            lst.unshelve(step[1])
        else:
            clock["now"] += step[1]
            lst.refresh()
        assert _alarm_state(lst) == expected, (case["name"], step)


POLAR = _load("polar.json")


@pytest.mark.parametrize("case", POLAR["gamma"])
def test_smith_gamma(case: dict[str, Any]) -> None:
    g = ai.SmithChart(z0=case["z0"]).gamma(complex(*case["z"]))
    assert (g.real, g.imag) == pytest.approx(tuple(case["gamma"]), abs=1e-12)


@pytest.mark.parametrize("case", POLAR["impedance"])
def test_smith_impedance(case: dict[str, Any]) -> None:
    z = ai.SmithChart(z0=1).impedance(complex(*case["gamma"]))
    assert (z.real, z.imag) == pytest.approx(tuple(case["z"]), abs=1e-12)


@pytest.mark.parametrize(
    "case", POLAR["radar_ranges"], ids=[c["name"] for c in POLAR["radar_ranges"]]
)
def test_radar_ranges(case: dict[str, Any]) -> None:
    """A range given for an axis passes RadarChart's validation and is used as is."""
    r = ai.RadarChart(ranges=case["ranges"])
    for v in case["values"]:
        r.plot(v, name=str(v))
    given = {k: rng for k, rng in enumerate(r.ranges)}
    for k, expected in enumerate(case["expected"]):
        if k in given:
            assert given[k] == expected
        else:
            assert [0, max(s["values"][k] for s in r.value)] == expected


WAVEFORM = _load("waveform.json")["cases"]


@pytest.mark.parametrize("case", WAVEFORM, ids=[c["name"] for c in WAVEFORM])
def test_waveform_values_at(case: dict[str, Any]) -> None:
    w = ai.WaveformChart(
        history=case["history"],
        n_traces=case["n_traces"],
        update_mode=case["update_mode"],
        dt=case["dt"],
    )
    for rows in case["appends"]:
        w.append(np.array([[_num(v) for v in r] for r in rows], dtype=float))
    for x, expected in case["cursors"]:
        got = w.values_at(x)
        assert [None if math.isnan(v) else v for v in got] == [
            None if isinstance(v, str) else v for v in expected
        ], (case["name"], x)


INTENSITY = _load("intensity.json")["cases"]


@pytest.mark.parametrize("case", INTENSITY, ids=[c["name"] for c in INTENSITY])
def test_intensity_values_at(case: dict[str, Any]) -> None:
    w = ai.IntensityChart(history=case["history"], n_bins=case["n_bins"], dt=case["dt"])
    for rows in case["appends"]:
        w.append(np.array(rows, dtype=float))
    for x, expected in case["cursors"]:
        assert w.values_at(x) == expected, (case["name"], x)


DIGITAL = _load("digital.json")["cases"]


@pytest.mark.parametrize("case", DIGITAL, ids=[c["name"] for c in DIGITAL])
def test_digital_values_at(case: dict[str, Any]) -> None:
    w = ai.MixedSignalGraph(x0=case["x0"], dt=case["dt"])
    w.set_data(case["values"], n_bits=case["n_bits"])
    w.buses = case["buses"]
    if case["analog"] is not None:
        w.set_analog(case["analog"])
    for x, expected in case["cursors"]:
        assert w.values_at(x) == expected, (case["name"], x)


TREND = _load("trend.json")


@pytest.mark.parametrize("case", TREND["normalize"])
def test_trend_pens_normalized(case: dict[str, Any]) -> None:
    assert ai.TrendChart(pens=case["pens"]).pens == case["expected"]


@pytest.mark.parametrize("case", TREND["values_at"], ids=[c["name"] for c in TREND["values_at"]])
def test_trend_values_at(case: dict[str, Any]) -> None:
    w = ai.TrendChart(pens=case["pens"], history=case["history"])
    for pen, values, times in case["adds"]:
        w.add(pen, values, time=times)
    for x, expected in case["cursors"]:
        got = [None if math.isnan(v) else v for v in w.values_at(x)]
        assert got == [None if isinstance(v, str) else v for v in expected], (case["name"], x)


SYNOPTIC = _load("synoptic.json")["cases"]


@pytest.mark.parametrize("case", SYNOPTIC, ids=[c["name"] for c in SYNOPTIC])
def test_synoptic_background_mime(case: dict[str, Any]) -> None:
    data = bytes.fromhex(case["hex"])
    if not case["mime"]:
        with pytest.raises(t.TraitError):
            ai.SynopticCanvas(background=data)
        return
    assert ai.SynopticCanvas(background=data).background_mime == case["mime"]


BITFIELD = _load("bitfield.json")["cases"]


@pytest.mark.parametrize("case", BITFIELD)
def test_bitfield(case: dict[str, Any]) -> None:
    w = ai.BitField(case["value"], bits=case["bits"])
    assert w.active_bits() == case["active"]
    for bit, expected in case["toggle"]:
        w.value = case["value"]
        w.toggle_bit(bit)
        assert w.value == expected, (case["value"], bit)


RECIPE = _load("recipe.json")


@pytest.mark.parametrize("case", RECIPE["normalize"])
def test_recipe_columns_normalized(case: dict[str, Any]) -> None:
    from anywidget_instruments._recipe import normalize_column

    assert normalize_column(case["raw"]) == case["expected"]


@pytest.mark.parametrize(
    "case", RECIPE["cells"], ids=[c["column"]["name"] for c in RECIPE["cells"]]
)
def test_recipe_cells(case: dict[str, Any]) -> None:
    from anywidget_instruments._recipe import check_cell, normalize_column

    col = normalize_column(case["column"])
    for value, ok, *stored in case["checks"]:
        got_ok, got = check_cell(col, _num(value) if value == "nan" else value)
        assert got_ok == ok, (value, got)
        if ok:
            assert got == stored[0], (value, got)
