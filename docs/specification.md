# Specification

## Document Metadata

| Field | Value |
|-------|-------|
| Project | anywidget-instruments (working name) |
| Document type | Software requirements specification |
| Notation | EARS (Easy Approach to Requirements Syntax) |
| Version | 0.5 |
| Date | 2026-09-24 |
| Status | Baseline for version 1.0 |

---

## 1. Introduction

### 1.1 Purpose

This document specifies a library of instrumentation widgets for
computational notebooks, modeled on the front panels of instrumentation and
test software. General-purpose widget sets lack specialized components such
as gauges, knobs, LEDs, tanks and real-time strip charts; this library
provides them.

### 1.2 Scope

**Included:**
- Numeric controls and indicators (knob, dial, gauge, meter, tank, thermometer)
- Boolean controls and indicators (LED, switches, push buttons with mechanical actions)
- Real-time graphs and charts (waveform chart, intensity chart, digital waveform)
- Specialized displays (compass, polar plot, Smith chart, radar, picture control)
- Supervisory objects (valve, pump, motor, pipe, alarm indicator)
- Cross-cutting features (control/indicator mode, alarm thresholds, units, themes, skins)

**Out of scope for version 1.0:**
- Hardware I/O drivers (DAQ, VISA, Modbus, OPC UA)
- Graphical drag-and-drop panel editor
- Historian or database logging

### 1.3 Intended Users

- Educators and students in electrical engineering, automation and industrial computing
- Engineers and researchers building quick instrument panels in notebooks
- Developers of simulation and digital twin tools needing operator interfaces in notebooks

### 1.4 EARS Patterns Used

| Pattern | Template |
|---------|----------|
| Ubiquitous | The <system> shall <response>. |
| Event-driven | When <trigger>, the <system> shall <response>. |
| State-driven | While <state>, the <system> shall <response>. |
| Unwanted behaviour | If <condition>, then the <system> shall <response>. |
| Optional feature | Where <feature is included>, the <system> shall <response>. |
| Complex | Combination of the above keywords. |

### 1.5 Glossary

| Term | Definition |
|------|------------|
| Widget | A Python object deriving from `anywidget.AnyWidget`, with a front-end ES module rendered in the notebook. |
| Host | A notebook environment able to render anywidgets (JupyterLab, Jupyter Notebook, VS Code, Google Colab, marimo, and others). |
| Control | A widget in which the user sets the value from the front end. |
| Indicator | A widget in which the value is set by kernel code and only displayed. |
| Kernel | The Python process executing the notebook code. |
| Mechanical action | The rule defining how a Boolean control changes and restores its value when pressed or released. |
| Latch | A mechanical action where the value returns to its default state once the kernel has read it. |
| Alarm limits | Low-low, low, high and high-high thresholds attached to a numeric value. |
| Skin | A set of images or SVG fragments replacing the default drawing of a widget part. |
| Library | The anywidget-instruments package as a whole. |

### 1.6 Requirement Identifiers and Priority

Requirements use identifiers `<GROUP>-<NNN>` with priorities:
- **M** (Must): Required for version 1.0
- **S** (Should): Targeted for version 1.0, may slip
- **C** (Could): Desirable, planned after 1.0

---

## 2. General and Architecture (GEN)

| ID | Pri. | Requirement |
|---|---|---|
| GEN-001 | M | The library shall be distributed as a single Python package on PyPI and conda-forge. |
| GEN-002 | M | The library shall implement every widget as a subclass of `anywidget.AnyWidget`. |
| GEN-003 | M | The library shall render correctly in JupyterLab, Jupyter Notebook 7, VS Code notebooks, Google Colab and marimo. |
| GEN-004 | M | The library shall ship all front-end code as pre-bundled ES modules, so that the user needs no JavaScript toolchain. |
| GEN-005 | M | The library shall load no resource from the network at runtime. |
| GEN-006 | M | The library shall be released under the MIT license. |
| GEN-007 | M | The library shall support CPython 3.10 and later. |
| GEN-008 | S | The library shall keep each front-end module compliant with the anywidget Front-End Module (AFM) specification, so that the modules can be reused by other AFM host platforms (R, Deno, Julia bridges). |
| GEN-009 | S | The library shall limit its runtime Python dependencies to `anywidget`, `traitlets` and `numpy`. |
| GEN-010 | M | When the library is imported, the library shall not modify global notebook state or register global CSS outside its own widget roots. |
| GEN-011 | S | Where marimo is the host, the library shall expose each control so that it triggers marimo reactive re-execution when its value changes. |

---

## 3. Common Widget API (API)

| ID | Pri. | Requirement |
|---|---|---|
| API-001 | M | The library shall provide a common base class from which every instrumentation widget derives. |
| API-002 | M | Every widget shall expose its current state through a synchronized `value` trait. |
| API-003 | M | Every widget shall expose a `mode` trait accepting the values `"control"` and `"indicator"`. |
| API-004 | M | While a widget is in indicator mode, the widget shall ignore user pointer and keyboard input that would modify `value`. |
| API-005 | M | When the kernel sets `value`, the widget shall update its display without requiring a cell re-execution. |
| API-006 | M | When the user changes the value of a widget in control mode, the widget shall send the new value to the kernel. |
| API-007 | M | Every widget shall expose `label`, `disabled`, `visible` and `tooltip` traits. |
| API-008 | M | Every numeric widget shall expose `min`, `max`, `step` and `unit` traits. |
| API-009 | M | Every widget shall support registration of Python callbacks via an `observe`-compatible interface and via a `on_change(callback)` convenience method. |
| API-010 | S | Every widget shall accept a `size` trait (width and height in CSS pixels) and scale its drawing without loss of sharpness. |
| API-011 | M | While `disabled` is true, the widget shall render in a greyed style and shall reject user input. |
| API-012 | S | The library shall provide a `Panel` layout helper arranging widgets in a grid with labels, compatible with ipywidgets `HBox`, `VBox` and `GridBox`. |
| API-013 | C | The library shall provide serialization of a panel's widget values to and from a dictionary, to support saving and restoring a panel state. |
| API-014 | M | Every control whose value is a number or one choice among several shall offer two ways of setting it: direct manipulation of its drawing (drag, click) and a form entry (a numeric field, or a list of the choices). Controls with two states or momentary actions (switches, push buttons, emergency stop), and display-only objects, are exempt; the documentation shall list them. |

---

## 4. Numeric Controls and Indicators (NUM)

### 4.1 Common Numeric Behaviour

| ID | Pri. | Requirement |
|---|---|---|
| NUM-001 | M | Every numeric widget shall display a scale with major and minor ticks computed from `min`, `max` and a configurable tick count. |
| NUM-002 | M | Every numeric widget shall support linear scale mapping. |
| NUM-003 | S | Where logarithmic mapping is selected, the numeric widget shall map values on a base-10 logarithmic scale. |
| NUM-004 | M | Every numeric widget shall display its value as text with a configurable format string (precision, engineering notation). |
| NUM-005 | M | When the user drags, scrolls or uses arrow keys on a numeric control, the control shall change the value by multiples of `step`, clamped to [`min`, `max`]. |
| NUM-006 | M | If the kernel sets a value outside [`min`, `max`], then the numeric widget shall clamp the display to the scale end and shall show an out-of-range marker. |
| NUM-007 | M | If the value is NaN or infinite, then the numeric widget shall display a distinct invalid state and shall not move its pointer. |
| NUM-008 | S | Where `coerce` is enabled, the numeric widget shall also clamp the synchronized `value` itself to [`min`, `max`]. |
| NUM-009 | S | While the user is dragging a numeric control, the control shall send intermediate values at most at the rate set by `update_rate` (default 30 Hz), and shall always send the final value on release. |
| NUM-010 | M | Where a numeric widget is in control mode and `entry` is enabled (the default), it shall show its value in an editable field; when the user confirms an entry, the widget shall snap it to `step` and shall reject, with a message naming the range, a text that is not a number or a value outside [`min`, `max`] (clamped instead where `coerce` is enabled); the kernel shall apply the same range check to every value received from the front end. |

### 4.2 Numeric Widget Catalog

| ID | Pri. | Requirement |
|---|---|---|
| NUM-101 | M | The library shall provide a **Knob** widget: a rotary control with a configurable angular range and a pointer. |
| NUM-102 | M | The library shall provide a **Dial** widget: a rotary control with a knob, a circular scale and optional multi-turn operation. |
| NUM-103 | M | The library shall provide a **Gauge** widget in circular and semi-circular variants, with needle and colored scale ranges. |
| NUM-104 | M | The library shall provide a **Meter** widget: an analog needle meter with a sector scale. |
| NUM-105 | S | The library shall provide a **VUMeter** widget with a segmented bar graph and peak-hold marker. |
| NUM-106 | M | The library shall provide a **Tank** widget: a vertical level indicator with fill color and optional level markers. |
| NUM-107 | M | The library shall provide a **Thermometer** widget: a vertical indicator with bulb and fluid column. |
| NUM-108 | M | The library shall provide a **FillSlide** widget, horizontal or vertical, usable as a slider control or as a bar indicator. |
| NUM-109 | S | The library shall provide a **SevenSegment** display widget with configurable digit count, decimal point and color. |
| NUM-110 | S | Where `peak_hold` is enabled on a Gauge, Meter or VUMeter, the widget shall display the maximum value reached until reset or until `peak_decay` has elapsed. |
| NUM-111 | C | Where `animate` is enabled, the widget shall interpolate needle or fill movement over a configurable duration not exceeding 300 ms. |

---

## 5. Boolean Controls and Indicators (BOOL)

| ID | Pri. | Requirement |
|---|---|---|
| BOOL-001 | M | The library shall provide an **LED** widget, round or square, with configurable on and off colors. |
| BOOL-002 | S | Where `blink` is enabled on an LED, the LED shall blink at the configured frequency while its value is true. |
| BOOL-003 | M | The library shall provide a **ToggleSwitch** widget in vertical and horizontal orientations. |
| BOOL-004 | S | The library shall provide a **RockerSwitch** widget. |
| BOOL-005 | M | The library shall provide a **SlideSwitch** widget. |
| BOOL-006 | M | The library shall provide a **PushButton** widget with a configurable text or icon. |
| BOOL-007 | M | Every Boolean control shall expose a `mechanical_action` trait accepting `switch_when_pressed`, `switch_when_released`, `switch_until_released`, `latch_when_pressed`, `latch_when_released` and `latch_until_released`. |
| BOOL-008 | M | When a Boolean control with a switch action receives the corresponding pointer event, the control shall toggle its value and keep it. |
| BOOL-009 | M | While the pointer is held on a Boolean control with `switch_until_released`, the control shall hold the non-default value, and when the pointer is released, the control shall restore the default value. |
| BOOL-010 | M | When a Boolean control with a latch action has changed its value, the control shall keep the new value until the kernel reads it through `read_latched()`, then shall restore the default value. |
| BOOL-011 | S | If a latched value has not been read within `latch_timeout`, then the control shall restore the default value and shall emit a `latch_expired` event. |
| BOOL-012 | M | The library shall provide an **EmergencyStop** widget: a red mushroom button that latches to true when pressed and requires an explicit reset action to return to false. |
| BOOL-013 | M | When the EmergencyStop value becomes true, the library shall invoke all callbacks registered on it before any other pending widget callback in the same event batch. |
| BOOL-014 | S | Where `confirm` is enabled on a Boolean control, the control shall request a second user confirmation before changing its value. |

---

## 6. Graphs and Charts (CHART)

### 6.1 Waveform Chart

| ID | Pri. | Requirement |
|---|---|---|
| CHART-001 | M | The library shall provide a **WaveformChart** widget displaying one or more scrolling traces with a configurable history length. |
| CHART-002 | M | The WaveformChart shall support three update modes: `strip` (continuous scroll), `scope` (clear and redraw at right edge) and `sweep` (moving cursor overwriting old data). |
| CHART-003 | M | When the kernel calls `append(samples)` with a scalar, 1-D or 2-D array, the WaveformChart shall add the samples to its history buffer and redraw. |
| CHART-004 | M | The WaveformChart shall transfer sample arrays between kernel and front end as binary buffers, not as JSON lists. |
| CHART-005 | M | While samples are appended at up to 1 kHz aggregate rate, the WaveformChart shall keep a display refresh rate of at least 30 frames per second on a reference laptop. |
| CHART-006 | M | If the history buffer is full, then the WaveformChart shall discard the oldest samples (circular buffer). |
| CHART-007 | S | The WaveformChart shall support per-trace color, line width, name and legend visibility. |
| CHART-008 | S | Where `autoscale_y` is enabled, the WaveformChart shall adjust the Y axis to the visible data range with hysteresis to avoid flicker. |
| CHART-009 | S | While `paused` is true, the WaveformChart shall continue buffering samples and shall freeze the display, allowing zoom and pan on the frozen data. |

### 6.2 Other Graphs

| ID | Pri. | Requirement |
|---|---|---|
| CHART-101 | S | The library shall provide an **IntensityChart** widget displaying a scrolling 2-D color map (spectrogram / waterfall) with a configurable colormap. |
| CHART-102 | S | The library shall provide a **DigitalWaveformGraph** widget displaying multiple logic lines as a timing diagram, with bus grouping and hexadecimal bus value display. |
| CHART-103 | C | The library shall provide a **MixedSignalGraph** widget combining analog traces and digital lines on a shared time axis. |
| CHART-104 | S | Every graph widget shall support one or more **cursors** that the user can drag, and shall expose cursor positions and the interpolated values under them through synchronized traits. |
| CHART-105 | C | Every graph widget shall support text annotations anchored to data coordinates. |
| CHART-106 | S | When the user uses the zoom tool on a graph, the graph shall zoom on the selected region, and when the user double-clicks, the graph shall restore the full view. |
| CHART-107 | C | Where `export` is enabled, a graph widget shall let the user download the displayed data as CSV and the image as PNG or SVG. |
| CHART-108 | S | The user shall be able to change the displayed range of each axis of a graph both on the plot (zoom, pan, mouse wheel) and by typing its limits; for graphs whose scale is a setting (`y_min`, `y_max`, `autoscale_y`, `r_max`), the typed limits shall update that setting in the kernel. |

---

## 7. Specialized Displays (SPEC)

| ID | Pri. | Requirement |
|---|---|---|
| SPEC-001 | S | The library shall provide a **Compass** widget displaying a heading in degrees, with cardinal labels. |
| SPEC-002 | S | The library shall provide a **PolarPlot** widget displaying magnitude and angle data sets. |
| SPEC-003 | C | The library shall provide a **SmithChart** widget displaying complex impedance or reflection coefficient data, normalized to a configurable reference impedance. |
| SPEC-004 | C | The library shall provide a **RadarChart** widget displaying multi-axis values. |
| SPEC-005 | S | The library shall provide a **PictureControl** widget exposing drawing primitives (line, rectangle, circle, arc, polygon, text, image) callable from Python. |
| SPEC-006 | S | When the user clicks in a PictureControl, the widget shall send the click coordinates and button to the kernel. |
| SPEC-007 | M | The PictureControl shall batch drawing commands issued within the same cell execution and render them in a single frame. |

---

## 8. Supervisory Objects (SCADA)

| ID | Pri. | Requirement |
|---|---|---|
| SCADA-001 | S | The library shall provide a **Valve** widget with open, closed, transit and fault states, and an optional position percentage for control valves. |
| SCADA-002 | S | The library shall provide a **Pump** widget with stopped, running and fault states, and an optional rotation animation while running. |
| SCADA-003 | S | The library shall provide a **Motor** widget with stopped, running forward, running reverse and fault states. |
| SCADA-004 | S | The library shall provide a **Pipe** widget composed of straight, elbow, tee and cross segments, with an optional flow animation and flow direction. |
| SCADA-005 | M | The library shall provide an **AlarmIndicator** widget showing an alarm state (normal, active unacknowledged, active acknowledged, cleared unacknowledged) with the corresponding color and blink pattern. |
| SCADA-006 | S | The library shall provide an **AlarmBanner** widget listing active alarms with timestamp, source, priority and message. |
| SCADA-007 | S | When the user acknowledges an alarm in an AlarmIndicator or AlarmBanner, the widget shall send an acknowledgement event to the kernel with the alarm identifier. |
| SCADA-008 | M | The color and blink conventions of alarm states shall follow ISA-18.2 and IEC 62682 recommendations, and shall be documented. |
| SCADA-009 | C | Where the SCADA object set is used in control mode, clicking a Valve, Pump or Motor shall open a faceplate popup exposing its commands (open/close, start/stop, auto/manual). |
| SCADA-010 | C | The library shall provide a **SynopticCanvas** widget in which SCADA objects and pipes can be placed at absolute coordinates on a background image. |

---

## 9. Alarms and Limits (ALARM)

| ID | Pri. | Requirement |
|---|---|---|
| ALARM-001 | M | Every numeric widget shall accept optional alarm limits `lolo`, `lo`, `hi` and `hihi`. |
| ALARM-002 | M | When the value crosses an alarm limit, the numeric widget shall change its value color to the color assigned to that limit level. |
| ALARM-003 | S | Every numeric widget shall accept a `deadband` for alarm limits, and shall not leave an alarm state until the value has moved back beyond the limit by at least the deadband. |
| ALARM-004 | M | When the alarm level of a numeric widget changes, the widget shall expose the new level through a synchronized `alarm_level` trait. |
| ALARM-005 | S | Where `show_limits` is enabled, gauges, meters, tanks and thermometers shall draw the alarm limits as colored zones or markers on their scale. |

---

## 10. Units and Scales (UNIT)

| ID | Pri. | Requirement |
|---|---|---|
| UNIT-001 | M | Every numeric widget shall display its `unit` string next to its value and scale. |
| UNIT-002 | S | Where `pint` is installed and a `pint.Quantity` is assigned to `value`, the widget shall convert it to the widget unit before display. |
| UNIT-003 | S | Every numeric widget shall accept an engineering scaling (`raw_min`, `raw_max`, `eng_min`, `eng_max`) to convert raw values (for example 4 to 20 mA or 0 to 32767 counts) into engineering units. |
| UNIT-004 | S | The library shall support SI prefix display (m, µ, k, M) when engineering notation is selected. |

---

## 11. Themes, Styles and Skins (STYLE)

| ID | Pri. | Requirement |
|---|---|---|
| STYLE-001 | M | The library shall provide at least three visual styles: `modern`, `classic` (flat, low detail) and `system` (follows the host theme colors). |
| STYLE-002 | M | While the host is in dark mode, widgets using the `system` style shall use dark-theme colors. |
| STYLE-003 | M | The library shall define all widget colors through CSS custom properties, so that users can override them per widget or per page. |
| STYLE-004 | S | The library shall provide a global function to set the default style for all widgets created afterwards. |
| STYLE-005 | C | Where a skin is supplied, the widget shall replace the default drawing of the named parts (housing, needle, knob, background) with the supplied SVG or raster images. |
| STYLE-006 | M | If a supplied skin SVG contains scripts, event handler attributes or external references, then the library shall strip them before rendering. |
| STYLE-007 | S | Every widget shall accept a `theme` of `auto`, `light` or `dark`; `light` and `dark` shall apply their palette whatever the host theme, and the library shall provide a function switching every open widget, and a ready-made switch that the examples and demos show. |

---

## 12. Performance (PERF)

| ID | Pri. | Requirement |
|---|---|---|
| PERF-001 | M | When the kernel updates the value of a numeric or Boolean indicator, the new value shall be displayed within 50 ms on a local kernel. |
| PERF-002 | M | While 50 indicators are updated at 20 Hz each, the notebook shall remain responsive (input latency below 100 ms) on a reference laptop. |
| PERF-003 | S | The library shall coalesce successive value updates to the same widget arriving within one animation frame, and render only the latest. |
| PERF-004 | M | The combined front-end bundle of the core widgets (NUM, BOOL, WaveformChart) shall not exceed 150 kB gzipped. |
| PERF-005 | S | While a widget is not visible in the viewport, the widget shall skip rendering and resume on becoming visible. |

---

## 13. Accessibility (A11Y)

| ID | Pri. | Requirement |
|---|---|---|
| A11Y-001 | M | Every control shall be reachable and operable with the keyboard (Tab, arrow keys, Page Up/Down, Home/End, Space, Enter). |
| A11Y-002 | M | Every widget shall expose an appropriate ARIA role (`slider`, `switch`, `button`, `meter`, `img`) with accessible name and value. |
| A11Y-003 | M | Every widget shall convey state by at least one means other than color (text, shape, position or pattern). |
| A11Y-004 | S | Default color palettes shall meet WCAG 2.1 AA contrast ratio for text and state indicators. |
| A11Y-005 | S | Where the user agent requests reduced motion, the widgets shall disable animations and blinking, replacing blinking with a steady distinct pattern. |

---

## 14. Robustness (ROB)

| ID | Pri. | Requirement |
|---|---|---|
| ROB-001 | M | If the kernel is disconnected or restarted, then every widget shall display a stale-data indication and shall reject user input until the connection is restored. |
| ROB-002 | M | If a Python callback raises an exception, then the library shall log the exception in the notebook output and shall keep the widget operational. |
| ROB-003 | M | If a trait is assigned a value of an invalid type, then the library shall raise a `TraitError` with a message naming the widget and trait. |
| ROB-004 | S | When a notebook is saved with widget state and reopened without a running kernel, the widgets shall render their last saved values as static images or as read-only widgets. |
| ROB-005 | S | When the same widget instance is displayed in several output cells, all displayed views shall stay synchronized. |

---

## 15. Security (SEC)

| ID | Pri. | Requirement |
|---|---|---|
| SEC-001 | M | The front-end code shall not use `eval`, `new Function` or `innerHTML` with data coming from traits. |
| SEC-002 | M | The library shall render all label, tooltip, unit and alarm message strings as text, never as HTML. |
| SEC-003 | M | The library shall publish its packages with trusted publishing and signed build provenance. |
| SEC-004 | S | The library shall provide a reproducible front-end build, such that rebuilding a tagged release produces byte-identical bundles. |

---

## 16. Documentation and Teaching (DOC)

| ID | Pri. | Requirement |
|---|---|---|
| DOC-001 | M | The library shall provide an API reference generated from docstrings. |
| DOC-002 | M | The library shall provide a gallery notebook showing every widget in control and indicator modes. |
| DOC-003 | — | *Withdrawn in version 0.2.* |
| DOC-004 | S | The documentation shall include at least three complete example panels: a first-order process simulation with PID tuning, a tank level supervision with alarms, and a real-time signal acquisition display. |
| DOC-005 | S | The documentation shall be buildable offline and deployable as a static site. |
| DOC-006 | C | The documentation shall include live examples running in the browser (JupyterLite or marimo WASM). |
| DOC-007 | M | The documentation shall state that the library is not a safety-related system, that the EmergencyStop widget is not an emergency stop device, and that safety functions must be implemented independently of the library; the README and the docstrings of the EmergencyStop, alarm, controller and state model classes shall refer to this statement. |

---

## 17. Quality and Verification (QA)

| ID | Pri. | Requirement |
|---|---|---|
| QA-001 | M | The library shall include Python unit tests covering trait validation, clamping, alarm levels, mechanical actions and engineering scaling. |
| QA-002 | M | The library shall include front-end unit tests for scale computation, value formatting and hit testing. |
| QA-003 | M | The library shall include end-to-end tests in JupyterLab and marimo using a headless browser, verifying kernel to front end and front end to kernel synchronization for every widget. |
| QA-004 | S | The library shall include visual regression tests comparing widget renderings against reference screenshots for each style. |
| QA-005 | S | The library shall include performance benchmarks for PERF-001, PERF-002 and CHART-005, executed in continuous integration with regression thresholds. |
| QA-006 | M | When a pull request is opened, the continuous integration shall run linting, type checking, unit tests and end-to-end tests. |

---

## 18. Industrial Operator Objects (IND)

Operator objects for control rooms and machine panels. They follow ISA-101
(high-performance HMI), ISA-18.1 (annunciator sequences), ISA-18.2 / IEC 62682
(alarm management), IEC 60073 (indicator colors) and ISA-TR88.00.02 (machine
state model).

### 18.1 Analog Indicator

| ID | Pri. | Requirement |
|---|---|---|
| IND-001 | S | The library shall provide an **AnalogIndicator** widget: a horizontal or vertical bar showing the value as a pointer on a neutral scale, with the normal operating range as a shaded band. |
| IND-002 | S | Where alarm limits are set, the AnalogIndicator shall mark them on the scale, and shall draw the pointer and value in color only while an alarm level is active (grey scale otherwise). |
| IND-003 | C | Where a `target` is set, the AnalogIndicator shall mark it on the scale. |

### 18.2 Selector Switch

| ID | Pri. | Requirement |
|---|---|---|
| IND-010 | S | The library shall provide a **SelectorSwitch** widget with 2 to 5 labelled positions (for example HAND / OFF / AUTO); its value shall be the label of the selected position. |
| IND-011 | S | The SelectorSwitch shall be operable with the pointer and with the arrow keys, and shall expose the selected position through ARIA. |
| IND-012 | S | Where `keyed` is enabled and `locked` is true, the SelectorSwitch shall reject position changes from the front end and shall show a lock symbol. |
| IND-013 | C | Where a position is declared spring-return, the SelectorSwitch shall return to its `default_position` when released. |

### 18.3 Stack Light

| ID | Pri. | Requirement |
|---|---|---|
| IND-020 | S | The library shall provide a **StackLight** widget with 1 to 5 tiers, each with an IEC 60073 color (red, amber, green, blue, white) and a state `off`, `on` or `blink`. |
| IND-021 | M | The StackLight shall convey each tier state by text or shape as well as by color. |
| IND-022 | C | Where `buzzer` is set, the StackLight shall show a sounding indicator; the library shall not play sound. |

### 18.4 PID Faceplate

| ID | Pri. | Requirement |
|---|---|---|
| IND-030 | S | The library shall provide a **PIDFaceplate** widget showing the setpoint (SP), process value (PV) and output (OP) as values and bars, the engineering unit, the tag and the mode (`MAN`, `AUTO`, `CAS`). |
| IND-031 | S | While the mode is `AUTO`, the faceplate shall let the operator change SP only; while `MAN`, OP only; while `CAS`, neither. |
| IND-032 | S | When the operator enters SP or OP, the faceplate shall clamp the value to its limits; where `confirm_delta` is set, a change larger than `confirm_delta` shall require a confirmation step. |
| IND-033 | S | The library shall provide a **PID** controller class (proportional, integral and derivative actions, output limits, anti-windup, direct or reverse action) that a PIDFaceplate can drive with `step(pv, dt)`. |
| IND-034 | S | When the mode changes from `MAN` to `AUTO`, the controller shall start from the current output without a step change (bumpless transfer), and, where `sp_tracking` is enabled, the setpoint shall be set to the process value. |

### 18.5 Annunciator

| ID | Pri. | Requirement |
|---|---|---|
| IND-040 | S | The library shall provide an **Annunciator** widget: a grid of alarm windows, each with a tag and a text. |
| IND-041 | S | The Annunciator shall follow the ISA-18.1 sequence selected by `sequence`: `A` (automatic reset), `M` (manual reset) or `R` (ringback). |
| IND-042 | S | Where `first_out` is enabled, the Annunciator shall mark the first window to alarm in a group with a distinct pattern and text until the group is reset. |
| IND-043 | S | The Annunciator shall provide Silence, Acknowledge, Reset and Test operator actions, and shall send each action to the kernel as an event. |

### 18.6 Alarm List

| ID | Pri. | Requirement |
|---|---|---|
| IND-050 | S | The library shall provide an **AlarmList** widget: a table of alarms with time, tag, priority, message and state, sortable by time or priority and filterable by priority, state and text. |
| IND-051 | S | Where the operator shelves an alarm for a duration, the AlarmList shall hide it from the active view, show the number of shelved alarms and unshelve it automatically when the duration expires (ISA-18.2). |
| IND-052 | S | The AlarmList shall display suppressed and out-of-service alarms distinctly from active ones. |
| IND-053 | S | When the operator acknowledges or shelves an alarm, the AlarmList shall send the event to the kernel with the alarm identifier. |

### 18.7 State Machine

| ID | Pri. | Requirement |
|---|---|---|
| IND-060 | S | The library shall provide a **StateMachine** widget showing the ISA-TR88.00.02 machine state model (17 states) with the current state highlighted. |
| IND-061 | S | The StateMachine shall offer only the commands valid in the current state (Start, Stop, Hold, Unhold, Suspend, Unsuspend, Reset, Abort, Clear), and the kernel shall reject any other command. |
| IND-062 | S | When an acting state completes (for example Starting → Execute), the kernel code shall advance the model with `state_complete()`; the widget shall not advance on its own. |
| IND-063 | C | The StateMachine shall accept a custom model given as states and transitions. |

---

## 19. Traceability of Front Panel Components

| Front panel component | Library widget | Requirement |
|---|---|---|
| Knob | Knob | NUM-101 |
| Dial | Dial | NUM-102 |
| Gauge | Gauge | NUM-103 |
| Meter | Meter | NUM-104 |
| Tank | Tank | NUM-106 |
| Thermometer | Thermometer | NUM-107 |
| Fill Slide / Progress Bar | FillSlide | NUM-108 |
| Round / Square LED | LED | BOOL-001 |
| Toggle Switch | ToggleSwitch | BOOL-003 |
| Rocker | RockerSwitch | BOOL-004 |
| Slide Switch | SlideSwitch | BOOL-005 |
| OK / Stop / push button | PushButton | BOOL-006 |
| Mechanical action | `mechanical_action` trait | BOOL-007 to BOOL-011 |
| Waveform Chart | WaveformChart | CHART-001 to CHART-009 |
| Intensity Chart | IntensityChart | CHART-101 |
| Digital Waveform Graph | DigitalWaveformGraph | CHART-102 |
| Mixed Signal Graph | MixedSignalGraph | CHART-103 |
| Graph cursors | Cursors | CHART-104 |
| Compass | Compass | SPEC-001 |
| Polar Plot | PolarPlot | SPEC-002 |
| Smith Plot | SmithChart | SPEC-003 |
| Radar Plot | RadarChart | SPEC-004 |
| Picture control | PictureControl | SPEC-005 to SPEC-007 |
| Process valves, pumps, motors, pipes | Valve, Pump, Motor, Pipe | SCADA-001 to SCADA-004 |
| Alarm display | AlarmIndicator, AlarmBanner | SCADA-005 to SCADA-008 |
| Modern / Classic / System styles | `style` trait | STYLE-001 to STYLE-004 |
| Custom control parts | Skins | STYLE-005, STYLE-006 |
| Light / dark theme switch | `theme` trait, `set_theme`, `theme_switch` | STYLE-007 |
| Control / indicator switch | `mode` trait | API-003, API-004 |
| Analog bar with normal band | AnalogIndicator | IND-001 to IND-003 |
| Selector switch, key switch | SelectorSwitch | IND-010 to IND-013 |
| Stack light | StackLight | IND-020 to IND-022 |
| Controller faceplate | PIDFaceplate, PID | IND-030 to IND-034 |
| Annunciator panel | Annunciator | IND-040 to IND-043 |
| Alarm summary | AlarmList | IND-050 to IND-053 |
| Machine state model | StateMachine | IND-060 to IND-063 |

---

## 20. Open Questions

1. Final project name (candidates: `anywidget-instruments`, `ipyinstruments`, `notebook-panel`).
2. Front-end rendering technology: plain SVG for all widgets, or Canvas/WebGL for charts only (impacts CHART-005 and PERF-004).
3. Whether a Julia binding sharing the same ES modules (per GEN-008) is in scope for 1.0 or a later release.
4. Whether latch semantics (BOOL-010) should rely on an explicit `read_latched()` call or on the first trait read by an observer.
5. Level of ISA-101 (HMI design) compliance targeted for the SCADA object set beyond alarm colors.

## Revision History

| Version | Changes |
|---|---|
| 0.1 | Initial draft. |
| 0.2 | Moved into the repository; DOC-003 withdrawn; component traceability table made product-neutral. |
| 0.3 | Industrial operator objects (IND): analog indicator, selector switch, stack light, PID faceplate, annunciator, alarm list, state machine. |
| 0.4 | DOC-007: safety notice. |
| 0.5 | API-014 (graphic and form entry for every control), NUM-010 (numeric entry field with range check), CHART-108 (axis ranges set by the user), STYLE-007 (light / dark theme). |
