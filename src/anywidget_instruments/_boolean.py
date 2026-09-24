"""Boolean controls and indicators with mechanical actions (BOOL-*)."""

from __future__ import annotations

import threading
from typing import Any

import traitlets as t

from . import _dispatch
from ._base import Callback, InstrumentWidget, _report_callback_error

MECHANICAL_ACTIONS: tuple[str, ...] = (
    "switch_when_pressed",
    "switch_when_released",
    "switch_until_released",
    "latch_when_pressed",
    "latch_when_released",
    "latch_until_released",
)


class BooleanWidget(InstrumentWidget):
    """Base class of Boolean widgets.

    ``mechanical_action`` defines how a control reacts to the pointer:

    * ``switch_*``: the value toggles and is kept (``switch_until_released``
      holds the non-default value only while pressed);
    * ``latch_*``: the value changes and is kept until the kernel reads it with
      :meth:`read_latched`, then returns to ``default_state``. With
      ``latch_timeout`` > 0 an unread latch expires and fires ``latch_expired``.
    """

    value = t.Bool(False).tag(sync=True)
    default_state = t.Bool(False).tag(sync=True)
    mechanical_action = t.Enum(list(MECHANICAL_ACTIONS), default_value="switch_when_pressed").tag(
        sync=True
    )
    latch_timeout = t.Float(0.0, min=0.0).tag(sync=True)
    confirm = t.Bool(False).tag(sync=True)
    #: True while the pointer (or Space/Enter key) is held down on the control.
    _pressed = t.Bool(False).tag(sync=True)
    #: Sequence number of the front end's last press / release update.
    _seq = t.Int(0).tag(sync=True)

    def __init__(self, value: bool | None = None, **kwargs: Any) -> None:
        if value is not None:
            kwargs["value"] = value
        super().__init__(**kwargs)
        self._latch_timer: threading.Timer | None = None
        self._read_pending = False
        self._seen_seq = 0
        self._expired_callbacks: list[Callback] = []

    def set_state(self, sync_data: Any) -> None:
        # Each press / release carries a sequence number: an update applied a
        # second time (marimo re-applies it through its UI element) is ignored,
        # so a latched press is counted once (BOOL-010).
        seq = sync_data.get("_seq") if isinstance(sync_data, dict) else None
        if isinstance(seq, int):
            if seq <= self._seen_seq:
                return
            self._seen_seq = seq
        super().set_state(sync_data)

    @property
    def is_latch(self) -> bool:
        return self.mechanical_action.startswith("latch")

    def read_latched(self) -> bool:
        """Return the current value; if it is a latched value, consume it (BOOL-010)."""
        value = self.value
        if self.is_latch and value != self.default_state:
            if self.mechanical_action == "latch_until_released" and self._pressed:
                self._read_pending = True  # restore on release
            else:
                self._restore_default()
        return value

    def _restore_default(self) -> None:
        self._cancel_timer()
        self._read_pending = False
        self.value = self.default_state

    # -- latch timeout (BOOL-011) ---------------------------------------------
    @t.observe("value")
    def _on_value(self, change: Any) -> None:
        if self.is_latch and change["new"] != self.default_state and self.latch_timeout > 0:
            self._cancel_timer()
            self._latch_timer = threading.Timer(self.latch_timeout, self._expire)
            self._latch_timer.daemon = True
            self._latch_timer.start()
        elif change["new"] == self.default_state:
            self._cancel_timer()

    @t.observe("_pressed")
    def _on_pressed(self, change: Any) -> None:
        if not change["new"] and self._read_pending:
            self._restore_default()

    def _cancel_timer(self) -> None:
        timer = getattr(self, "_latch_timer", None)
        if timer is not None:
            timer.cancel()
            self._latch_timer = None

    def _expire(self) -> None:
        self._latch_timer = None
        if self.value == self.default_state:
            return
        self.value = self.default_state
        self.send({"type": "latch_expired"})
        for cb in list(self._expired_callbacks):
            try:
                cb({"name": "latch_expired", "owner": self})
            except Exception:
                _report_callback_error(self, cb)

    def on_latch_expired(self, callback: Callback) -> Callback:
        """Register ``callback(event)`` called when an unread latch expires."""
        self._expired_callbacks.append(callback)
        return callback


class LED(BooleanWidget):
    """Round or square LED indicator (BOOL-001, BOOL-002)."""

    _kind = t.Unicode("led").tag(sync=True)
    _default_mode = "indicator"
    _default_size = (48, 48)
    shape = t.Enum(["round", "square"], default_value="round").tag(sync=True)
    on_color = t.Unicode("#22c55e").tag(sync=True)
    off_color = t.Unicode("").tag(sync=True)
    blink = t.Bool(False).tag(sync=True)
    blink_hz = t.Float(2.0, min=0.1, max=10.0).tag(sync=True)


class ToggleSwitch(BooleanWidget):
    """Toggle (bat-handle) switch (BOOL-003)."""

    _kind = t.Unicode("toggleswitch").tag(sync=True)
    _default_size = (60, 100)
    orientation = t.Enum(["vertical", "horizontal"], default_value="vertical").tag(sync=True)

    def __init__(self, value: bool | None = None, **kwargs: Any) -> None:
        if kwargs.get("orientation") == "horizontal":
            kwargs.setdefault("size", (100, 60))
        super().__init__(value, **kwargs)


class RockerSwitch(BooleanWidget):
    """Rocker switch with I/O marks (BOOL-004)."""

    _kind = t.Unicode("rockerswitch").tag(sync=True)
    _default_size = (60, 100)


class SlideSwitch(BooleanWidget):
    """Two-position slide switch (BOOL-005)."""

    _kind = t.Unicode("slideswitch").tag(sync=True)
    _default_size = (90, 44)


BUTTON_COLORS: tuple[str, ...] = ("grey", "green", "red", "black", "yellow", "blue", "white")
LAMP_COLORS: tuple[str, ...] = ("green", "red", "amber", "blue", "white")


class PushButton(BooleanWidget):
    """Push button with a text (or emoji/icon) caption (BOOL-006, BOOL-015).

    ``color`` is the cap color (IEC 60073: green to start, red to stop...),
    ``shape`` is ``"rect"`` or ``"round"`` (panel operator).

    Illuminated push button: set ``lamp`` to ``True`` / ``False`` to give the
    button a built-in lamp, lit or not, in ``lamp_color`` (``lamp_blink`` to
    flash it). The lamp is feedback set by the program (for example START lit
    while the machine runs), independent of the button ``value``; ``None``
    (the default) means no lamp.
    """

    _kind = t.Unicode("pushbutton").tag(sync=True)
    _default_size = (110, 44)
    text = t.Unicode("OK").tag(sync=True)
    color = t.Enum(list(BUTTON_COLORS), default_value="grey").tag(sync=True)
    shape = t.Enum(["rect", "round"], default_value="rect").tag(sync=True)
    lamp = t.Bool(None, allow_none=True).tag(sync=True)
    lamp_color = t.Enum(list(LAMP_COLORS), default_value="green").tag(sync=True)
    lamp_blink = t.Bool(False).tag(sync=True)
    mechanical_action = t.Enum(list(MECHANICAL_ACTIONS), default_value="latch_when_released").tag(
        sync=True
    )

    def __init__(self, value: bool | None = None, **kwargs: Any) -> None:
        if kwargs.get("shape") == "round":
            kwargs.setdefault("size", (90, 90))
        super().__init__(value, **kwargs)


class EmergencyStop(BooleanWidget):
    """Red mushroom emergency stop button (BOOL-012).

    Pressing it latches ``value`` to ``True``; only :meth:`reset` brings it back
    to ``False``. Its callbacks have the highest priority: inside a batch
    (every front-end update, or :func:`anywidget_instruments.batch`) they run
    before any other pending widget callback (BOOL-013).

    Warnings
    --------
    This widget draws an emergency stop; it is not an emergency stop device
    (ISO 13850, IEC 60204-1) and must never be the means of stopping a machine.
    See the safety notice of the documentation (DOC-007).
    """

    _kind = t.Unicode("emergencystop").tag(sync=True)
    _default_size = (110, 110)
    _callback_priority = _dispatch.PRIORITY_EMERGENCY
    mechanical_action = t.Enum(["switch_when_pressed"], default_value="switch_when_pressed").tag(
        sync=True
    )

    @t.validate("value")
    def _only_latch_on(self, proposal: Any) -> bool:
        # Only reset() may bring the value back to False.
        new = bool(proposal["value"])
        if not new and not getattr(self, "_resetting", False):
            return bool(self.value)
        return new

    def reset(self) -> None:
        """Explicit reset action: return the emergency stop to ``False``."""
        self._resetting = True
        try:
            self.value = False
        finally:
            self._resetting = False

    def read_latched(self) -> bool:
        return self.value  # never auto-reset
