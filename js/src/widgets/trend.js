// TrendChart: named pens against wall-clock time, live or browsing the
// history (IND-070..075).
import { toFloat32, toFloat64 } from "../core/buffers.js";
import { clear, html, safeColor } from "../core/dom.js";
import { formatValue } from "../core/format.js";
import { PlotView } from "../core/plot.js";
import { parseNumber } from "../core/scale.js";

const TRAITS = ["pens", "span", "history", "value"];

/** Span choices of the toolbar (seconds, label). */
export const SPANS = [
  [60, "1 min"],
  [600, "10 min"],
  [3600, "1 h"],
  [8 * 3600, "8 h"],
  [86400, "24 h"],
];

/** Circular buffer of (time, value) samples of one pen. */
export class PenRing {
  constructor(capacity) {
    this.capacity = capacity;
    this.t = new Float64Array(capacity);
    this.v = new Float32Array(capacity);
    this.total = 0;
  }

  push(ts, vs, n) {
    for (let i = Math.max(0, n - this.capacity); i < n; i++) {
      const slot = (this.total + i) % this.capacity;
      this.t[slot] = ts[i];
      this.v[slot] = vs[i];
    }
    this.total += n;
  }

  get size() {
    return Math.min(this.total, this.capacity);
  }

  /** Slot of the k-th oldest buffered sample. */
  slot(k) {
    return (this.total - this.size + k) % this.capacity;
  }

  timeAt(k) {
    return this.t[this.slot(k)];
  }

  valueAt(k) {
    return this.v[this.slot(k)];
  }

  get first() {
    return this.size ? this.timeAt(0) : NaN;
  }

  get last() {
    return this.size ? this.timeAt(this.size - 1) : NaN;
  }

  /** Index of the first sample at or after time t (binary search). */
  lowerBound(t) {
    let lo = 0;
    let hi = this.size;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.timeAt(mid) < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Value at time t, linearly interpolated; NaN outside the buffered span. */
  at(t) {
    const n = this.size;
    if (!n || t < this.first || t > this.last) return NaN;
    const k = this.lowerBound(t);
    if (k >= n) return this.valueAt(n - 1);
    const t1 = this.timeAt(k);
    if (t1 === t || k === 0) return this.valueAt(k);
    const t0 = this.timeAt(k - 1);
    const f = (t - t0) / (t1 - t0 || 1);
    return this.valueAt(k - 1) * (1 - f) + this.valueAt(k) * f;
  }
}

const pad = (n) => String(n).padStart(2, "0");
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400];

/** Time-axis ticks (Unix seconds) at round local times, about `count` of them. */
export function timeTicks(t0, t1, count = 5) {
  const span = t1 - t0;
  if (!(span > 0)) return { step: 60, ticks: [] };
  const step = STEPS.find((s) => span / s <= count) || Math.ceil(span / count / 86400) * 86400;
  const off = -new Date(t0 * 1000).getTimezoneOffset() * 60; // local time offset
  const ticks = [];
  for (let t = Math.ceil((t0 + off) / step) * step - off; t <= t1; t += step) ticks.push(t);
  return { step, ticks };
}

/** Local time label of a tick; seconds shown for steps below one minute. */
export function timeLabel(t, step = 60) {
  const d = new Date(t * 1000);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const text = step < 60 ? `${hm}:${pad(d.getSeconds())}` : hm;
  return step >= 86400 ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${text}` : text;
}

/** Full local date and time, for entry fields and CSV. */
export function timeText(t) {
  if (!Number.isFinite(t)) return "";
  const d = new Date(t * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Parse "YYYY-MM-DD HH:MM[:SS]" or "HH:MM[:SS]" (local time, on the day of
 * `ref`) into Unix seconds; NaN if not understood.
 */
export function parseTime(text, ref = Date.now() / 1000) {
  const m = /^\s*(?:(\d{4})-(\d{1,2})-(\d{1,2})[ T])?(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?\s*$/.exec(String(text ?? ""));
  if (!m) return NaN;
  const d = m[1] ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(ref * 1000);
  if (+m[4] > 23 || +m[5] > 59) return NaN;
  d.setHours(+m[4], +m[5], 0, 0);
  return d.getTime() / 1000 + (m[6] ? parseFloat(m[6]) : 0);
}

/** Pen description with defaults. */
export function penOf(p, j, colors) {
  const min = parseNumber(p?.min);
  const max = parseNumber(p?.max);
  const ok = Number.isFinite(min) && Number.isFinite(max) && max > min;
  return {
    name: String(p?.name ?? `pen ${j + 1}`),
    unit: String(p?.unit ?? ""),
    min: ok ? min : 0,
    max: ok ? max : 100,
    color: safeColor(p?.color) || colors.trace(j),
    format: p?.format || "%.4g",
    limits: ["lolo", "lo", "hi", "hihi"].map((k) => parseNumber(p?.[k])).filter(Number.isFinite),
    setpoint: parseNumber(p?.setpoint),
  };
}

export class TrendView extends PlotView {
  constructor(model, el) {
    super(model, el, TRAITS);
    this.margin.right = 16;
    this.follow = true; // live mode: the view follows new samples (IND-071)
    this.windowEnd = NaN;
    this.selected = 0;
    this.buildNav();
    this.resetRings();
    this.listen("msg:custom", (msg, buffers) => this.onMessage(msg, buffers));
    this.listen("change:pens", () => this.resetRings());
    this.listen("change:history", () => this.resetRings());
    this.model.send({ type: "sync_request" }); // new view: fetch the kernel history
  }

  // -- history navigation (IND-072) ------------------------------------------------------
  buildNav() {
    const nav = html("span", { cls: "awi-trend-nav" });
    const btn = (text, label, onClick) => {
      const b = html("button", { text, attrs: { type: "button", title: label, "aria-label": label } });
      b.addEventListener("click", () => this.canInteract && onClick());
      nav.appendChild(b);
      return b;
    };
    btn("◀", "Earlier", () => this.shift(-0.5));
    btn("▶", "Later", () => this.shift(0.5));
    this.liveBtn = btn("● Live", "Follow the latest data", () => this.goLive());
    this.spanSel = html("select", { cls: "awi-choice", attrs: { "aria-label": "Time span", "data-lm-suppress-shortcuts": "true" } });
    this.spanSel.addEventListener("change", () => {
      if (!this.canInteract) return;
      this.model.set("span", Number(this.spanSel.value));
      this.model.save_changes();
      this.zoom = null;
      this.schedule();
    });
    nav.appendChild(this.spanSel);
    this.toolbar.prepend(nav);
  }

  get span() {
    const s = parseNumber(this.get("span"));
    return s > 0 ? s : 600;
  }

  shift(fraction) {
    const end = (this.follow ? this.tmax() : this.windowEnd) + fraction * this.span;
    this.zoom = null;
    if (fraction > 0 && end >= this.tmax()) return this.goLive();
    const first = this.tmin();
    this.follow = false;
    this.windowEnd = Number.isFinite(first) ? Math.max(end, first + this.span * 0.1) : end;
    this.schedule();
  }

  goLive() {
    this.follow = true;
    this.zoom = null;
    this.schedule();
  }

  // -- data ---------------------------------------------------------------------------
  get pens() {
    const colors = this._colors || this.colors();
    return (this.get("pens") || []).map((p, j) => penOf(p, j, colors));
  }

  resetRings() {
    const cap = Math.max(2, parseNumber(this.get("history")) || 2);
    this.rings = (this.get("pens") || []).map(() => new PenRing(cap));
    this.schedule();
  }

  onMessage(msg, buffers) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "clear") {
      this.resetRings();
      return;
    }
    if (msg.type !== "snapshot" && msg.type !== "append") return;
    if (msg.type === "snapshot") this.resetRings();
    (msg.pens || []).forEach(([i, n, total], k) => {
      const ring = this.rings[i];
      if (!ring) return;
      if (ring.total < total - n) ring.total = total - n;
      ring.push(toFloat64(buffers?.[2 * k]), toFloat32(buffers?.[2 * k + 1]), n);
    });
    this.schedule();
  }

  tmax() {
    const last = this.rings.map((r) => r.last).filter(Number.isFinite);
    return last.length ? Math.max(...last) : Date.now() / 1000;
  }

  tmin() {
    const first = this.rings.map((r) => r.first).filter(Number.isFinite);
    return first.length ? Math.min(...first) : NaN;
  }

  // -- geometry --------------------------------------------------------------------------
  fullRange() {
    // zooming or panning while live freezes the window (IND-072)
    if (this.zoom && this.follow) {
      this.follow = false;
      this.windowEnd = this.tmax();
    }
    const end = this.follow ? this.tmax() : this.windowEnd;
    const pens = this.pens;
    this.selected = Math.min(this.selected, Math.max(0, pens.length - 1));
    const p = pens[this.selected] || { min: 0, max: 100 };
    return { x: [end - this.span, end], y: [p.min, p.max] };
  }

  /** Value of pen j on the scale of the selected pen. */
  toAxis(pens, j, v) {
    const p = pens[j];
    const s = pens[this.selected] || p;
    return s.min + ((v - p.min) / (p.max - p.min)) * (s.max - s.min);
  }

  xTicks(a, b) {
    const { step, ticks } = timeTicks(a, b, 5);
    this._step = step;
    return ticks;
  }

  xLabel(v) {
    return timeLabel(v, this._step || 60);
  }

  xText(v) {
    return timeText(v);
  }

  parseX(text) {
    return parseTime(text, this.follow ? this.tmax() : this.windowEnd);
  }

  checkX(text) {
    const v = this.parseX(text);
    if (!Number.isFinite(v)) return { ok: false, reason: "Not a time: enter HH:MM:SS or YYYY-MM-DD HH:MM:SS" };
    const [a, b] = this.fullRange().x;
    if (v < a || v > b) return { ok: false, reason: `Out of range: enter a time between ${timeText(a)} … ${timeText(b)}` };
    return { ok: true, value: v };
  }

  cursorText(x) {
    const vals = this.pens.map((p, j) => `${formatValue(this.rings[j]?.at(x), p.format)}${p.unit ? ` ${p.unit}` : ""}`);
    return `→ ${vals.join(", ")}`;
  }

  // -- drawing ------------------------------------------------------------------------------
  /** Displayed samples of pen j: cb(time, value) with one sample before/after the range. */
  forEachSample(j, r, cb) {
    const ring = this.rings[j];
    if (!ring) return;
    const k0 = Math.max(0, ring.lowerBound(r.x[0]) - 1);
    const k1 = Math.min(ring.size, ring.lowerBound(r.x[1]) + 1);
    for (let k = k0; k < k1; k++) cb(ring.timeAt(k), ring.valueAt(k));
  }

  draw() {
    const ctx = this.prepareCanvas();
    if (!ctx) return;
    const colors = (this._colors = this.colors());
    const [w, h] = this.get("size");
    ctx.clearRect(0, 0, w, h);
    const area = this.area();
    const r = this.ranges();
    const pens = this.pens;
    this.drawAxes(ctx, area, r, colors);
    const { X, Y } = this.mappers(area, r);
    ctx.save();
    ctx.beginPath();
    ctx.rect(area.x, area.y, area.w, area.h);
    ctx.clip();
    pens.forEach((p, j) => {
      // reference lines: alarm limits dashed, setpoint dotted (IND-073)
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.7;
      for (const [values, dash] of [[p.limits, [6, 4]], [Number.isFinite(p.setpoint) ? [p.setpoint] : [], [2, 3]]]) {
        ctx.setLineDash(dash);
        for (const v of values) {
          const y = Math.round(Y(this.toAxis(pens, j, v))) + 0.5;
          ctx.beginPath(); ctx.moveTo(area.x, y); ctx.lineTo(area.x + area.w, y); ctx.stroke();
        }
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.lineWidth = j === this.selected ? 2 : 1.5;
      ctx.beginPath();
      let pen = false;
      this.forEachSample(j, r, (t, v) => {
        if (!Number.isFinite(v)) { pen = false; return; }
        const x = X(t);
        const y = Y(this.toAxis(pens, j, v));
        if (pen) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        pen = true;
      });
      ctx.stroke();
    });
    ctx.restore();
    this.drawOverlays(ctx, area, r, colors);
    // scale of the selected pen, and the live / history state (text, not only color)
    const sel = pens[this.selected];
    ctx.font = "10px system-ui, sans-serif";
    ctx.textBaseline = "top";
    if (sel) {
      ctx.fillStyle = sel.color;
      ctx.textAlign = "left";
      ctx.fillText(`${sel.name}${sel.unit ? ` (${sel.unit})` : ""}`, area.x + 4, area.y + 3);
    }
    ctx.fillStyle = colors.accent;
    ctx.textAlign = "right";
    ctx.fillText(this.follow ? "● LIVE" : "❚❚ HISTORY", area.x + area.w - 4, area.y + 3);
    this.drawLegend(pens);
    const vals = this.get("value") || {};
    const summary = pens.map((p) => `${p.name} ${formatValue(parseNumber(vals[p.name]), p.format)}${p.unit ? ` ${p.unit}` : ""}`);
    this.body.setAttribute("aria-label", `${this.get("label") || "Trend"}${this.follow ? "" : " (history)"}: ${summary.join(", ")}`);
  }

  renderCommon() {
    super.renderCommon();
    const span = this.span;
    const opts = SPANS.some(([s]) => s === span) ? SPANS : [...SPANS, [span, `${formatValue(span, "%.4g")} s`]].sort((a, b) => a[0] - b[0]);
    if (this.spanSel.options.length !== opts.length) {
      clear(this.spanSel);
      for (const [s, text] of opts) this.spanSel.appendChild(html("option", { text, attrs: { value: String(s) } }));
    }
    this.spanSel.value = String(span);
    this.spanSel.disabled = !this.canInteract;
    this.liveBtn.setAttribute("aria-pressed", String(this.follow && !this.zoom));
  }

  /** Legend: one button per pen; the selected pen gives the vertical scale. */
  drawLegend(pens) {
    const key = JSON.stringify(pens.map((p) => [p.name, p.color]));
    if (this._legendKey !== key) {
      this._legendKey = key;
      clear(this.legend);
      pens.forEach((p, j) => {
        const sw = html("span", { cls: "awi-swatch" });
        sw.style.background = p.color;
        const b = html("button", { cls: "awi-legend-item awi-pen", attrs: { type: "button", title: `Show the scale of ${p.name}` } }, [sw, html("span")]);
        b.addEventListener("click", () => {
          this.selected = j;
          this.schedule();
        });
        this.legend.appendChild(b);
      });
    }
    this.legend.hidden = pens.length === 0;
    const vals = this.get("value") || {};
    [...this.legend.children].forEach((b, j) => {
      const p = pens[j];
      if (!p) return;
      b.lastChild.textContent = `${p.name} ${formatValue(parseNumber(vals[p.name]), p.format)}${p.unit ? ` ${p.unit}` : ""} [${formatValue(p.min, "%.4g")} … ${formatValue(p.max, "%.4g")}]`;
      b.setAttribute("aria-pressed", String(j === this.selected));
    });
  }

  // -- export (CHART-107) --------------------------------------------------------------------
  csvRows() {
    const r = this.ranges();
    const rows = [["time", "pen", "value", "unit"]];
    this.pens.forEach((p, j) => {
      this.forEachSample(j, r, (t, v) => {
        if (t >= r.x[0] && t <= r.x[1]) rows.push([new Date(t * 1000).toISOString(), p.name, v, p.unit]);
      });
    });
    return rows;
  }

  svgContent(area, r, colors, el) {
    const { X, Y } = this.mappers(area, r);
    const pens = this.pens;
    return pens.map((p, j) => {
      let d = "";
      let pen = false;
      this.forEachSample(j, r, (t, v) => {
        if (!Number.isFinite(v)) { pen = false; return; }
        d += `${pen ? "L" : "M"}${X(t).toFixed(1)} ${Y(this.toAxis(pens, j, v)).toFixed(1)}`;
        pen = true;
      });
      return el("path", { d, fill: "none", stroke: p.color, "stroke-width": 1.5 });
    });
  }
}
