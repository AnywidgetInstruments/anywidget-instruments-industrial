// Trait contract generator (HOST-001). The JSON Schemas in
// src/anywidget_instruments/schema/ are the single source of truth; this
// script flattens them ($ref, allOf) and writes:
//
//   js/src/generated/contract.ts                  TypeScript trait interfaces and runtime specs
//   src/anywidget_instruments/static/contract.json description for host authors (shipped in the wheel)
//
// Both outputs are generated, never edited and never committed. The Python
// side is checked against the same flattened contract (tests/test_contract.py).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SCHEMA_DIR = join(ROOT, "src/anywidget_instruments/schema");
const TS_OUT = join(ROOT, "js/src/generated/contract.ts");
const JSON_OUT = join(ROOT, "src/anywidget_instruments/static/contract.json");

// ---------------------------------------------------------------------------
// Loading and flattening
// ---------------------------------------------------------------------------
function loader(dir) {
  const cache = new Map();
  return (file) => {
    if (!cache.has(file)) cache.set(file, JSON.parse(readFileSync(join(dir, file), "utf8")));
    return cache.get(file);
  };
}

function pointer(doc, ptr) {
  if (!ptr) return doc;
  return ptr
    .replace(/^\//, "")
    .split("/")
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce((node, key) => {
      if (node === undefined || !(key in node)) throw new Error(`unresolved JSON pointer ${ptr}`);
      return node[key];
    }, doc);
}

/** Resolve a $ref relative to `file`: returns [target schema, file of the target]. */
function resolveRef(load, ref, file) {
  const [target, ptr = ""] = ref.split("#");
  const targetFile = target || file;
  return [pointer(load(targetFile), ptr), targetFile];
}

/** A property schema with its $ref merged in (sibling keywords win). */
function resolveProperty(load, prop, file) {
  if (!prop.$ref) return prop;
  const [target, targetFile] = resolveRef(load, prop.$ref, file);
  const { $ref: _ref, ...rest } = prop;
  return { ...resolveProperty(load, target, targetFile), ...rest };
}

/** Properties and messages of a schema, bases (allOf) first; later keywords override earlier ones. */
function flatten(load, file) {
  const schema = load(file);
  const properties = {};
  const messages = [];
  let framework = [];
  for (const part of schema.allOf || []) {
    if (!part.$ref) throw new Error(`${file}: allOf entries must be $ref`);
    const base = flatten(load, part.$ref.split("#")[0] || file);
    for (const [name, prop] of Object.entries(base.properties)) properties[name] = { ...prop };
    messages.push(...base.messages);
    framework = framework.concat(base.framework);
  }
  for (const [name, prop] of Object.entries(schema.properties || {})) {
    properties[name] = { ...(properties[name] || {}), ...resolveProperty(load, prop, file) };
  }
  messages.push(...(schema["x-awi-messages"] || []));
  framework = framework.concat(schema["x-awi-framework-traits"] || []);
  return { schema, properties, messages, framework };
}

// ---------------------------------------------------------------------------
// Trait specs
// ---------------------------------------------------------------------------
const WRITERS = new Set(["host", "both", "front", "derived"]);
const NONFINITE = ["nan", "inf", "-inf"];

function traitSpec(name, p, where, nested = false) {
  const spec = {};
  let types = Array.isArray(p.type) ? [...p.type] : p.type ? [p.type] : [];
  if (types.includes("null")) {
    spec.nullable = true;
    types = types.filter((t) => t !== "null");
  }
  if (p.const !== undefined) {
    spec.type = "const";
    spec.values = [p.const];
  } else if (p["x-awi-nonfinite"]) {
    spec.type = "number";
    spec.nonfinite = true;
  } else if (p.enum && types.length === 0) {
    spec.type = "enum";
    spec.values = p.enum;
  } else if (types.length === 1) {
    spec.type = types[0];
  } else if (types.length === 0) {
    spec.type = "any";
  } else {
    throw new Error(`${where}.${name}: unsupported type ${JSON.stringify(p.type)}`);
  }
  for (const k of ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"]) if (p[k] !== undefined) spec[k] = p[k];
  if (p["x-awi-modulo"] !== undefined) spec.modulo = p["x-awi-modulo"];
  if (spec.type === "array") {
    if (Array.isArray(p.prefixItems)) spec.prefixItems = p.prefixItems.map((it, i) => traitSpec(`${name}[${i}]`, it, where, true));
    else if (p.items && typeof p.items === "object") spec.items = traitSpec(`${name}[]`, p.items, where, true);
  }
  if (spec.type === "object" && p.propertyNames?.enum) spec.keys = p.propertyNames.enum;
  if (nested) return spec;
  if (!("default" in p)) throw new Error(`${where}.${name}: missing default`);
  spec.default = p.default;
  const writer = p["x-awi-writer"];
  if (!WRITERS.has(writer)) throw new Error(`${where}.${name}: x-awi-writer must be one of ${[...WRITERS]}`);
  spec.writer = writer;
  if (p.readOnly) spec.readOnly = true;
  if (p.description) spec.description = p.description;
  return spec;
}

/** Flattened contract of every schema, keyed by schema title. */
export function buildContract(dir = SCHEMA_DIR) {
  const load = loader(dir);
  const files = readdirSync(dir).filter((f) => f.endsWith(".schema.json")).sort();
  const widgets = {};
  let framework = [];
  for (const file of files) {
    const { schema, properties, messages, framework: fw } = flatten(load, file);
    const title = schema.title;
    if (!title || !/^[A-Z][A-Za-z0-9]*$/.test(title)) throw new Error(`${file}: title must be a class-like name`);
    if (!schema["x-awi-class"]) throw new Error(`${file}: missing x-awi-class`);
    const traits = {};
    for (const [name, p] of Object.entries(properties)) traits[name] = traitSpec(name, p, file);
    const abstract = !!schema["x-awi-abstract"];
    const kind = traits._kind?.type === "const" ? traits._kind.values[0] : "";
    if (!abstract && !kind) throw new Error(`${file}: a concrete widget fixes _kind with a const`);
    widgets[title] = { className: schema["x-awi-class"], kind, abstract, schema: file, traits, messages };
    framework = framework.concat(fw);
  }
  return { widgets, frameworkTraits: [...new Set(framework)].sort() };
}

// ---------------------------------------------------------------------------
// TypeScript output
// ---------------------------------------------------------------------------
function tsType(spec) {
  let t;
  switch (spec.type) {
    case "number":
    case "integer":
      t = spec.nonfinite ? `number | ${NONFINITE.map((v) => JSON.stringify(v)).join(" | ")}` : "number";
      break;
    case "string":
      t = "string";
      break;
    case "boolean":
      t = "boolean";
      break;
    case "enum":
    case "const":
      t = spec.values.map((v) => JSON.stringify(v)).join(" | ");
      break;
    case "array":
      if (spec.prefixItems) t = `[${spec.prefixItems.map(tsType).join(", ")}]`;
      else if (spec.items) t = `Array<${tsType(spec.items)}>`;
      else t = "unknown[]";
      break;
    case "object":
      t = spec.keys ? `Partial<Record<${spec.keys.map((k) => JSON.stringify(k)).join(" | ")}, string>>` : "Record<string, unknown>";
      break;
    default:
      t = "unknown";
  }
  return spec.nullable ? `${t} | null` : t;
}

function comment(out, text, indent = "") {
  if (text) out.push(`${indent}/** ${text.replace(/\*\//g, "* /")} */`);
}

export function renderTs(contract) {
  const out = [
    "// Generated by js/scripts/gen-contract.mjs from src/anywidget_instruments/schema/.",
    "// Do not edit: change the schemas and run `npm run gen`.",
    'import type { WidgetContract } from "../contract/spec.js";',
    "",
  ];
  const names = Object.keys(contract.widgets);
  for (const title of names) {
    const w = contract.widgets[title];
    comment(out, `Traits of \`${w.className}\`${w.kind ? ` (\`_kind\` "${w.kind}")` : ""}.`);
    out.push(`export interface ${title}Traits {`);
    for (const [name, spec] of Object.entries(w.traits)) {
      comment(out, spec.description, "  ");
      out.push(`  ${/^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name)}: ${tsType(spec)};`);
    }
    out.push("}", "");
  }
  const runtime = Object.fromEntries(names.map((n) => {
    const { schema: _schema, ...rest } = contract.widgets[n];
    return [n, rest];
  }));
  out.push("/** Flattened contract of every schema, keyed by schema title. */");
  out.push(`export const CONTRACTS: Record<${names.map((n) => JSON.stringify(n)).join(" | ")}, WidgetContract> = ${JSON.stringify(runtime, null, 2)};`, "");
  out.push("/** Contract of the concrete widgets, keyed by `_kind`. */");
  out.push("export const BY_KIND: Record<string, WidgetContract> = Object.fromEntries(");
  out.push("  Object.values(CONTRACTS).filter((c) => !c.abstract).map((c) => [c.kind, c]),");
  out.push(");");
  return `${out.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Host description (static/contract.json)
// ---------------------------------------------------------------------------
function pythonVersion() {
  const m = /^version\s*=\s*"([^"]+)"/m.exec(readFileSync(join(ROOT, "pyproject.toml"), "utf8"));
  return m ? m[1] : "";
}

export function renderJson(contract) {
  const widgets = {};
  for (const [title, w] of Object.entries(contract.widgets)) {
    widgets[title] = { class: w.className, kind: w.kind, abstract: w.abstract, schema: `schema/${w.schema}`, traits: w.traits, messages: w.messages };
  }
  return `${JSON.stringify(
    {
      $comment: "Trait contract of anywidget-instruments, generated from the JSON Schemas in schema/. See the trait contract page of the documentation.",
      format: 1,
      version: pythonVersion(),
      encoding: {
        nonfinite: "Traits with nonfinite: true carry NaN and infinities as the strings \"nan\", \"inf\" and \"-inf\".",
        buffers: "Binary buffers are little-endian; dtype uses numpy notation (<f4, <f8, u1).",
      },
      frameworkTraits: contract.frameworkTraits,
      widgets,
    },
    null,
    2,
  )}\n`;
}

export function generate({ dir = SCHEMA_DIR, write = true } = {}) {
  const contract = buildContract(dir);
  const ts = renderTs(contract);
  const json = renderJson(contract);
  if (write) {
    mkdirSync(dirname(TS_OUT), { recursive: true });
    mkdirSync(dirname(JSON_OUT), { recursive: true });
    writeFileSync(TS_OUT, ts);
    writeFileSync(JSON_OUT, json);
  }
  return { contract, ts, json };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { contract } = generate();
  const n = Object.values(contract.widgets).filter((w) => !w.abstract).length;
  console.log(`contract: ${Object.keys(contract.widgets).length} schemas (${n} widgets)`);
}
