"""Alarm display objects (SCADA-005 .. SCADA-008).

State model follows the ISA-18.2 / IEC 62682 alarm state transition diagram
(simplified: shelving, suppression and out-of-service states are not modeled).
"""

from __future__ import annotations

import datetime as _dt
from typing import Any

import traitlets as t

from ._base import Callback, InstrumentWidget, _report_callback_error

ALARM_STATES: tuple[str, ...] = (
    "normal",
    "active_unacknowledged",
    "active_acknowledged",
    "cleared_unacknowledged",
)
ALARM_PRIORITIES: tuple[str, ...] = ("low", "medium", "high", "critical")

_TRANSITIONS = {
    ("normal", "activate"): "active_unacknowledged",
    ("cleared_unacknowledged", "activate"): "active_unacknowledged",
    ("active_unacknowledged", "clear"): "cleared_unacknowledged",
    ("active_acknowledged", "clear"): "normal",
    ("active_unacknowledged", "acknowledge"): "active_acknowledged",
    ("cleared_unacknowledged", "acknowledge"): "normal",
}


def alarm_transition(state: str, event: str) -> str:
    """ISA-18.2 alarm state after ``event`` (``activate``, ``clear``, ``acknowledge``)."""
    if event not in ("activate", "clear", "acknowledge"):
        raise ValueError(f"unknown alarm event {event!r}")
    return _TRANSITIONS.get((state, event), state)


class AlarmIndicator(InstrumentWidget):
    """Single alarm annunciator.

    ``value`` is the alarm state. Use :meth:`activate`, :meth:`clear` and
    :meth:`acknowledge` (or the ACK button in control mode) to drive it.

    Warnings
    --------
    Presents alarms; it is not an alarm management system nor a safety
    function. Critical alarms need independent annunciation.
    See the safety notice of the documentation (DOC-007).
    """

    _kind = t.Unicode("alarmindicator").tag(sync=True)
    _default_size = (260, 64)

    value = t.Enum(list(ALARM_STATES), default_value="normal").tag(sync=True)
    alarm_id = t.Unicode("").tag(sync=True)
    priority = t.Enum(list(ALARM_PRIORITIES), default_value="high").tag(sync=True)
    message = t.Unicode("").tag(sync=True)

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._ack_callbacks: list[Callback] = []
        self.on_msg(self._handle_front_msg)

    # -- state machine -------------------------------------------------------------
    def activate(self, message: str | None = None) -> None:
        """The process condition entered the alarm state."""
        if message is not None:
            self.message = message
        self.value = alarm_transition(self.value, "activate")

    def clear(self) -> None:
        """The process condition returned to normal."""
        self.value = alarm_transition(self.value, "clear")

    def acknowledge(self) -> None:
        """Operator acknowledgement (SCADA-007)."""
        new = alarm_transition(self.value, "acknowledge")
        if new == self.value:
            return
        self.value = new
        event = {"name": "acknowledge", "alarm_id": self.alarm_id, "owner": self}
        for cb in list(self._ack_callbacks):
            try:
                cb(event)
            except Exception:
                _report_callback_error(self, cb)

    def on_acknowledge(self, callback: Callback) -> Callback:
        """Register ``callback(event)`` called with ``event["alarm_id"]`` on acknowledgement."""
        self._ack_callbacks.append(callback)
        return callback

    def _handle_front_msg(self, _widget: Any, content: Any, _buffers: Any) -> None:
        if (
            isinstance(content, dict)
            and content.get("type") == "ack"
            and self.mode == "control"
            and not self.disabled
        ):
            self.acknowledge()


class AlarmBanner(InstrumentWidget):
    """List of active alarms with timestamp, source, priority and message (SCADA-006).

    ``value`` is the list of alarms that are not back to normal, each a dict
    ``{"id", "timestamp", "source", "priority", "message", "state"}``, sorted
    by priority then time on the front end. Acknowledgements from the ACK
    buttons call :meth:`on_acknowledge` callbacks with the alarm id (SCADA-007).

    Warnings
    --------
    Presents alarms; it is not an alarm management system nor a safety
    function. Critical alarms need independent annunciation.
    See the safety notice of the documentation (DOC-007).
    """

    _kind = t.Unicode("alarmbanner").tag(sync=True)
    _default_size = (520, 180)
    value = t.List(t.Dict(), read_only=True).tag(sync=True)

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._alarms: dict[str, dict[str, Any]] = {}
        self._ack_callbacks: list[Callback] = []
        self.on_msg(self._handle_front_msg)

    def _publish(self) -> None:
        self.set_trait("value", [dict(a) for a in self._alarms.values()])

    def raise_alarm(
        self,
        alarm_id: str,
        message: str = "",
        source: str = "",
        priority: str = "high",
        timestamp: _dt.datetime | None = None,
    ) -> None:
        """Activate an alarm (or re-activate a cleared one)."""
        if priority not in ALARM_PRIORITIES:
            raise ValueError(f"priority must be one of {ALARM_PRIORITIES}")
        ts = (timestamp or _dt.datetime.now()).isoformat(timespec="seconds")
        current = self._alarms.get(alarm_id)
        state = alarm_transition(current["state"] if current else "normal", "activate")
        self._alarms[alarm_id] = {
            "id": alarm_id,
            "timestamp": ts
            if current is None or state != current["state"]
            else current["timestamp"],
            "source": source,
            "priority": priority,
            "message": message,
            "state": state,
        }
        self._publish()

    def clear_alarm(self, alarm_id: str) -> None:
        """The condition of ``alarm_id`` returned to normal."""
        self._apply(alarm_id, "clear")

    def acknowledge(self, alarm_id: str) -> None:
        """Acknowledge one alarm."""
        if self._apply(alarm_id, "acknowledge"):
            event = {"name": "acknowledge", "alarm_id": alarm_id, "owner": self}
            for cb in list(self._ack_callbacks):
                try:
                    cb(event)
                except Exception:
                    _report_callback_error(self, cb)

    def acknowledge_all(self) -> None:
        for alarm_id in list(self._alarms):
            self.acknowledge(alarm_id)

    def _apply(self, alarm_id: str, event: str) -> bool:
        alarm = self._alarms.get(alarm_id)
        if alarm is None:
            return False
        new = alarm_transition(alarm["state"], event)
        if new == alarm["state"]:
            return False
        if new == "normal":
            del self._alarms[alarm_id]
        else:
            alarm["state"] = new
        self._publish()
        return True

    def state_of(self, alarm_id: str) -> str:
        return self._alarms.get(alarm_id, {"state": "normal"})["state"]

    def on_acknowledge(self, callback: Callback) -> Callback:
        """Register ``callback(event)`` called with ``event["alarm_id"]``."""
        self._ack_callbacks.append(callback)
        return callback

    def _handle_front_msg(self, _widget: Any, content: Any, _buffers: Any) -> None:
        if not isinstance(content, dict) or self.mode != "control" or self.disabled:
            return
        if content.get("type") == "ack" and isinstance(content.get("alarm_id"), str):
            self.acknowledge(content["alarm_id"])
        elif content.get("type") == "ack_all":
            self.acknowledge_all()
