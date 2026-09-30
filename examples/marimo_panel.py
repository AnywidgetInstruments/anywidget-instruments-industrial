import marimo

app = marimo.App()


@app.cell(hide_code=True)
def _():
    import marimo as mo

    import anywidget_instruments_industrial as ai

    return ai, mo


@app.cell(hide_code=True)
def _(mo):
    mo.md(
        """
        [⬅ Back to the examples](https://anywidgetinstruments.github.io/anywidget-instruments-industrial/examples/)

        > **The code is hidden.** To see it, open the **⋯** menu at the top right
        > and choose **Show code**; in the marimo editor, click a cell's collapsed code.
        """
    )
    return


@app.cell(hide_code=True)
def _(ai):
    ai.theme_switch()  # light / system / dark theme (STYLE-008)
    return


@app.cell(hide_code=True)
def _(ai, mo):
    setpoint = mo.ui.anywidget(ai.Knob(50, step=1, unit="%", label="Setpoint"))
    run = mo.ui.anywidget(ai.ToggleSwitch(label="Run"))
    mo.hstack([setpoint, run])
    return run, setpoint


@app.cell(hide_code=True)
def _(ai, run, setpoint):
    # re-executed by marimo whenever the knob or the switch changes (GEN-011)
    level = setpoint.value["value"] if run.value["value"] else 0.0
    ai.Tank(level, unit="%", label="Level", hi=90, show_limits=True)
    return


if __name__ == "__main__":
    app.run()
