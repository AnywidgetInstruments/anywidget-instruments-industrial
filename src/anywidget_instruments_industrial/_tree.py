"""EquipmentTree: a hierarchy of equipment with a status per node (IND-119)."""

from __future__ import annotations

from typing import Any

import traitlets as t

from ._base import InstrumentWidget, mode_trait, size_trait

#: Node statuses, from the least to the most severe (the order of the roll-up).
NODE_STATUSES: tuple[str, ...] = (
    "",
    "normal",
    "running",
    "stopped",
    "offline",
    "maintenance",
    "warning",
    "alarm",
    "fault",
)


def flatten_tree(nodes: Any, owner: str = "EquipmentTree") -> list[dict[str, Any]]:
    """Nodes in display order, each ``{id, label, level, status, depth, parent, children}``.

    A node without an ``id`` gets the path of labels from the root
    (``"Plant/Area 1/Mixer"``). Raises ValueError for a node without a label,
    an unknown status or a repeated id.
    """
    out: list[dict[str, Any]] = []
    seen: set[str] = set()

    def walk(items: Any, depth: int, parent: str) -> list[str]:
        if not isinstance(items, (list, tuple)):
            raise ValueError(f"{owner}: 'children' must be a list, got {items!r}")
        ids: list[str] = []
        for raw in items:
            if not isinstance(raw, dict) or not isinstance(raw.get("label"), str):
                raise ValueError(f"{owner}: each node needs a 'label', got {raw!r}")
            label = raw["label"]
            node_id = raw.get("id")
            if node_id is None or node_id == "":
                node_id = f"{parent}/{label}" if parent else label
            node_id = str(node_id)
            status = raw.get("status", "")
            if status not in NODE_STATUSES:
                raise ValueError(
                    f"{owner}: status of node {node_id!r} must be one of {NODE_STATUSES[1:]}, "
                    f"got {status!r}"
                )
            if node_id in seen:
                raise ValueError(f"{owner}: two nodes have the id {node_id!r}")
            seen.add(node_id)
            node = {
                "id": node_id,
                "label": label,
                "level": str(raw.get("level", "")),
                "status": status,
                "depth": depth,
                "parent": parent,
                "children": [],
            }
            out.append(node)
            node["children"] = walk(raw.get("children", []), depth + 1, node_id)
            ids.append(node_id)
        return ids

    walk(nodes, 0, "")
    return out


def rollup_status(flat: list[dict[str, Any]], node_id: str) -> str:
    """Most severe status of a node and of all the nodes below it."""
    by_id = {n["id"]: n for n in flat}
    rank = {s: i for i, s in enumerate(NODE_STATUSES)}
    worst = ""
    stack = [node_id]
    while stack:
        n = by_id[stack.pop()]
        if rank[n["status"]] > rank[worst]:
            worst = n["status"]
        stack.extend(n["children"])
    return worst


def visible_ids(flat: list[dict[str, Any]], expanded: list[str]) -> list[str]:
    """Ids of the rows shown: the roots and the children of expanded, shown nodes."""
    open_ = set(expanded)
    shown: set[str] = set()
    out = []
    for n in flat:
        if n["parent"] == "" or (n["parent"] in shown and n["parent"] in open_):
            shown.add(n["id"])
            out.append(n["id"])
    return out


class EquipmentTree(InstrumentWidget):
    """A hierarchy of equipment with a status per node (IND-119).

    ``nodes`` is a list of nested dicts ``{"label", "id", "level", "status",
    "children"}``: a plant model such as enterprise / site / area / unit /
    equipment module (IEC 62264, IEC 61512), or any other hierarchy. Only
    ``label`` is required; a node without ``id`` gets the path of labels from
    the root. ``level`` is shown next to the label; ``status`` is one of
    :data:`NODE_STATUSES` and is shown as a symbol and a word, not only a
    color. A collapsed node also shows the most severe status below it.

    The operator expands and collapses nodes (``expanded``, the ids of the
    open nodes) and selects one (``value``, its id, ``""`` for none), with the
    mouse or the keyboard (arrows, Home, End, Enter). Observe ``value`` with
    :meth:`on_change` to follow the selection.

    Examples
    --------
    >>> tree = EquipmentTree(
    ...     nodes=[
    ...         {"label": "Plant", "level": "site", "children": [
    ...             {"label": "Mixing", "level": "area", "children": [
    ...                 {"label": "Mixer M-101", "level": "unit", "status": "running"},
    ...                 {"label": "Pump P-102", "level": "equipment", "status": "alarm"},
    ...             ]},
    ...         ]},
    ...     ],
    ... )
    >>> tree.rollup("Plant")
    'alarm'
    >>> tree.select("Plant/Mixing/Pump P-102")
    >>> tree.expanded
    ['Plant', 'Plant/Mixing']
    """

    _kind = t.Unicode("equipmenttree").tag(sync=True)
    _default_mode = "control"
    _default_size = (320, 280)
    mode = mode_trait(_default_mode)
    size = size_trait(*_default_size)

    #: Id of the selected node, ``""`` for none.
    value = t.Unicode("").tag(sync=True)
    nodes = t.List(t.Dict()).tag(sync=True)
    #: Ids of the expanded nodes.
    expanded = t.List(t.Unicode()).tag(sync=True)
    show_level = t.Bool(True).tag(sync=True)

    def _flat(self) -> list[dict[str, Any]]:
        return flatten_tree(self.nodes, type(self).__name__)

    @t.validate("nodes")
    def _check_nodes(self, proposal: Any) -> list[dict[str, Any]]:
        try:
            flatten_tree(proposal["value"], type(self).__name__)
        except ValueError as exc:
            raise t.TraitError(str(exc)) from exc
        return list(proposal["value"])

    @t.validate("value")
    def _check_value(self, proposal: Any) -> str:
        v = str(proposal["value"])
        if v and v not in self.ids():
            raise t.TraitError(f"EquipmentTree: no node with the id {v!r}")
        return v

    @t.observe("nodes")
    def _on_nodes(self, _change: Any) -> None:
        ids = set(self.ids())
        if self.value and self.value not in ids:
            self.value = ""
        kept = [i for i in self.expanded if i in ids]
        if kept != self.expanded:
            self.expanded = kept

    # -- queries -----------------------------------------------------------------
    def ids(self) -> list[str]:
        """Ids of every node, in display order."""
        return [n["id"] for n in self._flat()]

    def node(self, node_id: str) -> dict[str, Any]:
        """``{id, label, level, status, depth, parent, children}`` of a node."""
        for n in self._flat():
            if n["id"] == node_id:
                return n
        raise KeyError(f"no node {node_id!r} in this EquipmentTree")

    def path(self, node_id: str) -> list[str]:
        """Ids from the root down to ``node_id``."""
        out = []
        n: dict[str, Any] | None = self.node(node_id)
        while n is not None:
            out.append(n["id"])
            n = self.node(n["parent"]) if n["parent"] else None
        return out[::-1]

    def rollup(self, node_id: str) -> str:
        """Most severe status of ``node_id`` and of the nodes below it."""
        self.node(node_id)
        return rollup_status(self._flat(), node_id)

    def shown(self) -> list[str]:
        """Ids of the rows shown with the current ``expanded``."""
        return visible_ids(self._flat(), self.expanded)

    # -- actions -------------------------------------------------------------------
    def select(self, node_id: str) -> None:
        """Select a node and expand its ancestors so that it is shown."""
        ancestors = self.path(node_id)[:-1]
        self.expanded = self.expanded + [a for a in ancestors if a not in self.expanded]
        self.value = node_id

    def expand(self, node_id: str) -> None:
        self.node(node_id)
        if node_id not in self.expanded:
            self.expanded = [*self.expanded, node_id]

    def collapse(self, node_id: str) -> None:
        self.expanded = [i for i in self.expanded if i != node_id]

    def expand_all(self) -> None:
        self.expanded = [n["id"] for n in self._flat() if n["children"]]

    def collapse_all(self) -> None:
        self.expanded = []

    def set_status(self, node_id: str, status: str) -> None:
        """Set the status of a node (one of :data:`NODE_STATUSES`)."""
        self.node(node_id)
        if status not in NODE_STATUSES:
            raise t.TraitError(f"EquipmentTree: status must be one of {NODE_STATUSES[1:]}")
        self.nodes = _with_status(self.nodes, node_id, status, "")


def _with_status(items: list[Any], node_id: str, status: str, parent: str) -> list[Any]:
    out = []
    for raw in items:
        own = raw.get("id") or (f"{parent}/{raw['label']}" if parent else raw["label"])
        node = dict(raw)
        if own == node_id:
            node["status"] = status
        if raw.get("children"):
            node["children"] = _with_status(raw["children"], node_id, status, str(own))
        out.append(node)
    return out
