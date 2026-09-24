// PolarPlot, SmithChart, RadarChart (SPEC-002..004). SVG rendering.
import { clear, html, safeColor, svg, svgText } from "../core/dom.js";
import { formatValue } from "../core/format.js";
import { niceTicks, parseNumber } from "../core/scale.js";
import { BaseView } from "../core/view.js";

const C = 100; // centre of the 200×200 viewBox

/** Screen angle (degrees, CCW from east) of a data angle. */
export function screenAngle(theta, { unit = "deg", zero = "E", direction = "ccw" } = {}) {
  const deg = unit === "rad" ? (theta * 180) / Math.PI : theta;
  return (zero === "N" ? 90 : 0) + (direction === "cw" ? -deg : deg);
}

/** Γ → normalized impedance z/z0. */
export function gammaToZ(re, im) {
  const den = (1 - re) ** 2 + im ** 2;
  return den === 0 ? [Infinity, 0] : [(1 - re * re - im * im) / den, (2 * im) / den];
}

const polarXY = (rNorm, phiDeg, R) => {
  const a = (phiDeg * Math.PI) / 180;
  return [C + rNorm * R * Math.cos(a), C - rNorm * R * Math.sin(a)];
};

export class PolarView extends BaseView {
  constructor(model, el) {
    super(model, el, ["value", "show_legend", "angle_unit", "zero", "direction", "r_max", "rings", "unit", "z0", "show_admittance", "axes", "ranges", "fill"]);
    this.svgEl = svg("svg", { class: "awi-svg awi-polar", viewBox: "0 0 200 200" });
    this.body.appendChild(this.svgEl);
    this.body.setAttribute("role", "img");
    this.legend = html("div", { cls: "awi-legend" });
    this.root.appendChild(this.legend);
    this.schedule();
  }

  seriesColor(s, i) {
    return safeColor(s.color) || `var(--awi-trace-${i % 8})`;
  }

  draw() {
    const s = this.svgEl;
    clear(s);
    const series = this.get("value") || [];
    ({ polar: () => this.drawPolar(s, series), smith: () => this.drawSmith(s, series), radar: () => this.drawRadar(s, series) })[this.kind]?.();
    clear(this.legend);
    this.legend.hidden = !this.get("show_legend") || !series.length;
    series.forEach((d, i) => {
      const sw = html("span", { cls: "awi-swatch" });
      sw.style.background = this.seriesColor(d, i);
      this.legend.appendChild(html("span", { cls: "awi-legend-item" }, [sw, document.createTextNode(String(d.name ?? ""))]));
    });
    this.body.setAttribute("aria-label", `${this.get("label") || this.kind}: ${series.length} data set${series.length === 1 ? "" : "s"}${series.length ? ` (${series.map((d) => d.name).join(", ")})` : ""}`);
  }

  path(points, color, { closed = false, fill = false, markers = true, line = true, title } = {}) {
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
  drawPolar(s, series) {
    const R = 80;
    const opts = { unit: this.get("angle_unit"), zero: this.get("zero"), direction: this.get("direction") };
    let rmax = parseNumber(this.get("r_max"));
    if (!(rmax > 0)) {
      rmax = 0;
      for (const d of series) for (const r of d.r || []) if (Number.isFinite(r)) rmax = Math.max(rmax, Math.abs(r));
      rmax = rmax || 1;
      const t = niceTicks(0, rmax, this.get("rings"));
      if (t[t.length - 1] < rmax) rmax = t[t.length - 1] + (t[1] - t[0]);
      else rmax = t[t.length - 1];
    }
    const grid = svg("g", { class: "awi-polar-grid" });
    for (const v of niceTicks(0, rmax, this.get("rings")).filter((v) => v > 0)) {
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
      const r = d.r || [];
      const th = d.theta || [];
      const pts = r.map((v, k) => polarXY(Math.min(1.05, Math.abs(v) / rmax), screenAngle(th[k], opts) + (v < 0 ? 180 : 0), R)).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
      s.appendChild(this.path(pts, this.seriesColor(d, i), { markers: d.style !== "line", line: d.style !== "markers", title: (k) => `${d.name}: ${formatValue(r[k], "%.4g")}${unit ? ` ${unit}` : ""} ∠ ${formatValue(th[k], "%.4g")}${opts.unit === "deg" ? "°" : " rad"}` }));
    });
  }

  // -- smith --------------------------------------------------------------------------------
  drawSmith(s, series) {
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
    const z0 = parseNumber(this.get("z0")) || 50;
    series.forEach((d, i) => {
      const re = d.re || [];
      const im = d.im || [];
      const pts = re.map((v, k) => [C + v * R, C - im[k] * R]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
      s.appendChild(this.path(pts, this.seriesColor(d, i), {
        markers: d.style !== "line",
        line: d.style !== "markers",
        title: (k) => {
          const [zr, zi] = gammaToZ(re[k], im[k]);
          return `${d.name}: Z = ${formatValue(zr * z0, "%.4g")} ${zi * z0 < 0 ? "−" : "+"} j${formatValue(Math.abs(zi * z0), "%.4g")} Ω  |Γ| = ${formatValue(Math.hypot(re[k], im[k]), "%.3g")}`;
        },
      }));
    });
  }

  // -- radar ---------------------------------------------------------------------------------
  drawRadar(s, series) {
    const R = 72;
    const axes = this.get("axes") || [];
    const n = axes.length || Math.max(0, ...series.map((d) => (d.values || []).length));
    if (n < 3) {
      s.appendChild(svgText("radar needs ≥ 3 axes", { class: "awi-tick-label", x: C, y: C, "text-anchor": "middle" }));
      return;
    }
    const ranges = this.get("ranges") || [];
    const maxOf = (k) => Math.max(1e-12, ...series.map((d) => Number((d.values || [])[k]) || 0));
    const range = (k) => (ranges[k] ? ranges[k].map(Number) : [0, maxOf(k)]);
    const phi = (k) => 90 - (360 * k) / n;
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
      const [lo, hi] = range(k);
      const [tx, ty] = polarXY(1, phi(k), R);
      grid.appendChild(svgText(formatValue(hi, "%.3g"), { class: "awi-tick-label awi-radar-max", x: tx + 2, y: ty - 3 }));
      void lo;
    }
    s.appendChild(grid);
    series.forEach((d, i) => {
      const vals = d.values || [];
      const pts = Array.from({ length: n }, (_, k) => {
        const [lo, hi] = range(k);
        const f = Math.max(0, Math.min(1.05, ((Number(vals[k]) || 0) - lo) / (hi - lo || 1)));
        return polarXY(f, phi(k), R);
      });
      s.appendChild(this.path(pts, this.seriesColor(d, i), { closed: true, fill: !!this.get("fill"), title: (k) => `${d.name} · ${axes[k] ?? k}: ${formatValue(vals[k], "%.4g")}` }));
    });
  }
}
