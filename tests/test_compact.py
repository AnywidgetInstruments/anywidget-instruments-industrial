"""Compact indicators and keypad (IND-100 .. IND-104)."""

from __future__ import annotations

import math

import numpy as np
import pytest
import traitlets as t

import anywidget_instruments as ai


def sent(widget):
    out = []
    widget.send = lambda content, buffers=None: out.append((content, buffers or []))
    return out


def test_deviation_indicator():
    """IND-100."""
    dev = ai.DeviationIndicator(52.0, setpoint=50, tolerance=1.5, span=5)
    assert dev.deviation == 2.0 and dev.out_of_tolerance
    dev.value = 50.5
    assert not dev.out_of_tolerance
    assert not ai.DeviationIndicator().out_of_tolerance  # NaN value
    with pytest.raises(t.TraitError, match="span"):
        ai.DeviationIndicator(span=0)


def test_sparkline_history_is_binary_and_bounded():
    """IND-101."""
    spark = ai.Sparkline(history=3)
    msgs = sent(spark)
    spark.append([1.0, 2.0, 3.0, 4.0])
    assert spark.value == 4.0 and spark.data.tolist() == [2.0, 3.0, 4.0]
    content, buffers = msgs[-1]
    assert content == {"type": "append", "n": 3}
    assert np.frombuffer(buffers[0], "<f4").tolist() == [2.0, 3.0, 4.0]
    spark._on_history_msg(spark, {"type": "sync_request"}, [])
    assert msgs[-1][0] == {"type": "snapshot", "n": 3}
    spark.history = 5  # a new size starts empty
    assert spark.data.size == 0


def test_bar_graph_levels_and_validation():
    """IND-102."""
    bars = ai.BarGraph(bars=["Z1", {"label": "Z2", "hi": 80, "hihi": 90}], max=100)
    assert bars.bars[0] == {
        "label": "Z1",
        "normal_lo": None,
        "normal_hi": None,
        "lolo": None,
        "lo": None,
        "hi": None,
        "hihi": None,
    }
    bars.value = [50.0, 85.0]
    assert bars.alarm_levels == ["normal", "hi"]
    bars.value = [50.0, 95.0]
    assert bars.alarm_levels == ["normal", "hihi"]
    bars.value = [50.0]  # missing value: no alarm
    assert bars.alarm_levels == ["normal", "normal"]
    with pytest.raises(t.TraitError, match="unknown keys"):
        ai.BarGraph(bars=[{"label": "A", "limit": 3}])


def test_kpi_tile_and_oee():
    """IND-103."""
    assert ai.oee(0.9, 0.95, 0.99) == pytest.approx(0.84645)
    with pytest.raises(ValueError, match="availability"):
        ai.oee(90, 0.95, 0.99)
    tile = ai.KPITile(84.6, target=85, unit="%")
    assert tile.delta == pytest.approx(-0.4) and tile.on_target is False
    tile.higher_is_better = False
    assert tile.on_target is True
    assert ai.KPITile(1.0).on_target is None
    msgs = sent(tile)
    tile.append([86.0, 87.5])
    assert tile.value == 87.5 and tile.data.tolist() == [86.0, 87.5]
    assert msgs[-1][0] == {"type": "append", "n": 2}
    assert math.isnan(ai.KPITile().value)


def test_numeric_entry_rejects_out_of_range_front_values():
    """IND-104 with the range check of NUM-010."""
    sp = ai.NumericEntry(2.2, min=0, max=4, unit="m", confirm_delta=1.0)
    assert sp.mode == "control" and sp.confirm_delta == 1.0
    sp.set_state({"value": 9.0})
    assert sp.value == 2.2
    sp.set_state({"value": 3.0})
    assert sp.value == 3.0
