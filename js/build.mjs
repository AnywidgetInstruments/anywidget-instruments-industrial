// Front-end build (GEN-004). Deterministic: no timestamps, no absolute paths,
// pinned esbuild version (package-lock.json) — see js/scripts/check-reproducible.mjs.
//
// The bundle is not minified and ships with its source map (HOST-006): the
// module embedded in the wheel stays readable. The trait contract is
// generated from the JSON Schemas first (js/scripts/gen-contract.mjs).
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { generate } from "./scripts/gen-contract.mjs";

const OUT = "src/anywidget_instruments_industrial/static";

export const targets = [
  { entryPoints: ["js/src/index.js"], outfile: `${OUT}/index.js`, bundle: true, format: "esm", minify: false, sourcemap: "linked", sourcesContent: true, legalComments: "inline", target: "es2020", charset: "utf8" },
  { entryPoints: ["js/src/styles.css"], outfile: `${OUT}/index.css`, bundle: true, minify: false, charset: "utf8" },
];

export async function buildAll({ write = true } = {}) {
  generate({ write });
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
