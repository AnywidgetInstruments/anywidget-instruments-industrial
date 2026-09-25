"""Registers, recipes and plant structure (IND-110 .. IND-119)."""

from __future__ import annotations

import pytest
import traitlets as t

import anywidget_instruments as ai


# -- BitField (IND-111, IND-112) -------------------------------------------------------
def test_bitfield_bits_and_labels() -> None:
    w = ai.BitField(0x13, bits=8, labels=["Ready", "Running", "", "", "Fault"])
    assert [w.bit(n) for n in range(8)] == [True, True, False, False, True, False, False, False]
    assert w.active_bits() == [0, 1, 4]
    assert w.active_labels() == ["Ready", "Running", "Fault"]
    w.set_bit(7)
    assert w.value == 0x93
    w.set_bit(0, False)
    assert w.value == 0x92
    w.toggle_bit(4)
    assert w.value == 0x82
    assert w.active_labels() == ["Running", "bit 7"]


def test_bitfield_range() -> None:
    w = ai.BitField(bits=8)
    with pytest.raises(t.TraitError, match="between 0 and 255"):
        w.value = 256
    with pytest.raises(t.TraitError):
        w.value = -1
    with pytest.raises(IndexError):
        w.bit(8)
    w.value = 0xFF
    with pytest.raises(t.TraitError, match="does not fit"):
        ai.BitField(0x1FF, bits=16).bits = 8
    big = ai.BitField(0xFFFFFFFF, bits=32)
    assert big.bit(31)
    w.bits = 16
    w.value = 0xFFFF


def test_bitfield_front_toggle_and_callback() -> None:
    w = ai.BitField(0, bits=16, mode="control")
    seen = []
    w.on_change(lambda e: seen.append(e["new"]))
    w.set_state({"value": 0x8000})
    assert w.value == 0x8000 and seen == [0x8000]
