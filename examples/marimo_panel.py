import marimo

app = marimo.App()


@app.cell
def _():
    import marimo as mo

    import anywidget_instruments as ai

    return ai, mo


@app.cell
def _(ai, mo):
    setpoint = mo.ui.anywidget(ai.Knob(50, step=1, unit="%", label="Setpoint"))
    run = mo.ui.anywidget(ai.ToggleSwitch(label="Run"))
    mo.hstack([setpoint, run])
    return run, setpoint


@app.cell
def _(ai, run, setpoint):
    # re-executed by marimo whenever the knob or the switch changes (GEN-011)
    level = setpoint.value["value"] if run.value["value"] else 0.0
    ai.Tank(level, unit="%", label="Level", hi=90, show_limits=True)
    return


if __name__ == "__main__":
    app.run()
