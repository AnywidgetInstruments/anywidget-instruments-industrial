// IntensityChart: scrolling colour map (CHART-101).
import { RowRing, rowIndexAt } from "../contract/intensity.js";
import { type BufferLike, toFloat32 } from "../core/buffers.js";
import { setAttr } from "../core/dom.js";
import { formatValue } from "../core/format.js";
import type { AnyModel } from "../core/model.js";
import { type Area, type Colors, PlotView, type Range, type Ranges, type SvgBuilder } from "../core/plot.js";
import { autoscale, niceTicks } from "../core/scale.js";
import type { IntensityChartTraits } from "../generated/contract.js";

// Colormap control points (approximations of matplotlib's maps).
const STOPS: Record<string, string[]> = {
  viridis: ["#440154", "#482878", "#3e4989", "#31688e", "#26828e", "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725"],
  inferno: ["#000004", "#1b0c41", "#4a0c6b", "#781c6d", "#a52c60", "#cf4446", "#ed6925", "#fb9b06", "#f7d13d", "#fcffa4"],
  magma: ["#000004", "#180f3d", "#440f76", "#721f81", "#9e2f7f", "#cd4071", "#f1605d", "#fd9668", "#feca8d", "#fcfdbf"],
  plasma: ["#0d0887", "#46039f", "#7201a8", "#9c179e", "#bd3786", "#d8576b", "#ed7953", "#fb9f3a", "#fdca26", "#f0f921"],
  gray: ["#000000", "#ffffff"],
  jet: ["#00007f", "#0000ff", "#007fff", "#00ffff", "#7fff7f", "#ffff00", "#ff7f00", "#ff0000", "#7f0000"],
};

const lutCache: Record<string, Uint8Array> = {};

/** 256-entry RGB lookup table of a colormap (Uint8Array of 256*3). */
export function colormapLut(name: string): Uint8Array {
  if (lutCache[name]) return lutCache[name];
  const stops = (STOPS[name] || STOPS.viridis).map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const f = (i / 255) * (stops.length - 1);
    const k = Math.min(stops.length - 2, Math.floor(f));
    const u = f - k;
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(stops[k][c] * (1 - u) + stops[k + 1][c] * u);
  }
  lutCache[name] = lut;
  return lut;
}

const TRAITS = ["history", "n_bins", "dt", "y_min", "y_max", "z_min", "z_max", "autoscale_z", "colormap", "show_colorbar"];

export class IntensityView extends PlotView<IntensityChartTraits> {
  zRange: Range;
  readonly image: HTMLCanvasElement;
  ring!: RowRing;
  dirtyAll = true;
  private _lastMap?: string;

  constructor(model: AnyModel<IntensityChartTraits>, el: HTMLElement) {
    super(model, el, TRAITS);
    this.zRange = [this.get("z_min"), this.get("z_max")];
    this.image = document.createElement("canvas");
    this.reset();
    this.listen("msg:custom", (msg: unknown, buffers: unknown) => this.onMessage(msg, buffers as BufferLike[] | undefined));
    this.listen("change:history", () => this.reset());
    this.listen("change:n_bins", () => this.reset());
    this.model.send({ type: "sync_request" });
  }

  get history(): number {
    return this.ring.history;
  }

  get bins(): number {
    return this.ring.bins;
  }

  get total(): number {
    return this.ring.total;
  }

  reset(): void {
    this.ring = new RowRing(this.get("history"), this.get("n_bins"));
    this.image.width = this.ring.history;
    this.image.height = this.ring.bins;
    this.dirtyAll = true;
    this.schedule();
  }

  /** append / snapshot / clear messages (see intensitychart.schema.json). */
  onMessage(msg: unknown, buffers: BufferLike[] | undefined): void {
    if (!msg || typeof msg !== "object") return;
    const m = msg as { type?: unknown; n_rows?: unknown; total?: unknown };
    if (m.type === "clear") return this.reset();
    if (m.type !== "append" && m.type !== "snapshot") return;
    if (m.type === "snapshot") this.reset();
    const n = Math.max(0, Math.floor(Number(m.n_rows) || 0));
    const total = Math.max(n, Math.floor(Number(m.total) || 0));
    this.ring.store(toFloat32(buffers?.[0]), n, total);
    this.dirtyAll = true; // columns shift: rebuild the chronological image
    this.schedule();
  }

  /** Rebuild the chronological image (oldest column on the left). */
  rebuild(): void {
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = this.image.getContext?.("2d") ?? null;
    } catch {
      ctx = null;
    }
    if (!ctx) return;
    const { history, bins } = this;
    const data = this.ring.data;
    const n = Math.min(this.total, history);
    const first = this.total - n;
    if (this.get("autoscale_z")) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        if (Number.isFinite(v)) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      this.zRange = autoscale(this.zRange, lo, hi, { pad: 0 });
    } else {
      this.zRange = [this.get("z_min"), this.get("z_max")];
    }
    const [z0, z1] = this.zRange;
    const lut = colormapLut(this.get("colormap"));
    const img = ctx.createImageData(history, bins);
    const px = img.data;
    const offset = history - n; // right-align the data
    for (let c = 0; c < n; c++) {
      const slot = ((first + c) % history) * bins;
      for (let b = 0; b < bins; b++) {
        const v = data[slot + b];
        const o = ((bins - 1 - b) * history + offset + c) * 4;
        if (!Number.isFinite(v)) continue;
        const k = Math.max(0, Math.min(255, Math.round(((v - z0) / (z1 - z0 || 1)) * 255)));
        px[o] = lut[k * 3];
        px[o + 1] = lut[k * 3 + 1];
        px[o + 2] = lut[k * 3 + 2];
        px[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.dirtyAll = false;
  }

  get dt(): number {
    return this.get("dt") || 1;
  }

  get yRange(): Range {
    const y0 = this.get("y_min");
    const ymax = this.get("y_max");
    return [y0, ymax === null ? y0 + this.bins : ymax];
  }

  override fullRange(): Ranges {
    const t0 = this.total - this.history;
    return { x: [t0 * this.dt, this.total * this.dt], y: this.yRange };
  }

  override area(): Area {
    const a = super.area();
    if (this.get("show_colorbar")) a.w = Math.max(10, a.w - 46);
    return a;
  }

  override cursorText(x: number): string {
    const row = this.ring.row(rowIndexAt(x, this.dt));
    if (!row) return "";
    let best = -Infinity;
    let arg = -1;
    row.forEach((v, b) => {
      if (v > best) {
        best = v;
        arg = b;
      }
    });
    const [y0, y1] = this.yRange;
    return arg < 0 ? "" : `peak ${formatValue(best, "%.3g")} @ ${formatValue(y0 + ((arg + 0.5) * (y1 - y0)) / this.bins, "%.4g")}`;
  }

  override draw(): void {
    const ctx = this.prepareCanvas();
    if (ctx && (this.dirtyAll || this._lastMap !== this.get("colormap") || !this.get("autoscale_z"))) {
      this._lastMap = this.get("colormap");
      this.rebuild();
    }
    setAttr(this.body, "aria-label", `${this.get("label") || "Intensity chart"}: ${this.total} rows, color range ${formatValue(this.zRange[0], "%.3g")} to ${formatValue(this.zRange[1], "%.3g")} ${this.get("unit") || ""}`.trim());
    if (!ctx) return;
    const colors = this.colors();
    const [w, h] = this.get("size");
    ctx.clearRect(0, 0, w, h);
    const area = this.area();
    const r = this.ranges();
    const full = this.fullRange();
    this.drawAxes(ctx, area, r, colors);
    // source rectangle of the zoomed region in image pixels
    const fx = (x: number): number => ((x - full.x[0]) / (full.x[1] - full.x[0])) * this.history;
    const fy = (y: number): number => (1 - (y - full.y[0]) / (full.y[1] - full.y[0])) * this.bins;
    const sx = fx(r.x[0]);
    const sw = fx(r.x[1]) - sx;
    const sy = fy(r.y[1]);
    const sh = fy(r.y[0]) - sy;
    ctx.imageSmoothingEnabled = false;
    if (sw > 0 && sh > 0) ctx.drawImage(this.image, sx, sy, sw, sh, area.x, area.y, area.w, area.h);
    this.drawOverlays(ctx, area, r, colors);
    if (this.get("show_colorbar")) this.drawColorbar(ctx, area, colors);
  }

  drawColorbar(ctx: CanvasRenderingContext2D, area: Area, colors: Colors): void {
    const lut = colormapLut(this.get("colormap"));
    const x = area.x + area.w + 8;
    for (let i = 0; i < area.h; i++) {
      const k = Math.round((1 - i / area.h) * 255);
      ctx.fillStyle = `rgb(${lut[k * 3]},${lut[k * 3 + 1]},${lut[k * 3 + 2]})`;
      ctx.fillRect(x, area.y + i, 10, 1);
    }
    ctx.strokeStyle = colors.fg;
    ctx.strokeRect(x + 0.5, area.y + 0.5, 10, area.h - 1);
    ctx.fillStyle = colors.fg;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const [z0, z1] = this.zRange;
    for (const v of niceTicks(z0, z1, 4)) {
      ctx.fillText(formatValue(v, "%.3g"), x + 13, area.y + area.h - ((v - z0) / (z1 - z0 || 1)) * area.h);
    }
  }

  override csvRows(): Array<Array<string | number>> {
    const [y0, y1] = this.yRange;
    const header = ["x", ...Array.from({ length: this.bins }, (_, b) => formatValue(y0 + ((b + 0.5) * (y1 - y0)) / this.bins, "%.6g"))];
    const rows: Array<Array<string | number>> = [header];
    const n = Math.min(this.total, this.history);
    for (let c = 0; c < n; c++) {
      const i = this.total - n + c;
      rows.push([i * this.dt, ...(this.ring.row(i) ?? [])]);
    }
    return rows;
  }

  override svgContent(area: Area, _r: Ranges, _colors: Colors, el: SvgBuilder): SVGElement[] {
    // embed the rendered colour map as a PNG image inside the SVG
    const c = document.createElement("canvas");
    c.width = Math.round(area.w);
    c.height = Math.round(area.h);
    const ctx = c.getContext?.("2d");
    if (!ctx) return [];
    const [w, h] = this.get("size");
    const kx = this.canvas.width / w;
    const ky = this.canvas.height / h;
    ctx.drawImage(this.canvas, area.x * kx, area.y * ky, area.w * kx, area.h * ky, 0, 0, c.width, c.height);
    return [el("image", { x: area.x, y: area.y, width: area.w, height: area.h, href: c.toDataURL("image/png") })];
  }
}
