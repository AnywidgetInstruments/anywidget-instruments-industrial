// WaveformChart: canvas strip chart fed with binary float32 buffers (CHART-001..009).
import { Ring, valuesAt, viewWindow } from "../contract/waveform.js";
import { type BufferLike, toFloat32 } from "../core/buffers.js";
import { clear, html, safeColor, setAttr } from "anywidget-instruments/js/src/core/dom.js";
import { formatValue } from "../core/format.js";
import type { AnyModel } from "anywidget-instruments/js/src/core/model.js";
import { type Area, type Colors, linearYAt, PlotView, type Range, type Ranges, type SvgBuilder, zoomedRanges } from "../core/plot.js";
import { autoscale, logAt, logFrac, logRange, logTicks, niceTicks } from "anywidget-instruments/js/src/core/scale.js";
import type { WaveformChartTraits } from "../generated/contract.js";

export { Ring, viewWindow };

const TRAITS = ["history", "n_traces", "update_mode", "y_min", "y_max", "autoscale_y", "paused", "dt", "traces", "show_legend", "y_scale", "y2_min", "y2_max", "autoscale_y2", "y2_unit"];

export interface TraceStyle {
  name: string;
  color: string;
  width: number;
  visible: boolean;
  /** Drawn against the secondary axis on the right (IND-117). */
  right?: boolean;
}

/** Legend with one entry per trace. */
export function drawLegend(legend: HTMLElement, entries: TraceStyle[], show: unknown): void {
  clear(legend);
  legend.hidden = !show || entries.length < 2;
  if (legend.hidden) return;
  for (const t of entries) {
    const sw = html("span", { cls: "awi-swatch" });
    sw.style.background = t.color;
    const name = t.right ? `${t.name} (right axis)` : t.name;
    legend.appendChild(html("span", { cls: t.visible ? "awi-legend-item" : "awi-legend-item awi-hidden-trace" }, [sw, document.createTextNode(name)]));
  }
}

/** Style of trace j from the `traces` trait, with defaults. */
export function traceStyle(traces: unknown, j: number, colors: Pick<Colors, "trace">): TraceStyle {
  const all = Array.isArray(traces) ? traces : [];
  const t = (all[j] && typeof all[j] === "object" ? all[j] : {}) as { name?: unknown; color?: unknown; width?: unknown; visible?: unknown; axis?: unknown };
  return {
    name: typeof t.name === "string" ? t.name : `trace ${j}`,
    color: safeColor(t.color) || colors.trace(j),
    width: Number(t.width) > 0 ? Number(t.width) : 1.5,
    visible: t.visible !== false,
    right: t.axis === "right",
  };
}

interface ChartMessage {
  type?: unknown;
  n_points?: unknown;
  total?: unknown;
}

export class ChartView extends PlotView<WaveformChartTraits> {
  yRange: [number, number];
  /** Range of the secondary axis, at full view (IND-117). */
  y2Range: [number, number];
  /** Full ranges of the last ranges() call (the secondary axis follows the Y zoom). */
  full: Ranges = { x: [0, 1], y: [0, 1] };
  /** Ring snapshot while paused (CHART-009). */
  frozen: Ring | null = null;
  ring!: Ring;
  _colors?: Colors;

  constructor(model: AnyModel<WaveformChartTraits>, el: HTMLElement) {
    super(model, el, TRAITS);
    this.yRange = [this.get("y_min"), this.get("y_max")];
    this.y2Range = [this.get("y2_min"), this.get("y2_max")];
    this.resetRing();
    this.listen("msg:custom", (msg: unknown, buffers: unknown) => this.onMessage(msg, buffers as BufferLike[] | undefined));
    this.listen("change:history", () => this.resync());
    this.listen("change:n_traces", () => this.resync());
    this.listen("change:paused", () => {
      this.frozen = this.get("paused") ? this.ring.copy() : null;
    });
    this.model.send({ type: "sync_request" }); // new view: fetch the host history (ROB-005)
  }

  resetRing(): void {
    this.ring = new Ring(this.get("history"), this.get("n_traces"));
  }

  resync(): void {
    this.resetRing();
    this.schedule();
  }

  /** append / snapshot / clear messages (see waveformchart.schema.json). */
  onMessage(msg: unknown, buffers: BufferLike[] | undefined): void {
    if (!msg || typeof msg !== "object") return;
    const m = msg as ChartMessage;
    const n = Math.max(0, Math.floor(Number(m.n_points) || 0));
    const total = Math.max(0, Math.floor(Number(m.total) || 0));
    // at most the rows the buffer holds (a short buffer never reads past its end)
    const rows = (): [Float32Array, number] => {
      const data = toFloat32(buffers?.[0]);
      return [data, Math.min(n, Math.floor(data.length / this.ring.k))];
    };
    if (m.type === "clear") {
      this.resetRing();
    } else if (m.type === "snapshot") {
      this.resetRing();
      const [data, k] = rows();
      this.ring.total = Math.max(0, total - n);
      this.ring.push(data, k);
    } else if (m.type === "append") {
      const [data, k] = rows();
      // samples discarded by the host (n > history) keep the absolute count right
      if (this.ring.total < total - n) this.ring.total = total - n;
      this.ring.push(data, k);
    } else {
      return;
    }
    this.schedule();
  }

  get view(): Ring {
    return this.frozen || this.ring;
  }

  get dt(): number {
    return this.get("dt") || 1;
  }

  style(j: number, colors: Colors): TraceStyle {
    return traceStyle(this.get("traces"), j, colors);
  }

  /** x-axis position (axis units) of absolute sample i. */
  axisX(i: number): number {
    const ring = this.view;
    return (this.get("update_mode") === "sweep" ? i % ring.capacity : i) * this.dt;
  }

  override fullRange(): Ranges {
    const ring = this.view;
    const history = ring.capacity;
    const mode = this.get("update_mode");
    const win = viewWindow(mode, ring.total, history);
    const x0 = mode === "strip" ? ring.total - history : mode === "scope" ? win.start : 0;
    const log = this.isLog;
    const colors = this._colors || this.colors();
    /** Extent of the visible traces on one axis (positive values only on a log axis). */
    const extent = (right: boolean): [number, number] => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let j = 0; j < ring.k; j++) {
        const t = this.style(j, colors);
        if (!t.visible || t.right !== right) continue;
        for (let i = win.start; i < win.end; i++) {
          const v = ring.at(j, i);
          if (Number.isFinite(v) && (right || !log || v > 0)) {
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        }
      }
      return [lo, hi];
    };
    if (this.get("autoscale_y")) {
      const [lo, hi] = extent(false);
      if (log) this.yRange = Number.isFinite(lo) ? logRange(lo, hi, true) : logRange(this.get("y_min"), this.get("y_max"));
      else this.yRange = autoscale(this.yRange, lo, hi) as [number, number];
    } else {
      const lo = this.get("y_min");
      const hi = this.get("y_max");
      this.yRange = log ? logRange(lo, hi) : [lo, hi];
    }
    if (this.hasRightAxis(colors) && this.get("autoscale_y2")) {
      const [lo, hi] = extent(true);
      this.y2Range = autoscale(this.y2Range, lo, hi) as [number, number];
    } else {
      this.y2Range = [this.get("y2_min"), this.get("y2_max")];
    }
    return { x: [x0 * this.dt, (x0 + history) * this.dt], y: this.yRange };
  }

  get isLog(): boolean {
    return this.get("y_scale") === "log";
  }

  hasRightAxis(colors: Colors = this._colors || this.colors()): boolean {
    for (let j = 0; j < this.view.k; j++) if (this.style(j, colors).right) return true;
    return false;
  }

  override area(): Area {
    this.margin.right = this.hasRightAxis() ? 52 : 12;
    return super.area();
  }

  override ranges(): Ranges {
    this.full = this.fullRange();
    return zoomedRanges(this.full, this.zoom);
  }

  override yFrac(y: number, range: Range): number {
    return this.isLog ? logFrac(y, range) : super.yFrac(y, range);
  }

  override yAt(range: Range, f: number): number {
    return this.isLog ? logAt(range, f) : super.yAt(range, f);
  }

  override yTicks(a: number, b: number): number[] {
    return this.isLog ? logTicks(a, b) : super.yTicks(a, b);
  }

  /** Displayed range of the secondary axis: its full range cut as the Y zoom cuts the left one. */
  y2Shown(r: Ranges): Range {
    const f0 = this.yFrac(r.y[0], this.full.y);
    const f1 = this.yFrac(r.y[1], this.full.y);
    if (!Number.isFinite(f0) || !Number.isFinite(f1)) return this.y2Range;
    return [linearYAt(this.y2Range, f0), linearYAt(this.y2Range, f1)];
  }

  /** Pixel y of each trace: the left axis, or the linear secondary axis (IND-117). */
  traceY(area: Area, r: Ranges, t: TraceStyle): (v: number) => number {
    if (!t.right) return this.mappers(area, r).Y;
    const y2 = this.y2Shown(r);
    return (v) => area.y + area.h - ((v - y2[0]) / (y2[1] - y2[0] || 1)) * area.h;
  }

  /** Ticks of the secondary axis with their pixel y. */
  y2Ticks(area: Area, r: Ranges): Array<[number, number]> {
    const y2 = this.y2Shown(r);
    const Y = this.traceY(area, r, { name: "", color: "", width: 1, visible: true, right: true });
    return niceTicks(Math.min(y2[0], y2[1]), Math.max(y2[0], y2[1]), 4).map((v) => [v, Y(v)]);
  }

  /** Whether sample v of a trace can be drawn (a log axis has no value <= 0). */
  drawable(v: number, t: TraceStyle): boolean {
    return Number.isFinite(v) && (t.right || !this.isLog || v > 0);
  }

  override drawAxes(ctx: CanvasRenderingContext2D, area: Area, r: Ranges, colors: Colors, opts: { yTicks?: boolean } = {}): void {
    super.drawAxes(ctx, area, r, colors, opts);
    if (!this.hasRightAxis(colors)) return;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = colors.fg;
    ctx.strokeStyle = colors.fg;
    const x = area.x + area.w;
    for (const [v, y] of this.y2Ticks(area, r)) {
      if (y < area.y - 1 || y > area.y + area.h + 1) continue;
      ctx.beginPath();
      ctx.moveTo(x, Math.round(y) + 0.5);
      ctx.lineTo(x + 4, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.fillText(formatValue(v, "%.3g"), x + 6, y);
    }
    const unit = this.get("y2_unit");
    if (unit) {
      ctx.textBaseline = "bottom";
      ctx.textAlign = "right";
      ctx.fillText(unit, area.x + area.w + this.margin.right - 2, area.y + area.h + this.margin.bottom - 2);
    }
  }

  override buildSvg(): SVGElement {
    const root = super.buildSvg();
    const area = this.area();
    const r = this.ranges();
    if (!this.hasRightAxis()) return root;
    const NS = "http://www.w3.org/2000/svg";
    for (const [v, y] of this.y2Ticks(area, r)) {
      const t = document.createElementNS(NS, "text");
      for (const [k, a] of Object.entries({ x: area.x + area.w + 6, y, "dominant-baseline": "middle", fill: this.colors().fg })) t.setAttribute(k, String(a));
      t.textContent = formatValue(v, "%.3g");
      root.appendChild(t);
    }
    return root;
  }

  /** Iterate the displayed samples of trace j: cb(axisX, value, breakBefore). */
  forEachSample(j: number, r: Ranges, cb: (ax: number, v: number, brk: boolean) => void): void {
    const ring = this.view;
    const mode = this.get("update_mode");
    const win = viewWindow(mode, ring.total, ring.capacity);
    const i0 = Math.max(win.start, Math.floor(r.x[0] / this.dt) - 1);
    const i1 = Math.min(win.end, Math.ceil(r.x[1] / this.dt) + 2);
    const all = mode === "sweep";
    for (let i = all ? win.start : i0; i < (all ? win.end : i1); i++) {
      cb(this.axisX(i), ring.at(j, i), mode === "sweep" && i > win.start && i % ring.capacity === 0);
    }
  }

  override cursorText(x: number): string {
    const colors = this._colors || this.colors();
    const unit = this.get("unit");
    const vals = valuesAt(this.view, x, { mode: this.get("update_mode"), dt: this.dt }).map((v) => formatValue(v, "%.4g"));
    if (!this.hasRightAxis(colors)) return `→ ${vals.join(", ")}${unit ? ` ${unit}` : ""}`;
    const y2Unit = this.get("y2_unit");
    const withUnit = (v: string, u: string): string => (u ? `${v} ${u}` : v);
    return `→ ${vals.map((v, j) => withUnit(v, this.style(j, colors).right ? y2Unit : unit)).join(", ")}`;
  }

  override draw(): void {
    const ring = this.view;
    const colors = (this._colors = this.colors());
    const latest = Array.from({ length: this.ring.k }, (_, j) => formatValue(this.ring.at(j, this.ring.total - 1), "%.4g"));
    setAttr(this.body, "aria-label", `${this.get("label") || "Waveform chart"}: latest ${latest.join(", ")} ${this.get("unit") || ""}`.trim());
    const styles = Array.from({ length: ring.k }, (_, j) => this.style(j, colors));
    drawLegend(this.legend, styles, this.get("show_legend"));
    const ctx = this.prepareCanvas();
    if (!ctx) return;
    const [w, h] = this.get("size");
    ctx.clearRect(0, 0, w, h);
    const area = this.area();
    const r = this.ranges();
    this.drawAxes(ctx, area, r, colors);
    const { X } = this.mappers(area, r);
    ctx.save();
    ctx.beginPath();
    ctx.rect(area.x, area.y, area.w, area.h);
    ctx.clip();
    const perPixel = (r.x[1] - r.x[0]) / this.dt / area.w;
    for (let j = 0; j < ring.k; j++) {
      const t = styles[j];
      if (!t.visible) continue;
      const Y = this.traceY(area, r, t);
      ctx.strokeStyle = t.color;
      ctx.lineWidth = t.width;
      ctx.beginPath();
      let pen = false;
      // min/max decimation bucket (one per pixel column)
      let col: number | null = null;
      let lo = 0;
      let hi = 0;
      const flush = (): void => {
        if (col === null) return;
        ctx.lineTo(col + 0.5, Y(lo));
        if (hi !== lo) ctx.lineTo(col + 0.5, Y(hi));
        col = null;
      };
      this.forEachSample(j, r, (ax, v, brk) => {
        const ok = this.drawable(v, t);
        if (!ok || brk) {
          flush();
          pen = false;
          if (!ok) return;
        }
        const x = X(ax);
        if (!pen) {
          ctx.moveTo(x, Y(v));
          pen = true;
          return;
        }
        if (perPixel <= 2) {
          ctx.lineTo(x, Y(v));
          return;
        }
        const c = Math.floor(x);
        if (c !== col) {
          flush();
          col = c;
          lo = v;
          hi = v;
        } else {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      });
      flush();
      ctx.stroke();
    }
    const win = viewWindow(this.get("update_mode"), ring.total, ring.capacity);
    if (win.cursor !== null && !this.get("paused")) {
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 1;
      const x = Math.round(X(win.cursor * this.dt)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, area.y);
      ctx.lineTo(x, area.y + area.h);
      ctx.stroke();
    }
    ctx.restore();
    this.drawOverlays(ctx, area, r, colors);
    if (this.get("paused")) {
      ctx.fillStyle = colors.accent;
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText("❚❚ PAUSED", area.x + area.w - 6, area.y + 4);
    }
  }

  override csvRows(): Array<Array<string | number>> {
    const ring = this.view;
    const colors = this.colors();
    const unit = this.get("x_unit");
    const header = [`x${unit ? ` (${unit})` : ""}`, ...Array.from({ length: ring.k }, (_, j) => this.style(j, colors).name)];
    const r = this.ranges();
    const rows: Array<Array<string | number>> = [header];
    const cols: number[][] = Array.from({ length: ring.k }, () => []);
    const xs: number[] = [];
    for (let j = 0; j < ring.k; j++) {
      this.forEachSample(j, r, (ax, v) => {
        if (ax < r.x[0] || ax > r.x[1]) return;
        if (j === 0) xs.push(ax);
        cols[j].push(v);
      });
    }
    xs.forEach((x, n) => rows.push([x, ...cols.map((c) => c[n])]));
    return rows;
  }

  override svgContent(area: Area, r: Ranges, colors: Colors, el: SvgBuilder): SVGElement[] {
    const { X } = this.mappers(area, r);
    const out: SVGElement[] = [];
    for (let j = 0; j < this.view.k; j++) {
      const t = this.style(j, colors);
      if (!t.visible) continue;
      const Y = this.traceY(area, r, t);
      let d = "";
      let pen = false;
      this.forEachSample(j, r, (ax, v, brk) => {
        const ok = this.drawable(v, t);
        if (!ok || brk) pen = false;
        if (!ok) return;
        d += `${pen ? "L" : "M"}${X(ax).toFixed(1)} ${Y(v).toFixed(1)}`;
        pen = true;
      });
      out.push(el("path", { d, fill: "none", stroke: t.color, "stroke-width": t.width }));
    }
    return out;
  }
}
