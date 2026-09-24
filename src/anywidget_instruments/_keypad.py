"""NumericEntry: touch-friendly numeric keypad (IND-104)."""

from __future__ import annotations

from typing import Any

import traitlets as t

from ._base import mode_trait, size_trait
from ._numeric import NumericWidget


class NumericEntry(NumericWidget):
    """Numeric keypad with a display, for touch panels (IND-104).

    The operator types a value on the keys (or the keyboard): Enter commits
    it after the range check of the numeric widgets (NUM-010), Escape
    discards it. Where ``confirm_delta`` is set, a change larger than
    ``confirm_delta`` asks for a confirmation (a second Enter). The kernel
    rejects values outside ``min`` .. ``max`` as for every numeric control.

    >>> sp = NumericEntry(2.2, min=0, max=4, unit="m", label="Level setpoint")
    """

    _kind = t.Unicode("numericentry").tag(sync=True)
    _default_mode = "control"
    _default_size = (180, 230)
    mode = mode_trait(_default_mode)
    size = size_trait(*_default_size)
    confirm_delta = t.Float(None, allow_none=True).tag(sync=True)
    format = t.Unicode("%.2f").tag(sync=True)

    def __init__(self, value: Any = None, **kwargs: Any) -> None:
        super().__init__(value, **kwargs)
