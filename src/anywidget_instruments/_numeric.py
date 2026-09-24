"""Numeric controls and indicators (NUM-*, ALARM-*, UNIT-*)."""

from __future__ import annotations

import math
import time
from typing import Any

import numpy as np
import traitlets as t

from ._alarm_logic import ALARM_LEVELS, compute_alarm_level, eng_scale
from ._base import InstrumentWidget, float_serializers


class NumericValue(t.Float):
    """Float trait that also accepts numpy scalars and ``pint`` quantities (UNIT-002).

    A quantity is converted to the widget ``unit`` before being stored.
    """

    def validate(self, obj: Any, value: Any) -> Any:
        if hasattr(value, "magnitude") and hasattr(value, "to"):
            unit = getattr(obj, "unit", "")
            try:
                value = value.to(unit).magnitude if unit else value.magnitude
            except Exception as exc:
                raise t.TraitError(
                    f"The '{self.name}' trait of a {type(obj).__name__} instance cannot "
                    f"convert {value!r} to unit {unit!r}: {exc}"
                ) from exc
        if isinstance(value, (np.integer, np.floating)):
            value = float(value)
        return super().validate(obj, value)


def _opt_float() -> Any:
    return t.Float(None, allow_none=True).tag(sync=True)


class NumericWidget(InstrumentWidget):
    """Base class of every numeric widget.

    Scale: ``min``, ``max``, ``step``, ``unit``, ``scale`` (``"linear"``/``"log"``),
    ``ticks`` (major intervals), ``minor_ticks`` (subdivisions per interval).

    Display: ``format`` is a printf-like spec: ``%.2f`` fixed, ``%.3e`` scientific,
    ``%.3g`` general, ``%.3n`` engineering (exponent multiple of 3) and
    ``%.3s`` SI prefix (m, µ, k, M ...).

    Alarms: ``lolo``, ``lo``, ``hi``, ``hihi``, ``deadband``; the resulting level
    is published in ``alarm_level``. ``show_limits`` draws them on the scale.

    Engineering scaling: set ``raw_min``, ``raw_max``, ``eng_min``, ``eng_max`` and
    call :meth:`set_raw` with the raw reading.
    """

    value = NumericValue(0.0).tag(sync=True, **float_serializers)
    min = t.Float(0.0).tag(sync=True)
    max = t.Float(100.0).tag(sync=True)
    step = t.Float(0.0).tag(sync=True)
    unit = t.Unicode("").tag(sync=True)
    scale = t.Enum(["linear", "log"], default_value="linear").tag(sync=True)
    ticks = t.Int(5, min=1).tag(sync=True)
    minor_ticks = t.Int(4, min=0).tag(sync=True)
    format = t.Unicode("%.1f").tag(sync=True)
    coerce = t.Bool(False).tag(sync=True)
    update_rate = t.Float(30.0, min=1.0).tag(sync=True)
    animate = t.Bool(False).tag(sync=True)
    animation_ms = t.Int(200, min=0, max=300).tag(sync=True)

    lolo = _opt_float()
    lo = _opt_float()
    hi = _opt_float()
    hihi = _opt_float()
    deadband = t.Float(0.0, min=0.0).tag(sync=True)
    show_limits = t.Bool(False).tag(sync=True)
    alarm_level = t.Enum(list(ALARM_LEVELS), default_value="normal", read_only=True).tag(sync=True)

    raw_min = _opt_float()
    raw_max = _opt_float()
    eng_min = _opt_float()
    eng_max = _opt_float()

    def __init__(self, value: Any = None, **kwargs: Any) -> None:
        if value is not None:
            kwargs["value"] = value
        # scale limits and unit must be known before value is validated
        ordered = {k: kwargs.pop(k) for k in ("unit", "min", "max", "coerce") if k in kwargs}
        super().__init__(**ordered)
        self.set_trait("value", kwargs.pop("value", self.value))
        for key, val in kwargs.items():
            setattr(self, key, val)
        self._check_scale()
        self._update_alarm()

    # -- validation ----------------------------------------------------------
    def _check_scale(self) -> None:
        if not self.max > self.min:
            raise t.TraitError(
                f"{type(self).__name__}: 'max' ({self.max}) must be greater than 'min' ({self.min})"
            )
        if self.scale == "log" and self.min <= 0:
            raise t.TraitError(f"{type(self).__name__}: a logarithmic scale requires 'min' > 0")

    @t.observe("min", "max", "scale")
    def _on_scale_change(self, _change: Any) -> None:
        if self.max > self.min:
            self._check_scale()

    @t.validate("value")
    def _coerce_value(self, proposal: Any) -> float:
        v = float(proposal["value"])
        if self.coerce and math.isfinite(v):
            v = min(max(v, self.min), self.max)
        return v

    # -- alarms ---------------------------------------------------------------
    @t.observe("value", "lolo", "lo", "hi", "hihi", "deadband")
    def _on_alarm_inputs(self, _change: Any) -> None:
        self._update_alarm()

    def _update_alarm(self) -> None:
        level = compute_alarm_level(
            self.value,
            lolo=self.lolo,
            lo=self.lo,
            hi=self.hi,
            hihi=self.hihi,
            deadband=self.deadband,
            previous=self.alarm_level,
        )
        if level != self.alarm_level:
            self.set_trait("alarm_level", level)

    # -- engineering scaling ---------------------------------------------------
    def _scaling(self) -> tuple[float, float, float, float]:
        params = (self.raw_min, self.raw_max, self.eng_min, self.eng_max)
        if any(p is None for p in params):
            raise ValueError(
                f"{type(self).__name__}: set raw_min, raw_max, eng_min and eng_max first"
            )
        return params

    def raw_to_eng(self, raw: float) -> float:
        """Convert a raw reading to engineering units."""
        return eng_scale(raw, *self._scaling())

    def eng_to_raw(self, value: float) -> float:
        """Convert a value in engineering units back to a raw reading."""
        rmin, rmax, emin, emax = self._scaling()
        return eng_scale(value, emin, emax, rmin, rmax)

    def set_raw(self, raw: float) -> None:
        """Set ``value`` from a raw reading using the engineering scaling."""
        self.value = self.raw_to_eng(raw)

    @property
    def raw_value(self) -> float:
        """Current value expressed in raw units."""
        return self.eng_to_raw(self.value)


class _PeakMixin(NumericWidget):
    """Peak-hold support (NUM-110), computed kernel-side."""

    peak_hold = t.Bool(False).tag(sync=True)
    peak_decay = t.Float(0.0, min=0.0).tag(sync=True)  # seconds, 0 = hold until reset
    peak = t.Float(None, allow_none=True, read_only=True).tag(sync=True, **float_serializers)

    _peak_time: float = 0.0

    @t.observe("value")
    def _track_peak(self, change: Any) -> None:
        if not self.peak_hold or not math.isfinite(change["new"]):
            return
        now = time.monotonic()
        expired = self.peak_decay > 0 and now - self._peak_time > self.peak_decay
        if self.peak is None or change["new"] >= self.peak or expired:
            self.set_trait("peak", change["new"])
            self._peak_time = now

    def reset_peak(self) -> None:
        """Forget the held peak value."""
        self.set_trait("peak", None)


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------
class Knob(NumericWidget):
    """Rotary control with a pointer (NUM-101)."""

    _kind = t.Unicode("knob").tag(sync=True)
    angle_range = t.Float(270.0, min=10.0, max=360.0).tag(sync=True)


class Dial(NumericWidget):
    """Rotary control with a circular scale, optionally multi-turn (NUM-102)."""

    _kind = t.Unicode("dial").tag(sync=True)
    angle_range = t.Float(300.0, min=10.0, max=360.0).tag(sync=True)
    turns = t.Int(1, min=1).tag(sync=True)


class Gauge(_PeakMixin):
    """Circular or semi-circular gauge with needle and colored ranges (NUM-103).

    ``ranges`` is a list of ``{"from": float, "to": float, "color": css_color}``.
    """

    _kind = t.Unicode("gauge").tag(sync=True)
    _default_mode = "indicator"
    variant = t.Enum(["circular", "semicircular"], default_value="circular").tag(sync=True)
    ranges = t.List(t.Dict()).tag(sync=True)


class Meter(_PeakMixin):
    """Analog needle meter with a sector scale (NUM-104)."""

    _kind = t.Unicode("meter").tag(sync=True)
    _default_mode = "indicator"
    _default_size = (200, 140)
    angle_range = t.Float(90.0, min=20.0, max=150.0).tag(sync=True)


class VUMeter(_PeakMixin):
    """Segmented bar graph with peak-hold marker (NUM-105)."""

    _kind = t.Unicode("vumeter").tag(sync=True)
    _default_mode = "indicator"
    _default_size = (60, 200)
    segments = t.Int(20, min=2).tag(sync=True)
    orientation = t.Enum(["vertical", "horizontal"], default_value="vertical").tag(sync=True)


class Tank(NumericWidget):
    """Vertical level indicator with optional level markers (NUM-106)."""

    _kind = t.Unicode("tank").tag(sync=True)
    _default_mode = "indicator"
    _default_size = (120, 200)
    fill_color = t.Unicode("").tag(sync=True)
    markers = t.List(t.Float()).tag(sync=True)


class Thermometer(NumericWidget):
    """Vertical indicator with bulb and fluid column (NUM-107)."""

    _kind = t.Unicode("thermometer").tag(sync=True)
    _default_mode = "indicator"
    _default_size = (100, 220)
    unit = t.Unicode("°C").tag(sync=True)
    min = t.Float(-20.0).tag(sync=True)
    max = t.Float(120.0).tag(sync=True)
    ticks = t.Int(7, min=1).tag(sync=True)
    fill_color = t.Unicode("").tag(sync=True)


class FillSlide(NumericWidget):
    """Horizontal or vertical slider control / bar indicator (NUM-108)."""

    _kind = t.Unicode("fillslide").tag(sync=True)
    _default_size = (260, 70)
    orientation = t.Enum(["horizontal", "vertical"], default_value="horizontal").tag(sync=True)
    fill_color = t.Unicode("").tag(sync=True)

    def __init__(self, value: Any = None, **kwargs: Any) -> None:
        if kwargs.get("orientation") == "vertical":
            kwargs.setdefault("size", (80, 240))
        super().__init__(value, **kwargs)


class SevenSegment(NumericWidget):
    """Seven-segment numeric display (NUM-109)."""

    _kind = t.Unicode("sevensegment").tag(sync=True)
    _default_mode = "indicator"
    _default_size = (200, 80)
    digits = t.Int(4, min=1, max=16).tag(sync=True)
    decimals = t.Int(1, min=0).tag(sync=True)
    color = t.Unicode("").tag(sync=True)
    min = t.Float(-1e9).tag(sync=True)
    max = t.Float(1e9).tag(sync=True)


class Compass(NumericWidget):
    """Heading display in degrees with cardinal labels (SPEC-001)."""

    _kind = t.Unicode("compass").tag(sync=True)
    _default_mode = "indicator"
    min = t.Float(0.0).tag(sync=True)
    max = t.Float(360.0).tag(sync=True)
    unit = t.Unicode("°").tag(sync=True)
    format = t.Unicode("%.0f").tag(sync=True)
    ticks = t.Int(8, min=1).tag(sync=True)

    @t.validate("value")
    def _wrap_heading(self, proposal: Any) -> float:
        v = float(proposal["value"])
        return v % 360.0 if math.isfinite(v) else v
