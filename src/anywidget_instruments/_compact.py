"""Compact indicators: deviation bar, sparkline, bar graph, KPI tile (IND-100 .. IND-103)."""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

import numpy as np
import traitlets as t

from ._alarm_logic import ALARM_LEVELS, compute_alarm_level
from ._base import InstrumentWidget, float_serializers

_NAN = float("nan")


def _opt(v: Any) -> float | None:
    if v is None:
        return None
    f = float(v)
    return f if math.isfinite(f) else None


# ---------------------------------------------------------------------------
# DeviationIndicator (IND-100)
# ---------------------------------------------------------------------------
class DeviationIndicator(InstrumentWidget):
    """Centre-zero bar of the deviation between a value and its setpoint (IND-100).

    The bar runs from ``-span`` to ``+span`` around the setpoint; the band
    ``±tolerance`` is shaded. Inside the tolerance the bar is grey; outside it
    is drawn in the alarm color and labelled HIGH or LOW (ISA-101: color for
    abnormal situations only).

    >>> dev = DeviationIndicator(52.3, setpoint=50, tolerance=1.5, span=5, unit="°C")
    >>> dev.deviation, dev.out_of_tolerance
    (2.299999999999997, True)
    """

    _kind = t.Unicode("deviation").tag(sync=True)
    _default_mode = "indicator"
    _default_size = (220, 44)
    value = t.Float(_NAN).tag(sync=True, **float_serializers)
    setpoint = t.Float(0.0).tag(sync=True)
    tolerance = t.Float(1.0, min=0.0).tag(sync=True)
    span = t.Float(10.0).tag(sync=True)
    unit = t.Unicode("").tag(sync=True)
    format = t.Unicode("%.2f").tag(sync=True)

    def __init__(self, value: Any = None, **kwargs: Any) -> None:
        if value is not None:
            kwargs["value"] = value
        super().__init__(**kwargs)

    @t.validate("span")
    def _check_span(self, proposal: Any) -> float:
        v = float(proposal["value"])
        if not v > 0:
            raise t.TraitError(
                f"The 'span' trait of a {type(self).__name__} instance must be > 0, got {v}"
            )
        return v

    @property
    def deviation(self) -> float:
        """``value - setpoint``."""
        return self.value - self.setpoint

    @property
    def out_of_tolerance(self) -> bool:
        d = self.deviation
        return math.isfinite(d) and abs(d) > self.tolerance


# ---------------------------------------------------------------------------
# History of values, shared by Sparkline and KPITile (binary transfer)
# ---------------------------------------------------------------------------
class _HistoryMixin:
    """Keeps the last ``history`` values and sends them as float32 buffers."""

    history: int
    send: Any  # provided by the widget class

    def _init_history(self) -> None:
        self._hist = np.full(self.history, np.nan, dtype=np.float64)
        self._hist_total = 0

    @property
    def data(self) -> np.ndarray:
        """Kept values, oldest first."""
        n = min(self._hist_total, self.history)
        idx = (self._hist_total - n + np.arange(n)) % self.history
        return self._hist[idx].copy()

    def _push(self, values: Any) -> np.ndarray:
        v = np.atleast_1d(np.asarray(values, dtype=np.float64)).ravel()
        kept = v[-self.history :]
        idx = (self._hist_total + (v.size - kept.size) + np.arange(kept.size)) % self.history
        self._hist[idx] = kept
        self._hist_total += v.size
        if kept.size:
            payload = np.ascontiguousarray(kept, dtype="<f4").tobytes()
            self.send({"type": "append", "n": int(kept.size)}, buffers=[payload])
        return v

    def _send_history(self) -> None:
        data = np.ascontiguousarray(self.data, dtype="<f4").tobytes()
        n = int(min(self._hist_total, self.history))
        self.send({"type": "snapshot", "n": n}, buffers=[data])

    def _on_history_msg(self, _widget: Any, content: Any, _buffers: Any) -> None:
        if isinstance(content, dict) and content.get("type") == "sync_request":
            self._send_history()


# ---------------------------------------------------------------------------
# Sparkline (IND-101)
# ---------------------------------------------------------------------------
class Sparkline(_HistoryMixin, InstrumentWidget):
    """Compact trend of the last ``history`` values, without axes (IND-101).

    Shows the last value and marks the minimum (hollow dot) and the maximum
    (filled dot) of the kept values. Feed it with :meth:`append`; values
    travel as binary float32 buffers.

    >>> spark = Sparkline(history=60, unit="m", format="%.2f")
    >>> spark.append(2.31)
    """

    _kind = t.Unicode("sparkline").tag(sync=True)
    _default_mode = "indicator"
    _default_size = (160, 36)
    #: Last appended value.
    value = t.Float(_NAN, read_only=True).tag(sync=True, **float_serializers)
    history = t.Int(60, min=2).tag(sync=True)
    unit = t.Unicode("").tag(sync=True)
    format = t.Unicode("%.4g").tag(sync=True)

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._init_history()
        self.on_msg(self._on_history_msg)

    @t.observe("history")
    def _on_history(self, _change: Any) -> None:
        self._init_history()
        self._send_history()

    def append(self, values: Any) -> None:
        """Append a value or an array of values."""
        v = self._push(values)
        if v.size:
            self.set_trait("value", float(v[-1]))


# ---------------------------------------------------------------------------
# BarGraph (IND-102)
# ---------------------------------------------------------------------------
BAR_KEYS: tuple[str, ...] = ("label", "normal_lo", "normal_hi", "lolo", "lo", "hi", "hihi")


class BarGraph(InstrumentWidget):
    """Group of aligned bars on a shared scale (IND-102, ISA-101).

    ``bars`` describes each bar: ``{"label", "normal_lo", "normal_hi",
    "lolo", "lo", "hi", "hihi"}`` (only ``label`` is required); ``value``
    holds one value per bar. Bars are grey, with the normal band shaded and
    the limits marked; a bar in alarm is drawn in the alarm color and
    labelled with its level. ``alarm_levels`` gives the level of each bar.

    >>> zones = BarGraph(bars=["Z1", "Z2", {"label": "Z3", "hi": 80}], unit="°C", max=100)
    >>> zones.value = [62.0, 64.5, 83.1]
    >>> zones.alarm_levels
    ['normal', 'normal', 'hi']
    """

    _kind = t.Unicode("bargraph").tag(sync=True)
    _default_mode = "indicator"
    _default_size = (260, 160)
    value = t.List(t.Float(), default_value=[]).tag(sync=True, **float_serializers)
    bars: t.List[Any] = t.List().tag(sync=True)
    min = t.Float(0.0).tag(sync=True)
    max = t.Float(100.0).tag(sync=True)
    unit = t.Unicode("").tag(sync=True)
    format = t.Unicode("%.1f").tag(sync=True)
    deadband = t.Float(0.0, min=0.0).tag(sync=True)
    alarm_levels = t.List(t.Unicode(), read_only=True).tag(sync=True)

    def __init__(self, bars: Any = None, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        if bars is not None:
            self.bars = list(bars)
        self._update_levels()

    @t.validate("bars")
    def _check_bars(self, proposal: Any) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for i, bar in enumerate(proposal["value"]):
            if isinstance(bar, str):
                bar = {"label": bar}
            if not isinstance(bar, Mapping):
                raise t.TraitError(
                    f"The 'bars' trait of a {type(self).__name__} instance: bar {i} must be "
                    "a label or a dict"
                )
            unknown = set(bar) - set(BAR_KEYS)
            if unknown:
                raise t.TraitError(
                    f"The 'bars' trait of a {type(self).__name__} instance: unknown keys "
                    f"{sorted(unknown)} for bar {i}"
                )
            clean: dict[str, Any] = {"label": str(bar.get("label", f"{i + 1}"))}
            for key in BAR_KEYS[1:]:
                clean[key] = _opt(bar.get(key))
            out.append(clean)
        return out

    @t.validate("value")
    def _check_value(self, proposal: Any) -> list[float]:
        return [float(v) for v in proposal["value"]]

    @t.observe("value", "bars", "deadband")
    def _on_change(self, _change: Any) -> None:
        self._update_levels()

    def _update_levels(self) -> None:
        old = list(self.alarm_levels)
        levels = []
        for i, bar in enumerate(self.bars):
            if i >= len(self.value):  # no value for this bar: no alarm
                levels.append("normal")
                continue
            v = self.value[i]
            prev = old[i] if i < len(old) else "normal"
            levels.append(
                compute_alarm_level(
                    v,
                    lolo=bar["lolo"],
                    lo=bar["lo"],
                    hi=bar["hi"],
                    hihi=bar["hihi"],
                    deadband=self.deadband,
                    previous=prev if prev in ALARM_LEVELS else "normal",
                )
            )
        if levels != old:
            self.set_trait("alarm_levels", levels)


# ---------------------------------------------------------------------------
# KPITile (IND-103)
# ---------------------------------------------------------------------------
def oee(availability: float, performance: float, quality: float) -> float:
    """Overall equipment effectiveness: ``availability * performance * quality``.

    Each factor is a fraction between 0 and 1 (in the manner of ISO 22400);
    the result is a fraction too (multiply by 100 for percent).

    >>> round(oee(0.9, 0.95, 0.99), 4)
    0.8465
    """
    factors = {"availability": availability, "performance": performance, "quality": quality}
    for name, f in factors.items():
        if not 0.0 <= float(f) <= 1.0:
            raise ValueError(f"{name} must be a fraction between 0 and 1, got {f!r}")
    return float(availability) * float(performance) * float(quality)


class KPITile(_HistoryMixin, InstrumentWidget):
    """Key performance indicator tile (IND-103).

    Shows ``value`` with its ``unit``, the ``target`` and the difference to
    the target with its direction (▲ / ▼) and whether it is on the good side
    (``higher_is_better``). With ``show_sparkline`` the last ``history``
    values appended with :meth:`append` are drawn as a sparkline.

    >>> tile = KPITile(oee(0.9, 0.95, 0.99) * 100, unit="%", target=85, label="OEE")
    """

    _kind = t.Unicode("kpitile").tag(sync=True)
    _default_mode = "indicator"
    _default_size = (190, 96)
    value = t.Float(_NAN).tag(sync=True, **float_serializers)
    target = t.Float(None, allow_none=True).tag(sync=True)
    higher_is_better = t.Bool(True).tag(sync=True)
    unit = t.Unicode("").tag(sync=True)
    format = t.Unicode("%.1f").tag(sync=True)
    show_sparkline = t.Bool(True).tag(sync=True)
    history = t.Int(30, min=2).tag(sync=True)

    def __init__(self, value: Any = None, **kwargs: Any) -> None:
        if value is not None:
            kwargs["value"] = value
        super().__init__(**kwargs)
        self._init_history()
        self.on_msg(self._on_history_msg)

    @t.observe("history")
    def _on_history(self, _change: Any) -> None:
        self._init_history()
        self._send_history()

    @property
    def delta(self) -> float | None:
        """``value - target`` (None without a target)."""
        return None if self.target is None else self.value - self.target

    @property
    def on_target(self) -> bool | None:
        """Whether the value is on the good side of the target (None without a target)."""
        d = self.delta
        if d is None or not math.isfinite(d):
            return None
        return d >= 0 if self.higher_is_better else d <= 0

    def append(self, values: Any) -> None:
        """Append values to the sparkline history; the last one becomes ``value``."""
        v = self._push(values)
        if v.size:
            self.value = float(v[-1])
