# Trait contract for host authors

This page is for authors of hosts that render the widgets without the Python
package: a notebook for another language that loads anywidget front-end
modules (such as [KaimonSlate.jl](hosts.md#kaimonslatejl)), a wrapper library
for another language, or a custom web page. Such a host binds each widget to a
plain dictionary of traits. The trait contract tells it which traits exist,
what values they accept, who writes them, and which messages and binary
buffers travel between the host and the front end (HOST-001).

!!! warning "Visualization only"
    Without a host owning the state, the front end computes alarm levels,
    annunciator sequences and other derived states itself. These are a
    visualization for monitoring, teaching and prototyping: they are not a
    protection layer and never replace the safety functions of a process.
    See the [safety notice](safety.md).

## Files

The Python wheel ships everything a host needs, and no Python code has to run:

| File | Content |
|---|---|
| `anywidget_instruments/static/index.js` | The front-end module (ES module, unminified, with `index.js.map`), exporting `initialize` and `render` as anywidget expects |
| `anywidget_instruments/static/index.css` | Styles, scoped under `.awi-root` |
| `anywidget_instruments/static/contract.json` | The contract, flattened for hosts (generated) |
| `anywidget_instruments/schema/*.schema.json` | One JSON Schema (draft 2020-12) per widget and per base class: the source of truth |

The schemas describe a trait dictionary: validate the dictionary a host builds
against the schema of the widget to catch mistakes early. `contract.json` is
the same information resolved for programs (bases merged in, references
followed), easier to read from another language.

## `contract.json`

```json
{
  "format": 1,
  "version": "…",
  "encoding": { "nonfinite": "…", "buffers": "…" },
  "frameworkTraits": ["_anywidget_id", "_esm", "layout", "…"],
  "widgets": {
    "Tank": {
      "class": "Tank",
      "kind": "tank",
      "abstract": false,
      "schema": "schema/tank.schema.json",
      "traits": { "value": { "type": "number", "nonfinite": true, "default": 0, "writer": "both" }, "…": {} },
      "messages": [{ "type": "hb", "direction": "host-to-front", "…": "…" }]
    }
  }
}
```

- `widgets` is keyed by class name. Abstract entries (`InstrumentWidget`,
  `NumericWidget`, `GraphWidget`, …) are bases already merged into the
  concrete widgets; a host only needs the entries with `abstract: false`.
- `kind` is the value of the `_kind` trait, which selects the view.
- `format` changes only when this layout changes in a way a host must adapt
  to (a key renamed or removed, a meaning changed); new keys may be added
  within a format. Hosts should check it, and the paths of the table above
  are kept stable.
- `frameworkTraits` are traits of the anywidget and ipywidgets machinery; a
  host can ignore them.

### Trait specs

| Field | Meaning |
|---|---|
| `type` | `number`, `integer`, `string`, `boolean`, `enum`, `const`, `array`, `object`, `bytes` or `any` |
| `values` | The allowed values of an `enum`, or the single value of a `const` |
| `nullable` | `null` is a valid value (for example an alarm limit that is not set) |
| `nonfinite` | NaN and infinities travel as the strings `"nan"`, `"inf"`, `"-inf"` (JSON has no such numbers) |
| `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum` | Bounds of a number |
| `modulo` | Finite values are wrapped into `[0, modulo)` (a compass heading) |
| `items`, `prefixItems` | Spec of the items of an array, or of each item of a fixed-length tuple (`size`) |
| `minItems`, `maxItems`, `uniqueItems`, `itemDefault` | Array constraints; `itemDefault` replaces an invalid item instead of dropping it |
| `keys`, `properties` | Allowed keys of an object (skins), or its known fields |
| `default` | The value used when the trait is missing or invalid |
| `writer` | Who writes the trait, see below |
| `readOnly` | The Python class exposes the trait as read-only |
| `resolved` | An empty value stands for a default resolved from other traits (a selector position) |
| `transitions` | `[state, event, next state]` rows of a state trait; other pairs keep the state |
| `simulated` | Simulated state after each command of a process object |
| `source` | Trait an alarm level is computed from (the PV of a PID faceplate) |
| `presets` | Named values a host can copy into the trait: the PackML, GEMMA and ISA-88 models of `StateMachine.machine` |
| `description` | What the trait means, with the requirement IDs |

### Who writes a trait

| `writer` | Written by |
|---|---|
| `host` | The host only: configuration and process values. The front end reads it. |
| `both` | The host and the operator through the front end (the value of a control, a cursor, a chart range). The front end writes it with `save_changes`. |
| `front` | The front end only. |
| `derived` | Computed from other traits: by the host when it owns the state, otherwise by the front end, which writes it back (HOST-004). |

## Rendering a widget

A host needs the anywidget front-end model API: `get`, `set`,
`save_changes`, `on` / `off` for `change:<trait>` and `msg:custom` events,
and `send(content, callbacks, buffers)`. It then calls `initialize({ model })`
once per model and `render({ model, el })` for each view.

The smallest trait dictionary is `{ "_kind": "tank" }`: every missing trait
reads as its default. A host usually starts from the defaults of
`contract.json` and applies the user's values:

```js
const spec = contract.widgets.Tank;
const traits = Object.fromEntries(Object.entries(spec.traits).map(([name, t]) => [name, t.default]));
Object.assign(traits, { value: 3.2, max: 4, unit: "m", hi: 3, label: "T-101" });
```

The front end reads every trait through its spec (HOST-002): a value of the
wrong type is replaced by the default (with one console warning), a number
outside its bounds is clamped, `"nan"` is decoded, invalid array items are
dropped. A widget never fails to render because of a bad value.

## Authority over the state

The `_session` trait says whether the host owns the state (HOST-004,
HOST-012, [specification 19.1](specification.md#191-authority-over-the-state)):

- **Empty `_session` (default).** The front end computes the derived traits
  (`alarm_level`, `peak`, bar graph levels, state machine and annunciator
  states, …) once per model and writes them back with `save_changes`. It
  also applies the effect of operator actions: an acknowledgement, a
  faceplate command, a state machine command, a click. A host listening to
  trait changes reads the results.
- **Non-empty `_session`.** The host is authoritative: it computes the
  derived traits and applies the operator actions itself. The front end
  shows what the host sends.

In both cases every operator action is also sent as a message
(`direction: "front-to-host"` in `messages`), so that a host can log or
act on it. Process events (a new alarm, the end of an acting state, a
measured value) always come from the host.

## Stale-data indication

A widget shows **⚠ NO KERNEL** or **⚠ STALE** only when a host announces
heartbeats (HOST-003): a non-empty `_session` and a `_heartbeat` period
greater than 0. The host then sends `{"type": "hb", "session": <_session>}`
every period to at least one widget of the session (all views of a session
share it). A host that does not announce heartbeats leaves both traits at
their defaults (`""` and `0`) and never sees the indication.

## Messages and binary buffers

Each widget lists its custom messages in `messages`:

```json
{
  "type": "append",
  "direction": "host-to-front",
  "fields": { "n_points": { "type": "integer", "minimum": 0 }, "total": { "type": "integer", "minimum": 0 } },
  "buffers": [{ "dtype": "<f4", "shape": ["n_points", "n_traces"], "order": "C" }]
}
```

- `fields` are the JSON fields of the message, next to `type`.
- `buffers` are the binary buffers sent with it, in order: little-endian,
  with a numpy-style `dtype` (`<f4` float32, `<f8` float64, `uint8`) and a
  `shape` whose names are message fields or traits. `repeat` names an array
  field whose items each carry the buffers again, `n` being the second
  element of each item (`TrendChart`: times and values for each pen,
  `[pen, n, total]`; `XYGraph`: x and y for each set, `[name, n]`).
- Buffers may be `ArrayBuffer`, `DataView` or typed arrays (HOST-008). A
  buffer shorter than announced is never read past its end.
- Widgets whose data travel as messages (`WaveformChart`, `IntensityChart`,
  `TrendChart`, `XYGraph`, `Sparkline`, `KPITile`, `PictureControl`, the
  digital graphs) send `sync_request` when a view is created: the host answers with a
  `snapshot` (or `data`, `draw`) message. A host without history can ignore
  it.

A binary trait (`type: "bytes"`, the `SynopticCanvas` background) is a
buffer in Jupyter; a host that only sends JSON may send it as base64 text
(HOST-010).

## Widgets containing widgets

`SynopticCanvas.items` refers to other widget models as `"IPY_MODEL_<id>"`.
The children are rendered through the host widget manager when the model
provides one (`model.widget_manager.get_model` and `create_view`); without
it, the canvas shows a placeholder for each child and still draws its pipes
and background (HOST-009). A host without a widget manager can place the
widgets side by side instead.

## Checking a host

- Validate trait dictionaries against `schema/<widget>.schema.json` with any
  JSON Schema draft 2020-12 validator.
- `e2e/host/index.html` in the repository is a minimal host page, modeled on
  an anywidget host without a Python kernel, driven by the end-to-end test
  `e2e/host.spec.js`.
- The rules shared by Python and the front end are pinned by the parity
  cases of `tests/parity/*.json`: a host reimplementing a rule (for example
  a Julia wrapper computing alarm levels itself) can run the same cases.
