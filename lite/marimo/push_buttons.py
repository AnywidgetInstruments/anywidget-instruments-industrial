# Push buttons (in-browser demo): plain and illuminated push buttons of a
# machine panel, their mechanical actions and their lamps (BOOL-006, BOOL-015).
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

    # Push buttons

    Machine panel push buttons. A plain button only sends commands; an
    illuminated button also has a lamp, lit by the program to show a state
    (running, stopped, fault to reset). Cap and lamp colors follow IEC 60073:
    green to start, red to stop, amber for attention.

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
    mo.md("""
    ## Push buttons without a lamp

    **START** and **STOP** *latch when released*: each press is kept until
    the program reads it, so no press is lost. **JOG** is *switch until
    released*: the motor turns only while you hold it (mouse, touch, or
    Space / Enter on the focused button).
    """)
    return


@app.cell(hide_code=True)
def _(ai, mo):
    start = ai.PushButton(text="START", color="green", label="Start")
    stop = ai.PushButton(text="STOP", color="red", shape="round", label="Stop")
    jog = ai.PushButton(
        text="JOG", color="black", mechanical_action="switch_until_released", label="Jog (hold)"
    )
    motor = ai.Motor(mode="indicator", label="Motor M1")
    presses = ai.SevenSegment(0, digits=4, decimals=0, label="Start presses", size=(150, 60))
    plain = {"run": False, "jog": False, "n": 0}

    def show_plain():
        motor.value = "forward" if plain["run"] or plain["jog"] else "stopped"

    @start.on_change
    def _(change):
        if start.read_latched():  # consume the press (BOOL-010)
            plain["run"] = True
            plain["n"] += 1
            presses.value = plain["n"]
            show_plain()

    @stop.on_change
    def _(change):
        if stop.read_latched():
            plain["run"] = False
            show_plain()

    @jog.on_change
    def _(change):
        plain["jog"] = bool(change["new"])
        show_plain()

    mo.hstack([start, stop, jog, motor, presses], justify="start", align="center")
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ## Illuminated push buttons

    The lamps show the machine state: **RUN** is lit while the machine runs,
    **STOP** while it is stopped. **FAULT** simulates a fault: the machine
    stops and **RESET** flashes amber until you press it. Hold **LAMP TEST**
    to light every lamp.
    """)
    return


@app.cell(hide_code=True)
def _(ai, mo):
    run_pb = ai.PushButton(text="RUN", shape="round", lamp=False, lamp_color="green", label="Run")
    halt_pb = ai.PushButton(text="STOP", shape="round", lamp=True, lamp_color="red", label="Halt")
    reset_pb = ai.PushButton(text="RESET", lamp=False, lamp_color="amber", label="Reset")
    fault_pb = ai.PushButton(text="FAULT", color="yellow", label="Simulate a fault")
    test_pb = ai.PushButton(
        text="LAMP TEST", mechanical_action="switch_until_released", label="Lamp test"
    )
    machine = ai.Motor(mode="indicator", label="Motor M2")
    lit = {"run": False, "fault": False, "test": False}

    def show_lamps():
        test = lit["test"]
        run_pb.lamp = test or lit["run"]
        halt_pb.lamp = test or not lit["run"]
        reset_pb.lamp = test or lit["fault"]
        reset_pb.lamp_blink = lit["fault"] and not test
        machine.value = "fault" if lit["fault"] else ("forward" if lit["run"] else "stopped")

    def on_press(button, action):
        @button.on_change
        def _(change):
            if button.read_latched():
                action()
                show_lamps()

    def run_machine():
        if not lit["fault"]:  # a fault must be reset before restarting
            lit["run"] = True

    def halt_machine():
        lit["run"] = False

    def fault_machine():
        lit.update(run=False, fault=True)

    def reset_fault():
        lit["fault"] = False

    on_press(run_pb, run_machine)
    on_press(halt_pb, halt_machine)
    on_press(fault_pb, fault_machine)
    on_press(reset_pb, reset_fault)

    @test_pb.on_change
    def _(change):
        lit["test"] = bool(change["new"])
        show_lamps()

    mo.hstack(
        [run_pb, halt_pb, reset_pb, machine, fault_pb, test_pb], justify="start", align="center"
    )
    return


if __name__ == "__main__":
    app.run()
