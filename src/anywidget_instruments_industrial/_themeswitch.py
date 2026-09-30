"""Light / system / dark theme switch (STYLE-007, STYLE-008)."""

from __future__ import annotations

from typing import Any

import traitlets as t

from ._base import InstrumentWidget, size_trait
from ._style import get_default_theme, set_theme

#: Positions of the theme switch, left to right.
THEME_SWITCH_POSITIONS: tuple[str, ...] = ("light", "system", "dark")


class ThemeSwitch(InstrumentWidget):
    """Three-position switch for the theme of every widget: light, system, dark.

    Selecting a position calls :func:`anywidget_instruments_industrial.set_theme`;
    ``"system"`` follows the host or operating system color scheme. With
    ``page_theme`` (the default) the notebook page follows the switch too,
    where the host allows it (marimo); other hosts keep their own theme
    setting (STYLE-008). ``value`` is ``"auto"`` until a position is chosen.

    Usually built with :func:`anywidget_instruments_industrial.theme_switch`.
    """

    _kind = t.Unicode("themeswitch").tag(sync=True)
    _default_size = (240, 30)
    size = size_trait(*_default_size)
    value = t.Enum(["auto", *THEME_SWITCH_POSITIONS], default_value="auto").tag(sync=True)
    page_theme = t.Bool(True).tag(sync=True)

    def __init__(self, value: str | None = None, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.value = get_default_theme() if value is None else value

    @t.observe("value")
    def _on_value(self, change: Any) -> None:
        set_theme(change["new"])
