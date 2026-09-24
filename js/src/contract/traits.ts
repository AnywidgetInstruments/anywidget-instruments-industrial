// Schema-driven reading of trait values (HOST-002).
//
// A host without a Python kernel hands the front end a plain dictionary of
// traits: nothing has validated it. Every trait of a widget that has a
// schema is read through its spec: a value of the wrong type falls back to
// the default, a number outside the schema bounds is clamped, non-finite
// floats encoded as strings are decoded. Values sent by a Python kernel
// always conform, so reading them is the identity.
import { parseNumber } from "../core/scale.js";
import type { TraitSpec, ValueSpec } from "./spec.js";

const NONFINITE = new Set(["nan", "inf", "-inf", "NaN", "Infinity", "-Infinity"]);

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function readNumber(spec: ValueSpec, raw: unknown): number | undefined {
  let v: number;
  if (typeof raw === "number") v = raw;
  else if (spec.nonfinite && typeof raw === "string" && NONFINITE.has(raw)) v = parseNumber(raw);
  else return undefined;
  if (!Number.isFinite(v)) return spec.nonfinite ? v : undefined;
  if (spec.modulo) v = ((v % spec.modulo) + spec.modulo) % spec.modulo;
  if (spec.type === "integer") v = Math.round(v);
  if (spec.exclusiveMinimum !== undefined && v <= spec.exclusiveMinimum) return undefined;
  if (spec.exclusiveMaximum !== undefined && v >= spec.exclusiveMaximum) return undefined;
  if (spec.minimum !== undefined && v < spec.minimum) v = spec.minimum;
  if (spec.maximum !== undefined && v > spec.maximum) v = spec.maximum;
  return v;
}

/**
 * Value conforming to `spec`, or `undefined` when `raw` cannot be used.
 * Arrays keep their valid items; a tuple needs every item valid.
 */
export function readValue(spec: ValueSpec, raw: unknown): unknown {
  if (raw === null) return spec.nullable ? null : undefined;
  switch (spec.type) {
    case "number":
    case "integer":
      return readNumber(spec, raw);
    case "string":
      return typeof raw === "string" ? raw : undefined;
    case "boolean":
      return typeof raw === "boolean" ? raw : undefined;
    case "enum":
    case "const":
      return spec.values?.includes(raw) ? raw : undefined;
    case "array": {
      if (!Array.isArray(raw)) return undefined;
      if (spec.prefixItems) {
        if (raw.length !== spec.prefixItems.length) return undefined;
        const out = spec.prefixItems.map((s, i) => readValue(s, raw[i]));
        return out.includes(undefined) ? undefined : out;
      }
      let out: unknown[] = raw;
      if (spec.items) {
        const items = spec.items;
        const read = raw.map((x) => readValue(items, x));
        out = spec.itemDefault !== undefined ? read.map((x) => (x === undefined ? spec.itemDefault : x)) : read.filter((x) => x !== undefined);
      }
      if (spec.minItems !== undefined && out.length < spec.minItems) return undefined;
      if (spec.maxItems !== undefined && out.length > spec.maxItems) return undefined;
      if (spec.uniqueItems && new Set(out.map((x) => JSON.stringify(x))).size !== out.length) return undefined;
      return out;
    }
    case "object": {
      if (!isPlainObject(raw)) return undefined;
      if (!spec.keys) return raw;
      const keys = spec.keys;
      return Object.fromEntries(Object.entries(raw).filter(([k, v]) => keys.includes(k) && typeof v === "string"));
    }
    default:
      return raw;
  }
}

/** Default of a trait, decoded (e.g. "nan" -> NaN). */
export function defaultOf(spec: TraitSpec): unknown {
  const v = readValue(spec, spec.default);
  return v === undefined ? spec.default : v;
}

/**
 * Value of a trait read through its spec: the raw value when it conforms
 * (numbers clamped to the schema bounds), otherwise the default. `onInvalid`
 * is called when the raw value was replaced by the default.
 */
export function readTrait(spec: TraitSpec, raw: unknown, onInvalid?: () => void): unknown {
  if (raw === undefined) return defaultOf(spec);
  const v = readValue(spec, raw);
  if (v !== undefined) return v;
  onInvalid?.();
  return defaultOf(spec);
}
