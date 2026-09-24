// Value formatting (NUM-004, UNIT-004).
//
// Format spec: "%.<precision><type>" with type
//   f  fixed            %.2f  -> 12.35
//   e  scientific       %.3e  -> 1.235e+1
//   g  general          %.4g  -> 12.35
//   n  engineering      %.3n  -> 12.3e0, 1.23e3 (exponent multiple of 3)
//   s  SI prefix        %.3s  -> 12.3 k, 4.70 µ
// Optional literal text may surround the spec, e.g. "x = %.2f".

const SI = { "-24": "y", "-21": "z", "-18": "a", "-15": "f", "-12": "p", "-9": "n", "-6": "µ", "-3": "m", 0: "", 3: "k", 6: "M", 9: "G", 12: "T", 15: "P", 18: "E", 21: "Z", 24: "Y" };

const SPEC = /%(\.(\d+))?([fegns])/;

function engParts(v, precision) {
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
export function formatValue(v, fmt = "%.1f") {
  if (Number.isNaN(v)) return "NaN";
  if (v === Infinity) return "+Inf";
  if (v === -Infinity) return "-Inf";
  const m = SPEC.exec(fmt || "");
  if (!m) return String(v);
  const precision = m[2] === undefined ? (m[3] === "f" ? 1 : 3) : Number(m[2]);
  let body;
  switch (m[3]) {
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
    default:
      body = String(v);
  }
  if (body === "-0" || /^-0\.?0*$/.test(body)) body = body.slice(1);
  return fmt.replace(SPEC, body);
}

/** Join a formatted value and a unit, taking care of SI prefixes ("4.7 k" + "Ω" -> "4.7 kΩ"). */
export function withUnit(text, unit) {
  if (!unit) return text;
  if (/ [a-zA-Zµ]$/.test(text)) return `${text}${unit}`;
  return `${text} ${unit}`;
}

/** Compact format used for scale labels, derived from the value format. */
export function tickFormat(fmt) {
  const m = SPEC.exec(fmt || "");
  const type = m ? m[3] : "f";
  return type === "f" || type === "g" ? "%.4g" : `%.2${type}`;
}
