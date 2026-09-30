// Trait contract generator (HOST-001). The JSON Schemas in
// src/anywidget_instruments_industrial/schema/ are the single source of truth;
// they extend the base schema of anywidget-instruments by its $id. The
// generator of anywidget-instruments (js/scripts/contract.mjs) flattens them
// and this script writes:
//
//   js/src/generated/contract.ts                              TypeScript trait interfaces and runtime specs
//   src/anywidget_instruments_industrial/static/contract.json description for host authors (shipped in the wheel)
//
// Both outputs are generated, never edited and never committed. The Python
// side is checked against the same flattened contract (tests/test_contract.py).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_ID, buildContract as build, pythonVersion, renderJson as json, renderTs as ts, writeOutputs } from "anywidget-instruments/js/scripts/contract.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SCHEMA_DIR = join(ROOT, "src/anywidget_instruments_industrial/schema");
const TS_OUT = join(ROOT, "js/src/generated/contract.ts");
const JSON_OUT = join(ROOT, "src/anywidget_instruments_industrial/static/contract.json");

/** Flattened contract of every schema, keyed by schema title; the base Instrument first. */
export function buildContract(dir = SCHEMA_DIR) {
  return build({ dir, include: [`${BASE_ID}instrument.schema.json`] });
}

export function renderTs(contract) {
  return ts(contract, { source: "src/anywidget_instruments_industrial/schema/" });
}

export function renderJson(contract) {
  return json(contract, {
    comment: "Trait contract of anywidget-instruments-industrial, generated from the JSON Schemas in schema/, which extend the base schema of anywidget-instruments. See the trait contract page of the documentation.",
    version: pythonVersion(ROOT),
    encoding: {
      nonfinite: 'Traits with nonfinite: true carry NaN and infinities as the strings "nan", "inf" and "-inf".',
      buffers: "Binary buffers are little-endian; dtype uses numpy notation (<f4, <f8, u1).",
    },
  });
}

export function generate({ dir = SCHEMA_DIR, write = true } = {}) {
  const contract = buildContract(dir);
  const out = { contract, ts: renderTs(contract), json: renderJson(contract) };
  if (write) writeOutputs({ [TS_OUT]: out.ts, [JSON_OUT]: out.json });
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { contract } = generate();
  const n = Object.values(contract.widgets).filter((w) => !w.abstract).length;
  console.log(`contract: ${Object.keys(contract.widgets).length} schemas (${n} widgets)`);
}
