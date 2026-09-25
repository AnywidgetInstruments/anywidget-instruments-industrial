"""Every data file of the package is shipped in the wheel (pyproject.toml)."""

from __future__ import annotations

import fnmatch
import pathlib
import sys

if sys.version_info >= (3, 11):
    import tomllib
else:  # pragma: no cover
    tomllib = None

import pytest

ROOT = pathlib.Path(__file__).parents[1]
PACKAGE = ROOT / "src" / "anywidget_instruments"


@pytest.mark.skipif(tomllib is None, reason="tomllib needs Python 3.11")
def test_data_files_are_wheel_artifacts() -> None:
    # hatch's only-packages keeps only Python packages: files in directories
    # without __init__.py (schemas, SVG templates) must be listed as artifacts
    config = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    artifacts = config["tool"]["hatch"]["build"]["artifacts"]
    data = [
        p.relative_to(ROOT).as_posix()
        for p in PACKAGE.rglob("*")
        if p.is_file()
        and p.suffix not in (".py", ".pyc", ".typed")
        and "__pycache__" not in p.parts
        and not (p.parent / "__init__.py").exists()
    ]
    missing = [f for f in data if not any(fnmatch.fnmatch(f, a) for a in artifacts)]
    assert data and missing == []
