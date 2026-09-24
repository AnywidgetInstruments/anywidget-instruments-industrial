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
    traits = {k: _num(v) if k == "value" else v for k, v in case["traits"].items()}
    w = cls(**traits)
    state = json.loads(json.dumps(w.get_state()))
    for name, v in case["traits"].items():
        assert state[name] == v, name
