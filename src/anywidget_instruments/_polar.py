"""PolarPlot, SmithChart and RadarChart (SPEC-002 .. SPEC-004)."""

from __future__ import annotations

from typing import Any

import numpy as np
import traitlets as t

from ._base import InstrumentWidget, float_serializers


def _finite_list(values: Any) -> list[float]:
    return [float(v) for v in np.asarray(values, dtype=float).reshape(-1)]


class _SeriesWidget(InstrumentWidget):
    _default_mode = "indicator"
    _default_size = (260, 260)
    #: list of data sets; the exact fields depend on the widget
    value = t.List(t.Dict()).tag(sync=True, **float_serializers)
    show_legend = t.Bool(True).tag(sync=True)

    def clear(self) -> None:
        self.value = []

    def _add(self, series: dict[str, Any], replace: bool) -> int:
        name = series["name"]
        current = [s for s in self.value if not (replace and s.get("name") == name)]
        self.value = [*current, series]
        return len(self.value) - 1


class PolarPlot(_SeriesWidget):
    """Magnitude/angle data sets on polar axes (SPEC-002).

    ``angle_unit`` is ``"deg"`` or ``"rad"``; ``zero`` sets where angle 0 is
    (``"E"`` mathematical convention or ``"N"`` compass convention) and
    ``direction`` the positive sense. ``r_max=None`` scales to the data.
    """

    _kind = t.Unicode("polar").tag(sync=True)
    angle_unit = t.Enum(["deg", "rad"], default_value="deg").tag(sync=True)
    zero = t.Enum(["E", "N"], default_value="E").tag(sync=True)
    direction = t.Enum(["ccw", "cw"], default_value="ccw").tag(sync=True)
    r_max = t.Float(None, allow_none=True).tag(sync=True)
    rings = t.Int(4, min=1).tag(sync=True)
    unit = t.Unicode("").tag(sync=True)

    def plot(
        self,
        magnitude: Any,
        angle: Any,
        name: str = "",
        color: str = "",
        style: str = "line",
        replace: bool = True,
    ) -> int:
        """Add (or replace, by name) a data set; ``style`` is line, markers or both."""
        r = _finite_list(magnitude)
        a = _finite_list(angle)
        if len(r) != len(a):
            raise ValueError("magnitude and angle must have the same length")
        if style not in ("line", "markers", "both"):
            raise ValueError("style must be 'line', 'markers' or 'both'")
        name = name or f"set {len(self.value) + 1}"
        return self._add(
            {"name": name, "color": color, "style": style, "r": r, "theta": a}, replace
        )


class SmithChart(_SeriesWidget):
    """Smith chart of impedances or reflection coefficients (SPEC-003).

    Impedances are normalized to ``z0`` (ohms) and stored as reflection
    coefficients Γ = (z - z0) / (z + z0) in ``value`` (``re``/``im`` lists).
    """

    _kind = t.Unicode("smith").tag(sync=True)
    z0 = t.Float(50.0, min=0.0).tag(sync=True)
    show_admittance = t.Bool(False).tag(sync=True)

    @t.validate("z0")
    def _positive_z0(self, proposal: Any) -> float:
        if proposal["value"] <= 0:
            raise t.TraitError("SmithChart: z0 must be > 0")
        return float(proposal["value"])

    def gamma(self, z: Any) -> np.ndarray:
        """Reflection coefficient(s) of impedance(s) ``z`` for this ``z0``."""
        zc = np.asarray(z, dtype=complex)
        return (zc - self.z0) / (zc + self.z0)

    def impedance(self, gamma: Any) -> np.ndarray:
        g = np.asarray(gamma, dtype=complex)
        return self.z0 * (1 + g) / (1 - g)

    def plot(
        self,
        data: Any,
        kind: str = "impedance",
        name: str = "",
        color: str = "",
        style: str = "both",
        replace: bool = True,
    ) -> int:
        """Plot complex ``data`` given as ``kind="impedance"`` (Ω) or ``"reflection"`` (Γ)."""
        if kind == "impedance":
            g = self.gamma(data)
        elif kind == "reflection":
            g = np.asarray(data, dtype=complex)
        else:
            raise ValueError("kind must be 'impedance' or 'reflection'")
        g = g.reshape(-1)
        name = name or f"set {len(self.value) + 1}"
        return self._add(
            {
                "name": name,
                "color": color,
                "style": style,
                "re": _finite_list(g.real),
                "im": _finite_list(g.imag),
            },
            replace,
        )


class RadarChart(_SeriesWidget):
    """Multi-axis (spider) chart (SPEC-004).

    ``axes`` names the axes; ``ranges`` optionally gives ``[min, max]`` per
    axis (default ``[0, max of data]``).
    """

    _kind = t.Unicode("radar").tag(sync=True)
    axes = t.List(t.Unicode()).tag(sync=True)
    ranges = t.List(t.List(t.Float(), minlen=2, maxlen=2)).tag(sync=True)
    fill = t.Bool(True).tag(sync=True)

    @t.validate("ranges")
    def _check_ranges(self, proposal: Any) -> list[list[float]]:
        for lo, hi in proposal["value"]:
            if not hi > lo:
                raise t.TraitError("RadarChart: each range needs max > min")
        return proposal["value"]

    def plot(self, values: Any, name: str = "", color: str = "", replace: bool = True) -> int:
        v = _finite_list(values)
        if self.axes and len(v) != len(self.axes):
            raise ValueError(f"expected {len(self.axes)} values (one per axis), got {len(v)}")
        name = name or f"set {len(self.value) + 1}"
        return self._add({"name": name, "color": color, "values": v}, replace)
