# Try it in the browser

The demos are [marimo](https://marimo.io) reactive apps that run in your
browser: Python runs through Pyodide, so there is nothing to install. The
first load downloads the Python runtime and takes a few seconds. Each demo is
also available as a notebook in [JupyterLite](https://jupyterlite.readthedocs.io)
(DOC-006).

!!! note
    The demos and examples simulate processes and machines; they are not
    meant to control real equipment (see the [safety notice](safety.md)).


| Demo (marimo) | What it shows | Also in JupyterLite |
|---|---|---|
| <a href="../marimo/gallery/">**Gallery**</a> | Every widget family: knobs and indicators, Boolean controls, charts, alarms, styles | <a href="../lite/lab/index.html?path=gallery.ipynb">notebook</a> |
| <a href="../marimo/pid_tuning/">**PID tuning**</a> | Closed-loop step response of a process with dead time; overshoot and settling time follow the Kp, Ti, Td knobs | <a href="../lite/lab/index.html?path=pid_tuning.ipynb">notebook</a> |
| <a href="../marimo/operator_station/">**Operator station**</a> | Filling line following the machine state model, with stack light, PID faceplate, annunciator and alarm list | <a href="../lite/lab/index.html?path=operator_station.ipynb">notebook</a> |
| <a href="../marimo/signal_analysis/">**Signal analysis**</a> | Waveform selector, frequency and noise knobs; signal, spectrum, RMS level and dominant frequency | <a href="../lite/lab/index.html?path=signal_analysis.ipynb">notebook</a> |

The marimo apps show their code next to the outputs: cells that read a
control re-run when it changes. In JupyterLite, run all the cells first;
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
