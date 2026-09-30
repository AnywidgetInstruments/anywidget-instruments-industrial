"""EventLog: journal, bound, categories, audit trail (IND-090 .. IND-093)."""

from __future__ import annotations

import pytest

import anywidget_instruments_industrial as ai


def test_log_appends_timestamped_events_and_keeps_max():
    log = ai.EventLog(max_events=3)
    e = log.log("Pump started", source="P-101", category="state", time=100.0)
    assert e == {
        "id": 1,
        "time": 100.0,
        "source": "P-101",
        "category": "state",
        "message": "Pump started",
    }
    for i in range(4):
        log.log(f"event {i}")
    assert [ev["message"] for ev in log.events] == ["event 1", "event 2", "event 3"]
    assert log.events[-1]["category"] == "system" and log.events[-1]["time"] > 1e9
    log.max_events = 2
    assert len(log.value) == 2
    with pytest.raises(ValueError, match="category"):
        log.log("x", category="info")
    log.clear()
    assert log.events == []


def test_connect_records_operator_changes():
    """IND-093: audit trail of the changes of connected widgets."""
    log = ai.EventLog()
    knob = ai.Knob(10, label="Setpoint")
    log.connect(knob)
    knob.value = 12.5
    ev = log.events[-1]
    assert (ev["source"], ev["category"], ev["message"]) == (
        "Setpoint",
        "operator",
        "value: 10 → 12.5",
    )
    switch = ai.SelectorSwitch("OFF", positions=["HAND", "OFF", "AUTO"])
    log.connect(switch, category="state", source="Pump mode")
    switch.value = "AUTO"
    assert log.events[-1]["message"] == "value: OFF → AUTO"
    assert log.events[-1]["source"] == "Pump mode"
    log.disconnect(knob)
    knob.value = 20
    assert log.events[-1]["source"] == "Pump mode"
