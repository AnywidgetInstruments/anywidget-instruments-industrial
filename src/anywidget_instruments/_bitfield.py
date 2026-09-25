"""BitField: an integer word shown as a row of indicators (IND-111, IND-112)."""

from __future__ import annotations

from typing import Any

import traitlets as t

from ._base import InstrumentWidget, mode_trait, size_trait

#: Word sizes of a BitField.
WORD_SIZES: tuple[int, ...] = (8, 16, 32)


class BitField(InstrumentWidget):
    """A status or fault word shown as a row of indicators, one per bit (IND-111).

    ``value`` is the word, an integer in ``[0, 2**bits)``; bit 0 is the least
    significant bit. ``labels[k]`` names bit ``k`` (bits without a label are
    shown dimmed) and ``colors[k]`` gives its on color (default ``on_color``).
    The bits are drawn most significant first, as a register is written, unless
    ``msb_first`` is False; the word is also shown in hexadecimal.

    In control mode, clicking a bit (or Space / Enter on it) toggles that bit
    and sends the new word (IND-112).

    >>> status = BitField(0x0013, bits=8, labels=["Ready", "Running", "", "", "Fault"])
    >>> status.bit(4)
    True
    >>> status.active_labels()
    ['Ready', 'Running', 'Fault']
    """

    _kind = t.Unicode("bitfield").tag(sync=True)
    _default_mode = "indicator"
    _default_size = (520, 76)
    mode = mode_trait(_default_mode)
    size = size_trait(*_default_size)

    value = t.Int(0, min=0).tag(sync=True)
    bits = t.Enum(list(WORD_SIZES), default_value=16).tag(sync=True)
    labels = t.List(t.Unicode()).tag(sync=True)
    colors = t.List(t.Unicode()).tag(sync=True)
    on_color = t.Unicode("#22c55e").tag(sync=True)
    msb_first = t.Bool(True).tag(sync=True)
    show_hex = t.Bool(True).tag(sync=True)

    def __init__(self, value: int | None = None, **kwargs: Any) -> None:
        if value is not None:
            kwargs["value"] = value
        super().__init__(**kwargs)

    @t.validate("value")
    def _check_value(self, proposal: Any) -> int:
        v = int(proposal["value"])
        if not 0 <= v < 1 << self.bits:
            raise t.TraitError(
                f"The 'value' trait of a BitField instance must be between 0 and "
                f"{(1 << self.bits) - 1} ({self.bits} bits), got {v}"
            )
        return v

    @t.validate("bits")
    def _check_bits(self, proposal: Any) -> int:
        bits = int(proposal["value"])
        if self.value >= 1 << bits:
            raise t.TraitError(
                f"The 'bits' trait of a BitField instance: the value {self.value} "
                f"does not fit in {bits} bits"
            )
        return bits

    def _index(self, n: int) -> int:
        if not 0 <= n < self.bits:
            raise IndexError(f"bit {n} is outside a {self.bits}-bit word")
        return n

    def bit(self, n: int) -> bool:
        """State of bit ``n`` (0 is the least significant bit)."""
        return bool(self.value >> self._index(n) & 1)

    def set_bit(self, n: int, on: bool = True) -> None:
        """Set (or clear, with ``on=False``) bit ``n``."""
        mask = 1 << self._index(n)
        self.value = self.value | mask if on else self.value & ~mask

    def toggle_bit(self, n: int) -> None:
        """Invert bit ``n``, as a click on it does in control mode (IND-112)."""
        self.value = self.value ^ 1 << self._index(n)

    def active_bits(self) -> list[int]:
        """Numbers of the bits that are set, least significant first."""
        return [n for n in range(self.bits) if self.value >> n & 1]

    def active_labels(self) -> list[str]:
        """Labels of the bits that are set (``bit <n>`` for a bit without a label)."""
        labels = self.labels
        return [
            labels[n] if n < len(labels) and labels[n] else f"bit {n}" for n in self.active_bits()
        ]
