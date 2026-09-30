# Lift station (in-browser demo): a wastewater wet well with duty / standby
# pumps, alternation, level alarms and a pump fault (water and wastewater).
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

    # Lift station

    A sewage lift station: wastewater flows into a wet well and two pumps lift it
    to the treatment plant. In **AUTO** the duty pump starts at 2.2 m, the standby
    pump joins at 3.0 m, both stop at 1.0 m, and the duty alternates at each stop
    to share the wear. Raise the **inflow** (a storm) to see the standby pump
    start and the high-level alarms; **trip P-101** to see the standby take over,
    then **reset** the fault. One clock tick simulates 5 s.

    **References:** ISA-18.2 / IEC 62682 (alarm list), ISA-5.1 (tags, pump
    symbol), IEC 60073 (push-button colors). These standards inspired the
    widgets; the library does not claim conformity with them ([Standards and
    references](https://anywidgetinstruments.github.io/anywidget-instruments-industrial/standards/)).

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
    well = ai.Tank(
        1.2,
        min=0,
        max=4,
        unit="m",
        format="%.2f",
        lo=0.4,
        hi=3.0,
        hihi=3.5,
        deadband=0.05,
        show_limits=True,
        markers=[1.0, 2.2],
        label="Wet well level",
        size=(120, 240),
    )
    inflow = ai.Knob(18, min=0, max=60, step=1, unit="L/s", label="Inflow", size=(130, 130))
    mode = ai.SelectorSwitch("AUTO", positions=["HAND", "OFF", "AUTO"], label="Station mode")
    pumps = [
        ai.Pump(tag="P-101 DUTY", mode="indicator", label="P-101"),
        ai.Pump(tag="P-102 STBY", mode="indicator", label="P-102"),
    ]
    trip = ai.PushButton(text="TRIP P-101", color="yellow", label="Simulate a pump fault")
    reset = ai.PushButton(text="RESET", lamp=False, lamp_color="amber", label="Fault reset")
    outflow = ai.SevenSegment(0, digits=3, decimals=0, label="Outflow (L/s)", size=(130, 60))
    starts = ai.SevenSegment(0, digits=4, decimals=0, label="Pump starts", size=(130, 60))
    alarms = ai.AlarmList(label="Alarms", size=(600, 170))
    trend = ai.WaveformChart(
        history=360,
        dt=5.0,
        x_unit="s",
        unit="m",
        y_min=0,
        y_max=4,
        traces=[{"name": "level"}],
        show_legend=False,
        label="Level trend (30 min)",
        size=(520, 200),
    )

    AREA = 2.0  # wet well area, m²
    DT = 5.0  # simulated seconds per clock tick
    START, LAG, STOP = 2.2, 3.0, 1.0  # duty start, standby start, stop levels (m)
    PUMP_FLOW = 25.0  # L/s per pump
    LEVEL_TEXT = {"lo": "Wet well level low", "hi": "Wet well level high", "hihi": "Overflow risk"}
    sim = {"duty": 0, "run": [False, False], "fault": [False, False], "starts": 0}

    @well.on_change(names="alarm_level")
    def _level_alarms(change):
        """Level alarms in the alarm list (ALARM-004)."""
        old, new = change["old"], change["new"]
        if old in LEVEL_TEXT:
            alarms.clear_alarm(f"LS-100.{old.upper()}")
        if new in LEVEL_TEXT:
            alarms.raise_alarm(
                f"LS-100.{new.upper()}",
                LEVEL_TEXT[new],
                source="LS-100",
                priority="critical" if new == "hihi" else "high",
            )

    @trip.on_change
    def _trip(change):
        if trip.read_latched():
            sim["fault"][0] = True
            alarms.raise_alarm("P-101.FLT", "P-101 motor overload trip", source="P-101")
            reset.lamp, reset.lamp_blink = True, True

    @reset.on_change
    def _reset(change):
        if reset.read_latched() and any(sim["fault"]):
            sim["fault"] = [False, False]
            alarms.clear_alarm("P-101.FLT")
            reset.lamp, reset.lamp_blink = False, False

    def tick():
        """Advance the lift station by DT seconds."""
        level = well.value
        order = [sim["duty"], 1 - sim["duty"]]  # duty pump first, then standby
        healthy = [k for k in order if not sim["fault"][k]]
        was_running = [k for k in healthy if sim["run"][k]]
        if mode.value == "OFF":
            target = []
        elif mode.value == "HAND":  # duty pump runs, dry-run protection below LO
            target = healthy[:1] if level > well.lo else []
        else:  # AUTO: duty starts at START, standby joins at LAG, both stop at STOP
            n = len(was_running)
            if level >= LAG:
                n = 2
            elif level >= START:
                n = max(n, 1)
            elif level <= STOP:
                n = 0
            target = healthy[:n]
            if was_running and not target:
                sim["duty"] = 1 - sim["duty"]  # alternate the duty pump at each stop
        for k in (0, 1):
            if k in target and not sim["run"][k]:
                sim["starts"] += 1
            sim["run"][k] = k in target
        q_out = PUMP_FLOW * len(target)
        level += (inflow.value - q_out) / 1000.0 * DT / AREA
        with ai.batch():
            well.value = min(max(level, 0.0), well.max)
            for k, pump in enumerate(pumps):
                pump.value = (
                    "fault" if sim["fault"][k] else ("running" if sim["run"][k] else "stopped")
                )
                pump.auto = mode.value == "AUTO"
                pump.tag = f"P-10{k + 1} {'DUTY' if k == sim['duty'] else 'STBY'}"
            outflow.value = q_out
            starts.value = sim["starts"]
        trend.append([well.value])

    return alarms, inflow, mode, outflow, pumps, reset, starts, tick, trend, trip, well


@app.cell(hide_code=True)
def _(mo):
    clock = mo.ui.refresh(options=["1s"], default_interval="1s", label="Simulation clock")
    return (clock,)


@app.cell(hide_code=True)
def _(alarms, clock, inflow, mo, mode, outflow, pumps, reset, starts, trend, trip, well):
    mo.vstack(
        [
            mo.hstack([well, mo.vstack(pumps), mo.vstack([inflow, mode])], justify="start"),
            mo.hstack([outflow, starts, trip, reset], justify="start", align="center"),
            trend,
            alarms,
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
