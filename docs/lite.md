# Try it in the browser

Two in-browser deployments ship with the documentation site (DOC-006). Python
runs in your browser through Pyodide, so there is nothing to install. The first
load downloads the Python runtime, which takes a few seconds.

| | |
|---|---|
| <a href="../marimo/index.html">**marimo**</a> | A reactive notebook: turn a knob and the cells that read it re-run. You can edit the code. |
| <a href="../lite/lab/index.html?path=gallery.ipynb">**JupyterLite**</a> | The gallery notebook with every widget, in JupyterLab. Run all the cells, then use the controls. |

The package is not on the package index yet, so both deployments install the
wheel built with this site:

```python
%pip install anywidget-instruments   # JupyterLite: first cell of the notebooks
```

In marimo, the first cell of the notebook installs the wheel with `micropip`.

!!! note
    Pyodide has no threads. Stale-data detection (heartbeats) is off, and
    the live simulations of the examples that use `threading` do not run.
    Use a local Jupyter or marimo for those.
