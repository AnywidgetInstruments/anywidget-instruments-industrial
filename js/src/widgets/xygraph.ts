// XYGraph: data sets of (x, y) pairs with arbitrary spacing (IND-115).
import { xyValueAt } from "../contract/xy.js";
import { type BufferLike, toFloat64 } from "../core/buffers.js";
import { setAttr } from "anywidget-instruments/js/src/core/dom.js";
import { formatValue } from "../core/format.js";
import type { AnyModel } from "anywidget-instruments/js/src/core/model.js";
import { type Area, type Colors, PlotView, type Range, type Ranges, type SvgBuilder } from "../core/plot.js";
import type { XYGraphTraits } from "../generated/contract.js";
import { drawLegend, traceStyle } from "./chart.js";

const TRAITS = ["series", "x_min", "x_max", "y_min", "y_max", "show_legend"];

interface XYData {
  x: Float64Array;
  y: Float64Array;
}

/** [min, max] of the finite values, padded by 5 %; [0, 1] without any. */
export function dataRange(arrays: ArrayLike<number>[], pad = 0.05): Range {
  let lo = Infinity;
  let hi = -Infinity;
  for (const a of arrays) {
    for (let i = 0; i < a.length; i++) {
      if (!Number.isFinite(a[i])) continue;
      lo = Math.min(lo, a[i]);
      hi = Math.max(hi, a[i]);
    }
  }
  if (!(hi >= lo)) return [0, 1];
  const span = hi - lo || Math.abs(hi) || 1;
  return [lo - pad * span, hi + pad * span];
}

export class XYView extends PlotView<XYGraphTraits> {
  readonly sets = new Map<string, XYData>();

  constructor(model: AnyModel<XYGraphTraits>, el: HTMLElement) {
    super(model, el, TRAITS);
    this.listen("msg:custom", (msg: unknown, buffers: unknown) => this.onMessage(msg, buffers as BufferLike[] | undefined));
    this.model.send({ type: "sync_request" }); // new view: fetch the data sets
  }

  /** data messages (see xygraph.schema.json); sizes are bounded by the buffers received. */
  onMessage(msg: unknown, buffers: BufferLike[] | undefined): void {
    if (!msg || typeof msg !== "object" || (msg as { type?: unknown }).type !== "data") return;
    const m = msg as { clear?: unknown; sets?: unknown };
    if (m.clear) this.sets.clear();
    (Array.isArray(m.sets) ? m.sets : []).forEach((entry: unknown, k: number) => {
      if (!Array.isArray(entry)) return;
      const name = String(entry[0]);
      const n = Math.max(0, Math.floor(Number(entry[1]) || 0));
      const x = toFloat64(buffers?.[2 * k]);
      const y = toFloat64(buffers?.[2 * k + 1]);
      const count = Math.min(n, x.length, y.length);
      this.sets.set(name, { x: x.subarray(0, count), y: y.subarray(0, count) });
    });
    this.schedule();
  }

  /** Listed data sets that have data, in drawing order. */
  shown(): Array<{ name: string; color: string; style: string; width: number; data: XYData }> {
    const colors = this.colors();
    const out = [];
    for (const [j, s] of this.get("series").entries()) {
      const data = this.sets.get(String(s.name));
      if (!data) continue;
      const t = traceStyle(this.get("series"), j, colors);
      out.push({ name: String(s.name ?? ""), color: t.color, style: String(s.style ?? "line"), width: t.width, data });
    }
    return out;
  }

  override fullRange(): Ranges {
    const sets = this.shown();
    const auto = (lim: [number | null, number | null], arrays: Float64Array[]): Range => {
      const r = dataRange(arrays);
      const out: Range = [lim[0] ?? r[0], lim[1] ?? r[1]];
      return out[1] > out[0] ? out : r;
    };
    return {
      x: auto([this.get("x_min"), this.get("x_max")], sets.map((s) => s.data.x)),
      y: auto([this.get("y_min"), this.get("y_max")], sets.map((s) => s.data.y)),
    };
  }

  override cursorText(x: number): string {
    const unit = this.get("unit");
    const vals = this.shown().map((s) => formatValue(xyValueAt(s.data.x, s.data.y, x), "%.4g"));
    return vals.length ? `→ ${vals.join(", ")}${unit ? ` ${unit}` : ""}` : "";
  }

  /** Points of a set in drawing order: sorted by x for lines, steps and bars. */
  points(style: string, d: XYData): Array<[number, number]> {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < d.x.length; i++) pts.push([d.x[i], d.y[i]]);
    if (style === "step" || style === "bar") pts.sort((a, b) => a[0] - b[0]);
    return pts;
  }

  override draw(): void {
    const colors = this.colors();
    const sets = this.shown();
    drawLegend(this.legend, sets.map((s) => ({ name: s.name, color: s.color, width: s.width, visible: true })), this.get("show_legend"));
    const n = sets.reduce((acc, s) => acc + s.data.x.length, 0);
    setAttr(this.body, "aria-label", `${this.get("label") || "XY graph"}: ${sets.length} data set${sets.length === 1 ? "" : "s"}, ${n} points${sets.length ? ` (${sets.map((s) => s.name).join(", ")})` : ""}`);
    const ctx = this.prepareCanvas();
    if (!ctx) return;
    const [w, h] = this.get("size");
    ctx.clearRect(0, 0, w, h);
    const area = this.area();
    const r = this.ranges();
    this.drawAxes(ctx, area, r, colors);
    const { X, Y } = this.mappers(area, r);
    ctx.save();
    ctx.beginPath();
    ctx.rect(area.x, area.y, area.w, area.h);
    ctx.clip();
    const y0 = Y(Math.min(Math.max(0, r.y[0]), r.y[1]));
    for (const s of sets) {
      const pts = this.points(s.style, s.data).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = s.width;
      if (s.style === "bar") {
        const bw = Math.max(2, Math.min(24, (area.w / Math.max(1, pts.length)) * 0.6));
        for (const [x, y] of pts) ctx.fillRect(X(x) - bw / 2, Math.min(Y(y), y0), bw, Math.abs(Y(y) - y0));
        continue;
      }
      if (s.style !== "markers") {
        ctx.beginPath();
        pts.forEach(([x, y], i) => {
          if (i === 0) ctx.moveTo(X(x), Y(y));
          else if (s.style === "step") {
            ctx.lineTo(X(x), Y(pts[i - 1][1]));
            ctx.lineTo(X(x), Y(y));
          } else ctx.lineTo(X(x), Y(y));
        });
        ctx.stroke();
      }
      if (s.style === "markers" || s.style === "both") {
        for (const [x, y] of pts) {
          ctx.beginPath();
          ctx.arc(X(x), Y(y), 3, 0, 2 * Math.PI);
          ctx.fill();
        }
      }
    }
    ctx.restore();
    this.drawOverlays(ctx, area, r, colors);
  }

  override csvRows(): Array<Array<string | number>> {
    const rows: Array<Array<string | number>> = [["set", `x${this.get("x_unit") ? ` (${this.get("x_unit")})` : ""}`, `y${this.get("unit") ? ` (${this.get("unit")})` : ""}`]];
    for (const s of this.shown()) for (let i = 0; i < s.data.x.length; i++) rows.push([s.name, s.data.x[i], s.data.y[i]]);
    return rows;
  }

  override svgContent(area: Area, r: Ranges, _colors: Colors, el: SvgBuilder): SVGElement[] {
    const { X, Y } = this.mappers(area, r);
    const out: SVGElement[] = [];
    for (const s of this.shown()) {
      const pts = this.points(s.style, s.data).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
      if (s.style !== "markers" && s.style !== "bar") {
        const d = pts.map(([x, y], i) => (i === 0 ? `M${X(x).toFixed(1)} ${Y(y).toFixed(1)}` : s.style === "step" ? `L${X(x).toFixed(1)} ${Y(pts[i - 1][1]).toFixed(1)}L${X(x).toFixed(1)} ${Y(y).toFixed(1)}` : `L${X(x).toFixed(1)} ${Y(y).toFixed(1)}`)).join("");
        out.push(el("path", { d, fill: "none", stroke: s.color, "stroke-width": s.width }));
      }
      if (s.style === "bar") {
        const y0 = Y(Math.min(Math.max(0, r.y[0]), r.y[1]));
        const bw = Math.max(2, Math.min(24, (area.w / Math.max(1, pts.length)) * 0.6));
        for (const [x, y] of pts) out.push(el("rect", { x: (X(x) - bw / 2).toFixed(1), y: Math.min(Y(y), y0).toFixed(1), width: bw.toFixed(1), height: Math.abs(Y(y) - y0).toFixed(1), fill: s.color }));
      }
      if (s.style === "markers" || s.style === "both") {
        for (const [x, y] of pts) out.push(el("circle", { cx: X(x).toFixed(1), cy: Y(y).toFixed(1), r: 3, fill: s.color }));
      }
    }
    return out;
  }
}
