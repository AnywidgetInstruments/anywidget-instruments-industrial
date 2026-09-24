"""Operator panel objects: AnalogIndicator, SelectorSwitch, StackLight (IND-001 .. IND-022)."""

from __future__ import annotations

from typing import Any

import traitlets as t

from ._base import InstrumentWidget
from ._numeric import NumericWidget

STACK_COLORS: tuple[str, ...] = ("red", "amber", "green", "blue", "white")
STACK_STATES: tuple[str, ...] = ("off", "on", "blink")


class AnalogIndicator(NumericWidget):
    """High-performance analog bar indicator (IND-001 .. IND-003, ISA-101).

    The value is a pointer on a neutral grey scale. ``normal_lo`` and
    ``normal_hi`` shade the normal operating range, alarm limits are marked on
    the scale and ``target`` marks the desired value. Color appears only while
    an alarm level is active, so that an abnormal situation stands out.
    """

    _kind = t.Unicode("analogindicator").tag(sync=True)
    _default_mode = "indicator"
    _default_size = (240, 56)
    orientation = t.Enum(["horizontal", "vertical"], default_value="horizontal").tag(sync=True)
    normal_lo = t.Float(None, allow_none=True).tag(sync=True)
    normal_hi = t.Float(None, allow_none=True).tag(sync=True)
    target = t.Float(None, allow_none=True).tag(sync=True)
    show_limits = t.Bool(True).tag(sync=True)

    def __init__(self, value: Any = None, **kwargs: Any) -> None:
        if kwargs.get("orientation") == "vertical":
            kwargs.setdefault("size", (70, 220))
        super().__init__(value, **kwargs)


class SelectorSwitch(InstrumentWidget):
    """Rotary selector with 2 to 5 labelled positions (IND-010 .. IND-013).

    ``value`` is the label of the selected position. With ``keyed=True`` and
    ``locked=True`` the front end cannot move it (key switch); the kernel still
    can. Positions listed in ``spring_return`` go back to ``default_position``
    when the operator releases the switch.
    """

    _kind = t.Unicode("selectorswitch").tag(sync=True)
    _default_size = (140, 130)
    value = t.Unicode("").tag(sync=True)
    positions = t.List(t.Unicode(), default_value=["HAND", "OFF", "AUTO"]).tag(sync=True)
    keyed = t.Bool(False).tag(sync=True)
    locked = t.Bool(False).tag(sync=True)
    default_position = t.Unicode(None, allow_none=True).tag(sync=True)
    spring_return = t.List(t.Unicode()).tag(sync=True)

    def __init__(self, value: str | None = None, **kwargs: Any) -> None:
        positions = kwargs.pop("positions", None)
        super().__init__()
        if positions is not None:
            self.positions = positions
        for key, val in kwargs.items():
            setattr(self, key, val)
        if value is not None:
            self.value = value
        elif not self.value:
            self.value = self.default_position or self.positions[len(self.positions) // 2]

    @t.validate("positions")
    def _check_positions(self, proposal: Any) -> list[str]:
        pos = list(proposal["value"])
        if not 2 <= len(pos) <= 5 or len(set(pos)) != len(pos):
            raise t.TraitError(
                f"The 'positions' trait of a {type(self).__name__} instance needs 2 to 5 "
                f"distinct labels, got {pos!r}"
            )
        return pos

    @t.validate("value")
    def _check_value(self, proposal: Any) -> str:
        v = proposal["value"]
        if v not in self.positions:
            raise t.TraitError(
                f"The 'value' trait of a {type(self).__name__} instance must be one of "
                f"{self.positions!r}, got {v!r}"
            )
        return str(v)

    @t.validate("default_position")
    def _check_default(self, proposal: Any) -> str | None:
        v = proposal["value"]
        if v is not None and v not in self.positions:
            raise t.TraitError(
                f"The 'default_position' trait of a {type(self).__name__} instance must be "
                f"one of {self.positions!r}, got {v!r}"
            )
        return v

    @property
    def index(self) -> int:
        """Position index of the current value."""
        return self.positions.index(self.value)

    def set_state(self, sync_data: Any) -> None:
        # IND-012: a locked key switch ignores the front end
        if self.keyed and self.locked and "value" in sync_data:
            sync_data = {k: v for k, v in sync_data.items() if k != "value"}
            self.send_state("value")  # put the view back on the kernel position
        if sync_data:
            super().set_state(sync_data)


class StackLight(InstrumentWidget):
    """Signal tower with 1 to 5 tiers (IND-020 .. IND-022, IEC 60073 colors).

    ``tiers`` lists the tier colors from top to bottom and ``labels`` their
    meaning; ``value`` holds the state of each tier (``"off"``, ``"on"``,
    ``"blink"``). ``buzzer`` shows a sounding indicator (no sound is played).

    >>> light = StackLight(tiers=["red", "amber", "green"], labels=["Fault", "Warning", "Run"])
    >>> light.set("green", "on")
    """

    _kind = t.Unicode("stacklight").tag(sync=True)
    _default_mode = "indicator"
    _default_size = (120, 200)
    tiers = t.List(t.Enum(list(STACK_COLORS)), default_value=["red", "amber", "green"]).tag(
        sync=True
    )
    labels = t.List(t.Unicode()).tag(sync=True)
    value = t.List(t.Enum(list(STACK_STATES))).tag(sync=True)
    buzzer = t.Bool(False).tag(sync=True)

    def __init__(self, **kwargs: Any) -> None:
        tiers = kwargs.pop("tiers", None)
        value = kwargs.pop("value", None)
        super().__init__(**kwargs)
        if tiers is not None:
            self.tiers = tiers
        self.value = value if value is not None else ["off"] * len(self.tiers)

    @t.validate("tiers")
    def _check_tiers(self, proposal: Any) -> list[str]:
        if not 1 <= len(proposal["value"]) <= 5:
            raise t.TraitError(
                f"The 'tiers' trait of a {type(self).__name__} instance needs 1 to 5 tiers"
            )
        return list(proposal["value"])

    @t.observe("tiers")
    def _resize(self, change: Any) -> None:
        n = len(change["new"])
        self.value = (list(self.value) + ["off"] * n)[:n]

    @t.validate("value")
    def _check_value(self, proposal: Any) -> list[str]:
        v = list(proposal["value"])
        if len(v) != len(self.tiers):
            raise t.TraitError(
                f"The 'value' trait of a {type(self).__name__} instance needs one state per "
                f"tier ({len(self.tiers)}), got {len(v)}"
            )
        return v

    def _index(self, tier: int | str) -> int:
        if isinstance(tier, str):
            if tier not in self.tiers:
                raise ValueError(f"no {tier!r} tier in {self.tiers!r}")
            return self.tiers.index(tier)
        if not 0 <= tier < len(self.tiers):
            raise IndexError(f"tier {tier} out of range")
        return tier

    def set(self, tier: int | str, state: str) -> None:
        """Set a tier (index, or color of the first tier with that color) to ``state``."""
        if state not in STACK_STATES:
            raise ValueError(f"state must be one of {STACK_STATES}, got {state!r}")
        states = list(self.value)
        states[self._index(tier)] = state
        self.value = states

    def get(self, tier: int | str) -> str:
        return str(self.value[self._index(tier)])

    def all_off(self) -> None:
        self.value = ["off"] * len(self.tiers)
