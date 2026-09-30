"""Shared test fixtures."""

from __future__ import annotations

from collections.abc import Iterator

import pytest

from anywidget_instruments_industrial import _style


@pytest.fixture(autouse=True)
def _restore_global_style() -> Iterator[None]:
    """Restore the default style and theme: a ThemeSwitch changes them for every widget."""
    style, theme = _style.get_default_style(), _style.get_default_theme()
    yield
    _style.set_default_style(style)
    _style.set_theme(theme)
