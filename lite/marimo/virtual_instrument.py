# Virtual instrument (in-browser demo): a bench with a function generator,
# an oscilloscope and a multimeter, each a front panel of widgets.
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

    # Virtual instrument bench

    Three instruments on one screen, as on a lab bench: a **function
    generator** feeds an **oscilloscope** and a **multimeter**. Each front
    panel is made of widgets: knobs and rotary selectors to set, an
    illuminated push button to switch the output on, a screen and a display
    to read. Turn a knob and the screen and the display follow.

    **References:** SI prefixes (engineering units). These standards
    inspired the widgets; the library does not claim conformity with them
    ([Standards and
    references](https://s-celles.github.io/anywidget-instruments/standards/)).

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
    # front panel controls, created once (their values drive the cells below)
    wave = mo.ui.anywidget(
        ai.SelectorSwitch("SIN", positions=["SIN", "SQR", "TRI", "SAW"], label="Waveform")
    )
    freq = mo.ui.anywidget(
        ai.Knob(1000, min=10, max=5000, step=10, unit="Hz", label="Frequency", size=(120, 120))
    )
    amp = mo.ui.anywidget(
        ai.Knob(1.0, min=0, max=5, step=0.1, unit="V", label="Amplitude", size=(120, 120))
    )
    offset = mo.ui.anywidget(
        ai.Knob(0.0, min=-2.5, max=2.5, step=0.1, unit="V", label="Offset", size=(120, 120))
    )
    _out = ai.PushButton(
        text="OUTPUT",
        mechanical_action="switch_when_pressed",
        lamp=False,
        lamp_color="green",
        label="Output",
    )
    # the lamp shows the output state (a callback must not use cell-private names)
    _out.on_change(lambda change: setattr(change["owner"], "lamp", bool(change["new"])))
    output = mo.ui.anywidget(_out)
    tdiv = mo.ui.anywidget(
        ai.SelectorSwitch(
            "0.5 ms", positions=["0.1 ms", "0.5 ms", "1 ms", "5 ms"], label="Time/div"
        )
    )
    vdiv = mo.ui.anywidget(
        ai.SelectorSwitch("1 V", positions=["0.5 V", "1 V", "2 V"], label="Volts/div")
    )
    dmm_fn = mo.ui.anywidget(
        ai.SelectorSwitch("VAC", positions=["VDC", "VAC", "Hz"], label="Function")
    )
    return amp, dmm_fn, freq, offset, output, tdiv, vdiv, wave


@app.cell(hide_code=True)
def _(ai):
    # screens and displays, updated in place by the measurement cell
    screen = ai.WaveformChart(
        history=500,
        update_mode="scope",
        x_unit="s",
        unit="V",
        traces=[{"name": "CH1"}],
        show_legend=False,
        label="Oscilloscope screen",
        size=(520, 240),
    )
    reading = ai.SevenSegment(0, digits=7, decimals=3, label="Multimeter reading", size=(230, 70))
    overload = ai.LED(False, on_color="#dc2626", label="OVL", size=(40, 40))
    return overload, reading, screen


@app.cell(hide_code=True)
def _(amp, dmm_fn, freq, mo, offset, output, overload, reading, screen, tdiv, vdiv, wave):
    def _box(title, *rows):
        return mo.callout(mo.vstack([mo.md(f"**{title}**"), *rows]), kind="neutral")

    mo.vstack(
        [
            _box(
                "Function generator",
                mo.hstack([wave, freq, amp, offset, output], justify="start", align="center"),
            ),
            mo.hstack(
                [
                    _box("Oscilloscope", screen, mo.hstack([tdiv, vdiv], justify="start")),
                    _box(
                        "Multimeter",
                        mo.hstack([reading, overload], justify="start", align="center"),
                        dmm_fn,
                    ),
                ],
                justify="start",
                align="start",
            ),
        ]
    )
    return


@app.cell(hide_code=True)
def _(amp, dmm_fn, freq, np, offset, output, overload, reading, screen, tdiv, vdiv, wave):
    # the signal at the generator output
    _on = bool(output.value["value"])
    _f = freq.value["value"]
    _a = amp.value["value"] if _on else 0.0
    _dc = offset.value["value"] if _on else 0.0
    _shape = wave.value["value"]
    _cycle = {  # one period sampled at phase x in [0, 1)
        "SIN": lambda x: np.sin(2 * np.pi * x),
        "SQR": lambda x: np.where(x < 0.5, 1.0, -1.0),
        "TRI": lambda x: 1 - 4 * np.abs(x - 0.5),
        "SAW": lambda x: 2 * x - 1,
    }[_shape]
    _rms = {
        "SIN": 1 / np.sqrt(2),
        "SQR": 1.0,
        "TRI": 1 / np.sqrt(3),
        "SAW": 1 / np.sqrt(3),
    }

    # oscilloscope: 10 divisions, 8 vertical divisions, triggered at phase 0
    _t_div = {"0.1 ms": 1e-4, "0.5 ms": 5e-4, "1 ms": 1e-3, "5 ms": 5e-3}[tdiv.value["value"]]
    _v_div = {"0.5 V": 0.5, "1 V": 1.0, "2 V": 2.0}[vdiv.value["value"]]
    _t = np.arange(screen.history) * (10 * _t_div / screen.history)
    screen.dt = 10 * _t_div / screen.history
    screen.y_min, screen.y_max = -4 * _v_div, 4 * _v_div
    screen.clear()
    screen.append(_dc + _a * _cycle((_t * _f) % 1.0))

    # multimeter
    _fn = dmm_fn.value["value"]
    _value = {"VDC": _dc, "VAC": _a * _rms[_shape], "Hz": _f if _a > 0 else 0.0}[_fn]
    reading.decimals = 0 if _fn == "Hz" else 3
    reading.value = _value
    overload.value = bool(_fn != "Hz" and abs(_value) > 9.999)
    return


if __name__ == "__main__":
    app.run()
