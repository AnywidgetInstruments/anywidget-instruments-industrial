# Signal analysis (in-browser demo): a synthetic signal, its spectrum, RMS
# level and dominant frequency, recomputed when a control moves.
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
    # Signal analysis

    A 1 s record sampled at 2 kHz: choose the waveform, its frequency and the
    noise level. The spectrum, the RMS level and the dominant frequency follow.
    """)
    return


@app.cell
def _(ai, mo):
    shape = mo.ui.anywidget(
        ai.SelectorSwitch("SINE", positions=["SINE", "SQUARE", "TRIANGLE"], label="Waveform")
    )
    freq = mo.ui.anywidget(
        ai.Knob(50, min=1, max=200, step=1, unit="Hz", label="Frequency", size=(130, 130))
    )
    noise = mo.ui.anywidget(ai.Knob(0.1, min=0, max=1, step=0.01, label="Noise", size=(130, 130)))
    mo.hstack([shape, freq, noise], justify="start")
    return freq, noise, shape


@app.cell
def _(ai, freq, mo, noise, np, shape):
    fs, n = 2000.0, 2000
    t = np.arange(n) / fs
    f0 = freq.value["value"]
    phase = 2 * np.pi * f0 * t
    wave = {
        "SINE": np.sin(phase),
        "SQUARE": np.sign(np.sin(phase)),
        "TRIANGLE": 2 / np.pi * np.arcsin(np.sin(phase)),
    }[shape.value["value"]]
    x = wave + noise.value["value"] * np.random.default_rng(0).standard_normal(n)
    spectrum = np.abs(np.fft.rfft(x * np.hanning(n))) / (n / 4)
    peak = float(np.fft.rfftfreq(n, 1 / fs)[np.argmax(spectrum[1:]) + 1])
    rms = float(np.sqrt(np.mean(x**2)))

    signal = ai.WaveformChart(
        history=200,
        dt=1 / fs,
        x_unit="s",
        unit="V",
        y_min=-3,
        y_max=3,
        traces=[{"name": "x(t)"}],
        label="Signal (first 100 ms)",
        size=(520, 200),
    )
    signal.append(x[:200])
    spec = ai.WaveformChart(
        history=len(spectrum),
        dt=1.0,
        x_unit="Hz",
        y_min=0,
        y_max=1.2,
        traces=[{"name": "|X(f)|"}],
        label="Spectrum",
        size=(520, 200),
    )
    spec.append(spectrum)
    mo.vstack(
        [
            mo.hstack([signal, spec], justify="start"),
            mo.hstack(
                [
                    ai.VUMeter(rms, max=1.5, format="%.2f", unit="V", label="RMS", size=(60, 180)),
                    ai.SevenSegment(peak, digits=5, decimals=0, label="Dominant frequency (Hz)"),
                ],
                justify="start",
            ),
        ]
    )
    return


if __name__ == "__main__":
    app.run()
