import numpy as np
import pytest
import traitlets as t

import anywidget_instruments_industrial as ai


def test_polar_plot_series():
    p = ai.PolarPlot(angle_unit="deg", zero="N", direction="cw")
    i = p.plot([1, 2, 3], [0, 90, 180], name="gain", color="red")
    assert i == 0
    assert p.value[0] == {
        "name": "gain",
        "color": "red",
        "style": "line",
        "r": [1.0, 2.0, 3.0],
        "theta": [0.0, 90.0, 180.0],
    }
    p.plot([4], [45], name="gain")  # same name replaces
    assert len(p.value) == 1 and p.value[0]["r"] == [4.0]
    p.plot([1], [1])
    assert p.value[1]["name"] == "set 2"
    with pytest.raises(ValueError):
        p.plot([1, 2], [0])
    with pytest.raises(ValueError):
        p.plot([1], [0], style="dots")
    p.clear()
    assert p.value == []


def test_smith_gamma_and_impedance():
    s = ai.SmithChart(z0=50)
    assert s.gamma(50) == 0
    assert s.gamma(0) == -1
    np.testing.assert_allclose(s.impedance(s.gamma([25 + 10j, 100 - 30j])), [25 + 10j, 100 - 30j])
    s.plot([50, 100, 25 + 25j], name="load")
    ser = s.value[0]
    assert ser["re"][0] == 0 and ser["re"][1] == pytest.approx(1 / 3)
    s.plot([0.5j], kind="reflection", name="g")
    assert s.value[1]["im"] == [0.5]
    with pytest.raises(ValueError):
        s.plot([1], kind="admittance")
    with pytest.raises(t.TraitError):
        s.z0 = 0


def test_radar_chart():
    r = ai.RadarChart(axes=["speed", "power", "cost"], ranges=[[0, 10], [0, 5], [0, 100]])
    r.plot([5, 2.5, 50], name="A")
    assert r.value[0]["values"] == [5.0, 2.5, 50.0]
    with pytest.raises(ValueError):
        r.plot([1, 2])
    with pytest.raises(t.TraitError):
        r.ranges = [[5, 1], [0, 1], [0, 1]]
