# Requirements status

Status of each requirement of the
[specification](specification.md) (version 0.10).

Legend: ✅ implemented and tested · 🟡 partial / not verifiable here · ⬜ not started

Test layers: **py** = pytest, **js** = vitest, **e2e** = Playwright in
JupyterLab / Notebook 7 / marimo (`e2e/`).

## GEN – General and architecture
| ID | Pri | Status | Notes |
|---|---|---|---|
| GEN-001 | M | 🟡 | Wheel/sdist build ready (hatch + npm hook) and release workflow; not yet published on PyPI / conda-forge |
| GEN-002 | M | ✅ | Every widget subclasses `anywidget.AnyWidget` |
| GEN-003 | M | 🟡 | JupyterLab 4, Notebook 7, marimo: e2e. VS Code and Colab not covered by automated tests (see `docs/hosts.md`) |
| GEN-004 | M | ✅ | Pre-bundled ESM in the wheel |
| GEN-005 | M | ✅ | No runtime network access (py test on the bundle); skins sanitized of external references |
| GEN-006 | M | ✅ | MIT |
| GEN-007 | M | ✅ | Python ≥ 3.10, CI matrix 3.10–3.13 |
| GEN-008 | S | ✅ | Single AFM module (`initialize` + `render`) using only the AFM model API (plus optional `widget_manager` for nested widgets) |
| GEN-009 | S | ✅ | Runtime deps: `anywidget`, `traitlets`, `numpy` |
| GEN-010 | M | ✅ | No global state on import; CSS scoped under `.awi-root` |
| GEN-011 | S | ✅ | `mo.ui.anywidget(...)` triggers reactive re-execution (e2e marimo) |

## API – Common widget API
| ID | Pri | Status | Notes |
|---|---|---|---|
| API-001 … API-009 | M | ✅ | py + e2e (`allwidgets.spec.js`, both directions for every widget) |
| API-010 | S | ✅ | `size`; SVG / DPR-aware canvas |
| API-011 | M | ✅ | js |
| API-012 | S | ✅ | `Panel` |
| API-014 | M | ✅ | Drawing and form entry for every control (see [Getting started](getting-started.md#two-ways-to-set-a-value)); vitest, e2e |
| API-013 | C | ✅ | `Panel.to_dict()` / `from_dict()` |

## NUM – Numeric widgets
| ID | Pri | Status | Notes |
|---|---|---|---|
| NUM-001 … NUM-007 | M | ✅ | Nice ticks (exact divisions for Compass), log scale, format spec, step/clamp, out-of-range marker, invalid state (js + py) |
| NUM-008, NUM-009 | S | ✅ | `coerce`; `update_rate` throttling |
| NUM-010 | M | ✅ | Value field: parsing (decimal comma, exponent, SI prefix, unit), step, range check with message, kernel check of front-end values (js, py, e2e) |
| NUM-101 … NUM-104, NUM-106 … NUM-108 | M | ✅ | Knob, Dial (multi-turn), Gauge, Meter, Tank, Thermometer, FillSlide |
| NUM-105, NUM-109, NUM-110 | S | ✅ | VUMeter, SevenSegment, peak hold / decay |
| NUM-111 | C | ✅ | `animate` (≤ 300 ms) |

## BOOL – Boolean widgets
| ID | Pri | Status | Notes |
|---|---|---|---|
| BOOL-001 … BOOL-012 | M/S | ✅ | LED (blink), 4 switches, push button, six mechanical actions, `read_latched()`, `latch_timeout`, `EmergencyStop` |
| BOOL-013 | M | ✅ | Callback dispatcher: in a batch (every front-end update, `ai.batch()`) EmergencyStop callbacks run first (py) |
| BOOL-014 | S | ✅ | Two-step confirmation |
| BOOL-015 | S | ✅ | `PushButton(lamp=…, lamp_color=…, lamp_blink=…)`, cap `color`, `shape="round"`; lamp state in the ARIA description and a ring when lit (py, js, e2e) |

## CHART – Graphs
| ID | Pri | Status | Notes |
|---|---|---|---|
| CHART-001 … CHART-004, CHART-006 | M | ✅ | Strip / scope / sweep, binary float32, circular buffer |
| CHART-005 | M | ✅ | e2e benchmark: ≥ 30 fps with a 1 kHz feed (≈ 49 fps measured) |
| CHART-007 … CHART-009 | S | ✅ | Trace styles, autoscale with hysteresis, pause |
| CHART-101, CHART-102 | S | ✅ | IntensityChart (6 colormaps, colorbar), DigitalWaveformGraph (buses, hex) |
| CHART-104, CHART-106 | S | ✅ | Draggable cursors with kernel-computed values; box zoom, wheel, pan, double-click reset (e2e) |
| CHART-103, CHART-105, CHART-107 | C | ✅ | MixedSignalGraph, annotations, CSV / PNG / SVG export (e2e CSV) |
| CHART-108 | S | ✅ | Axes panel (X / Y limits, Apply, Auto) on every graph; Y limits of `WaveformChart` and the radial range of `PolarPlot` (typed or mouse wheel) update the kernel settings (js, e2e) |

## SPEC – Specialized displays
| ID | Pri | Status | Notes |
|---|---|---|---|
| SPEC-001, SPEC-002 | S | ✅ | Compass, PolarPlot |
| SPEC-003, SPEC-004 | C | ✅ | SmithChart (z0 normalization, Z tooltips), RadarChart |
| SPEC-005, SPEC-006 | S | ✅ | PictureControl primitives; clicks to the kernel (e2e) |
| SPEC-007 | M | ✅ | Commands batched per cell (IPython `post_run_cell`, 20 ms coalescing elsewhere), one message, one frame |

## SCADA – Supervisory objects
| ID | Pri | Status | Notes |
|---|---|---|---|
| SCADA-001 … SCADA-004 | S | ✅ | Valve, Pump, Motor, Pipe |
| SCADA-005, SCADA-008 | M | ✅ | AlarmIndicator; [alarm conventions](alarm-conventions.md) |
| SCADA-006, SCADA-007 | S | ✅ | AlarmBanner, acknowledgement events (e2e) |
| SCADA-009, SCADA-010 | C | ✅ | Faceplates (auto/manual, commands); SynopticCanvas with nested widgets and pipe runs (e2e, Jupyter hosts) |

## ALARM, UNIT, STYLE
| ID | Pri | Status | Notes |
|---|---|---|---|
| ALARM-001 … ALARM-005 | M/S | ✅ | |
| UNIT-001 … UNIT-004 | M/S | ✅ | pint conversion, engineering scaling, SI prefixes |
| STYLE-001 … STYLE-004 | M/S | ✅ | modern / classic / system (dark hosts), CSS custom properties, `set_default_style` |
| STYLE-005 | C | ✅ | Skin parts `background`, `housing`, `knob`, `needle` |
| STYLE-006 | M | ✅ | Sanitized in the kernel and again in the browser |
| STYLE-007 | S | ✅ | `theme` trait (`auto`, `light`, `dark`, `system`), `set_theme()`, `theme_switch()` in every example and demo; contrast audit of both forced palettes (js), visual baseline of the dark theme |
| STYLE-008 | S | ✅ | `ThemeSwitch` (light / system / dark radio group); marimo page theme through its `<body>` classes (py, js, e2e marimo) |

## PERF, A11Y, ROB, SEC
| ID | Pri | Status | Notes |
|---|---|---|---|
| PERF-001 | M | ✅ | e2e benchmark: p95 < 50 ms (≈ 23 ms measured) |
| PERF-002 | M | ✅ | e2e benchmark: 50 indicators at 20 Hz, input p95 < 100 ms (≈ 25 ms measured) |
| PERF-003, PERF-005 | S | ✅ | One render per frame; off-screen widgets skip drawing |
| PERF-004 | M | ✅ | ≈ 32 kB gzipped (JS + CSS), CI budget 150 kB |
| A11Y-001 … A11Y-003 | M | ✅ | Keyboard (host shortcuts suppressed), ARIA roles, text/shape redundancy |
| A11Y-004 | S | ✅ | WCAG 2.1 AA contrast of light and dark palettes (js) |
| A11Y-005 | S | ✅ | `prefers-reduced-motion` |
| ROB-001 | M | ✅ | Kernel heartbeat; STALE badge and input rejection after a kernel restart (e2e JupyterLab, marimo) |
| ROB-002, ROB-003 | M | ✅ | |
| ROB-004 | S | ✅ | Saved widget state reopened without kernel: values shown read-only with NO KERNEL badge (e2e) |
| ROB-005 | S | ✅ | Views request history snapshots (charts, pictures); other traits synced by anywidget |
| SEC-001, SEC-002 | M | ✅ | ESLint rules; text via `textContent` / canvas text |
| SEC-003 | M | 🟡 | Trusted publishing + build provenance workflow (`release.yml`); needs the PyPI trusted publisher to be configured |
| SEC-004 | S | ✅ | `npm run check:reproducible` in CI (byte-identical rebuild) |

## IND – Industrial operator objects
| ID | Pri | Status | Notes |
|---|---|---|---|
| IND-001 … IND-003 | S/C | ✅ | AnalogIndicator: normal band, limit marks, target; grey scale unless in alarm |
| IND-010 … IND-013 | S/C | ✅ | SelectorSwitch: 2–5 positions, keyboard and ARIA, key lock enforced in the kernel, spring return |
| IND-020 … IND-022 | S/M/C | ✅ | StackLight: IEC 60073 colors, state glyph and text per tier, buzzer indicator |
| IND-030 … IND-034 | S | ✅ | PID (standard form, derivative on PV, anti-windup, bumpless) and PIDFaceplate (mode rules, clamping, confirmation, SP tracking) |
| IND-040 … IND-043 | S | ✅ | Annunciator: ISA-18.1 sequences A, M, R with lock-in, first out, horn, Silence / Ack / Reset / Test |
| IND-050 … IND-053 | S | ✅ | AlarmList: sort and filter, timed shelving with automatic unshelving, suppressed / out of service |
| IND-060 … IND-063 | S/C | ✅ | StateMachine: PackML model (17 states), valid commands only, `state_complete()`, custom models |
| IND-070 … IND-075 | S/C | ✅ | `TrendChart`: pens with own scales, float64 times over binary buffers, live / history (◀ ▶, zoom, span, Live), limit and setpoint lines, `history` bound, cursors, time entry, CSV / PNG / SVG (py, js, e2e) |
| IND-080 … IND-083 | S/C | ✅ | `Transmitter`: ISA-5.1 style bubble, NE 107 status by shape and text, **✕ BAD** and no `aria-valuenow` on failure, alarm limits (py, js, e2e) |
| IND-090 … IND-093 | S/C | ✅ | `EventLog`: `log()`, `max_events`, category chips, filter by category and text, CSV, `connect()` / `disconnect()` audit trail (py, js, e2e) |
| IND-100 … IND-104 | S | ✅ | `DeviationIndicator`, `Sparkline` (binary history), `BarGraph` (per-bar alarm levels), `KPITile` with `oee()`, `NumericEntry` keypad with range check and `confirm_delta` (py, js, e2e) |
| IND-110 | S | ✅ | `%x`, `%X`, `%b`, `%o` with zero-padded width in every numeric widget and scale; entry field and keypad take values in that base (A..F keys in hexadecimal) (js) |
| IND-111, IND-112 | S | ✅ | `BitField`: 8, 16 or 32 bits, labels and colors per bit, word in hexadecimal, bits toggled in control mode (py, js, e2e) |
| IND-113, IND-114 | S/C | ✅ | `RecipeTable`: number, choice, Boolean and text columns, cells checked in the front end and again by the kernel (rejections shown), sort by column, rows added and deleted with `row_edit`; parity of the cell checks (py, js, e2e) |
| IND-115 | S | ✅ | `XYGraph`: line, markers, both, step and bar styles, float64 buffers, cursors (readout shared with Python), annotations, zoom, axis ranges, export (py, js, e2e) |
| IND-116 | S | ✅ | `setpoint` pointer of `Gauge`, `Meter` |
| IND-117 | C | ⬜ | Logarithmic and secondary Y axes of `WaveformChart` |
| IND-118 | C | ⬜ | `value_labels` |
| IND-119 | C | ⬜ | `EquipmentTree` |

Tests: py (`tests/test_industrial.py`), js (`js/test/industrial.test.js`), e2e
(`allwidgets.spec.js`, both directions for each object), visual baselines;
example `examples/filling_line.ipynb`.

## HOST – Host independence
All 47 widgets follow the trait contract: one JSON Schema each in
`src/anywidget_instruments/schema/`, a TypeScript view reading its traits
through it, and the front-end logic they share with Python checked by parity
cases. The [trait contract](trait-contract.md) page describes it for host
authors; the [migration inventory](dev/frontend-migration-inventory.md)
records the analysis it started from.

| ID | Pri | Status | Notes |
|---|---|---|---|
| HOST-001 | M | ✅ | A schema per widget and per base class (47 widgets); generated TypeScript types and `static/contract.json`, shipped in the wheel (py, js) |
| HOST-002 | M | ✅ | Every view reads its traits through the schema: wrong types replaced by the default, bounds applied, `"nan"` decoded, heading wrapped (`x-awi-modulo`), invalid array items dropped; reads are cached per raw value (js, e2e host page) |
| HOST-003 | M | ✅ | Every widget: neutral class defaults, Python widgets announce the kernel session; no stale indication without an announcement (py, js, e2e host page) |
| HOST-004 | M | ✅ | Derived traits computed by the front end without a host, host values kept otherwise: `alarm_level`, `peak`, `BarGraph` alarm levels, `StateMachine` state, `PIDFaceplate` summary, `Annunciator` windows and horn, shelving expiry, `PictureControl` click (js, e2e host page) |
| HOST-005 | M | ✅ | Parity cases in `tests/parity/` (alarm levels, coerce, scales, heading wrap, peak hold, resolved defaults, bar graph, process commands, state machine, PID, the 72 annunciator transitions, alarm list, graph readouts of the waveform, intensity, digital and trend charts, Smith chart conversions, radar ranges, trend pens, image type); transition and simulation tables checked against the schemas (py, js) |
| HOST-006 | S | ✅ | Unminified bundle with a linked source map, still reproducible |
| HOST-007 | M | ✅ | Class and instance defaults of every widget checked against its schema by `tests/test_contract.py` (py) |
| HOST-008 | S | ✅ | `ArrayBuffer`, `DataView` and typed arrays accepted (`core/buffers.ts`); every buffer layout documented in the schemas; sizes of the buffers Python sends checked against them; short buffers never over-read (py, js) |
| HOST-009 | S | ✅ | `SynopticCanvas` children through the widget manager in Jupyter (e2e), placeholders with pipes and background without one (js) |
| HOST-010 | S | ✅ | `SynopticCanvas.background` as a buffer (e2e) or base64 text, with the image type detected as in Python (py, js) |
| HOST-011 | M | ✅ | `tests/test_contract.py` (every exported widget has a schema; trait names, types, bounds, read-only state, defaults, states and sent messages against the schemas) and `npm run typecheck`, both in CI |
| HOST-012 | M | ✅ | Operator actions sent as messages; applied by the front end only without a host owning the state (js host-less tests, e2e) |

## DOC, QA
| ID | Pri | Status | Notes |
|---|---|---|---|
| DOC-001 | M | ✅ | MkDocs + mkdocstrings API reference (`mkdocs build --strict`) |
| DOC-002 | M | ✅ | Gallery notebook |
| DOC-003 | — | — | Withdrawn in specification 0.2 |
| DOC-004 | S | ✅ | PID tuning, tank supervision, signal acquisition (executed by pytest and e2e) |
| DOC-005 | S | ✅ | Offline-capable static site (no web fonts / CDN), `docs.yml` deploys to GitHub Pages from `main` |
| DOC-006 | C | ✅ | Four demos (gallery, PID tuning, operator station, signal analysis), each as a marimo WebAssembly app and a JupyterLite notebook with the package wheel; the Docs workflow opens all eight in a browser and checks that an input drives a computed output (`e2e-site/`) |
| DOC-007 | M | ✅ | [Safety notice](safety.md), linked from the home page, the README, the widget catalog, the examples and the demos, and from the docstrings (py test) |
| QA-001, QA-002 | M | ✅ | pytest, vitest |
| QA-003 | M | ✅ | e2e JupyterLab (every widget, both directions), marimo, Notebook 7 |
| QA-004 | S | ✅ | Screenshot comparison of every widget per style |
| QA-005 | S | ✅ | Benchmarks with thresholds in CI |
| QA-006 | M | ✅ | CI: lint, type check, unit, e2e, reproducible build, bundle budget |

## Open questions (spec §21): decisions for this implementation
1. Name: `anywidget-instruments` (import `anywidget_instruments`).
2. Rendering: SVG for instruments, Canvas 2D for graphs and PictureControl.
3. Julia binding: out of scope for 1.0; the single AFM module is ready for it.
4. Latch semantics: explicit `read_latched()`.
5. ISA-101: alarm colors, redundant shape/text coding and faceplates; a full
   grey-scale high-performance HMI theme is not provided.
