"""Pure functions for alarm limits and engineering scaling (ALARM-*, UNIT-003)."""

from __future__ import annotations

import math

ALARM_LEVELS: tuple[str, ...] = ("normal", "lo", "lolo", "hi", "hihi")

_HIGH = ("normal", "hi", "hihi")
_LOW = ("normal", "lo", "lolo")


def _raw_level(
    value: float, lolo: float | None, lo: float | None, hi: float | None, hihi: float | None
) -> str:
    if hihi is not None and value >= hihi:
        return "hihi"
    if hi is not None and value >= hi:
        return "hi"
    if lolo is not None and value <= lolo:
        return "lolo"
    if lo is not None and value <= lo:
        return "lo"
    return "normal"


def compute_alarm_level(
    value: float,
    *,
    lolo: float | None = None,
    lo: float | None = None,
    hi: float | None = None,
    hihi: float | None = None,
    deadband: float = 0.0,
    previous: str = "normal",
) -> str:
    """Return the alarm level of ``value``.

    Entering a more severe level is immediate. Leaving a level requires the
    value to move back beyond that level's limit by at least ``deadband``
    (ALARM-003). A non-finite value keeps the previous level.
    """
    if not math.isfinite(value):
        return previous
    raw = _raw_level(value, lolo, lo, hi, hihi)
    limits = {"lolo": lolo, "lo": lo, "hi": hi, "hihi": hihi}

    for side, sign in ((_HIGH, 1.0), (_LOW, -1.0)):
        if previous in side[1:] and raw in side and side.index(raw) < side.index(previous):
            level = previous
            while side.index(level) > side.index(raw):
                limit = limits[level]
                # still inside the band around the limit -> stay in this level
                if limit is not None and sign * (value - limit) > -deadband:
                    return level
                level = side[side.index(level) - 1]
            return raw
    return raw


def eng_scale(raw: float, raw_min: float, raw_max: float, eng_min: float, eng_max: float) -> float:
    """Linear conversion of a raw value (e.g. 4-20 mA, ADC counts) to engineering units."""
    if raw_max == raw_min:
        raise ValueError("raw_min and raw_max must differ")
    return eng_min + (raw - raw_min) * (eng_max - eng_min) / (raw_max - raw_min)
