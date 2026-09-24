"""Kernel side of the parity cases shared with the front end (HOST-005).

The same files are run against the TypeScript implementation by
``js/test/parity.test.ts``: a rule implemented on both sides gives the
same results.
"""

from __future__ import annotations

import json
import math
import pathlib
from typing import Any

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
