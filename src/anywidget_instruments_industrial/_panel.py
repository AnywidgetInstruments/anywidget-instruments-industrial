"""Panel layout helper and state serialization (API-012, API-013)."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

import ipywidgets
from anywidget_instruments import batch

from ._base import InstrumentWidget


class Panel(ipywidgets.GridBox):
    """Arrange widgets in a grid; any ipywidgets widget can be mixed in.

    >>> Panel([Knob(label="Gain"), LED(label="Run")], columns=2)
    """

    def __init__(
        self,
        children: Iterable[ipywidgets.Widget] = (),
        columns: int = 3,
        gap: str = "12px",
        **kwargs: Any,
    ) -> None:
        layout = kwargs.pop("layout", None) or ipywidgets.Layout(
            grid_template_columns=f"repeat({columns}, max-content)",
            grid_gap=gap,
            align_items="flex-start",
        )
        super().__init__(children=tuple(children), layout=layout, **kwargs)

    def instruments(self) -> dict[str, InstrumentWidget]:
        """Instrument widgets of the panel keyed by label (or ``"widget<i>"``)."""
        out: dict[str, InstrumentWidget] = {}
        for i, w in enumerate(self.children):
            if isinstance(w, InstrumentWidget):
                key = w.label or f"widget{i}"
                if key in out:
                    key = f"{key}#{i}"
                out[key] = w
        return out

    def to_dict(self) -> dict[str, Any]:
        """Snapshot of the writable instrument values."""
        return {
            k: w.value for k, w in self.instruments().items() if not w.traits()["value"].read_only
        }

    def from_dict(self, state: dict[str, Any]) -> None:
        """Restore values produced by :meth:`to_dict`; unknown keys are ignored."""
        widgets = self.instruments()
        with batch():
            for key, value in state.items():
                if key in widgets:
                    widgets[key].value = value
