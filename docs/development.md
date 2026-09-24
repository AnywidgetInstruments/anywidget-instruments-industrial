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

## Visual baselines

After an intended visual change, refresh the screenshot baselines with
`npx playwright test e2e/visual.spec.js --update-snapshots` and check the new
images before committing them.

## Preview page

`js/preview/index.html` renders every widget with an in-memory model, without
a kernel. Run `python -m http.server` at the repository root and open
`http://localhost:8000/js/preview/index.html`. Add `?style=classic` or
`?style=system&dark` to switch styles.
