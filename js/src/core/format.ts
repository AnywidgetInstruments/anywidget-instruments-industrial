// Value formatting (NUM-004, UNIT-004).
//
// Format spec: "%.<precision><type>" with type
//   f  fixed            %.2f  -> 12.35
//   e  scientific       %.3e  -> 1.235e+1
//   g  general          %.4g  -> 12.35
//   n  engineering      %.3n  -> 12.3e0, 1.23e3 (exponent multiple of 3)
//   s  SI prefix        %.3s  -> 12.3 k, 4.70 µ
//   x  hexadecimal      %04x  -> 001f  (X: upper case, 001F)   (IND-110)
//   b  binary           %08b  -> 00011111
//   o  octal            %o    -> 37
// Hexadecimal, binary and octal show the value rounded to an integer. An
// optional width pads with spaces, or with zeros after a "0" flag ("%04X").
// Optional literal text may surround the spec, e.g. "x = %.2f".

const SI: Record<string, string> = { "-24": "y", "-21": "z", "-18": "a", "-15": "f", "-12": "p", "-9": "n", "-6": "µ", "-3": "m", 0: "", 3: "k", 6: "M", 9: "G", 12: "T", 15: "P", 18: "E", 21: "Z", 24: "Y" };

const SPEC = /%(0?)(\d+)?(\.(\d+))?([fegnsxXbo])/;

const RADIX: Record<string, number> = { x: 16, X: 16, b: 2, o: 8 };

/** Base of the values displayed with `fmt`: 16, 2, 8, or 10 for the decimal types. */
export function radixOf(fmt: string | null | undefined): number {
  const m = SPEC.exec(fmt || "");
  return (m && RADIX[m[5]]) || 10;
}

function engParts(v: number, precision: number): { mant: string; exp: number } {
  if (v === 0) return { mant: (0).toFixed(Math.max(0, precision - 1)), exp: 0 };
  let exp = Math.floor(Math.log10(Math.abs(v)) / 3) * 3;
  let mant = v / 10 ** exp;
  // significant digits: precision total
  const intDigits = Math.floor(Math.log10(Math.abs(mant))) + 1;
  let decimals = Math.max(0, precision - intDigits);
  let text = mant.toFixed(decimals);
  if (Math.abs(Number(text)) >= 1000) {
    // rounding overflow, e.g. 999.95 -> 1000.0
    exp += 3;
    mant = v / 10 ** exp;
    decimals = Math.max(0, precision - 1);
    text = mant.toFixed(decimals);
  }
  return { mant: text, exp };
}

/** Format a number with a printf-like spec. Non-finite values give "NaN", "+Inf", "-Inf". */
export function formatValue(v: number, fmt: string | null | undefined = "%.1f"): string {
  if (Number.isNaN(v)) return "NaN";
  if (v === Infinity) return "+Inf";
  if (v === -Infinity) return "-Inf";
  const m = SPEC.exec(fmt || "");
  if (!m) return String(v);
  const [, zero, width, , prec, type] = m;
  const precision = prec === undefined ? (type === "f" ? 1 : 3) : Number(prec);
  let body: string;
  switch (type) {
    case "f":
      body = v.toFixed(Math.min(precision, 20));
      break;
    case "e":
      body = v.toExponential(Math.min(precision, 20));
      break;
    case "g":
      body = String(Number(v.toPrecision(Math.max(1, Math.min(precision, 21)))));
      break;
    case "n": {
      const { mant, exp } = engParts(v, Math.max(1, precision));
      body = `${mant}e${exp}`;
      break;
    }
    case "s": {
      const { mant, exp } = engParts(v, Math.max(1, precision));
      const prefix = SI[exp];
      body = prefix === undefined ? `${mant}e${exp}` : `${mant}${prefix ? ` ${prefix}` : ""}`;
      break;
    }
    case "x":
    case "X":
    case "b":
    case "o": {
      const n = Math.round(v);
      const digits = Math.abs(n).toString(RADIX[type]);
      body = `${n < 0 ? "-" : ""}${type === "X" ? digits.toUpperCase() : digits}`;
      break;
    }
    default:
      body = String(v);
  }
  if (body === "-0" || /^-0\.?0*$/.test(body)) body = body.slice(1);
  if (width) body = pad(body, Number(width), zero === "0");
  return (fmt || "").replace(SPEC, body);
}

/** Pad to `width` characters: zeros after the sign, or spaces before. */
function pad(body: string, width: number, zeros: boolean): string {
  if (body.length >= width || !/\d/.test(body)) return body;
  if (!zeros) return body.padStart(width, " ");
  const sign = body.startsWith("-") ? "-" : "";
  return sign + body.slice(sign.length).padStart(width - sign.length, "0");
}

/** Join a formatted value and a unit, taking care of SI prefixes ("4.7 k" + "Ω" -> "4.7 kΩ"). */
export function withUnit(text: string, unit: string | null | undefined): string {
  if (!unit) return text;
  if (/ [a-zA-Zµ]$/.test(text)) return `${text}${unit}`;
  return `${text} ${unit}`;
}

/** Compact format used for scale labels, derived from the value format. */
export function tickFormat(fmt: string | null | undefined): string {
  const m = SPEC.exec(fmt || "");
  const type = m ? m[5] : "f";
  if (RADIX[type]) return `%${type}`; // scale labels in the same base, without padding
  return type === "f" || type === "g" ? "%.4g" : `%.2${type}`;
}

const PREFIX: Record<string, number> = { y: -24, z: -21, a: -18, f: -15, p: -12, n: -9, u: -6, "µ": -6, m: -3, k: 3, M: 6, G: 9, T: 12, P: 15, E: 18 };
const ENTRY = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*([yzafpnuµmkMGTPE]?)$/i;

const DIGITS: Record<number, RegExp> = { 16: /^[0-9a-f]+$/i, 2: /^[01]+$/, 8: /^[0-7]+$/ };
const PREFIXED = /^([-+]?)0([xbo])(\w+)$/i;

/** Integer written in base `radix` (digits only, optional sign), or NaN. */
function parseInteger(sign: string, digits: string, radix: number): number {
  if (!DIGITS[radix].test(digits)) return Number.NaN;
  const v = parseInt(digits, radix);
  return sign === "-" ? -v : v;
}

/**
 * Parse a number typed by the user (NUM-010): decimal comma or point,
 * exponent, optional SI prefix and optional trailing unit
 * ("2,5", "1e3", "4.7 k", "250 mV" with unit "V"). Integers with a 0x, 0b
 * or 0o prefix are read in that base; with `radix` 16, 2 or 8 (a value
 * displayed in that base, IND-110) digits without prefix are too. Returns
 * NaN otherwise.
 */
export function parseEntry(text: unknown, unit = "", radix = 10): number {
  let t = String(text ?? "").trim();
  if (unit && t.endsWith(unit)) t = t.slice(0, -unit.length).trim();
  const p = PREFIXED.exec(t);
  if (p) return parseInteger(p[1], p[3], { x: 16, b: 2, o: 8 }[p[2].toLowerCase() as "x" | "b" | "o"]);
  if (radix !== 10) {
    const r = /^([-+]?)(\w+)$/.exec(t);
    return r ? parseInteger(r[1], r[2], radix) : Number.NaN;
  }
  t = t.replace(",", ".");
  const m = ENTRY.exec(t);
  if (!m) return Number.NaN;
  // an "e"/"E" alone is the exponent-less prefix E (exa) only when not part of the number
  const exp = m[2] ? PREFIX[m[2]] ?? PREFIX[m[2].toLowerCase()] : 0;
  if (exp === undefined) return Number.NaN;
  return Number(m[1]) * 10 ** exp;
}
