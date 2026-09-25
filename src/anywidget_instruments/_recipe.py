"""RecipeTable: a table of typed columns edited by the operator (IND-113, IND-114)."""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

import traitlets as t

from . import _dispatch
from ._base import Callback, InstrumentWidget, size_trait

#: Column types of a RecipeTable.
COLUMN_TYPES: tuple[str, ...] = ("number", "choice", "bool", "text")

#: Keys of a column description.
COLUMN_KEYS: tuple[str, ...] = (
    "name",
    "title",
    "type",
    "unit",
    "min",
    "max",
    "step",
    "format",
    "choices",
    "readonly",
    "default",
)


def _opt(v: Any) -> float | None:
    if v is None:
        return None
    f = float(v)
    return f if math.isfinite(f) else None


def normalize_column(raw: Any, index: int = 0) -> dict[str, Any]:
    """Column with every key set: a string is a number column of that name.

    Raises ``ValueError`` for an invalid column (no name, unknown type or
    key, ``max < min``, a choice column without choices, an invalid default).
    """
    col = {"name": raw} if isinstance(raw, str) else raw
    if not isinstance(col, Mapping) or not str(col.get("name") or ""):
        raise ValueError(f"column {index} needs a 'name'")
    name = str(col["name"])
    unknown = set(col) - set(COLUMN_KEYS)
    if unknown:
        raise ValueError(f"column {name!r}: unknown keys {sorted(unknown)}")
    kind = str(col.get("type") or "number")
    if kind not in COLUMN_TYPES:
        raise ValueError(f"column {name!r}: type must be one of {COLUMN_TYPES}, got {kind!r}")
    lo, hi = _opt(col.get("min")), _opt(col.get("max"))
    if lo is not None and hi is not None and not hi >= lo:
        raise ValueError(f"column {name!r} needs max >= min, got {lo} .. {hi}")
    choices = [str(c) for c in col.get("choices") or []]
    if kind == "choice" and not choices:
        raise ValueError(f"choice column {name!r} needs 'choices'")
    out: dict[str, Any] = {
        "name": name,
        "title": str(col.get("title") or name),
        "type": kind,
        "unit": str(col.get("unit") or ""),
        "min": lo,
        "max": hi,
        "step": max(0.0, _opt(col.get("step")) or 0.0),
        "format": str(col.get("format") or "%.4g"),
        "choices": choices,
        "readonly": bool(col.get("readonly", False)),
    }
    out["default"] = type_default(out) if col.get("default") is None else col["default"]
    ok, value = check_cell(out, out["default"])
    if not ok:
        raise ValueError(f"column {name!r}: invalid default ({value})")
    out["default"] = value
    return out


def type_default(col: Mapping[str, Any]) -> Any:
    """Value of a new cell: the first choice, False, "" or 0 brought into the limits."""
    if col["type"] == "choice":
        return col["choices"][0]
    if col["type"] == "bool":
        return False
    if col["type"] == "text":
        return ""
    v = 0.0
    if col["min"] is not None:
        v = max(v, col["min"])
    if col["max"] is not None:
        v = min(v, col["max"])
    return v


def check_cell(col: Mapping[str, Any], value: Any) -> tuple[bool, Any]:
    """Check a cell value against its column (IND-113).

    Returns ``(True, value)`` with the value as stored (numbers snapped to
    ``step``), or ``(False, reason)``. Numbers follow the rules of the numeric
    entry fields (NUM-010): finite, inside [min, max], snapped to ``step``.
    """
    kind = col["type"]
    if kind == "bool":
        return (True, value) if isinstance(value, bool) else (False, "Not a Boolean")
    if kind == "text":
        return (True, value) if isinstance(value, str) else (False, "Not a text")
    if kind == "choice":
        if value in col["choices"]:
            return True, value
        return False, f"Not one of {', '.join(col['choices'])}"
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False, "Not a number"
    v = float(value)
    if not math.isfinite(v):
        return False, "Not a finite number"
    lo, hi, step = col["min"], col["max"], col["step"]
    if (lo is not None and v < lo) or (hi is not None and v > hi):
        return False, f"Out of range: {_range_text(lo, hi, col['unit'])}"
    if step > 0:
        base = lo if lo is not None else 0.0
        v = base + math.floor((v - base) / step + 0.5) * step  # halves up, as the front end
        v = max(v, lo) if lo is not None else v
        v = min(v, hi) if hi is not None else v
        v = float(f"{v:.12g}")  # binary noise such as 0.30000000000000004
    return True, v


def _range_text(lo: float | None, hi: float | None, unit: str) -> str:
    u = f" {unit}" if unit else ""
    if lo is not None and hi is not None:
        return f"enter a value between {lo:g} and {hi:g}{u}"
    return (
        f"enter a value of at least {lo:g}{u}"
        if lo is not None
        else f"enter a value of at most {hi:g}{u}"
    )


class RecipeTable(InstrumentWidget):
    """A table of typed columns whose rows the operator edits (IND-113, IND-114).

    ``columns`` describes the columns: ``{"name", "title", "type", "unit",
    "min", "max", "step", "format", "choices", "readonly", "default"}`` with
    ``type`` one of ``"number"`` (unit, limits, step, display format),
    ``"choice"`` (one of ``choices``), ``"bool"`` or ``"text"``; only ``name``
    is required, and a string is a number column of that name. ``value`` is
    the list of rows, each a dict keyed by column name.

    In control mode the operator edits the cells: each edit is checked
    against its column (the numeric rules of NUM-010) in the front end and
    again here; a rejected edit leaves the row unchanged and shows the reason.
    With ``row_edit`` the operator can also add and delete rows (at most
    ``max_rows``). Clicking a column title sorts the displayed rows (IND-114);
    ``value`` keeps its order.

    Examples
    --------
    >>> recipe = RecipeTable(
    ...     columns=[{"name": "step", "type": "text"},
    ...              {"name": "temp", "title": "Temperature", "unit": "°C", "min": 20, "max": 90},
    ...              {"name": "agitator", "type": "choice", "choices": ["off", "slow", "fast"]}],
    ...     value=[{"step": "Heat", "temp": 65, "agitator": "slow"}])
    >>> recipe.set_cell(0, "temp", 70)
    >>> recipe.value[0]["temp"]
    70.0
    """

    _kind = t.Unicode("recipetable").tag(sync=True)
    _default_size = (560, 220)
    size = size_trait(*_default_size)

    columns = t.List(t.Union([t.Dict(), t.Unicode()])).tag(sync=True)
    value = t.List(t.Dict()).tag(sync=True)
    row_edit = t.Bool(False).tag(sync=True)
    max_rows = t.Int(100, min=1).tag(sync=True)

    def __init__(self, columns: Any = None, value: Any = None, **kwargs: Any) -> None:
        if columns is not None:
            kwargs["columns"] = list(columns)
        if value is not None:
            kwargs["value"] = list(value)
        super().__init__(**kwargs)
        self._edit_callbacks: list[Callback] = []
        self.on_msg(self._handle_front_msg)

    # -- validation ---------------------------------------------------------------
    def _columns(self) -> list[dict[str, Any]]:
        # normalized even while the constructor defers the validation of columns
        # (normalize_column is idempotent)
        return [normalize_column(c, i) for i, c in enumerate(self.columns)]

    @t.validate("columns")
    def _check_columns(self, proposal: Any) -> list[dict[str, Any]]:
        cols = []
        for i, raw in enumerate(proposal["value"]):
            try:
                cols.append(normalize_column(raw, i))
            except (ValueError, TypeError) as exc:
                raise t.TraitError(f"The 'columns' trait of a RecipeTable instance: {exc}") from exc
        names = [c["name"] for c in cols]
        if len(set(names)) != len(names):
            raise t.TraitError("The 'columns' trait of a RecipeTable instance: duplicate names")
        return cols

    @t.observe("columns")
    def _on_columns(self, _change: Any) -> None:
        # keep the cells that still fit their column, give the others their default
        rows = []
        for row in self.value:
            new = self.default_row()
            for col in self._columns():
                if col["name"] in row:
                    ok, v = check_cell(col, row[col["name"]])
                    if ok:
                        new[col["name"]] = v
            rows.append(new)
        self.value = rows

    @t.validate("value")
    def _check_value(self, proposal: Any) -> list[dict[str, Any]]:
        rows = proposal["value"]
        if len(rows) > self.max_rows:
            raise t.TraitError(
                f"The 'value' trait of a RecipeTable instance: {len(rows)} rows, "
                f"more than max_rows ({self.max_rows})"
            )
        return [self._check_row(i, row) for i, row in enumerate(rows)]

    def _check_row(self, index: int, row: Any) -> dict[str, Any]:
        if not isinstance(row, Mapping):
            raise t.TraitError(
                f"The 'value' trait of a RecipeTable instance: row {index} is not a dict"
            )
        cols = {c["name"]: c for c in self._columns()}
        unknown = set(row) - set(cols)
        if unknown:
            raise t.TraitError(
                f"The 'value' trait of a RecipeTable instance: row {index} has unknown "
                f"columns {sorted(unknown)}"
            )
        out = {}
        for name, col in cols.items():
            ok, v = check_cell(col, row.get(name, col["default"]))
            if not ok:
                raise t.TraitError(
                    f"The 'value' trait of a RecipeTable instance: row {index}, "
                    f"column {name!r}: {v}"
                )
            out[name] = v
        return out

    # -- API ----------------------------------------------------------------------
    def column(self, name: str) -> dict[str, Any]:
        """Description of column ``name``."""
        for c in self._columns():
            if c["name"] == name:
                return c
        raise KeyError(f"no column {name!r} in this RecipeTable")

    def default_row(self) -> dict[str, Any]:
        """A new row: the default of every column."""
        return {c["name"]: c["default"] for c in self._columns()}

    def set_cell(self, row: int, column: str, value: Any) -> None:
        """Set one cell, checked against its column (``ValueError`` if invalid)."""
        ok, v = check_cell(self.column(column), value)
        if not ok:
            raise ValueError(f"row {row}, column {column!r}: {v}")
        rows = [dict(r) for r in self.value]
        rows[row][column] = v
        self.value = rows

    def add_row(self, row: Mapping[str, Any] | None = None) -> int:
        """Append a row (missing cells get their column default); returns its index."""
        self.value = [*self.value, {**self.default_row(), **(row or {})}]
        return len(self.value) - 1

    def delete_row(self, row: int) -> None:
        self.value = [r for i, r in enumerate(self.value) if i != row]

    def on_edit(self, callback: Callback) -> Callback:
        """Register ``callback(event)`` for operator edits.

        ``event``: ``{"action": "edit" | "add" | "delete", "row", "column", "value"}``.
        """
        self._edit_callbacks.append(callback)
        return callback

    # -- front end ----------------------------------------------------------------
    def _notify(self, event: dict[str, Any]) -> None:
        with _dispatch.batch():
            for cb in list(self._edit_callbacks):
                _dispatch.call(self, cb, {**event, "owner": self}, self._callback_priority)

    def _reject(self, content: Mapping[str, Any], reason: str) -> None:
        self.send(
            {
                "type": "rejected",
                "row": content.get("row"),
                "column": content.get("column"),
                "reason": reason,
            }
        )

    def _handle_front_msg(self, _widget: Any, content: Any, _buffers: Any) -> None:
        if not isinstance(content, dict) or self.mode != "control" or self.disabled:
            return
        kind = content.get("type")
        raw = content.get("row")
        row: int = raw if isinstance(raw, int) and not isinstance(raw, bool) else -1
        valid_row = 0 <= row < len(self.value)
        if kind == "edit":
            name = content.get("column")
            cols = {c["name"]: c for c in self._columns()}
            if not valid_row or name not in cols or cols[name]["readonly"]:
                return self._reject(content, "This cell cannot be edited")
            ok, v = check_cell(cols[name], content.get("value"))
            if not ok:
                return self._reject(content, v)
            rows = [dict(r) for r in self.value]
            rows[row][name] = v
            self.value = rows
            self._notify({"action": "edit", "row": row, "column": name, "value": v})
        elif kind == "add" and self.row_edit and len(self.value) < self.max_rows:
            index = self.add_row()
            self._notify({"action": "add", "row": index, "column": None, "value": None})
        elif kind == "delete" and self.row_edit and valid_row:
            self.delete_row(row)
            self._notify({"action": "delete", "row": row, "column": None, "value": None})
