"""Base class of the industrial widgets: the anywidget-instruments base class with this bundle.

The common traits, callbacks, liveness and themes come from the
anywidget-instruments core (API-001 .. API-011); this module points the base
class at the front end of this library and re-exports the helpers its widgets use.
"""

from __future__ import annotations

import pathlib

import anywidget_instruments as _core
from anywidget_instruments._base import SKIN_PARTS as SKIN_PARTS
from anywidget_instruments._base import Callback as Callback
from anywidget_instruments._base import _float_from_json, _float_to_json, _report_callback_error
from anywidget_instruments._base import float_serializers as float_serializers
from anywidget_instruments._base import mode_trait as mode_trait
from anywidget_instruments._base import size_trait as size_trait

_STATIC = pathlib.Path(__file__).parent / "static"

__all__ = [
    "SKIN_PARTS",
    "Callback",
    "InstrumentWidget",
    "_float_from_json",
    "_float_to_json",
    "_report_callback_error",
    "float_serializers",
    "mode_trait",
    "size_trait",
]


class InstrumentWidget(_core.InstrumentWidget):
    """Base class of every industrial widget: one bundle serves them all.

    See :class:`anywidget_instruments.InstrumentWidget` for the common traits.
    """

    _esm = _STATIC / "index.js"
    _css = _STATIC / "index.css"
