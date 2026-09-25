"""Conformance of the Python widgets with the trait contract (HOST-001, HOST-007).

The JSON Schemas in ``src/anywidget_instruments/schema/`` are the single source
of truth. ``npm run build`` (or ``npm run gen``) flattens them into
``static/contract.json``, the file also used by the TypeScript front end and
published for host authors. These tests fail when a traitlets declaration,
a class default or an instance state diverges from the schemas.
"""

from __future__ import annotations

import base64
import json
import math
import pathlib
from typing import Any

import numpy as np
import pytest
import traitlets as t

import anywidget_instruments as ai
from anywidget_instruments import _base, _boolean, _graph, _numeric, _polar, _process

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
    "BooleanWidget": _boolean.BooleanWidget,
    "ProcessObject": _process.ProcessObject,
    "_SeriesWidget": _polar._SeriesWidget,
    "GraphWidget": _graph.GraphWidget,
}
WIDGETS = sorted(CONTRACT["widgets"].items())
IDS = [title for title, _ in WIDGETS]


def _binary(o: Any) -> str:
    """Binary data as a JSON-only host sends it: base64 text."""
    if isinstance(o, (bytes, bytearray, memoryview)):
        return base64.b64encode(bytes(o)).decode()
    raise TypeError(type(o).__name__)


def _json(value: Any) -> Any:
    """Value as it travels in JSON (non-finite floats as text, tuples as lists, bytes as base64)."""
    return json.loads(json.dumps(_base._float_to_json(value), default=_binary))


def _state(w: Any) -> dict[str, Any]:
    """Synced state of a widget as JSON, without the framework traits."""
    return {k: v for k, v in _json(w.get_state()).items() if k not in FRAMEWORK}


def _class_default(trait: t.TraitType) -> Any:
    return trait.default()


def _synced(cls: type) -> dict[str, t.TraitType]:
    return {k: v for k, v in cls.class_traits(sync=True).items() if k not in FRAMEWORK}


#: Every widget class the package exports: all follow the trait contract.
WIDGET_CLASSES = sorted(
    n
    for n, c in vars(ai).items()
    if isinstance(c, type) and issubclass(c, _base.InstrumentWidget) and c._kind.default_value
)


def test_every_widget_has_a_schema() -> None:
    """A new widget cannot skip the contract (HOST-001): CI fails without its schema."""
    classes = {w["class"] for w in CONTRACT["widgets"].values()}
    assert len(WIDGET_CLASSES) >= 47
    assert set(WIDGET_CLASSES) <= classes, sorted(set(WIDGET_CLASSES) - classes)


def test_class_defaults_announce_no_liveness() -> None:
    """HOST-003: a host using class defaults never sees NO KERNEL."""
    for cls in (_base.InstrumentWidget, *(CLASSES[c] for c in WIDGET_CLASSES)):
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
    elif isinstance(trait, t.Bytes):
        assert kind == "bytes", name
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
        # derived traits are read-only; a read-only trait is derived or written by the host
        if s["writer"] == "derived":
            assert trait.read_only, where
        if trait.read_only:
            assert s["writer"] in ("derived", "host"), where
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
        if name in HOST_FILLED or spec["traits"][name].get("resolved"):
            continue  # resolved defaults: see tests/parity/resolved.json
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
    state = _state(w)
    errors = sorted(validator.iter_errors(state), key=str)
    assert not errors, [e.message for e in errors]


def test_schemas_are_valid_json_schemas() -> None:
    jsonschema = pytest.importorskip("jsonschema")
    for f in SCHEMA_DIR.glob("*.schema.json"):
        jsonschema.Draft202012Validator.check_schema(json.loads(f.read_text()))


def test_transition_tables() -> None:
    """x-awi-transitions of a schema equal the table of the Python class."""
    from anywidget_instruments import _scada

    table = CONTRACT["widgets"]["AlarmIndicator"]["traits"]["value"]["transitions"]
    assert {(a, e): b for a, e, b in table} == _scada._TRANSITIONS


@pytest.mark.parametrize("name", ["Valve", "Pump", "Motor"])
def test_simulated_tables(name: str) -> None:
    """x-awi-simulated of the commands equals the simulation table of the Python class."""
    spec = CONTRACT["widgets"][name]["traits"]["commands"]
    assert spec["simulated"] == getattr(ai, name)._simulated
    assert spec["default"] == list(getattr(ai, name)._commands)


def _plotted() -> list[Any]:
    polar = ai.PolarPlot()
    polar.plot([1.0, float("nan"), 2.0], [0, 90, 180], name="a", style="both")
    smith = ai.SmithChart(z0=75)
    smith.plot([50 + 25j, 75, 100 - 50j], name="load")
    smith.plot([0.1 + 0.2j], kind="reflection")
    radar = ai.RadarChart(axes=["a", "b", "c"], ranges=[[0, 10], [0, 5], [-1, 1]])
    radar.plot([5, 2.5, 0.5], name="x")
    return [polar, smith, radar]


@pytest.mark.parametrize("w", _plotted(), ids=lambda w: type(w).__name__)
def test_plotted_state_validates(w: Any) -> None:
    """Data sets written by plot() conform to the item schemas of `value`."""
    spec = next(s for s in CONTRACT["widgets"].values() if s["class"] == type(w).__name__)
    validator = _validator(pathlib.Path(spec["schema"]).name)
    state = _state(w)
    errors = sorted(validator.iter_errors(state), key=str)
    assert not errors, [e.message for e in errors]
    fields = set(spec["traits"]["value"]["items"]["properties"])
    assert all(set(s) <= fields for s in state["value"])


def _sent(w: Any) -> list[tuple[dict[str, Any], list[Any]]]:
    """Capture the custom messages a widget sends."""
    out: list[tuple[dict[str, Any], list[Any]]] = []
    w.send = lambda content, buffers=None: out.append((content, list(buffers or [])))
    return out


def _message_validator(spec: dict[str, Any], msg_type: str) -> Any:
    jsonschema = pytest.importorskip("jsonschema")
    m = next(m for m in spec["messages"] if m["type"] == msg_type)
    schema = {
        "type": "object",
        "properties": {"type": {"const": msg_type}, **m.get("fields", {})},
        "required": ["type", *m.get("fields", {})],
    }
    return m, jsonschema.Draft202012Validator(schema)


def _picture_messages() -> Any:
    pic = ai.PictureControl()
    sent = _sent(pic)
    pic.line(0, 0, 10, 10).rect(1, 2, 3, 4, fill="red").circle(5, 5, 2).arc(5, 5, 3, 0, 90)
    pic.polygon([(0, 0), (1, 1), (2, 0)]).polyline([(0, 0), (3, 3)]).text(
        1, 1, "hi", anchor="middle"
    )
    png = b"\x89PNG\r\n\x1a\n" + bytes(8)
    pic.image(0, 0, png).image(10, 0, np.zeros((2, 3), dtype=np.uint8))
    pic.flush()
    pic._handle_front_msg(pic, {"type": "sync_request"}, [])
    return pic, sent


def _waveform_messages() -> Any:
    w = ai.WaveformChart(history=4, n_traces=2)
    sent = _sent(w)
    w.append([1.0, 2.0])
    w.append(np.arange(12.0).reshape(6, 2))  # more than history: the last 4 are sent
    w._handle_front_msg(w, {"type": "sync_request"}, [])
    w.clear()
    return w, sent


def _buffer_bytes(w: Any, content: dict[str, Any], spec: dict[str, Any]) -> int:
    """Expected size of a buffer from its dtype and shape (message fields or widget traits)."""
    n = int(np.dtype(spec["dtype"]).itemsize)
    for dim in spec.get("shape", []):
        n *= int(content[dim] if dim in content else getattr(w, dim))
    return n


def _intensity_messages() -> Any:
    w = ai.IntensityChart(history=3, n_bins=2)
    sent = _sent(w)
    w.append([1.0, float("nan")])
    w.append(np.arange(10.0).reshape(5, 2))
    w._handle_front_msg(w, {"type": "sync_request"}, [])
    w.clear()
    return w, sent


def _digital_messages() -> Any:
    w = ai.MixedSignalGraph(buses=[{"name": "B", "lines": [1, 0]}])
    sent = _sent(w)
    w.set_data([1, 2, 3], n_bits=2)
    w.set_analog(np.arange(6.0).reshape(3, 2))
    w._handle_front_msg(w, {"type": "sync_request"}, [])
    return w, sent


def _trend_messages() -> Any:
    w = ai.TrendChart(pens=["A", {"name": "B", "unit": "m"}], history=3)
    sent = _sent(w)
    w.add("A", [1.0, 2.0], time=[10.0, 11.0])
    w.add_many({"A": 3.0, "B": [4.0, 5.0, 6.0, 7.0]}, time=12.0)
    w._handle_front_msg(w, {"type": "sync_request"}, [])
    w.clear()
    return w, sent


@pytest.mark.parametrize(
    "make",
    [
        _picture_messages,
        _waveform_messages,
        _intensity_messages,
        _digital_messages,
        _trend_messages,
    ],
    ids=lambda f: f.__name__.strip("_"),
)
def test_sent_messages_conform(make: Any) -> None:
    """Messages sent by the host conform to x-awi-messages: fields and buffer count."""
    w, sent = make()
    spec = next(s for s in CONTRACT["widgets"].values() if s["class"] == type(w).__name__)
    assert sent
    for content, buffers in sent:
        m, validator = _message_validator(spec, content["type"])
        assert m["direction"] == "host-to-front"
        errors = sorted(validator.iter_errors(json.loads(json.dumps(content))), key=str)
        assert not errors, [e.message for e in errors]
        if content["type"] == "draw":  # one buffer per image command, referenced by index
            refs = sorted(c["buffer"] for c in content["commands"] if "buffer" in c)
            assert refs == list(range(len(buffers)))
        elif "repeat" in m:  # buffers repeated per item of a field, n from each item
            items = content[m["repeat"]]
            assert len(buffers) == len(m["buffers"]) * len(items)
            for k, (_index, n, _total) in enumerate(items):
                for j, bspec in enumerate(m["buffers"]):
                    b = buffers[k * len(m["buffers"]) + j]
                    assert len(b) == _buffer_bytes(w, {"n": n}, bspec), (content, bspec)
        else:
            assert len(buffers) == len(m["buffers"])
            for b, bspec in zip(buffers, m["buffers"], strict=True):
                assert len(b) == _buffer_bytes(w, content, bspec), (content, bspec)


def test_synoptic_state_validates() -> None:
    """Background bytes (as base64), child references and pipes conform to the schema."""
    syn = ai.SynopticCanvas(background=b"\x89PNG\r\n\x1a\n" + bytes(8))
    syn.add(ai.LED(), x=10, y=20)
    syn.add_pipe([(0, 0), (100, 0), (100, 50)], flow=True, direction="reverse", color="blue")
    state = _state(syn)
    errors = sorted(_validator("synoptic.schema.json").iter_errors(state), key=str)
    assert not errors, [e.message for e in errors]
    assert state["items"][0]["widget"].startswith("IPY_MODEL_")
    assert base64.b64decode(state["background"])[:4] == b"\x89PNG"
