# AGENTS.md

Guidance for AI coding agents (and humans) working on this repository.

## Project

`anywidget-instruments`: instrumentation widgets (knobs, gauges, LEDs, charts,
alarms, supervisory objects) for computational notebooks, built on
[anywidget](https://anywidget.dev). Requirements come from the EARS
specification in `docs/specification.md`; `docs/requirements-status.md` tracks
them. Changes to requirements go through that file (bump its version and
revision history).

## Layout

| Path | Content |
|---|---|
| `src/anywidget_instruments/` | Python package (one module per widget family, private `_*.py`) |
| `src/anywidget_instruments/schema/` | Trait contract: one JSON Schema per widget, single source of truth for Python, TypeScript and hosts |
| `src/anywidget_instruments/static/` | Built front-end bundle (not minified, with source map) and `contract.json`: generated, never edited, not committed |
| `js/src/core/` | Shared front end (TypeScript): `view.ts` (base view), `plot.ts` (graphs), `model.ts` (AFM model), `scale.ts`, `format.ts`, `dom.ts`, `buffers.ts`, `liveness.ts` |
| `js/src/contract/` | Trait contract runtime: schema-driven reading, derived traits, and the logic shared with Python (checked by `tests/parity/`) |
| `js/src/generated/` | `contract.ts`, generated from the schemas by `npm run gen`: not committed |
| `js/src/widgets/` | One view per widget family (TypeScript); registered by `_kind` in `js/src/index.js` |
| `js/src/styles.css` | All styles, scoped under `.awi-root`, colors as `--awi-*` custom properties |
| `js/test/` | vitest unit tests (jsdom) |
| `tests/` | pytest unit tests, including headless execution of `examples/*.ipynb`; `test_contract.py` (Python against the schemas) and `parity/*.json` (cases shared with vitest) |
| `e2e/` | Playwright end-to-end tests (JupyterLab, Notebook 7, marimo, visual, performance) |
| `e2e-site/` | Browser tests of the built site's in-browser deployments (`npm run test:site`, run by the Docs workflow) |
| `examples/` | Example notebooks and a marimo app |
| `docs/` | MkDocs site |
| `lite/` | In-browser demos: `content/*.ipynb` (JupyterLite) and `marimo/*.py` (marimo WebAssembly), no threads; listed in `docs/try.md` |

## Commands

```bash
npm install && npm run build        # contract + bundle (required before Python tests/E2E)
npm run typecheck                   # tsc --noEmit
npm test                            # vitest
npm run lint                        # eslint (js/ and e2e/)
npm run check:reproducible          # byte-identical rebuild
pip install -e ".[dev]"             # add ".[docs]" for the documentation
pytest                              # Python tests + example notebooks
ruff check . && ruff format --check . && mypy src
npx playwright test                 # full E2E suite (starts JupyterLab, marimo, a static server)
mkdocs build --strict               # documentation
```

Run the relevant checks before every commit; run the full E2E suite before
pushing changes to the front end or to the kernel/front-end protocol.

## Adding or changing a widget

1. Python: subclass `InstrumentWidget` (or `NumericWidget`, `BooleanWidget`,
   `GraphWidget`, `ProcessObject`), set `_kind`, `_default_mode`,
   `_default_size` (with `mode_trait` / `size_trait` so that the class
   defaults match), and declare synced traits with `.tag(sync=True)`.
   Use `float_serializers` for traits that may hold NaN/inf.
2. Schema: add `src/anywidget_instruments/schema/<kind>.schema.json` with every
   synced trait (type, bounds, default, `x-awi-writer`) and the custom
   messages with their buffers (`x-awi-messages`). `tests/test_contract.py`
   fails until Python and the schema agree.
3. Front end: add or extend a TypeScript view in `js/src/widgets/`, derived
   from `BaseView` / `NumericView` / `PlotView` and typed with the generated
   `<Class>Traits`; list the traits that trigger a redraw; register the
   `_kind` in `js/src/index.js`. Rules also implemented in Python go to
   `js/src/contract/` with parity cases in `tests/parity/`; derived traits
   are computed in `contract/derived.ts` when no host owns the state.
4. Export the class in `src/anywidget_instruments/__init__.py` (`__all__`).
5. Tests: pytest for kernel logic, vitest for pure front-end logic, a
   host-less test in `js/test/hostless.test.ts` (plain trait dictionary), and an
   entry in `e2e/allwidgets.spec.js` (kernel → front end and front end → kernel).
6. Add it to `js/preview/index.html`, refresh the visual baselines
   (`npx playwright test e2e/visual.spec.js --update-snapshots`) and check the
   screenshots, then document it in `docs/widgets.md` and `docs/api.md`.
7. Update `docs/requirements-status.md` when a requirement changes status.

## Conventions

### Python
- Python ≥ 3.10, `from __future__ import annotations`, full type hints, `mypy src` clean.
- ruff (line length 100) for lint and format; numpy-style docstrings.
- Runtime dependencies are limited to `anywidget`, `traitlets`, `numpy`.
- Validation errors raise `traitlets.TraitError` naming the widget and the trait.
- User callbacks go through the dispatcher (`_dispatch.call`): exceptions are
  logged, never propagated; front-end updates are processed as a batch.
- Bulk data (samples, images) travels as binary buffers via `self.send(..., buffers=...)`,
  never as JSON lists; new views fetch state with a `sync_request` message.
- No threads without a fallback: Pyodide cannot start them; in marimo use
  `mo.Thread` (see `_liveness.py`).

### Front end
- TypeScript (new and converted code; JavaScript files are converted when
  touched), bundled by esbuild (`js/build.mjs`) into one readable ES module
  with a source map; no runtime dependency, no network access, no CDN.
- Traits come from the JSON Schemas in `src/anywidget_instruments/schema/`:
  change a trait there first; `tests/test_contract.py` fails when Python
  diverges, `tsc` when TypeScript does.
- Only the AFM model API (`get`, `set`, `save_changes`, `on`, `off`, `send`);
  `widget_manager` only with a fallback.
- Security: never `innerHTML`, `eval`, `new Function`; text through
  `textContent` or canvas text; colors through `safeColor`; SVG skins through
  `parseSkin` (ESLint enforces part of this).
- Render through `schedule()` (one frame, skipped off-screen); keep cheap state
  in `renderCommon()`.
- Accessibility: keyboard operation, ARIA role and value, state conveyed by
  text or shape as well as color, `prefers-reduced-motion` respected. Focusable
  elements carry `data-lm-suppress-shortcuts` (automatic for `html("button")`
  and widget bodies).
- New colors are `--awi-*` tokens in `styles.css`, defined for light and dark
  hosts, and must pass `js/test/contrast.test.js`.
- The bundle budget is 150 kB gzipped (checked in CI).

### Tests
- Every bug fix comes with a test that fails without the fix.
- E2E tests locate widgets by their label (`widget(page, label)` in `e2e/helpers.js`)
  and run kernel code with `kernelExec`; scroll widgets into view before
  checking drawn state (off-screen widgets skip drawing).
- Never loosen a performance threshold or a visual baseline to get a green
  run without understanding the change.

### Documentation and wording
- Repository content is in English.
- Content goes to the documentation (`docs/`) first; the README stays short
  (pitch, install, quick start, links to the documentation).
- Refer to requirements by their IDs (`NUM-005`, `ROB-001`, …) in docstrings,
  comments and commit messages where useful.
- Do not name, cite or compare with third-party products or projects (commercial
  or open source) whose ideas inspired a feature; describe the feature itself.

## Git

- Author and committer: the repository owner's identity (never an AI identity).
- No `Co-Authored-By` trailer for AI, no model or tool names in commit
  messages, code, comments or documentation.
- When AI assisted the change, end the commit message with `Assisted-by: AI`.
- Commit messages: imperative subject ≤ 72 characters, blank line, body
  explaining what and why (bullet points welcome).
- Never commit generated files (`static/`, `site/`, `dist/`, `node_modules/`,
  test results).
- Do not rewrite published history unless the owner asks for it.
