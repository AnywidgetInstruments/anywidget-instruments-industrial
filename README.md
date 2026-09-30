# anywidget-instruments-industrial

Instrumentation widgets for computational notebooks: knobs, gauges,
meters, tanks, thermometers, LEDs, switches, push buttons with mechanical
actions, emergency stop, real-time strip charts and alarm annunciators.

The widgets are built on [anywidget](https://anywidget.dev). They work in
JupyterLab, Jupyter Notebook 7 and marimo (tested), and in the other anywidget
hosts such as VS Code and Google Colab; you don't need a JavaScript toolchain
to use them.

The widgets derive from the [anywidget-instruments](https://github.com/AnywidgetInstruments/anywidget-instruments)
core (base view and class, trait contract, themes, liveness), shared with
[anywidget-instruments-automotive](https://github.com/AnywidgetInstruments/anywidget-instruments-automotive).

> **Status: pre-alpha (0.1.0.dev0).** The project follows the
> [specification](docs/specification.md)
> (EARS requirements). [`docs/requirements-status.md`](docs/requirements-status.md)
> lists which requirements are implemented.

## Install

```bash
pip install anywidget-instruments-industrial            # when released
pip install "anywidget-instruments-industrial[units]"   # + pint support
```

From source (the core is not on the package index yet: install it first, at
the commit `package.json` pins):

```bash
npm install && npm run build   # bundles the front end into src/anywidget_instruments_industrial/static
pip install "anywidget-instruments @ git+https://github.com/AnywidgetInstruments/anywidget-instruments@<commit of package.json>"
pip install -e ".[dev]"
```

## Quick start

```python
import anywidget_instruments_industrial as ai

gain = ai.Knob(2.5, min=0, max=10, step=0.1, unit="dB", label="Gain")
level = ai.Tank(1.2, min=0, max=5, unit="m", lo=0.5, hi=4.5, show_limits=True, label="Level")
run = ai.ToggleSwitch(label="Run")
stop = ai.EmergencyStop(label="E-Stop")


@gain.on_change
def _(change):
    level.value = change["new"] / 2


ai.Panel([gain, level, run, stop], columns=4)
```

## Showcase

A complete operator station on a simulated batch reactor (PackML state
machine, recipe, PID faceplate, alarms, trends, event log, plant model),
the same in marimo, JupyterLite and, from Julia, KaimonSlate.jl:
[open it in your browser](https://anywidgetinstruments.github.io/anywidget-instruments-industrial/marimo/batch_reactor/)
or see [all three versions](https://anywidgetinstruments.github.io/anywidget-instruments-industrial/showcase/).

![Batch reactor operator station](docs/img/showcase-reactor-hero.png)

## Documentation

<https://anywidgetinstruments.github.io/anywidget-instruments-industrial/>: getting started, the
widget catalog (numeric, Boolean, graphs, displays, supervisory and operator
station objects), examples, the API reference, the
[specification](docs/specification.md) and its
[requirements status](docs/requirements-status.md).
[Try it in your browser](https://anywidgetinstruments.github.io/anywidget-instruments-industrial/try/),
with nothing to install (marimo apps, also as JupyterLite notebooks).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/gallery-dark.png">
  <img alt="Widget gallery" src="docs/img/gallery-modern.png">
</picture>

Contributing: see [development](docs/development.md) and `AGENTS.md`.

## Safety

The library is for visualization, teaching, simulation and supervision in
notebooks. It is **not a safety-related system**, and the `EmergencyStop`
widget is not an emergency stop device: see the
[safety notice](docs/safety.md). The industrial standards that inspired the
widgets are listed in [Standards and references](docs/standards.md); the
library does not claim conformity with them.

## Related projects

| Project | What it is | Documentation |
|---|---|---|
| [anywidget-instruments-industrial](https://github.com/AnywidgetInstruments/anywidget-instruments-industrial) | Instrumentation widgets for notebooks: gauges, tanks, LEDs, switches, charts, alarms, SCADA objects | <https://anywidgetinstruments.github.io/anywidget-instruments-industrial/> |
| [anywidget-instruments-automotive](https://github.com/AnywidgetInstruments/anywidget-instruments-automotive) | Automotive instruments built on anywidget-instruments-industrial | <https://anywidgetinstruments.github.io/anywidget-instruments-automotive/> |
| [afm-host-panel](https://github.com/AnywidgetInstruments/afm-host-panel) | Grafana panel plugin that runs anywidget modules, with both libraries built in | <https://anywidgetinstruments.github.io/afm-host-panel/> |

## License and citation

BSD 3-Clause (see `LICENSE`). If you use the library in teaching material, a
publication or a product, please cite it: GitHub's *Cite this repository*
button reads `CITATION.cff`, and [Citing](docs/citing.md) gives the
references in several formats.
