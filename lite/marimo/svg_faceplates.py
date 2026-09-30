# SVG faceplates (in-browser demo): front panels drawn in a vector editor,
# animated from Python; advanced by a marimo refresh clock (no threads).
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
    import anywidget_instruments as ai

    return (ai,)


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    [⬅ Back to the examples](https://anywidgetinstruments.github.io/anywidget-instruments-industrial/try/)

    # SVG faceplates

    Every panel below is an SVG drawing, as a designer would draw it in a
    vector editor. Elements labelled `awi:<role>=<name>` are animated from
    Python (a needle turns, a level rises, a lamp lights) or act as controls
    (a position of the selector, the FILL and DRAIN push buttons); the rest is
    decoration. The five drawings are the templates shipped with the library.

    Turn the **selector** to HAND and hold **FILL** or **DRAIN**; in AUTO the
    pump keeps the tank between 20 % and 80 % while the process draws water.
    The level transmitter sends 0 to 10 V to the **voltmeter**; the
    **pressure gauge** shows the pump discharge pressure.

    > **The code is hidden.** To see it, open the **⋯** menu at the top right
    > and choose **Show code**; in the marimo editor, click a cell's collapsed code.
    """)
    return


@app.cell(hide_code=True)
def _(ai):
    ai.theme_switch()  # light / system / dark theme (STYLE-008)
    return


@app.cell(hide_code=True)
def _(ai):
    tank = ai.SvgPanel.template("tank", label="Tank T-101", size=(220, 250))
    selector = ai.SvgPanel.template("selector", label="Pump mode", size=(190, 210))
    lamp = ai.SvgPanel.template("pilot_lamp", mode="indicator", label="Pump", size=(140, 190))
    voltmeter = ai.SvgPanel.template("voltmeter", mode="indicator", label="LT-101 signal")
    gauge = ai.SvgPanel.template(
        "pressure_gauge", mode="indicator", label="Discharge pressure", size=(210, 230)
    )
    tank.update(value=50.0, high=False, fill=False, drain=False)
    selector.update(value=1, mode="HAND")
    lamp.update(value=False, caption="Pump P-101")
    MODES = {0: "OFF", 1: "HAND", 2: "AUTO"}
    sim = {"auto_fill": False}

    def tick():
        """Advance the process by one second."""
        mode = MODES.get(int(selector["value"] or 0), "OFF")
        level = float(tank["value"] or 0.0)
        if mode == "HAND":
            pumping = bool(tank["fill"])
            level += (6.0 if pumping else 0.0) - (6.0 if tank["drain"] else 0.0)
        elif mode == "AUTO":
            if level < 20:
                sim["auto_fill"] = True
            elif level > 80:
                sim["auto_fill"] = False
            pumping = sim["auto_fill"]
            level += (8.0 if pumping else 0.0) - 3.0
        else:
            pumping = False
        level = min(100.0, max(0.0, level))
        with ai.batch():
            tank.update(value=level, high=level > 85)
            selector["mode"] = mode
            lamp["value"] = pumping
            voltmeter["value"] = level / 10.0  # 0-10 V transmitter signal
            gauge["value"] = 5.5 + level * 0.02 if pumping else 0.2

    return gauge, lamp, selector, tank, tick, voltmeter


@app.cell(hide_code=True)
def _(mo):
    clock = mo.ui.refresh(options=["1s"], default_interval="1s", label="Simulation clock")
    return (clock,)


@app.cell(hide_code=True)
def _(clock, gauge, lamp, mo, selector, tank, voltmeter):
    mo.vstack(
        [
            mo.hstack([tank, selector, lamp], justify="start"),
            mo.hstack([voltmeter, gauge], justify="start"),
            clock,
        ]
    )
    return


@app.cell(hide_code=True)
def _(clock, tick):
    _ = clock.value  # re-run once per clock tick
    tick()
    return


if __name__ == "__main__":
    app.run()
