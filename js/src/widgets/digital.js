// DigitalWaveformGraph (CHART-102) and MixedSignalGraph (CHART-103).
import { toFloat32, toUint8 } from "../core/buffers.js";
import { formatValue } from "../core/format.js";
import { PlotView } from "../core/plot.js";
import { autoscale, niceTicks, parseNumber } from "../core/scale.js";
import { drawLegend, traceStyle } from "./chart.js";

const TRAITS = ["lines", "buses", "dt", "x0", "show_lines_in_bus", "traces", "y_min", "y_max", "analog_fraction"];

/** Integer value of a bus (first listed line = MSB) at sample i. */
export function busValue(bits, nLines, lines, i) {
  let v = 0;
  for (const l of lines) v = v * 2 + (bits[i * nLines + l] ? 1 : 0);
  return v;
}

/** Runs of constant value: [{ start, end, value }] over samples [i0, i1). */
export function runs(valueAt, i0, i1) {
  const out = [];
  if (i1 <= i0) return out;
  let start = i0;
  let cur = valueAt(i0);
  for (let i = i0 + 1; i < i1; i++) {
    const v = valueAt(i);
    if (v !== cur) {
      out.push({ start, end: i, value: cur });
      start = i;
      cur = v;
    }
  }
  out.push({ start, end: i1, value: cur });
  return out;
}

export class DigitalView extends PlotView {
  constructor(model, el) {
    super(model, el, TRAITS);
    this.margin.left = 70;
    this.bits = new Uint8Array(0);
    this.nSamples = 0;
    this.nLines = 0;
    this.analog = new Float32Array(0);
    this.nAnalog = 0;
    this.nTraces = 0;
    this.yRangeA = [-1, 1];
    this.listen("msg:custom", (msg, buffers) => {
      if (!msg || msg.type !== "data") return;
      this.bits = toUint8(buffers?.[0]);
      this.nSamples = msg.n_samples;
      this.nLines = msg.n_lines;
      this.analog = toFloat32(buffers?.[1]);
      this.nAnalog = msg.n_analog;
      this.nTraces = msg.n_traces;
      this.schedule();
    });
    this.model.send({ type: "sync_request" });
  }

  get mixed() {
    return this.kind === "mixedgraph";
  }

  get dt() {
    return parseNumber(this.get("dt")) || 1;
  }

  get x0() {
    return parseNumber(this.get("x0")) || 0;
  }

  /** Rows of the timing diagram: buses then (optionally) their lines, then free lines. */
  rows() {
    const names = this.get("lines") || [];
    const buses = this.get("buses") || [];
    const used = new Set();
    const rows = [];
    for (const b of buses) {
      const lines = (b.lines || []).map(Number).filter((l) => l >= 0 && l < this.nLines);
      rows.push({ type: "bus", name: String(b.name ?? "bus"), lines });
      for (const l of lines) {
        used.add(l);
        if (this.get("show_lines_in_bus")) rows.push({ type: "line", name: `  ${names[l] ?? `D${l}`}`, line: l });
      }
    }
    for (let l = 0; l < this.nLines; l++) if (!used.has(l)) rows.push({ type: "line", name: names[l] ?? `D${l}`, line: l });
    return rows;
  }

  fullRange() {
    const n = Math.max(this.nSamples, this.nAnalog, 1);
    if (this.mixed) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of this.analog) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
      const ymin = this.get("y_min");
      const ymax = this.get("y_max");
      this.yRangeA = ymin !== null && ymin !== undefined && ymax !== null && ymax !== undefined ? [parseNumber(ymin), parseNumber(ymax)] : autoscale([0, 0], lo, hi);
    }
    return { x: [this.x0, this.x0 + n * this.dt], y: this.mixed ? this.yRangeA : [0, 1] };
  }

  sampleRange(r) {
    const i0 = Math.max(0, Math.floor((r.x[0] - this.x0) / this.dt));
    const i1 = Math.min(this.nSamples, Math.ceil((r.x[1] - this.x0) / this.dt) + 1);
    return [i0, i1];
  }

  cursorText(x) {
    const i = Math.floor((x - this.x0) / this.dt);
    const parts = [];
    if (i >= 0 && i < this.nSamples) {
      for (const row of this.rows()) {
        if (row.type === "bus") parts.push(`${row.name}=0x${busValue(this.bits, this.nLines, row.lines, i).toString(16).toUpperCase()}`);
      }
      if (!parts.length) parts.push(Array.from({ length: this.nLines }, (_, l) => this.bits[i * this.nLines + l]).join(""));
    }
    if (i >= 0 && i < this.nAnalog) {
      for (let j = 0; j < this.nTraces; j++) parts.push(formatValue(this.analog[i * this.nTraces + j], "%.4g"));
    }
    return parts.length ? `→ ${parts.join(" ")}` : "";
  }

  draw() {
    const ctx = this.prepareCanvas();
    if (!ctx) return;
    const colors = this.colors();
    const [w, h] = this.get("size");
    ctx.clearRect(0, 0, w, h);
    const area = this.area();
    const r = this.ranges();
    const frac = this.mixed ? this.get("analog_fraction") : 0;
    const analogArea = { ...area, h: area.h * frac };
    const digitalArea = { ...area, y: area.y + analogArea.h + (this.mixed ? 6 : 0), h: area.h - analogArea.h - (this.mixed ? 6 : 0) };
    // x axis + grid on the whole area; y ticks only on the analog part
    this.drawAxes(ctx, area, { x: r.x, y: [0, 1] }, colors, { yTicks: false });
    if (this.mixed) this.drawAnalog(ctx, analogArea, r, colors);
    this.drawDigital(ctx, digitalArea, r, colors);
    this.drawOverlays(ctx, area, r, colors);
    const traces = this.mixed ? Array.from({ length: this.nTraces }, (_, j) => traceStyle(this.model, j, colors)) : [];
    drawLegend(this.legend, traces, true);
    this.body.setAttribute("aria-label", `${this.get("label") || "Digital waveform graph"}: ${this.nLines} lines, ${this.nSamples} samples`);
  }

  drawAnalog(ctx, a, r, colors) {
    const Y = (v) => a.y + a.h - ((v - r.y[0]) / (r.y[1] - r.y[0] || 1)) * a.h;
    const X = (x) => a.x + ((x - r.x[0]) / (r.x[1] - r.x[0])) * a.w;
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = colors.fg;
    ctx.strokeStyle = colors.grid;
    for (const v of niceTicks(r.y[0], r.y[1], 3)) {
      ctx.beginPath(); ctx.moveTo(a.x, Y(v)); ctx.lineTo(a.x + a.w, Y(v)); ctx.stroke();
      ctx.fillText(formatValue(v, "%.3g"), a.x - 4, Y(v));
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(a.x, a.y, a.w, a.h); ctx.clip();
    const i0 = Math.max(0, Math.floor((r.x[0] - this.x0) / this.dt));
    const i1 = Math.min(this.nAnalog, Math.ceil((r.x[1] - this.x0) / this.dt) + 1);
    for (let j = 0; j < this.nTraces; j++) {
      const t = traceStyle(this.model, j, colors);
      if (!t.visible) continue;
      ctx.strokeStyle = t.color;
      ctx.lineWidth = t.width;
      ctx.beginPath();
      let pen = false;
      for (let i = i0; i < i1; i++) {
        const v = this.analog[i * this.nTraces + j];
        if (!Number.isFinite(v)) { pen = false; continue; }
        const x = X(this.x0 + i * this.dt);
        if (pen) ctx.lineTo(x, Y(v)); else ctx.moveTo(x, Y(v));
        pen = true;
      }
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = colors.muted;
    ctx.beginPath(); ctx.moveTo(a.x, a.y + a.h + 3); ctx.lineTo(a.x + a.w, a.y + a.h + 3); ctx.stroke();
  }

  drawDigital(ctx, a, r, colors) {
    const rows = this.rows();
    if (!rows.length) return;
    const rh = a.h / rows.length;
    const X = (x) => a.x + ((x - r.x[0]) / (r.x[1] - r.x[0])) * a.w;
    const xi = (i) => X(this.x0 + i * this.dt);
    const [i0, i1] = this.sampleRange(r);
    ctx.font = "10px system-ui, sans-serif";
    rows.forEach((row, k) => {
      const top = a.y + k * rh + 3;
      const bottom = a.y + (k + 1) * rh - 3;
      const mid = (top + bottom) / 2;
      ctx.fillStyle = colors.fg;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(row.name, a.x - 4, mid);
      ctx.save();
      ctx.beginPath(); ctx.rect(a.x, a.y, a.w, a.h); ctx.clip();
      const color = colors.trace(k);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      if (row.type === "line") {
        const segs = runs((i) => this.bits[i * this.nLines + row.line], i0, i1);
        ctx.beginPath();
        segs.forEach((s, n) => {
          const y = s.value ? top : bottom;
          if (n === 0) ctx.moveTo(xi(s.start), y);
          else ctx.lineTo(xi(s.start), y);
          ctx.lineTo(xi(s.end), y);
        });
        ctx.stroke();
      } else {
        // bus: hexagonal "eye" per constant value, value in hexadecimal
        const segs = runs((i) => busValue(this.bits, this.nLines, row.lines, i), i0, i1);
        for (const s of segs) {
          const xa = xi(s.start);
          const xb = xi(s.end);
          const e = Math.min(3, (xb - xa) / 2);
          ctx.beginPath();
          ctx.moveTo(xa, mid); ctx.lineTo(xa + e, top); ctx.lineTo(xb - e, top); ctx.lineTo(xb, mid);
          ctx.lineTo(xb - e, bottom); ctx.lineTo(xa + e, bottom); ctx.closePath();
          ctx.stroke();
          const text = `0x${s.value.toString(16).toUpperCase()}`;
          if (ctx.measureText(text).width + 6 < xb - xa) {
            ctx.fillStyle = colors.fg;
            ctx.textAlign = "center";
            ctx.fillText(text, (Math.max(xa, a.x) + Math.min(xb, a.x + a.w)) / 2, mid);
          }
        }
      }
      ctx.restore();
    });
  }

  csvRows() {
    const rows = this.rows();
    const header = ["x", ...rows.map((r) => r.name.trim())];
    for (let j = 0; j < this.nTraces; j++) header.push(traceStyle(this.model, j, this.colors()).name);
    const out = [header];
    const r = this.ranges();
    const n = Math.max(this.nSamples, this.nAnalog);
    for (let i = 0; i < n; i++) {
      const x = this.x0 + i * this.dt;
      if (x < r.x[0] || x > r.x[1]) continue;
      const row = [x];
      for (const rr of rows) {
        if (i >= this.nSamples) row.push("");
        else if (rr.type === "bus") row.push(`0x${busValue(this.bits, this.nLines, rr.lines, i).toString(16).toUpperCase()}`);
        else row.push(this.bits[i * this.nLines + rr.line]);
      }
      for (let j = 0; j < this.nTraces; j++) row.push(i < this.nAnalog ? this.analog[i * this.nTraces + j] : "");
      out.push(row);
    }
    return out;
  }

  svgContent(area, r, colors, el) {
    // vector export of the digital rows (step lines)
    const rows = this.rows();
    const frac = this.mixed ? this.get("analog_fraction") : 0;
    const a = { ...area, y: area.y + area.h * frac, h: area.h * (1 - frac) };
    const rh = a.h / Math.max(1, rows.length);
    const X = (x) => a.x + ((x - r.x[0]) / (r.x[1] - r.x[0])) * a.w;
    const [i0, i1] = this.sampleRange(r);
    const out = [];
    rows.forEach((row, k) => {
      if (row.type !== "line") return;
      const top = a.y + k * rh + 3;
      const bottom = a.y + (k + 1) * rh - 3;
      let d = "";
      runs((i) => this.bits[i * this.nLines + row.line], i0, i1).forEach((s, n) => {
        const y = s.value ? top : bottom;
        d += `${n ? "L" : "M"}${X(this.x0 + s.start * this.dt).toFixed(1)} ${y}L${X(this.x0 + s.end * this.dt).toFixed(1)} ${y}`;
      });
      out.push(el("path", { d, fill: "none", stroke: colors.trace(k), "stroke-width": 1.5 }));
    });
    return out;
  }
}
