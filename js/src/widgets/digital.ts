// DigitalWaveformGraph (CHART-102) and MixedSignalGraph (CHART-103).
import { busLines, busValue, decodeDigital, type DigitalData, EMPTY_DATA, hex, runs, sampleAt } from "../contract/digital.js";
import type { BufferLike } from "../core/buffers.js";
import { setAttr } from "../core/dom.js";
import { formatValue } from "../core/format.js";
import type { AnyModel } from "../core/model.js";
import { type Area, type Colors, PlotView, type Range, type Ranges, type SvgBuilder } from "../core/plot.js";
import { autoscale, niceTicks } from "../core/scale.js";
import type { DigitalWaveformGraphTraits, MixedSignalGraphTraits } from "../generated/contract.js";
import { drawLegend, traceStyle } from "./chart.js";

export { busValue, runs };

const TRAITS = ["lines", "buses", "dt", "x0", "show_lines_in_bus", "traces", "y_min", "y_max", "analog_fraction"];

/** Traits of both graphs (the analog ones only on the mixed-signal graph). */
export type DigitalViewTraits = DigitalWaveformGraphTraits & Partial<Pick<MixedSignalGraphTraits, "traces" | "y_min" | "y_max" | "analog_fraction">>;

type Row = { type: "bus"; name: string; lines: number[] } | { type: "line"; name: string; line: number };

export class DigitalView extends PlotView<DigitalViewTraits> {
  data: DigitalData = EMPTY_DATA;
  yRangeA: Range = [-1, 1];

  constructor(model: AnyModel<DigitalViewTraits>, el: HTMLElement) {
    super(model, el, TRAITS);
    this.margin.left = 70;
    this.listen("msg:custom", (msg: unknown, buffers: unknown) => {
      if (!msg || typeof msg !== "object" || (msg as { type?: unknown }).type !== "data") return;
      this.data = decodeDigital(msg as Record<string, unknown>, buffers as BufferLike[] | undefined);
      this.schedule();
    });
    this.model.send({ type: "sync_request" });
  }

  get mixed(): boolean {
    return this.kind === "mixedgraph";
  }

  get dt(): number {
    return this.get("dt") || 1;
  }

  get x0(): number {
    return this.get("x0");
  }

  /** Rows of the timing diagram: buses then (optionally) their lines, then free lines. */
  rows(): Row[] {
    const names = this.get("lines");
    const { nLines } = this.data;
    const used = new Set<number>();
    const rows: Row[] = [];
    for (const b of this.get("buses")) {
      const lines = busLines(b, nLines);
      rows.push({ type: "bus", name: String(b.name ?? "bus"), lines });
      for (const l of lines) {
        used.add(l);
        if (this.get("show_lines_in_bus")) rows.push({ type: "line", name: `  ${names[l] ?? `D${l}`}`, line: l });
      }
    }
    for (let l = 0; l < nLines; l++) if (!used.has(l)) rows.push({ type: "line", name: names[l] ?? `D${l}`, line: l });
    return rows;
  }

  override fullRange(): Ranges {
    const d = this.data;
    const n = Math.max(d.nSamples, d.nAnalog, 1);
    if (this.mixed) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of d.analog.subarray(0, d.nAnalog * d.nTraces)) {
        if (Number.isFinite(v)) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      const ymin = this.get("y_min") ?? null;
      const ymax = this.get("y_max") ?? null;
      this.yRangeA = ymin !== null && ymax !== null ? [ymin, ymax] : autoscale([0, 0], lo, hi);
    }
    return { x: [this.x0, this.x0 + n * this.dt], y: this.mixed ? this.yRangeA : [0, 1] };
  }

  sampleRange(r: Ranges): Range {
    const i0 = Math.max(0, Math.floor((r.x[0] - this.x0) / this.dt));
    const i1 = Math.min(this.data.nSamples, Math.ceil((r.x[1] - this.x0) / this.dt) + 1);
    return [i0, i1];
  }

  override cursorText(x: number): string {
    const d = this.data;
    const i = sampleAt(x, this.x0, this.dt);
    const parts: string[] = [];
    if (i >= 0 && i < d.nSamples) {
      for (const b of this.get("buses")) parts.push(`${String(b.name ?? "bus")}=${hex(busValue(d.bits, d.nLines, busLines(b, d.nLines), i))}`);
      if (!parts.length) parts.push(Array.from(d.bits.subarray(i * d.nLines, (i + 1) * d.nLines)).join(""));
    }
    if (i >= 0 && i < d.nAnalog) for (let j = 0; j < d.nTraces; j++) parts.push(formatValue(d.analog[i * d.nTraces + j], "%.4g"));
    return parts.length ? `→ ${parts.join(" ")}` : "";
  }

  override draw(): void {
    const colors = this.colors();
    const d = this.data;
    const traces = this.mixed ? Array.from({ length: d.nTraces }, (_, j) => traceStyle(this.get("traces"), j, colors)) : [];
    drawLegend(this.legend, traces, true);
    setAttr(this.body, "aria-label", `${this.get("label") || "Digital waveform graph"}: ${d.nLines} lines, ${d.nSamples} samples`);
    const ctx = this.prepareCanvas();
    if (!ctx) return;
    const [w, h] = this.get("size");
    ctx.clearRect(0, 0, w, h);
    const area = this.area();
    const r = this.ranges();
    const frac = this.mixed ? (this.get("analog_fraction") ?? 0.55) : 0;
    const analogArea = { ...area, h: area.h * frac };
    const digitalArea = { ...area, y: area.y + analogArea.h + (this.mixed ? 6 : 0), h: area.h - analogArea.h - (this.mixed ? 6 : 0) };
    // x axis + grid on the whole area; y ticks only on the analog part
    this.drawAxes(ctx, area, { x: r.x, y: [0, 1] }, colors, { yTicks: false });
    if (this.mixed) this.drawAnalog(ctx, analogArea, r, colors);
    this.drawDigital(ctx, digitalArea, r, colors);
    this.drawOverlays(ctx, area, r, colors);
  }

  drawAnalog(ctx: CanvasRenderingContext2D, a: Area, r: Ranges, colors: Colors): void {
    const d = this.data;
    const Y = (v: number): number => a.y + a.h - ((v - r.y[0]) / (r.y[1] - r.y[0] || 1)) * a.h;
    const X = (x: number): number => a.x + ((x - r.x[0]) / (r.x[1] - r.x[0])) * a.w;
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = colors.fg;
    ctx.strokeStyle = colors.grid;
    for (const v of niceTicks(r.y[0], r.y[1], 3)) {
      ctx.beginPath();
      ctx.moveTo(a.x, Y(v));
      ctx.lineTo(a.x + a.w, Y(v));
      ctx.stroke();
      ctx.fillText(formatValue(v, "%.3g"), a.x - 4, Y(v));
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(a.x, a.y, a.w, a.h);
    ctx.clip();
    const i0 = Math.max(0, Math.floor((r.x[0] - this.x0) / this.dt));
    const i1 = Math.min(d.nAnalog, Math.ceil((r.x[1] - this.x0) / this.dt) + 1);
    for (let j = 0; j < d.nTraces; j++) {
      const t = traceStyle(this.get("traces"), j, colors);
      if (!t.visible) continue;
      ctx.strokeStyle = t.color;
      ctx.lineWidth = t.width;
      ctx.beginPath();
      let pen = false;
      for (let i = i0; i < i1; i++) {
        const v = d.analog[i * d.nTraces + j];
        if (!Number.isFinite(v)) {
          pen = false;
          continue;
        }
        const x = X(this.x0 + i * this.dt);
        if (pen) ctx.lineTo(x, Y(v));
        else ctx.moveTo(x, Y(v));
        pen = true;
      }
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = colors.muted;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y + a.h + 3);
    ctx.lineTo(a.x + a.w, a.y + a.h + 3);
    ctx.stroke();
  }

  drawDigital(ctx: CanvasRenderingContext2D, a: Area, r: Ranges, colors: Colors): void {
    const rows = this.rows();
    if (!rows.length) return;
    const { bits, nLines } = this.data;
    const rh = a.h / rows.length;
    const X = (x: number): number => a.x + ((x - r.x[0]) / (r.x[1] - r.x[0])) * a.w;
    const xi = (i: number): number => X(this.x0 + i * this.dt);
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
      ctx.beginPath();
      ctx.rect(a.x, a.y, a.w, a.h);
      ctx.clip();
      ctx.strokeStyle = colors.trace(k);
      ctx.lineWidth = 1.5;
      if (row.type === "line") {
        const segs = runs((i) => bits[i * nLines + row.line], i0, i1);
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
        for (const s of runs((i) => busValue(bits, nLines, row.lines, i), i0, i1)) {
          const xa = xi(s.start);
          const xb = xi(s.end);
          const e = Math.min(3, (xb - xa) / 2);
          ctx.beginPath();
          ctx.moveTo(xa, mid);
          ctx.lineTo(xa + e, top);
          ctx.lineTo(xb - e, top);
          ctx.lineTo(xb, mid);
          ctx.lineTo(xb - e, bottom);
          ctx.lineTo(xa + e, bottom);
          ctx.closePath();
          ctx.stroke();
          const text = hex(s.value);
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

  override csvRows(): Array<Array<string | number>> {
    const d = this.data;
    const rows = this.rows();
    const header = ["x", ...rows.map((r) => r.name.trim())];
    for (let j = 0; j < d.nTraces; j++) header.push(traceStyle(this.get("traces"), j, this.colors()).name);
    const out: Array<Array<string | number>> = [header];
    const r = this.ranges();
    const n = Math.max(d.nSamples, d.nAnalog);
    for (let i = 0; i < n; i++) {
      const x = this.x0 + i * this.dt;
      if (x < r.x[0] || x > r.x[1]) continue;
      const row: Array<string | number> = [x];
      for (const rr of rows) {
        if (i >= d.nSamples) row.push("");
        else if (rr.type === "bus") row.push(hex(busValue(d.bits, d.nLines, rr.lines, i)));
        else row.push(d.bits[i * d.nLines + rr.line]);
      }
      for (let j = 0; j < d.nTraces; j++) row.push(i < d.nAnalog ? d.analog[i * d.nTraces + j] : "");
      out.push(row);
    }
    return out;
  }

  override svgContent(area: Area, r: Ranges, colors: Colors, el: SvgBuilder): SVGElement[] {
    // vector export of the digital rows (step lines)
    const { bits, nLines } = this.data;
    const rows = this.rows();
    const frac = this.mixed ? (this.get("analog_fraction") ?? 0.55) : 0;
    const a = { ...area, y: area.y + area.h * frac, h: area.h * (1 - frac) };
    const rh = a.h / Math.max(1, rows.length);
    const X = (x: number): number => a.x + ((x - r.x[0]) / (r.x[1] - r.x[0])) * a.w;
    const [i0, i1] = this.sampleRange(r);
    const out: SVGElement[] = [];
    rows.forEach((row, k) => {
      if (row.type !== "line") return;
      const top = a.y + k * rh + 3;
      const bottom = a.y + (k + 1) * rh - 3;
      let d = "";
      runs((i) => bits[i * nLines + row.line], i0, i1).forEach((s, n) => {
        const y = s.value ? top : bottom;
        d += `${n ? "L" : "M"}${X(this.x0 + s.start * this.dt).toFixed(1)} ${y}L${X(this.x0 + s.end * this.dt).toFixed(1)} ${y}`;
      });
      out.push(el("path", { d, fill: "none", stroke: colors.trace(k), "stroke-width": 1.5 }));
    });
    return out;
  }
}

