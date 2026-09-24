"""Machine state model display and logic (IND-060 .. IND-063, ISA-TR88.00.02)."""

from __future__ import annotations

import copy
from typing import Any

import traitlets as t

from ._base import InstrumentWidget, size_trait

#: Pseudo-command for the end of an acting state ("state complete").
SC = "SC"

PACKML_COMMANDS: tuple[str, ...] = (
    "Start",
    "Stop",
    "Hold",
    "Unhold",
    "Suspend",
    "Unsuspend",
    "Reset",
    "Abort",
    "Clear",
)

_ACTING = {
    "Starting",
    "Completing",
    "Resetting",
    "Holding",
    "Unholding",
    "Suspending",
    "Unsuspending",
    "Stopping",
    "Aborting",
    "Clearing",
}
# grid layout of the usual state model drawing (column, row)
_LAYOUT = {
    "Idle": (0, 0),
    "Starting": (1, 0),
    "Execute": (2, 0),
    "Completing": (3, 0),
    "Complete": (4, 0),
    "Resetting": (0, 1),
    "Unholding": (1, 1),
    "Held": (2, 1),
    "Holding": (3, 1),
    "Unsuspending": (1, 2),
    "Suspended": (2, 2),
    "Suspending": (3, 2),
    "Stopped": (0, 3),
    "Stopping": (1, 3),
    "Clearing": (2, 3),
    "Aborted": (3, 3),
    "Aborting": (4, 3),
}


def _packml_transitions() -> list[list[str]]:
    tr = [
        ["Stopped", "Reset", "Resetting"],
        ["Resetting", SC, "Idle"],
        ["Idle", "Start", "Starting"],
        ["Starting", SC, "Execute"],
        ["Execute", SC, "Completing"],
        ["Completing", SC, "Complete"],
        ["Complete", "Reset", "Resetting"],
        ["Execute", "Hold", "Holding"],
        ["Holding", SC, "Held"],
        ["Held", "Unhold", "Unholding"],
        ["Unholding", SC, "Execute"],
        ["Execute", "Suspend", "Suspending"],
        ["Suspending", SC, "Suspended"],
        ["Suspended", "Unsuspend", "Unsuspending"],
        ["Unsuspending", SC, "Execute"],
        ["Stopping", SC, "Stopped"],
        ["Aborting", SC, "Aborted"],
        ["Aborted", "Clear", "Clearing"],
        ["Clearing", SC, "Stopped"],
    ]
    for state in _LAYOUT:
        if state not in ("Stopping", "Stopped", "Aborting", "Aborted", "Clearing"):
            tr.append([state, "Stop", "Stopping"])
        if state not in ("Aborting", "Aborted"):
            tr.append([state, "Abort", "Aborting"])
    return tr


#: ISA-TR88.00.02 (PackML) state model: 17 states, 9 commands (IND-060).
PACKML_MODEL: dict[str, Any] = {
    "states": [
        {"name": name, "x": x, "y": y, "acting": name in _ACTING}
        for name, (x, y) in _LAYOUT.items()
    ],
    "transitions": _packml_transitions(),
    "commands": list(PACKML_COMMANDS),
    "initial": "Stopped",
}


def _check_model(model: dict[str, Any]) -> dict[str, Any]:
    states = model.get("states")
    if not isinstance(states, list) or not states:
        raise ValueError("model needs a non-empty 'states' list")
    names = []
    for k, s in enumerate(states):
        if not isinstance(s, dict) or not isinstance(s.get("name"), str):
            raise ValueError("each state needs a 'name'")
        s.setdefault("x", k % 5)
        s.setdefault("y", k // 5)
        s.setdefault("acting", False)
        names.append(s["name"])
    if len(set(names)) != len(names):
        raise ValueError("state names must be unique")
    commands = list(model.get("commands") or [])
    for tr in model.get("transitions", []):
        if len(tr) != 3 or tr[0] not in names or tr[2] not in names:
            raise ValueError(f"invalid transition {tr!r}")
        if tr[1] != SC and tr[1] not in commands:
            commands.append(tr[1])
    model["commands"] = commands
    model.setdefault("initial", names[0])
    if model["initial"] not in names:
        raise ValueError(f"unknown initial state {model['initial']!r}")
    return model


class StateMachine(InstrumentWidget):
    """Machine state model with operator commands (IND-060 .. IND-063).

    ``value`` is the current state. The operator (or the kernel, with
    :meth:`command`) issues commands; only those valid in the current state
    are accepted and offered (IND-061). Acting states such as ``Starting``
    end when the kernel calls :meth:`state_complete` (IND-062).

    ``machine`` is the model: ISA-TR88.00.02 (PackML) by default, or a custom
    dict ``{"states": [{"name", "x", "y", "acting"}], "transitions":
    [[from, command, to], ...], "initial": name}`` where the command ``"SC"``
    marks the completion of an acting state (IND-063).

    Warnings
    --------
    Enforces a state model in software; it is not a safety function and does
    not replace the machine's control system.
    See the safety notice of the documentation (DOC-007).
    """

    _kind = t.Unicode("statemachine").tag(sync=True)
    _default_size = (560, 250)
    size = size_trait(*_default_size)
    value = t.Unicode("", read_only=True).tag(sync=True)
    #: The class default is the PackML model, so hosts reading class defaults get it.
    machine = t.Dict(default_value=copy.deepcopy(PACKML_MODEL)).tag(sync=True)
    available_commands = t.List(t.Unicode(), read_only=True).tag(sync=True)
    last_command = t.Unicode("", read_only=True).tag(sync=True)

    def __init__(self, machine: dict[str, Any] | None = None, **kwargs: Any) -> None:
        initial = kwargs.pop("value", None)
        super().__init__(**kwargs)
        self.machine = copy.deepcopy(PACKML_MODEL if machine is None else machine)
        self.set_trait("value", initial or self.machine["initial"])
        self._update_commands()
        self.on_msg(self._handle_front_msg)

    @t.validate("machine")
    def _validate_machine(self, proposal: Any) -> dict[str, Any]:
        try:
            return _check_model(copy.deepcopy(proposal["value"]))
        except ValueError as exc:
            raise t.TraitError(
                f"The 'machine' trait of a {type(self).__name__} instance: {exc}"
            ) from exc

    @t.observe("machine")
    def _on_machine(self, _change: Any) -> None:
        names = [s["name"] for s in self.machine["states"]]
        if self.value not in names:
            self.set_trait("value", self.machine["initial"])
        self._update_commands()

    def _next(self, command: str) -> str | None:
        for frm, cmd, to in self.machine.get("transitions", []):
            if frm == self.value and cmd == command:
                return str(to)
        return None

    def _update_commands(self) -> None:
        valid = [c for c in self.machine.get("commands", []) if self._next(c) is not None]
        self.set_trait("available_commands", valid)

    @property
    def is_acting(self) -> bool:
        return any(s["name"] == self.value and s["acting"] for s in self.machine["states"])

    def _go(self, state: str, command: str) -> None:
        with self.hold_trait_notifications():
            self.set_trait("last_command", command)
            self.set_trait("value", state)
            self._update_commands()

    def command(self, command: str) -> bool:
        """Apply ``command`` if it is valid in the current state; return ``True`` if applied."""
        nxt = self._next(command) if command != SC else None
        if nxt is None:
            self.send({"type": "rejected", "command": command, "state": self.value})
            return False
        self._go(nxt, command)
        return True

    def state_complete(self) -> bool:
        """End the current acting state (IND-062); return ``True`` if the state changed."""
        nxt = self._next(SC)
        if nxt is None:
            return False
        self._go(nxt, SC)
        return True

    def _handle_front_msg(self, _widget: Any, content: Any, _buffers: Any) -> None:
        if not isinstance(content, dict) or self.mode != "control" or self.disabled:
            return
        if content.get("type") == "command" and isinstance(content.get("command"), str):
            self.command(content["command"])
