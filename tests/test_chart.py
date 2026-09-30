import numpy as np
import pytest
from traitlets import TraitError

import anywidget_instruments_industrial as ai


def capture(chart):
    sent = []

    def send(content, buffers=None):
        if content.get("type") != "hb":  # liveness heartbeats (ROB-001) may arrive any time
            sent.append((content, buffers))

    chart.send = send
    return sent


def test_append_scalar_1d_2d():
    c = ai.WaveformChart(history=10)
    sent = capture(c)
    c.append(1.0)
    c.append([2, 3, 4])
    assert c.data[:, 0].tolist() == [1, 2, 3, 4]
    assert c.value == [4.0]
    msg, buffers = sent[-1]
    assert msg == {"type": "append", "n_points": 3, "total": 4}
    assert isinstance(buffers[0], bytes)  # binary transfer (CHART-004)
    assert np.frombuffer(buffers[0], dtype="<f4").tolist() == [2, 3, 4]


def test_multi_trace():
    c = ai.WaveformChart(history=4, n_traces=2)
    capture(c)
    c.append([1, 10])  # one sample per trace
    c.append(np.array([[2, 20], [3, 30]]))
    assert c.data.tolist() == [[1, 10], [2, 20], [3, 30]]
    with pytest.raises(ValueError):
        c.append([1, 2, 3])
    with pytest.raises(ValueError):
        c.append(5.0)
    with pytest.raises(ValueError):
        c.append(np.zeros((3, 3)))


def test_circular_buffer_discards_oldest():
    c = ai.WaveformChart(history=3)
    sent = capture(c)
    c.append(np.arange(5))
    assert c.data[:, 0].tolist() == [2, 3, 4]
    assert c.total_samples == 5
    c.append([5, 6])
    assert c.data[:, 0].tolist() == [4, 5, 6]
    msg, buffers = sent[0]
    assert msg["n_points"] == 3 and msg["total"] == 5
    assert np.frombuffer(buffers[0], dtype="<f4").tolist() == [2, 3, 4]


def test_snapshot_on_sync_request_and_clear():
    c = ai.WaveformChart(history=5)
    sent = capture(c)
    c.append([1, 2])
    c._handle_front_msg(c, {"type": "sync_request"}, [])
    msg, _ = sent[-1]
    assert msg == {"type": "snapshot", "n_points": 2, "total": 2}
    c.clear()
    assert sent[-1][0] == {"type": "clear"}
    assert c.total_samples == 0 and c.value == []


def test_shape_change_resets():
    c = ai.WaveformChart(history=5)
    capture(c)
    c.append([1, 2, 3])
    c.n_traces = 2
    assert c.data.shape == (0, 2)


def test_chart_is_indicator():
    assert ai.WaveformChart(mode="control").mode == "indicator"


def test_log_scale_and_secondary_axis_traits():
    # IND-117: logarithmic Y scale, traces assigned to a secondary right axis.
    chart = ai.WaveformChart(
        n_traces=2,
        y_scale="log",
        y_min=1,
        y_max=1e4,
        y2_max=100,
        y2_unit="%",
        traces=[{"name": "Pressure"}, {"name": "Valve", "axis": "right"}],
    )
    assert (chart.y_scale, chart.y2_min, chart.y2_max) == ("log", 0.0, 100.0)
    with pytest.raises(TraitError):
        chart.y_scale = "ln"
