// Shape of the flattened trait contract generated from the JSON Schemas in
// src/anywidget_instruments/schema/ (HOST-001) by js/scripts/gen-contract.mjs.
// The same shape is published for host authors in static/contract.json.

/**
 * Who writes a trait:
 * - "host": configuration set by the host; the front end only reads it;
 * - "both": set by the host and by the user through the front end (value);
 * - "front": written by the front end only;
 * - "derived": computed from other traits, by the host when it owns the
 *   state (non-empty `_session`), otherwise by the front end (HOST-004).
 */
export type Writer = "host" | "both" | "front" | "derived";

/** Type and bounds of a value (a trait, or an item of an array trait). */
export interface ValueSpec {
  type: "number" | "integer" | "string" | "boolean" | "enum" | "const" | "array" | "object" | "any";
  /** `null` is a valid value. */
  nullable?: boolean;
  /** NaN and infinities travel as "nan", "inf", "-inf". */
  nonfinite?: boolean;
  /** Allowed values of an enum, or the single value of a const. */
  values?: unknown[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  /** Array items (homogeneous array). */
  items?: ValueSpec;
  /** Array items (fixed-length tuple). */
  prefixItems?: ValueSpec[];
  /** Allowed keys of an object. */
  keys?: string[];
}

export interface TraitSpec extends ValueSpec {
  default: unknown;
  writer: Writer;
  readOnly?: boolean;
  description?: string;
}

export interface MessageSpec {
  type: string;
  direction: "host-to-front" | "front-to-host";
  description?: string;
  fields?: Record<string, unknown>;
  buffers: Array<{ dtype: string; shape?: string[]; order?: string; description?: string }>;
}

export interface WidgetContract {
  /** Python class name (also the schema title). */
  className: string;
  /** Value of the `_kind` trait; empty for abstract bases. */
  kind: string;
  abstract: boolean;
  traits: Record<string, TraitSpec>;
  messages: MessageSpec[];
}
