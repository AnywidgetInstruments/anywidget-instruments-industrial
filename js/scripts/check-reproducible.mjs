// SEC-004: rebuilding produces byte-identical bundles.
import { createHash } from "node:crypto";
import { buildAll } from "../build.mjs";

const digest = (files) => Object.fromEntries(files.map((f) => [f.path.split("/").slice(-1)[0], createHash("sha256").update(f.contents).digest("hex")]));

const a = digest(await buildAll({ write: false }));
const b = digest(await buildAll({ write: false }));
console.log(JSON.stringify(a, null, 2));
if (JSON.stringify(a) !== JSON.stringify(b)) {
  console.error("non-reproducible build:", a, b);
  process.exit(1);
}
console.log("reproducible: identical bundles on rebuild");
