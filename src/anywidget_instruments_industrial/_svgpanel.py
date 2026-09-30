"""SvgPanel: a front panel drawn in a vector editor, animated from Python (IND-120 .. IND-126)."""

from __future__ import annotations

import math
import re
import xml.etree.ElementTree as ET
from importlib import resources
from typing import Any

import traitlets as t
from anywidget_instruments import sanitize_svg

from ._base import InstrumentWidget, mode_trait, size_trait

INKSCAPE_LABEL = "{http://www.inkscape.org/namespaces/inkscape}label"

_NUM, _TEXT, _COLOR = "number", "text", "color"
#: Roles of the ``awi:<role>=<name>;<option>=<value>`` convention and their options.
ROLES: dict[str, dict[str, tuple[str, Any]]] = {
    # indicators
    "text": {"format": (_TEXT, "%.1f"), "unit": (_TEXT, "")},
    "rotate": {
        "min": (_NUM, 0.0),
        "max": (_NUM, 100.0),
        "from": (_NUM, -135.0),
        "to": (_NUM, 135.0),
        "cx": (_NUM, None),
        "cy": (_NUM, None),
    },
    "scale": {"min": (_NUM, 0.0), "max": (_NUM, 100.0), "edge": (_TEXT, "bottom")},
    "show": {"eq": (_TEXT, None)},
    "state": {},
    "case": {},
    "color": {"on": (_COLOR, "#22c55e"), "off": (_COLOR, "#6b7280"), "eq": (_TEXT, None)},
    # controls
    "button": {"label": (_TEXT, "")},
    "momentary": {"label": (_TEXT, "")},
    "set": {"value": (_TEXT, ""), "label": (_TEXT, "")},
    "step": {
        "step": (_NUM, 1.0),
        "min": (_NUM, 0.0),
        "max": (_NUM, 100.0),
        "label": (_TEXT, ""),
        "unit": (_TEXT, ""),
        "format": (_TEXT, "%.1f"),
    },
}
#: Roles an operator acts on (IND-123).
CONTROL_ROLES: tuple[str, ...] = ("button", "momentary", "set", "step")
EDGES: tuple[str, ...] = ("bottom", "top", "left", "right")
_NAME = re.compile(r"^[A-Za-z0-9_.\-/]+$")
#: A decimal number, as both sides read it (no hexadecimal, no digit separators).
_NUMBER = re.compile(r"^\s*[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$", re.IGNORECASE)
_COLOR_RE = re.compile(r"^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|(rgb|hsl)a?\([0-9.,%\s]+\))$")

#: Templates shipped with the package (IND-126), see :meth:`SvgPanel.template`.
TEMPLATES: tuple[str, ...] = ("voltmeter", "pressure_gauge", "pilot_lamp", "selector", "tank")


def parse_role(label: str) -> dict[str, Any] | str | None:
    """Role of an element label (IND-121).

    Returns ``{"role", "name", "options"}`` (options completed with their
    defaults), a reason string when the label is an invalid role, or None
    when the label is not a role (a plain name: decoration).
    """
    text = label.strip()
    if not text.startswith("awi:"):
        return None
    head, *rest = [p.strip() for p in text[4:].split(";")]
    role, sep, name = (p.strip() for p in head.partition("="))
    if role not in ROLES:
        return f"unknown role {role!r}"
    if not sep or not _NAME.match(name):
        return f"role {role!r} needs a name (letters, digits, _ . - /)"
    spec = ROLES[role]
    options: dict[str, Any] = {k: default for k, (_kind, default) in spec.items()}
    for part in rest:
        if not part:
            continue
        key, sep, raw = (p.strip() for p in part.partition("="))
        if key not in spec or not sep:
            return f"unknown option {key!r} for role {role!r}"
        kind = spec[key][0]
        if kind == _NUM:
            if not _NUMBER.match(raw):
                return f"option {key!r} must be a number, got {raw!r}"
            value: Any = float(raw)
            if not math.isfinite(value):
                return f"option {key!r} must be finite"
        elif kind == _COLOR:
            if not _COLOR_RE.match(raw):
                return f"option {key!r} is not a color: {raw!r}"
            value = raw
        else:
            value = raw
        options[key] = value
    if "min" in options and "max" in options and not options["max"] > options["min"]:
        return "option 'max' must be greater than 'min'"
    if role == "scale" and options["edge"] not in EDGES:
        return f"option 'edge' must be one of {', '.join(EDGES)}"
    if role == "step" and not options["step"] > 0:
        return "option 'step' must be positive"
    return {"role": role, "name": name, "options": options}


def element_label(attrib: dict[str, str]) -> str:
    """Role label of an element: its ``data-awi`` attribute, else its editor label."""
    return attrib.get("data-awi") or attrib.get(INKSCAPE_LABEL, "")


def scan_svg(source: str) -> tuple[list[dict[str, Any]], list[str]]:
    """Bindings ``[{role, name, options, element}]`` and problems of a drawing (IND-125)."""
    if not source:
        return [], []
    root = ET.fromstring(source)
    bindings: list[dict[str, Any]] = []
    problems: list[str] = []

    def walk(elem: ET.Element, in_state: bool) -> None:
        label = element_label(elem.attrib)
        parsed = parse_role(label) if label else None
        where = elem.attrib.get("id") or label
        state_here = in_state
        if isinstance(parsed, str):
            problems.append(f"{where}: {parsed}")
        elif parsed is not None:
            if parsed["role"] == "case" and not in_state:
                problems.append(f"{where}: a 'case' must be inside a 'state' element")
            else:
                bindings.append({**parsed, "element": where})
            state_here = in_state or parsed["role"] == "state"
        for child in elem:
            walk(child, state_here)

    walk(root, False)
    return bindings, problems


def truthy(value: Any) -> bool:
    """State of a Boolean role: true, a non-zero number or a word other than 0/false/off/no."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return math.isfinite(value) and value != 0
    if isinstance(value, str):
        return value.strip().lower() not in {"", "0", "false", "off", "no"}
    return False


def fraction(value: Any, options: dict[str, Any]) -> float | None:
    """Position of a numeric value in [min, max], clamped to [0, 1]; None if not a number."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    f = (value - options["min"]) / (options["max"] - options["min"])
    return min(1.0, max(0.0, f))


def rotate_angle(value: Any, options: dict[str, Any]) -> float | None:
    """Angle of a ``rotate`` element for ``value``, in degrees."""
    f = fraction(value, options)
    return None if f is None else options["from"] + f * (options["to"] - options["from"])


def step_value(value: Any, direction: int, options: dict[str, Any]) -> float:
    """Value after one ``step`` up (+1) or down (-1), within [min, max]."""
    base = value if isinstance(value, (int, float)) and math.isfinite(value) else options["min"]
    v = min(options["max"], max(options["min"], base + direction * options["step"]))
    return float(f"{v:.12g}")


def matches(raw: str, value: Any) -> bool:
    """Whether ``value`` equals the option text ``raw`` (``eq`` options, ``case`` names).

    Booleans compare with true / false, numbers numerically, anything else as text.
    """
    expected = option_value(raw)
    if isinstance(value, bool) or isinstance(expected, bool):
        return isinstance(value, bool) and isinstance(expected, bool) and value == expected
    if isinstance(value, (int, float)):
        return isinstance(expected, float) and float(value) == expected
    return value is not None and str(value) == raw.strip()


def option_value(raw: str) -> Any:
    """Value written by a ``set`` element: a number, true / false, or the text."""
    if raw.strip().lower() in ("true", "false"):
        return raw.strip().lower() == "true"
    v = float(raw) if _NUMBER.match(raw) else math.nan
    return v if math.isfinite(v) else raw


class SvgPanel(InstrumentWidget):
    """A front panel drawn in a vector editor, animated from Python (IND-120 .. IND-126).

    ``svg`` is an SVG document, sanitized like skins (no scripts, no external
    resources). Elements whose label (the object label of a vector editor,
    stored as ``inkscape:label``) or ``data-awi`` attribute reads
    ``awi:<role>=<name>`` followed by ``;<option>=<value>`` pairs are bound to
    ``value[<name>]``; other elements are decoration (IND-121).

    Indicator roles (IND-122): ``text`` (``format``, ``unit``), ``rotate``
    (``min``, ``max``, ``from``, ``to`` in degrees, pivot ``cx``, ``cy`` or
    the rotation center set in the editor, else the element center),
    ``scale`` (``min``, ``max``, ``edge``: the edge that stays in place),
    ``show`` (``eq``: shown when the value equals it, else when true),
    ``state`` (shows the child whose ``case`` name equals the value),
    ``color`` (``on``, ``off``, ``eq``).

    Control roles, in control mode (IND-123): ``button`` (toggles a Boolean),
    ``momentary`` (true while pressed), ``set`` (``value``: writes it),
    ``step`` (``step``, ``min``, ``max``: one step up with a click or the
    arrow keys, down with Shift+click); each ``step`` value also gets an
    entry field (IND-124). The kernel refuses a ``step`` value outside its
    limits, as for numeric widgets (NUM-010).

    ``problems`` lists the elements with an unknown role or an invalid option
    (IND-125). :meth:`template` loads a drawing shipped with the package
    (IND-126).

    Examples
    --------
    >>> svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">
    ...   <text x="10" y="30" data-awi="awi:text=vout;format=%.2f;unit=V">0</text>
    ...   <circle cx="80" cy="30" r="10" data-awi="awi:button=run"/>
    ... </svg>'''
    >>> panel = SvgPanel(svg, label="Power supply")
    >>> panel["vout"] = 12.0
    >>> panel.names()
    ['run', 'vout']
    """

    _kind = t.Unicode("svgpanel").tag(sync=True)
    _default_mode = "control"
    _default_size = (400, 300)
    mode = mode_trait(_default_mode)
    size = size_trait(*_default_size)

    svg = t.Unicode("").tag(sync=True)
    #: Values of the bound names: numbers, text, Booleans or None.
    value = t.Dict().tag(sync=True)
    problems = t.List(t.Unicode(), read_only=True).tag(sync=True)
    #: Entry fields for the values of ``step`` controls (IND-124).
    show_entries = t.Bool(True).tag(sync=True)

    def __init__(self, svg: str = "", **kwargs: Any) -> None:
        super().__init__(svg=svg, **kwargs)
        self._on_svg({"new": self.svg})

    @classmethod
    def template(cls, name: str, **kwargs: Any) -> SvgPanel:
        """A panel drawn from a template shipped with the package (IND-126)."""
        if name not in TEMPLATES:
            raise ValueError(f"unknown template {name!r}; templates: {TEMPLATES}")
        source = (resources.files(__package__) / "templates" / f"{name}.svg").read_text("utf-8")
        kwargs.setdefault("label", name.replace("_", " ").capitalize())
        return cls(source, **kwargs)

    @t.validate("svg")
    def _check_svg(self, proposal: Any) -> str:
        source = str(proposal["value"])
        if not source.strip():
            return ""
        try:
            return sanitize_svg(source)
        except ValueError as exc:
            raise t.TraitError(f"The 'svg' trait of an SvgPanel instance: {exc}") from exc

    @t.observe("svg")
    def _on_svg(self, change: Any) -> None:
        self._bindings, problems = scan_svg(change["new"])
        self.set_trait("problems", problems)

    @t.validate("value")
    def _check_value(self, proposal: Any) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for key, v in dict(proposal["value"]).items():
            if isinstance(v, float) and not math.isfinite(v):
                v = None  # shown as "—"; JSON has no NaN
            elif v is not None and not isinstance(v, (bool, int, float, str)):
                raise t.TraitError(
                    f"The 'value' trait of an SvgPanel instance: {key!r} must be a number, "
                    f"a text, a Boolean or None, got {type(v).__name__}"
                )
            out[str(key)] = v
        return out

    # -- access ---------------------------------------------------------------------
    def bindings(self) -> list[dict[str, Any]]:
        """``[{role, name, options, element}]`` of the bound elements, in document order."""
        return [dict(b) for b in self._bindings]

    def names(self) -> list[str]:
        """Names bound in the drawing, sorted."""
        return sorted({b["name"] for b in self._bindings if b["role"] != "case"})

    def __getitem__(self, name: str) -> Any:
        return self.value.get(name)

    def __setitem__(self, name: str, value: Any) -> None:
        self.value = {**self.value, name: value}

    def update(self, **values: Any) -> None:
        """Set several values at once (one message to the front end)."""
        self.value = {**self.value, **values}

    # -- front end ------------------------------------------------------------------
    def set_state(self, sync_data: Any) -> None:
        # NUM-010: the kernel checks step values received from the front end
        if isinstance(sync_data.get("value"), dict):
            steps = {b["name"]: b["options"] for b in self._bindings if b["role"] == "step"}
            for name, opts in steps.items():
                v = sync_data["value"].get(name)
                if isinstance(v, (int, float)) and not opts["min"] <= v <= opts["max"]:
                    sync_data = {k: val for k, val in sync_data.items() if k != "value"}
                    self.send_state("value")
                    break
        if sync_data:
            super().set_state(sync_data)
