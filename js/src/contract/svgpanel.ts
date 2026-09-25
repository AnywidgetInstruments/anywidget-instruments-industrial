// SvgPanel role convention and value rules (IND-121 .. IND-123), shared with
// the Python kernel (parse_role, truthy, matches, rotate_angle, step_value in
// _svgpanel.py); both are checked against tests/parity/svgpanel.json.

type Kind = "number" | "text" | "color";
type Options = Record<string, number | string | null>;

export const ROLES: Record<string, Record<string, [Kind, number | string | null]>> = {
  text: { format: ["text", "%.1f"], unit: ["text", ""] },
  rotate: { min: ["number", 0], max: ["number", 100], from: ["number", -135], to: ["number", 135], cx: ["number", null], cy: ["number", null] },
  scale: { min: ["number", 0], max: ["number", 100], edge: ["text", "bottom"] },
  show: { eq: ["text", null] },
  state: {},
  case: {},
  color: { on: ["color", "#22c55e"], off: ["color", "#6b7280"], eq: ["text", null] },
  button: { label: ["text", ""] },
  momentary: { label: ["text", ""] },
  set: { value: ["text", ""], label: ["text", ""] },
  step: { step: ["number", 1], min: ["number", 0], max: ["number", 100], label: ["text", ""], unit: ["text", ""], format: ["text", "%.1f"] },
};
export const CONTROL_ROLES = ["button", "momentary", "set", "step"];
const EDGES = ["bottom", "top", "left", "right"];
const NAME = /^[A-Za-z0-9_.\-/]+$/;
/** A decimal number, as both sides read it (no hexadecimal, no digit separators). */
const NUMBER = /^\s*[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i;
const COLOR = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|(rgb|hsl)a?\([0-9.,%\s]+\))$/;

export interface Role {
  role: string;
  name: string;
  options: Options;
}

/** Role of an element label: the role, a reason when invalid, or null (decoration). */
export function parseRole(label: string): Role | string | null {
  const text = label.trim();
  if (!text.startsWith("awi:")) return null;
  const [head, ...rest] = text.slice(4).split(";").map((p) => p.trim());
  const eq = head.indexOf("=");
  const role = (eq < 0 ? head : head.slice(0, eq)).trim();
  const name = eq < 0 ? "" : head.slice(eq + 1).trim();
  if (!(role in ROLES)) return `unknown role '${role}'`;
  if (eq < 0 || !NAME.test(name)) return `role '${role}' needs a name (letters, digits, _ . - /)`;
  const spec = ROLES[role];
  const options: Options = Object.fromEntries(Object.entries(spec).map(([k, [, d]]) => [k, d]));
  for (const part of rest) {
    if (!part) continue;
    const i = part.indexOf("=");
    const key = (i < 0 ? part : part.slice(0, i)).trim();
    const raw = i < 0 ? "" : part.slice(i + 1).trim();
    if (!(key in spec) || i < 0) return `unknown option '${key}' for role '${role}'`;
    const kind = spec[key][0];
    if (kind === "number") {
      const v = NUMBER.test(raw) ? Number(raw) : NaN;
      if (Number.isNaN(v)) return `option '${key}' must be a number, got '${raw}'`;
      if (!Number.isFinite(v)) return `option '${key}' must be finite`;
      options[key] = v;
    } else if (kind === "color") {
      if (!COLOR.test(raw)) return `option '${key}' is not a color: '${raw}'`;
      options[key] = raw;
    } else options[key] = raw;
  }
  if ("min" in options && "max" in options && !((options.max as number) > (options.min as number))) return "option 'max' must be greater than 'min'";
  if (role === "scale" && !EDGES.includes(String(options.edge))) return `option 'edge' must be one of ${EDGES.join(", ")}`;
  if (role === "step" && !((options.step as number) > 0)) return "option 'step' must be positive";
  return { role, name, options };
}

/** State of a Boolean role: true, a non-zero number or a word other than 0/false/off/no. */
export function truthy(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) && value !== 0;
  if (typeof value === "string") return !["", "0", "false", "off", "no"].includes(value.trim().toLowerCase());
  return false;
}

/** Value written by a set element: a number, true / false, or the text. */
export function optionValue(raw: string): number | boolean | string {
  const t = raw.trim().toLowerCase();
  if (t === "true" || t === "false") return t === "true";
  const v = NUMBER.test(raw) ? Number(raw) : NaN;
  return Number.isFinite(v) ? v : raw;
}

/** Whether `value` equals the option text `raw` (eq options, case names). */
export function matches(raw: string, value: unknown): boolean {
  const expected = optionValue(raw);
  if (typeof value === "boolean" || typeof expected === "boolean") return typeof value === "boolean" && value === expected;
  if (typeof value === "number" && typeof expected === "number") return value === expected;
  return value !== null && value !== undefined && typeof value !== "number" && String(value) === raw.trim();
}

/** Position of a number in [min, max], clamped to [0, 1]; null if not a number. */
export function fraction(value: unknown, options: Options): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const min = options.min as number;
  const max = options.max as number;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/** Angle of a rotate element for `value`, in degrees. */
export function rotateAngle(value: unknown, options: Options): number | null {
  const f = fraction(value, options);
  return f === null ? null : (options.from as number) + f * ((options.to as number) - (options.from as number));
}

/** Value after one step up (+1) or down (-1), within [min, max]. */
export function stepValue(value: unknown, direction: number, options: Options): number {
  const min = options.min as number;
  const max = options.max as number;
  const base = typeof value === "number" && Number.isFinite(value) ? value : min;
  return Number(Math.min(max, Math.max(min, base + direction * (options.step as number))).toPrecision(12));
}
