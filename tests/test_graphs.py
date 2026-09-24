import math

import numpy as np
import pytest
import traitlets as t

import anywidget_instruments as ai


def capture(w):
    sent = []

    def send(content, buffers=None):
        if content.get("type") != "hb":  # liveness heartbeats (ROB-001) may arrive any time
            sent.append((content, buffers or []))

    w.send = send
    return sent


# -- cursors / annotations (CHART-104, CHART-105) -----------------------------------
def test_waveform_cursor_values_interpolated():
    c = ai.WaveformChart(history=10, dt=0.5)
    capture(c)
    c.append([0.0, 1.0, 2.0, 3.0])
    i = c.add_cursor(0.75, name="A")  # halfway between samples 1 and 2
    assert c.cursor_values[i] == {"name": "A", "x": 0.75, "values": [1.5]}
    c.move_cursor(i, 1.5)
    assert c.cursor_values[0]["values"] == [3.0]
    c.move_cursor(i, 100)
    assert math.isnan(c.cursor_values[0]["values"][0])
    c.append([10.0])  # values refresh with new data
    c.move_cursor(i, 2.0)
    assert c.cursor_values[0]["values"] == [10.0]
    c.remove_cursor(0)
    assert c.cursor_values == []


def test_cursor_from_front_end_is_validated():
    c = ai.WaveformChart()
    capture(c)
    c.set_state({"cursors": [{"x": 3}]})
    assert c.cursors == [{"x": 3.0, "name": "C1", "color": ""}]
    with pytest.raises(t.TraitError, match="numeric 'x'"):
        c.cursors = [{"name": "bad"}]


def test_sweep_cursor_maps_to_latest_slot():
    c = ai.WaveformChart(history=4, update_mode="sweep")
    capture(c)
    c.append(np.arange(6.0))  # slots: [4, 5, 2, 3]
    c.add_cursor(1)
    assert c.cursor_values[0]["values"] == [5.0]
    c.move_cursor(0, 2)
    assert c.cursor_values[0]["values"] == [2.0]


def test_annotations():
    c = ai.WaveformChart()
    c.annotate(1, 0.5, "peak", color="red")
    assert c.annotations == [{"x": 1.0, "y": 0.5, "text": "peak", "color": "red"}]
    c.clear_annotations()
    assert c.annotations == []


# -- IntensityChart (CHART-101) ----------------------------------------------------------
def test_intensity_append_and_circular_buffer():
    ic = ai.IntensityChart(history=3, n_bins=4)
    sent = capture(ic)
    ic.append([1, 2, 3, 4])
    ic.append(np.arange(12).reshape(3, 4))
    assert ic.total_rows == 4
    assert ic.data.tolist() == [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11]]
    assert ic.value == {"rows": 4, "min": 8.0, "max": 11.0, "argmax": 3}
    msg, buffers = sent[-1]
    assert msg == {"type": "append", "n_rows": 3, "total": 4}
    assert np.frombuffer(buffers[0], "<f4").reshape(3, 4)[0].tolist() == [0, 1, 2, 3]
    with pytest.raises(ValueError):
        ic.append([1, 2])
    assert ic.values_at(3) == [8.0, 9.0, 10.0, 11.0]
    assert ic.values_at(0) == []  # discarded
    ic.clear()
    assert ic.total_rows == 0 and sent[-1][0] == {"type": "clear"}


def test_intensity_snapshot_and_colormap():
    ic = ai.IntensityChart(n_bins=2, colormap="inferno")
    sent = capture(ic)
    ic.append([[1, 2]])
    ic._handle_front_msg(ic, {"type": "sync_request"}, [])
    assert sent[-1][0] == {"type": "snapshot", "n_rows": 1, "total": 1}
    with pytest.raises(t.TraitError):
        ic.colormap = "rainbow-unicorn"
    assert set(ai.COLORMAPS) >= {"viridis", "gray", "jet"}


# -- DigitalWaveformGraph (CHART-102) ---------------------------------------------------
def test_unpack_bits():
    assert ai.unpack_bits([5, 2], 3).tolist() == [[1, 0, 1], [0, 1, 0]]


def test_digital_graph_bus_values_and_cursor():
    g = ai.DigitalWaveformGraph(dt=1e-6, x_unit="s")
    sent = capture(g)
    g.set_data([0x00, 0xA5, 0xFF, 0x3C], n_bits=8)
    assert g.lines == [f"D{k}" for k in range(8)]
    g.buses = [{"name": "DATA", "lines": list(range(7, -1, -1))}]
    assert g.bus_values(g.buses[0]).tolist() == [0x00, 0xA5, 0xFF, 0x3C]
    g.add_cursor(1.5e-6)
    assert g.cursor_values[0]["values"][-1] == "0xA5"
    assert g.cursor_values[0]["values"][:8] == [1, 0, 1, 0, 0, 1, 0, 1]
    msg, buffers = sent[-1]
    assert msg["n_samples"] == 4 and msg["n_lines"] == 8
    assert len(buffers[0]) == 32
    with pytest.raises(t.TraitError):
        g.buses = [{"name": "X", "lines": [9]}]
    with pytest.raises(t.TraitError):
        g.buses = [{"name": "X"}]


def test_digital_graph_from_boolean_array():
    g = ai.DigitalWaveformGraph(lines=["CLK", "EN"])
    capture(g)
    g.set_data(np.array([[1, 0], [0, 1], [1, 1]], dtype=bool))
    assert g.lines == ["CLK", "EN"]
    assert g.bits.tolist() == [[1, 0], [0, 1], [1, 1]]
    assert g.value == {"n_samples": 3, "n_lines": 2}


# -- MixedSignalGraph (CHART-103) ---------------------------------------------------------
def test_mixed_signal():
    m = ai.MixedSignalGraph(dt=0.1)
    sent = capture(m)
    m.set_analog(np.sin(np.linspace(0, 1, 5)))
    m.set_data([0, 1, 1, 0, 1], n_bits=1)
    m.add_cursor(0.2)
    vals = m.cursor_values[0]["values"]
    assert vals[0] == 1 and vals[1] == pytest.approx(np.sin(0.5))
    msg, buffers = sent[-1]
    assert msg["n_analog"] == 5 and msg["n_traces"] == 1
    assert len(buffers[1]) == 5 * 4


def test_digital_graph_buses_in_constructor():
    g = ai.DigitalWaveformGraph(buses=[{"name": "B", "lines": [1, 0]}])
    capture(g)
    g.set_data([0, 1, 2, 3], n_bits=2)
    assert g.bus_values(g.buses[0]).tolist() == [0, 1, 2, 3]
