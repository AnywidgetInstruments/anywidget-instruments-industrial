# Batch reactor R-101 (in-browser showcase): a complete operator station on a
# simulated jacketed reactor, advanced by a marimo refresh clock (no threads).
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
    import time

    import anywidget_instruments as ai

    return ai, time


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    [⬅ Back to the examples](https://s-celles.github.io/anywidget-instruments/examples/)

    # Batch reactor R-101: a complete operator station

    A jacketed batch reactor, fully simulated: a feed pump and valve fill it,
    an agitator stirs it, a PID loop heats the jacket, a drain pump empties
    it. A **PackML state machine** runs the batch through the phases of the
    **recipe** (Fill, Heat, React, Cool, then the drain in Completing).

    1. Press **Reset**, then **Start**: the stack light turns green, the valves
       and pumps follow the phases, the trend draws level, temperature and
       heater output, and the event log records every command and state.
    2. While the reactor is **Idle** or **Complete**, edit the recipe (level,
       temperatures, hold time): the next batch uses it.
    3. Press **AGITATOR TRIP**: an alarm is raised, the batch is held and the
       plant model shows the fault. Press **FAULT RESET**, then **Unhold**.
    4. Use the faceplate to change the temperature loop to manual, or **Stop**
       and **Abort** the batch at any time.

    One clock tick simulates 5 s. **References:** ISA-TR88.00.02 (PackML
    states), ISA-88 / IEC 61512-1 (recipe phases), ISA-101 (faceplate),
    ISA-18.2 / IEC 62682 (alarm list), IEC 60073 (stack light), IEC 62264
    (equipment hierarchy). These standards inspired the widgets; the library
    does not claim conformity with them ([Standards and
    references](https://s-celles.github.io/anywidget-instruments/standards/)).
    The simulation is not meant to control real equipment ([safety
    notice](https://s-celles.github.io/anywidget-instruments/safety/)).

    > **The code is hidden.** To see it, open the **⋯** menu at the top right
    > and choose **Show code**; in the marimo editor, click a cell's collapsed code.
    """)
    return


@app.cell(hide_code=True)
def _(ai):
    ai.theme_switch()  # light / system / dark theme (STYLE-008)
    return


@app.cell(hide_code=True)
def _(ai, time):
    DT = 5.0  # simulated seconds per clock tick
    AMBIENT = 20.0  # °C
    FEED, DRAIN = 0.05, 0.06  # m/s, feed and drain level rates
    HEAT_GAIN = 0.012  # °C/s per % of heater output
    LOSS = 0.004  # 1/s, heat loss to the ambient air
    COOLING = 0.3  # °C/s, jacket cooling water in the Cool phase

    # -- operator station ---------------------------------------------------------------
    machine = ai.StateMachine(label="R-101 state (PackML)", size=(560, 250))
    light = ai.StackLight(
        tiers=["red", "amber", "green"],
        labels=["Fault", "Attention", "Running"],
        label="Stack light",
    )
    batches = ai.KPITile(
        0, unit="batches", format="%.0f", target=3, label="Batches today", size=(240, 110)
    )
    recipe = ai.RecipeTable(
        columns=[
            {"name": "phase", "title": "Phase", "type": "text", "readonly": True},
            {"name": "level", "title": "Level", "unit": "m", "min": 0.5, "max": 3.5, "step": 0.1},
            {"name": "temp", "title": "Temperature", "unit": "°C", "min": 20, "max": 90, "step": 1},
            {"name": "hold", "title": "Hold", "unit": "s", "min": 0, "max": 600, "step": 5},
            {"name": "agitator", "title": "Agitator", "type": "choice", "choices": ["off", "on"]},
        ],
        value=[
            {"phase": "Fill", "level": 3.0, "temp": 20, "hold": 0, "agitator": "off"},
            {"phase": "Heat", "level": 3.0, "temp": 70, "hold": 0, "agitator": "on"},
            {"phase": "React", "level": 3.0, "temp": 70, "hold": 60, "agitator": "on"},
            {"phase": "Cool", "level": 3.0, "temp": 40, "hold": 0, "agitator": "on"},
        ],
        label="Recipe PR-12 (edit while Idle)",
        size=(560, 170),
    )
    # -- process ----------------------------------------------------------------------------
    level = ai.Tank(
        0.0, max=4, unit="m", format="%.2f", hi=3.6, show_limits=True, label="LT-101 level"
    )
    temp = ai.Thermometer(
        AMBIENT, min=0, max=100, unit="°C", hi=85, show_limits=True, label="TT-101"
    )
    tic = ai.PIDFaceplate(
        tag="TIC-101",
        unit="°C",
        pv_max=100,
        hi=85,
        op_unit="%",
        confirm_delta=15,
        label="Jacket temperature",
        controller=ai.PID(kp=10.0, ti=60.0, sp=70.0),
    )
    feed_valve = ai.Valve(mode="indicator", tag="XV-101", label="Feed valve")
    feed_pump = ai.Pump(mode="indicator", tag="P-101", label="Feed pump")
    agitator = ai.Motor(mode="indicator", tag="M-101", label="Agitator")
    drain_valve = ai.Valve(mode="indicator", tag="XV-102", label="Drain valve")
    drain_pump = ai.Pump(mode="indicator", tag="P-102", label="Drain pump")
    trip = ai.PushButton(
        text="AGITATOR TRIP", color="yellow", label="Simulate a fault", size=(170, 60)
    )
    reset = ai.PushButton(
        text="FAULT RESET", lamp=False, lamp_color="amber", label="Fault reset", size=(170, 60)
    )
    # -- supervision --------------------------------------------------------------------------
    trend = ai.TrendChart(
        pens=[
            {"name": "Level", "unit": "m", "min": 0, "max": 4},
            {"name": "Temperature", "unit": "°C", "min": 0, "max": 100, "hi": 85},
            {"name": "Heater", "unit": "%", "min": 0, "max": 100},
        ],
        span=180,
        label="Trend",
        size=(560, 220),
    )
    alarms = ai.AlarmList(label="Alarms", size=(560, 160))
    events = ai.EventLog(label="Event log", size=(560, 180))
    plant = ai.EquipmentTree(
        nodes=[
            {
                "label": "Plant",
                "level": "site",
                "children": [
                    {
                        "label": "Reactors",
                        "level": "area",
                        "children": [
                            {
                                "id": "R-101",
                                "label": "R-101 batch reactor",
                                "level": "unit",
                                "children": [
                                    {
                                        "id": "feed",
                                        "label": "Feed (P-101, XV-101)",
                                        "level": "equipment",
                                    },
                                    {
                                        "id": "heat",
                                        "label": "Heating (TIC-101)",
                                        "level": "equipment",
                                    },
                                    {
                                        "id": "agit",
                                        "label": "Agitator (M-101)",
                                        "level": "equipment",
                                    },
                                    {
                                        "id": "drain",
                                        "label": "Drain (P-102, XV-102)",
                                        "level": "equipment",
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
        expanded=["Plant", "Plant/Reactors", "R-101"],
        show_level=False,
        label="Plant model",
        size=(300, 220),
    )

    LIGHT = {
        "Execute": {"green": "on"},
        "Starting": {"green": "blink"},
        "Completing": {"green": "blink"},
        "Held": {"amber": "on"},
        "Holding": {"amber": "blink"},
        "Suspended": {"amber": "blink"},
        "Complete": {"amber": "on"},
        "Aborted": {"red": "blink"},
        "Aborting": {"red": "on"},
    }
    sim = {"state": machine.value, "since": 0, "phase": 0, "held": 0.0, "fault": False, "op": 0.0}

    def alarm(tag, on, message, priority="high"):
        """Raise or clear an alarm and log it once per change."""
        active = alarms.state_of(tag).startswith("active")
        if on and not active:
            alarms.raise_alarm(tag, message, source=tag.split(".")[0], priority=priority)
            events.log(message, source=tag, category="alarm")
        elif not on and active:
            alarms.clear_alarm(tag)

    @machine.on_change(names="last_command")
    def _command(change):
        if change["new"] != "SC":  # SC: an acting state completed
            events.log(f"Command {change['new']}", source="R-101", category="operator")

    @trip.on_change
    def _trip(change):
        if trip.read_latched() and not sim["fault"]:
            sim["fault"] = True
            reset.lamp, reset.lamp_blink = True, True
            alarm("M-101.TRIP", True, "Agitator M-101 overload trip")
            if machine.value in ("Execute", "Starting", "Unholding"):
                machine.command("Hold")

    @reset.on_change
    def _reset(change):
        if reset.read_latched() and sim["fault"]:
            sim["fault"] = False
            reset.lamp, reset.lamp_blink = False, False
            alarm("M-101.TRIP", False, "")
            events.log("Agitator fault reset", source="M-101", category="operator")

    def tick():
        """Advance the reactor by DT simulated seconds (one clock tick)."""
        state = machine.value
        if state != sim["state"]:
            sim["state"], sim["since"] = state, 0
            events.log(f"State {state}", source="R-101", category="state")
        sim["since"] += 1
        rows = recipe.value
        feeding = draining = heating = cooling = stirring = False
        phase = rows[sim["phase"]] if state == "Execute" and sim["phase"] < len(rows) else None
        # acting states complete after two ticks; restarting waits for the fault reset
        acting_done = sim["since"] >= 2 and (
            state in ("Resetting", "Holding", "Suspending", "Stopping", "Aborting", "Clearing")
            or (state in ("Starting", "Unholding", "Unsuspending") and not sim["fault"])
        )
        if acting_done:
            if state == "Resetting":
                sim["phase"] = 0
            machine.state_complete()
        elif phase is not None:
            name = phase["phase"]
            stirring = phase["agitator"] == "on"
            tic.sp = float(phase["temp"])
            if name == "Fill":
                feeding = level.value < phase["level"]
                done = not feeding
            elif name == "Heat":
                heating, done = True, temp.value >= phase["temp"] - 1.0
            elif name == "React":
                heating = True
                sim["held"] += DT
                done = sim["held"] >= phase["hold"]
            else:  # Cool
                cooling, done = True, temp.value <= phase["temp"]
            if done:
                events.log(f"Phase {name} done", source="R-101", category="state")
                sim["phase"], sim["held"] = sim["phase"] + 1, 0.0
                if sim["phase"] >= len(rows):
                    machine.state_complete()  # Execute -> Completing
        elif state == "Completing":
            draining = level.value > 0.05
            if not draining:
                machine.state_complete()
                batches.value = batches.value + 1
                batches.append(batches.value)
        stirring = stirring and not sim["fault"]
        # process
        op = tic.step(temp.value, DT) if heating else 0.0
        t = temp.value + DT * (
            HEAT_GAIN * op * (1.0 if stirring else 0.5) - LOSS * (temp.value - AMBIENT)
        )
        if cooling:
            t -= DT * COOLING
        lv = level.value + DT * ((FEED if feeding else 0.0) - (DRAIN if draining else 0.0))
        now = time.time()
        with ai.batch():
            level.value = min(max(lv, 0.0), level.max)
            temp.value = max(t, AMBIENT - 5)
            feed_valve.value = "open" if feeding else "closed"
            feed_pump.value = "running" if feeding else "stopped"
            drain_valve.value = "open" if draining else "closed"
            drain_pump.value = "running" if draining else "stopped"
            agitator.value = "fault" if sim["fault"] else ("forward" if stirring else "stopped")
            pattern = LIGHT.get(machine.value, {})
            if sim["fault"]:
                pattern = {**pattern, "red": "blink"}
            light.value = [pattern.get(c, "off") for c in light.tiers]
            recipe.mode = (
                "control" if machine.value in ("Idle", "Stopped", "Complete") else "indicator"
            )
            plant.set_status("feed", "running" if feeding else "normal")
            plant.set_status("heat", "running" if heating else "normal")
            plant.set_status(
                "agit", "fault" if sim["fault"] else ("running" if stirring else "normal")
            )
            plant.set_status("drain", "running" if draining else "normal")
            trend.add("Level", level.value, now)
            trend.add("Temperature", temp.value, now)
            trend.add("Heater", op, now)
        alarm("TT-101.HI", temp.value > 85, "Reactor temperature high")
        alarm("LT-101.HI", level.value > 3.6, "Reactor level high")

    return (
        agitator,
        alarms,
        batches,
        drain_pump,
        drain_valve,
        events,
        feed_pump,
        feed_valve,
        level,
        light,
        machine,
        plant,
        recipe,
        reset,
        temp,
        tic,
        tick,
        trend,
        trip,
    )


@app.cell(hide_code=True)
def _(mo):
    clock = mo.ui.refresh(options=["1s"], default_interval="1s", label="Simulation clock")
    return (clock,)


@app.cell(hide_code=True)
def _(
    agitator,
    alarms,
    batches,
    clock,
    drain_pump,
    drain_valve,
    events,
    feed_pump,
    feed_valve,
    level,
    light,
    machine,
    mo,
    plant,
    recipe,
    reset,
    temp,
    tic,
    trend,
    trip,
):
    mo.vstack(
        [
            mo.hstack([machine, mo.vstack([light, batches])], justify="start"),
            mo.hstack([level, temp, tic], justify="start"),
            mo.hstack([feed_valve, feed_pump, agitator, drain_valve, drain_pump], justify="start"),
            mo.hstack([trip, reset, clock], justify="start"),
            mo.hstack([trend, plant], justify="start"),
            mo.hstack([recipe, alarms], justify="start", wrap=True),
            events,
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
