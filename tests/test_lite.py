"""The in-browser demos (DOC-006) also run in a regular kernel / Python.

The browser runtimes themselves are exercised by e2e-site/ in the Docs
workflow; these tests catch code errors earlier and without network access.
"""

import pathlib
import subprocess
import sys

import pytest

nbformat = pytest.importorskip("nbformat")
nbclient = pytest.importorskip("nbclient")
pytest.importorskip("marimo")

LITE = pathlib.Path(__file__).parents[1] / "lite"
NOTEBOOKS = sorted((LITE / "content").glob("*.ipynb"))
MARIMO = sorted((LITE / "marimo").glob("*.py"))


@pytest.mark.parametrize("path", NOTEBOOKS, ids=[p.stem for p in NOTEBOOKS])
def test_jupyterlite_notebook_runs(path):
    nb = nbformat.read(path, as_version=4)
    nb.cells.append(nbformat.v4.new_code_cell("import asyncio; await asyncio.sleep(2.5)"))
    nbclient.NotebookClient(nb, timeout=120, kernel_name="python3").execute()
    errors = [
        o
        for c in nb.cells
        if c.cell_type == "code"
        for o in c.get("outputs", [])
        if o.get("output_type") == "error"
        or (o.get("name") == "stderr" and "Traceback" in o.get("text", ""))
    ]
    assert not errors, errors


@pytest.mark.parametrize("path", MARIMO, ids=[p.stem for p in MARIMO])
def test_marimo_notebook_runs(path):
    result = subprocess.run(
        [sys.executable, path.name], cwd=path.parent, capture_output=True, text=True, timeout=120
    )
    assert result.returncode == 0, result.stderr
    assert "Traceback" not in result.stderr, result.stderr
