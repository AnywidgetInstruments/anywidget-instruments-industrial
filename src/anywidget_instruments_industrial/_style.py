"""Styles and themes (STYLE-001, STYLE-004, STYLE-007, STYLE-008).

The defaults and ``set_theme`` belong to the anywidget-instruments core, so that
one call switches the widgets of every library; this module adds the ready-made
theme switch of this library.
"""

from __future__ import annotations

from typing import Any

from anywidget_instruments import (
    STYLES as STYLES,
)
from anywidget_instruments import (
    THEMES as THEMES,
)
from anywidget_instruments import (
    get_default_style as get_default_style,
)
from anywidget_instruments import (
    get_default_theme as get_default_theme,
)
from anywidget_instruments import (
    set_default_style as set_default_style,
)
from anywidget_instruments import (
    set_theme as set_theme,
)


def theme_switch(label: str = "Theme", **kwargs: Any) -> Any:
    """A :class:`ThemeSwitch` (light / system / dark) for every widget.

    Put it at the top of a notebook or app::

        ai.theme_switch()

    In marimo the page follows the switch as well (STYLE-008).
    """
    from ._themeswitch import ThemeSwitch

    return ThemeSwitch(label=label, **kwargs)
