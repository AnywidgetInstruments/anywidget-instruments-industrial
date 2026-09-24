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
  /** Finite values are wrapped into [0, modulo) (e.g. a heading). */
  modulo?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  /** Replacement of an invalid array item (instead of dropping it, which would shift the others). */
  itemDefault?: unknown;
  /** Array items (homogeneous array). */
  items?: ValueSpec;
  /** Array items (fixed-length tuple). */
  prefixItems?: ValueSpec[];
  /** Allowed keys of an object. */
  keys?: string[];
  /** Known fields of an object (for typing; values are not checked). */
  properties?: Record<string, ValueSpec>;
}

export interface TraitSpec extends ValueSpec {
  default: unknown;
  writer: Writer;
  readOnly?: boolean;
  /**
   * The default is resolved from other traits: when a Python widget is
   * created, or when the front end reads the trait (e.g. an empty selector
   * value means the default position).
   */
  resolved?: boolean;
  /** State transitions of an enum trait: [state, event, next state]; other pairs keep the state. */
  transitions?: Array<[string, string, string]>;
  /** Simulated state after each command of a process object (x-awi-simulated). */
  simulated?: Record<string, string>;
  /** Trait a derived alarm level is computed from (default: value). */
  source?: string;
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
