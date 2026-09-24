# anywidget-instruments

Instrumentation widgets for computational notebooks: knobs, gauges,
meters, tanks, thermometers, LEDs, switches, push buttons with mechanical
actions, emergency stop, real-time strip charts and alarm annunciators.

The widgets are built on [anywidget](https://anywidget.dev). They work in
JupyterLab, Jupyter Notebook 7, VS Code, Google Colab and marimo, and you don't
need a JavaScript toolchain to use them.

> **Status: pre-alpha (0.1.0.dev0).** The project follows the
> [specification](docs/specification.md)
> (EARS requirements). [`docs/requirements-status.md`](docs/requirements-status.md)
> lists which requirements are implemented.

## Install

```bash
pip install anywidget-instruments            # when released
pip install "anywidget-instruments[units]"   # + pint support
```

From source:

```bash
npm install && npm run build   # bundles the front end into src/anywidget_instruments/static
pip install -e ".[dev]"
```

## Quick start

```python
import anywidget_instruments as ai

gain = ai.Knob(2.5, min=0, max=10, step=0.1, unit="dB", label="Gain")
level = ai.Tank(1.2, min=0, max=5, unit="m", lo=0.5, hi=4.5, show_limits=True, label="Level")
run = ai.ToggleSwitch(label="Run")
stop = ai.EmergencyStop(label="E-Stop")


@gain.on_change
def _(change):
    level.value = change["new"] / 2


ai.Panel([gain, level, run, stop], columns=4)
```

## Documentation

<https://s-celles.github.io/anywidget-instruments/>: getting started, the
widget catalog (numeric, Boolean, graphs, displays, supervisory and operator
station objects), examples, the API reference, the
[specification](docs/specification.md) and its
[requirements status](docs/requirements-status.md). Try the widgets in your
browser, with nothing to install, in
[marimo](https://s-celles.github.io/anywidget-instruments/marimo/) or
[JupyterLite](https://s-celles.github.io/anywidget-instruments/lite/lab/index.html?path=gallery.ipynb).

![Widget gallery](docs/img/gallery-modern.png)

Contributing: see [development](docs/development.md) and `AGENTS.md`.

## License

MIT
