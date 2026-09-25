"""Real-time waveform chart (CHART-001 .. CHART-009)."""

from __future__ import annotations

from typing import Any

import numpy as np
import traitlets as t

from ._base import float_serializers
from ._graph import GraphWidget


class WaveformChart(GraphWidget):
    """Scrolling multi-trace chart fed from the kernel with :meth:`append`.

    Samples are kept in a circular buffer of ``history`` points per trace and
    sent to the front end as binary ``float32`` buffers (never JSON lists).

    ``update_mode``:
      * ``"strip"``: continuous scroll, newest data on the right;
      * ``"scope"``: fill from left to right, then clear and restart;
      * ``"sweep"``: a moving cursor overwrites the oldest data.

    ``traces`` optionally describes each trace:
    ``{"name": str, "color": css_color, "width": float, "visible": bool,
    "axis": "left" | "right"}``.

    Axes (IND-117): ``y_scale="log"`` makes the Y axis logarithmic (values
    <= 0 are not drawn); traces with ``"axis": "right"`` are drawn against a
    secondary axis on the right, ranged by ``y2_min`` / ``y2_max`` or by
    their data with ``autoscale_y2``, in ``y2_unit``.
    """

    _kind = t.Unicode("waveformchart").tag(sync=True)
    _default_mode = "indicator"
    _default_size = (480, 240)

    #: Latest sample of each trace.
    value = t.List(t.Float(), read_only=True).tag(sync=True, **float_serializers)
    history = t.Int(1024, min=2).tag(sync=True)
    n_traces = t.Int(1, min=1).tag(sync=True)
    update_mode = t.Enum(["strip", "scope", "sweep"], default_value="strip").tag(sync=True)
    y_min = t.Float(-1.0).tag(sync=True)
    y_max = t.Float(1.0).tag(sync=True)
    autoscale_y = t.Bool(False).tag(sync=True)
    y_scale = t.Enum(["linear", "log"], default_value="linear").tag(sync=True)
    y2_min = t.Float(0.0).tag(sync=True)
    y2_max = t.Float(1.0).tag(sync=True)
    autoscale_y2 = t.Bool(False).tag(sync=True)
    y2_unit = t.Unicode("").tag(sync=True)
    paused = t.Bool(False).tag(sync=True)
    dt = t.Float(1.0).tag(sync=True)
    traces = t.List(t.Dict()).tag(sync=True)
    show_legend = t.Bool(True).tag(sync=True)

    def __init__(self, **kwargs: Any) -> None:
        kwargs["mode"] = "indicator"
        super().__init__(**kwargs)
        self._reset_buffer()
        self.on_msg(self._handle_front_msg)

    # -- buffer --------------------------------------------------------------
    def _reset_buffer(self) -> None:
        self._buf = np.full((self.history, self.n_traces), np.nan, dtype=np.float64)
        self._total = 0

    @t.observe("history", "n_traces")
    def _on_shape_change(self, _change: Any) -> None:
        self._reset_buffer()
        self.set_trait("value", [])
        self._send_snapshot()

    @property
    def total_samples(self) -> int:
        """Number of samples appended since creation or the last :meth:`clear`."""
        return self._total

    @property
    def data(self) -> np.ndarray:
        """Buffered samples in chronological order, shape ``(n_points, n_traces)``."""
        n = min(self._total, self.history)
        idx = (self._total - n + np.arange(n)) % self.history
        return self._buf[idx].copy()

    def _as_rows(self, samples: Any) -> np.ndarray:
        arr = np.asarray(samples, dtype=np.float64)
        k = self.n_traces
        if arr.ndim == 0:
            if k != 1:
                raise ValueError(f"a scalar sample needs n_traces == 1 (n_traces={k})")
            return arr.reshape(1, 1)
        if arr.ndim == 1:
            if k == 1:
                return arr.reshape(-1, 1)
            if arr.shape[0] != k:
                raise ValueError(
                    f"a 1-D array appended to a {k}-trace chart must hold one sample "
                    f"per trace (length {k}), got length {arr.shape[0]}"
                )
            return arr.reshape(1, k)
        if arr.ndim == 2 and arr.shape[1] == k:
            return arr
        raise ValueError(f"expected an array of shape (n_points, {k}), got shape {arr.shape}")

    def append(self, samples: Any) -> None:
        """Append samples: a scalar, a 1-D array or a 2-D ``(n_points, n_traces)`` array.

        For a single-trace chart a 1-D array holds consecutive points; for a
        multi-trace chart it holds one sample per trace.
        """
        rows = self._as_rows(samples)
        n = rows.shape[0]
        if n == 0:
            return
        kept = rows[-self.history :]
        idx = (self._total + (n - kept.shape[0]) + np.arange(kept.shape[0])) % self.history
        self._buf[idx] = kept
        self._total += n
        self.set_trait("value", [float(v) for v in rows[-1]])
        if self.cursors:
            self._update_cursor_values()
        payload = np.ascontiguousarray(kept, dtype="<f4")
        self.send(
            {"type": "append", "n_points": int(kept.shape[0]), "total": self._total},
            buffers=[payload.tobytes()],
        )

    def clear(self) -> None:
        """Empty the history buffer."""
        self._reset_buffer()
        self.set_trait("value", [])
        self.send({"type": "clear"})

    # -- cursors (CHART-104) ----------------------------------------------------------
    def _index_at(self, x: float) -> float:
        """Absolute sample index shown at x-axis position ``x``."""
        i = x / self.dt if self.dt else 0.0
        if self.update_mode == "sweep" and self._total:
            last = self._total - 1
            slot = i % self.history
            return last - ((last - slot) % self.history)
        return i

    def values_at(self, x: float) -> list[Any]:
        i = self._index_at(x)
        i0 = int(np.floor(i))
        frac = i - i0
        oldest = self._total - min(self._total, self.history)

        def sample(k: int) -> np.ndarray | None:
            if k < oldest or k >= self._total:
                return None
            return self._buf[k % self.history]

        a, b = sample(i0), sample(i0 + 1)
        if a is None:
            return [float("nan")] * self.n_traces
        if b is None or frac == 0:
            return [float(v) for v in a]
        return [float(v) for v in a * (1 - frac) + b * frac]

    # -- front-end protocol ------------------------------------------------------
    def _send_snapshot(self) -> None:
        data = np.ascontiguousarray(self.data, dtype="<f4")
        self.send(
            {"type": "snapshot", "n_points": int(data.shape[0]), "total": self._total},
            buffers=[data.tobytes()],
        )

    def _handle_front_msg(self, _widget: Any, content: Any, _buffers: Any) -> None:
        if isinstance(content, dict) and content.get("type") == "sync_request":
            self._send_snapshot()
