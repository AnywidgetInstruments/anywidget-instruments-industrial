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

## KaimonSlate.jl

[KaimonSlate.jl](https://github.com/kahliburke/KaimonSlate.jl), a reactive
Julia notebook, hosts anywidget front-end modules through its `SlateAFM`
extension (`pypi_afm` loads a published anywidget; see its
[documentation](https://kahliburke.github.io/KaimonSlate.jl/dev/)). There the widgets are
front ends bound to a dictionary of traits built from the class defaults:
the Python side of this package (validation, callbacks, alarm logic, binary
chart data, heartbeats) does not run.

- No widget reports **⚠ NO KERNEL**: stale-data detection is on only when a
  host announces heartbeats (HOST-003).
- The numeric widgets (`Knob`, `Dial`, `Gauge`, `Meter`, `Compass`,
  `Tank`, `Thermometer`, `FillSlide`, `VUMeter`, `SevenSegment`,
  `AnalogIndicator`, `Transmitter`, `NumericEntry`) behave as with a Python
  kernel: traits are read through their schema (wrong types replaced by
  defaults, bounds applied, the Compass heading wrapped), the value is
  shown clamped when `coerce` is set, and `alarm_level` (and `peak` with
  peak hold) is computed by the front end and written back to the trait
  dictionary (HOST-002, HOST-004).
- The other widgets are being migrated (see the
  [migration inventory](dev/frontend-migration-inventory.md)): until then,
  their derived traits and chart data need a host
  that provides them.

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
