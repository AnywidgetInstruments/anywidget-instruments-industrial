"""Supervisory process objects: Valve, Pump, Motor, Pipe, SynopticCanvas
(SCADA-001 .. SCADA-004, SCADA-009, SCADA-010)."""

from __future__ import annotations

from typing import Any, ClassVar

import ipywidgets
import traitlets as t

from . import _dispatch
from ._base import Callback, InstrumentWidget, mode_trait, size_trait


class ProcessObject(InstrumentWidget):
    """Base of Valve, Pump and Motor.

    In control mode, clicking the object opens a *faceplate* (SCADA-009) with
    its commands and an auto/manual switch. Commands are delivered to
    :meth:`on_command` callbacks as ``{"command": name}``; the object state
    (``value``) is feedback from the process and is not changed by a command,
    unless ``simulate=True`` (handy for teaching and simulations).
    """

    _default_size = (90, 90)
    size = size_trait(*_default_size)
    _commands: ClassVar[tuple[str, ...]] = ()
    _simulated: ClassVar[dict[str, str]] = {}

    tag = t.Unicode("").tag(sync=True)
    auto = t.Bool(True).tag(sync=True)
    simulate = t.Bool(False).tag(sync=True)
    commands = t.List(t.Unicode(), read_only=True).tag(sync=True)

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.set_trait("commands", list(self._commands))
        self._command_callbacks: list[Callback] = []
        self.on_msg(self._handle_front_msg)

    def on_command(self, callback: Callback) -> Callback:
        """Register ``callback(event)`` with ``event["command"]`` in :attr:`commands`."""
        self._command_callbacks.append(callback)
        return callback

    def command(self, name: str) -> None:
        """Issue a command as if the operator used the faceplate."""
        if name == "auto":
            self.auto = True
        elif name == "manual":
            self.auto = False
        elif name not in self._commands:
            raise ValueError(f"{type(self).__name__} has no command {name!r}")
        elif self.simulate and name in self._simulated:
            self.value = self._simulated[name]
        with _dispatch.batch():
            for cb in list(self._command_callbacks):
                _dispatch.call(
                    self,
                    cb,
                    {"name": "command", "command": name, "owner": self},
                    self._callback_priority,
                )

    def _handle_front_msg(self, _widget: Any, content: Any, _buffers: Any) -> None:
        if (
            isinstance(content, dict)
            and content.get("type") == "command"
            and self.mode == "control"
            and not self.disabled
        ):
            name = content.get("command")
            if name in (*self._commands, "auto", "manual"):
                self.command(name)


class Valve(ProcessObject):
    """On/off or control valve (SCADA-001).

    ``value``: ``"open"``, ``"closed"``, ``"transit"`` or ``"fault"``.
    ``position``: optional opening in % for control valves (feedback).

    For a control valve (``position`` set), the faceplate also takes a
    position demand in manual mode, with a slider or a typed value (API-014):
    :meth:`on_command` callbacks receive ``{"command": "position", "value": %}``.
    """

    _kind = t.Unicode("valve").tag(sync=True)
    _commands = ("open", "close")
    commands = t.List(t.Unicode(), default_value=list(_commands), read_only=True).tag(sync=True)
    _simulated: ClassVar[dict[str, str]] = {"open": "open", "close": "closed"}
    value = t.Enum(["open", "closed", "transit", "fault"], default_value="closed").tag(sync=True)
    position = t.Float(None, allow_none=True, min=0.0, max=100.0).tag(sync=True)
    orientation = t.Enum(["horizontal", "vertical"], default_value="horizontal").tag(sync=True)

    def command(self, name: str) -> None:
        if self.simulate and self.position is not None and name in ("open", "close"):
            self.position = 100.0 if name == "open" else 0.0
        super().command(name)

    def demand_position(self, percent: float) -> None:
        """Position demand (0 to 100 %) as if the operator used the faceplate."""
        v = float(percent)
        if not 0.0 <= v <= 100.0:
            raise ValueError(f"Valve position demand must be between 0 and 100 %, got {v}")
        if self.simulate:
            self.position = v
            self.value = "open" if v > 0 else "closed"
        with _dispatch.batch():
            for cb in list(self._command_callbacks):
                _dispatch.call(
                    self,
                    cb,
                    {"name": "command", "command": "position", "value": v, "owner": self},
                    self._callback_priority,
                )

    def _handle_front_msg(self, widget: Any, content: Any, buffers: Any) -> None:
        if isinstance(content, dict) and content.get("command") == "position":
            v = content.get("value")
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                return
            ok = (
                content.get("type") == "command"
                and self.mode == "control"
                and not self.disabled
                and not self.auto
                and self.position is not None
                and 0.0 <= v <= 100.0
            )
            if ok:
                self.demand_position(float(v))
            return
        super()._handle_front_msg(widget, content, buffers)


class Pump(ProcessObject):
    """Pump with stopped/running/fault states and rotation animation (SCADA-002)."""

    _kind = t.Unicode("pump").tag(sync=True)
    _commands = ("start", "stop")
    commands = t.List(t.Unicode(), default_value=list(_commands), read_only=True).tag(sync=True)
    _simulated: ClassVar[dict[str, str]] = {"start": "running", "stop": "stopped"}
    value = t.Enum(["stopped", "running", "fault"], default_value="stopped").tag(sync=True)
    animate = t.Bool(True).tag(sync=True)
    direction = t.Enum(["right", "left", "up", "down"], default_value="right").tag(sync=True)


class Motor(ProcessObject):
    """Motor with stopped/forward/reverse/fault states (SCADA-003)."""

    _kind = t.Unicode("motor").tag(sync=True)
    _commands = ("forward", "reverse", "stop")
    commands = t.List(t.Unicode(), default_value=list(_commands), read_only=True).tag(sync=True)
    _simulated: ClassVar[dict[str, str]] = {
        "forward": "forward",
        "reverse": "reverse",
        "stop": "stopped",
    }
    value = t.Enum(["stopped", "forward", "reverse", "fault"], default_value="stopped").tag(
        sync=True
    )
    animate = t.Bool(True).tag(sync=True)


PIPE_SHAPES = ("straight", "elbow", "tee", "cross")


class Pipe(InstrumentWidget):
    """Pipe segment: straight, elbow, tee or cross, rotated by 0/90/180/270° (SCADA-004).

    ``value`` is True while the fluid flows; with ``flow_animation`` a moving
    pattern shows ``flow_direction`` (``"forward"`` or ``"reverse"``).
    Unrotated shapes: straight = left→right, elbow = left→bottom,
    tee = left→right plus a branch to the bottom, cross = all four sides.
    """

    _kind = t.Unicode("pipe").tag(sync=True)
    _default_mode = "indicator"
    _default_size = (80, 80)
    mode = mode_trait(_default_mode)
    size = size_trait(*_default_size)
    value = t.Bool(False).tag(sync=True)
    shape = t.Enum(list(PIPE_SHAPES), default_value="straight").tag(sync=True)
    rotation = t.Enum([0, 90, 180, 270], default_value=0).tag(sync=True)
    flow_animation = t.Bool(True).tag(sync=True)
    flow_direction = t.Enum(["forward", "reverse"], default_value="forward").tag(sync=True)
    fluid_color = t.Unicode("").tag(sync=True)
    thickness = t.Float(14.0, min=2.0).tag(sync=True)


class SynopticCanvas(InstrumentWidget):
    """Place widgets and pipe runs at absolute coordinates on a background (SCADA-010).

    Children are rendered through the host widget manager (Jupyter). Pipe
    runs are polylines drawn by the canvas itself, with optional flow
    animation::

        syn = SynopticCanvas(size=(600, 300), background=png_bytes)
        syn.add(Tank(label="T1"), x=40, y=40)
        run = syn.add_pipe([(100, 200), (300, 200), (300, 120)], flow=True)
        syn.set_flow(run, False)
    """

    _kind = t.Unicode("synoptic").tag(sync=True)
    _default_mode = "indicator"
    _default_size = (640, 360)
    #: ``[{"widget": w, "x": float, "y": float}, ...]``
    items = t.List(t.Dict()).tag(sync=True, **ipywidgets.widget_serialization)
    pipes = t.List(t.Dict()).tag(sync=True)
    background = t.Bytes(b"").tag(sync=True)
    background_mime = t.Unicode("").tag(sync=True)
    value = t.Dict(read_only=True).tag(sync=True)

    def add(self, widget: ipywidgets.Widget, x: float, y: float) -> ipywidgets.Widget:
        """Place ``widget`` with its top-left corner at ``(x, y)``."""
        self.items = [*self.items, {"widget": widget, "x": float(x), "y": float(y)}]
        return widget

    def move(self, widget: ipywidgets.Widget, x: float, y: float) -> None:
        self.items = [
            {**it, "x": float(x), "y": float(y)} if it["widget"] is widget else it
            for it in self.items
        ]

    def remove(self, widget: ipywidgets.Widget) -> None:
        self.items = [it for it in self.items if it["widget"] is not widget]

    @property
    def widgets(self) -> list[ipywidgets.Widget]:
        return [it["widget"] for it in self.items]

    def add_pipe(
        self,
        points: Any,
        flow: bool = False,
        direction: str = "forward",
        color: str = "",
        thickness: float = 10.0,
    ) -> int:
        """Add a pipe run through ``points``; returns its index."""
        pts = [[float(x), float(y)] for x, y in points]
        if len(pts) < 2:
            raise ValueError("a pipe needs at least two points")
        if direction not in ("forward", "reverse"):
            raise ValueError("direction must be 'forward' or 'reverse'")
        self.pipes = [
            *self.pipes,
            {
                "points": pts,
                "flow": bool(flow),
                "direction": direction,
                "color": color,
                "thickness": float(thickness),
            },
        ]
        return len(self.pipes) - 1

    def set_flow(self, index: int, flow: bool, direction: str | None = None) -> None:
        pipes = [dict(p) for p in self.pipes]
        pipes[index]["flow"] = bool(flow)
        if direction is not None:
            pipes[index]["direction"] = direction
        self.pipes = pipes

    @t.validate("background")
    def _check_background(self, proposal: Any) -> bytes:
        data = bytes(proposal["value"])
        if not data:
            self.background_mime = ""
        elif data[:8] == b"\x89PNG\r\n\x1a\n":
            self.background_mime = "image/png"
        elif data[:3] == b"\xff\xd8\xff":
            self.background_mime = "image/jpeg"
        elif b"<svg" in data[:2048]:
            # rendered through <img>: scripts and external loads are disabled
            self.background_mime = "image/svg+xml"
        else:
            raise t.TraitError("background must be PNG, JPEG or SVG bytes")
        return data
