"""XYGraph: data sets of (x, y) pairs with arbitrary spacing (IND-115)."""

from __future__ import annotations

from typing import Any

import numpy as np
import traitlets as t

from ._base import size_trait
from ._graph import GraphWidget

#: Drawing styles of an XYGraph data set.
XY_STYLES: tuple[str, ...] = ("line", "markers", "both", "step", "bar")


def xy_value_at(xs: np.ndarray, ys: np.ndarray, x: float) -> float:
    """y of a data set at ``x``: linear interpolation between the points sorted by x.

    NaN outside the x range of the data set or for an empty one; points with
    a non-finite coordinate are ignored.
    """
    ok = np.isfinite(xs) & np.isfinite(ys)
    xs, ys = xs[ok], ys[ok]
    if xs.size == 0 or not np.isfinite(x) or x < xs.min() or x > xs.max():
        return float("nan")
    order = np.argsort(xs, kind="stable")
    return float(np.interp(x, xs[order], ys[order]))


class XYGraph(GraphWidget):
    """Data sets of (x, y) pairs with arbitrary spacing (IND-115).

    Characteristic curves (pump, valve, I-V), scatter plots, Lissajous
    figures, measurements at irregular points. Each data set is drawn as a
    ``"line"``, ``"markers"``, ``"both"``, ``"step"`` (a value held until the
    next x) or ``"bar"`` (bars from y = 0), with its color and line width.
    The axes follow the data unless ``x_min`` / ``x_max`` / ``y_min`` /
    ``y_max`` are set. The pairs travel as float64 binary buffers.

    Cursors (CHART-104) read the value of every data set at their x, by
    linear interpolation between its points sorted by x.

    Examples
    --------
    >>> import numpy as np
    >>> g = XYGraph(x_unit="m³/h", unit="m", label="Pump P-101")
    >>> q = np.linspace(0, 120, 13)
    >>> g.plot(q, 42 - 0.002 * q**2, name="Head")
    0
    >>> g.plot([30, 60, 90], [40.5, 35.0, 26.3], name="Measured", style="markers")
    1
    >>> round(g.values_at(60)[0], 1)
    34.8
    """

    _kind = t.Unicode("xygraph").tag(sync=True)
    _default_size = (480, 300)
    size = size_trait(*_default_size)

    #: ``{"sets", "points"}``: number of data sets and of points.
    value = t.Dict(read_only=True).tag(sync=True)
    #: ``[{"name", "color", "style", "width"}, ...]``, one per data set.
    series = t.List(t.Dict(), read_only=True).tag(sync=True)
    x_min = t.Float(None, allow_none=True).tag(sync=True)
    x_max = t.Float(None, allow_none=True).tag(sync=True)
    y_min = t.Float(None, allow_none=True).tag(sync=True)
    y_max = t.Float(None, allow_none=True).tag(sync=True)
    show_legend = t.Bool(True).tag(sync=True)

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._data: dict[str, tuple[np.ndarray, np.ndarray]] = {}
        self.on_msg(self._handle_front_msg)

    # -- data -------------------------------------------------------------------
    def plot(
        self,
        x: Any,
        y: Any,
        name: str = "",
        color: str = "",
        style: str = "line",
        width: float = 1.5,
        replace: bool = True,
    ) -> int:
        """Add a data set, or replace the one of the same ``name``; returns its index."""
        xs = np.asarray(x, dtype=np.float64).reshape(-1)
        ys = np.asarray(y, dtype=np.float64).reshape(-1)
        if xs.shape != ys.shape:
            raise ValueError(f"x and y must have the same length, got {xs.size} and {ys.size}")
        if style not in XY_STYLES:
            raise ValueError(f"style must be one of {XY_STYLES}, got {style!r}")
        name = name or f"set {len(self.series) + 1}"
        entry = {"name": name, "color": str(color), "style": style, "width": float(width)}
        series = [dict(s) for s in self.series]
        names = [s["name"] for s in series]
        if replace and name in names:
            index = names.index(name)
            series[index] = entry
        else:
            if name in names:
                raise ValueError(f"a data set is already named {name!r}")
            series.append(entry)
            index = len(series) - 1
        self._data[name] = (xs.copy(), ys.copy())
        self.set_trait("series", series)
        if self.cursors:
            self._update_cursor_values()
        self._send_data([name], clear=False)
        return index

    def remove(self, name: str) -> None:
        """Remove the data set ``name``."""
        if name not in self._data:
            raise KeyError(f"no data set {name!r} in this XYGraph")
        del self._data[name]
        self.set_trait("series", [s for s in self.series if s["name"] != name])
        self._send_data(list(self._data), clear=True)

    def clear(self) -> None:
        """Remove every data set."""
        self._data.clear()
        self.set_trait("series", [])
        self._send_data([], clear=True)

    def data(self, name: str) -> tuple[np.ndarray, np.ndarray]:
        """``(x, y)`` arrays of the data set ``name``."""
        xs, ys = self._data[name]
        return xs.copy(), ys.copy()

    # -- cursors (CHART-104) -----------------------------------------------------------
    def values_at(self, x: float) -> list[Any]:
        return [xy_value_at(*self._data[s["name"]], float(x)) for s in self.series]

    # -- front-end protocol -------------------------------------------------------------
    def _send_data(self, names: list[str], clear: bool) -> None:
        points = sum(int(xs.size) for xs, _ in self._data.values())
        self.set_trait("value", {"sets": len(self._data), "points": points})
        sets: list[list[Any]] = []
        buffers: list[bytes] = []
        for name in names:
            xs, ys = self._data[name]
            sets.append([name, int(xs.size)])
            buffers.append(np.ascontiguousarray(xs, dtype="<f8").tobytes())
            buffers.append(np.ascontiguousarray(ys, dtype="<f8").tobytes())
        self.send({"type": "data", "clear": clear, "sets": sets}, buffers=buffers)

    def _handle_front_msg(self, _widget: Any, content: Any, _buffers: Any) -> None:
        if isinstance(content, dict) and content.get("type") == "sync_request":
            self._send_data(list(self._data), clear=True)
