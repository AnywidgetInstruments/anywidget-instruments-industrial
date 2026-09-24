"""Annunciator panel with ISA-18.1 sequences (IND-040 .. IND-043)."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

import traitlets as t

from ._base import Callback, InstrumentWidget, _report_callback_error, size_trait

ANN_SEQUENCES: tuple[str, ...] = ("A", "M", "R")
ANN_STATES: tuple[str, ...] = ("normal", "alert", "acknowledged", "ringback")
ANN_COLORS: tuple[str, ...] = ("red", "amber", "white")


def annunciator_transition(state: str, active: bool, event: str, sequence: str = "A") -> str:
    """ISA-18.1 window state after ``event`` (IND-041).

    ``event`` is ``"process"`` (the process condition is now ``active``),
    ``"acknowledge"`` or ``"reset"``.

    * ``A`` (automatic reset): alert (fast flash) → acknowledged (steady) →
      normal as soon as the condition clears.
    * ``M`` (manual reset): an acknowledged window stays lit after the
      condition clears, until the operator resets it.
    * ``R`` (ringback): when an acknowledged condition clears, the window
      flashes slowly (ringback) until the operator resets it.

    An alert is locked in: a condition that clears before acknowledgement
    keeps the window flashing until it is acknowledged.
    """
    if sequence not in ANN_SEQUENCES:
        raise ValueError(f"sequence must be one of {ANN_SEQUENCES}, got {sequence!r}")
    if event == "process":
        if active and state in ("normal", "ringback"):
            return "alert"
        if not active and state == "acknowledged":
            return {"A": "normal", "M": "acknowledged", "R": "ringback"}[sequence]
        return state
    if event == "acknowledge":
        if state != "alert":
            return state
        if active:
            return "acknowledged"
        return {"A": "normal", "M": "acknowledged", "R": "ringback"}[sequence]
    if event == "reset":
        if active:
            return state
        if (sequence == "M" and state == "acknowledged") or (
            sequence == "R" and state == "ringback"
        ):
            return "normal"
        return state
    raise ValueError(f"unknown annunciator event {event!r}")


class Annunciator(InstrumentWidget):
    """Grid of alarm windows following an ISA-18.1 sequence (IND-040 .. IND-043).

    ``windows`` lists ``(tag, text)`` pairs or dicts ``{"tag", "text",
    "color"}``; ``value`` holds the state of every window. Drive the process
    side with :meth:`set`; the operator's Silence, Acknowledge, Reset and Test
    buttons call :meth:`silence`, :meth:`acknowledge`, :meth:`reset` and set
    ``test`` (lamp test), and :meth:`on_action` callbacks receive each action.

    With ``first_out=True`` the first window to alarm is marked until reset
    (IND-042). ``horn`` is ``True`` while an alert or ringback is not silenced;
    the library never plays sound.

    Warnings
    --------
    Presents alarms; it is not an alarm management system nor a safety
    function. Critical alarms need independent annunciation.
    See the safety notice of the documentation (DOC-007).
    """

    _kind = t.Unicode("annunciator").tag(sync=True)
    _default_size = (420, 170)
    size = size_trait(*_default_size)
    value = t.List(t.Dict(), read_only=True).tag(sync=True)
    columns = t.Int(4, min=1, max=12).tag(sync=True)
    sequence = t.Enum(list(ANN_SEQUENCES), default_value="A").tag(sync=True)
    first_out = t.Bool(False).tag(sync=True)
    horn = t.Bool(False, read_only=True).tag(sync=True)
    test = t.Bool(False).tag(sync=True)

    def __init__(self, windows: Iterable[Any] = (), **kwargs: Any) -> None:
        self._windows: dict[str, dict[str, Any]] = {}
        self._silenced = False
        self._action_callbacks: list[Callback] = []
        super().__init__(**kwargs)
        for w in windows:
            if isinstance(w, dict):
                self.add_window(**w)
            else:
                self.add_window(*w)
        self.on_msg(self._handle_front_msg)

    # -- configuration -------------------------------------------------------------------
    def add_window(self, tag: str, text: str = "", color: str = "amber") -> None:
        """Add an alarm window (IND-040)."""
        if color not in ANN_COLORS:
            raise ValueError(f"color must be one of {ANN_COLORS}, got {color!r}")
        if tag in self._windows:
            raise ValueError(f"duplicate annunciator tag {tag!r}")
        self._windows[tag] = {
            "tag": tag,
            "text": text,
            "color": color,
            "active": False,
            "state": "normal",
            "first": False,
        }
        self._publish()

    @t.observe("sequence")
    def _on_sequence(self, _change: Any) -> None:
        # a new sequence starts from a clean panel
        for w in self._windows.values():
            w["state"] = "alert" if w["active"] else "normal"
            w["first"] = False
        self._publish()

    def _window(self, tag: str) -> dict[str, Any]:
        try:
            return self._windows[tag]
        except KeyError:
            raise KeyError(f"no annunciator window {tag!r}") from None

    def state_of(self, tag: str) -> str:
        return str(self._window(tag)["state"])

    @property
    def first_out_tag(self) -> str | None:
        return next((tag for tag, w in self._windows.items() if w["first"]), None)

    # -- process side ------------------------------------------------------------------------
    def set(self, tag: str, active: bool = True) -> None:
        """Set the process condition of window ``tag``."""
        w = self._window(tag)
        w["active"] = bool(active)
        old = w["state"]
        w["state"] = annunciator_transition(old, w["active"], "process", self.sequence)
        if w["state"] in ("alert", "ringback") and old != w["state"]:
            self._silenced = False  # a new alert sounds again
        if (
            self.first_out
            and old == "normal"
            and w["state"] == "alert"
            and self.first_out_tag is None
        ):
            w["first"] = True  # IND-042
        if w["state"] == "normal":
            w["first"] = False
        self._publish()

    def clear(self, tag: str) -> None:
        self.set(tag, False)

    # -- operator actions (IND-043) ------------------------------------------------------------
    def acknowledge(self) -> None:
        """Acknowledge every flashing alert."""
        self._apply("acknowledge")
        self._notify("acknowledge")

    def reset(self) -> None:
        """Reset windows whose condition has cleared (sequences M and R) and the first-out mark."""
        self._apply("reset")
        for w in self._windows.values():
            w["first"] = False
        self._publish()
        self._notify("reset")

    def silence(self) -> None:
        """Silence the horn without acknowledging."""
        self._silenced = True
        self._publish()
        self._notify("silence")

    def _apply(self, event: str) -> None:
        for w in self._windows.values():
            w["state"] = annunciator_transition(w["state"], w["active"], event, self.sequence)
            if w["state"] == "normal":
                w["first"] = False
        self._publish()

    def on_action(self, callback: Callback) -> Callback:
        """Register ``callback(event)``; ``event["name"]`` is the operator action."""
        self._action_callbacks.append(callback)
        return callback

    def _notify(self, name: str, **extra: Any) -> None:
        event = {"name": name, "owner": self, **extra}
        for cb in list(self._action_callbacks):
            try:
                cb(event)
            except Exception:
                _report_callback_error(self, cb)

    def _publish(self) -> None:
        windows = [dict(w) for w in self._windows.values()]
        self.set_trait("value", windows)
        sounding = any(w["state"] in ("alert", "ringback") for w in windows)
        self.set_trait("horn", sounding and not self._silenced)

    @t.observe("test")
    def _on_test(self, change: Any) -> None:
        self._notify("test", on=change["new"])

    def _handle_front_msg(self, _widget: Any, content: Any, _buffers: Any) -> None:
        if not isinstance(content, dict) or self.mode != "control" or self.disabled:
            return
        action = content.get("type")
        if action == "acknowledge":
            self.acknowledge()
        elif action == "reset":
            self.reset()
        elif action == "silence":
            self.silence()
        elif action == "test":
            self.test = bool(content.get("on"))
