"""Common base class shared by every instrumentation widget (API-001 .. API-011)."""

from __future__ import annotations

import math
import pathlib
from collections.abc import Callable
from typing import Any

import anywidget
import traitlets as t
from traitlets.traitlets import EventHandler

from . import _dispatch, _liveness
from ._sanitize import sanitize_svg
from ._style import STYLES, THEMES, get_default_style, get_default_theme

_STATIC = pathlib.Path(__file__).parent / "static"

Callback = Callable[[dict[str, Any]], Any]

#: Replaceable drawing parts (STYLE-005): ``background`` (behind everything),
#: ``housing`` (face / tank / tube / track), ``knob`` (knob, dial; drawn
#: pointing up, rotated with the value) and ``needle`` (gauge, meter, compass;
#: pointing up with the pivot at the bottom centre).
SKIN_PARTS = frozenset({"background", "housing", "knob", "needle"})


# ---------------------------------------------------------------------------
# JSON helpers: JSON has no NaN / Infinity, so non-finite floats travel as
# strings and are converted back on the front end (NUM-007).
# ---------------------------------------------------------------------------
def _float_to_json(value: Any) -> Any:
    if isinstance(value, float) and not math.isfinite(value):
        return "nan" if math.isnan(value) else ("inf" if value > 0 else "-inf")
    if isinstance(value, (list, tuple)):
        return [_float_to_json(v) for v in value]
    if isinstance(value, dict):
        return {k: _float_to_json(v) for k, v in value.items()}
    return value


def _float_from_json(value: Any) -> Any:
    if isinstance(value, str):
        return float(value)
    if isinstance(value, list):
        return [_float_from_json(v) for v in value]
    if isinstance(value, dict):
        return {k: _float_from_json(v) for k, v in value.items()}
    return value


float_serializers: dict[str, Any] = {
    "to_json": lambda v, _w: _float_to_json(v),
    "from_json": lambda v, _w: _float_from_json(v),
}


_report_callback_error = _dispatch.report_callback_error


def mode_trait(default: str = "control") -> Any:
    """``mode`` trait with a class-specific default.

    Hosts without a Python kernel read the class defaults of the synced
    traits (HOST-007): a widget that is an indicator by default declares it
    here rather than only in ``_default_mode``.
    """
    return t.Enum(["control", "indicator"], default_value=default).tag(sync=True)


def size_trait(width: int = 160, height: int = 160) -> Any:
    """``size`` trait with a class-specific default (see :func:`mode_trait`)."""
    return t.Tuple(t.CInt(), t.CInt(), default_value=(width, height)).tag(sync=True)


class InstrumentWidget(anywidget.AnyWidget):
    """Base class of every instrumentation widget.

    Common traits
    -------------
    value
        Current state of the widget (defined by each subclass).
    mode
        ``"control"`` (the user sets the value) or ``"indicator"`` (display only).
    label, tooltip
        Plain-text strings, never interpreted as HTML (SEC-002).
    disabled, visible
        Greyed/input-rejecting state and visibility.
    size
        ``(width, height)`` in CSS pixels; drawings are vector based and stay sharp.
    style
        Visual style: ``"modern"``, ``"classic"`` or ``"system"``.
    theme
        ``"auto"``, ``"light"`` or ``"dark"``; see :func:`anywidget_instruments.set_theme`.
    """

    _esm = _STATIC / "index.js"
    _css = _STATIC / "index.css"

    #: Front-end renderer identifier (one bundle serves every widget).
    _kind = t.Unicode("").tag(sync=True)

    mode = mode_trait("control")
    label = t.Unicode("").tag(sync=True)
    disabled = t.Bool(False).tag(sync=True)
    visible = t.Bool(True).tag(sync=True)
    tooltip = t.Unicode("").tag(sync=True)
    size = size_trait(160, 160)
    style = t.Enum(list(STYLES), default_value="modern").tag(sync=True)
    #: ``"auto"`` (the style decides), ``"light"`` or ``"dark"`` (STYLE-007).
    theme = t.Enum(list(THEMES), default_value="auto").tag(sync=True)
    #: Optional skin: mapping part name -> SVG source (sanitized, STYLE-005/006).
    skin = t.Dict(value_trait=t.Unicode(), default_value={}).tag(sync=True)
    #: Kernel session id and heartbeat interval used for stale detection (ROB-001).
    #: The class defaults announce nothing (HOST-003): a host without a Python
    #: kernel that uses them never shows a stale indication. Every Python
    #: widget announces the kernel session and heartbeat in ``__init__``.
    _session = t.Unicode("").tag(sync=True)
    _heartbeat = t.Float(0.0, min=0.0).tag(sync=True)

    #: Callback priority in a batch (see :func:`anywidget_instruments.batch`).
    _callback_priority: int = _dispatch.PRIORITY_NORMAL

    _default_mode: str = "control"
    _default_size: tuple[int, int] = (160, 160)

    def __init__(self, **kwargs: Any) -> None:
        kwargs.setdefault("style", get_default_style())
        kwargs.setdefault("theme", get_default_theme())
        kwargs.setdefault("mode", self._default_mode)
        kwargs.setdefault("size", self._default_size)
        kwargs.setdefault("_session", _liveness.SESSION)
        kwargs.setdefault("_heartbeat", _liveness.get_heartbeat())
        super().__init__(**kwargs)
        _liveness.register(self)

    # -- validation -------------------------------------------------------
    @t.validate("size")
    def _validate_size(self, proposal: Any) -> tuple[int, int]:
        w, h = proposal["value"]
        if w <= 0 or h <= 0:
            raise t.TraitError(
                f"The 'size' trait of a {type(self).__name__} instance must be positive, "
                f"got {(w, h)!r}"
            )
        return (w, h)

    @t.validate("skin")
    def _validate_skin(self, proposal: Any) -> dict[str, str]:
        unknown = set(proposal["value"]) - SKIN_PARTS
        if unknown:
            raise t.TraitError(
                f"The 'skin' trait of a {type(self).__name__} instance: unknown part(s) "
                f"{sorted(unknown)}; expected {sorted(SKIN_PARTS)}"
            )
        try:
            return {part: sanitize_svg(svg) for part, svg in proposal["value"].items()}
        except ValueError as exc:
            raise t.TraitError(
                f"The 'skin' trait of a {type(self).__name__} instance: {exc}"
            ) from exc

    # -- callbacks (API-009, ROB-002) ---------------------------------------
    def _wrap_handler(self, handler: Any) -> Any:
        if isinstance(handler, EventHandler):
            return handler  # internal traitlets machinery: leave untouched
        wrappers: dict[Any, Any] = self.__dict__.setdefault("_awi_wrappers", {})
        if handler not in wrappers:

            def safe(change: Any, _handler: Any = handler) -> None:
                _dispatch.call(self, _handler, change, self._callback_priority)

            wrappers[handler] = safe
        return wrappers[handler]

    def observe(self, handler: Any, names: Any = t.All, type: str = "change") -> None:
        super().observe(self._wrap_handler(handler), names=names, type=type)

    def unobserve(self, handler: Any, names: Any = t.All, type: str = "change") -> None:
        wrappers = self.__dict__.get("_awi_wrappers", {})
        super().unobserve(wrappers.get(handler, handler), names=names, type=type)

    def on_change(self, callback: Callback | None = None, names: str | list[str] = "value") -> Any:
        """Register ``callback(change)`` to run when ``value`` (or ``names``) changes.

        Exceptions raised by the callback are logged and do not break the widget.
        Usable as a decorator, with or without arguments::

            @knob.on_change
            def _(change): ...

            @tank.on_change(names="alarm_level")
            def _(change): ...
        """
        if callback is None:
            return lambda cb: self.on_change(cb, names)
        self.observe(callback, names=names)
        return callback

    def set_state(self, sync_data: Any) -> None:
        # Updates from the front end are processed as a batch (BOOL-013).
        with _dispatch.batch():
            super().set_state(sync_data)

    # -- misc ---------------------------------------------------------------
    def __repr__(self) -> str:
        label = f" label={self.label!r}" if self.label else ""
        return f"<{type(self).__name__}{label} value={self.value!r}>"
