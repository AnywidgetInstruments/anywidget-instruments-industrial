# Front-end migration inventory

Phase 0 of the host-independent front end: for every widget, the synchronized
traits, the logic implemented in Python and its category. The goal of the
migration is that a host without a Python kernel (a plain dictionary of traits)
gets the same visual behavior as a Python kernel.

This page describes the code at commit `0f0ffb8` (before the migration). It is
a working document for developers; the host contract itself is described in
the [trait contract](../trait-contract.md) page for host authors.

!!! note "Status: migration complete"
    All 47 widgets now have a schema and a TypeScript view reading its traits
    through it. The PURE items below were moved to (or shared with) the front
    end, with parity cases where both sides keep them; the AMBIGUOUS items
    were resolved by the authority rule of the specification (section 19.1):
    derived traits and operator actions are applied by the front end only
    when no host owns the state. `SynopticCanvas` children still need a host
    widget manager (HOST-009). The tables below keep the "JS" references of
    the code before the migration.

## Legend

| Category | Meaning | Migration |
|---|---|---|
| **PURE** | Function of trait values only (validation, clamping, quantization, derived read-only traits, decoding) | Move to (or share with) the front end, derived from the schema |
| **HOST** | Business logic, data production, callbacks, timers, simulation, Python-only conversions (pint, numpy) | Stays on the host |
| **LIVENESS** | Heartbeat and session | Stays on the host; the front end only reacts when the host announces it |
| **AMBIGUOUS** | Pure computation that depends on history, time, message ordering, several views, or that both sides write | Decision needed, listed in [Ambiguities](#ambiguities) |

"JS" in the tables names the current front-end code (`js/src/...`).

## How a non-Python host sees the widgets

The reference non-Python host is KaimonSlate.jl with its `SlateAFM` extension
(`examples/extensions/SlateAFM` in that repository, read at commit `c09716d`).
What it does matters for every decision below:

- `pypi_afm(pkg; class, traits...)` installs the package with the system `pip`
  and runs a small script that reads `_esm`, `_css` and, for every
  `sync=True` trait, the **class default** (`cls.class_traits()[name].default()`).
  No widget is instantiated: no `__init__`, no validator, no observer runs.
  The defaults are written with `json.dumps`, so NaN becomes the invalid JSON
  token `NaN`.
- The front end receives a model built on that dictionary, merged with the
  traits passed by the user: `get`, `set` (fires `change:<name>`
  synchronously), `save_changes` (sends the whole dictionary back to Julia),
  `on` / `off` (`change:<name>`, `change`, `msg:custom`) and
  `send(content, callbacks, buffers)`.
- Custom messages work in both directions (`afm_on_msg` receives
  `model.send`, `afm_emit` delivers `msg:custom`), with binary buffers.
  Buffers arrive as `ArrayBuffer` objects (anywidget in Jupyter gives
  `DataView` objects): decoders must accept both.
- There is no `widget_manager`, no comm and no `comm_live_update` event.

Consequences found during the inventory:

1. **"NO KERNEL" in KaimonSlate** comes from class defaults: `_heartbeat`
   defaults to `2.0` and `_session` to the kernel UUID computed at import
   (`_base.py:101-102`). The front end then waits for heartbeats that never
   come.
2. **Wrong defaults in KaimonSlate**: `mode` and `size` defaults are applied in
   `InstrumentWidget.__init__` from `_default_mode` / `_default_size`, so the
   class defaults are those of the base class (`"control"`, `(160, 160)`).
   The table [Class defaults that differ from instance defaults](#class-defaults-that-differ-from-instance-defaults)
   lists every such trait.
3. A `sync_request` sent by a chart reaches the Julia side, where nothing
   answers until a wrapper implements the reply described in
   [Binary formats](#binary-formats).

## Shared base: `InstrumentWidget` (`_base.py`)

| Item | Where | Description | Category | Front end today |
|---|---|---|---|---|
| `float_serializers` | `_base.py:33-56` | NaN and infinities travel as `"nan"`, `"inf"`, `"-inf"`; the reverse converts every string to a float | PURE (wire codec) | `parseNumber` (`core/scale.js:5`) |
| `__init__` | `_base.py:110-117` | Fills `style`, `theme` (module defaults), `mode`, `size` (class attributes), `_heartbeat`; registers the widget for heartbeats | PURE defaults, LIVENESS registration | Not applicable |
| `_session`, `_heartbeat` traits | `_base.py:101-102` | Kernel session id and heartbeat period | LIVENESS | `core/liveness.js`, `core/view.js:44-94` |
| `@validate size` | `_base.py:120` | Width and height > 0 | PURE | Not checked |
| `@validate skin` | `_base.py:130` | Known part names, `sanitize_svg` | PURE (security) | `parseSkin` (`core/dom.js:56-77`), close but not identical (see ambiguities) |
| `observe`, `on_change`, `_wrap_handler` | `_base.py:146-180` | User callbacks through the dispatcher (errors logged, priorities) | HOST | Not applicable |
| `set_state` | `_base.py:182` | Front-end updates processed as a batch (BOOL-013) | HOST | Not applicable |

## Liveness (`_liveness.py`)

| Item | Where | Description | Category |
|---|---|---|---|
| `SESSION` | `_liveness.py:25` | UUID per kernel process, synced as `_session` | LIVENESS |
| `get_heartbeat`, `set_heartbeat` | `:46-63` | Global period, written to every widget's `_heartbeat`; 0 disables | LIVENESS |
| `register`, `_loop`, `beat` | `:98-139` | One daemon thread per runtime context (`mo.Thread` in marimo) sends `{"type": "hb", "session", "interval"}` (no buffers) through every open widget; without threads (Pyodide) the heartbeat is set to 0 | LIVENESS |

Front end: `recordBeat` / `liveness()` (`core/liveness.js`), the view shows
**STALE** after `3 * interval + 1` seconds without a beat, **NO KERNEL** when
no beat was ever received, and `markDead` on `comm_live_update`. The period in
the `hb` message is ignored; `_heartbeat` is used. Detection is on as soon as
`_session` is non-empty and `_heartbeat > 0`.

## Numeric widgets

### `NumericWidget` base (`_numeric.py`, `_alarm_logic.py`)

| Item | Where | Description | Category | Front end today |
|---|---|---|---|---|
| `NumericValue.validate` | `_numeric.py:22-34` | Accepts pint quantities (converted to `unit`) and numpy scalars | HOST | Not applicable |
| `__init__` ordering | `:92-102` | `unit`, `min`, `max`, `coerce` before `value`; then `_check_scale`, `_update_alarm` | HOST (ordering) | Not applicable |
| `_check_scale` | `:105-111` | `max > min`; `min > 0` on a log scale; raises otherwise | PURE | Not checked; `toFraction` divides by `max - min` |
| `_on_scale_change` | `:113-116` | Re-checks only when `max > min` (a transient inverted range is allowed after construction) | PURE | Not applicable |
| `set_state` (NUM-010) | `:118-130` | Without `coerce`, a finite front-end `value` outside [`min`, `max`] is dropped and the kernel value is sent back | AMBIGUOUS (defence against other clients) | `checkEntry` (`core/entry.js:9`) rejects, `snap` clamps (`core/scale.js:48`) |
| `@validate value` (`coerce`) | `:132-137` | Clamp to [`min`, `max`] when `coerce` is set and the value is finite | PURE | Only on front-end input (`snap`, `checkEntry`) |
| `_update_alarm` | `:140-155` | `alarm_level` (read-only) from `compute_alarm_level` with the previous level | PURE computation, AMBIGUOUS (history) | Read only (`widgets/numeric.js:93`) |
| `compute_alarm_level` | `_alarm_logic.py:27-58` | Levels `hihi > hi > lolo > lo`, inclusive limits; leaving a level needs the value back past its limit by `deadband` (ALARM-003); a non-finite value keeps the previous level | PURE | None |
| `raw_to_eng`, `eng_to_raw`, `set_raw`, `raw_value` | `:158-182` | Engineering scaling from `raw_*` / `eng_*` | HOST API (pure maths) | None; not needed for display |
| step snapping | none in Python | | | JS only: `snap` (`core/scale.js:48`) |

### `_PeakMixin` (Gauge, Meter, VUMeter)

| Item | Where | Description | Category | Front end today |
|---|---|---|---|---|
| `_track_peak` | `_numeric.py:194-202` | Read-only `peak`: maximum since reset, released after `peak_decay` seconds (`time.monotonic`) | AMBIGUOUS (time and history) | Read only (`rotary.js:188`, `linear.js:154`) |
| `reset_peak` | `:204` | Command | HOST | Not applicable |

### Catalog

| Widget | Own logic | Category | Notes |
|---|---|---|---|
| `Knob`, `Dial`, `Tank`, `Thermometer`, `SevenSegment`, `Gauge`, `Meter`, `VUMeter` | Trait declarations only | | Bounds on own traits (`angle_range`, `turns`, `segments`, `digits`, `decimals`) are enforced by traitlets only |
| `FillSlide` | `__init__`: size (80, 240) when vertical (`:289`) | PURE (default derived from another trait) | |
| `Compass` | `@validate value`: `v % 360` (`:319`) | PURE | JS clamps to [0, 360] instead: a front-end 360 becomes 0 in the kernel |
| `AnalogIndicator` (`_industrial.py`) | `__init__`: size (70, 220) when vertical | PURE | Inherits all numeric logic |
| `Transmitter` (`_transmitter.py`) | `valid` = `status != "failure"` | PURE | JS shows "✕ BAD" (`transmitter.js:50`) |
| `NumericEntry` (`_keypad.py`) | None | | `confirm_delta` is JS only (`keypad.js:86`); keypad entries are not snapped (no `step` passed to `checkEntry`) |

## Boolean widgets (`_boolean.py`)

| Item | Where | Description | Category | Front end today |
|---|---|---|---|---|
| `BooleanWidget.set_state` (`_seq`) | `:56-65` | Drops a front-end update whose `_seq` is not newer (marimo applies updates twice, BOOL-010) | AMBIGUOUS (ordering; two views can send the same `_seq`) | `write` increments `_seq` (`boolean.js:111`) |
| `is_latch`, mechanical actions | `:67` | | PURE | Transitions in `mechanicalTransition` (`boolean.js:14-31`); Python trusts `value` |
| `read_latched`, `_restore_default`, `_on_value` timer, `_on_pressed`, `_expire`, `on_latch_expired` | `:71-123` | Latch consumption, `latch_timeout` timer thread, `{"type": "latch_expired"}` message | HOST | `boolean.js:69` flashes on `latch_expired` |
| `ToggleSwitch.__init__`, `PushButton.__init__` | `:146`, `:195` | Size from `orientation` / `shape` | PURE | |
| `EmergencyStop` `@validate value` | `:223-229` | `False` refused unless `reset()` runs | AMBIGUOUS (safety invariant, see [safety](../safety.md)) | JS only writes `True` (`boolean.js:84`) |
| `EmergencyStop` callback priority, `reset`, `read_latched` | `:218-240` | | HOST | |

## Industrial operator objects (`_industrial.py`)

| Item | Where | Description | Category | Front end today |
|---|---|---|---|---|
| `SelectorSwitch.__init__` | `:58-68` | Default value: `default_position`, else the middle position | PURE | |
| `@validate positions`, `value`, `default_position` | `:70-98` | 2 to 5 distinct labels; value and default in `positions` | PURE | JS selects from the list only |
| `index` | `:100` | | PURE | JS `indexOf` |
| `set_state` (key lock) | `:105-111` | Keyed and locked: front-end value dropped and sent back | AMBIGUOUS (defence) | `canOperate` (`industrial.js:129`); spring return is JS only (`:141`) |
| `StackLight` `@validate tiers`, `value`; `_resize` | `:143-164` | 1 to 5 tiers; `value` padded or cut to the tier count | PURE (writes a second trait) | |
| `StackLight.set`, `get`, `all_off` | `:166-187` | Convenience API | HOST API | |

## Compact indicators (`_compact.py`)

| Item | Where | Description | Category | Front end today |
|---|---|---|---|---|
| `DeviationIndicator` `@validate span` | `:56` | `span > 0` | PURE | JS uses `span || 1` |
| `deviation`, `out_of_tolerance` | `:65-73` | | PURE | Duplicated (`compact.js:99-108`) |
| `_HistoryMixin` ring, `append`, `snapshot`, `sync_request` | `:79-114` | Float32 history buffers (see [Binary formats](#binary-formats)) | HOST | `ValueRing`, `attachHistory` (`compact.js:20-51`) |
| `Sparkline.append` | `:150` | Sets read-only `value` to the last sample | HOST | |
| `BarGraph` `@validate bars`, `value` | `:196-221` | Label strings to dicts, unknown keys rejected, limits normalized to `None` | PURE | JS reads with `parseNumber` |
| `BarGraph._update_levels` | `:223-248` | Read-only `alarm_levels`, one hysteresis per bar | PURE computation, AMBIGUOUS (history) | Read only (`compact.js:197`) |
| `oee` | `:254` | Product of three fractions in [0, 1] | HOST API (pure maths) | |
| `KPITile.delta`, `on_target` | `:304-315` | | PURE | Duplicated (`kpiDelta`, `compact.js:250`) |
| `KPITile.append` | `:317` | History and writable `value` | HOST | |

## Theme and style (`_themeswitch.py`, `_style.py`)

| Item | Description | Category | Front end today |
|---|---|---|---|
| `ThemeSwitch.__init__` | Value from the module default theme | HOST (global state) | |
| `ThemeSwitch._on_value` | `set_theme`: every widget of the kernel gets the new `theme` | HOST (cross-widget) | The view applies the page theme (`themeswitch.js:37`); `"system"` is resolved per view (`view.js:126`) |
| `set_default_style`, `set_theme`, `get_default_theme` | Module defaults for new widgets | HOST | |

A non-Python host needs its own equivalent of "every widget follows the
switch": the switch only changes the page theme by itself.

## Alarms and SCADA (`_scada.py`)

| Item | Where | Description | Category | Front end today |
|---|---|---|---|---|
| `alarm_transition` and its table | `:16-34` | ISA-18.2 state transitions | PURE | None |
| `AlarmIndicator.activate`, `clear` | `:68-77` | Process events | AMBIGUOUS (pure transition, host event) | |
| `AlarmIndicator.acknowledge`, `_handle_front_msg` (`ack`) | `:78-104` | Transition plus `on_acknowledge` callbacks | AMBIGUOUS (operator action with host audit) | Sends `ack` (`alarm.js:34`) |
| `AlarmBanner` (`raise_alarm`, `clear_alarm`, `acknowledge`, `acknowledge_all`) | `:125-200` | Alarm table kept in a private dict, published as read-only `value`, time stamps from `datetime.now()` | HOST (hidden state, time) | Sorting and counts in JS (`banner.js:10`, `:36`) |

## Process objects (`_process.py`)

| Item | Where | Description | Category | Front end today |
|---|---|---|---|---|
| `ProcessObject.__init__` | `:34` | Read-only `commands` from a class constant | PURE (per-class constant) | Read only |
| `command`, `on_command`, `_handle_front_msg` | `:40-75` | `auto` / `manual` set `auto`; other commands dispatched to callbacks; `simulate` sets `value` | HOST | Buttons disabled in auto (`process.js:97`); Python does not check `auto` |
| `Valve.demand_position`, `_handle_front_msg` (`position`) | `:99-130` | 0 to 100, not in auto, simulation | HOST | `checkEntry` 0 to 100 (`process.js:118`) |
| `SynopticCanvas.items` | `:203` | `{"widget": w}` serialized as `"IPY_MODEL_<id>"` | AMBIGUOUS (nested models) | `widget_manager.get_model` / `create_view` (`process.js:294-330`), placeholder text without a widget manager |
| `add`, `move`, `remove`, `add_pipe`, `set_flow` | `:209-253` | List edits; pipes need 2 points and a valid direction | PURE | Pipes drawn by the canvas |
| `@validate background` | `:260` | Detects PNG, JPEG or SVG and sets `background_mime` as a side effect | PURE | JS reads `background_mime` only |

## PID (`_pid.py`)

| Item | Where | Description | Category | Front end today |
|---|---|---|---|---|
| `PID` class | `:46-130` | Positional PID, bumpless transfer, anti-windup | HOST (the controller) | |
| `PIDFaceplate.__init__` | `:189` | Copies SP, OP and mode from the controller | HOST | |
| `@validate loop_mode`, `sp`, `op`; `sp_limits` | `:205-229` | Mode in `modes`; SP clamped to `sp_limits`, OP to `op_min` .. `op_max` | PURE | `spLimits`, `entryDecision` (`pid.js:13-19`, `:71`) |
| `@observe loop_mode` | `:231` | Leaving MAN sets `sp = pv` (setpoint tracking), then syncs the controller | AMBIGUOUS (pure tracking plus host sync) | |
| `@observe sp`, `op` | `:240-248` | Controller updates | HOST | |
| `_publish` | `:254` | Read-only `alarm_level` on `pv` (hysteresis) and `value = {pv, sp, op, mode}` | PURE computation, AMBIGUOUS (history) | Read only (`pid.js:166`) |
| `operator_set`, `_handle_front_msg`, `_reject` | `:280-320` | Mode rules, finite check, clamp, `confirm_delta`; `{"type": "rejected", "field", "reason"}` | PURE rules duplicated in JS, re-checked by the kernel | `entryDecision` and confirm button (`pid.js:83-97`); SP drag uses PV limits (`pid.js:113`) |

## Annunciator (`_annunciator.py`)

| Item | Where | Description | Category | Front end today |
|---|---|---|---|---|
| `annunciator_transition` | `:17` | ISA-18.1 sequences A, M, R | PURE | None |
| `add_window` | `:100` | Color and duplicate checks | PURE | |
| `@observe sequence` | `:116` | Resets every window, clears first-out | PURE | |
| `set`, `clear` | `:138-160` | Process transition, first-out mark, horn un-silenced | AMBIGUOUS (host event, hidden `_silenced` state) | |
| `acknowledge`, `reset`, `silence`, `_handle_front_msg` | `:161-230` | Operator actions with callbacks | AMBIGUOUS (operator action with host audit) | Sends the actions (`annunciator.js:24-33`); test mode drawn locally |
| `_publish` | `:200` | `value` = windows, read-only `horn` from states and `_silenced` | PURE except the hidden flag | Read only |

## Alarm list (`_alarmlist.py`)

| Item | Where | Description | Category | Front end today |
|---|---|---|---|---|
| `raise_alarm`, `clear_alarm`, `suppress`, `out_of_service` | `:103-177` | Private alarm table, `datetime.now()` stamps | HOST | |
| `acknowledge` | `:187` | Transition plus callbacks | AMBIGUOUS (as `AlarmIndicator`) | |
| `shelve`, `unshelve`, `refresh`, expiry timer | `:199-252` | `0 < s <= max_shelve`, `threading.Timer`, lazy expiry without threads; `shelved_until` published as a local ISO string | HOST (time, threads, time zone) | Filters, counts and "SHELVED until" text in JS (`alarmlist.js:19-125`) |
| `_handle_front_msg` | `:254` | `ack`, `shelve {seconds}`, `unshelve` | HOST | |

## State machine (`_statemachine.py`)

| Item | Where | Description | Category | Front end today |
|---|---|---|---|---|
| PackML model, `_check_model` | `:13-150` | Model validation and completion (positions, `acting`, `commands`, `initial`) | PURE | |
| `@validate machine`, `@observe machine` | `:165-180` | | PURE | |
| `_update_commands`, `is_acting` | `:187-194` | Read-only `available_commands` | PURE | JS reads `available_commands`, computes `acting` (`statemachine.js:76`) |
| `command`, `_handle_front_msg` | `:201`, `:218` | Operator commands, `{"type": "rejected", "command", "state"}` | AMBIGUOUS (driven from both sides) | Sends `command` (`statemachine.js:88`) |
| `state_complete` | `:210` | SC transition, kernel only | HOST | |

## Event log (`_eventlog.py`)

| Item | Description | Category | Front end today |
|---|---|---|---|
| `@observe max_events` | Trims `value` | PURE | |
| `log` | Category check, id, `time.time()` stamp | HOST | |
| `connect`, `disconnect` | Audit trail of other widgets' traits | HOST | |
| `events`, `clear` | | PURE | Filtering, sorting and CSV in JS (`eventlog.js:17-32`) |

## Graphs

### `GraphWidget` base (`_graph.py`)

| Item | Where | Description | Category | Front end today |
|---|---|---|---|---|
| `add_cursor`, `move_cursor`, `remove_cursor`, `annotate`, `clear_annotations` | `:42-100` | List edits | PURE | `addCursor` (`core/plot.js:429`) |
| `@validate cursors` | `:56` | Numeric `x`, default names `C<n>` | PURE | |
| `cursor_values`, `values_at` | `:76-88` | Read-only readout for Python users | AMBIGUOUS (needs the host data) | Each view computes its own readout (`cursorText`); `cursor_values` is never read |

### Per widget (`_chart.py`, `_graphs.py`, `_trend.py`)

| Widget | Python logic | Category | Notes |
|---|---|---|---|
| `WaveformChart` | Ring buffer, `append` (shape rules), `clear`, `snapshot` on `sync_request`, `values_at` (linear interpolation) | HOST | Interpolation duplicated in JS (`chart.js:179`) on float32 data |
| `IntensityChart` | Ring buffer, `append`, `value = {rows, min, max, argmax}` of the last row, `values_at` (`round`) | HOST | Colormap and autoscale in JS; `round` (banker's) differs from `Math.round` at .5 |
| `DigitalWaveformGraph` | `set_data` (integers unpacked LSB first by `unpack_bits`), `lines` auto-named, `@validate buses`, `bus_values` | HOST (data), PURE (validation, bus values) | `busValue` duplicated (`digital.js:11`) |
| `MixedSignalGraph` | `set_analog` | HOST | No length check against the digital samples |
| `TrendChart` | `@validate pens` (defaults, unique names, `max > min`), per-pen rings, `add`, `add_many`, `values_at` (`np.interp`) | PURE (pen validation), HOST (data) | `penOf` applies display defaults (`trend.js`) |

### Polar family (`_polar.py`)

| Item | Description | Category |
|---|---|---|
| `_SeriesWidget.clear`, `_add` | Series list edits (replace by name) | PURE |
| `PolarPlot.plot` | Length and `style` checks | PURE |
| `SmithChart.gamma`, `impedance`, `@validate z0`, `plot` | Z to Γ conversion with `z0 > 0` | PURE (JS has `gammaToZ`, `polar.js:17`) |
| `RadarChart` `@validate ranges`, `plot` | `max > min`; values per axis | PURE |

All polar data travels as JSON in `value` (no buffers).

### `PictureControl` (`_picture.py`)

| Item | Description | Category |
|---|---|---|
| Drawing commands (`line`, `rect`, `circle`, `arc`, `polygon`, `polyline`, `text`) | JSON command builders | PURE builders, HOST batching |
| `image` | PNG or JPEG bytes, or arrays clipped to 0-255 and converted to RGBA | HOST (conversion keeps the payload small) |
| `flush`, post-cell hook, 20 ms timer | Batching of draw commands | HOST |
| `_handle_front_msg` | `sync_request` (snapshot), `click` (sets `value`, callbacks) | HOST |

## Panel (`_panel.py`)

`Panel` is an `ipywidgets.GridBox`, not an anywidget: its children are
`IPY_MODEL_` references rendered by the Jupyter widget manager, and
`to_dict` / `from_dict` are host helpers. A non-Python host lays out the
widgets itself (a CSS grid of AFM widgets).

## Binary formats

All buffers are written little-endian by Python (`<f4`, `<f8`, `uint8`) and
read by `core/buffers.js` (`bytesOf` copies into an aligned `ArrayBuffer`,
then `toFloat32`, `toFloat64`, `toUint8`).

| Widget | Message | Direction | JSON fields | Buffers | Layout | Front end |
|---|---|---|---|---|---|---|
| all | `hb` | host → front | `session`, `interval` | 0 | | `liveness.js`, `view.js` |
| charts, trend, digital, picture, sparkline, KPI tile | `sync_request` | front → host | | 0 | Sent by each new view | |
| `WaveformChart` | `append`, `snapshot` | host → front | `n_points`, `total` | 1 | `<f4`, row-major `(n_points, n_traces)`, chronological | `chart.js:111-121` |
| `WaveformChart`, `IntensityChart`, `TrendChart` | `clear` | host → front | | 0 | | |
| `IntensityChart` | `append`, `snapshot` | host → front | `n_rows`, `total` | 1 | `<f4`, row-major `(n_rows, n_bins)` | `intensity.js:60-74` |
| `DigitalWaveformGraph`, `MixedSignalGraph` | `data` (full replacement, also the snapshot) | host → front | `n_samples`, `n_lines`, `n_analog`, `n_traces` | 2 | buffer 0: `uint8` 0/1, row-major `(n_samples, n_lines)`, one byte per line (not bit-packed); buffer 1: `<f4`, row-major `(n_analog, n_traces)`, empty for a digital graph | `digital.js:46-55` |
| `TrendChart` | `append`, `snapshot` | host → front | `pens: [[pen_index, n, total], ...]` | 2 per entry | buffer `2k`: times `<f8` (Unix seconds), buffer `2k+1`: values `<f4`, both length `n`, chronological | `trend.js:220-235` |
| `Sparkline`, `KPITile` | `append`, `snapshot` | host → front | `n` | 1 | `<f4`, `n` values, chronological | `compact.js:40-51` |
| `PictureControl` | `draw` | host → front | `clear`, `commands` (`op`: `line`, `rect`, `arc`, `polygon`, `text`, `image`) | one per image | `mime` `image/png`, `image/jpeg` (file bytes) or `rgba` (`uint8`, row-major `(ph, pw, 4)`); `buffer` is the index in this message | `picture.js:26-54` |
| `PictureControl` | `click` | front → host | `x`, `y`, `button` | 0 | | |
| `BooleanWidget` | `latch_expired` | host → front | | 0 | | `boolean.js:69` |
| `PIDFaceplate` | `rejected` | host → front | `field`, `reason` | 0 | | `pid.js:59` |
| `StateMachine` | `rejected` | host → front | `command`, `state` | 0 | | `statemachine.js:27` |
| operator objects | `ack`, `ack_all`, `command`, `position`, `set`, `loop_mode`, `acknowledge`, `reset`, `silence`, `test`, `shelve`, `unshelve` | front → host | per message | 0 | | host handlers listed above |

`total` gives the absolute index of the last sample, so a view can place an
`append` after a `snapshot` and detect gaps. Python sends no decimation or
colormapped data: the front end already does that work.

## Class defaults that differ from instance defaults

A host that reads class defaults (as `pypi_afm` does) gets these values
wrong. Excluding `_session` and `_heartbeat`, which concern every widget:

| Widgets | Trait | Class default | Instance default |
|---|---|---|---|
| Most indicators (`Tank`, `Gauge`, `Meter`, `VUMeter`, `Thermometer`, `SevenSegment`, `Compass`, `LED`, `AnalogIndicator`, `Transmitter`, charts, compact indicators, `StackLight`, `Pipe`, `SynopticCanvas`, `EventLog`) | `mode` | `"control"` | `"indicator"` |
| Every widget except `Knob`, `Dial`, `Gauge`, `Compass` | `size` | `(160, 160)` | per class (`_default_size`) |
| `Valve`, `Pump`, `Motor` | `commands` | `[]` | per class |
| `SelectorSwitch` | `value` | `""` | `"OFF"` |
| `StackLight` | `value` | `[]` | `["off", "off", "off"]` |
| `StateMachine` | `machine`, `value`, `available_commands` | empty | PackML model, `"Stopped"`, `["Reset", "Abort"]` |
| `PIDFaceplate` | `value` | `{}` | `{pv, sp, op, mode}` |
| `DeviationIndicator`, `Sparkline`, `KPITile`, `PIDFaceplate` | `value` / `pv` | NaN | NaN (written as the invalid JSON token `NaN` by `pypi_afm`) |

The schema fixes the intended default of every trait; the Python classes are
aligned on it widget by widget, with a conformance test.

## Ambiguities

1. **Alarm levels with hysteresis** (`alarm_level`, `BarGraph.alarm_levels`,
   `PIDFaceplate.alarm_level`). The result depends on the previous level, so
   on the history of values seen. Two computations (kernel and view) can
   disagree if they do not see the same sequence (a view opened later, or
   marimo applying updates twice). Proposed rule: the kernel is authoritative
   when it exists (`_session` non-empty); without a kernel, the front end
   computes the level, seeds its previous level from the `alarm_level` trait,
   keeps it per model (not per view) and writes it back so that the host sees
   it.
2. **Peak hold** (`peak`): time-dependent (`peak_decay`) and history-dependent.
   It can move to the front end with the same rule as alarm levels (timer on
   the front end, `performance.now()`).
3. **Range check of front-end values** (NUM-010, selector key lock, E-stop
   only-latch rule, PID operator rules). They exist on both sides: the front
   end prevents the input, the kernel rejects it from any client. Both stay;
   the front-end copy becomes the shared, schema-driven one, with parity tests.
4. **Out-of-range values set by the host**: without `coerce`, Python keeps a
   host value outside [`min`, `max`] (the display pins and flags it,
   NUM-006). The front end must not clamp such a value, only display it
   clamped; with `coerce` it displays the clamped value.
5. **Invalid scales** (`max <= min`, log scale with `min <= 0`): Python raises;
   the front end has no exception to raise. Proposed rule: keep the last valid
   scale (initially the schema defaults) and report the problem in the
   console, once.
6. **Traits out of their schema bounds** (for example `angle_range = 400`):
   Python raises `TraitError`; the front end clamps to the bounds and falls
   back to the default for a value of the wrong type.
7. **Compass heading**: Python wraps modulo 360, JS clamps to [0, 360].
   Resolve on the wrap when the Compass is migrated.
8. **SVG skins**: `sanitize_svg` (Python) and `parseSkin` (JS) differ (DOCTYPE
   rejection, `@import` and `url()` handling in `<style>`). Without a kernel,
   `parseSkin` is the only barrier; align it on `sanitize_svg`.
9. **Alarm, annunciator and state-machine transitions**: the transitions are
   pure, but they are triggered by both sides and the operator actions carry
   host callbacks (audit). Proposed rule: the transition tables move to the
   schema and to the front end; the front end applies an operator action
   locally only when there is no kernel, and always sends the message.
10. **Nested widgets** (`SynopticCanvas`): need a widget manager; a
    non-Python host has none. Handled last, as the mission plans.
11. **`_seq` deduplication** (boolean widgets): two views can send the same
    sequence number. Harmless for a single view; to be kept as is.
12. **Picture, charts, sparkline, KPI tile, trend**: data production stays on
    the host; a non-Python host must answer `sync_request` with a snapshot in
    the documented format, or the view stays empty until data arrives.

## Other findings

These are not migration steps, but they were found during the inventory:

- `IntensityChart.value` can contain NaN without `float_serializers`.
- `_SeriesWidget.value` and `cursor_values` use `float_serializers`, whose
  `from_json` turns every string into a float: names and colors would fail if
  a front end ever sent `value` back.
- `TrendChart._add`: if a later pen fails the length check, earlier pens are
  already stored but nothing is sent.
- `IntensityChart.clear` keeps `value`.
- `ProcessObject` commands are not refused in auto mode by the kernel.
- PID setpoint drag uses the PV limits instead of `sp_limits` (the kernel
  clamps).

## Migration order (phase 3 proposal)

1. Numeric family on the `NumericWidget` base (the pilot covers `Knob` and
   `Tank`), then `Dial`, `Thermometer`, `FillSlide`, `SevenSegment`,
   `Compass`, `Gauge`, `Meter`, `VUMeter` (peak hold), `AnalogIndicator`,
   `Transmitter`, `NumericEntry`.
2. Boolean family (defaults, `_seq`, E-stop rule).
3. Compact indicators (bar alarm levels, history buffers).
4. Operator objects: `SelectorSwitch`, `StackLight`, `AlarmIndicator`,
   `Annunciator`, `StateMachine`, `PIDFaceplate`, `AlarmBanner`, `AlarmList`,
   `EventLog`, `ThemeSwitch`.
5. Graphs and their binary formats: `WaveformChart`, `IntensityChart`,
   `DigitalWaveformGraph`, `MixedSignalGraph`, `TrendChart`, polar family,
   `PictureControl`.
6. Process objects, then `SynopticCanvas`.

## Appendix: synchronized traits

Generated from the Python classes (`class_traits(sync=True)`). Each family
base lists its own traits; each widget lists the traits it adds or whose
default differs from its base. `_model_*`, `_view_*`, `_dom_classes`,
`layout`, `tabbable` and `_view_count` come from ipywidgets and are not used
by the front end.

### `InstrumentWidget` (base)

| Trait | Type | Default |
|---|---|---|
| `_dom_classes` | TypedTuple | `()` |
| `_heartbeat` | Float | `2.0` |
| `_kind` | Unicode | `''` |
| `_model_module` | Unicode | `'anywidget'` |
| `_model_module_version` | Unicode | `'~0.11.*'` |
| `_model_name` | Unicode | `'AnyModel'` |
| `_session` | Unicode | `'<kernel session id>'` |
| `_view_count` | Int, nullable | `None` |
| `_view_module` | Unicode | `'anywidget'` |
| `_view_module_version` | Unicode | `'~0.11.*'` |
| `_view_name` | Unicode | `'AnyView'` |
| `disabled` | Bool | `False` |
| `label` | Unicode | `''` |
| `layout` | InstanceDict | `Layout()` |
| `mode` | Enum (control, indicator) | `'control'` |
| `size` | Tuple | `(160, 160)` |
| `skin` | Dict | `{}` |
| `style` | Enum (modern, classic, system) | `'modern'` |
| `tabbable` | Bool, nullable | `None` |
| `theme` | Enum (auto, light, dark, system) | `'auto'` |
| `tooltip` | Unicode | `''` |
| `visible` | Bool | `True` |

### `NumericWidget` (base)

| Trait | Type | Default |
|---|---|---|
| `alarm_level` | Enum (normal, lo, lolo, hi, hihi), read-only | `'normal'` |
| `animate` | Bool | `False` |
| `animation_ms` | Int, min 0, max 300 | `200` |
| `coerce` | Bool | `False` |
| `deadband` | Float, min 0.0 | `0.0` |
| `eng_max` | Float, nullable | `None` |
| `eng_min` | Float, nullable | `None` |
| `entry` | Bool | `True` |
| `format` | Unicode | `'%.1f'` |
| `hi` | Float, nullable | `None` |
| `hihi` | Float, nullable | `None` |
| `lo` | Float, nullable | `None` |
| `lolo` | Float, nullable | `None` |
| `max` | Float | `100.0` |
| `min` | Float | `0.0` |
| `minor_ticks` | Int, min 0 | `4` |
| `raw_max` | Float, nullable | `None` |
| `raw_min` | Float, nullable | `None` |
| `scale` | Enum (linear, log) | `'linear'` |
| `show_limits` | Bool | `False` |
| `step` | Float | `0.0` |
| `ticks` | Int, min 1 | `5` |
| `unit` | Unicode | `''` |
| `update_rate` | Float, min 1.0 | `30.0` |
| `value` | NumericValue | `0.0` |

### `BooleanWidget` (base)

| Trait | Type | Default |
|---|---|---|
| `_pressed` | Bool | `False` |
| `_seq` | Int | `0` |
| `confirm` | Bool | `False` |
| `default_state` | Bool | `False` |
| `latch_timeout` | Float, min 0.0 | `0.0` |
| `mechanical_action` | Enum (switch_when_pressed, switch_when_released, switch_until_released, latch_when_pressed, latch_when_released, latch_until_released) | `'switch_when_pressed'` |
| `value` | Bool | `False` |

### `GraphWidget` (base)

| Trait | Type | Default |
|---|---|---|
| `annotations` | List | `[]` |
| `cursor_values` | List, read-only | `[]` |
| `cursors` | List | `[]` |
| `export` | Bool | `True` |
| `unit` | Unicode | `''` |
| `x_unit` | Unicode | `''` |

### `AlarmBanner`

`_kind` `alarmbanner`, base `InstrumentWidget`, default mode `control`, size `(520, 180)`.

| Trait | Type | Default |
|---|---|---|
| `value` | List, read-only | `[]` |

### `AlarmIndicator`

`_kind` `alarmindicator`, base `InstrumentWidget`, default mode `control`, size `(260, 64)`.

| Trait | Type | Default |
|---|---|---|
| `alarm_id` | Unicode | `''` |
| `message` | Unicode | `''` |
| `priority` | Enum (low, medium, high, critical) | `'high'` |
| `value` | Enum (normal, active_unacknowledged, active_acknowledged, cleared_unacknowledged) | `'normal'` |

### `AlarmList`

`_kind` `alarmlist`, base `InstrumentWidget`, default mode `control`, size `(640, 240)`.

| Trait | Type | Default |
|---|---|---|
| `max_shelve` | Float, min 1.0 | `28800.0` |
| `shelve_durations` | List | `[300.0, 900.0, 3600.0]` |
| `value` | List, read-only | `[]` |

### `AnalogIndicator`

`_kind` `analogindicator`, base `NumericWidget`, default mode `indicator`, size `(240, 56)`.

| Trait | Type | Default |
|---|---|---|
| `normal_hi` | Float, nullable | `None` |
| `normal_lo` | Float, nullable | `None` |
| `orientation` | Enum (horizontal, vertical) | `'horizontal'` |
| `show_limits` | Bool | `True` |
| `target` | Float, nullable | `None` |

### `Annunciator`

`_kind` `annunciator`, base `InstrumentWidget`, default mode `control`, size `(420, 170)`.

| Trait | Type | Default |
|---|---|---|
| `columns` | Int, min 1, max 12 | `4` |
| `first_out` | Bool | `False` |
| `horn` | Bool, read-only | `False` |
| `sequence` | Enum (A, M, R) | `'A'` |
| `test` | Bool | `False` |
| `value` | List, read-only | `[]` |

### `BarGraph`

`_kind` `bargraph`, base `InstrumentWidget`, default mode `indicator`, size `(260, 160)`.

| Trait | Type | Default |
|---|---|---|
| `alarm_levels` | List, read-only | `[]` |
| `bars` | List | `[]` |
| `deadband` | Float, min 0.0 | `0.0` |
| `format` | Unicode | `'%.1f'` |
| `max` | Float | `100.0` |
| `min` | Float | `0.0` |
| `unit` | Unicode | `''` |
| `value` | List | `[]` |

### `Compass`

`_kind` `compass`, base `NumericWidget`, default mode `indicator`, size `(160, 160)`.

| Trait | Type | Default |
|---|---|---|
| `format` | Unicode | `'%.0f'` |
| `max` | Float | `360.0` |
| `ticks` | Int, min 1 | `8` |
| `unit` | Unicode | `'°'` |

### `DeviationIndicator`

`_kind` `deviation`, base `InstrumentWidget`, default mode `indicator`, size `(220, 44)`.

| Trait | Type | Default |
|---|---|---|
| `format` | Unicode | `'%.2f'` |
| `setpoint` | Float | `0.0` |
| `span` | Float | `10.0` |
| `tolerance` | Float, min 0.0 | `1.0` |
| `unit` | Unicode | `''` |
| `value` | Float | `nan` |

### `Dial`

`_kind` `dial`, base `NumericWidget`, default mode `control`, size `(160, 160)`.

| Trait | Type | Default |
|---|---|---|
| `angle_range` | Float, min 10.0, max 360.0 | `300.0` |
| `turns` | Int, min 1 | `1` |

### `DigitalWaveformGraph`

`_kind` `digitalgraph`, base `GraphWidget`, default mode `indicator`, size `(480, 240)`.

| Trait | Type | Default |
|---|---|---|
| `buses` | List | `[]` |
| `dt` | Float | `1.0` |
| `lines` | List | `[]` |
| `show_lines_in_bus` | Bool | `True` |
| `value` | Dict, read-only | `{}` |
| `x0` | Float | `0.0` |

### `EmergencyStop`

`_kind` `emergencystop`, base `BooleanWidget`, default mode `control`, size `(110, 110)`.

No own traits.

### `EventLog`

`_kind` `eventlog`, base `InstrumentWidget`, default mode `indicator`, size `(600, 200)`.

| Trait | Type | Default |
|---|---|---|
| `max_events` | Int, min 1 | `500` |
| `value` | List, read-only | `[]` |

### `FillSlide`

`_kind` `fillslide`, base `NumericWidget`, default mode `control`, size `(260, 70)`.

| Trait | Type | Default |
|---|---|---|
| `fill_color` | Unicode | `''` |
| `orientation` | Enum (horizontal, vertical) | `'horizontal'` |

### `Gauge`

`_kind` `gauge`, base `NumericWidget`, default mode `indicator`, size `(160, 160)`.

| Trait | Type | Default |
|---|---|---|
| `peak` | Float, nullable, read-only | `None` |
| `peak_decay` | Float, min 0.0 | `0.0` |
| `peak_hold` | Bool | `False` |
| `ranges` | List | `[]` |
| `variant` | Enum (circular, semicircular) | `'circular'` |

### `IntensityChart`

`_kind` `intensitychart`, base `GraphWidget`, default mode `indicator`, size `(480, 240)`.

| Trait | Type | Default |
|---|---|---|
| `autoscale_z` | Bool | `True` |
| `colormap` | Enum (viridis, inferno, magma, plasma, gray, jet) | `'viridis'` |
| `dt` | Float | `1.0` |
| `history` | Int, min 2 | `200` |
| `n_bins` | Int, min 1 | `64` |
| `show_colorbar` | Bool | `True` |
| `value` | Dict, read-only | `{}` |
| `y_max` | Float, nullable | `None` |
| `y_min` | Float | `0.0` |
| `z_max` | Float | `1.0` |
| `z_min` | Float | `0.0` |

### `KPITile`

`_kind` `kpitile`, base `InstrumentWidget`, default mode `indicator`, size `(190, 96)`.

| Trait | Type | Default |
|---|---|---|
| `format` | Unicode | `'%.1f'` |
| `higher_is_better` | Bool | `True` |
| `history` | Int, min 2 | `30` |
| `show_sparkline` | Bool | `True` |
| `target` | Float, nullable | `None` |
| `unit` | Unicode | `''` |
| `value` | Float | `nan` |

### `Knob`

`_kind` `knob`, base `NumericWidget`, default mode `control`, size `(160, 160)`.

| Trait | Type | Default |
|---|---|---|
| `angle_range` | Float, min 10.0, max 360.0 | `270.0` |

### `LED`

`_kind` `led`, base `BooleanWidget`, default mode `indicator`, size `(48, 48)`.

| Trait | Type | Default |
|---|---|---|
| `blink` | Bool | `False` |
| `blink_hz` | Float, min 0.1, max 10.0 | `2.0` |
| `off_color` | Unicode | `''` |
| `on_color` | Unicode | `'#22c55e'` |
| `shape` | Enum (round, square) | `'round'` |

### `Meter`

`_kind` `meter`, base `NumericWidget`, default mode `indicator`, size `(200, 140)`.

| Trait | Type | Default |
|---|---|---|
| `angle_range` | Float, min 20.0, max 150.0 | `90.0` |
| `peak` | Float, nullable, read-only | `None` |
| `peak_decay` | Float, min 0.0 | `0.0` |
| `peak_hold` | Bool | `False` |

### `MixedSignalGraph`

`_kind` `mixedgraph`, base `GraphWidget`, default mode `indicator`, size `(520, 320)`.

| Trait | Type | Default |
|---|---|---|
| `analog_fraction` | Float, min 0.1, max 0.9 | `0.55` |
| `buses` | List | `[]` |
| `dt` | Float | `1.0` |
| `lines` | List | `[]` |
| `show_lines_in_bus` | Bool | `True` |
| `traces` | List | `[]` |
| `value` | Dict, read-only | `{}` |
| `x0` | Float | `0.0` |
| `y_max` | Float, nullable | `None` |
| `y_min` | Float, nullable | `None` |

### `Motor`

`_kind` `motor`, base `InstrumentWidget`, default mode `control`, size `(90, 90)`.

| Trait | Type | Default |
|---|---|---|
| `animate` | Bool | `True` |
| `auto` | Bool | `True` |
| `commands` | List, read-only | `[]` |
| `simulate` | Bool | `False` |
| `tag` | Unicode | `''` |
| `value` | Enum (stopped, forward, reverse, fault) | `'stopped'` |

### `NumericEntry`

`_kind` `numericentry`, base `NumericWidget`, default mode `control`, size `(180, 230)`.

| Trait | Type | Default |
|---|---|---|
| `confirm_delta` | Float, nullable | `None` |
| `format` | Unicode | `'%.2f'` |

### `PIDFaceplate`

`_kind` `pidfaceplate`, base `InstrumentWidget`, default mode `control`, size `(240, 236)`.

| Trait | Type | Default |
|---|---|---|
| `alarm_level` | Enum (normal, lo, lolo, hi, hihi), read-only | `'normal'` |
| `confirm_delta` | Float, nullable | `None` |
| `deadband` | Float, min 0.0 | `0.0` |
| `format` | Unicode | `'%.1f'` |
| `hi` | Float, nullable | `None` |
| `hihi` | Float, nullable | `None` |
| `lo` | Float, nullable | `None` |
| `lolo` | Float, nullable | `None` |
| `loop_mode` | Enum (MAN, AUTO, CAS) | `'AUTO'` |
| `modes` | List | `['MAN', 'AUTO']` |
| `op` | Float | `0.0` |
| `op_max` | Float | `100.0` |
| `op_min` | Float | `0.0` |
| `op_unit` | Unicode | `'%'` |
| `pv` | Float | `nan` |
| `pv_max` | Float | `100.0` |
| `pv_min` | Float | `0.0` |
| `sp` | Float | `0.0` |
| `sp_max` | Float, nullable | `None` |
| `sp_min` | Float, nullable | `None` |
| `sp_tracking` | Bool | `False` |
| `tag` | Unicode | `''` |
| `unit` | Unicode | `''` |
| `value` | Dict, read-only | `{}` |

### `PictureControl`

`_kind` `picture`, base `InstrumentWidget`, default mode `control`, size `(320, 200)`.

| Trait | Type | Default |
|---|---|---|
| `background` | Unicode | `''` |
| `value` | Dict, read-only | `{}` |

### `Pipe`

`_kind` `pipe`, base `InstrumentWidget`, default mode `indicator`, size `(80, 80)`.

| Trait | Type | Default |
|---|---|---|
| `flow_animation` | Bool | `True` |
| `flow_direction` | Enum (forward, reverse) | `'forward'` |
| `fluid_color` | Unicode | `''` |
| `rotation` | Enum (0, 90, 180, 270) | `0` |
| `shape` | Enum (straight, elbow, tee, cross) | `'straight'` |
| `thickness` | Float, min 2.0 | `14.0` |
| `value` | Bool | `False` |

### `PolarPlot`

`_kind` `polar`, base `InstrumentWidget`, default mode `indicator`, size `(260, 260)`.

| Trait | Type | Default |
|---|---|---|
| `angle_unit` | Enum (deg, rad) | `'deg'` |
| `direction` | Enum (ccw, cw) | `'ccw'` |
| `r_max` | Float, nullable | `None` |
| `rings` | Int, min 1 | `4` |
| `show_legend` | Bool | `True` |
| `unit` | Unicode | `''` |
| `value` | List | `[]` |
| `zero` | Enum (E, N) | `'E'` |

### `ProcessObject`

`_kind` ``, base `InstrumentWidget`, default mode `control`, size `(90, 90)`.

| Trait | Type | Default |
|---|---|---|
| `auto` | Bool | `True` |
| `commands` | List, read-only | `[]` |
| `simulate` | Bool | `False` |
| `tag` | Unicode | `''` |

### `Pump`

`_kind` `pump`, base `InstrumentWidget`, default mode `control`, size `(90, 90)`.

| Trait | Type | Default |
|---|---|---|
| `animate` | Bool | `True` |
| `auto` | Bool | `True` |
| `commands` | List, read-only | `[]` |
| `direction` | Enum (right, left, up, down) | `'right'` |
| `simulate` | Bool | `False` |
| `tag` | Unicode | `''` |
| `value` | Enum (stopped, running, fault) | `'stopped'` |

### `PushButton`

`_kind` `pushbutton`, base `BooleanWidget`, default mode `control`, size `(110, 44)`.

| Trait | Type | Default |
|---|---|---|
| `color` | Enum (grey, green, red, black, yellow, blue, white) | `'grey'` |
| `lamp` | Bool, nullable | `None` |
| `lamp_blink` | Bool | `False` |
| `lamp_color` | Enum (green, red, amber, blue, white) | `'green'` |
| `mechanical_action` | Enum (switch_when_pressed, switch_when_released, switch_until_released, latch_when_pressed, latch_when_released, latch_until_released) | `'latch_when_released'` |
| `shape` | Enum (rect, round) | `'rect'` |
| `text` | Unicode | `'OK'` |

### `RadarChart`

`_kind` `radar`, base `InstrumentWidget`, default mode `indicator`, size `(260, 260)`.

| Trait | Type | Default |
|---|---|---|
| `axes` | List | `[]` |
| `fill` | Bool | `True` |
| `ranges` | List | `[]` |
| `show_legend` | Bool | `True` |
| `value` | List | `[]` |

### `RockerSwitch`

`_kind` `rockerswitch`, base `BooleanWidget`, default mode `control`, size `(60, 100)`.

No own traits.

### `SelectorSwitch`

`_kind` `selectorswitch`, base `InstrumentWidget`, default mode `control`, size `(140, 130)`.

| Trait | Type | Default |
|---|---|---|
| `default_position` | Unicode, nullable | `None` |
| `keyed` | Bool | `False` |
| `locked` | Bool | `False` |
| `positions` | List | `['HAND', 'OFF', 'AUTO']` |
| `spring_return` | List | `[]` |
| `value` | Unicode | `''` |

### `SevenSegment`

`_kind` `sevensegment`, base `NumericWidget`, default mode `indicator`, size `(200, 80)`.

| Trait | Type | Default |
|---|---|---|
| `color` | Unicode | `''` |
| `decimals` | Int, min 0 | `1` |
| `digits` | Int, min 1, max 16 | `4` |
| `max` | Float | `1000000000.0` |
| `min` | Float | `-1000000000.0` |

### `SlideSwitch`

`_kind` `slideswitch`, base `BooleanWidget`, default mode `control`, size `(90, 44)`.

No own traits.

### `SmithChart`

`_kind` `smith`, base `InstrumentWidget`, default mode `indicator`, size `(260, 260)`.

| Trait | Type | Default |
|---|---|---|
| `show_admittance` | Bool | `False` |
| `show_legend` | Bool | `True` |
| `value` | List | `[]` |
| `z0` | Float, min 0.0 | `50.0` |

### `Sparkline`

`_kind` `sparkline`, base `InstrumentWidget`, default mode `indicator`, size `(160, 36)`.

| Trait | Type | Default |
|---|---|---|
| `format` | Unicode | `'%.4g'` |
| `history` | Int, min 2 | `60` |
| `unit` | Unicode | `''` |
| `value` | Float, read-only | `nan` |

### `StackLight`

`_kind` `stacklight`, base `InstrumentWidget`, default mode `indicator`, size `(120, 200)`.

| Trait | Type | Default |
|---|---|---|
| `buzzer` | Bool | `False` |
| `labels` | List | `[]` |
| `tiers` | List | `['red', 'amber', 'green']` |
| `value` | List | `[]` |

### `StateMachine`

`_kind` `statemachine`, base `InstrumentWidget`, default mode `control`, size `(560, 250)`.

| Trait | Type | Default |
|---|---|---|
| `available_commands` | List, read-only | `[]` |
| `last_command` | Unicode, read-only | `''` |
| `machine` | Dict | `{}` |
| `value` | Unicode, read-only | `''` |

### `SynopticCanvas`

`_kind` `synoptic`, base `InstrumentWidget`, default mode `indicator`, size `(640, 360)`.

| Trait | Type | Default |
|---|---|---|
| `background` | Bytes | `b''` |
| `background_mime` | Unicode | `''` |
| `items` | List | `[]` |
| `pipes` | List | `[]` |
| `value` | Dict, read-only | `{}` |

### `Tank`

`_kind` `tank`, base `NumericWidget`, default mode `indicator`, size `(120, 200)`.

| Trait | Type | Default |
|---|---|---|
| `fill_color` | Unicode | `''` |
| `markers` | List | `[]` |

### `ThemeSwitch`

`_kind` `themeswitch`, base `InstrumentWidget`, default mode `control`, size `(240, 30)`.

| Trait | Type | Default |
|---|---|---|
| `page_theme` | Bool | `True` |
| `value` | Enum (auto, light, system, dark) | `'auto'` |

### `Thermometer`

`_kind` `thermometer`, base `NumericWidget`, default mode `indicator`, size `(100, 220)`.

| Trait | Type | Default |
|---|---|---|
| `fill_color` | Unicode | `''` |
| `max` | Float | `120.0` |
| `min` | Float | `-20.0` |
| `ticks` | Int, min 1 | `7` |
| `unit` | Unicode | `'°C'` |

### `ToggleSwitch`

`_kind` `toggleswitch`, base `BooleanWidget`, default mode `control`, size `(60, 100)`.

| Trait | Type | Default |
|---|---|---|
| `orientation` | Enum (vertical, horizontal) | `'vertical'` |

### `Transmitter`

`_kind` `transmitter`, base `NumericWidget`, default mode `indicator`, size `(110, 84)`.

| Trait | Type | Default |
|---|---|---|
| `format` | Unicode | `'%.2f'` |
| `status` | Enum (ok, failure, check, out_of_spec, maintenance) | `'ok'` |
| `status_text` | Unicode | `''` |
| `tag` | Unicode | `''` |

### `TrendChart`

`_kind` `trendchart`, base `GraphWidget`, default mode `indicator`, size `(560, 260)`.

| Trait | Type | Default |
|---|---|---|
| `history` | Int, min 2 | `10000` |
| `pens` | List | `[]` |
| `span` | Float, min 1.0 | `600.0` |
| `value` | Dict, read-only | `{}` |

### `VUMeter`

`_kind` `vumeter`, base `NumericWidget`, default mode `indicator`, size `(60, 200)`.

| Trait | Type | Default |
|---|---|---|
| `orientation` | Enum (vertical, horizontal) | `'vertical'` |
| `peak` | Float, nullable, read-only | `None` |
| `peak_decay` | Float, min 0.0 | `0.0` |
| `peak_hold` | Bool | `False` |
| `segments` | Int, min 2 | `20` |

### `Valve`

`_kind` `valve`, base `InstrumentWidget`, default mode `control`, size `(90, 90)`.

| Trait | Type | Default |
|---|---|---|
| `auto` | Bool | `True` |
| `commands` | List, read-only | `[]` |
| `orientation` | Enum (horizontal, vertical) | `'horizontal'` |
| `position` | Float, min 0.0, max 100.0, nullable | `None` |
| `simulate` | Bool | `False` |
| `tag` | Unicode | `''` |
| `value` | Enum (open, closed, transit, fault) | `'closed'` |

### `WaveformChart`

`_kind` `waveformchart`, base `GraphWidget`, default mode `indicator`, size `(480, 240)`.

| Trait | Type | Default |
|---|---|---|
| `autoscale_y` | Bool | `False` |
| `dt` | Float | `1.0` |
| `history` | Int, min 2 | `1024` |
| `n_traces` | Int, min 1 | `1` |
| `paused` | Bool | `False` |
| `show_legend` | Bool | `True` |
| `traces` | List | `[]` |
| `update_mode` | Enum (strip, scope, sweep) | `'strip'` |
| `value` | List, read-only | `[]` |
| `y_max` | Float | `1.0` |
| `y_min` | Float | `-1.0` |

