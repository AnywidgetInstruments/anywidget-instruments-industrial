# Development

Contributor conventions are in `AGENTS.md` at the repository root.

```bash
npm install
npm run build              # front-end bundle (esbuild, js/build.mjs)
npm test                   # front-end unit tests (vitest), including the WCAG contrast audit
npm run lint               # eslint, including the SEC-001 rules (no eval / innerHTML)
npm run check:reproducible # byte-identical rebuild (SEC-004)
pip install -e ".[dev]"
pytest                     # Python unit tests + headless execution of the example notebooks
ruff check . && ruff format --check . && mypy src
npx playwright test        # end-to-end: JupyterLab, Notebook 7, marimo, every widget,
                           # performance benchmarks, visual regression, saved state
```

The documentation is built with `pip install -e ".[docs]"` and
`mkdocs serve` (or `mkdocs build --strict`).

## Front end and trait contract

The front end is written in TypeScript (`js/src/`), bundled by esbuild into
one unminified ES module with its source map (HOST-006). It depends on no
Python code: any anywidget host can run it with a dictionary of traits (see
[Hosts](hosts.md) and the [trait contract](trait-contract.md)).

- **Schemas.** `src/anywidget_instruments/schema/*.schema.json` describe the
  traits and messages of every widget: they are the single source of truth.
  `npm run gen` (also run by `npm run build`, `npm run typecheck` and
  `npm test`) generates `js/src/generated/contract.ts` (TypeScript types and
  specs) and `static/contract.json` (for hosts).
- **Reading traits.** `BaseView.get` reads each trait through its spec
  (`js/src/contract/traits.ts`): wrong types give the default, numbers are
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

## Preview page

`js/preview/index.html` renders every widget with an in-memory model, without
a kernel. Run `python -m http.server` at the repository root and open
`http://localhost:8000/js/preview/index.html`. Add `?style=classic` or
`?style=system&dark` to switch styles.
