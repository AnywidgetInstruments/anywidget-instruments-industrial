"""EquipmentTree (IND-119)."""

from __future__ import annotations

import pytest
import traitlets as t

import anywidget_instruments as ai

NODES = [
    {
        "label": "Plant",
        "level": "site",
        "children": [
            {
                "label": "Mixing",
                "level": "area",
                "children": [
                    {"label": "Mixer M-101", "status": "running"},
                    {"id": "P-102", "label": "Pump P-102", "status": "alarm"},
                ],
            },
        ],
    },
    {"label": "Utilities", "status": "warning"},
]


def test_ids_paths_and_rollup():
    tree = ai.EquipmentTree(nodes=NODES)
    assert tree.mode == "control"
    assert tree.ids() == ["Plant", "Plant/Mixing", "Plant/Mixing/Mixer M-101", "P-102", "Utilities"]
    assert tree.path("P-102") == ["Plant", "Plant/Mixing", "P-102"]
    assert tree.node("P-102")["depth"] == 2
    assert tree.rollup("Plant") == "alarm"
    assert tree.shown() == ["Plant", "Utilities"]


def test_select_expands_the_ancestors():
    tree = ai.EquipmentTree(nodes=NODES)
    tree.select("P-102")
    assert tree.value == "P-102"
    assert tree.expanded == ["Plant", "Plant/Mixing"]
    tree.collapse("Plant")
    assert tree.shown() == ["Plant", "Utilities"]
    tree.expand_all()
    assert tree.expanded == ["Plant", "Plant/Mixing"]
    tree.collapse_all()
    assert tree.expanded == []


def test_value_and_expanded_follow_the_nodes():
    tree = ai.EquipmentTree(nodes=NODES, value="Utilities", expanded=["Plant"])
    with pytest.raises(t.TraitError, match="no node"):
        tree.value = "nowhere"
    tree.nodes = NODES[:1]
    assert tree.value == ""
    assert tree.expanded == ["Plant"]
    tree.nodes = [{"label": "Other"}]
    assert tree.expanded == []


def test_status_changes_and_errors():
    tree = ai.EquipmentTree(nodes=NODES)
    tree.set_status("P-102", "normal")
    assert tree.rollup("Plant") == "running"
    assert tree.node("P-102")["status"] == "normal"
    with pytest.raises(t.TraitError):
        tree.set_status("P-102", "broken")
    for bad in (
        [{"label": "A", "status": "broken"}],
        [{"label": "A"}, {"label": "A"}],
        [{"id": "x"}],
        [{"label": "A", "children": "B"}],
    ):
        with pytest.raises(t.TraitError):
            ai.EquipmentTree(nodes=bad)


def test_selection_reaches_callbacks():
    tree = ai.EquipmentTree(nodes=NODES)
    seen = []
    tree.on_change(lambda change: seen.append(change["new"]))
    tree.set_state({"value": "Utilities"})
    assert seen == ["Utilities"]
