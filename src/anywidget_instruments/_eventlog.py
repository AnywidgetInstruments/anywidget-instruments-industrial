"""Event log: timestamped journal of operator actions and events (IND-090 .. IND-093)."""

from __future__ import annotations

import time as _time
from collections.abc import Iterable
from typing import Any

import traitlets as t

from ._base import InstrumentWidget

#: Event categories, shown as text chips in the log.
EVENT_CATEGORIES: tuple[str, ...] = ("operator", "state", "alarm", "system")


def _describe(v: Any) -> str:
    if isinstance(v, float):
        return f"{v:.6g}"
    return str(v)


class EventLog(InstrumentWidget):
    """Chronological journal of events, newest first (IND-090 .. IND-093).

    :meth:`log` appends an event with a timestamp, a ``source``, a
    ``category`` (``"operator"``, ``"state"``, ``"alarm"`` or ``"system"``)
    and a message; at most ``max_events`` are kept. The operator filters the
    log by category and text and downloads it as CSV.

    :meth:`connect` records every change of the named traits of another
    widget, an audit trail of operator actions (IND-093)::

        log = EventLog()
        log.connect(setpoint_knob, category="operator")
        log.log("Pump P-101 started", source="P-101", category="state")

    Events are dicts ``{"id", "time", "source", "category", "message"}``,
    ``time`` in Unix seconds.
    """

    _kind = t.Unicode("eventlog").tag(sync=True)
    _default_mode = "indicator"
    _default_size = (600, 200)
    #: Events in chronological order (the view shows the newest first).
    value = t.List(t.Dict(), read_only=True).tag(sync=True)
    max_events = t.Int(500, min=1).tag(sync=True)

    def __init__(self, **kwargs: Any) -> None:
        self._next_id = 1
        self._connections: list[tuple[Any, Any, list[str]]] = []
        super().__init__(**kwargs)

    @t.observe("max_events")
    def _trim(self, _change: Any) -> None:
        if len(self.value) > self.max_events:
            self.set_trait("value", self.value[-self.max_events :])

    def log(
        self,
        message: str,
        source: str = "",
        category: str = "system",
        time: float | None = None,
    ) -> dict[str, Any]:
        """Append an event (IND-091) and return it."""
        if category not in EVENT_CATEGORIES:
            raise ValueError(f"category must be one of {EVENT_CATEGORIES}, got {category!r}")
        event = {
            "id": self._next_id,
            "time": _time.time() if time is None else float(time),
            "source": str(source),
            "category": category,
            "message": str(message),
        }
        self._next_id += 1
        self.set_trait("value", [*self.value, event][-self.max_events :])
        return event

    @property
    def events(self) -> list[dict[str, Any]]:
        """The kept events, oldest first."""
        return list(self.value)

    def clear(self) -> None:
        """Forget every event."""
        self.set_trait("value", [])

    # -- audit trail (IND-093) ---------------------------------------------------------------
    def connect(
        self,
        widget: Any,
        names: str | Iterable[str] = "value",
        category: str = "operator",
        source: str | None = None,
    ) -> None:
        """Record each change of the traits ``names`` of ``widget``.

        ``source`` defaults to the widget label (or tag, or class name).
        """
        if category not in EVENT_CATEGORIES:
            raise ValueError(f"category must be one of {EVENT_CATEGORIES}, got {category!r}")
        names = [names] if isinstance(names, str) else list(names)
        name = source or getattr(widget, "label", "") or getattr(widget, "tag", "")
        name = name or type(widget).__name__

        def record(change: Any) -> None:
            self.log(
                f"{change['name']}: {_describe(change['old'])} → {_describe(change['new'])}",
                source=name,
                category=category,
            )

        widget.observe(record, names=names)
        self._connections.append((widget, record, names))

    def disconnect(self, widget: Any) -> None:
        """Stop recording the changes of ``widget``."""
        keep = []
        for w, handler, names in self._connections:
            if w is widget:
                w.unobserve(handler, names=names)
            else:
                keep.append((w, handler, names))
        self._connections = keep
