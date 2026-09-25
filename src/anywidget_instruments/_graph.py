"""Features shared by every graph widget: cursors, annotations, export
(CHART-104 .. CHART-107)."""

from __future__ import annotations

from typing import Any

import traitlets as t

from ._base import InstrumentWidget, float_serializers, mode_trait, size_trait


class GraphWidget(InstrumentWidget):
    """Base class of graphs and charts.

    Cursors (CHART-104)
        ``cursors`` is a list of ``{"x": float, "name": str, "color": str}`` in
        x-axis units. The user drags them on the plot; ``cursor_values`` holds,
        for each cursor, ``{"name", "x", "values"}`` with the (interpolated)
        values under it, recomputed by the kernel.
    Annotations (CHART-105)
        ``annotations`` is a list of ``{"x", "y", "text", "color"}`` in data
        coordinates.
    Zoom (CHART-106)
        Zoom tool in the toolbar (drag a rectangle), mouse wheel on the time
        axis, double-click to restore the full view.
    Export (CHART-107)
        With ``export=True`` the toolbar offers CSV, PNG and SVG downloads.
    """

    _default_mode = "indicator"
    _default_size = (480, 240)
    mode = mode_trait(_default_mode)
    size = size_trait(*_default_size)

    cursors = t.List(t.Dict()).tag(sync=True)
    cursor_values = t.List(t.Dict(), read_only=True).tag(sync=True, **float_serializers)
    annotations = t.List(t.Dict()).tag(sync=True)
    export = t.Bool(True).tag(sync=True)
    x_unit = t.Unicode("").tag(sync=True)
    unit = t.Unicode("").tag(sync=True)

    # -- cursors -----------------------------------------------------------------
    def add_cursor(self, x: float, name: str = "", color: str = "") -> int:
        """Add a cursor at ``x``; returns its index."""
        name = name or f"C{len(self.cursors) + 1}"
        self.cursors = [*self.cursors, {"x": float(x), "name": name, "color": color}]
        return len(self.cursors) - 1

    def move_cursor(self, index: int, x: float) -> None:
        cursors = [dict(c) for c in self.cursors]
        cursors[index]["x"] = float(x)
        self.cursors = cursors

    def remove_cursor(self, index: int) -> None:
        self.cursors = [c for i, c in enumerate(self.cursors) if i != index]

    @t.validate("cursors")
    def _check_cursors(self, proposal: Any) -> list[dict[str, Any]]:
        out = []
        for i, c in enumerate(proposal["value"]):
            try:
                x = float(c["x"])
            except (KeyError, TypeError, ValueError) as exc:
                raise t.TraitError(
                    f"The 'cursors' trait of a {type(self).__name__} instance: cursor {i} "
                    "needs a numeric 'x'"
                ) from exc
            out.append(
                {
                    "x": x,
                    "name": str(c.get("name") or f"C{i + 1}"),
                    "color": str(c.get("color") or ""),
                }
            )
        return out

    @t.observe("cursors")
    def _on_cursors(self, _change: Any) -> None:
        self._update_cursor_values()

    def _update_cursor_values(self) -> None:
        values = [
            {"name": c["name"], "x": c["x"], "values": self.values_at(c["x"])} for c in self.cursors
        ]
        self.set_trait("cursor_values", values)

    def values_at(self, x: float) -> list[Any]:  # pragma: no cover - overridden
        """Values of every trace/line at x-axis position ``x``."""
        return []

    # -- annotations ------------------------------------------------------------
    def annotate(self, x: float, y: float, text: str, color: str = "") -> int:
        """Add a text annotation anchored at data coordinates ``(x, y)``."""
        self.annotations = [
            *self.annotations,
            {"x": float(x), "y": float(y), "text": str(text), "color": color},
        ]
        return len(self.annotations) - 1

    def clear_annotations(self) -> None:
        self.annotations = []
