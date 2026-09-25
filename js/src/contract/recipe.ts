// RecipeTable columns and cells (IND-113, IND-114): the front-end ports of
// normalize_column, type_default and check_cell
// (src/anywidget_instruments/_recipe.py), checked against
// tests/parity/recipe.json.
import { parseEntry, radixOf } from "../core/format.js";

export type ColumnType = "number" | "choice" | "bool" | "text";
export type Cell = number | string | boolean;

export interface Column {
  name: string;
  title: string;
  type: ColumnType;
  unit: string;
  min: number | null;
  max: number | null;
  step: number;
  format: string;
  choices: string[];
  readonly: boolean;
  default: Cell;
}

export type CellCheck = { ok: true; value: Cell } | { ok: false; reason: string };

const TYPES: ColumnType[] = ["number", "choice", "bool", "text"];

const finiteOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Value of a new cell: the first choice, false, "" or 0 brought into the limits. */
export function typeDefault(col: Omit<Column, "default">): Cell {
  if (col.type === "choice") return col.choices[0] ?? "";
  if (col.type === "bool") return false;
  if (col.type === "text") return "";
  let v = 0;
  if (col.min !== null) v = Math.max(v, col.min);
  if (col.max !== null) v = Math.min(v, col.max);
  return v;
}

/**
 * Column with every key set, as the host stores it (a string is a number
 * column of that name). A host that does not
 * normalize may send an invalid column: an unknown type reads as number,
 * max < min as no limits, an invalid default as the type default.
 */
export function normalizeColumn(raw: unknown, index = 0): Column {
  const c = (typeof raw === "string" ? { name: raw } : raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const name = c.name ? String(c.name) : `column ${index + 1}`;
  const type = TYPES.includes(c.type as ColumnType) ? (c.type as ColumnType) : "number";
  let min = finiteOrNull(c.min);
  let max = finiteOrNull(c.max);
  if (min !== null && max !== null && !(max >= min)) [min, max] = [null, null];
  const col: Omit<Column, "default"> = {
    name,
    title: c.title ? String(c.title) : name,
    type,
    unit: c.unit ? String(c.unit) : "",
    min,
    max,
    step: Math.max(0, finiteOrNull(c.step) ?? 0),
    format: c.format ? String(c.format) : "%.4g",
    choices: Array.isArray(c.choices) ? c.choices.map(String) : [],
    readonly: !!c.readonly,
  };
  const d = c.default === undefined || c.default === null ? typeDefault(col) : checkCell({ ...col, default: typeDefault(col) }, c.default);
  const value = typeof d === "object" ? (d.ok ? d.value : typeDefault(col)) : d;
  return { ...col, default: value };
}

function rangeText(col: Column): string {
  const u = col.unit ? ` ${col.unit}` : "";
  const g = (v: number): string => String(Number(v.toPrecision(6)));
  if (col.min !== null && col.max !== null) return `enter a value between ${g(col.min)} and ${g(col.max)}${u}`;
  return col.min !== null ? `enter a value of at least ${g(col.min)}${u}` : `enter a value of at most ${g(col.max as number)}${u}`;
}

/**
 * Check a cell against its column (IND-113): the value as stored (numbers
 * snapped to `step`, halves up), or the reason it is refused. Numbers
 * follow the numeric entry rules (NUM-010).
 */
export function checkCell(col: Column, value: unknown): CellCheck {
  if (col.type === "bool") return typeof value === "boolean" ? { ok: true, value } : { ok: false, reason: "Not a Boolean" };
  if (col.type === "text") return typeof value === "string" ? { ok: true, value } : { ok: false, reason: "Not a text" };
  if (col.type === "choice") return typeof value === "string" && col.choices.includes(value) ? { ok: true, value } : { ok: false, reason: `Not one of ${col.choices.join(", ")}` };
  if (typeof value !== "number") return { ok: false, reason: "Not a number" };
  if (!Number.isFinite(value)) return { ok: false, reason: "Not a finite number" };
  let v = value;
  if ((col.min !== null && v < col.min) || (col.max !== null && v > col.max)) return { ok: false, reason: `Out of range: ${rangeText(col)}` };
  if (col.step > 0) {
    const base = col.min ?? 0;
    v = base + Math.floor((v - base) / col.step + 0.5) * col.step;
    if (col.min !== null) v = Math.max(v, col.min);
    if (col.max !== null) v = Math.min(v, col.max);
    v = Number(v.toPrecision(12)); // binary noise such as 0.30000000000000004
  }
  return { ok: true, value: v };
}

/** A number typed in a cell (decimal comma, SI prefix, unit, base of the format), then checked. */
export function checkTyped(col: Column, text: string): CellCheck {
  const v = parseEntry(text, col.unit, radixOf(col.format));
  if (Number.isNaN(v)) return { ok: false, reason: "Not a number" };
  return checkCell(col, v);
}

/** A new row: the default of every column. */
export function defaultRow(columns: readonly Column[]): Record<string, Cell> {
  return Object.fromEntries(columns.map((c) => [c.name, c.default]));
}

/** Display order of the rows sorted by `column` (IND-114); ties keep their order. */
export function sortedOrder(rows: ReadonlyArray<Record<string, unknown>>, column: string | null, descending = false): number[] {
  const order = rows.map((_, i) => i);
  if (!column) return order;
  const key = (i: number): unknown => rows[i][column];
  return order.sort((a, b) => {
    const x = key(a);
    const y = key(b);
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""), undefined, { numeric: true });
    return (descending ? -c : c) || a - b;
  });
}
