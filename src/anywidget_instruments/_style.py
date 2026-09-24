"""Global style defaults (STYLE-001, STYLE-004)."""

from __future__ import annotations

STYLES: tuple[str, ...] = ("modern", "classic", "system")

_default_style = "modern"


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
