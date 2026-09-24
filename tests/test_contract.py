"""Conformance of the Python widgets with the trait contract (HOST-001, HOST-007).

The JSON Schemas in ``src/anywidget_instruments/schema/`` are the single source
of truth. ``npm run build`` (or ``npm run gen``) flattens them into
``static/contract.json``, the file also used by the TypeScript front end and
published for host authors. These tests fail when a traitlets declaration,
a class default or an instance state diverges from the schemas.
"""

from __future__ import annotations

import json
import math
import pathlib
from typing import Any

import pytest
import traitlets as t

import anywidget_instruments as ai
from anywidget_instruments import _base, _numeric

PKG = pathlib.Path(ai.__file__).parent
SCHEMA_DIR = PKG / "schema"
CONTRACT_FILE = PKG / "static" / "contract.json"

if not CONTRACT_FILE.exists():  # pragma: no cover - the bundle is built before the tests
    pytest.skip("static/contract.json missing: run `npm run build`", allow_module_level=True)

CONTRACT = json.loads(CONTRACT_FILE.read_text())
FRAMEWORK = set(CONTRACT["frameworkTraits"])
#: Traits the host fills in when it creates a widget (liveness announcement).
HOST_FILLED = {"_session", "_heartbeat"}

CLASSES: dict[str, type] = {
    **{n: c for n, c in vars(ai).items() if isinstance(c, type)},
    "InstrumentWidget": _base.InstrumentWidget,
    "NumericWidget": _numeric.NumericWidget,
    "_PeakMixin": _numeric._PeakMixin,
}
WIDGETS = sorted(CONTRACT["widgets"].items())
IDS = [title for title, _ in WIDGETS]


def _json(value: Any) -> Any:
    """Value as it travels in JSON (non-finite floats as strings, tuples as lists)."""
    return json.loads(json.dumps(_base._float_to_json(value)))


def _class_default(trait: t.TraitType) -> Any:
    return trait.default()


def _synced(cls: type) -> dict[str, t.TraitType]:
    return {k: v for k, v in cls.class_traits(sync=True).items() if k not in FRAMEWORK}


#: Widgets migrated to the host-independent front end.
MIGRATED = {
    "Knob",
    "Tank",
    "Dial",
    "Thermometer",
    "FillSlide",
    "SevenSegment",
    "Compass",
    "AnalogIndicator",
    "Transmitter",
    "NumericEntry",
    "Gauge",
    "Meter",
    "VUMeter",
}


def test_migrated_widgets_have_a_schema() -> None:
    classes = {w["class"] for w in CONTRACT["widgets"].values()}
    assert {"InstrumentWidget", "NumericWidget", *MIGRATED} <= classes


def test_class_defaults_announce_no_liveness() -> None:
    """HOST-003: a host using class defaults never sees NO KERNEL."""
    for cls in (_base.InstrumentWidget, *(CLASSES[c] for c in MIGRATED)):
        traits = cls.class_traits()
        assert traits["_session"].default() == ""
        assert traits["_heartbeat"].default() == 0


@pytest.mark.parametrize(("title", "spec"), WIDGETS, ids=IDS)
def test_trait_names(title: str, spec: dict[str, Any]) -> None:
    cls = CLASSES[spec["class"]]
    assert set(_synced(cls)) == set(spec["traits"]), title


def _check_type(name: str, trait: t.TraitType, s: dict[str, Any]) -> None:
    kind = s["type"]
    if isinstance(trait, t.Enum):
        assert kind == "enum", name
        assert list(trait.values) == s["values"], name
    elif isinstance(trait, t.Unicode):
        assert kind in ("string", "const"), name
        if kind == "const":
            assert s["values"] == [trait.default_value], name
    elif isinstance(trait, t.Bool):
        assert kind == "boolean", name
    elif isinstance(trait, (t.Int, t.CInt)):
        assert kind == "integer", name
    elif isinstance(trait, (t.Float, t.CFloat)):
        assert kind == "number", name
    elif isinstance(trait, (t.List, t.Tuple)):
        assert kind == "array", name
    elif isinstance(trait, t.Dict):
        assert kind == "object", name
    else:  # pragma: no cover - a new trait type needs a mapping
        raise AssertionError(f"{name}: no schema mapping for {type(trait).__name__}")


def _bound(trait: t.TraitType, attr: str) -> float | None:
    v = getattr(trait, attr, None)
    return None if v is None or (isinstance(v, float) and math.isinf(v)) else v


@pytest.mark.parametrize(("title", "spec"), WIDGETS, ids=IDS)
def test_trait_declarations(title: str, spec: dict[str, Any]) -> None:
    """Type, bounds, nullability, read-only state and wire encoding."""
    cls = CLASSES[spec["class"]]
    for name, trait in _synced(cls).items():
        s = spec["traits"][name]
        where = f"{title}.{name}"
        _check_type(where, trait, s)
        assert bool(trait.allow_none) == bool(s.get("nullable")), where
        assert bool(trait.read_only) == bool(s.get("readOnly")), where
        assert (s["writer"] == "derived") == bool(trait.read_only), where
        encoded = trait.metadata.get("to_json") is _base.float_serializers["to_json"]
        if s["type"] == "number":
            assert encoded == bool(s.get("nonfinite")), f"{where}: float_serializers"
        if not isinstance(trait, t.Enum):
            assert _bound(trait, "min") == s.get("minimum"), f"{where}: minimum"
            assert _bound(trait, "max") == s.get("maximum"), f"{where}: maximum"


@pytest.mark.parametrize(("title", "spec"), WIDGETS, ids=IDS)
def test_class_defaults(title: str, spec: dict[str, Any]) -> None:
    """Hosts without a kernel read class defaults (HOST-007)."""
    cls = CLASSES[spec["class"]]
    for name, trait in _synced(cls).items():
        assert _json(_class_default(trait)) == spec["traits"][name]["default"], f"{title}.{name}"


@pytest.mark.parametrize(("title", "spec"), WIDGETS, ids=IDS)
def test_instance_defaults(title: str, spec: dict[str, Any]) -> None:
    """A new widget has the schema defaults, except what the host fills in."""
    cls = CLASSES[spec["class"]]
    w = cls()
    for name in _synced(cls):
        if name in HOST_FILLED:
            continue
        assert _json(getattr(w, name)) == spec["traits"][name]["default"], f"{title}.{name}"


def _validator(schema_file: str) -> Any:
    jsonschema = pytest.importorskip("jsonschema")
    referencing = pytest.importorskip("referencing")
    resources = []
    for f in SCHEMA_DIR.glob("*.schema.json"):
        doc = json.loads(f.read_text())
        resource = referencing.Resource.from_contents(doc)
        resources += [(doc["$id"], resource), (f.name, resource)]
    registry = referencing.Registry().with_resources(resources)
    schema = json.loads((SCHEMA_DIR / schema_file).read_text())
    return jsonschema.Draft202012Validator(schema, registry=registry)


@pytest.mark.parametrize(("title", "spec"), WIDGETS, ids=IDS)
def test_instance_state_validates(title: str, spec: dict[str, Any]) -> None:
    """The state a Python widget sends conforms to its JSON Schema."""
    validator = _validator(pathlib.Path(spec["schema"]).name)
    w = CLASSES[spec["class"]]()
    state = {k: v for k, v in json.loads(json.dumps(w.get_state())).items() if k not in FRAMEWORK}
    errors = sorted(validator.iter_errors(state), key=str)
    assert not errors, [e.message for e in errors]


def test_schemas_are_valid_json_schemas() -> None:
    jsonschema = pytest.importorskip("jsonschema")
    for f in SCHEMA_DIR.glob("*.schema.json"):
        jsonschema.Draft202012Validator.check_schema(json.loads(f.read_text()))
