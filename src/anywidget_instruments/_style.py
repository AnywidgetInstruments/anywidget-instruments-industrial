"""Global style and theme defaults (STYLE-001, STYLE-004, STYLE-007)."""

from __future__ import annotations

from typing import Any

STYLES: tuple[str, ...] = ("modern", "classic", "system")
THEMES: tuple[str, ...] = ("auto", "light", "dark")

_default_style = "modern"
_default_theme = "auto"


def set_default_style(style: str) -> None:
    """Set the style used by every widget created afterwards.

    Existing widgets are not modified; change their ``style`` trait instead.
    """
    global _default_style
    if style not in STYLES:
        raise ValueError(f"unknown style {style!r}; expected one of {STYLES}")
    _default_style = style


def get_default_style() -> str:
    """Return the style applied to newly created widgets."""
    return _default_style


def set_theme(theme: str) -> None:
    """Switch every open widget, and the widgets created afterwards, to ``theme``.

    ``"light"`` and ``"dark"`` force the palette whatever the host; ``"auto"``
    lets the style decide (``"system"`` follows the host theme) (STYLE-007).
    """
    global _default_theme
    if theme not in THEMES:
        raise ValueError(f"unknown theme {theme!r}; expected one of {THEMES}")
    _default_theme = theme
    from . import _liveness

    for w in _liveness._all_widgets():
        try:
            w.theme = theme
        except Exception:
            continue


def get_default_theme() -> str:
    """Return the theme applied to newly created widgets."""
    return _default_theme


def theme_switch(label: str = "Dark mode", **kwargs: Any) -> Any:
    """A slide switch that toggles :func:`set_theme` between light and dark.

    Put it at the top of a notebook or app::

        ai.theme_switch()
    """
    from ._boolean import SlideSwitch

    switch = SlideSwitch(_default_theme == "dark", label=label, **kwargs)
    switch.on_change(lambda change: set_theme("dark" if change["new"] else "light"))
    return switch
