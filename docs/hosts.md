# Hosts and liveness

| Host | Status | Notes |
|---|---|---|
| JupyterLab 4 | tested (E2E) | nested widgets in `SynopticCanvas` supported |
| Jupyter Notebook 7 | tested (E2E) | |
| marimo | tested (E2E) | wrap controls with `mo.ui.anywidget(...)` for reactive re-execution |
| VS Code, Google Colab | expected (anywidget hosts) | not covered by automated tests |
| JupyterLite (Pyodide) | supported | no threads: heartbeat disabled |

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
