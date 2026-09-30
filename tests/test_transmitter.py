"""Transmitter: tag, device status, invalid value, alarms (IND-080 .. IND-083)."""

from __future__ import annotations

import pytest
import traitlets as t

import anywidget_instruments_industrial as ai


def test_transmitter_defaults_and_status():
    lt = ai.Transmitter(2.4, tag="LT-101", unit="m", max=4)
    assert lt.mode == "indicator" and lt.status == "ok" and lt.valid
    assert set(ai.DEVICE_STATUSES) == {"ok", "failure", "check", "out_of_spec", "maintenance"}
    lt.status = "failure"
    assert not lt.valid
    with pytest.raises(t.TraitError):
        lt.status = "broken"


def test_transmitter_alarm_levels():
    """IND-083: alarm limits work as on the other numeric widgets."""
    lt = ai.Transmitter(1.0, tag="LT-101", max=4, hi=3.0, hihi=3.5)
    lt.value = 3.2
    assert lt.alarm_level == "hi"
    lt.value = 3.8
    assert lt.alarm_level == "hihi"
