"""The Python examples of the documentation run against the current code.

Every ```python block of the user-facing pages runs, in order, in one
namespace per page (a page builds on its earlier blocks). A block that only
illustrates (it reads a file or data the page does not define) is preceded by
the comment ``<!-- illustration: not run -->``.
"""

from __future__ import annotations

import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).parents[1]
PAGES = [
    ROOT / "README.md",
    *sorted((ROOT / "docs").glob("*.md")),
    *sorted((ROOT / "docs" / "widgets").glob("*.md")),
]
SKIP_MARK = "<!-- illustration: not run -->"
BLOCK = re.compile(r"(?P<before>[^\n]*\n)?```python\n(?P<code>.*?)```", re.DOTALL)


def blocks(page: pathlib.Path) -> list[tuple[int, str]]:
    text = page.read_text(encoding="utf-8")
    out = []
    for m in BLOCK.finditer(text):
        before = text[: m.start("code")].rstrip().rsplit("\n", 2)
        if any(SKIP_MARK in line for line in before[-2:]):
            continue
        # blocks indented in an admonition or a list keep their indentation
        code = m.group("code")
        indent = min(
            (len(line) - len(line.lstrip()) for line in code.splitlines() if line.strip()),
            default=0,
        )
        code = "\n".join(line[indent:] for line in code.splitlines())
        out.append((text[: m.start()].count("\n") + 1, code))
    return out


@pytest.mark.parametrize(
    "page",
    [p for p in PAGES if blocks(p)],
    ids=lambda p: str(p.relative_to(ROOT / "docs")) if p.parent.name == "widgets" else p.name,
)
def test_python_examples_run(page: pathlib.Path) -> None:
    # the pages write `ai` and `np` for the package and numpy, as the examples do
    namespace: dict[str, object] = {"__name__": f"docs_{page.stem}"}
    exec("import numpy as np\nimport anywidget_instruments as ai", namespace)
    for line, code in blocks(page):
        try:
            exec(compile(code, f"{page.name}:{line}", "exec"), namespace)
        except Exception as exc:  # pragma: no cover - the failure message is the point
            pytest.fail(f"{page.name}, block at line {line}: {type(exc).__name__}: {exc}")


def test_every_widget_is_documented() -> None:
    """Each exported widget is in the catalog, the API reference and the host coverage table."""
    import anywidget_instruments as ai

    abstract = {
        "InstrumentWidget",
        "NumericWidget",
        "BooleanWidget",
        "GraphWidget",
        "ProcessObject",
    }
    widgets = sorted(
        name
        for name in ai.__all__
        if isinstance(getattr(ai, name), type)
        and issubclass(getattr(ai, name), ai.InstrumentWidget)
        and name not in abstract
    )
    docs = ROOT / "docs"
    catalog = (docs / "widgets.md").read_text(encoding="utf-8")
    api = (docs / "api.md").read_text(encoding="utf-8")
    hosts = (docs / "hosts.md").read_text(encoding="utf-8")
    missing = {
        "widgets.md": [w for w in widgets if f"`{w}`" not in catalog],
        "api.md": [w for w in widgets if f"anywidget_instruments.{w}\n" not in api],
        "hosts.md": [w for w in widgets if f"`{w}`" not in hosts],
    }
    assert missing == {"widgets.md": [], "api.md": [], "hosts.md": []}


def page_name(cls: str) -> str:
    """Page of a widget, as js/scripts/widget-pages.mjs names it: PIDFaceplate -> pid-faceplate."""
    name = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1-\2", cls)
    return re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", name).lower()


def test_every_widget_has_a_page_and_pictures() -> None:
    """DOC-008: a page per widget, with its picture in the light and the dark theme."""
    import anywidget_instruments as ai

    abstract = {
        "InstrumentWidget",
        "NumericWidget",
        "BooleanWidget",
        "GraphWidget",
        "ProcessObject",
    }
    docs = ROOT / "docs"
    missing = []
    for name in ai.__all__:
        cls = getattr(ai, name)
        if not (isinstance(cls, type) and issubclass(cls, ai.InstrumentWidget)) or name in abstract:
            continue
        page = docs / "widgets" / f"{page_name(name)}.md"
        needed = [page] + [
            docs / "img" / "widgets" / f"{page_name(name)}-{scheme}.png"
            for scheme in ("light", "dark")
        ]
        missing += [str(p.relative_to(ROOT)) for p in needed if not p.exists()]
        if page.exists() and f"# {name}\n" not in page.read_text(encoding="utf-8"):
            missing.append(f"{page.relative_to(ROOT)}: title")
    assert missing == []


#: Pages of the safety-related widgets and the notice each must show (DOC-007).
SAFETY_PAGES = {
    "EmergencyStop": "not an emergency stop device",
    "AlarmIndicator": "not a safety-related system",
    "AlarmBanner": "not a safety-related system",
    "Annunciator": "not a safety-related system",
    "AlarmList": "not a safety-related system",
    "PIDFaceplate": "not a safety-related system",
    "StateMachine": "not a safety-related system",
}


@pytest.mark.parametrize("name", sorted(SAFETY_PAGES))
def test_safety_related_widget_pages_show_the_safety_notice(name: str) -> None:
    """DOC-007: the page of a safety-related widget warns before its example."""
    text = (ROOT / "docs" / "widgets" / f"{page_name(name)}.md").read_text(encoding="utf-8")
    notice = text.split("## Example")[0].lower()
    assert "!!! danger" in notice and SAFETY_PAGES[name] in notice
    assert "(../safety.md)" in notice
