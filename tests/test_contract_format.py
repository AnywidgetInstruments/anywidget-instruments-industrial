"""The host-facing layout of contract.json is stable within a format (HOST-001).

Hosts in other languages vendor the front end and read contract.json: a
change of this layout must bump "format" (and this test) on purpose.
"""

from __future__ import annotations

import json
import pathlib

import anywidget_instruments as awi
import pytest

STATIC = pathlib.Path(__file__).parents[1] / "src" / "anywidget_instruments_industrial" / "static"
CONTRACT = STATIC / "contract.json"
FORMAT = 1
TOP_KEYS = {"$comment", "format", "version", "encoding", "frameworkTraits", "widgets"}
WIDGET_KEYS = {"class", "kind", "abstract", "schema", "traits", "messages"}


@pytest.mark.skipif(not CONTRACT.exists(), reason="front end not built (npm run build)")
def test_contract_layout_is_stable() -> None:
    contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
    assert contract["format"] == FORMAT
    assert set(contract) == TOP_KEYS
    for name, widget in contract["widgets"].items():
        assert set(widget) == WIDGET_KEYS, name
        if widget["schema"].startswith(awi.SCHEMA_ID):  # a base schema of the core, by $id
            assert (awi.SCHEMA_DIR / widget["schema"].removeprefix(awi.SCHEMA_ID)).exists()
        else:
            assert (STATIC.parent / widget["schema"]).exists(), name
    assert (STATIC / "index.js").exists() and (STATIC / "index.css").exists()
