// WaveformChart: canvas strip chart fed with binary float32 buffers (CHART-001..009).
import { toFloat32 } from "../core/buffers.js";
import { clear, html, safeColor } from "../core/dom.js";
import { formatValue } from "../core/format.js";
import { PlotView } from "../core/plot.js";
import { autoscale, parseNumber } from "../core/scale.js";

const TRAITS = ["history", "n_traces", "update_mode", "y_min", "y_max", "autoscale_y", "paused", "dt", "traces", "show_legend"];

/** Ring buffer of `capacity` rows × `k` traces, stored trace-major. */
export class Ring {
  constructor(capacity, k) {
    this.capacity = capacity;
    this.k = k;
    this.data = Array.from({ length: k }, () => new Float32Array(capacity).fill(NaN));
    this.total = 0;
  }

  /** Append rows from a row-major Float32Array of n rows. */
  push(rows, n) {
    const { capacity, k } = this;
    const skip = Math.max(0, n - capacity);
    for (let i = skip; i < n; i++) {
      const slot = (this.total + i) % capacity;
      for (let j = 0; j < k; j++) this.data[j][slot] = rows[i * k + j];
    }
    this.total += n;
  }

  /** Value of trace j at absolute sample index idx (NaN if no longer buffered). */
  at(j, idx) {
    if (idx < 0 || idx >= this.total || idx < this.total - this.capacity) return NaN;
    return this.data[j][idx % this.capacity];
  }
}

/**
 * Absolute sample window [start, end) displayed for an update mode, plus the
 * x position (in samples from the left edge) of each index.
 */
export function viewWindow(mode, total, history) {
  if (mode === "scope") {
    const start = total === 0 ? 0 : Math.floor((total - 1) / history) * history;
    return { start, end: total, xOf: (i) => i - start, cursor: null };
  }
  if (mode === "sweep") {
    const start = Math.max(0, total - history);
    const cursor = total % history;
    return { start, end: total, xOf: (i) => i % history, cursor };
  }
  const start = Math.max(0, total - history);
  return { start, end: total, xOf: (i) => i - (total - history), cursor: null };
}

/** Legend with one entry per trace. */
export function drawLegend(legend, entries, show) {
  clear(legend);
  legend.hidden = !show || entries.length < 2;
  if (legend.hidden) return;
  for (const t of entries) {
    const sw = html("span", { cls: "awi-swatch" });
    sw.style.background = t.color;
    legend.appendChild(html("span", { cls: t.visible ? "awi-legend-item" : "awi-legend-item awi-hidden-trace" }, [sw, document.createTextNode(t.name)]));
  }
}

export function traceStyle(model, j, colors) {
  const t = (model.get("traces") || [])[j] || {};
  return {
    name: typeof t.name === "string" ? t.name : `trace ${j}`,
    color: safeColor(t.color) || colors.trace(j),
    width: Number(t.width) > 0 ? Number(t.width) : 1.5,
    visible: t.visible !== false,
  };
}

export class ChartView extends PlotView {
  constructor(model, el) {
    super(model, el, TRAITS);
    this.yRange = [parseNumber(this.get("y_min")), parseNumber(this.get("y_max"))];
    this.frozen = null; // ring snapshot while paused (CHART-009)
    this.resetRing();
    this.listen("msg:custom", (msg, buffers) => this.onMessage(msg, buffers));
    this.listen("change:history", () => this.resync());
    this.listen("change:n_traces", () => this.resync());
    this.listen("change:paused", () => {
      this.frozen = this.get("paused") ? this.snapshotRing() : null;
    });
    this.model.send({ type: "sync_request" }); // new view: fetch the kernel history (ROB-005)
  }

  resetRing() {
    this.ring = new Ring(Math.max(2, this.get("history")), Math.max(1, this.get("n_traces")));
  }

  resync() {
    this.resetRing();
    this.schedule();
  }

  snapshotRing() {
    const r = this.ring;
    const copy = new Ring(r.capacity, r.k);
    copy.data = r.data.map((d) => d.slice());
    copy.total = r.total;
    return copy;
  }

  onMessage(msg, buffers) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "clear") {
      this.resetRing();
    } else if (msg.type === "snapshot") {
      this.resetRing();
      this.ring.total = Math.max(0, msg.total - msg.n_points);
      this.ring.push(toFloat32(buffers?.[0]), msg.n_points);
    } else if (msg.type === "append") {
      const expected = msg.total - msg.n_points;
      // samples discarded by the kernel (n > history) keep the absolute count right
      if (this.ring.total < expected) this.ring.total = expected;
      this.ring.push(toFloat32(buffers?.[0]), msg.n_points);
    } else {
      return;
    }
    this.schedule();
  }

  get view() {
    return this.frozen || this.ring;
  }

  get dt() {
    return parseNumber(this.get("dt")) || 1;
  }

  /** x-axis position (axis units) of absolute sample i. */
  axisX(i) {
    const ring = this.view;
    return (this.get("update_mode") === "sweep" ? i % ring.capacity : i) * this.dt;
  }

  fullRange() {
    const ring = this.view;
    const history = ring.capacity;
    const win = viewWindow(this.get("update_mode"), ring.total, history);
    const mode = this.get("update_mode");
    const x0 = mode === "strip" ? ring.total - history : mode === "scope" ? win.start : 0;
    if (this.get("autoscale_y")) {
      let lo = Infinity;
      let hi = -Infinity;
      const colors = this._colors || this.colors();
      for (let j = 0; j < ring.k; j++) {
        if (!traceStyle(this.model, j, colors).visible) continue;
        for (let i = win.start; i < win.end; i++) {
          const v = ring.at(j, i);
          if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
        }
      }
      this.yRange = autoscale(this.yRange, lo, hi);
    } else {
      this.yRange = [parseNumber(this.get("y_min")), parseNumber(this.get("y_max"))];
    }
    return { x: [x0 * this.dt, (x0 + history) * this.dt], y: this.yRange };
  }

  /** Iterate the displayed samples of trace j: cb(axisX, value, breakBefore). */
  forEachSample(j, r, cb) {
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

  cursorText(x) {
    const ring = this.view;
    let i = x / this.dt;
    if (this.get("update_mode") === "sweep" && ring.total) {
      const last = ring.total - 1;
      i = last - ((((last - i) % ring.capacity) + ring.capacity) % ring.capacity);
    }
    const i0 = Math.floor(i);
    const f = i - i0;
    const vals = [];
    for (let j = 0; j < ring.k; j++) {
      const a = ring.at(j, i0);
      const b = ring.at(j, i0 + 1);
      vals.push(formatValue(Number.isFinite(b) ? a * (1 - f) + b * f : a, "%.4g"));
    }
    return `→ ${vals.join(", ")}${this.get("unit") ? ` ${this.get("unit")}` : ""}`;
  }

  draw() {
    const ctx = this.prepareCanvas();
    if (!ctx) return;
    const colors = (this._colors = this.colors());
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
    const ring = this.view;
    for (let j = 0; j < ring.k; j++) {
      const t = traceStyle(this.model, j, colors);
      if (!t.visible) continue;
      ctx.strokeStyle = t.color;
      ctx.lineWidth = t.width;
      ctx.beginPath();
      let pen = false;
      // min/max decimation bucket (one per pixel column)
      let col = null;
      let lo = 0;
      let hi = 0;
      const flush = () => {
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
        if (!pen) { ctx.moveTo(x, Y(v)); pen = true; return; }
        if (perPixel <= 2) { ctx.lineTo(x, Y(v)); return; }
        const c = Math.floor(x);
        if (c !== col) { flush(); col = c; lo = v; hi = v; }
        else { if (v < lo) lo = v; if (v > hi) hi = v; }
      });
      flush();
      ctx.stroke();
    }
    const win = viewWindow(this.get("update_mode"), ring.total, ring.capacity);
    if (win.cursor !== null && !this.get("paused")) {
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 1;
      const x = Math.round(X(win.cursor * this.dt)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, area.y); ctx.lineTo(x, area.y + area.h); ctx.stroke();
    }
    ctx.restore();
    this.drawOverlays(ctx, area, r, colors);
    if (this.get("paused")) {
      ctx.fillStyle = colors.accent;
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText("❚❚ PAUSED", area.x + area.w - 6, area.y + 4);
    }
    drawLegend(this.legend, Array.from({ length: ring.k }, (_, j) => traceStyle(this.model, j, colors)), this.get("show_legend"));
    const latest = Array.from({ length: ring.k }, (_, j) => formatValue(this.ring.at(j, this.ring.total - 1), "%.4g"));
    this.body.setAttribute("aria-label", `${this.get("label") || "Waveform chart"}: latest ${latest.join(", ")} ${this.get("unit") || ""}`.trim());
  }

  csvRows() {
    const ring = this.view;
    const colors = this.colors();
    const header = [`x${this.get("x_unit") ? ` (${this.get("x_unit")})` : ""}`, ...Array.from({ length: ring.k }, (_, j) => traceStyle(this.model, j, colors).name)];
    const r = this.ranges();
    const rows = [header];
    const cols = Array.from({ length: ring.k }, () => []);
    const xs = [];
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

  svgContent(area, r, colors, el) {
    const { X, Y } = this.mappers(area, r);
    const out = [];
    for (let j = 0; j < this.view.k; j++) {
      const t = traceStyle(this.model, j, colors);
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
