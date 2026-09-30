# Development

Contributor conventions are in `AGENTS.md` at the repository root.

```bash
npm install                # also installs the anywidget-instruments core, at the commit package.json pins
npm run build              # front-end bundle (esbuild, js/build.mjs)
npm test                   # front-end unit tests (vitest), including the WCAG contrast audit
npm run lint               # eslint, including the SEC-001 rules (no eval / innerHTML)
npm run check:reproducible # byte-identical rebuild (SEC-004)
pip install "anywidget-instruments @ git+https://github.com/AnywidgetInstruments/anywidget-instruments@<commit of package.json>"
pip install -e ".[dev]"
pytest                     # Python unit tests + headless execution of the example notebooks
ruff check . && ruff format --check . && mypy src
npx playwright test        # end-to-end: JupyterLab, Notebook 7, marimo, every widget,
                           # performance benchmarks, visual regression, saved state
```

The documentation is built with `pip install -e ".[docs]"` and
`mkdocs serve` (or `mkdocs build --strict`).

## Front end and trait contract

The widgets derive from the
[anywidget-instruments](https://github.com/AnywidgetInstruments/anywidget-instruments)
core, which holds the base view (`BaseView`), the model interface, the
schema-driven trait reading, the contract generator (`js/scripts/contract.mjs`),
the palettes and themes (its `styles.css`, imported first), the liveness and
the Python base class. Its TypeScript sources are bundled with the widgets of
this library; `js/src/index.js` registers the contracts of the widgets with
the base view (`registerContracts`). The base schema
(`instrument.schema.json`) comes from the core too, by its `$id`
`https://anywidgetinstruments.github.io/anywidget-instruments/schema/instrument.schema.json`.

The front end is written in TypeScript (`js/src/`), bundled by esbuild into
one unminified ES module with its source map (HOST-006). It depends on no
Python code: any anywidget host can run it with a dictionary of traits (see
[Hosts](hosts.md) and the [trait contract](trait-contract.md)).

- **Schemas.** `src/anywidget_instruments_industrial/schema/*.schema.json` describe the
  traits and messages of every widget: they are the single source of truth.
  `npm run gen` (also run by `npm run build`, `npm run typecheck` and
  `npm test`) generates `js/src/generated/contract.ts` (TypeScript types and
  specs) and `static/contract.json` (for hosts).
- **Reading traits.** `BaseView.get` reads each trait through its spec
  (`js/src/contract/traits.ts` of the core): wrong types give the default, numbers are
  clamped, `"nan"` is decoded. Reads are cached per raw value.
- **Authority.** `js/src/contract/derived.ts` computes the derived traits
  (alarm levels, peaks, states) when no host owns the state (empty
  `_session`) and writes them back; with a host (the Python kernel sets
  `_session`), the host values are shown. Operator actions are always sent
  as messages and applied locally only without a host (HOST-004, HOST-012).
- **Shared rules.** A rule implemented both in Python and in TypeScript lives
  in `js/src/contract/` and has cases in `tests/parity/*.json`, run by
  `tests/test_parity.py` and `js/test/parity.test.ts` (HOST-005).
- **Divergence.** `tests/test_contract.py` checks every exported widget
  against its schema: trait names, types, bounds, read-only state, class and
  instance defaults, states and the messages Python sends (with their buffer
  sizes). `npm run typecheck` checks the views against the generated types.
  Both run in CI (HOST-011).
- **Without a kernel.** `js/test/hostless.test.ts` renders each widget from
  a plain trait dictionary, and `e2e/host.spec.js` drives
  `e2e/host/index.html`, a host page without Python.

## Visual baselines

After an intended visual change, refresh the screenshot baselines with
`npx playwright test e2e/visual.spec.js --update-snapshots` and check the new
images before committing them.

## Documentation images

The pictures of `docs/img/` are captures of the real widgets: refresh them
with the visual baselines whenever a drawing changes, so that the site never
shows an older look.

- Example notebooks (`filling_line.png`, `gallery.png`, ...):
  `AWI_SHOTS=docs/img npx playwright test e2e/examples.spec.js`.
- Widget pages (`docs/widgets/*.md`, `docs/img/widgets/`, the widget pages of
  the nav and the links of the catalog), from the preview page and the trait
  contract: `npm run build && node js/scripts/widget-pages.mjs`. Run it when a
  widget, a schema or a drawing changes; do not edit the pages by hand.
- Batch reactor showcase (`showcase-reactor.png`,
  `showcase-reactor-hero.png`): start
  `marimo run lite/marimo/batch_reactor.py --headless --port 2719 --no-token`,
  then run `node js/scripts/docs-images.mjs`.

## Preview page

`js/preview/index.html` renders every widget with an in-memory model, without
a kernel. Run `python -m http.server` at the repository root and open
`http://localhost:8000/js/preview/index.html`. Add `?style=classic` or
`?style=system&dark` to switch styles.
