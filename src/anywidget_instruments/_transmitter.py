"""Transmitter: instrument bubble with a device status (IND-080 .. IND-083)."""

from __future__ import annotations

from typing import Any

import traitlets as t

from ._base import mode_trait, size_trait
from ._numeric import NumericWidget

#: Device status categories (after NAMUR NE 107), ``"ok"`` meaning normal.
DEVICE_STATUSES: tuple[str, ...] = ("ok", "failure", "check", "out_of_spec", "maintenance")


class Transmitter(NumericWidget):
    """Field transmitter shown as an instrument bubble (IND-080 .. IND-083).

    The bubble carries the ``tag`` (for example ``"LT-101"``: function letters
    above the line, loop number below, in the manner of ISA-5.1); the measured
    value and its unit are shown beside it. ``status`` is the device status:
    ``"ok"``, ``"failure"``, ``"check"`` (function check), ``"out_of_spec"``
    or ``"maintenance"`` (maintenance required), the categories of NAMUR
    NE 107, each shown by its own symbol and text as well as color (IND-081).
    While the status is ``"failure"`` the value is marked invalid (IND-082).
    Alarm limits (``lo``, ``hi`` ...) work as on the other numeric widgets.

    >>> lt = Transmitter(2.4, tag="LT-101", unit="m", max=4, hi=3.2)
    >>> lt.status = "maintenance"
    """

    _kind = t.Unicode("transmitter").tag(sync=True)
    _default_mode = "indicator"
    _default_size = (110, 84)
    mode = mode_trait(_default_mode)
    size = size_trait(*_default_size)
    tag = t.Unicode("").tag(sync=True)
    status = t.Enum(list(DEVICE_STATUSES), default_value="ok").tag(sync=True)
    #: Optional detail of the status (for example the diagnostic message).
    status_text = t.Unicode("").tag(sync=True)
    format = t.Unicode("%.2f").tag(sync=True)

    def __init__(self, value: Any = None, **kwargs: Any) -> None:
        super().__init__(value, **kwargs)

    @property
    def valid(self) -> bool:
        """False while the device reports a failure: the value must not be used."""
        return self.status != "failure"
