# Switches (in-browser demo): two-position switches, multi-position and
# spring-return selectors and a four-position rotary selector (BOOL-002..005,
# IND-010..013).
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

    # Switches and selectors

    Two-position switches keep their state; selectors choose one of several
    positions; a spring-return position goes back to the rest position when
    released. Operate them with the mouse, by touch, with the keyboard, or
    through the list under each selector.

    **References:** IEC 60073 (lamp colors), ISA-5.1 (pump and motor
    symbols). These standards inspired the widgets; the library does not
    claim conformity with them ([Standards and
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
def _(mo):
    mo.md("## Two-position switches")
    return


@app.cell(hide_code=True)
def _(ai, mo):
    toggle = mo.ui.anywidget(ai.ToggleSwitch(label="Pump P1"))
    rocker = mo.ui.anywidget(ai.RockerSwitch(label="Heater"))
    slide = mo.ui.anywidget(ai.SlideSwitch(True, label="Lighting"))
    key = mo.ui.anywidget(
        ai.SelectorSwitch("OFF", positions=["OFF", "ON"], keyed=True, label="Maintenance key")
    )
    mo.hstack([toggle, rocker, slide, key], justify="start")
    return key, rocker, slide, toggle


@app.cell(hide_code=True)
def _(ai, key, mo, rocker, slide, toggle):
    mo.hstack(
        [
            ai.LED(toggle.value["value"], label="P1 running", size=(60, 60)),
            ai.LED(rocker.value["value"], on_color="#f59e0b", label="Heating", size=(60, 60)),
            ai.LED(slide.value["value"], on_color="#fde047", label="Lights on", size=(60, 60)),
            ai.LED(
                key.value["value"] == "ON",
                on_color="#3b82f6",
                label="Maintenance mode",
                size=(60, 60),
            ),
        ],
        justify="start",
    )
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ## Multi-position selectors

    **Pump mode** is the usual HAND / OFF / AUTO selector. **Jog** has two
    spring-return positions: REV and FWD hold only while you keep the
    selector there, then it returns to 0.
    """)
    return


@app.cell(hide_code=True)
def _(ai, mo):
    pump_mode = mo.ui.anywidget(
        ai.SelectorSwitch("OFF", positions=["HAND", "OFF", "AUTO"], label="Pump mode")
    )
    jog = mo.ui.anywidget(
        ai.SelectorSwitch(
            "0",
            positions=["REV", "0", "FWD"],
            spring_return=["REV", "FWD"],
            default_position="0",
            label="Jog",
        )
    )
    mo.hstack([pump_mode, jog], justify="start")
    return jog, pump_mode


@app.cell(hide_code=True)
def _(ai, jog, mo, pump_mode):
    _state = {"REV": "reverse", "0": "stopped", "FWD": "forward"}[jog.value["value"]]
    _mode = pump_mode.value["value"]
    mo.hstack(
        [
            ai.Pump(
                value="stopped" if _mode == "OFF" else "running",
                mode="indicator",
                auto=_mode == "AUTO",
                label=f"Pump P2 ({_mode})",
            ),
            ai.Motor(value=_state, mode="indicator", label="Conveyor motor"),
        ],
        justify="start",
    )
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ## Four-position rotary selector

    A fan speed selector: OFF and three speeds. The gauge shows the fan speed.
    """)
    return


@app.cell(hide_code=True)
def _(ai, mo):
    fan = mo.ui.anywidget(
        ai.SelectorSwitch("OFF", positions=["OFF", "1", "2", "3"], label="Fan speed")
    )
    fan
    return (fan,)


@app.cell(hide_code=True)
def _(ai, fan):
    ai.Gauge(
        {"OFF": 0, "1": 600, "2": 1200, "3": 1800}[fan.value["value"]],
        max=2000,
        unit="rpm",
        format="%.0f",
        label="Fan speed (rpm)",
    )
    return


if __name__ == "__main__":
    app.run()
