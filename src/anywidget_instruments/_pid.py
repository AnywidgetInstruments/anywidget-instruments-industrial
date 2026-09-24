"""PID controller and its operator faceplate (IND-030 .. IND-034)."""

from __future__ import annotations

import math
from typing import Any

import traitlets as t

from ._alarm_logic import ALARM_LEVELS, compute_alarm_level
from ._base import InstrumentWidget, float_serializers, size_trait

PID_MODES: tuple[str, ...] = ("MAN", "AUTO", "CAS")


def _clamp(v: float, lo: float, hi: float) -> float:
    return min(max(v, lo), hi)


class PID:
    """Positional PID controller, standard (ISA) form (IND-033).

    ``output = kp * (e + 1/ti * ∫e dt - td * d(pv)/dt)``

    * ``action="reverse"``: the output rises when PV falls below SP (heating,
      level filled by an inlet valve); ``"direct"``: it rises when PV rises
      above SP (cooling).
    * The derivative acts on the measurement, so setpoint steps cause no kick.
    * ``ti=0`` disables the integral action; the integral term then acts as a
      fixed bias (manual reset).
    * Anti-windup: the integral term is clamped so that the output never
      leaves ``[out_min, out_max]``.
    * Mode changes are bumpless (IND-034): in ``MAN`` the controller tracks
      the manual output, and ``AUTO`` / ``CAS`` resume from it.

    >>> pid = PID(kp=2.0, ti=10.0, sp=50.0)
    >>> op = pid.step(pv=48.0, dt=0.1)

    Warnings
    --------
    For teaching, simulation and prototyping; a real process needs a
    validated controller and independent protection.
    See the safety notice of the documentation (DOC-007).
    """

    def __init__(
        self,
        kp: float = 1.0,
        ti: float = 0.0,
        td: float = 0.0,
        *,
        sp: float = 0.0,
        out_min: float = 0.0,
        out_max: float = 100.0,
        action: str = "reverse",
        mode: str = "AUTO",
        output: float = 0.0,
    ) -> None:
        if action not in ("reverse", "direct"):
            raise ValueError(f"action must be 'reverse' or 'direct', got {action!r}")
        if not out_max > out_min:
            raise ValueError("out_max must be greater than out_min")
        if mode not in PID_MODES:
            raise ValueError(f"mode must be one of {PID_MODES}, got {mode!r}")
        if ti < 0 or td < 0:
            raise ValueError("ti and td must be >= 0")
        self.kp = float(kp)
        self.ti = float(ti)
        self.td = float(td)
        self.sp = float(sp)
        self.out_min = float(out_min)
        self.out_max = float(out_max)
        self.action = action
        self._mode = mode
        self.output = _clamp(float(output), self.out_min, self.out_max)
        self._i = self.output  # integral term (output units)
        self._pv_prev: float | None = None

    @property
    def mode(self) -> str:
        return self._mode

    def error(self, pv: float) -> float:
        return self.sp - pv if self.action == "reverse" else pv - self.sp

    def set_mode(self, mode: str, pv: float | None = None) -> None:
        """Change mode; entering AUTO / CAS starts from the current output (bumpless)."""
        if mode not in PID_MODES:
            raise ValueError(f"mode must be one of {PID_MODES}, got {mode!r}")
        if mode != "MAN" and self._mode == "MAN":
            self._track(pv)
        self._mode = mode

    def set_output(self, value: float) -> None:
        """Manual output (used in MAN mode)."""
        self.output = _clamp(float(value), self.out_min, self.out_max)
        self._i = self.output

    def reset(self) -> None:
        """Forget the derivative history (the output and integral are kept)."""
        self._pv_prev = None

    def _track(self, pv: float | None) -> None:
        # choose the integral term so that the next output equals the current one
        p = self.kp * self.error(pv) if pv is not None and math.isfinite(pv) else 0.0
        self._i = self.output - p
        self._pv_prev = pv

    def step(self, pv: float, dt: float) -> float:
        """Advance by ``dt`` seconds with measurement ``pv`` and return the output."""
        if dt <= 0:
            raise ValueError("dt must be > 0")
        if not math.isfinite(pv):
            return self.output  # bad measurement: hold the output
        if self._mode == "MAN":
            self._track(pv)
            return self.output
        e = self.error(pv)
        p = self.kp * e
        d = 0.0
        if self.td > 0 and self._pv_prev is not None:
            sign = -1.0 if self.action == "reverse" else 1.0
            d = sign * self.kp * self.td * (pv - self._pv_prev) / dt
        i = self._i
        if self.ti > 0:
            i += self.kp * dt / self.ti * e
        # anti-windup: the integral may only bring the output back inside the limits
        i = _clamp(i, self.out_min - p - d, self.out_max - p - d) if self.ti > 0 else i
        self._i = i
        self._pv_prev = pv
        self.output = _clamp(p + i + d, self.out_min, self.out_max)
        return self.output


def _opt_float() -> Any:
    return t.Float(None, allow_none=True).tag(sync=True)


class PIDFaceplate(InstrumentWidget):
    """Operator faceplate of a control loop (IND-030 .. IND-034).

    Shows the tag, the process value (PV), setpoint (SP) and output (OP) as
    bars and values, and the mode. The operator may change SP in ``AUTO``,
    OP in ``MAN`` and neither in ``CAS`` (IND-031); entries are clamped and,
    with ``confirm_delta``, large changes need a confirmation (IND-032).

    Attach a :class:`PID` as ``controller`` and call :meth:`step` with each
    new measurement: the faceplate keeps the controller's setpoint, output
    and mode in step with the operator's actions.

    >>> loop = PIDFaceplate(tag="TIC-101", unit="°C", pv_max=150, controller=PID(kp=2, ti=30))
    >>> op = loop.step(pv=72.4, dt=0.5)

    Warnings
    --------
    For teaching, simulation and prototyping; a real process needs a
    validated controller and independent protection.
    See the safety notice of the documentation (DOC-007).
    """

    _kind = t.Unicode("pidfaceplate").tag(sync=True)
    _default_size = (240, 236)
    size = size_trait(*_default_size)

    value = t.Dict(read_only=True).tag(sync=True)
    tag = t.Unicode("").tag(sync=True)
    unit = t.Unicode("").tag(sync=True)
    op_unit = t.Unicode("%").tag(sync=True)
    format = t.Unicode("%.1f").tag(sync=True)
    pv = t.Float(float("nan")).tag(sync=True, **float_serializers)
    sp = t.Float(0.0).tag(sync=True)
    op = t.Float(0.0).tag(sync=True)
    loop_mode = t.Enum(list(PID_MODES), default_value="AUTO").tag(sync=True)
    modes = t.List(t.Enum(list(PID_MODES)), default_value=["MAN", "AUTO"]).tag(sync=True)
    pv_min = t.Float(0.0).tag(sync=True)
    pv_max = t.Float(100.0).tag(sync=True)
    sp_min = _opt_float()
    sp_max = _opt_float()
    op_min = t.Float(0.0).tag(sync=True)
    op_max = t.Float(100.0).tag(sync=True)
    confirm_delta = t.Float(None, allow_none=True).tag(sync=True)
    sp_tracking = t.Bool(False).tag(sync=True)
    lolo = _opt_float()
    lo = _opt_float()
    hi = _opt_float()
    hihi = _opt_float()
    deadband = t.Float(0.0, min=0.0).tag(sync=True)
    alarm_level = t.Enum(list(ALARM_LEVELS), default_value="normal", read_only=True).tag(sync=True)

    #: Attached controller; a class default so that the observers of sp / op
    #: work while the constructor sets them (before the controller is attached).
    controller: PID | None = None

    def __init__(self, controller: PID | None = None, **kwargs: Any) -> None:
        loop_mode = kwargs.pop("loop_mode", None)
        super().__init__(**kwargs)
        self.controller = controller
        if controller is not None:
            self.sp = controller.sp
            self.op = controller.output
            if loop_mode is None:
                loop_mode = controller.mode
        if loop_mode is not None:
            if loop_mode not in self.modes:
                self.modes = [*self.modes, loop_mode]
            self.loop_mode = loop_mode
        self._publish()
        self.on_msg(self._handle_front_msg)

    @t.validate("loop_mode")
    def _check_loop_mode(self, proposal: Any) -> str:
        if proposal["value"] not in self.modes:
            raise t.TraitError(
                f"The 'loop_mode' trait of a {type(self).__name__} instance must be one of "
                f"the enabled modes {self.modes!r}, got {proposal['value']!r}"
            )
        return str(proposal["value"])

    # -- limits ---------------------------------------------------------------------
    @property
    def sp_limits(self) -> tuple[float, float]:
        lo = self.pv_min if self.sp_min is None else self.sp_min
        hi = self.pv_max if self.sp_max is None else self.sp_max
        return lo, hi

    @t.validate("sp")
    def _clamp_sp(self, proposal: Any) -> float:
        lo, hi = self.sp_limits
        return _clamp(float(proposal["value"]), lo, hi)

    @t.validate("op")
    def _clamp_op(self, proposal: Any) -> float:
        return _clamp(float(proposal["value"]), self.op_min, self.op_max)

    # -- controller coupling -----------------------------------------------------------
    @t.observe("loop_mode")
    def _on_loop_mode(self, change: Any) -> None:
        leaving_man = change["old"] == "MAN" and change["new"] != "MAN"
        if leaving_man and self.sp_tracking and math.isfinite(self.pv):
            self.sp = self.pv  # IND-034: setpoint tracking
        if self.controller is not None:
            self.controller.sp = self.sp
            self.controller.set_mode(change["new"], self.pv if math.isfinite(self.pv) else None)

    @t.observe("sp")
    def _on_sp(self, change: Any) -> None:
        if self.controller is not None:
            self.controller.sp = change["new"]

    @t.observe("op")
    def _on_op(self, change: Any) -> None:
        if self.controller is not None and self.loop_mode == "MAN":
            self.controller.set_output(change["new"])

    @t.observe("pv", "sp", "op", "loop_mode", "lolo", "lo", "hi", "hihi", "deadband")
    def _on_state(self, _change: Any) -> None:
        self._publish()

    def _publish(self) -> None:
        level = compute_alarm_level(
            self.pv,
            lolo=self.lolo,
            lo=self.lo,
            hi=self.hi,
            hihi=self.hihi,
            deadband=self.deadband,
            previous=self.alarm_level,
        )
        if level != self.alarm_level:
            self.set_trait("alarm_level", level)
        self.set_trait(
            "value", {"pv": self.pv, "sp": self.sp, "op": self.op, "mode": self.loop_mode}
        )

    def step(self, pv: float, dt: float) -> float:
        """Record a new measurement and, with a controller, compute the output."""
        with self.hold_trait_notifications():
            self.pv = float(pv)
            if self.controller is not None:
                self.controller.sp = self.sp
                self.op = self.controller.step(self.pv, dt)
        return self.op

    # -- operator actions (front end) ----------------------------------------------------
    def _reject(self, field: str, reason: str) -> None:
        self.send({"type": "rejected", "field": field, "reason": reason})

    def _handle_front_msg(self, _widget: Any, content: Any, _buffers: Any) -> None:
        if not isinstance(content, dict) or self.mode != "control" or self.disabled:
            return
        kind = content.get("type")
        if kind == "loop_mode":
            new = str(content.get("mode"))
            if new in self.modes:
                self.loop_mode = new
            else:
                self._reject("mode", f"mode {new!r} is not enabled")
        elif kind == "set":
            self.operator_set(
                str(content.get("field")),
                content.get("value"),
                confirmed=bool(content.get("confirmed")),
            )

    def operator_set(self, field: str, value: Any, *, confirmed: bool = False) -> bool:
        """Apply an operator entry with the faceplate rules (IND-031, IND-032).

        Returns ``True`` when the entry was applied.
        """
        allowed = {"sp": "AUTO", "op": "MAN"}
        if field not in allowed:
            self._reject(field, f"unknown field {field!r}")
            return False
        if self.loop_mode != allowed[field]:
            self._reject(field, f"{field.upper()} can only be changed in {allowed[field]} mode")
            return False
        try:
            v = float(value)
        except (TypeError, ValueError):
            self._reject(field, "not a number")
            return False
        if not math.isfinite(v):
            self._reject(field, "not a number")
            return False
        lo, hi = self.sp_limits if field == "sp" else (self.op_min, self.op_max)
        v = _clamp(v, lo, hi)
        old = getattr(self, field)
        if self.confirm_delta is not None and abs(v - old) > self.confirm_delta and not confirmed:
            self._reject(field, "confirmation required")
            return False
        setattr(self, field, v)
        return True
