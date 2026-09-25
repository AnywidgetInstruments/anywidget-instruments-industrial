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


# -- RecipeTable (IND-113, IND-114) ----------------------------------------------------
COLUMNS = [
    {"name": "step", "type": "text"},
    {"name": "temp", "title": "Temperature", "unit": "°C", "min": 20, "max": 90, "step": 0.5},
    {"name": "agitator", "type": "choice", "choices": ["off", "slow", "fast"]},
]


def recipe(**kw):
    return ai.RecipeTable(COLUMNS, [{"step": "Heat", "temp": 65, "agitator": "slow"}], **kw)


def sent_messages(w):
    out = []
    w.send = lambda content, buffers=None: out.append(content)
    return out


def test_recipe_columns_and_rows() -> None:
    r = recipe()
    assert r.column("temp")["default"] == 20
    assert r.value == [{"step": "Heat", "temp": 65.0, "agitator": "slow"}]
    r.add_row({"step": "Cool"})
    assert r.value[1] == {"step": "Cool", "temp": 20, "agitator": "off"}
    r.set_cell(1, "temp", 30.3)
    assert r.value[1]["temp"] == 30.5
    with pytest.raises(ValueError, match="Out of range"):
        r.set_cell(1, "temp", 95)
    with pytest.raises(t.TraitError, match="unknown columns"):
        r.value = [{"nope": 1}]
    with pytest.raises(t.TraitError, match="column 'agitator'"):
        r.value = [{"agitator": "turbo"}]
    with pytest.raises(t.TraitError, match="duplicate"):
        r.columns = ["a", "a"]
    with pytest.raises(t.TraitError, match="needs 'choices'"):
        r.columns = [{"name": "c", "type": "choice"}]
    r.delete_row(0)
    assert [row["step"] for row in r.value] == ["Cool"]


def test_recipe_columns_change_keeps_valid_cells() -> None:
    r = recipe()
    r.columns = [{"name": "temp", "min": 70, "max": 90}, {"name": "note", "type": "text"}]
    assert r.value == [{"temp": 70.0, "note": ""}]  # 65 no longer fits: default


def test_recipe_front_edits_checked_by_the_kernel() -> None:
    r = recipe(row_edit=True)
    sent = sent_messages(r)
    events = []
    r.on_edit(events.append)
    r._handle_front_msg(r, {"type": "edit", "row": 0, "column": "temp", "value": 71.2}, [])
    assert r.value[0]["temp"] == 71.0
    assert events[-1]["action"] == "edit" and events[-1]["value"] == 71.0
    r._handle_front_msg(r, {"type": "edit", "row": 0, "column": "temp", "value": 120}, [])
    assert r.value[0]["temp"] == 71.0
    assert sent[-1]["type"] == "rejected" and "Out of range" in sent[-1]["reason"]
    r._handle_front_msg(r, {"type": "edit", "row": 5, "column": "temp", "value": 50}, [])
    assert sent[-1]["reason"] == "This cell cannot be edited"
    r._handle_front_msg(r, {"type": "add"}, [])
    r._handle_front_msg(r, {"type": "delete", "row": 0}, [])
    assert [row["step"] for row in r.value] == [""]
    assert [e["action"] for e in events] == ["edit", "add", "delete"]
    # indicator mode or no row editing: ignored
    r.row_edit = False
    r._handle_front_msg(r, {"type": "add"}, [])
    r.mode = "indicator"
    r._handle_front_msg(r, {"type": "edit", "row": 0, "column": "temp", "value": 50}, [])
    assert len(r.value) == 1 and r.value[0]["temp"] == 20


def test_recipe_readonly_column() -> None:
    r = ai.RecipeTable([{"name": "id", "type": "text", "readonly": True}], [{"id": "A"}])
    sent = sent_messages(r)
    r._handle_front_msg(r, {"type": "edit", "row": 0, "column": "id", "value": "B"}, [])
    assert r.value[0]["id"] == "A" and sent[-1]["type"] == "rejected"


def test_setpoint_pointer_of_gauge_and_meter():
    # IND-116: an optional setpoint, None by default, synced to the front end.
    for cls in (ai.Gauge, ai.Meter):
        w = cls(40.0, max=100)
        assert w.setpoint is None
        w.setpoint = 60
        assert w.setpoint == 60.0
        assert "setpoint" in w.keys
