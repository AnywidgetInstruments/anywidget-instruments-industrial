# Operator station (in-browser demo): a filling line following the machine
# state model, advanced by a marimo refresh clock (no threads in the browser).
import marimo

app = marimo.App(width="medium")


@app.cell
def _():
    import sys

    import marimo as mo

    return mo, sys


@app.cell
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


@app.cell
def _(installed):
    assert installed
    import numpy as np

    import anywidget_instruments as ai

    return ai, np


@app.cell
def _(ai):
    ai.theme_switch()  # light / dark widgets (STYLE-007)
    return


@app.cell
def _(mo):
    mo.md("""
    # Operator station

    A filling line follows the machine state model: press **Reset**, then
    **Start**. Acting states (dashed) complete after two seconds. The stack
    light, the temperature loop, the annunciator and the alarm list follow the
    line; after 20 s in Execute the capper jams and the line suspends. The
    simulation clock below drives the model once per second.
    """)
    return


@app.cell
def _(ai):
    machine = ai.StateMachine(label="Line state", size=(560, 250))
    light = ai.StackLight(
        tiers=["red", "amber", "green"],
        labels=["Fault", "Attention", "Producing"],
        label="Stack light",
    )
    heater = ai.PIDFaceplate(
        tag="TIC-101",
        unit="°C",
        pv_max=90,
        hi=70,
        confirm_delta=10,
        label="Product temperature",
        controller=ai.PID(kp=4.0, ti=40.0, sp=55.0),
    )
    count = ai.SevenSegment(0, digits=6, decimals=0, label="Bottles", size=(180, 60))
    annunciator = ai.Annunciator(
        [("TAH-101", "Temp high", "red"), ("XA-401", "Capper jam", "amber")],
        sequence="R",
        first_out=True,
        columns=2,
        label="Annunciator",
        size=(260, 110),
    )
    alarms = ai.AlarmList(label="Alarm list", size=(600, 170))
    sim = {"temp": 25.0, "since": 0, "last": machine.value, "producing": 0, "jammed": False}
    return alarms, annunciator, count, heater, light, machine, sim


@app.cell
def _(mo):
    tick = mo.ui.refresh(options=["1s"], default_interval="1s", label="Simulation clock")
    return (tick,)


@app.cell
def _(alarms, annunciator, count, heater, light, machine, mo, tick):
    mo.vstack(
        [
            mo.hstack([machine, light], justify="start"),
            mo.hstack([heater, mo.vstack([count, annunciator])], justify="start"),
            alarms,
            tick,
        ]
    )
    return


@app.cell
def _(alarms, annunciator, count, heater, light, machine, sim, tick):
    _ = tick.value  # re-run once per clock tick
    PATTERN = {
        "Execute": {"green": "on"},
        "Starting": {"green": "blink"},
        "Held": {"amber": "on"},
        "Suspended": {"amber": "blink"},
        "Aborted": {"red": "blink"},
    }
    if machine.value != sim["last"]:
        sim["last"], sim["since"] = machine.value, 0
    sim["since"] += 1
    if machine.is_acting and sim["since"] >= 2:
        machine.state_complete()
    pattern = PATTERN.get(machine.value, {} if machine.value == "Stopped" else {"amber": "on"})
    light.value = [pattern.get(c, "off") for c in light.tiers]
    op = heater.step(sim["temp"], 1.0)
    sim["temp"] += (-(sim["temp"] - 20.0) + 0.9 * op) / 60.0
    if machine.value == "Execute":
        sim["producing"] += 1
        count.value = count.value + 4
        if sim["producing"] >= 20 and not sim["jammed"]:
            sim["jammed"] = True
            annunciator.set("XA-401", True)
            alarms.raise_alarm("XA-401", "Capper jam", source="XA-401", priority="medium")
            machine.command("Suspend")
    elif machine.value == "Unsuspending" and sim["jammed"]:
        sim["jammed"] = None  # jam cleared by the operator's Unsuspend
        annunciator.set("XA-401", False)
        alarms.clear_alarm("XA-401")
    hot = sim["temp"] > heater.hi
    if hot != (annunciator.state_of("TAH-101") != "normal"):
        annunciator.set("TAH-101", hot)
        if hot:
            alarms.raise_alarm("TAH-101", "Product temperature high", source="TIC-101")
        else:
            alarms.clear_alarm("TAH-101")
    return


if __name__ == "__main__":
    app.run()
