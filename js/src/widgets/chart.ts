// WaveformChart: canvas strip chart fed with binary float32 buffers (CHART-001..009).
import { Ring, valuesAt, viewWindow } from "../contract/waveform.js";
import { type BufferLike, toFloat32 } from "../core/buffers.js";
import { clear, html, safeColor, setAttr } from "../core/dom.js";
import { formatValue } from "../core/format.js";
import type { AnyModel } from "../core/model.js";
import { type Area, type Colors, PlotView, type Ranges, type SvgBuilder } from "../core/plot.js";
import { autoscale } from "../core/scale.js";
import type { WaveformChartTraits } from "../generated/contract.js";

export { Ring, viewWindow };

const TRAITS = ["history", "n_traces", "update_mode", "y_min", "y_max", "autoscale_y", "paused", "dt", "traces", "show_legend"];

export interface TraceStyle {
  name: string;
  color: string;
  width: number;
  visible: boolean;
}

/** Legend with one entry per trace. */
export function drawLegend(legend: HTMLElement, entries: TraceStyle[], show: unknown): void {
  clear(legend);
  legend.hidden = !show || entries.length < 2;
  if (legend.hidden) return;
  for (const t of entries) {
    const sw = html("span", { cls: "awi-swatch" });
    sw.style.background = t.color;
    legend.appendChild(html("span", { cls: t.visible ? "awi-legend-item" : "awi-legend-item awi-hidden-trace" }, [sw, document.createTextNode(t.name)]));
  }
}

/** Style of trace j from the `traces` trait, with defaults. */
export function traceStyle(traces: unknown, j: number, colors: Pick<Colors, "trace">): TraceStyle {
  const all = Array.isArray(traces) ? traces : [];
  const t = (all[j] && typeof all[j] === "object" ? all[j] : {}) as { name?: unknown; color?: unknown; width?: unknown; visible?: unknown };
  return {
    name: typeof t.name === "string" ? t.name : `trace ${j}`,
    color: safeColor(t.color) || colors.trace(j),
    width: Number(t.width) > 0 ? Number(t.width) : 1.5,
    visible: t.visible !== false,
  };
}

interface ChartMessage {
  type?: unknown;
  n_points?: unknown;
  total?: unknown;
}

export class ChartView extends PlotView<WaveformChartTraits> {
  yRange: [number, number];
  /** Ring snapshot while paused (CHART-009). */
  frozen: Ring | null = null;
  ring!: Ring;
  _colors?: Colors;

  constructor(model: AnyModel<WaveformChartTraits>, el: HTMLElement) {
    super(model, el, TRAITS);
    this.yRange = [this.get("y_min"), this.get("y_max")];
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
    if (this.get("autoscale_y")) {
      let lo = Infinity;
      let hi = -Infinity;
      const colors = this._colors || this.colors();
      for (let j = 0; j < ring.k; j++) {
        if (!this.style(j, colors).visible) continue;
        for (let i = win.start; i < win.end; i++) {
          const v = ring.at(j, i);
          if (Number.isFinite(v)) {
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        }
      }
      this.yRange = autoscale(this.yRange, lo, hi) as [number, number];
    } else {
      this.yRange = [this.get("y_min"), this.get("y_max")];
    }
    return { x: [x0 * this.dt, (x0 + history) * this.dt], y: this.yRange };
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
    const vals = valuesAt(this.view, x, { mode: this.get("update_mode"), dt: this.dt }).map((v) => formatValue(v, "%.4g"));
    const unit = this.get("unit");
    return `→ ${vals.join(", ")}${unit ? ` ${unit}` : ""}`;
  }

  override draw(): void {
    const ring = this.view;
    const colors = (this._colors = this.colors());
    const latest = Array.from({ length: this.ring.k }, (_, j) => formatValue(this.ring.at(j, this.ring.total - 1), "%.4g"));
    setAttr(this.body, "aria-label", `${this.get("label") || "Waveform chart"}: latest ${latest.join(", ")} ${this.get("unit") || ""}`.trim());
    drawLegend(this.legend, Array.from({ length: ring.k }, (_, j) => this.style(j, colors)), this.get("show_legend"));
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
    const perPixel = (r.x[1] - r.x[0]) / this.dt / area.w;
    for (let j = 0; j < ring.k; j++) {
      const t = this.style(j, colors);
      if (!t.visible) continue;
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
        if (!Number.isFinite(v) || brk) {
          flush();
          pen = false;
          if (!Number.isFinite(v)) return;
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
    const { X, Y } = this.mappers(area, r);
    const out: SVGElement[] = [];
    for (let j = 0; j < this.view.k; j++) {
      const t = this.style(j, colors);
      if (!t.visible) continue;
      let d = "";
      let pen = false;
      this.forEachSample(j, r, (ax, v, brk) => {
        if (!Number.isFinite(v) || brk) pen = false;
        if (!Number.isFinite(v)) return;
        d += `${pen ? "L" : "M"}${X(ax).toFixed(1)} ${Y(v).toFixed(1)}`;
        pen = true;
      });
      out.push(el("path", { d, fill: "none", stroke: t.color, "stroke-width": t.width }));
    }
    return out;
  }
}
