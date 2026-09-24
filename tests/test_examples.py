"""Execute the example notebooks (DOC-002, DOC-004) headless."""

import pathlib

import pytest

nbformat = pytest.importorskip("nbformat")
nbclient = pytest.importorskip("nbclient")

EXAMPLES = sorted((pathlib.Path(__file__).parents[1] / "examples").glob("*.ipynb"))


@pytest.mark.parametrize("path", EXAMPLES, ids=[p.stem for p in EXAMPLES])
def test_example_runs(path, monkeypatch):
    monkeypatch.setenv("AWI_EXAMPLE_SECONDS", "1")
    nb = nbformat.read(path, as_version=4)
    nb.cells.append(nbformat.v4.new_code_cell("import time; time.sleep(1.5)"))
    client = nbclient.NotebookClient(nb, timeout=120, kernel_name="python3")
    client.execute()
    errors = [
        o
        for c in nb.cells
        if c.cell_type == "code"
        for o in c.get("outputs", [])
        if o.get("output_type") == "error"
        or (o.get("name") == "stderr" and "Traceback" in o.get("text", ""))
    ]
    assert not errors, errors
