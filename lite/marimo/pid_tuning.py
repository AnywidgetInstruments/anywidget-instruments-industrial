# PID tuning (in-browser demo): the closed-loop response of a first-order
# process with dead time is recomputed whenever a knob moves.
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

    # PID tuning

    A first-order process with dead time, `K = 2`, `τ = 20 s`, `θ = 4 s`, is
    controlled by a PID (derivative on the measurement, anti-windup). The
    setpoint steps from 20 to 50 at t = 10 s. Turn the knobs: marimo recomputes
    the closed-loop response and the indicators.

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
    kp = mo.ui.anywidget(ai.Knob(1.2, min=0, max=5, step=0.05, label="Kp", size=(120, 120)))
    ti = mo.ui.anywidget(ai.Knob(20, min=1, max=100, step=1, unit="s", label="Ti", size=(120, 120)))
    td = mo.ui.anywidget(ai.Knob(0, min=0, max=20, step=0.5, unit="s", label="Td", size=(120, 120)))
    mo.hstack([kp, ti, td], justify="start")
    return kp, td, ti


@app.cell(hide_code=True)
def _(ai, np):
    def closed_loop(kp, ti, td, gain=2.0, tau=20.0, delay=4.0, dt=0.2, duration=200.0):
        """SP, PV and OP of the loop, one row per sample."""
        pid = ai.PID(kp=kp, ti=ti, td=td, sp=20.0, output=10.0)
        pipe = [10.0] * int(delay / dt)  # dead time
        y = 20.0
        rows = []
        for k in range(int(duration / dt)):
            pid.sp = 50.0 if k * dt >= 10.0 else 20.0
            u = pid.step(y, dt)
            pipe.append(u)
            y += dt / tau * (-y + gain * pipe.pop(0))
            rows.append((pid.sp, y, u))
        return np.array(rows)

    def metrics(rows, dt=0.2):
        pv = rows[int(10.0 / dt) :, 1]
        overshoot = max(0.0, (pv.max() - 50.0) / 30.0 * 100.0)
        outside = np.nonzero(np.abs(pv - 50.0) > 0.02 * 30.0)[0]
        settling = (outside[-1] + 1) * dt if len(outside) else 0.0
        return overshoot, settling

    return closed_loop, metrics


@app.cell(hide_code=True)
def _(ai, closed_loop, kp, metrics, mo, td, ti):
    rows = closed_loop(kp.value["value"], ti.value["value"], td.value["value"])
    overshoot, settling = metrics(rows)
    chart = ai.WaveformChart(
        n_traces=3,
        history=len(rows),
        dt=0.2,
        x_unit="s",
        y_min=0,
        y_max=100,
        traces=[{"name": "SP"}, {"name": "PV"}, {"name": "OP"}],
        label="Step response",
        size=(620, 240),
    )
    chart.append(rows)
    mo.vstack(
        [
            chart,
            mo.hstack(
                [
                    ai.AnalogIndicator(
                        overshoot, max=50, unit="%", normal_hi=10, hi=20, label="Overshoot"
                    ),
                    ai.AnalogIndicator(
                        settling,
                        max=190,
                        unit="s",
                        normal_hi=60,
                        hi=120,
                        label="Settling time (2 %)",
                    ),
                ],
                justify="start",
            ),
        ]
    )
    return


if __name__ == "__main__":
    app.run()
