// Compact indicators (IND-100..103): deviation bar, sparkline, bar graph,
// KPI tile.
import { type Bar, normalizeBars } from "../contract/bars.js";
import { type BufferLike, toFloat32 } from "../core/buffers.js";
import { clear, html, svg, svgText } from "anywidget-instruments/js/src/core/dom.js";
import { formatValue, withUnit } from "../core/format.js";
import { clamp, parseNumber } from "anywidget-instruments/js/src/core/scale.js";
import type { AnyModel } from "anywidget-instruments/js/src/core/model.js";
import { BaseView } from "anywidget-instruments/js/src/core/view.js";
import type { BarGraphTraits, DeviationIndicatorTraits, KPITileTraits, SparklineTraits } from "../generated/contract.js";

const LEVEL_TEXT: Record<string, string> = { lolo: "LOLO", lo: "LO", hi: "HI", hihi: "HIHI" };

/** Signed value text ("+2.30", "-1.00", "0.00"); a "+" flag in the format is accepted. */
export function signed(v: number, fmt: string = "%.2f"): string {
  const text = formatValue(v, String(fmt).replace("%+", "%"));
  return Number.isFinite(v) && v > 0 && !text.startsWith("+") ? `+${text}` : text;
}

// ---------------------------------------------------------------------------
// History of values received as float32 buffers (Sparkline, KPITile)
// ---------------------------------------------------------------------------
export class ValueRing {
  readonly capacity: number;
  readonly data: Float32Array;
  total: number;

  constructor(capacity: number) {
    this.capacity = Math.max(2, capacity | 0);
    this.data = new Float32Array(this.capacity);
    this.total = 0;
  }

  push(values: ArrayLike<number>, n: number): void {
    for (let i = Math.max(0, n - this.capacity); i < n; i++) this.data[(this.total + i) % this.capacity] = values[i];
    this.total += n;
  }

  /** Kept values, oldest first. */
  values(): number[] {
    const n = Math.min(this.total, this.capacity);
    return Array.from({ length: n }, (_, k) => this.data[(this.total - n + k) % this.capacity]);
  }
}

/** Listen to snapshot / append messages of a history (Sparkline, KPITile). */
/** A view with a value history. */
interface HistoryView {
  ring: ValueRing;
  model: AnyModel<any>;
  get(name: string): unknown;
  listen(event: string, cb: (...args: any[]) => void): void;
  schedule(): void;
}

function attachHistory(view: HistoryView): void {
  const reset = (): void => { view.ring = new ValueRing(parseNumber(view.get("history")) || 2); };
  reset();
  view.listen("change:history", () => { reset(); view.schedule(); });
  view.listen("msg:custom", (msg: { type?: string; n?: number } | null, buffers?: BufferLike[]) => {
    if (!msg || (msg.type !== "snapshot" && msg.type !== "append")) return;
    if (msg.type === "snapshot") reset();
    view.ring.push(toFloat32(buffers?.[0]), (msg.n ?? 0) | 0);
    view.schedule();
  });
  view.model.send({ type: "sync_request" });
}

/** Sparkline into `g` within the box (x, y, w, h): line, min (hollow) and max (filled) dots. */
export function drawSpark(g: SVGElement, values: number[], { x, y, w, h }: { x: number; y: number; w: number; h: number }): { lo: number; hi: number } | null {
  const finite = values.map((v, i) => [i, v]).filter(([, v]) => Number.isFinite(v));
  if (finite.length === 0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  let iLo = 0;
  let iHi = 0;
  for (const [i, v] of finite) {
    if (v < lo) { lo = v; iLo = i; }
    if (v > hi) { hi = v; iHi = i; }
  }
  const n = Math.max(values.length - 1, 1);
  const X = (i: number): number => x + (i / n) * w;
  const Y = (v: number): number => (hi === lo ? y + h / 2 : y + h - ((v - lo) / (hi - lo)) * h);
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) { pen = false; return; }
    d += `${pen ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`;
    pen = true;
  });
  g.appendChild(svg("path", { class: "awi-spark-line", d }));
  g.appendChild(svg("circle", { class: "awi-spark-min", cx: X(iLo), cy: Y(lo), r: 2.5 }));
  g.appendChild(svg("circle", { class: "awi-spark-max", cx: X(iHi), cy: Y(hi), r: 2.5 }));
  return { lo, hi };
}

// ---------------------------------------------------------------------------
// DeviationIndicator (IND-100)
// ---------------------------------------------------------------------------
export class DeviationView extends BaseView<DeviationIndicatorTraits> {
  readonly svgEl: SVGElement;
  readonly valueRow: HTMLDivElement;
  readonly valueText: HTMLSpanElement;
  readonly badge: HTMLSpanElement;

  constructor(model: AnyModel<DeviationIndicatorTraits>, el: HTMLElement) {
    super(model, el, ["value", "setpoint", "tolerance", "span", "unit", "format"]);
    this.svgEl = svg("svg", { class: "awi-svg", "aria-hidden": "true" });
    this.body.appendChild(this.svgEl);
    this.body.setAttribute("role", "meter");
    this.body.setAttribute("aria-labelledby", this.labelEl.id);
    this.valueRow = html("div", { cls: "awi-value-row" });
    this.valueText = html("span", { cls: "awi-value" });
    this.badge = html("span", { cls: "awi-badge" });
    this.valueRow.append(this.valueText, this.badge);
    this.root.append(this.valueRow);
    this.schedule();
  }

  get deviation(): number {
    return parseNumber(this.get("value")) - parseNumber(this.get("setpoint"));
  }

  override renderCommon(): void {
    super.renderCommon();
    const d = this.deviation;
    const tol = Math.max(0, parseNumber(this.get("tolerance")) || 0);
    const span = parseNumber(this.get("span")) || 1;
    const out = Number.isFinite(d) && Math.abs(d) > tol;
    this.root.classList.toggle("awi-dev-out", out);
    const text = `Δ ${withUnit(signed(d, this.get("format") || "%.2f"), this.get("unit"))}`;
    this.valueText.textContent = text;
    const state = out ? (d > 0 ? "▲ HIGH" : "▼ LOW") : "";
    this.badge.textContent = state;
    this.badge.hidden = !out;
    const b = this.body;
    b.setAttribute("aria-valuemin", String(-span));
    b.setAttribute("aria-valuemax", String(span));
    if (Number.isFinite(d)) b.setAttribute("aria-valuenow", String(d));
    else b.removeAttribute("aria-valuenow");
    b.setAttribute("aria-valuetext", `deviation ${text.slice(2)}, tolerance ±${formatValue(tol, "%.3g")}${out ? `, ${state.slice(2).toLowerCase()}` : ", within tolerance"}`);
  }

  override draw(): void {
    const [w, h] = this.get("size");
    const s = this.svgEl;
    s.setAttribute("viewBox", `0 0 ${w} ${h}`);
    clear(s);
    const span = parseNumber(this.get("span")) || 1;
    const tol = Math.max(0, parseNumber(this.get("tolerance")) || 0);
    const x0 = 10;
    const x1 = w - 10;
    const X = (v: number): number => x0 + ((clamp(v, -span, span) + span) / (2 * span)) * (x1 - x0);
    const [y0, y1] = [4, Math.min(h - 16, 22)];
    s.appendChild(svg("rect", { class: "awi-dev-track", x: x0, y: y0, width: x1 - x0, height: y1 - y0 }));
    s.appendChild(svg("rect", { class: "awi-dev-band", x: X(-tol), y: y0, width: X(tol) - X(-tol), height: y1 - y0 }));
    const d = this.deviation;
    if (Number.isFinite(d)) {
      const [a, b] = [X(0), X(d)].sort((p, q) => p - q);
      s.appendChild(svg("rect", { class: "awi-dev-bar", x: a, y: y0 + 3, width: Math.max(1, b - a), height: y1 - y0 - 6 }));
      if (Math.abs(d) > span) s.appendChild(svgText(d > 0 ? "▶" : "◀", { class: "awi-dev-over", x: d > 0 ? x1 + 5 : x0 - 5, y: (y0 + y1) / 2, "text-anchor": "middle", "dominant-baseline": "central" }));
    }
    s.appendChild(svg("path", { class: "awi-dev-zero", d: `M${X(0)} ${y0 - 2}V${y1 + 2}` }));
    for (const [v, anchor] of [[-span, "start"], [0, "middle"], [span, "end"]] as Array<[number, string]>) {
      s.appendChild(svgText(signed(v, "%.3g"), { class: "awi-dev-tick", x: X(v), y: y1 + 10, "text-anchor": anchor }));
    }
  }
}

// ---------------------------------------------------------------------------
// Sparkline (IND-101)
// ---------------------------------------------------------------------------
export class SparklineView extends BaseView<SparklineTraits> {
  readonly svgEl: SVGElement;
  ring!: ValueRing;

  constructor(model: AnyModel<SparklineTraits>, el: HTMLElement) {
    super(model, el, ["value", "unit", "format"]);
    this.svgEl = svg("svg", { class: "awi-svg", "aria-hidden": "true" });
    this.body.appendChild(this.svgEl);
    this.body.setAttribute("role", "img");
    attachHistory(this);
    this.schedule();
  }

  override draw(): void {
    const [w, h] = this.get("size");
    const s = this.svgEl;
    s.setAttribute("viewBox", `0 0 ${w} ${h}`);
    clear(s);
    const fmt = this.get("format") || "%.4g";
    // the newest value of the history (the kernel also puts it in `value`)
    const kept = this.ring.values();
    const newest = kept.length ? kept[kept.length - 1] : parseNumber(this.get("value"));
    const last = withUnit(formatValue(newest, fmt), this.get("unit"));
    const textW = Math.min(w * 0.45, 8 + last.length * 7);
    const box = { x: 3, y: 4, w: w - textW - 8, h: h - 8 };
    const range = drawSpark(s, kept, box);
    s.appendChild(svgText(last, { class: "awi-spark-value", x: w - 2, y: h / 2, "text-anchor": "end", "dominant-baseline": "central" }));
    const extra = range ? `, min ${formatValue(range.lo, fmt)}, max ${formatValue(range.hi, fmt)}` : "";
    this.body.setAttribute("aria-label", `${this.get("label") || "Sparkline"}: last ${last}${extra}`);
  }
}

// ---------------------------------------------------------------------------
// BarGraph (IND-102)
// ---------------------------------------------------------------------------
export class BarGraphView extends BaseView<BarGraphTraits> {
  readonly svgEl: SVGElement;

  constructor(model: AnyModel<BarGraphTraits>, el: HTMLElement) {
    super(model, el, ["value", "bars", "min", "max", "unit", "format", "alarm_levels"]);
    this.svgEl = svg("svg", { class: "awi-svg", "aria-hidden": "true" });
    this.body.appendChild(this.svgEl);
    this.body.setAttribute("role", "img");
    this.schedule();
  }

  override draw(): void {
    const [w, h] = this.get("size");
    const s = this.svgEl;
    s.setAttribute("viewBox", `0 0 ${w} ${h}`);
    clear(s);
    // bars as the kernel stores them (labels, missing limits)
    const bars: Bar[] = normalizeBars(this.get("bars"));
    const values = this.get("value") || [];
    const levels = this.get("alarm_levels") || [];
    const min = parseNumber(this.get("min"));
    const max = parseNumber(this.get("max"));
    const fmt = this.get("format") || "%.1f";
    const left = 30;
    const top = 26;
    const bottom = h - 16;
    const Y = (v: number): number => bottom - ((clamp(v, min, max) - min) / (max - min || 1)) * (bottom - top);
    for (const v of [min, (min + max) / 2, max]) {
      s.appendChild(svgText(formatValue(v, "%.3g"), { class: "awi-bar-tick", x: left - 4, y: Y(v), "text-anchor": "end", "dominant-baseline": "central" }));
      s.appendChild(svg("path", { class: "awi-bar-grid", d: `M${left} ${Y(v)}H${w - 2}` }));
    }
    const n = Math.max(bars.length, 1);
    const col = (w - left - 2) / n;
    const bw = Math.min(28, col * 0.5);
    const summary: string[] = [];
    bars.forEach((bar, i) => {
      const cx = left + col * (i + 0.5);
      const x = cx - bw / 2;
      const v = parseNumber(values[i]);
      const level = levels[i] || "normal";
      s.appendChild(svg("rect", { class: "awi-bar-track", x, y: top, width: bw, height: bottom - top }));
      const nlo = parseNumber(bar.normal_lo);
      const nhi = parseNumber(bar.normal_hi);
      if (Number.isFinite(nlo) || Number.isFinite(nhi)) {
        const ya = Y(Number.isFinite(nhi) ? nhi : max);
        const yb = Y(Number.isFinite(nlo) ? nlo : min);
        s.appendChild(svg("rect", { class: "awi-bar-normal", x, y: ya, width: bw, height: yb - ya }));
      }
      if (Number.isFinite(v)) {
        const y = Y(v);
        s.appendChild(svg("rect", { class: `awi-bar-fill${LEVEL_TEXT[level] ? ` awi-bar-alarm awi-bar-${level}` : ""}`, x: x + bw * 0.2, y, width: bw * 0.6, height: bottom - y }));
      }
      for (const k of ["lolo", "lo", "hi", "hihi"]) {
        const lim = parseNumber(bar[k as keyof Bar]);
        if (Number.isFinite(lim)) s.appendChild(svg("path", { class: `awi-bar-limit awi-bar-limit-${k}`, d: `M${x - 3} ${Y(lim)}H${x + bw + 3}` }));
      }
      const valueText = formatValue(v, fmt);
      s.appendChild(svgText(LEVEL_TEXT[level] ? `${valueText} ${LEVEL_TEXT[level]}` : valueText, { class: `awi-bar-value${LEVEL_TEXT[level] ? " awi-bar-value-alarm" : ""}`, x: cx, y: top - 6, "text-anchor": "middle" }));
      s.appendChild(svgText(String(bar.label ?? ""), { class: "awi-bar-label", x: cx, y: h - 3, "text-anchor": "middle" }));
      summary.push(`${bar.label} ${withUnit(valueText, this.get("unit"))}${LEVEL_TEXT[level] ? ` ${LEVEL_TEXT[level]}` : ""}`);
    });
    if (this.get("unit")) s.appendChild(svgText(this.get("unit"), { class: "awi-bar-tick", x: left - 4, y: 8, "text-anchor": "end" }));
    this.body.setAttribute("aria-label", `${this.get("label") || "Bar graph"}: ${summary.join(", ")}`);
  }
}

// ---------------------------------------------------------------------------
// KPITile (IND-103)
// ---------------------------------------------------------------------------
/** Difference to the target: text and whether it is on the good side. */
export function kpiDelta(value: number, target: unknown, higherIsBetter: boolean, fmt: string, unit: string): { good: boolean; text: string } | null {
  const t = parseNumber(target);
  if (target === null || target === undefined || !Number.isFinite(t) || !Number.isFinite(value)) return null;
  const d = value - t;
  const good = higherIsBetter ? d >= 0 : d <= 0;
  const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "=";
  const sign = d > 0 ? "+" : "";
  return { good, text: `${arrow} ${sign}${withUnit(formatValue(d, fmt), unit)} vs target ${withUnit(formatValue(t, fmt), unit)} ${good ? "✓" : "✗"}` };
}

export class KPITileView extends BaseView<KPITileTraits> {
  readonly valueEl: HTMLDivElement;
  readonly deltaEl: HTMLDivElement;
  readonly svgEl: SVGElement;
  ring!: ValueRing;

  constructor(model: AnyModel<KPITileTraits>, el: HTMLElement) {
    super(model, el, ["value", "target", "higher_is_better", "unit", "format", "show_sparkline"]);
    this.body.setAttribute("role", "img");
    this.valueEl = html("div", { cls: "awi-kpi-value" });
    this.deltaEl = html("div", { cls: "awi-kpi-delta" });
    this.svgEl = svg("svg", { class: "awi-kpi-spark", "aria-hidden": "true" });
    this.body.append(this.valueEl, this.deltaEl, this.svgEl);
    attachHistory(this);
    this.schedule();
  }

  override draw(): void {
    const [w] = this.get("size");
    const v = parseNumber(this.get("value"));
    const fmt = this.get("format") || "%.1f";
    const unit = this.get("unit") || "";
    const valueText = withUnit(formatValue(v, fmt), unit);
    this.valueEl.textContent = valueText;
    const delta = kpiDelta(v, this.get("target"), this.get("higher_is_better") !== false, fmt, unit);
    this.deltaEl.textContent = delta ? delta.text : "";
    this.deltaEl.hidden = !delta;
    this.root.classList.toggle("awi-kpi-good", !!delta?.good);
    this.root.classList.toggle("awi-kpi-bad", !!delta && !delta.good);
    const s = this.svgEl;
    clear(s);
    const show = !!this.get("show_sparkline") && this.ring.total > 1;
    s.style.display = show ? "" : "none";
    if (show) {
      const sw = w - 16;
      s.setAttribute("viewBox", `0 0 ${sw} 22`);
      s.setAttribute("width", String(sw));
      s.setAttribute("height", "22");
      drawSpark(s, this.ring.values(), { x: 3, y: 3, w: sw - 6, h: 16 });
    }
    this.body.setAttribute("aria-label", `${this.get("label") || "KPI"}: ${valueText}${delta ? `, ${delta.text.replace("✓", "on the good side").replace("✗", "on the wrong side")}` : ""}`);
  }
}
