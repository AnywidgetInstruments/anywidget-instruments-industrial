"""Alarm summary with shelving, suppression and out-of-service states (IND-050 .. IND-053).

Follows the ISA-18.2 / IEC 62682 alarm state model: the alarm states of
:mod:`._scada` plus the shelved, suppressed-by-design and out-of-service
conditions, which hide an alarm from the operator's active view.
"""

from __future__ import annotations

import datetime as _dt
import threading
import time
from typing import Any

import traitlets as t

from ._base import Callback, InstrumentWidget, _report_callback_error
from ._scada import ALARM_PRIORITIES, alarm_transition


class AlarmList(InstrumentWidget):
    """Alarm summary table (IND-050 .. IND-053).

    ``value`` lists the alarms, each a dict ``{"id", "timestamp", "source",
    "priority", "message", "state", "shelved_until", "suppressed",
    "out_of_service"}``. The front end sorts and filters them (by priority,
    state and text) and offers ACK, Shelve and Unshelve actions.

    Shelving hides an alarm for a limited time (``shelve_durations`` lists the
    choices, in seconds) and unshelves it automatically (IND-051). Expiry runs
    on a timer thread; where threads are not available (Pyodide), it happens
    on the next call to any method, or to :meth:`refresh`.
    """

    _kind = t.Unicode("alarmlist").tag(sync=True)
    _default_size = (640, 240)
    value = t.List(t.Dict(), read_only=True).tag(sync=True)
    shelve_durations = t.List(t.Float(), default_value=[300.0, 900.0, 3600.0]).tag(sync=True)
    max_shelve = t.Float(8 * 3600.0, min=1.0).tag(sync=True)

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._alarms: dict[str, dict[str, Any]] = {}
        self._callbacks: list[Callback] = []
        self._timer: threading.Timer | None = None
        self._clock = time.time  # replaceable in tests
        self.on_msg(self._handle_front_msg)

    # -- helpers ---------------------------------------------------------------------------
    def _alarm(self, alarm_id: str) -> dict[str, Any]:
        try:
            return self._alarms[alarm_id]
        except KeyError:
            raise KeyError(f"no alarm {alarm_id!r}") from None

    def _keep(self, a: dict[str, Any]) -> bool:
        return bool(
            a["state"] != "normal"
            or a["shelved_until"] is not None
            or a["suppressed"]
            or a["out_of_service"]
        )

    def _publish(self) -> None:
        for alarm_id in [k for k, a in self._alarms.items() if not self._keep(a)]:
            del self._alarms[alarm_id]
        rows = []
        for a in self._alarms.values():
            row = dict(a)
            until = a["shelved_until"]
            row["shelved_until"] = (
                None
                if until is None
                else _dt.datetime.fromtimestamp(until).isoformat(timespec="seconds")
            )
            rows.append(row)
        self.set_trait("value", rows)

    def _notify(self, name: str, alarm_id: str, **extra: Any) -> None:
        event = {"name": name, "alarm_id": alarm_id, "owner": self, **extra}
        for cb in list(self._callbacks):
            try:
                cb(event)
            except Exception:
                _report_callback_error(self, cb)

    def on_event(self, callback: Callback) -> Callback:
        """Register ``callback(event)`` for operator actions (IND-053).

        ``event["name"]`` is ``"acknowledge"``, ``"shelve"`` or ``"unshelve"`` and
        ``event["alarm_id"]`` the alarm; shelving events carry ``"seconds"``.
        """
        self._callbacks.append(callback)
        return callback

    # -- process side -------------------------------------------------------------------------
    def raise_alarm(
        self,
        alarm_id: str,
        message: str = "",
        source: str = "",
        priority: str = "high",
        timestamp: _dt.datetime | None = None,
    ) -> None:
        """The alarm condition became active."""
        if priority not in ALARM_PRIORITIES:
            raise ValueError(f"priority must be one of {ALARM_PRIORITIES}, got {priority!r}")
        self.refresh(publish=False)
        a = self._alarms.get(alarm_id) or self._new(alarm_id, source, priority, message)
        new = alarm_transition(a["state"], "activate")
        if new != a["state"] or not a["timestamp"]:
            a["timestamp"] = (timestamp or _dt.datetime.now()).isoformat(timespec="seconds")
        a.update(state=new, source=source or a["source"], priority=priority, message=message)
        self._publish()

    def _new(self, alarm_id: str, source: str, priority: str, message: str) -> dict[str, Any]:
        a = self._alarms[alarm_id] = {
            "id": alarm_id,
            "timestamp": "",
            "source": source,
            "priority": priority,
            "message": message,
            "state": "normal",
            "shelved_until": None,
            "suppressed": False,
            "out_of_service": False,
        }
        return a

    def clear_alarm(self, alarm_id: str) -> None:
        """The alarm condition returned to normal."""
        self.refresh(publish=False)
        if alarm_id in self._alarms:
            a = self._alarms[alarm_id]
            a["state"] = alarm_transition(a["state"], "clear")
            self._publish()

    def suppress(
        self,
        alarm_id: str,
        suppressed: bool = True,
        *,
        message: str = "",
        source: str = "",
        priority: str = "high",
    ) -> None:
        """Suppressed by design (for example a unit shut down) (IND-052)."""
        self._set_flag(alarm_id, "suppressed", suppressed, (source, priority, message))

    def out_of_service(
        self,
        alarm_id: str,
        oos: bool = True,
        *,
        message: str = "",
        source: str = "",
        priority: str = "high",
    ) -> None:
        """Out of service (for example an instrument under maintenance) (IND-052)."""
        self._set_flag(alarm_id, "out_of_service", oos, (source, priority, message))

    def _set_flag(self, alarm_id: str, flag: str, on: bool, info: tuple[str, str, str]) -> None:
        if info[1] not in ALARM_PRIORITIES:
            raise ValueError(f"priority must be one of {ALARM_PRIORITIES}, got {info[1]!r}")
        self.refresh(publish=False)
        if alarm_id not in self._alarms:
            if not on:
                return
            self._new(alarm_id, *info)
        self._alarms[alarm_id][flag] = bool(on)
        self._publish()

    def state_of(self, alarm_id: str) -> str:
        return str(self._alarms.get(alarm_id, {"state": "normal"})["state"])

    def is_shelved(self, alarm_id: str) -> bool:
        self.refresh()
        return alarm_id in self._alarms and self._alarms[alarm_id]["shelved_until"] is not None

    # -- operator actions -------------------------------------------------------------------------
    def acknowledge(self, alarm_id: str) -> bool:
        """Acknowledge one alarm; returns ``True`` if its state changed."""
        self.refresh(publish=False)
        a = self._alarm(alarm_id)
        new = alarm_transition(a["state"], "acknowledge")
        if new == a["state"]:
            return False
        a["state"] = new
        self._publish()
        self._notify("acknowledge", alarm_id)
        return True

    def shelve(self, alarm_id: str, seconds: float) -> None:
        """Shelve an alarm for ``seconds`` (at most ``max_shelve``) (IND-051)."""
        if not 0 < seconds <= self.max_shelve:
            raise ValueError(f"shelving duration must be in (0, {self.max_shelve}] s")
        self.refresh(publish=False)
        a = self._alarm(alarm_id)
        a["shelved_until"] = self._clock() + float(seconds)
        self._publish()
        self._schedule_expiry()
        self._notify("shelve", alarm_id, seconds=float(seconds))

    def unshelve(self, alarm_id: str) -> None:
        self.refresh(publish=False)
        a = self._alarm(alarm_id)
        if a["shelved_until"] is None:
            return
        a["shelved_until"] = None
        self._publish()
        self._notify("unshelve", alarm_id)

    def refresh(self, publish: bool = True) -> None:
        """Unshelve alarms whose shelving time has expired."""
        now = self._clock()
        expired = [
            k
            for k, a in self._alarms.items()
            if a["shelved_until"] is not None and a["shelved_until"] <= now
        ]
        for alarm_id in expired:
            self._alarms[alarm_id]["shelved_until"] = None
        if publish or expired:
            self._publish()
        for alarm_id in expired:
            self._notify("unshelve", alarm_id, expired=True)

    def _schedule_expiry(self) -> None:
        if self._timer is not None:
            self._timer.cancel()
        pending = [a["shelved_until"] for a in self._alarms.values() if a["shelved_until"]]
        if not pending:
            return
        delay = max(0.0, min(pending) - self._clock()) + 0.05
        timer = threading.Timer(delay, self._on_timer)
        timer.daemon = True
        try:
            timer.start()
        except RuntimeError:  # no threads (Pyodide): expiry on the next call
            return
        self._timer = timer

    def _on_timer(self) -> None:
        self._timer = None
        self.refresh()
        self._schedule_expiry()

    def _handle_front_msg(self, _widget: Any, content: Any, _buffers: Any) -> None:
        if not isinstance(content, dict) or self.mode != "control" or self.disabled:
            return
        alarm_id = content.get("alarm_id")
        if not isinstance(alarm_id, str) or alarm_id not in self._alarms:
            return
        kind = content.get("type")
        if kind == "ack":
            self.acknowledge(alarm_id)
        elif kind == "shelve":
            seconds = content.get("seconds")
            if isinstance(seconds, (int, float)) and 0 < seconds <= self.max_shelve:
                self.shelve(alarm_id, float(seconds))
        elif kind == "unshelve":
            self.unshelve(alarm_id)
