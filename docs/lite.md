# Try it in the browser

The documentation site ships a <a href="../lite/lab/index.html">JupyterLite</a> deployment
(DOC-006) with the gallery notebook: Python runs in your browser through
Pyodide, nothing to install.

```python
%pip install anywidget-instruments   # first cell of the notebooks in JupyterLite
```

!!! note
    Pyodide has no threads: stale-data detection (heartbeats) is disabled
    and the live simulations of the examples that use `threading` do not run
    there. Use a local Jupyter or marimo for those.
