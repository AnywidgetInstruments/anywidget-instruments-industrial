# Operating modes (in-browser demo): the GEMMA, ISA-88 and PackML state models
# side by side; choosing a situation drives the three models to it.
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

    # Operating modes: GEMMA, ISA-88 and PackML

    Three ways of describing how a machine or a process runs and stops:

    * **GEMMA**, the running and stopping modes study guide (ADEPA, 1981),
      widely taught in France: 16 procedures seen from the operative part, in
      three families, A (stop and restart), F (operation) and D (failure);
    * **ISA-88 / IEC 61512-1** (batch control): the states and commands of a
      procedural element (a phase, an operation);
    * **ISA-TR88.00.02 (PackML)**: the machine states of packaging machines and
      lines.

    Choose a **situation** in the list: the three models go to the matching
    state through their own commands (the path taken is listed under the
    table). You can also operate each model with its command buttons.

    GEMMA describes modes (production, checks, tests) and states together;
    ISA-88 and PackML separate the mode (automatic, manual, maintenance) from
    the state within it, so the correspondence is approximate. The `D1`
    emergency stop is a procedure of the software model only: the emergency
    stop itself is a hardwired safety function.

    **References:** GEMMA (ADEPA, 1981), ISA-88 / IEC 61512-1 (procedural
    states), ISA-TR88.00.02 (PackML machine states). These references
    inspired the widgets; the library does not claim conformity with them
    ([Standards and
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
def _():
    # situation: (title, GEMMA, ISA-88, PackML, note)
    SITUATIONS = {
        "ready": ("Stopped, ready to start", "A1", "Idle", "Idle", ""),
        "startup": ("Start-up, warm-up", "F2", "Running", "Starting", ""),
        "production": ("Normal production", "F1", "Running", "Execute", ""),
        "waiting": (
            "Waiting for upstream or downstream",
            "F1",
            "Running",
            "Suspended",
            "Only PackML has a state for a starved or blocked machine.",
        ),
        "closing": (
            "Closing run (emptying)",
            "F3",
            "Running",
            "Completing",
            "ISA-88: the end of the procedure.",
        ),
        "end_of_cycle": ("Stop at the end of the cycle", "A2", "Complete", "Complete", ""),
        "given_state": ("Stop in a given state", "A4", "Paused", "Held", ""),
        "controlled": ("Controlled stop", "A3", "Stopped", "Stopped", ""),
        "checks": (
            "Checks and tests",
            "F5",
            "Idle",
            "Stopped",
            "ISA-88 and PackML: a manual or maintenance mode, not a state.",
        ),
        "diagnosis": ("Failure diagnosis", "D2", "Held", "Held", ""),
        "degraded": (
            "Running despite a failure",
            "D3",
            "Running",
            "Execute",
            "Not modeled by ISA-88 nor PackML.",
        ),
        "estop": ("Emergency stop", "D1", "Aborted", "Aborted", ""),
        "recovery": (
            "Back to the initial state after a failure",
            "A6",
            "Idle",
            "Resetting",
            "",
        ),
    }
    GROUPS = {
        "Running": ["startup", "production", "waiting", "closing", "degraded"],
        "Stopping": ["ready", "end_of_cycle", "given_state", "controlled"],
        "Checks": ["checks"],
        "Failures": ["diagnosis", "estop", "recovery"],
    }
    STATUS = {
        "production": "running",
        "degraded": "warning",
        "estop": "alarm",
        "diagnosis": "fault",
    }
    return GROUPS, SITUATIONS, STATUS


@app.cell(hide_code=True)
def _(ai):
    gemma = ai.StateMachine("gemma", label="GEMMA", size=(760, 400))
    isa88 = ai.StateMachine("isa88", label="ISA-88 procedural states", size=(520, 280))
    packml = ai.StateMachine("packml", label="PackML machine states", size=(560, 280))

    def goto(machine, state):
        """Drive `machine` to `state` through its own commands; return the path."""
        path = machine.path_to(state) or []
        for command in path:
            if command == "SC":
                machine.state_complete()  # an acting state completes
            else:
                machine.command(command)
        return path

    return gemma, goto, isa88, packml


@app.cell(hide_code=True)
def _(GROUPS, SITUATIONS, STATUS, ai, mo):
    situations = mo.ui.anywidget(
        ai.EquipmentTree(
            nodes=[
                {
                    "id": group,
                    "label": group,
                    "children": [
                        {"id": key, "label": SITUATIONS[key][0], "status": STATUS.get(key, "")}
                        for key in keys
                    ],
                }
                for group, keys in GROUPS.items()
            ],
            value="ready",
            expanded=list(GROUPS),
            show_level=False,
            label="Situation",
            size=(300, 420),
        )
    )
    return (situations,)


@app.cell(hide_code=True)
def _(SITUATIONS, gemma, goto, isa88, mo, packml, situations):
    _key = situations.value["value"]
    if _key not in SITUATIONS:
        _key = "ready"  # a group is selected: keep the models where they are
    _title, _g, _i, _p, _note = SITUATIONS[_key]
    _paths = [goto(gemma, _g), goto(isa88, _i), goto(packml, _p)]

    def _row(key):
        title, g, i, p, note = SITUATIONS[key]
        mark = "▶ " if key == _key else ""
        return f"| {mark}{title} | {g} | {i} | {p} | {note} |"

    _table = "\n".join(
        [
            "| Situation | GEMMA | ISA-88 | PackML | Note |",
            "|---|---|---|---|---|",
            *(_row(k) for k in SITUATIONS),
        ]
    )
    _path_text = "; ".join(
        f"{name}: {' → '.join(path) if path else 'already there'}"
        for name, path in zip(["GEMMA", "ISA-88", "PackML"], _paths, strict=True)
    )
    mo.vstack(
        [
            mo.hstack([situations, gemma], justify="start", align="start"),
            mo.hstack([isa88, packml], justify="start", align="start"),
            mo.md(
                f"**{_title}**: GEMMA `{gemma.value}` {gemma.state_title}, "
                f"ISA-88 `{isa88.value}`, PackML `{packml.value}`.\n\n"
                f"Commands applied ('SC': an acting state completes): {_path_text}\n\n{_table}"
            ),
        ]
    )
    return


if __name__ == "__main__":
    app.run()
