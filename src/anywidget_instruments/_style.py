"""Global style and theme defaults (STYLE-001, STYLE-004, STYLE-007)."""

from __future__ import annotations

from typing import Any

STYLES: tuple[str, ...] = ("modern", "classic", "system")
THEMES: tuple[str, ...] = ("auto", "light", "dark", "system")

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

    ``"light"`` and ``"dark"`` force the palette whatever the host;
    ``"system"`` follows the host or operating system color scheme whatever
    the style; ``"auto"`` lets the style decide (the ``"system"`` style
    follows the host, the others stay light) (STYLE-007, STYLE-008).
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


def theme_switch(label: str = "Theme", **kwargs: Any) -> Any:
    """A :class:`ThemeSwitch` (light / system / dark) for every widget.

    Put it at the top of a notebook or app::

        ai.theme_switch()

    In marimo the page follows the switch as well (STYLE-008).
    """
    from ._themeswitch import ThemeSwitch

    return ThemeSwitch(label=label, **kwargs)
