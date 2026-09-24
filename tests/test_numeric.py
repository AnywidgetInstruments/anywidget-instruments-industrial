import math

import numpy as np
import pytest
import traitlets as t

import anywidget_instruments as ai

NUMERIC = [
    ai.Knob,
    ai.Dial,
    ai.Gauge,
    ai.Meter,
    ai.VUMeter,
    ai.Tank,
    ai.Thermometer,
    ai.FillSlide,
    ai.SevenSegment,
    ai.Compass,
]


@pytest.mark.parametrize("cls", NUMERIC)
def test_common_api(cls):
    w = cls(label="x", unit="V")
    for name in (
        "value",
        "mode",
        "label",
        "disabled",
        "visible",
        "tooltip",
        "size",
        "style",
        "min",
        "max",
        "step",
        "unit",
        "alarm_level",
    ):
        assert name in w.traits()
        assert w.trait_metadata(name, "sync"), name
    assert w._kind  # renderer selected
    assert w.mode in ("control", "indicator")


def test_default_modes():
    assert ai.Knob().mode == "control"
    assert ai.Gauge().mode == "indicator"
    assert ai.Tank().mode == "indicator"


def test_invalid_type_error_names_widget_and_trait():
    k = ai.Knob()
    with pytest.raises(t.TraitError, match=r"'value' trait of a Knob instance"):
        k.value = "high"
    with pytest.raises(t.TraitError, match="mode"):
        k.mode = "sometimes"


def test_min_max_validation():
    with pytest.raises(t.TraitError, match="greater"):
        ai.Knob(min=10, max=0)
    with pytest.raises(t.TraitError, match="logarithmic"):
        ai.Knob(min=0, max=10, scale="log")


def test_no_coerce_keeps_out_of_range_value():
    k = ai.Knob(150)
    assert k.value == 150  # display is clamped front-end side (NUM-006)


def test_coerce_clamps_value():
    k = ai.Knob(150, coerce=True)
    assert k.value == 100
    k.value = -5
    assert k.value == 0
    k.value = math.nan  # NaN is not clamped (NUM-007)
    assert math.isnan(k.value)


def test_nan_serialization():
    k = ai.Knob()
    k.value = math.inf
    to_json = k.trait_metadata("value", "to_json")
    from_json = k.trait_metadata("value", "from_json")
    assert to_json(math.nan, k) == "nan"
    assert to_json(-math.inf, k) == "-inf"
    assert to_json(1.5, k) == 1.5
    assert math.isinf(from_json("inf", k))


def test_numpy_scalars_accepted():
    k = ai.Knob(np.float32(3.5))
    assert k.value == 3.5
    k.value = np.int64(7)
    assert k.value == 7.0


def test_engineering_scaling_4_20mA():
    tr = ai.Tank(min=0, max=5, unit="m", raw_min=4, raw_max=20, eng_min=0, eng_max=5)
    tr.set_raw(12)
    assert tr.value == pytest.approx(2.5)
    assert tr.raw_value == pytest.approx(12)
    assert tr.raw_to_eng(20) == pytest.approx(5)


def test_engineering_scaling_counts():
    assert ai.eng_scale(32767, 0, 32767, -10, 10) == pytest.approx(10)
    with pytest.raises(ValueError):
        ai.Knob().set_raw(3)


def test_pint_quantity_conversion():
    pint = pytest.importorskip("pint")
    ureg = pint.UnitRegistry()
    th = ai.Thermometer(unit="degC", min=-20, max=120)
    th.value = ureg.Quantity(300, "kelvin")
    assert th.value == pytest.approx(26.85)
    g = ai.Gauge(unit="kPa", max=500)
    g.value = 2 * ureg.bar
    assert g.value == pytest.approx(200)
    with pytest.raises(t.TraitError, match="cannot convert"):
        g.value = 3 * ureg.meter


def test_compass_wraps_heading():
    c = ai.Compass(370)
    assert c.value == 10
    c.value = -90
    assert c.value == 270


def test_peak_hold():
    g = ai.Gauge(peak_hold=True)
    for v in (10, 50, 30):
        g.value = v
    assert g.peak == 50
    g.reset_peak()
    assert g.peak is None
    g.value = 20
    assert g.peak == 20


def test_peak_decay(monkeypatch):
    import anywidget_instruments._numeric as mod

    now = [100.0]
    monkeypatch.setattr(mod.time, "monotonic", lambda: now[0])
    g = ai.Meter(peak_hold=True, peak_decay=1.0)
    g.value = 80
    now[0] += 2
    g.value = 10
    assert g.peak == 10


def test_default_style(monkeypatch):
    try:
        ai.set_default_style("classic")
        assert ai.Knob().style == "classic"
        assert ai.Knob(style="system").style == "system"
    finally:
        ai.set_default_style("modern")
    with pytest.raises(ValueError):
        ai.set_default_style("fancy")


def test_size_validation():
    with pytest.raises(t.TraitError):
        ai.Knob(size=(0, 10))
    assert ai.Knob(size=(80, 80)).size == (80, 80)
    assert ai.FillSlide(orientation="vertical").size == (80, 240)
