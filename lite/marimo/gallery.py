# Instrument gallery for the marimo WebAssembly export of the documentation
# site (DOC-006): `marimo export html-wasm` runs it in the browser through
# Pyodide. The package wheel is published next to the page (public/).
import marimo

app = marimo.App(width="medium")


@app.cell(hide_code=True)
def _():
    import sys

    import marimo as mo

    return mo, sys


@app.cell(hide_code=True)
async def _(mo, sys):
    # In the browser the package is not on the package index: install the
    # wheel built with the site. Locally it is already installed.
    if sys.platform == "emscripten":
        import micropip
        from pyodide.http import pyfetch

        _base = mo.notebook_location() / "public"
        _wheel = (await (await pyfetch(str(_base / "wheel.txt"))).string()).strip()
        await micropip.install(str(_base / _wheel))
    installed = True
    return (installed,)


@app.cell(hide_code=True)
def _(installed):
    assert installed
    import numpy as np

    import anywidget_instruments as ai

    return ai, np


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    [⬅ Back to the examples](https://s-celles.github.io/anywidget-instruments/try/)

    # anywidget-instruments in marimo

    Turn the knobs and flip the switch: marimo re-runs the cells that read
    them, and the indicators follow. Everything runs in your browser.

    > **The code is hidden.** To see it, open the **⋯** menu at the top right
    > and choose **Show code**; in the marimo editor, click a cell's collapsed code.
    """)
    return


@app.cell(hide_code=True)
def _(ai):
    ai.theme_switch()  # light / system / dark theme (STYLE-008)
    return


@app.cell(hide_code=True)
def _(ai, mo):
    setpoint = mo.ui.anywidget(ai.Knob(60, step=1, unit="%", label="Setpoint"))
    gain = mo.ui.anywidget(ai.Knob(1.0, min=0, max=2, step=0.05, label="Gain"))
    run = mo.ui.anywidget(ai.ToggleSwitch(True, label="Run"))
    mo.hstack([setpoint, gain, run], justify="start")
    return gain, run, setpoint


@app.cell(hide_code=True)
def _(ai, gain, mo, run, setpoint):
    level = setpoint.value["value"] * gain.value["value"] if run.value["value"] else 0.0
    level = min(level, 100.0)
    mo.hstack(
        [
            ai.Tank(level, unit="%", label="Level", hi=90, lo=10, show_limits=True),
            ai.Gauge(level, unit="%", label="Output", hi=80, hihi=95),
            ai.Thermometer(20 + level / 4, min=0, max=50, unit="°C", label="Temperature"),
            ai.LED(run.value["value"], label="Running"),
            ai.SevenSegment(level, digits=5, decimals=1, label="Display"),
        ],
        justify="start",
    )
    return (level,)


@app.cell(hide_code=True)
def _(ai, level, np):
    t = np.arange(500) / 100
    chart = ai.WaveformChart(
        n_traces=2,
        history=500,
        dt=0.01,
        x_unit="s",
        traces=[{"name": "setpoint"}, {"name": "response"}],
        autoscale_y=True,
        label="Step response",
        size=(560, 220),
    )
    chart.append(np.column_stack([np.full_like(t, level), level * (1 - np.exp(-t))]))
    chart
    return


if __name__ == "__main__":
    app.run()
