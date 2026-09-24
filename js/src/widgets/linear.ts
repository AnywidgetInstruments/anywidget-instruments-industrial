// Linear numeric widgets: Tank, Thermometer, FillSlide, VUMeter (NUM-105..108).
import { clear, safeColor, svg, svgText } from "../core/dom.js";
import { formatValue, tickFormat } from "../core/format.js";
import type { AnyModel } from "../core/model.js";
import { linearHit, parseNumber, ticks } from "../core/scale.js";
import type { TankTraits } from "../generated/contract.js";
import { NumericView, svgPoint } from "./numeric.js";

/**
 * Traits of the linear widgets. Tank comes from its schema; the traits of
 * Thermometer, FillSlide and VUMeter are typed here until they get theirs.
 */
export type LinearTraits = TankTraits & {
  orientation?: "vertical" | "horizontal";
  segments?: number;
  peak?: number | string | null;
  peak_hold?: boolean;
};

interface Track {
  w: number;
  h: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  bulb: number;
}

export class LinearView extends NumericView<LinearTraits> {
  readonly svgEl: SVGElement;
  readonly staticLayer: SVGElement;
  readonly dynamicLayer: SVGElement;
  protected _staticKey: string;
  track: Track | undefined;

  constructor(model: AnyModel<LinearTraits>, el: HTMLElement) {
    super(model, el, ["orientation", "markers", "fill_color", "segments", "peak", "peak_hold"]);
    this.svgEl = svg("svg", { class: "awi-svg", "aria-hidden": "true" });
    this.body.appendChild(this.svgEl);
    this.staticLayer = svg("g");
    this.dynamicLayer = svg("g", { class: "awi-dynamic" });
    this.svgEl.append(this.staticLayer, this.dynamicLayer);
    this._staticKey = "";
    const hit = (e: PointerEvent, final: boolean): void => {
      const p = svgPoint(this.svgEl, e);
      const t = this.track as Track;
      const f = this.vertical ? linearHit(p.y, t.y1, t.y0) : linearHit(p.x, t.x0, t.x1);
      this.commitFraction(f, final);
    };
    this.drag(this.svgEl, { start: (e) => hit(e, false), move: (e) => hit(e, false), end: (e) => hit(e, true) });
    this.schedule();
  }

  get vertical(): boolean {
    return this.kind === "tank" || this.kind === "thermometer" || this.get("orientation") !== "horizontal";
  }

  layout(): Track {
    const [w, h] = this.get("size");
    const labelSpace = 40;
    if (this.vertical) {
      const bulb = this.kind === "thermometer" ? 16 : 0;
      const x0 = labelSpace + 8;
      const width = this.kind === "thermometer" ? 14 : Math.max(12, w - x0 - (this.kind === "tank" ? 30 : 10));
      return { w, h, x0, x1: x0 + width, y0: 10, y1: h - 10 - bulb * 2, bulb };
    }
    const trackH = Math.min(18, Math.max(8, h - 40));
    return { w, h, x0: 14, x1: w - 14, y0: 8, y1: 8 + trackH, bulb: 0 };
  }

  pointAt(f: number): number {
    const t = this.track as Track;
    return this.vertical ? t.y1 - f * (t.y1 - t.y0) : t.x0 + f * (t.x1 - t.x0);
  }

  buildStatic(): void {
    const t = (this.track = this.layout());
    this.svgEl.setAttribute("viewBox", `0 0 ${t.w} ${t.h}`);
    const layer = this.staticLayer;
    clear(layer);
    const skin = this.skinPart("background", t.w, t.h);
    if (skin) layer.appendChild(skin);
    const fill = safeColor(this.get("fill_color"));
    if (fill) this.root.style.setProperty("--awi-fill", fill);
    else this.root.style.removeProperty("--awi-fill");

    // container (a "housing" skin replaces the tank / tube / track drawing)
    const housing = this.kind === "vumeter" ? null : this.skinPart("housing", t.x1 - t.x0, t.y1 - t.y0, t.x0, t.y0, "none");
    if (housing) {
      layer.appendChild(housing);
    } else if (this.kind === "thermometer") {
      const cx = (t.x0 + t.x1) / 2;
      layer.appendChild(svg("rect", { class: "awi-track", x: t.x0, y: t.y0 - 6, width: t.x1 - t.x0, height: t.y1 - t.y0 + 12, rx: 7 }));
      layer.appendChild(svg("circle", { class: "awi-track", cx, cy: t.y1 + t.bulb + 4, r: t.bulb }));
      layer.appendChild(svg("circle", { class: "awi-fill", cx, cy: t.y1 + t.bulb + 4, r: t.bulb - 4 }));
    } else if (this.kind !== "vumeter") {
      layer.appendChild(svg("rect", { class: "awi-track", x: t.x0, y: t.y0, width: t.x1 - t.x0, height: t.y1 - t.y0, rx: this.kind === "tank" ? 8 : 3 }));
    }

    // alarm limit zones next to the track (ALARM-005)
    if (this.get("show_limits")) {
      for (const z of this.limitZones()) {
        const a = this.pointAt(z.from);
        const b = this.pointAt(z.to);
        const attrs = this.vertical
          ? { x: t.x0 - 6, y: Math.min(a, b), width: 4, height: Math.abs(b - a) }
          : { x: Math.min(a, b), y: t.y1 + 2, width: Math.abs(b - a), height: 4 };
        layer.appendChild(svg("rect", { class: `awi-zone awi-zone-${z.level}`, ...attrs }));
      }
    }

    // scale
    const tk = ticks(this.min, this.max, Number(this.get("ticks")), Number(this.get("minor_ticks")), this.scaleType);
    const fmt = tickFormat(this.get("format"));
    const tickPath = (vals: number[], len: number): string =>
      vals
        .map((v) => {
          const p = this.pointAt(this.frac(v));
          return this.vertical ? `M${t.x0 - 8 - len} ${p}H${t.x0 - 8}` : `M${p} ${t.y1 + 8}V${t.y1 + 8 + len}`;
        })
        .join("");
    layer.appendChild(svg("path", { class: "awi-tick-minor", d: tickPath(tk.minor, 3) }));
    layer.appendChild(svg("path", { class: "awi-tick-major", d: tickPath(tk.major, 6) }));
    for (const v of tk.major) {
      const p = this.pointAt(this.frac(v));
      const attrs = this.vertical
        ? { x: t.x0 - 17, y: p, "text-anchor": "end", "dominant-baseline": "central" }
        : { x: p, y: t.y1 + 24, "text-anchor": "middle" };
      layer.appendChild(svgText(formatValue(v, fmt), { class: "awi-tick-label", ...attrs }));
    }

    // tank level markers
    if (this.kind === "tank") {
      for (const m of this.get("markers") || []) {
        const y = this.pointAt(this.frac(parseNumber(m)));
        layer.appendChild(svg("path", { class: "awi-marker", d: `M${t.x0} ${y}H${t.x1 + 6}` }));
        layer.appendChild(svgText(formatValue(parseNumber(m), fmt), { class: "awi-tick-label", x: t.x1 + 8, y, "dominant-baseline": "central" }));
      }
    }
  }

  override draw(): void {
    const key = JSON.stringify(["min", "max", "scale", "ticks", "minor_ticks", "format", "orientation", "markers", "fill_color", "show_limits", "lolo", "lo", "hi", "hihi", "size", "segments", "skin"].map((k) => this.get(k)));
    if (key !== this._staticKey || !this.track) {
      this._staticKey = key;
      this.buildStatic();
    }
    const t = this.track as Track;
    const p = this.pos();
    const layer = this.dynamicLayer;
    clear(layer);
    if (this.kind === "vumeter") {
      this.drawSegments(p.fraction);
      return;
    }
    const end = this.pointAt(p.fraction);
    let bar: SVGElement;
    if (this.vertical) {
      const x0 = this.kind === "thermometer" ? t.x0 + 3 : t.x0;
      const x1 = this.kind === "thermometer" ? t.x1 - 3 : t.x1;
      const bottom = this.kind === "thermometer" ? t.y1 + 8 : t.y1;
      bar = svg("rect", { class: "awi-fill", x: x0, y: end, width: x1 - x0, height: Math.max(0, bottom - end), rx: this.kind === "tank" ? 6 : 2 });
    } else {
      bar = svg("rect", { class: "awi-fill", x: t.x0, y: t.y0, width: Math.max(0, end - t.x0), height: t.y1 - t.y0, rx: 3 });
    }
    layer.appendChild(bar);
    if (this.kind === "fillslide" && this.get("mode") === "control") {
      const thumb = this.vertical
        ? svg("rect", { class: "awi-thumb", x: t.x0 - 4, y: end - 5, width: t.x1 - t.x0 + 8, height: 10, rx: 3 })
        : svg("rect", { class: "awi-thumb", x: end - 5, y: t.y0 - 4, width: 10, height: t.y1 - t.y0 + 8, rx: 3 });
      layer.appendChild(thumb);
    }
  }

  drawSegments(fraction: number): void {
    const t = this.track as Track;
    const n = Math.max(2, Number(this.get("segments")));
    const lit = Math.round(fraction * n);
    const g = (k: string): number | null => (this.get(k) === null || this.get(k) === undefined ? null : this.frac(parseNumber(this.get(k))));
    const warn = g("hi") ?? 0.7;
    const danger = g("hihi") ?? 0.9;
    const peak = this.get("peak");
    const peakIdx = this.get("peak_hold") && peak !== null && peak !== undefined ? Math.max(0, Math.round(this.frac(parseNumber(peak)) * n) - 1) : -1;
    const span = this.vertical ? t.y1 - t.y0 : t.x1 - t.x0;
    const size = span / n;
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n;
      const zone = f >= danger ? "danger" : f >= warn ? "warn" : "ok";
      const on = i < lit || i === peakIdx;
      const attrs = this.vertical
        ? { x: t.x0, y: t.y1 - (i + 1) * size + 1, width: t.x1 - t.x0, height: size - 2 }
        : { x: t.x0 + i * size + 1, y: t.y0, width: size - 2, height: t.y1 - t.y0 };
      this.dynamicLayer.appendChild(svg("rect", { class: `awi-seg awi-seg-${zone}${on ? " awi-on" : ""}${i === peakIdx ? " awi-peak-seg" : ""}`, rx: 1, ...attrs }));
    }
  }
}
