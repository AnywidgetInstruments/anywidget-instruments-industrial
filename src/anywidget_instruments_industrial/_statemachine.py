"""Machine state models: display and logic (IND-060 .. IND-066).

Models: ISA-TR88.00.02 (PackML) machine states, GEMMA (running and stopping
modes) and the ISA-88 / IEC 61512-1 procedural states.
"""

from __future__ import annotations

import copy
import math
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
# grid layout of the usual state model drawing (column, row): the Hold loop
# above the production line, the Suspend loop below, the stop states last
_LAYOUT = {
    "Unholding": (1, 0),
    "Held": (2, 0),
    "Holding": (3, 0),
    "Idle": (0, 1),
    "Starting": (1, 1),
    "Execute": (2, 1),
    "Completing": (3, 1),
    "Complete": (4, 1),
    "Resetting": (0, 2),
    "Unsuspending": (1, 2),
    "Suspended": (2, 2),
    "Suspending": (3, 2),
    "Stopped": (0, 3),
    "Stopping": (1, 3),
    "Clearing": (2, 3),
    "Aborted": (3, 3),
    "Aborting": (4, 3),
}
# Stop leaves every state of the first three rows, Abort every state but
# Aborting and Aborted: each drawn as one arrow out of a dashed zone
_ZONES = [
    {"rects": [[0, 0, 5, 3], [0, 3, 3, 4]], "commands": ["Abort"], "shade": True},
    {"rects": [[0, 0, 5, 3]], "commands": ["Stop"]},
]
# arrows around the other states (waypoints in cell units, cell centres at +0.5)
_ROUTES = {
    "Execute>Holding": [[2.8, 1.0], [3.5, 1.0]],
    "Unholding>Execute": [[1.5, 1.0], [2.2, 1.0]],
    "Execute>Suspending": [[2.8, 2.0], [3.5, 2.0]],
    "Unsuspending>Execute": [[1.5, 2.0], [2.2, 2.0]],
    "Complete>Resetting": [[4.5, 2.8], [0.3, 2.8]],
    "Clearing>Stopped": [[2.5, 3.85], [0.5, 3.85]],
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
    "zones": _ZONES,
    "routes": _ROUTES,
}


# -- GEMMA (IND-064) ------------------------------------------------------------------
# Guide d'Etude des Modes de Marches et d'Arrets (ADEPA, 1981): 16 running and
# stopping procedures in three families. The transitions below are the usual
# loops of the guide; a real machine keeps the procedures and loops it needs.
_GEMMA_STATES = [
    # name, title, group, (x, y), acting
    ("A6", "Reset to the initial state", "A", (0, 0), True),
    ("A1", "Stop in the initial state", "A", (1, 0), False),
    ("A2", "Stop requested at end of cycle", "A", (2, 0), True),
    ("A3", "Stop requested in a given state", "A", (3, 0), True),
    ("A4", "Stop reached", "A", (4, 0), False),
    ("A5", "Preparation for restart after failure", "A", (0, 1), False),
    ("A7", "Set to a given state", "A", (1, 1), True),
    ("F2", "Preparation run", "F", (2, 1), True),
    ("F1", "Normal production", "F", (3, 1), False),
    ("F3", "Closing run", "F", (4, 1), True),
    ("F4", "Check run out of order", "F", (1, 2), False),
    ("F5", "Check run in order", "F", (2, 2), False),
    ("F6", "Test run", "F", (3, 2), False),
    ("D1", "Emergency stop", "D", (1, 3), False),
    ("D2", "Failure diagnosis and treatment", "D", (2, 3), False),
    ("D3", "Production despite a failure", "D", (3, 3), False),
]
_GEMMA_GROUPS = {
    "A": "A: stop and restart procedures",
    "F": "F: operating procedures",
    "D": "D: failure procedures",
}
_GEMMA_TRANSITIONS = [
    ["A1", "Start", "F1"],
    ["A1", "Prepare", "F2"],
    ["F2", SC, "F1"],
    ["F1", "End of cycle", "A2"],
    ["A2", SC, "A1"],
    ["F1", "Stop", "A3"],
    ["A3", SC, "A4"],
    ["A4", "Start", "F1"],
    ["F1", "Close", "F3"],
    ["F3", SC, "A1"],
    ["A1", "Check", "F5"],
    ["F5", "Finish", "A1"],
    ["A1", "Step check", "F4"],
    ["F4", "Finish", "A6"],
    ["A1", "Test", "F6"],
    ["F6", "Finish", "A1"],
    ["F1", "Fault", "D2"],
    ["F2", "Fault", "D2"],
    ["F3", "Fault", "D2"],
    ["D2", "Degraded run", "D3"],
    ["D3", "End of cycle", "A2"],
    ["D2", "Repaired", "A5"],
    ["D1", "Rearm", "A5"],
    ["A5", "To initial state", "A6"],
    ["A5", "To given state", "A7"],
    ["A6", SC, "A1"],
    ["A7", SC, "A4"],
] + [[name, "E-stop", "D1"] for name, *_ in _GEMMA_STATES if name != "D1"]

#: GEMMA running and stopping modes (ADEPA, 1981): 16 procedures in the families
#: A (stop and restart), F (operation) and D (failure) (IND-064).
GEMMA_MODEL: dict[str, Any] = {
    "states": [
        {"name": n, "title": title, "group": _GEMMA_GROUPS[g], "x": x, "y": y, "acting": acting}
        for n, title, g, (x, y), acting in _GEMMA_STATES
    ],
    "transitions": _GEMMA_TRANSITIONS,
    "commands": [
        "Start",
        "Prepare",
        "End of cycle",
        "Stop",
        "Close",
        "Check",
        "Step check",
        "Test",
        "Finish",
        "Fault",
        "Degraded run",
        "Repaired",
        "E-stop",
        "Rearm",
        "To initial state",
        "To given state",
    ],
    "global_commands": ["E-stop"],
    "initial": "A1",
    # E-stop leaves every procedure but D1: one arrow out of a dashed zone
    "zones": [{"rects": [[0, 0, 5, 3], [2, 3, 4, 4]], "commands": ["E-stop"]}],
}

# -- ISA-88 / IEC 61512-1 procedural states (IND-065) ---------------------------------------
_ISA88_LAYOUT = {
    "Restarting": (1, 0),
    "Held": (2, 0),
    "Holding": (3, 0),
    "Idle": (0, 1),
    "Running": (2, 1),
    "Complete": (4, 1),
    "Paused": (2, 2),
    "Pausing": (3, 2),
    "Stopped": (0, 3),
    "Stopping": (1, 3),
    "Aborting": (3, 3),
    "Aborted": (4, 3),
}
_ISA88_ACTING = {"Pausing", "Holding", "Restarting", "Stopping", "Aborting"}
_ISA88_ACTIVE = ["Running", "Pausing", "Paused", "Holding", "Held", "Restarting"]

#: ISA-88 / IEC 61512-1 states of a procedural element (a phase, an operation):
#: 12 states and 8 commands (IND-065).
ISA88_MODEL: dict[str, Any] = {
    "states": [
        {"name": n, "x": x, "y": y, "acting": n in _ISA88_ACTING}
        for n, (x, y) in _ISA88_LAYOUT.items()
    ],
    "transitions": [
        ["Idle", "Start", "Running"],
        ["Running", SC, "Complete"],
        ["Running", "Pause", "Pausing"],
        ["Pausing", SC, "Paused"],
        ["Paused", "Resume", "Running"],
        ["Running", "Hold", "Holding"],
        ["Pausing", "Hold", "Holding"],
        ["Paused", "Hold", "Holding"],
        ["Holding", SC, "Held"],
        ["Held", "Restart", "Restarting"],
        ["Restarting", SC, "Running"],
        ["Stopping", SC, "Stopped"],
        ["Aborting", SC, "Aborted"],
        ["Complete", "Reset", "Idle"],
        ["Stopped", "Reset", "Idle"],
        ["Aborted", "Reset", "Idle"],
    ]
    + [[s, "Stop", "Stopping"] for s in _ISA88_ACTIVE]
    + [[s, "Abort", "Aborting"] for s in [*_ISA88_ACTIVE, "Stopping"]],
    "commands": ["Start", "Pause", "Resume", "Hold", "Restart", "Stop", "Abort", "Reset"],
    "global_commands": ["Stop", "Abort"],
    "initial": "Idle",
    # Stop leaves every active state, Abort also Stopping, Hold the running
    # ones: each drawn as one arrow out of a dashed zone
    "zones": [
        {"rects": [[1, 0, 4, 3], [1, 3, 2, 4]], "commands": ["Abort"], "shade": True},
        {"rects": [[1, 0, 4, 3]], "commands": ["Stop"]},
        {"rects": [[2, 1, 3, 3], [3, 2, 4, 3]], "commands": ["Hold"]},
    ],
    "routes": {
        "Restarting>Running": [[1.5, 1.0], [2.2, 1.0]],
        "Running>Pausing": [[2.8, 2.0], [3.25, 2.0]],
        "Complete>Idle": [[4.5, 2.88], [0.3, 2.88]],
        "Aborted>Idle": [[4.5, 2.88], [0.3, 2.88]],
    },
}

#: Models by name, for ``StateMachine("gemma")`` and the like.
STATE_MODELS: dict[str, dict[str, Any]] = {
    "packml": PACKML_MODEL,
    "gemma": GEMMA_MODEL,
    "isa88": ISA88_MODEL,
}


def _check_model(model: dict[str, Any]) -> dict[str, Any]:
    states = model.get("states")
    if not isinstance(states, list) or not states:
        raise ValueError("model needs a non-empty 'states' list")
    names = []
    for k, s in enumerate(states):
        if not isinstance(s, dict) or not isinstance(s.get("name"), str):
            raise ValueError("each state needs a 'name'")
        for key in ("title", "group"):
            if key in s and not isinstance(s[key], str):
                raise ValueError(f"the {key!r} of state {s['name']!r} must be a string")
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
    if "global_commands" in model:
        if not isinstance(model["global_commands"], list):
            raise ValueError("global_commands must be a list of commands")
        extra = [c for c in model["global_commands"] if c not in commands]
        if extra:
            raise ValueError(f"global_commands not in the commands: {extra!r}")
    model.setdefault("initial", names[0])
    if model["initial"] not in names:
        raise ValueError(f"unknown initial state {model['initial']!r}")
    _check_drawing(model, names, commands)
    return model


def _is_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _check_drawing(model: dict[str, Any], names: list[str], commands: list[str]) -> None:
    """Check the optional ``zones`` and ``routes`` of a model (IND-066)."""
    if "zones" in model:
        if not isinstance(model["zones"], list):
            raise ValueError("zones must be a list")
        for zone in model["zones"]:
            rects = zone.get("rects") if isinstance(zone, dict) else None
            if (
                not isinstance(rects, list)
                or not rects
                or not all(
                    isinstance(r, list) and len(r) == 4 and all(_is_number(v) for v in r)
                    for r in rects
                )
            ):
                raise ValueError(f"each zone needs 'rects': [[x0, y0, x1, y1], ...], got {zone!r}")
            if "label" in zone and not isinstance(zone["label"], str):
                raise ValueError("the label of a zone must be a string")
            if "commands" in zone:
                zc = zone["commands"]
                extra = [c for c in zc if c not in commands] if isinstance(zc, list) else zc
                if extra:
                    raise ValueError(f"zone commands not in the commands: {extra!r}")
            if "shade" in zone:
                zone["shade"] = bool(zone["shade"])
    if "routes" in model:
        routes = model["routes"]
        if not isinstance(routes, dict):
            raise ValueError("routes must be a dict {'From>To': [[x, y], ...]}")
        for key, points in routes.items():
            ends = key.split(">") if isinstance(key, str) else []
            if len(ends) != 2 or any(n not in names for n in ends):
                raise ValueError(f"invalid route {key!r}: expected 'From>To' with known states")
            if not isinstance(points, list) or not all(
                isinstance(p, list) and len(p) == 2 and all(_is_number(v) for v in p)
                for p in points
            ):
                raise ValueError(f"route {key!r} needs a list of [x, y] points")


class StateMachine(InstrumentWidget):
    """Machine state model with operator commands (IND-060 .. IND-063).

    ``value`` is the current state. The operator (or the kernel, with
    :meth:`command`) issues commands; only those valid in the current state
    are accepted and offered (IND-061). Acting states such as ``Starting``
    end when the kernel calls :meth:`state_complete` (IND-062).

    ``machine`` is the model: ISA-TR88.00.02 (PackML) by default, one of the
    names of :data:`STATE_MODELS` (``"gemma"`` for GEMMA, IND-064; ``"isa88"`` for
    the ISA-88 / IEC 61512-1 procedural states, IND-065), or a custom dict
    ``{"states": [{"name", "x", "y", "acting", "title", "group"}],
    "transitions": [[from, command, to], ...], "initial": name,
    "global_commands": [...]}`` where the command ``"SC"`` marks the
    completion of an acting state (IND-063). A state ``title`` is shown under
    its name and states of the same ``group`` share a shaded zone; commands
    of ``global_commands`` (valid from most states, such as Stop and Abort)
    are summarized in a note instead of drawn as arrows (IND-066).

    Warnings
    --------
    Enforces a state model in software; it is not a safety function and does
    not replace the machine's control system.
    See the safety notice of the documentation (DOC-007).
    """

    _kind = t.Unicode("statemachine").tag(sync=True)
    _default_size = (720, 380)
    size = size_trait(*_default_size)
    value = t.Unicode("", read_only=True).tag(sync=True)
    #: The class default is the PackML model, so hosts reading class defaults get it.
    machine = t.Dict(default_value=copy.deepcopy(PACKML_MODEL)).tag(sync=True)
    available_commands = t.List(t.Unicode(), read_only=True).tag(sync=True)
    last_command = t.Unicode("", read_only=True).tag(sync=True)

    def __init__(self, machine: dict[str, Any] | str | None = None, **kwargs: Any) -> None:
        initial = kwargs.pop("value", None)
        super().__init__(**kwargs)
        if isinstance(machine, str):
            if machine.lower() not in STATE_MODELS:
                raise ValueError(f"unknown model {machine!r}; known models: {sorted(STATE_MODELS)}")
            machine = STATE_MODELS[machine.lower()]
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
    def state_title(self) -> str:
        """Title of the current state (``""`` when the model gives none)."""
        states = self.machine["states"]
        return next((s.get("title", "") for s in states if s["name"] == self.value), "")

    def path_to(self, state: str) -> list[str] | None:
        """Shortest sequence of commands (``"SC"`` for a completion) leading to ``state``.

        ``[]`` when already there, None when ``state`` cannot be reached.
        """
        if state not in [s["name"] for s in self.machine["states"]]:
            raise KeyError(f"no state {state!r} in this model")
        seen: dict[str, list[str]] = {self.value: []}
        queue = [self.value]
        while queue:
            cur = queue.pop(0)
            if cur == state:
                return seen[cur]
            for frm, cmd, to in self.machine.get("transitions", []):
                if frm == cur and to not in seen:
                    seen[to] = [*seen[cur], cmd]
                    queue.append(to)
        return None

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
