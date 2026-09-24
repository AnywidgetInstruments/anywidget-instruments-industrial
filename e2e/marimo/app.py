import marimo

app = marimo.App()


@app.cell
def _():
    import marimo as mo

    import anywidget_instruments as ai

    return ai, mo


@app.cell
def _(ai, mo):
    knob = mo.ui.anywidget(ai.Knob(10, step=1, label="Marimo knob"))
    knob
    return (knob,)


@app.cell
def _(ai, knob):
    ai.SevenSegment(knob.value["value"] * 2, digits=4, decimals=0, label="Marimo double")
    return


@app.cell
def _(ai):
    import numpy as np

    chart = ai.WaveformChart(label="Marimo chart", history=50)
    chart.append(np.linspace(0, 0.5, 50))
    chart
    return


if __name__ == "__main__":
    app.run()
