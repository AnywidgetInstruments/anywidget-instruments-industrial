"""TrendChart: pens, timestamped samples, history bound, cursors (IND-070 .. IND-075)."""

from __future__ import annotations

import numpy as np
import pytest
import traitlets as t

import anywidget_instruments as ai


def sent(widget):
    out = []
    widget.send = lambda content, buffers=None: out.append((content, buffers or []))
    return out


def test_pens_defaults_and_validation():
    trend = ai.TrendChart(pens=["A", {"name": "B", "unit": "m", "min": 0, "max": 4, "hi": 3}])
    a, b = trend.pens
    assert (a["min"], a["max"], a["format"]) == (0.0, 100.0, "%.4g")
    assert b["hi"] == 3.0 and b["lo"] is None and b["unit"] == "m"
    with pytest.raises(t.TraitError, match="needs a 'name'"):
        ai.TrendChart(pens=[{"unit": "m"}])
    with pytest.raises(t.TraitError, match="duplicate"):
        ai.TrendChart(pens=["A", "A"])
    with pytest.raises(t.TraitError, match="max > min"):
        ai.TrendChart(pens=[{"name": "A", "min": 5, "max": 5}])
    with pytest.raises(t.TraitError, match="unknown keys"):
        ai.TrendChart(pens=[{"name": "A", "colour": "red"}])


def test_add_sends_binary_timestamps_and_values():
    trend = ai.TrendChart(pens=["LT", "FT"])
    msgs = sent(trend)
    trend.add("LT", [1.0, 2.0], time=[100.0, 101.0])
    content, buffers = msgs[-1]
    assert content == {"type": "append", "pens": [[0, 2, 2]]}
    assert np.frombuffer(buffers[0], "<f8").tolist() == [100.0, 101.0]  # float64 times
    assert np.frombuffer(buffers[1], "<f4").tolist() == [1.0, 2.0]
    trend.add_many({"LT": 3.0, "FT": 7.0}, time=102.0)
    assert msgs[-1][0]["pens"] == [[0, 1, 3], [1, 1, 1]]
    assert trend.value == {"LT": 3.0, "FT": 7.0}
    ts, vs = trend.data("LT")
    assert ts.tolist() == [100.0, 101.0, 102.0] and vs.tolist() == [1.0, 2.0, 3.0]
    with pytest.raises(KeyError, match="no pen 'XX'"):
        trend.add("XX", 1.0)
    with pytest.raises(ValueError, match="timestamps"):
        trend.add("LT", [1.0, 2.0], time=[1.0, 2.0, 3.0])


def test_default_time_is_now():
    trend = ai.TrendChart(pens=["A"])
    import time

    before = time.time()
    trend.add("A", 1.0)
    assert before <= trend.data("A")[0][0] <= time.time()


def test_history_bound_discards_oldest():
    """IND-074."""
    trend = ai.TrendChart(pens=["A"], history=3)
    msgs = sent(trend)
    trend.add("A", np.arange(5.0), time=np.arange(5.0))
    assert trend.data("A")[1].tolist() == [2.0, 3.0, 4.0]
    assert msgs[-1][0]["pens"] == [[0, 3, 5]]  # only the kept samples travel
    trend.add("A", 9.0, time=9.0)
    assert trend.data("A")[0].tolist() == [3.0, 4.0, 9.0]


def test_snapshot_on_sync_request_and_pen_change():
    trend = ai.TrendChart(pens=["A", "B"])
    trend.add("A", [1.0, 2.0], time=[10.0, 11.0])
    msgs = sent(trend)
    trend._handle_front_msg(trend, {"type": "sync_request"}, [])
    content, buffers = msgs[-1]
    assert content == {"type": "snapshot", "pens": [[0, 2, 2], [1, 0, 0]]}
    assert len(buffers) == 4
    trend.pens = ["A", "C"]  # A keeps its data, B is dropped, C is new
    assert msgs[-1][0]["pens"] == [[0, 2, 2], [1, 0, 0]]
    assert trend.data("A")[1].tolist() == [1.0, 2.0]


def test_cursor_values_interpolate_in_time():
    trend = ai.TrendChart(pens=["A", "B"])
    trend.add("A", [0.0, 10.0], time=[100.0, 110.0])
    trend.add_cursor(105.0)
    assert trend.cursor_values[0]["values"][0] == pytest.approx(5.0)
    assert np.isnan(trend.cursor_values[0]["values"][1])  # B has no data


def test_clear():
    trend = ai.TrendChart(pens=["A"])
    msgs = sent(trend)
    trend.add("A", 1.0)
    trend.clear()
    assert msgs[-1][0] == {"type": "clear"} and trend.value == {} and trend.data("A")[0].size == 0
