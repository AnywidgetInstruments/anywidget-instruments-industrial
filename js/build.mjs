// Front-end build (GEN-004). Deterministic: no timestamps, no absolute paths,
// pinned esbuild version (package-lock.json) — see js/scripts/check-reproducible.mjs.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const OUT = "src/anywidget_instruments/static";

export const targets = [
  { entryPoints: ["js/src/index.js"], outfile: `${OUT}/index.js`, bundle: true, format: "esm", minify: true, legalComments: "none", target: "es2020" },
  { entryPoints: ["js/src/styles.css"], outfile: `${OUT}/index.css`, bundle: true, minify: true },
];

export async function buildAll({ write = true } = {}) {
  const results = [];
  for (const t of targets) {
    const r = await build({ ...t, write, logLevel: write ? "info" : "silent" });
    results.push(...(r.outputFiles || []));
  }
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildAll();
}
