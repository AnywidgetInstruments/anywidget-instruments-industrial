# anywidget-instruments

Instrumentation widgets for computational notebooks: knobs, gauges,
meters, tanks, LEDs, switches with mechanical actions, emergency stop,
strip charts, spectrograms, logic analyzers, polar and Smith charts, and
SCADA objects (valves, pumps, motors, pipes, alarm banner, synoptic).

Built on [anywidget](https://anywidget.dev), the widgets run in **JupyterLab,
Jupyter Notebook 7, VS Code, Google Colab and marimo**, with no JavaScript
toolchain and no network access at runtime. Their front ends also run in
[KaimonSlate.jl](https://github.com/kahliburke/KaimonSlate.jl), a Julia
notebook (see [Hosts](hosts.md)).

![Widget gallery](img/gallery-modern.png)

!!! warning "Safety"
    The library is for visualization, teaching, simulation and supervision.
    It is **not a safety-related system**, and the `EmergencyStop` widget is
    not an emergency stop device. Read the [safety notice](safety.md) before
    connecting widgets to real equipment. The industrial standards that
    inspired the widgets are listed in [Standards and references](standards.md);
    the library does not claim conformity with them.

```python
import anywidget_instruments as ai

gain = ai.Knob(2.5, min=0, max=10, step=0.1, unit="dB", label="Gain")
level = ai.Tank(1.2, max=5, unit="m", lo=0.5, hi=4.5, show_limits=True, label="Level")


@gain.on_change
def _(change):
    level.value = change["new"] / 2


ai.Panel([gain, level])
```

* [Getting started](getting-started.md) — installation and the common API
* [Widget catalog](widgets.md) — every widget with a short example
* [Examples](examples.md) — PID tuning, tank supervision, signal acquisition
* [API reference](api.md) — generated from the docstrings
