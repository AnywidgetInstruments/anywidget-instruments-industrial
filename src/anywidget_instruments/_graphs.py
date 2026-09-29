"""IntensityChart, DigitalWaveformGraph and MixedSignalGraph (CHART-101 .. CHART-103)."""

from __future__ import annotations

from typing import Any

import numpy as np
import traitlets as t

from ._base import float_serializers, size_trait
from ._graph import GraphWidget

COLORMAPS: tuple[str, ...] = ("viridis", "inferno", "magma", "plasma", "gray", "jet")


class IntensityChart(GraphWidget):
    """Scrolling 2-D color map: spectrogram / waterfall (CHART-101).

    Each call to :meth:`append` adds one or more *rows* (e.g. spectra of
    ``n_bins`` values). Time runs along x (``dt`` per row), bins along y,
    mapped to [``y_min``, ``y_max``]. Colors map [``z_min``, ``z_max``] (or the
    data range with ``autoscale_z``) through ``colormap``.

    ``value`` summarizes the latest row: ``{"rows", "min", "max", "argmax"}``.
    """

    _kind = t.Unicode("intensitychart").tag(sync=True)
    value = t.Dict(read_only=True).tag(sync=True, **float_serializers)
    history = t.Int(200, min=2).tag(sync=True)
    n_bins = t.Int(64, min=1).tag(sync=True)
    dt = t.Float(1.0).tag(sync=True)
    y_min = t.Float(0.0).tag(sync=True)
    y_max = t.Float(None, allow_none=True).tag(sync=True)
    z_min = t.Float(0.0).tag(sync=True)
    z_max = t.Float(1.0).tag(sync=True)
    autoscale_z = t.Bool(True).tag(sync=True)
    colormap = t.Enum(list(COLORMAPS), default_value="viridis").tag(sync=True)
    show_colorbar = t.Bool(True).tag(sync=True)

    def __init__(self, **kwargs: Any) -> None:
        # an empty buffer before super().__init__: the cursor observer reads it when
        # the constructor sets cursors
        self._buf = np.full((0, 0), np.nan)
        self._total = 0
        super().__init__(**kwargs)
        self._reset()
        self.on_msg(self._handle_front_msg)

    def _reset(self) -> None:
        self._buf = np.full((self.history, self.n_bins), np.nan)
        self._total = 0

    @t.observe("history", "n_bins")
    def _on_shape(self, _change: Any) -> None:
        self._reset()
        self._send_snapshot()

    @property
    def data(self) -> np.ndarray:
        """Buffered rows in chronological order, shape ``(n_rows, n_bins)``."""
        n = min(self._total, self.history)
        idx = (self._total - n + np.arange(n)) % self.history
        return self._buf[idx].copy()

    @property
    def total_rows(self) -> int:
        return self._total

    def append(self, rows: Any) -> None:
        """Append one row (1-D, ``n_bins`` values) or several (2-D ``(n, n_bins)``)."""
        arr = np.asarray(rows, dtype=np.float64)
        if arr.ndim == 1:
            arr = arr.reshape(1, -1)
        if arr.ndim != 2 or arr.shape[1] != self.n_bins:
            raise ValueError(f"expected rows of {self.n_bins} bins, got shape {arr.shape}")
        n = arr.shape[0]
        if n == 0:
            return
        kept = arr[-self.history :]
        idx = (self._total + (n - kept.shape[0]) + np.arange(kept.shape[0])) % self.history
        self._buf[idx] = kept
        self._total += n
        last = arr[-1]
        finite = np.isfinite(last)
        self.set_trait(
            "value",
            {
                "rows": self._total,
                "min": float(np.min(last[finite])) if finite.any() else float("nan"),
                "max": float(np.max(last[finite])) if finite.any() else float("nan"),
                "argmax": int(np.nanargmax(last)) if finite.any() else -1,
            },
        )
        if self.cursors:
            self._update_cursor_values()
        self.send(
            {"type": "append", "n_rows": int(kept.shape[0]), "total": self._total},
            buffers=[np.ascontiguousarray(kept, dtype="<f4").tobytes()],
        )

    def clear(self) -> None:
        self._reset()
        self.send({"type": "clear"})

    def values_at(self, x: float) -> list[Any]:
        """Row (all bins) displayed at time ``x``."""
        i = round(x / self.dt) if self.dt else 0
        if i < self._total - min(self._total, self.history) or i >= self._total or i < 0:
            return []
        return [float(v) for v in self._buf[i % self.history]]

    def _send_snapshot(self) -> None:
        data = self.data
        self.send(
            {"type": "snapshot", "n_rows": int(data.shape[0]), "total": self._total},
            buffers=[np.ascontiguousarray(data, dtype="<f4").tobytes()],
        )

    def _handle_front_msg(self, _widget: Any, content: Any, _buffers: Any) -> None:
        if isinstance(content, dict) and content.get("type") == "sync_request":
            self._send_snapshot()


def unpack_bits(values: Any, n_bits: int) -> np.ndarray:
    """Integers → ``(n, n_bits)`` array of 0/1, column k = bit k (LSB first)."""
    ints = np.asarray(values, dtype=np.int64).reshape(-1)
    return ((ints[:, None] >> np.arange(n_bits)) & 1).astype(np.uint8)


class DigitalWaveformGraph(GraphWidget):
    """Logic timing diagram with bus grouping (CHART-102).

    ``set_data`` takes an ``(n_samples, n_lines)`` array of 0/1 values, or
    integers plus ``n_bits`` (line k = bit k). ``lines`` names the lines and
    ``buses`` groups them: ``{"name": "D", "lines": [7, 6, ..., 0]}`` (MSB
    first); bus values are displayed in hexadecimal.
    """

    _kind = t.Unicode("digitalgraph").tag(sync=True)
    value = t.Dict(read_only=True).tag(sync=True)
    lines = t.List(t.Unicode()).tag(sync=True)
    buses = t.List(t.Dict()).tag(sync=True)
    dt = t.Float(1.0).tag(sync=True)
    x0 = t.Float(0.0).tag(sync=True)
    show_lines_in_bus = t.Bool(True).tag(sync=True)

    def __init__(self, **kwargs: Any) -> None:
        # before super().__init__: the cursor observer reads the data when the
        # constructor sets cursors
        self._bits: np.ndarray = np.zeros((0, 0), dtype=np.uint8)
        self._analog: np.ndarray = np.zeros((0, 0), dtype=np.float64)
        super().__init__(**kwargs)
        self.on_msg(self._handle_front_msg)

    @property
    def bits(self) -> np.ndarray:
        return self._bits.copy()

    @property
    def n_samples(self) -> int:
        return max(self._bits.shape[0], self._analog.shape[0])

    def set_data(self, data: Any, n_bits: int | None = None) -> None:
        """Replace the logic data (whole graph, not a chart)."""
        if n_bits is not None:
            bits = unpack_bits(data, n_bits)
        else:
            bits = np.asarray(data)
            if bits.ndim == 1:
                bits = bits.reshape(-1, 1)
            if bits.ndim != 2:
                raise ValueError("expected an (n_samples, n_lines) array or integers + n_bits")
            bits = (bits != 0).astype(np.uint8)
        self._bits = np.ascontiguousarray(bits)
        if len(self.lines) != bits.shape[1]:
            self.lines = [f"D{k}" for k in range(bits.shape[1])]
        self._check_buses(self.buses)
        self._publish()

    @t.validate("buses")
    def _validate_buses(self, proposal: Any) -> list[dict[str, Any]]:
        self._check_buses(proposal["value"])
        return proposal["value"]

    def _check_buses(self, buses: list[dict[str, Any]]) -> None:
        bits = getattr(self, "_bits", None)  # buses may be given before any data
        n = bits.shape[1] if bits is not None and bits.shape[0] else None
        for b in buses:
            idx = b.get("lines")
            if not isinstance(idx, list) or not idx:
                raise t.TraitError(f"bus {b.get('name')!r} needs a non-empty 'lines' list")
            if n is not None and any(not 0 <= int(i) < n for i in idx):
                raise t.TraitError(f"bus {b.get('name')!r} references a missing line")

    def bus_values(self, bus: dict[str, Any]) -> np.ndarray:
        """Integer value of ``bus`` at every sample (first listed line = MSB)."""
        idx = [int(i) for i in bus["lines"]]
        weights = 1 << np.arange(len(idx) - 1, -1, -1)
        return (self._bits[:, idx].astype(np.int64) * weights).sum(axis=1)

    def values_at(self, x: float) -> list[Any]:
        i = int(np.floor((x - self.x0) / self.dt)) if self.dt else 0
        out: list[Any] = []
        if 0 <= i < self._bits.shape[0]:
            out += [int(v) for v in self._bits[i]]
            out += [f"0x{int(self.bus_values(b)[i]):X}" for b in self.buses]
        if 0 <= i < self._analog.shape[0]:
            out += [float(v) for v in self._analog[i]]
        return out

    def _publish(self) -> None:
        self.set_trait("value", {"n_samples": self.n_samples, "n_lines": int(self._bits.shape[1])})
        if self.cursors:
            self._update_cursor_values()
        self._send_data()

    def _send_data(self) -> None:
        self.send(
            {
                "type": "data",
                "n_samples": int(self._bits.shape[0]),
                "n_lines": int(self._bits.shape[1]),
                "n_analog": int(self._analog.shape[0]),
                "n_traces": int(self._analog.shape[1]),
            },
            buffers=[
                self._bits.tobytes(),
                np.ascontiguousarray(self._analog, dtype="<f4").tobytes(),
            ],
        )

    def _handle_front_msg(self, _widget: Any, content: Any, _buffers: Any) -> None:
        if isinstance(content, dict) and content.get("type") == "sync_request":
            self._send_data()


class MixedSignalGraph(DigitalWaveformGraph):
    """Analog traces and digital lines on a shared time axis (CHART-103).

    Use :meth:`set_analog` with an ``(n_samples, n_traces)`` array and
    :meth:`set_data` for the logic lines.
    """

    _kind = t.Unicode("mixedgraph").tag(sync=True)
    _default_size = (520, 320)
    size = size_trait(*_default_size)
    traces = t.List(t.Dict()).tag(sync=True)
    y_min = t.Float(None, allow_none=True).tag(sync=True)
    y_max = t.Float(None, allow_none=True).tag(sync=True)
    analog_fraction = t.Float(0.55, min=0.1, max=0.9).tag(sync=True)

    def set_analog(self, data: Any) -> None:
        arr = np.asarray(data, dtype=np.float64)
        if arr.ndim == 1:
            arr = arr.reshape(-1, 1)
        if arr.ndim != 2:
            raise ValueError("expected an (n_samples, n_traces) array")
        self._analog = arr
        self._publish()
