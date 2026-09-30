// PolarPlot, SmithChart, RadarChart (SPEC-002..004). SVG rendering.
import { gammaToZ, radarRange, screenAngle, type AngleConvention } from "../contract/polar.js";
import { clear, html, safeColor, setAttr, setHidden, svg, svgText } from "anywidget-instruments/js/src/core/dom.js";
import { checkEntry } from "../core/entry.js";
import { formatValue } from "../core/format.js";
import type { AnyModel } from "anywidget-instruments/js/src/core/model.js";
import { niceTicks, parseNumber } from "anywidget-instruments/js/src/core/scale.js";
import { BaseView } from "anywidget-instruments/js/src/core/view.js";
import type { PolarPlotTraits, RadarChartTraits, SeriesWidgetTraits, SmithChartTraits } from "../generated/contract.js";

export { gammaToZ, screenAngle };

/** A data set of any of the three widgets; fields are checked when drawn. */
export interface Series {
  name?: unknown;
  color?: unknown;
  style?: unknown;
  r?: unknown;
  theta?: unknown;
  re?: unknown;
  im?: unknown;
  values?: unknown;
}

/** Traits of the polar family, from their schemas. */
export type PolarViewTraits = Omit<SeriesWidgetTraits, "value"> & { value: Series[] } & Partial<
  Pick<PolarPlotTraits, "angle_unit" | "zero" | "direction" | "r_max" | "rings" | "unit"> & Pick<SmithChartTraits, "z0" | "show_admittance"> & Pick<RadarChartTraits, "axes" | "ranges" | "fill">
>;

type Point = [number, number];

const C = 100; // centre of the 200×200 viewBox

/** Numbers of a data set field: non-finite values arrive as "nan", "inf", "-inf". */
const numbers = (v: unknown): number[] => (Array.isArray(v) ? v.map((x) => (typeof x === "number" || typeof x === "string" ? parseNumber(x) : NaN)) : []);
const nameOf = (d: Series): string => (d.name === undefined || d.name === null ? "" : String(d.name));

const polarXY = (rNorm: number, phiDeg: number, R: number): Point => {
  const a = (phiDeg * Math.PI) / 180;
  return [C + rNorm * R * Math.cos(a), C - rNorm * R * Math.sin(a)];
};

interface PathOptions {
  closed?: boolean;
  fill?: boolean;
  markers?: boolean;
  line?: boolean;
  title?: (i: number) => string;
}

export class PolarView extends BaseView<PolarViewTraits> {
  readonly svgEl: SVGElement;
  readonly legend: HTMLDivElement;
  rField?: HTMLInputElement;
  rMsg?: HTMLSpanElement;
  rRow?: HTMLDivElement;
  shownRMax = 1;

  constructor(model: AnyModel<PolarViewTraits>, el: HTMLElement) {
    super(model, el, ["value", "show_legend", "angle_unit", "zero", "direction", "r_max", "rings", "unit", "z0", "show_admittance", "axes", "ranges", "fill"]);
    this.svgEl = svg("svg", { class: "awi-svg awi-polar", viewBox: "0 0 200 200" });
    this.body.appendChild(this.svgEl);
    this.body.setAttribute("role", "img");
    this.legend = html("div", { cls: "awi-legend" });
    this.root.appendChild(this.legend);
    if (this.kind === "polar") this.buildRadialRange();
    this.schedule();
  }

  // -- radial range (CHART-108): mouse wheel on the plot, or typed ---------------------------
  buildRadialRange(): void {
    const field = (this.rField = html("input", { cls: "awi-entry", attrs: { type: "text", inputmode: "decimal", "aria-label": "Radial range maximum", "data-lm-suppress-shortcuts": "true" } }));
    const msg = (this.rMsg = html("span", { cls: "awi-entry-msg", attrs: { role: "alert" } }));
    const auto = html("button", { text: "Auto", attrs: { type: "button", title: "Automatic radial range" } });
    auto.addEventListener("click", () => this.setRMax(null));
    field.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key !== "Enter") return;
      e.preventDefault();
      const r = checkEntry(field.value, { min: Number.MIN_VALUE, max: Number.MAX_VALUE, unit: this.get("unit") || "", format: "%.4g" });
      msg.textContent = r.ok ? "" : "Enter a positive number";
      field.toggleAttribute("aria-invalid", !r.ok);
      if (r.ok && r.value !== undefined) this.setRMax(r.value);
    });
    this.rRow = html("div", { cls: "awi-axes-panel" }, [html("span", { cls: "awi-axis-row" }, [html("b", { text: "r max" }), field]), auto, msg]);
    this.root.appendChild(this.rRow);
    this.svgEl.addEventListener(
      "wheel",
      (e) => {
        if (!this.canZoom) return;
        e.preventDefault();
        this.setRMax(this.shownRMax * ((e as WheelEvent).deltaY < 0 ? 1 / 1.25 : 1.25));
      },
      { passive: false },
    );
  }

  get canZoom(): boolean {
    return !this.get("disabled") && this.stale === "live";
  }

  setRMax(v: number | null): void {
    if (!this.canZoom) return;
    this.model.set("r_max", v);
    this.model.save_changes();
    this.schedule();
  }

  seriesColor(s: Series, i: number): string {
    return safeColor(s.color) || `var(--awi-trace-${i % 8})`;
  }

  override draw(): void {
    const s = this.svgEl;
    clear(s);
    const series = this.get("value");
    if (this.kind === "polar") this.drawPolar(s, series);
    else if (this.kind === "smith") this.drawSmith(s, series);
    else if (this.kind === "radar") this.drawRadar(s, series);
    clear(this.legend);
    setHidden(this.legend, !this.get("show_legend") || !series.length);
    series.forEach((d, i) => {
      const sw = html("span", { cls: "awi-swatch" });
      sw.style.background = this.seriesColor(d, i);
      this.legend.appendChild(html("span", { cls: "awi-legend-item" }, [sw, document.createTextNode(nameOf(d))]));
    });
    const n = series.length;
    setAttr(this.body, "aria-label", `${this.get("label") || this.kind}: ${n} data set${n === 1 ? "" : "s"}${n ? ` (${series.map(nameOf).join(", ")})` : ""}`);
  }

  path(points: Point[], color: string, { closed = false, fill = false, markers = true, line = true, title }: PathOptions = {}): SVGElement {
    const g = svg("g");
    if (line && points.length > 1) {
      const d = points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join("") + (closed ? "Z" : "");
      const p = svg("path", { class: "awi-series-line", d });
      p.style.stroke = color;
      if (fill) {
        p.style.fill = color;
        p.style.fillOpacity = "0.2";
      } else p.style.fill = "none";
      g.appendChild(p);
    }
    if (markers) {
      points.forEach(([x, y], i) => {
        const m = svg("circle", { class: "awi-series-marker", cx: x.toFixed(2), cy: y.toFixed(2), r: 2.4 });
        m.style.fill = color;
        if (title) {
          const t = svg("title");
          t.textContent = title(i);
          m.appendChild(t);
        }
        g.appendChild(m);
      });
    }
    return g;
  }

  // -- polar ----------------------------------------------------------------------------
  drawPolar(s: SVGElement, series: Series[]): void {
    const R = 80;
    const opts: AngleConvention = { unit: this.get("angle_unit"), zero: this.get("zero"), direction: this.get("direction") };
    const rings = this.get("rings") ?? 4;
    let rmax = this.get("r_max") ?? NaN;
    if (!(rmax > 0)) {
      rmax = 0;
      for (const d of series) for (const r of numbers(d.r)) if (Number.isFinite(r)) rmax = Math.max(rmax, Math.abs(r));
      rmax = rmax || 1;
      const t = niceTicks(0, rmax, rings);
      if (t[t.length - 1] < rmax) rmax = t[t.length - 1] + (t[1] - t[0]);
      else rmax = t[t.length - 1];
    }
    this.shownRMax = rmax;
    if (this.rField && document.activeElement !== this.rField) this.rField.value = formatValue(rmax, "%.4g");
    const grid = svg("g", { class: "awi-polar-grid" });
    for (const v of niceTicks(0, rmax, rings).filter((v) => v > 0)) {
      grid.appendChild(svg("circle", { cx: C, cy: C, r: (v / rmax) * R }));
      grid.appendChild(svgText(formatValue(v, "%.3g"), { class: "awi-tick-label", x: C + 2, y: C - (v / rmax) * R - 1 }));
    }
    for (let k = 0; k < 12; k++) {
      const theta = opts.unit === "rad" ? (k * Math.PI) / 6 : k * 30;
      const phi = screenAngle(theta, opts);
      const [x, y] = polarXY(1, phi, R);
      grid.appendChild(svg("line", { x1: C, y1: C, x2: x, y2: y }));
      const [lx, ly] = polarXY(1.12, phi, R);
      const label = opts.unit === "rad" ? `${formatValue(k / 6, "%.3g")}π` : `${k * 30}°`;
      grid.appendChild(svgText(label, { class: "awi-tick-label", x: lx, y: ly, "text-anchor": "middle", "dominant-baseline": "central" }));
    }
    s.appendChild(grid);
    const unit = this.get("unit");
    series.forEach((d, i) => {
      const r = numbers(d.r);
      const th = numbers(d.theta);
      const pts = r.map((v, k) => polarXY(Math.min(1.05, Math.abs(v) / rmax), screenAngle(th[k], opts) + (v < 0 ? 180 : 0), R)).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
      s.appendChild(
        this.path(pts, this.seriesColor(d, i), {
          markers: d.style !== "line",
          line: d.style !== "markers",
          title: (k) => `${nameOf(d)}: ${formatValue(r[k], "%.4g")}${unit ? ` ${unit}` : ""} ∠ ${formatValue(th[k], "%.4g")}${opts.unit === "rad" ? " rad" : "°"}`,
        }),
      );
    });
  }

  // -- smith --------------------------------------------------------------------------------
  drawSmith(s: SVGElement, series: Series[]): void {
    const R = 90;
    const clipId = `${this.id}-smith`;
    const defs = svg("defs", {}, [svg("clipPath", { id: clipId }, [svg("circle", { cx: C, cy: C, r: R })])]);
    s.appendChild(defs);
    const grid = svg("g", { class: "awi-polar-grid awi-smith-grid", "clip-path": `url(#${clipId})` });
    grid.appendChild(svg("circle", { class: "awi-smith-outer", cx: C, cy: C, r: R }));
    grid.appendChild(svg("line", { x1: C - R, y1: C, x2: C + R, y2: C }));
    const values = [0.2, 0.5, 1, 2, 5];
    for (const r of values) {
      // constant-resistance circle: centre r/(1+r), radius 1/(1+r)
      grid.appendChild(svg("circle", { cx: C + (r / (1 + r)) * R, cy: C, r: R / (1 + r) }));
    }
    for (const x of values) {
      for (const sign of [1, -1]) {
        // constant-reactance arc: centre (1, 1/x), radius 1/x
        grid.appendChild(svg("circle", { cx: C + R, cy: C - (sign * R) / x, r: R / x }));
      }
    }
    if (this.get("show_admittance")) {
      for (const g of values) grid.appendChild(svg("circle", { class: "awi-smith-adm", cx: C - (g / (1 + g)) * R, cy: C, r: R / (1 + g) }));
    }
    s.appendChild(grid);
    for (const r of values) {
      s.appendChild(svgText(String(r), { class: "awi-tick-label", x: C + ((r - 1) / (r + 1)) * R + 1, y: C - 2 }));
    }
    for (const x of values) {
      for (const sign of [1, -1]) {
        // intersection of the reactance arc with the unit circle: Γ = (x² - 1 + 2jx)/(x² + 1)
        const re = (x * x - 1) / (x * x + 1);
        const im = (sign * 2 * x) / (x * x + 1);
        s.appendChild(svgText(`${sign > 0 ? "+" : "−"}j${x}`, { class: "awi-tick-label", x: C + re * R * 1.08, y: C - im * R * 1.08, "text-anchor": "middle", "dominant-baseline": "central" }));
      }
    }
    const z0 = this.get("z0") ?? 50;
    series.forEach((d, i) => {
      const re = numbers(d.re);
      const im = numbers(d.im);
      const pts = re.map((v, k): Point => [C + v * R, C - im[k] * R]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
      s.appendChild(
        this.path(pts, this.seriesColor(d, i), {
          markers: d.style !== "line",
          line: d.style !== "markers",
          title: (k) => {
            const [zr, zi] = gammaToZ(re[k], im[k]);
            return `${nameOf(d)}: Z = ${formatValue(zr * z0, "%.4g")} ${zi * z0 < 0 ? "−" : "+"} j${formatValue(Math.abs(zi * z0), "%.4g")} Ω  |Γ| = ${formatValue(Math.hypot(re[k], im[k]), "%.3g")}`;
          },
        }),
      );
    });
  }

  // -- radar ---------------------------------------------------------------------------------
  drawRadar(s: SVGElement, series: Series[]): void {
    const R = 72;
    const axes = this.get("axes") ?? [];
    const values = series.map((d) => numbers(d.values));
    const n = axes.length || Math.max(0, ...values.map((v) => v.length));
    if (n < 3) {
      s.appendChild(svgText("radar needs ≥ 3 axes", { class: "awi-tick-label", x: C, y: C, "text-anchor": "middle" }));
      return;
    }
    const ranges = this.get("ranges") ?? [];
    const range = (k: number): [number, number] => radarRange(ranges, values, k);
    const phi = (k: number): number => 90 - (360 * k) / n;
    const grid = svg("g", { class: "awi-polar-grid" });
    for (const f of [0.25, 0.5, 0.75, 1]) {
      const d = Array.from({ length: n }, (_, k) => polarXY(f, phi(k), R)).map(([x, y], k) => `${k ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join("") + "Z";
      grid.appendChild(svg("path", { d, fill: "none" }));
    }
    for (let k = 0; k < n; k++) {
      const [x, y] = polarXY(1, phi(k), R);
      grid.appendChild(svg("line", { x1: C, y1: C, x2: x, y2: y }));
      const [lx, ly] = polarXY(1.18, phi(k), R);
      grid.appendChild(svgText(String(axes[k] ?? `axis ${k + 1}`), { class: "awi-tick-label awi-radar-axis", x: lx, y: ly, "text-anchor": Math.abs(lx - C) < 5 ? "middle" : lx > C ? "start" : "end", "dominant-baseline": "central" }));
      const [tx, ty] = polarXY(1, phi(k), R);
      grid.appendChild(svgText(formatValue(range(k)[1], "%.3g"), { class: "awi-tick-label awi-radar-max", x: tx + 2, y: ty - 3 }));
    }
    s.appendChild(grid);
    series.forEach((d, i) => {
      const vals = values[i];
      const pts = Array.from({ length: n }, (_, k) => {
        const [lo, hi] = range(k);
        const f = Math.max(0, Math.min(1.05, ((Number.isFinite(vals[k]) ? vals[k] : 0) - lo) / (hi - lo || 1)));
        return polarXY(f, phi(k), R);
      });
      s.appendChild(this.path(pts, this.seriesColor(d, i), { closed: true, fill: !!this.get("fill"), title: (k) => `${nameOf(d)} · ${axes[k] ?? k}: ${formatValue(vals[k], "%.4g")}` }));
    });
  }
}
