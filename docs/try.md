# Try it in the browser

Every demo below runs in your browser, in two flavours: as a
[marimo](https://marimo.io) reactive app, or as a notebook in
[JupyterLite](https://jupyterlite.readthedocs.io). Python runs in the browser
through Pyodide, so there is nothing to install. The first load downloads
the Python runtime and takes a few seconds (DOC-006).

| Demo | What it shows | marimo | JupyterLite |
|---|---|---|---|
| **Gallery** | Every widget family: knobs and indicators, Boolean controls, charts, alarms, styles | <a href="../marimo/gallery/">open</a> | <a href="../lite/lab/index.html?path=gallery.ipynb">open</a> |
| **PID tuning** | Closed-loop step response of a process with dead time; overshoot and settling time follow the Kp, Ti, Td knobs | <a href="../marimo/pid_tuning/">open</a> | <a href="../lite/lab/index.html?path=pid_tuning.ipynb">open</a> |
| **Operator station** | Filling line following the machine state model, with stack light, PID faceplate, annunciator and alarm list | <a href="../marimo/operator_station/">open</a> | <a href="../lite/lab/index.html?path=operator_station.ipynb">open</a> |
| **Signal analysis** | Waveform selector, frequency and noise knobs; signal, spectrum, RMS level and dominant frequency | <a href="../marimo/signal_analysis/">open</a> | <a href="../lite/lab/index.html?path=signal_analysis.ipynb">open</a> |

In **marimo**, the demos run as apps with their code shown: cells that read a
control re-run when it changes. In **JupyterLite**, run all the cells first;
callbacks then update the indicators.

The package is not on the package index yet, so both deployments install the
wheel built with this site (a `micropip` cell in marimo,
`%pip install anywidget-instruments` in JupyterLite).

!!! note
    Pyodide has no threads. Stale-data detection (heartbeats) is off, and
    the demos advance their simulations with a marimo refresh clock or an
    `asyncio` task instead of a thread. The examples of the
    [Examples](examples.md) page, which use threads, need a local Jupyter
    or marimo.

The sources are in the repository: `lite/marimo/*.py` (marimo) and
`lite/content/*.ipynb` (JupyterLite).
