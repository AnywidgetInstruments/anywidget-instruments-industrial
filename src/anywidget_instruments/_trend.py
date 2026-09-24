"""Time-based trend chart with named pens (IND-070 .. IND-075)."""

from __future__ import annotations

import math
import time as _time
from collections.abc import Mapping
from typing import Any

import numpy as np
import traitlets as t

from ._base import float_serializers
from ._graph import GraphWidget

#: Keys of a pen description.
PEN_KEYS: tuple[str, ...] = (
    "name",
    "unit",
    "min",
    "max",
    "color",
    "lolo",
    "lo",
    "hi",
    "hihi",
    "setpoint",
    "format",
)


def _opt(v: Any) -> float | None:
    if v is None:
        return None
    f = float(v)
    return f if math.isfinite(f) else None


class _PenBuffer:
    """Circular buffer of timestamped samples of one pen."""

    def __init__(self, capacity: int) -> None:
        self.capacity = capacity
        self.t = np.zeros(capacity, dtype=np.float64)
        self.v = np.zeros(capacity, dtype=np.float64)
        self.total = 0

    def push(self, times: np.ndarray, values: np.ndarray) -> None:
        n = len(times)
        kept_t, kept_v = times[-self.capacity :], values[-self.capacity :]
        idx = (self.total + (n - len(kept_t)) + np.arange(len(kept_t))) % self.capacity
        self.t[idx] = kept_t
        self.v[idx] = kept_v
        self.total += n

    def data(self) -> tuple[np.ndarray, np.ndarray]:
        n = min(self.total, self.capacity)
        idx = (self.total - n + np.arange(n)) % self.capacity
        return self.t[idx].copy(), self.v[idx].copy()


class TrendChart(GraphWidget):
    """Trend of one or more named pens against wall-clock time (IND-070 .. IND-075).

    ``pens`` lists the pens as dicts: ``{"name", "unit", "min", "max",
    "color", "lolo", "lo", "hi", "hihi", "setpoint", "format"}``; only
    ``name`` is required. Each pen has its own scale (``min`` .. ``max``);
    the vertical axis shows the scale of the selected pen (click its legend
    entry) and the other pens are drawn on their own scales. Alarm limits and
    the setpoint are drawn as reference lines (IND-073).

    Feed it with :meth:`add` or :meth:`add_many`; times are Unix timestamps
    in seconds (``time.time()``, the default). In live mode the chart shows
    the last ``span`` seconds; browsing the history (arrows, zoom) freezes the
    view until the Live button is pressed (IND-072). Each pen keeps at most
    ``history`` samples (IND-074).

    >>> trend = TrendChart(pens=[{"name": "LT-101", "unit": "m", "min": 0, "max": 4}])
    >>> trend.add("LT-101", 2.4)
    """

    _kind = t.Unicode("trendchart").tag(sync=True)
    _default_size = (560, 260)

    #: Latest value of each pen, by name.
    value = t.Dict(read_only=True).tag(sync=True, **float_serializers)
    pens: t.List[Any] = t.List().tag(sync=True)
    span = t.Float(600.0, min=1.0).tag(sync=True)
    history = t.Int(10_000, min=2).tag(sync=True)
    x_unit = t.Unicode("").tag(sync=True)

    def __init__(self, pens: Any = None, **kwargs: Any) -> None:
        self._buffers: dict[str, _PenBuffer] = {}
        super().__init__(**kwargs)
        if pens is not None:
            self.pens = list(pens)
        self.on_msg(self._handle_front_msg)

    # -- pens ----------------------------------------------------------------------
    @t.validate("pens")
    def _check_pens(self, proposal: Any) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        names: set[str] = set()
        for i, pen in enumerate(proposal["value"]):
            if isinstance(pen, str):
                pen = {"name": pen}
            if not isinstance(pen, Mapping) or not str(pen.get("name") or ""):
                raise t.TraitError(
                    f"The 'pens' trait of a {type(self).__name__} instance: pen {i} needs a 'name'"
                )
            name = str(pen["name"])
            if name in names:
                raise t.TraitError(
                    f"The 'pens' trait of a {type(self).__name__} instance: duplicate pen {name!r}"
                )
            names.add(name)
            unknown = set(pen) - set(PEN_KEYS)
            if unknown:
                raise t.TraitError(
                    f"The 'pens' trait of a {type(self).__name__} instance: unknown keys "
                    f"{sorted(unknown)} for pen {name!r}"
                )
            lo = _opt(pen.get("min"))
            hi = _opt(pen.get("max"))
            lo = 0.0 if lo is None else lo
            hi = 100.0 if hi is None else hi
            if not hi > lo:
                raise t.TraitError(
                    f"The 'pens' trait of a {type(self).__name__} instance: pen {name!r} "
                    f"needs max > min, got {lo} .. {hi}"
                )
            clean: dict[str, Any] = {
                "name": name,
                "unit": str(pen.get("unit") or ""),
                "min": lo,
                "max": hi,
                "color": str(pen.get("color") or ""),
                "format": str(pen.get("format") or "%.4g"),
            }
            for key in ("lolo", "lo", "hi", "hihi", "setpoint"):
                clean[key] = _opt(pen.get(key))
            out.append(clean)
        return out

    @t.observe("pens", "history")
    def _on_pens(self, change: Any) -> None:
        names = [p["name"] for p in self.pens]
        old = self._buffers
        if change["name"] == "history":
            old = {}
        self._buffers = {n: old.get(n) or _PenBuffer(self.history) for n in names}
        self.set_trait("value", {n: v for n, v in self.value.items() if n in self._buffers})
        self._send_snapshot()

    def _buffer(self, pen: str) -> _PenBuffer:
        try:
            return self._buffers[pen]
        except KeyError:
            raise KeyError(f"no pen {pen!r} in this TrendChart") from None

    # -- data ------------------------------------------------------------------------
    def add(self, pen: str, value: Any, time: Any = None) -> None:
        """Add samples to ``pen``: a scalar or an array, at ``time`` (default: now).

        ``time`` is a Unix timestamp in seconds, or an array of timestamps of
        the same length as ``value``.
        """
        self._add({pen: value}, time)

    def add_many(self, values: Mapping[str, Any], time: Any = None) -> None:
        """Add one sample (or arrays) to several pens at once, e.g. ``{"LT-101": 2.4}``."""
        self._add(values, time)

    def _add(self, values: Mapping[str, Any], time: Any) -> None:
        now = _time.time() if time is None else None
        header: list[list[Any]] = []
        buffers: list[bytes] = []
        latest = dict(self.value)
        for pen, raw in values.items():
            buf = self._buffer(pen)
            v = np.atleast_1d(np.asarray(raw, dtype=np.float64)).ravel()
            if time is None:
                ts = np.full(v.shape, now, dtype=np.float64)
            else:
                ts = np.atleast_1d(np.asarray(time, dtype=np.float64)).ravel()
                if ts.size == 1 and v.size > 1:
                    ts = np.full(v.shape, ts[0])
                if ts.shape != v.shape:
                    raise ValueError(f"pen {pen!r}: {v.size} values but {ts.size} timestamps")
            if v.size == 0:
                continue
            buf.push(ts, v)
            latest[pen] = float(v[-1])
            kept = min(v.size, buf.capacity)
            header.append([self._index(pen), kept, buf.total])
            buffers.append(np.ascontiguousarray(ts[-kept:], dtype="<f8").tobytes())
            buffers.append(np.ascontiguousarray(v[-kept:], dtype="<f4").tobytes())
        if not header:
            return
        self.set_trait("value", latest)
        if self.cursors:
            self._update_cursor_values()
        self.send({"type": "append", "pens": header}, buffers=buffers)

    def _index(self, pen: str) -> int:
        return next(i for i, p in enumerate(self.pens) if p["name"] == pen)

    def data(self, pen: str) -> tuple[np.ndarray, np.ndarray]:
        """Buffered ``(times, values)`` of ``pen`` in chronological order."""
        return self._buffer(pen).data()

    def clear(self) -> None:
        """Forget every sample."""
        self._buffers = {p["name"]: _PenBuffer(self.history) for p in self.pens}
        self.set_trait("value", {})
        self.send({"type": "clear"})

    # -- cursors (CHART-104) --------------------------------------------------------------
    def values_at(self, x: float) -> list[Any]:
        out: list[Any] = []
        for p in self.pens:
            ts, vs = self._buffers[p["name"]].data()
            if ts.size == 0 or x < ts[0] or x > ts[-1]:
                out.append(float("nan"))
            else:
                out.append(float(np.interp(x, ts, vs)))
        return out

    # -- front-end protocol -----------------------------------------------------------------
    def _send_snapshot(self) -> None:
        header: list[list[Any]] = []
        buffers: list[bytes] = []
        for i, p in enumerate(self.pens):
            buf = self._buffers.get(p["name"])
            if buf is None:
                continue
            ts, vs = buf.data()
            header.append([i, int(ts.size), buf.total])
            buffers.append(np.ascontiguousarray(ts, dtype="<f8").tobytes())
            buffers.append(np.ascontiguousarray(vs, dtype="<f4").tobytes())
        self.send({"type": "snapshot", "pens": header}, buffers=buffers)

    def _handle_front_msg(self, _widget: Any, content: Any, _buffers: Any) -> None:
        if isinstance(content, dict) and content.get("type") == "sync_request":
            self._send_snapshot()
