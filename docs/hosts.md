# Hosts and liveness

| Host | Status | Notes |
|---|---|---|
| JupyterLab 4 | tested (E2E) | nested widgets in `SynopticCanvas` supported |
| Jupyter Notebook 7 | tested (E2E) | |
| marimo | tested (E2E) | wrap controls with `mo.ui.anywidget(...)` for reactive re-execution |
| marimo in the browser (WebAssembly) | tested (docs workflow) | no threads: heartbeat disabled; see [Try it in the browser](try.md) |
| JupyterLite (Pyodide) | tested (docs workflow) | no threads: heartbeat disabled |
| VS Code, Google Colab | expected (anywidget hosts) | not covered by automated tests |
| [KaimonSlate.jl](https://github.com/kahliburke/KaimonSlate.jl) (Julia) | expected, front end only | see below; the kernel-less path is tested with a host page modeled on its `SlateAFM` extension (E2E) |
| Other hosts without Python | through the [trait contract](trait-contract.md) | a dictionary of traits and the anywidget model API are enough |

## KaimonSlate.jl

[KaimonSlate.jl](https://github.com/kahliburke/KaimonSlate.jl), a reactive
Julia notebook, hosts anywidget front-end modules through its `SlateAFM`
extension (`pypi_afm` loads a published anywidget; see its
[documentation](https://kahliburke.github.io/KaimonSlate.jl/dev/)). There the widgets are
front ends bound to a dictionary of traits built from the class defaults:
the Python side of this package does not run. The widgets follow the
[trait contract](trait-contract.md), so they behave as with a Python kernel
for everything the front end can do alone; what needs a program (process
data, process events) is up to the host.

The [showcase](showcase.md) includes a KaimonSlate.jl notebook,
`examples/kaimonslate/batch_reactor.jl`: a batch reactor operator station
driven by Julia, with the same widgets as the Python versions.

No widget reports **⚠ NO KERNEL**: the stale-data indication is on only when
a host announces heartbeats (HOST-003).

| Widgets | Without a kernel, the front end… | Stays with the host |
|---|---|---|
| Numeric: `Knob`, `Dial`, `Gauge`, `Meter`, `Compass`, `Tank`, `Thermometer`, `FillSlide`, `VUMeter`, `SevenSegment`, `AnalogIndicator`, `Transmitter`, `NumericEntry` | reads the traits through the schema (bounds, heading wrap), shows the value clamped with `coerce`, computes `alarm_level` and `peak` and writes them back | the process value |
| Boolean: `LED`, `ToggleSwitch`, `RockerSwitch`, `SlideSwitch`, `PushButton`, `EmergencyStop` | applies the mechanical action of switches and buttons | resetting a latch and the emergency stop |
| `SelectorSwitch`, `StackLight`, `Pipe`, `ThemeSwitch` | resolves the selector position and the stack light states as the Python classes do; the theme switch sets the page theme | the theme of the other widgets |
| `AlarmIndicator`, `AlarmBanner`, `AlarmList` | applies acknowledgements and shelving, with its expiry | raising and clearing alarms |
| Compact: `DeviationIndicator`, `Sparkline`, `BarGraph`, `KPITile`, `EventLog` | computes the per-bar alarm levels; draws the history the host sends | the history (`snapshot`, `append` messages) and the events |
| Process objects: `Valve`, `Pump`, `Motor` | applies auto / manual and, with `simulate`, the simulated state | the process feedback |
| `StateMachine` | applies operator commands through the transition table (PackML model by default; the GEMMA and ISA-88 models are `presets` of the contract) | the completion of acting states |
| `BitField` | toggles a bit of the word in control mode | the word |
| `RecipeTable` | checks each edited cell against its column, adds and deletes rows, sorts the view | the recipe (and a second check, as the kernel does) |
| `EquipmentTree` | expands, collapses and selects nodes; shows the most severe status below a collapsed node | the nodes and their statuses |
| `SvgPanel` | draws the roles of the drawing from the values; applies the control roles (button, momentary, set, step) and the entry fields | the values of the indicator roles |
| `PIDFaceplate` | applies SP / OP entries and mode changes with their rules (clamping, confirmation, setpoint tracking), derives the PV alarm | the controller and the PV |
| `Annunciator` | runs the ISA-18.1 sequence on the process conditions and applies the operator buttons | the process conditions (`active` of each window) |
| Graphs: `WaveformChart`, `IntensityChart`, `DigitalWaveformGraph`, `MixedSignalGraph`, `TrendChart`, `XYGraph` | draws the data messages the host sends (float32 / float64 / uint8 buffers, see `contract.json`), with cursors, zoom, axis ranges and export; writes back the cursors, the Y range and the trend span set by the operator | the data |
| `PolarPlot`, `SmithChart`, `RadarChart` | draws the data sets of `value` (JSON), with the radial range set by the operator | the data sets (Smith: reflection coefficients) |
| `PictureControl` | draws the `draw` messages (images as buffers), records a click in `value` | the drawing commands |
| `SynopticCanvas` | draws the pipe runs and the background (bytes or base64 text) | the children: nested widgets need a widget manager, a placeholder is shown otherwise |

Every operator action is also sent to the host as a message, so a Julia
program can react to it (HOST-012). Alarm levels and sequences computed in
the browser are a visualization, not a protection layer (see the
[safety notice](safety.md)).

## Stale-data indication (ROB-001)

The kernel sends a heartbeat every `ai.get_heartbeat()` seconds (default 2 s)
through one widget; all views of that kernel share it. When heartbeats stop
(kernel restarted, stopped or disconnected), every widget shows **⚠ STALE —
kernel lost** and rejects input. A notebook reopened without its kernel shows
**⚠ NO KERNEL — read-only** with the saved values (ROB-004, requires "Save
Widget State Automatically" in JupyterLab).

`ai.set_heartbeat(0)` disables the detection; increase the interval if long
computations holding the GIL cause false indications. In marimo, the
heartbeat thread is a `mo.Thread` (plain threads cannot reach the front end).
