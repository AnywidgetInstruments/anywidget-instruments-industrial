// A11Y-004: default palettes meet WCAG 2.1 AA contrast (4.5:1 for text,
// 3:1 for state indicators / graphical objects).
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolvePath(process.cwd(), "js/src/styles.css"), "utf8");

/** Custom properties declared in the first block whose selector matches `selector`. */
function tokens(selector) {
  const i = css.indexOf(selector);
  if (i < 0) throw new Error(`selector not found: ${selector}`);
  const block = css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
  const out = {};
  for (const m of block.matchAll(/(--awi-[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

function parse(color) {
  // host variables: keep the innermost literal fallback
  const literal = color.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/i)?.[0] ?? color;
  if (literal.startsWith("#")) {
    const h = literal.length === 4 ? [...literal.slice(1)].map((c) => c + c).join("") : literal.slice(1, 7);
    return [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16)).concat(1);
  }
  const [r, g, b, a = 1] = literal.match(/[\d.]+/g).map(Number);
  return [r, g, b, a];
}

const lum = ([r, g, b]) => {
  const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

export function contrast(fg, bg) {
  const b = parse(bg);
  const f = parse(fg);
  const mix = f.slice(0, 3).map((c, k) => c * f[3] + b[k] * (1 - f[3])); // alpha over background
  const [l1, l2] = [lum(mix), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

function resolve(t, name) {
  let v = t[name];
  for (let i = 0; i < 5 && v && /^var\(--awi-/.test(v); i++) v = t[v.match(/--awi-[\w-]+/)[0]];
  return v;
}

const modern = tokens("\n.awi-root {\n");
const darkSystem = { ...modern, ...tokens(":is([data-jp-theme-light=\"false\"]") };
const darkTheme = { ...modern, ...tokens(".awi-root.awi-root.awi-root.awi-theme-dark {") };
const lightTheme = { ...modern, ...tokens(".awi-root.awi-root.awi-root.awi-theme-light {") };

const TEXT = [
  ["--awi-fg", "--awi-face"], ["--awi-fg", "--awi-plot-bg"], ["--awi-muted", "--awi-face"],
  ["--awi-alarm-hi", "--awi-face"], ["--awi-alarm-hihi", "--awi-face"],
  ["--awi-alarm-lo", "--awi-face"], ["--awi-alarm-lolo", "--awi-face"],
  ["--awi-ink-on-light", "--awi-cap-green"], ["--awi-ink-on-dark", "--awi-cap-red"], ["--awi-ink-on-dark", "--awi-cap-black"],
  ["--awi-ink-on-light", "--awi-cap-yellow"], ["--awi-ink-on-dark", "--awi-cap-blue"], ["--awi-ink-on-light", "--awi-cap-white"],
  ["--awi-lamp-ink-green", "--awi-stack-green"], ["--awi-lamp-ink-red", "--awi-stack-red"], ["--awi-lamp-ink-amber", "--awi-stack-amber"],
  ["--awi-lamp-ink-blue", "--awi-stack-blue"], ["--awi-lamp-ink-white", "--awi-stack-white"],
  ["--awi-ink-on-dark", "--awi-lamp-off"],
  ["--awi-ann-off-ink", "--awi-ann-off"], ["--awi-ann-horn", "--awi-ann-bg"], ["--awi-ann-ink-dark", "--awi-ann-btn"],
  ["--awi-ann-ink-light", "--awi-stack-red"], ["--awi-ann-ink-dark", "--awi-stack-amber"], ["--awi-ann-ink-dark", "--awi-stack-white"],
];
const GRAPHICS = [
  ["--awi-fill", "--awi-track"], ["--awi-needle", "--awi-face"], ["--awi-pointer", "--awi-knob"],
  ["--awi-led-on", "--awi-led-off"], ["--awi-seg-on", "--awi-seg-bg"], ["--awi-switch-on", "--awi-face"],
  ["--awi-ok", "--awi-face"], ["--awi-warn", "--awi-face"], ["--awi-danger", "--awi-face"],
  ["--awi-trace-0", "--awi-plot-bg"], ["--awi-trace-1", "--awi-plot-bg"], ["--awi-trace-2", "--awi-plot-bg"],
  ["--awi-trace-3", "--awi-plot-bg"], ["--awi-trace-4", "--awi-plot-bg"], ["--awi-trace-5", "--awi-plot-bg"],
  ["--awi-trace-6", "--awi-plot-bg"], ["--awi-trace-7", "--awi-plot-bg"],
  ["--awi-hp-pointer", "--awi-hp-track"], ["--awi-hp-pointer", "--awi-face"],
  ["--awi-stack-red", "--awi-face"], ["--awi-stack-green", "--awi-face"], ["--awi-stack-blue", "--awi-face"],
];

describe.each([["modern", modern], ["system (dark)", darkSystem], ["theme dark", darkTheme], ["theme light", lightTheme]])("%s palette", (_name, t) => {
  it.each(TEXT)("text %s on %s >= 4.5", (fg, bg) => {
    expect(contrast(resolve(t, fg), resolve(t, bg))).toBeGreaterThanOrEqual(4.5);
  });
  it.each(GRAPHICS)("indicator %s on %s >= 3", (fg, bg) => {
    expect(contrast(resolve(t, fg), resolve(t, bg))).toBeGreaterThanOrEqual(3);
  });
});

describe("alarm priority chips", () => {
  it.each([["#ffffff", "--awi-prio-critical"], ["#111827", "--awi-prio-high"], ["#111827", "--awi-prio-medium"], ["#111827", "--awi-prio-low"]])("chip text %s on %s >= 4.5", (text, p) => {
    expect(contrast(text, modern[p])).toBeGreaterThanOrEqual(4.5);
  });
});

describe("priority chips without their own background", () => {
  // a chip drawn as an outline sits on the widget face: its text must use the
  // face text color, not the dark ink meant for the colored chip (dark hosts)
  it("set a text color readable on the face", () => {
    const rules = [...css.matchAll(/([^{}]*\.awi-prio-chip[^{}]*)\{([^}]*)\}/g)].filter(([, , body]) => /background:\s*none/.test(body));
    expect(rules.length).toBeGreaterThan(0);
    for (const [, selector, body] of rules) expect(body, selector.trim()).toMatch(/(^|;)\s*color:\s*var\(--awi-fg\)/);
  });
});

describe("hidden elements", () => {
  // panels styled with display: flex (axes panel, cursor bar...) must still
  // disappear when their hidden attribute is set
  it("the hidden attribute overrides display rules", () => {
    expect(css).toMatch(/\.awi-root \[hidden\] \{ display: none !important; \}/);
  });
});

describe("push button caps (BOOL-015)", () => {
  // an unlit lamp cap is a mix of the lamp color and --awi-lamp-off, labelled
  // with --awi-ink-on-dark
  const pct = Number(css.match(/color-mix\(in srgb, var\(--awi-lamp\) (\d+)%, var\(--awi-lamp-off\)\)/)[1]) / 100;
  const mix = (a, b) => {
    const [x, y] = [parse(a), parse(b)];
    return `rgb(${[0, 1, 2].map((k) => Math.round(x[k] * pct + y[k] * (1 - pct))).join(",")})`;
  };
  describe.each([["modern", modern], ["system (dark)", darkSystem], ["theme dark", darkTheme], ["theme light", lightTheme]])("%s palette", (_name, t) => {
    it.each(["green", "red", "amber", "blue", "white"])("unlit %s cap text >= 4.5", (lamp) => {
      const cap = mix(resolve(t, `--awi-stack-${lamp}`), resolve(t, "--awi-lamp-off"));
      expect(contrast(resolve(t, "--awi-ink-on-dark"), cap)).toBeGreaterThanOrEqual(4.5);
    });
  });
  it("the grey cap keeps the face text color (its fill follows the palette)", () => {
    expect(css).not.toMatch(/\.awi-button-text:is\([^)]*\.awi-cap-grey/);
  });
});
