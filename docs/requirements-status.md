# Requirements status

Status of each requirement of the
[specification](specification.md) (version 0.2).

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
| API-013 | C | ✅ | `Panel.to_dict()` / `from_dict()` |

## NUM – Numeric widgets
| ID | Pri | Status | Notes |
|---|---|---|---|
| NUM-001 … NUM-007 | M | ✅ | Nice ticks (exact divisions for Compass), log scale, format spec, step/clamp, out-of-range marker, invalid state (js + py) |
| NUM-008, NUM-009 | S | ✅ | `coerce`; `update_rate` throttling |
| NUM-101 … NUM-104, NUM-106 … NUM-108 | M | ✅ | Knob, Dial (multi-turn), Gauge, Meter, Tank, Thermometer, FillSlide |
| NUM-105, NUM-109, NUM-110 | S | ✅ | VUMeter, SevenSegment, peak hold / decay |
| NUM-111 | C | ✅ | `animate` (≤ 300 ms) |

## BOOL – Boolean widgets
| ID | Pri | Status | Notes |
|---|---|---|---|
| BOOL-001 … BOOL-012 | M/S | ✅ | LED (blink), 4 switches, push button, six mechanical actions, `read_latched()`, `latch_timeout`, `EmergencyStop` |
| BOOL-013 | M | ✅ | Callback dispatcher: in a batch (every front-end update, `ai.batch()`) EmergencyStop callbacks run first (py) |
| BOOL-014 | S | ✅ | Two-step confirmation |

## CHART – Graphs
| ID | Pri | Status | Notes |
|---|---|---|---|
| CHART-001 … CHART-004, CHART-006 | M | ✅ | Strip / scope / sweep, binary float32, circular buffer |
| CHART-005 | M | ✅ | e2e benchmark: ≥ 30 fps with a 1 kHz feed (≈ 49 fps measured) |
| CHART-007 … CHART-009 | S | ✅ | Trace styles, autoscale with hysteresis, pause |
| CHART-101, CHART-102 | S | ✅ | IntensityChart (6 colormaps, colorbar), DigitalWaveformGraph (buses, hex) |
| CHART-104, CHART-106 | S | ✅ | Draggable cursors with kernel-computed values; box zoom, wheel, pan, double-click reset (e2e) |
| CHART-103, CHART-105, CHART-107 | C | ✅ | MixedSignalGraph, annotations, CSV / PNG / SVG export (e2e CSV) |

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

Tests: py (`tests/test_industrial.py`), js (`js/test/industrial.test.js`), e2e
(`allwidgets.spec.js`, both directions for each object), visual baselines;
example `examples/filling_line.ipynb`.

## DOC, QA
| ID | Pri | Status | Notes |
|---|---|---|---|
| DOC-001 | M | ✅ | MkDocs + mkdocstrings API reference (`mkdocs build --strict`) |
| DOC-002 | M | ✅ | Gallery notebook |
| DOC-003 | — | — | Withdrawn in specification 0.2 |
| DOC-004 | S | ✅ | PID tuning, tank supervision, signal acquisition (executed by pytest and e2e) |
| DOC-005 | S | ✅ | Offline-capable static site (no web fonts / CDN), `docs.yml` deploys to GitHub Pages from `main` |
| DOC-006 | C | ✅ | JupyterLite and marimo WebAssembly exports with the package wheel; the Docs workflow opens both in a browser and checks a control drives an indicator (`e2e-site/`) |
| QA-001, QA-002 | M | ✅ | pytest, vitest |
| QA-003 | M | ✅ | e2e JupyterLab (every widget, both directions), marimo, Notebook 7 |
| QA-004 | S | ✅ | Screenshot comparison of every widget per style |
| QA-005 | S | ✅ | Benchmarks with thresholds in CI |
| QA-006 | M | ✅ | CI: lint, type check, unit, e2e, reproducible build, bundle budget |

## Open questions (spec §19): decisions for this implementation
1. Name: `anywidget-instruments` (import `anywidget_instruments`).
2. Rendering: SVG for instruments, Canvas 2D for graphs and PictureControl.
3. Julia binding: out of scope for 1.0; the single AFM module is ready for it.
4. Latch semantics: explicit `read_latched()`.
5. ISA-101: alarm colors, redundant shape/text coding and faceplates; a full
   grey-scale high-performance HMI theme is not provided.
