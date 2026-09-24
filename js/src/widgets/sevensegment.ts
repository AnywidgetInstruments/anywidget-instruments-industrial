// Seven-segment numeric display (NUM-109).
import { clear, safeColor, svg } from "../core/dom.js";
import type { AnyModel } from "../core/model.js";
import { keyStep } from "../core/scale.js";
import type { SevenSegmentTraits } from "../generated/contract.js";
import { NumericView } from "./numeric.js";

//   aaa
//  f   b
//   ggg
//  e   c
//   ddd   (dp)
const GLYPHS: Record<string, string> = {
  0: "abcdef", 1: "bc", 2: "abdeg", 3: "abcdg", 4: "bcfg", 5: "acdfg", 6: "acdefg",
  7: "abc", 8: "abcdefg", 9: "abcdfg", "-": "g", " ": "", E: "adefg", r: "eg", o: "cdeg",
  N: "abcef", a: "abcdeg", n: "ceg", I: "bc", F: "aefg",
};

const W = 30;
const H = 54;
const T = 5; // segment thickness

function segmentPath(s: string, ox: number): string {
  const h = T / 2;
  const hor = (x: number, y: number): string => `M${ox + x + h} ${y}l${h} ${-h}h${W - 4 * h - T}l${h} ${h}l${-h} ${h}h${-(W - 4 * h - T)}Z`;
  const ver = (x: number, y: number): string => `M${ox + x} ${y + h}l${h} ${h}v${H / 2 - 2 * T}l${-h} ${h}l${-h} ${-h}v${-(H / 2 - 2 * T)}Z`;
  switch (s) {
    case "a": return hor(h, h);
    case "g": return hor(h, H / 2);
    case "d": return hor(h, H - h);
    case "f": return ver(h, h);
    case "b": return ver(W - h, h);
    case "e": return ver(h, H / 2);
    case "c": return ver(W - h, H / 2);
    default: return "";
  }
}

/** Text shown for a value: fixed decimals, right aligned; "Err" on overflow, "NaN" if invalid. */
export function sevenSegmentText(v: number, digits: number, decimals: number): { chars: string; dp: number } {
  if (!Number.isFinite(v)) return { chars: Number.isNaN(v) ? " NaN".slice(-digits) : "  Err".slice(-digits), dp: -1 };
  const text = Math.abs(v).toFixed(Math.max(0, decimals));
  const [int, frac = ""] = text.split(".");
  const body = (v < 0 && Number(text) !== 0 ? "-" : "") + int + frac;
  if (body.length > digits) return { chars: "Err".padStart(digits, " ").slice(-digits), dp: -1 };
  return { chars: body.padStart(digits, " "), dp: frac ? digits - frac.length - 1 : -1 };
}

export class SevenSegmentView extends NumericView<SevenSegmentTraits> {
  readonly svgEl: SVGElement;

  constructor(model: AnyModel<SevenSegmentTraits>, el: HTMLElement) {
    super(model, el, ["digits", "decimals", "color"], { role: "img" });
    this.svgEl = svg("svg", { class: "awi-svg", "aria-hidden": "true", preserveAspectRatio: "xMidYMid meet" });
    this.body.appendChild(this.svgEl);
    this.valueRow.classList.add("awi-sr-only-when-segments");
    // direct manipulation in control mode (API-014): drag up / down, one
    // keyboard step per 8 px
    let y0 = 0;
    let v0 = 0;
    this.drag(this.svgEl, {
      start: (e) => {
        y0 = e.clientY;
        v0 = Number.isFinite(this.value) ? this.value : this.min;
      },
      move: (e) => this.commit(v0 + Math.round((y0 - e.clientY) / 8) * keyStep(this.min, this.max, this.step)),
      end: (e) => this.commit(v0 + Math.round((y0 - e.clientY) / 8) * keyStep(this.min, this.max, this.step), true),
    });
    this.schedule();
  }

  override draw(): void {
    const digits = Math.max(1, this.get("digits"));
    const gap = 10;
    const width = digits * (W + gap) + gap;
    this.svgEl.setAttribute("viewBox", `0 0 ${width} ${H + 16}`);
    const c = safeColor(this.get("color"));
    if (c) this.root.style.setProperty("--awi-seg-on", c);
    else this.root.style.removeProperty("--awi-seg-on");
    clear(this.svgEl);
    this.svgEl.appendChild(svg("rect", { class: "awi-seg-bg", x: 0, y: 0, width, height: H + 16, rx: 6 }));
    const { chars, dp } = sevenSegmentText(this.value, digits, this.get("decimals"));
    for (let i = 0; i < digits; i++) {
      const ox = gap + i * (W + gap);
      const lit = GLYPHS[chars[i]] ?? "";
      const g = svg("g", { transform: `translate(0 8) skewX(-6)` });
      for (const s of "abcdefg") {
        g.appendChild(svg("path", { class: lit.includes(s) ? "awi-segment awi-on" : "awi-segment", d: segmentPath(s, ox) }));
      }
      g.appendChild(svg("circle", { class: i === dp ? "awi-segment awi-on" : "awi-segment", cx: ox + W + gap / 2, cy: H - 2, r: 3 }));
      this.svgEl.appendChild(g);
    }
  }
}
