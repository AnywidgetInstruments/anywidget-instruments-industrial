// Rotary numeric widgets: Knob, Dial, Gauge, Meter, Compass (NUM-101..104, SPEC-001).
import { clear, safeColor, svg, svgText } from "../core/dom.js";
import { formatValue, tickFormat } from "../core/format.js";
import type { AnyModel } from "../core/model.js";
import { arcPath, parseNumber, polar, sectorPath, ticks } from "../core/scale.js";
import type { KnobTraits } from "../generated/contract.js";
import { NumericView } from "./numeric.js";

/**
 * Traits of the rotary widgets. Knob comes from its schema; the traits of
 * Dial, Gauge, Meter and Compass are typed here until they get theirs.
 */
export type RotaryTraits = KnobTraits & {
  turns?: number;
  variant?: "circular" | "semicircular";
  ranges?: Array<{ from: number | string; to: number | string; color?: string }>;
  peak?: number | string | null;
  peak_hold?: boolean;
};

interface Geometry {
  vb: [number, number];
  cx: number;
  cy: number;
  range: number;
  body?: number;
  face?: number;
  zone?: [number, number];
  tick: [number, number];
  minor: [number, number];
  label: number;
  needle: number;
}

// Geometry of each variant in its own viewBox.
function geometry(kind: string, view: RotaryView): Geometry {
  const range = parseNumber(view.get("angle_range")) || 270;
  switch (kind) {
    case "knob":
      return { vb: [200, 200], cx: 100, cy: 100, range, body: 56, tick: [64, 74], minor: [64, 69], label: 86, needle: 50 };
    case "dial":
      return { vb: [200, 200], cx: 100, cy: 100, range: Number(view.get("turns")) > 1 ? 360 : range, body: 60, tick: [66, 76], minor: [66, 71], label: 87, needle: 56 };
    case "gauge":
      return view.get("variant") === "semicircular"
        ? { vb: [200, 118], cx: 100, cy: 104, range: 180, face: 96, zone: [70, 80], tick: [70, 82], minor: [74, 82], label: 57, needle: 80 }
        : { vb: [200, 200], cx: 100, cy: 100, range: 270, face: 96, zone: [70, 80], tick: [70, 82], minor: [74, 82], label: 57, needle: 80 };
    case "meter":
      return { vb: [200, 140], cx: 100, cy: 158, range, zone: [112, 120], tick: [112, 126], minor: [112, 118], label: 100, needle: 128 };
    case "compass":
      return { vb: [200, 200], cx: 100, cy: 100, range: 360, face: 96, tick: [80, 92], minor: [86, 92], label: 66, needle: 74 };
    default:
      throw new Error(`unknown rotary widget ${kind}`);
  }
}

const CARDINALS: Record<number, string> = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };

export class RotaryView extends NumericView<RotaryTraits> {
  readonly svgEl: SVGElement;
  readonly staticLayer: SVGElement;
  readonly peakMark: SVGElement;
  readonly needle: SVGElement;
  readonly turnText: SVGElement;
  protected _staticKey: string;
  protected _dragStart: { x: number; y: number; f: number } | null;
  g: Geometry | undefined;

  constructor(model: AnyModel<RotaryTraits>, el: HTMLElement) {
    super(model, el, ["angle_range", "turns", "variant", "ranges", "peak", "peak_hold"]);
    this.svgEl = svg("svg", { class: "awi-svg", "aria-hidden": "true" });
    this.body.appendChild(this.svgEl);
    this.staticLayer = svg("g");
    this.peakMark = svg("path", { class: "awi-peak" });
    this.needle = svg("g", { class: "awi-needle" });
    this.turnText = svgText("", { class: "awi-turns", "text-anchor": "middle" });
    this.svgEl.append(this.staticLayer, this.peakMark, this.needle, this.turnText);
    this._staticKey = "";
    this._dragStart = null;
    this.drag(this.svgEl, {
      start: (e) => {
        this._dragStart = { x: e.clientX, y: e.clientY, f: this.pos().fraction ?? 0 };
      },
      move: (e) => this.onDrag(e, false),
      end: (e) => this.onDrag(e, true),
    });
    this.schedule();
  }

  get turns(): number {
    return Math.max(1, Number(this.get("turns")) || 1);
  }

  onDrag(e: PointerEvent, final: boolean): void {
    const s = this._dragStart;
    if (!s) return;
    const px = e.clientX - s.x - (e.clientY - s.y); // right or up increases
    const sensitivity = e.shiftKey ? 2000 : 200; // pixels for the full scale
    const turns = this.kind === "dial" ? this.turns : 1;
    const f = Math.min(1, Math.max(0, s.f + px / (sensitivity * turns)));
    this.commitFraction(f, final);
    if (final) this._dragStart = null;
  }

  angleOf(f: number): number {
    const g = this.g as Geometry;
    if (this.kind === "compass") return f * 360;
    if (this.kind === "dial" && this.turns > 1) return ((f * this.turns) % 1) * 360;
    return -g.range / 2 + f * g.range;
  }

  buildStatic(): void {
    const g = (this.g = geometry(this.kind, this));
    const [w, h] = g.vb;
    this.svgEl.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const layer = this.staticLayer;
    clear(layer);
    const background = this.skinPart("background", w, h);
    if (background) layer.appendChild(background);
    const housing = this.skinPart("housing", w, h);
    if (housing) layer.appendChild(housing);
    else if (background) {
      // a background skin replaces the default face
    } else if (g.face) {
      if (this.kind === "gauge" && this.get("variant") === "semicircular") {
        layer.appendChild(svg("path", { class: "awi-face", d: `${arcPath(g.cx, g.cy, g.face, -90, 90)}Z` }));
      } else {
        layer.appendChild(svg("circle", { class: "awi-face", cx: g.cx, cy: g.cy, r: g.face }));
      }
    } else if (this.kind === "meter") {
      layer.appendChild(svg("rect", { class: "awi-face", x: 2, y: 2, width: w - 4, height: h - 4, rx: 6 }));
    }

    const min = this.min;
    const max = this.max;
    const multiTurn = this.kind === "dial" && this.turns > 1;
    const turnMax = multiTurn ? min + (max - min) / this.turns : max;
    const angle = (v: number): number => {
      if (this.kind === "compass") return v;
      const f = multiTurn ? (v - min) / (turnMax - min) : this.frac(v);
      return multiTurn ? f * 360 : -g.range / 2 + f * g.range;
    };

    // colored ranges (NUM-103) and alarm zones (ALARM-005)
    const zoneR = g.zone || [g.tick[0], g.tick[0] + 6];
    for (const r of this.get("ranges") || []) {
      const a0 = angle(Math.max(min, parseNumber(r.from)));
      const a1 = angle(Math.min(max, parseNumber(r.to)));
      if (a1 > a0) {
        const p = svg("path", { class: "awi-range", d: sectorPath(g.cx, g.cy, zoneR[0], zoneR[1], a0, a1) });
        const c = safeColor(r.color);
        if (c) p.style.fill = c;
        layer.appendChild(p);
      }
    }
    if (this.get("show_limits") && this.kind !== "compass") {
      for (const z of this.limitZones()) {
        const a0 = -g.range / 2 + z.from * g.range;
        const a1 = -g.range / 2 + z.to * g.range;
        layer.appendChild(svg("path", { class: `awi-zone awi-zone-${z.level}`, d: sectorPath(g.cx, g.cy, zoneR[0], zoneR[1], a0, a1) }));
      }
    }

    // scale arc and ticks (NUM-001)
    if (this.kind !== "compass" && !multiTurn) {
      layer.appendChild(svg("path", { class: "awi-scale-line", d: arcPath(g.cx, g.cy, g.tick[0], -g.range / 2, g.range / 2) }));
    }
    const t = ticks(min, turnMax, Number(this.get("ticks")), Number(this.get("minor_ticks")), this.scaleType, { nice: this.kind !== "compass" });
    const tickPath = (vals: number[], [r0, r1]: [number, number]): string =>
      vals
        .map((v) => {
          const a = angle(v);
          const [x0, y0] = polar(g.cx, g.cy, r0, a);
          const [x1, y1] = polar(g.cx, g.cy, r1, a);
          return `M${x0.toFixed(2)} ${y0.toFixed(2)}L${x1.toFixed(2)} ${y1.toFixed(2)}`;
        })
        .join("");
    layer.appendChild(svg("path", { class: "awi-tick-minor", d: tickPath(t.minor, g.minor) }));
    layer.appendChild(svg("path", { class: "awi-tick-major", d: tickPath(t.major, g.tick) }));
    const fmt = this.get("format") as string;
    const seen = new Set<number>();
    for (const v of t.major) {
      const a = angle(v);
      const key = Math.round((((a % 360) + 360) % 360) * 10);
      if (seen.has(key)) continue; // 0 and 360 on full-circle scales
      seen.add(key);
      const [x, y] = polar(g.cx, g.cy, g.label, a);
      const text = this.kind === "compass" && CARDINALS[Math.round(v) % 360] ? CARDINALS[Math.round(v) % 360] : formatValue(v, tickFormat(fmt));
      layer.appendChild(svgText(text, { class: "awi-tick-label", x: x.toFixed(1), y: y.toFixed(1), "text-anchor": "middle", "dominant-baseline": "central" }));
    }

    // needle / pointer
    clear(this.needle);
    if (this.kind === "knob" || this.kind === "dial") {
      // knob skin: drawn pointing up, rotated with the value
      const body = g.body as number;
      const knob = this.skinPart("knob", 2 * body, 2 * body, g.cx - body, g.cy - body);
      if (knob) this.needle.appendChild(knob);
      else {
        this.needle.appendChild(svg("circle", { class: this.kind === "dial" ? "awi-knob-body awi-knurl" : "awi-knob-body", cx: g.cx, cy: g.cy, r: body }));
        this.needle.appendChild(svg("line", { class: "awi-pointer", x1: g.cx, y1: g.cy - body * 0.35, x2: g.cx, y2: g.cy - g.needle, "stroke-linecap": "round" }));
      }
    } else {
      const base = this.kind === "meter" ? 2.5 : 4;
      // needle skin: pointing up, pivot at the bottom centre of its box
      const needle = this.skinPart("needle", g.needle * 0.3, g.needle, g.cx - g.needle * 0.15, g.cy - g.needle, "xMidYMax meet");
      if (needle) this.needle.appendChild(needle);
      else this.needle.appendChild(svg("path", { class: "awi-needle-shape", d: `M${g.cx - base} ${g.cy}L${g.cx} ${g.cy - g.needle}L${g.cx + base} ${g.cy}Z` }));
      this.needle.appendChild(svg("circle", { class: "awi-hub", cx: g.cx, cy: g.cy, r: this.kind === "meter" ? 6 : 7 }));
    }
    this.needle.style.transformOrigin = `${g.cx}px ${g.cy}px`;
    this.turnText.setAttribute("x", String(g.cx));
    this.turnText.setAttribute("y", String(g.cy + (g.body || 30) + 30));
  }

  override draw(): void {
    const key = JSON.stringify([
      "min", "max", "scale", "ticks", "minor_ticks", "format", "angle_range", "turns", "variant",
      "ranges", "show_limits", "lolo", "lo", "hi", "hihi", "size", "skin",
    ].map((k) => this.get(k)));
    if (key !== this._staticKey || !this.g) {
      this._staticKey = key;
      this.buildStatic();
    }
    const g = this.g as Geometry;
    const p = this.pos();
    this.needle.style.transform = `rotate(${this.angleOf(p.fraction).toFixed(2)}deg)`;

    const turns = this.turns;
    this.turnText.textContent = this.kind === "dial" && turns > 1 ? `turn ${Math.min(turns, Math.floor(p.fraction * turns) + 1)}/${turns}` : "";

    const peak = this.get("peak");
    if (this.get("peak_hold") && peak !== null && peak !== undefined && g.tick) {
      const a = this.angleOf(this.frac(parseNumber(peak)));
      const [x0, y0] = polar(g.cx, g.cy, g.tick[1] + 1, a - 3);
      const [x1, y1] = polar(g.cx, g.cy, g.tick[1] + 1, a + 3);
      const [x2, y2] = polar(g.cx, g.cy, g.tick[0] + 2, a);
      this.peakMark.setAttribute("d", `M${x0} ${y0}L${x1} ${y1}L${x2} ${y2}Z`);
      this.peakMark.style.display = "";
    } else {
      this.peakMark.style.display = "none";
    }
  }
}
