# Getting started

## Installation

```bash
pip install anywidget-instruments            # or: conda install -c conda-forge anywidget-instruments
pip install "anywidget-instruments[units]"   # + pint support
```

From a clone of the repository:

```bash
npm install && npm run build   # bundle the front end
pip install -e ".[dev]"
```

## Common API

Every widget derives from `InstrumentWidget` and exposes:

| Trait | Meaning |
|---|---|
| `value` | current state (synchronized) |
| `mode` | `"control"` (user input) or `"indicator"` (display only) |
| `label`, `tooltip` | plain text (never interpreted as HTML) |
| `disabled`, `visible` | greyed + input rejected / hidden |
| `size` | `(width, height)` in CSS pixels |
| `style` | `"modern"`, `"classic"` or `"system"` (follows the host theme) |
| `skin` | optional SVG parts: `background`, `housing`, `knob`, `needle` |

Callbacks: `widget.on_change(callback)` (also as a decorator, optionally with
`names=`) or the traitlets `observe` API. Exceptions raised by callbacks are
logged and never break the widget. `ai.batch()` groups updates; callbacks of
an `EmergencyStop` run first.

## Numeric widgets

`min`, `max`, `step`, `unit`, `scale` (`linear`/`log`), `ticks`,
`minor_ticks`, `format` (`%.2f`, `%.3e`, `%.3g`, `%.3n` engineering, `%.3s`
SI prefix), `coerce`, alarm limits `lolo`, `lo`, `hi`, `hihi` with
`deadband` and the computed `alarm_level`, `show_limits`, engineering scaling
`raw_min`/`raw_max`/`eng_min`/`eng_max` with `set_raw()`, `animate`.

```python
p = ai.Gauge(unit="bar", max=10, raw_min=4, raw_max=20, eng_min=0, eng_max=10, hi=8)
p.set_raw(12.0)  # 4-20 mA -> 5 bar
p.value = 9  # -> alarm_level == "hi"
```

With `pint` installed, quantities are converted to the widget unit:

```python
import pint

ureg = pint.UnitRegistry()
t = ai.Thermometer(unit="degC")
t.value = ureg.Quantity(300, "kelvin")  # 26.85 °C
```

## Boolean widgets and mechanical actions

`mechanical_action` is one of `switch_when_pressed`, `switch_when_released`,
`switch_until_released`, `latch_when_pressed`, `latch_when_released`,
`latch_until_released`. Latched values are consumed by `read_latched()`;
`latch_timeout` expires unread latches (`on_latch_expired`).

```python
start = ai.PushButton(text="START", mechanical_action="latch_when_released")
if start.read_latched():
    ...
```

## Two ways to set a value

Every control can be operated in two ways (API-014): directly on its drawing
(drag, click, mouse wheel, arrow keys) or through a form entry.

| Widget | On the drawing | Form entry |
|---|---|---|
| Numeric controls: `Knob`, `Dial`, `FillSlide`, and every numeric indicator switched to `mode="control"` (`Gauge`, `Meter`, `Compass`, `Tank`, `Thermometer`, `VUMeter`, `SevenSegment`, `AnalogIndicator`) | drag the pointer, needle, level or display; wheel; arrow keys | value field |
| `SelectorSwitch` | click a position, arrow keys | list of positions |
| `PIDFaceplate` | drag the SP marker (AUTO) or the OP bar (MAN) | SP / OP fields |
| `Valve` (control valve, faceplate) | position slider | position field |
| Graph cursors | drag the cursor | cursor position field |
| Graph axis ranges (CHART-108) | zoom box, pan, wheel; double-click resets | **↕ Axes**: X and Y limits, Apply, Auto |
| `PolarPlot` radial range | mouse wheel on the plot | **r max** field, Auto |

The value field accepts `12.5`, `12,5`, `1e3`, SI prefixes (`4.7 k`, `250 m`)
and the widget unit (`250 mV` for a unit of `V`). A confirmed entry (Enter, or
leaving the field) is snapped to `step`; a text that is not a number or a value
outside [`min`, `max`] is rejected with a message giving the range (with
`coerce=True` it is clamped instead) (NUM-010). The kernel applies the same
check to every value received from the front end. Escape restores the
current value. Set `entry=False` to hide the field.

Two-state controls (switches, push buttons, emergency stop), whose drawing
already is the input, and display-only objects have no form entry.

## Keyboard

Controls are operable with the keyboard: arrows (± step), Page Up/Down
(± 10 steps), Home/End (min/max), Space/Enter (Boolean controls, faceplates).
Host shortcuts (JupyterLab, Notebook 7) are suppressed while a widget has
the focus.

## Units

```python
import pint

ureg = pint.UnitRegistry()
t = ai.Thermometer(unit="degC")
t.value = ureg.Quantity(300, "kelvin")  # pint quantities are converted (26.85 °C)
```

Install `pint` with `pip install "anywidget-instruments[units]"`.

## Styles and theming

`style` is `"modern"`, `"classic"` or `"system"`. The `system` style follows
the host colors, including dark mode. `ai.set_default_style("classic")`
changes the default style of the widgets created afterwards. Every color is a
CSS custom property scoped to `.awi-root` (for example `--awi-fill`,
`--awi-needle`, `--awi-alarm-hi`), so you can override it per page or per
widget.

## marimo

```python
import marimo as mo

knob = mo.ui.anywidget(ai.Knob(label="Gain"))
knob  # other cells that read knob.value re-run when it changes
```

## Kernel loss

If the kernel is restarted or lost, the widgets show a **STALE** badge and
reject input. A notebook reopened without its kernel shows the saved values
as read-only (see [Hosts and liveness](hosts.md)).

