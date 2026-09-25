# Try it in the browser

The demos are [marimo](https://marimo.io) reactive apps that run in your
browser: Python runs through Pyodide, so there is nothing to install. The
first load downloads the Python runtime and takes a few seconds. Each demo is
also available as a notebook in [JupyterLite](https://jupyterlite.readthedocs.io)
(DOC-006).

!!! note
    The demos and examples simulate processes and machines; they are not
    meant to control real equipment (see the [safety notice](safety.md)).


| Demo (marimo) | Sector | What it shows | Also in JupyterLite |
|---|---|---|---|
| <a href="../marimo/gallery/">**Gallery**</a> | All sectors | Every widget family: knobs and indicators, Boolean controls, charts, alarms, styles | <a href="../lite/lab/index.html?path=gallery.ipynb">notebook</a> |
| <a href="../marimo/pid_tuning/">**PID tuning**</a> | Chemical and process control | Closed-loop step response of a process with dead time; overshoot and settling time follow the Kp, Ti, Td knobs | <a href="../lite/lab/index.html?path=pid_tuning.ipynb">notebook</a> |
| <a href="../marimo/operator_station/">**Operator station**</a> | Food, beverage and packaging | Filling line following the machine state model, with stack light, PID faceplate, annunciator and alarm list | <a href="../lite/lab/index.html?path=operator_station.ipynb">notebook</a> |
| <a href="../marimo/signal_analysis/">**Signal analysis**</a> | Laboratory, test and measurement | Waveform selector, frequency and noise knobs; signal, spectrum, RMS level and dominant frequency | <a href="../lite/lab/index.html?path=signal_analysis.ipynb">notebook</a> |
| <a href="../marimo/lift_station/">**Lift station**</a> | Water and wastewater | Wet well with duty / standby pumps, alternation, level alarms, a pump trip and its reset | <a href="../lite/lab/index.html?path=lift_station.ipynb">notebook</a> |
| <a href="../marimo/operating_modes/">**Operating modes**</a> | Machines and processes (methods) | GEMMA, ISA-88 and PackML state models side by side; choosing a situation drives the three models to it through their own commands | <a href="../lite/lab/index.html?path=operating_modes.ipynb">notebook</a> |
| <a href="../marimo/push_buttons/">**Push buttons**</a> | Machine panels | Plain push buttons (latch, jog) and illuminated push buttons whose lamps show the machine state | <a href="../lite/lab/index.html?path=push_buttons.ipynb">notebook</a> |
| <a href="../marimo/switches/">**Switches and selectors**</a> | Machine panels | Two-position switches, HAND / OFF / AUTO and spring-return selectors, a four-position rotary selector | <a href="../lite/lab/index.html?path=switches.ipynb">notebook</a> |
| <a href="../marimo/virtual_instrument/">**Virtual instrument bench**</a> | Laboratory, test and measurement | Function generator, oscilloscope and multimeter front panels built from widgets | <a href="../lite/lab/index.html?path=virtual_instrument.ipynb">notebook</a> |

Each demo opens with a link back to this page and a light / system / dark
theme switch. The code is hidden: in marimo, choose **Show code** in the
**⋯** menu (top right); in JupyterLite, click the `⋯` bar above a result or
use **View ▸ Expand All Code**. In marimo, cells that read a control re-run
when it changes; in JupyterLite, run all the cells first, callbacks then
update the indicators.

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
