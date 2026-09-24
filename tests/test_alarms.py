import math

import pytest

import anywidget_instruments as ai
from anywidget_instruments import compute_alarm_level as level

LIMITS = {"lolo": 5, "lo": 10, "hi": 80, "hihi": 90}


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (50, "normal"),
        (80, "hi"),
        (85, "hi"),
        (90, "hihi"),
        (99, "hihi"),
        (10, "lo"),
        (7, "lo"),
        (5, "lolo"),
        (-3, "lolo"),
    ],
)
def test_levels_without_deadband(value, expected):
    assert level(value, **LIMITS) == expected


def test_partial_limits():
    assert level(95, hi=80) == "hi"
    assert level(-5, lo=0) == "lo"
    assert level(50) == "normal"


def test_deadband_hysteresis_high_side():
    kw = {**LIMITS, "deadband": 2}
    assert level(79, previous="hi", **kw) == "hi"  # inside deadband: stays
    assert level(77, previous="hi", **kw) == "normal"
    assert level(89, previous="hihi", **kw) == "hihi"
    assert level(87, previous="hihi", **kw) == "hi"
    assert level(70, previous="hihi", **kw) == "normal"


def test_deadband_hysteresis_low_side():
    kw = {**LIMITS, "deadband": 2}
    assert level(11, previous="lo", **kw) == "lo"
    assert level(13, previous="lo", **kw) == "normal"
    assert level(6, previous="lolo", **kw) == "lolo"
    assert level(8, previous="lolo", **kw) == "lo"


def test_entering_is_immediate_and_opposite_side_wins():
    kw = {**LIMITS, "deadband": 50}
    assert level(95, previous="hi", **kw) == "hihi"
    assert level(0, previous="hi", **kw) == "lolo"


def test_nan_keeps_previous_level():
    assert level(math.nan, previous="hi", **LIMITS) == "hi"


def test_widget_publishes_alarm_level():
    g = ai.Gauge(20, **LIMITS, deadband=1)
    assert g.alarm_level == "normal"
    seen = []
    g.observe(lambda c: seen.append(c["new"]), names="alarm_level")
    g.value = 92
    g.value = 89.5
    g.value = 85
    g.value = 50
    assert seen == ["hihi", "hi", "normal"]
    assert g.trait_metadata("alarm_level", "sync")


def test_alarm_level_recomputed_when_limits_change():
    g = ai.Gauge(50)
    g.hi = 40
    assert g.alarm_level == "hi"


def test_alarm_indicator_state_machine():
    a = ai.AlarmIndicator(alarm_id="TK-101.HI", priority="high")
    acks = []
    a.on_acknowledge(lambda e: acks.append(e["alarm_id"]))
    assert a.value == "normal"
    a.activate("Level high")
    assert a.value == "active_unacknowledged"
    a.acknowledge()
    assert a.value == "active_acknowledged"
    a.clear()
    assert a.value == "normal"
    a.activate()
    a.clear()
    assert a.value == "cleared_unacknowledged"
    a.acknowledge()
    assert a.value == "normal"
    assert acks == ["TK-101.HI", "TK-101.HI"]


def test_alarm_ack_from_front_end_only_in_control_mode():
    a = ai.AlarmIndicator(alarm_id="A1")
    a.activate()
    a.mode = "indicator"
    a._handle_front_msg(a, {"type": "ack"}, [])
    assert a.value == "active_unacknowledged"
    a.mode = "control"
    a._handle_front_msg(a, {"type": "ack"}, [])
    assert a.value == "active_acknowledged"
