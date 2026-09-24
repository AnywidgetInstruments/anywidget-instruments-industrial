// Base view of every graph: canvas plot area, axes, zoom tool, cursors,
// annotations and export (CHART-104..107).
import { html, safeColor } from "./dom.js";
import { formatValue } from "./format.js";
import { niceTicks, parseNumber } from "./scale.js";
import { BaseView } from "./view.js";

export const PLOT_TRAITS = ["cursors", "cursor_values", "annotations", "export", "x_unit", "unit"];

/** Zoom state → data ranges. `zoom.fx` is a fraction of the full x range. */
export function zoomedRanges(full, zoom) {
  if (!zoom) return full;
  const span = full.x[1] - full.x[0];
  const x = zoom.fx ? [full.x[0] + zoom.fx[0] * span, full.x[0] + zoom.fx[1] * span] : full.x;
  return { x, y: zoom.y || full.y };
}

/** Rectangle (pixels in the plot area) → zoom state. */
export function zoomFromRect(full, current, area, r) {
  const cur = zoomedRanges(full, current);
  const fx = (px) => (px - area.x) / area.w;
  const fy = (py) => 1 - (py - area.y) / area.h;
  const xa = cur.x[0] + Math.min(fx(r.x0), fx(r.x1)) * (cur.x[1] - cur.x[0]);
  const xb = cur.x[0] + Math.max(fx(r.x0), fx(r.x1)) * (cur.x[1] - cur.x[0]);
  const ya = cur.y[0] + Math.min(fy(r.y0), fy(r.y1)) * (cur.y[1] - cur.y[0]);
  const yb = cur.y[0] + Math.max(fy(r.y0), fy(r.y1)) * (cur.y[1] - cur.y[0]);
  const span = full.x[1] - full.x[0] || 1;
  return { fx: [(xa - full.x[0]) / span, (xb - full.x[0]) / span], y: [ya, yb] };
}

/** Trigger a browser download of a Blob (no network access involved). */
export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = html("a", { attrs: { href: url, download: filename } });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export class PlotView extends BaseView {
  constructor(model, el, traits = []) {
    super(model, el, [...PLOT_TRAITS, ...traits]);
    this.margin = { left: 52, right: 12, top: 8, bottom: 24 };
    this.canvas = html("canvas", { cls: "awi-canvas" });
    this.zoomBox = html("div", { cls: "awi-zoom-box" });
    this.zoomBox.hidden = true;
    this.body.append(this.canvas, this.zoomBox);
    this.body.setAttribute("role", "img");
    this.toolbar = html("div", { cls: "awi-toolbar", attrs: { role: "toolbar", "aria-label": "Graph tools" } });
    this.root.insertBefore(this.toolbar, this.body);
    this.legend = html("div", { cls: "awi-legend" });
    this.root.appendChild(this.legend);
    this.zoom = null;
    this.tool = "none";
    this.dragCursor = null; // { index, x }
    this.buildToolbar();
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    c.addEventListener("pointermove", (e) => this.onHover(e));
    c.addEventListener("dblclick", () => this.resetZoom());
    c.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
  }

  /** Graph interactions (zoom, cursors) are allowed on indicators too. */
  get canInteract() {
    return !this.get("disabled") && this.stale === "live";
  }

  // -- toolbar -------------------------------------------------------------------
  buildToolbar() {
    const btn = (text, label, onClick) => {
      const b = html("button", { text, attrs: { type: "button", title: label, "aria-label": label } });
      b.addEventListener("click", onClick);
      this.toolbar.appendChild(b);
      return b;
    };
    this.zoomBtn = btn("⬚ Zoom", "Zoom tool: drag a rectangle", () => {
      this.tool = this.tool === "zoom" ? "none" : "zoom";
      this.schedule();
    });
    btn("⤢ Reset", "Restore the full view", () => this.resetZoom());
    btn("⌖ Cursor", "Add a cursor", () => this.addCursor());
    this.exportBtns = [
      btn("CSV", "Download data as CSV", () => this.exportCsv()),
      btn("PNG", "Download image as PNG", () => this.exportPng()),
      btn("SVG", "Download image as SVG", () => this.exportSvg()),
    ];
  }

  resetZoom() {
    this.zoom = null;
    this.schedule();
  }

  // -- geometry --------------------------------------------------------------------
  area() {
    const [w, h] = this.get("size");
    const m = this.margin;
    return { x: m.left, y: m.top, w: Math.max(10, w - m.left - m.right), h: Math.max(10, h - m.top - m.bottom) };
  }

  /** Subclasses: full data ranges { x: [a, b], y: [c, d] }. */
  fullRange() {
    return { x: [0, 1], y: [0, 1] };
  }

  ranges() {
    return zoomedRanges(this.fullRange(), this.zoom);
  }

  mappers(area, r) {
    const X = (x) => area.x + ((x - r.x[0]) / (r.x[1] - r.x[0] || 1)) * area.w;
    const Y = (y) => area.y + area.h - ((y - r.y[0]) / (r.y[1] - r.y[0] || 1)) * area.h;
    const invX = (px) => r.x[0] + ((px - area.x) / area.w) * (r.x[1] - r.x[0]);
    return { X, Y, invX };
  }

  colors() {
    const cs = getComputedStyle(this.root);
    const v = (n, d) => cs.getPropertyValue(n).trim() || d;
    return {
      fg: v("--awi-fg", "#1f2937"),
      muted: v("--awi-muted", "#6b7280"),
      grid: v("--awi-grid", "#e5e7eb"),
      bg: v("--awi-plot-bg", "#ffffff"),
      accent: v("--awi-accent", "#2563eb"),
      trace: (i) => v(`--awi-trace-${i % 8}`, "#2563eb"),
    };
  }

  // -- interaction -------------------------------------------------------------------
  localPoint(e) {
    const r = this.canvas.getBoundingClientRect();
    const [w, h] = this.get("size");
    return { x: ((e.clientX - r.left) * w) / (r.width || w), y: ((e.clientY - r.top) * h) / (r.height || h) };
  }

  cursorAt(px) {
    const area = this.area();
    const { X } = this.mappers(area, this.ranges());
    const cursors = this.get("cursors") || [];
    for (let i = cursors.length - 1; i >= 0; i--) {
      if (Math.abs(X(parseNumber(cursors[i].x)) - px) <= 5) return i;
    }
    return -1;
  }

  onHover(e) {
    if (this.dragCursor || this.zoomRect) return;
    const p = this.localPoint(e);
    this.canvas.style.cursor = this.canInteract && this.cursorAt(p.x) >= 0 ? "ew-resize" : this.tool === "zoom" ? "crosshair" : "";
  }

  onPointerDown(e) {
    if (!this.canInteract || e.button !== 0) return;
    const p = this.localPoint(e);
    const area = this.area();
    const idx = this.cursorAt(p.x);
    const c = this.canvas;
    c.setPointerCapture?.(e.pointerId);
    let move;
    let up;
    if (idx >= 0) {
      // CHART-104: drag a cursor
      const { invX } = this.mappers(area, this.ranges());
      this.dragCursor = { index: idx, x: invX(p.x) };
      move = (ev) => {
        const q = this.localPoint(ev);
        const clamped = Math.min(area.x + area.w, Math.max(area.x, q.x));
        this.dragCursor.x = this.mappers(area, this.ranges()).invX(clamped);
        this.schedule();
      };
      up = () => {
        const cursors = (this.get("cursors") || []).map((cur, i) => (i === this.dragCursor.index ? { ...cur, x: this.dragCursor.x } : cur));
        this.dragCursor = null;
        this.model.set("cursors", cursors);
        this.model.save_changes();
        this.schedule();
      };
    } else if (this.tool === "zoom") {
      // CHART-106: zoom on the selected region
      this.zoomRect = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      move = (ev) => {
        const q = this.localPoint(ev);
        this.zoomRect.x1 = Math.min(area.x + area.w, Math.max(area.x, q.x));
        this.zoomRect.y1 = Math.min(area.y + area.h, Math.max(area.y, q.y));
        this.showZoomBox();
      };
      up = () => {
        const r = this.zoomRect;
        this.zoomRect = null;
        this.zoomBox.hidden = true;
        if (Math.abs(r.x1 - r.x0) > 4 && Math.abs(r.y1 - r.y0) > 4) {
          this.zoom = zoomFromRect(this.fullRange(), this.zoom, area, r);
          this.schedule();
        }
      };
    } else if (this.zoom) {
      // pan the zoomed view along x
      const x0 = p.x;
      const z0 = { ...this.zoom, fx: (this.zoom.fx || [0, 1]).slice() };
      move = (ev) => {
        const span = z0.fx[1] - z0.fx[0];
        let d = (-(this.localPoint(ev).x - x0) / area.w) * span;
        d = Math.max(-z0.fx[0], Math.min(1 - z0.fx[1], d));
        this.zoom = { ...z0, fx: [z0.fx[0] + d, z0.fx[1] + d] };
        this.schedule();
      };
      up = () => {};
    } else {
      return;
    }
    const end = () => {
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", end);
      c.removeEventListener("pointercancel", end);
      up();
    };
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
  }

  showZoomBox() {
    const r = this.zoomRect;
    const b = this.zoomBox;
    const cr = this.canvas.getBoundingClientRect();
    const [w] = this.get("size");
    const k = (cr.width || w) / w;
    b.hidden = false;
    b.style.left = `${Math.min(r.x0, r.x1) * k}px`;
    b.style.top = `${Math.min(r.y0, r.y1) * k}px`;
    b.style.width = `${Math.abs(r.x1 - r.x0) * k}px`;
    b.style.height = `${Math.abs(r.y1 - r.y0) * k}px`;
  }

  onWheel(e) {
    if (!this.canInteract || !(e.ctrlKey || this.tool === "zoom" || this.zoom)) return;
    e.preventDefault();
    const area = this.area();
    const fx = Math.min(1, Math.max(0, (this.localPoint(e).x - area.x) / area.w));
    const [a, b] = this.zoom?.fx || [0, 1];
    const at = a + fx * (b - a);
    const k = e.deltaY < 0 ? 0.8 : 1.25;
    const na = Math.max(0, at - (at - a) * k);
    const nb = Math.min(1, at + (b - at) * k);
    const y = this.zoom?.y || null;
    this.zoom = nb - na >= 0.999 && !y ? null : { fx: [na, nb], y };
    this.schedule();
  }

  addCursor() {
    if (!this.canInteract) return;
    const r = this.ranges();
    const cursors = this.get("cursors") || [];
    this.model.set("cursors", [...cursors, { x: (r.x[0] + r.x[1]) / 2, name: `C${cursors.length + 1}`, color: "" }]);
    this.model.save_changes();
    this.schedule();
  }

  // -- drawing --------------------------------------------------------------------------
  prepareCanvas() {
    const [w, h] = this.get("size");
    const dpr = (typeof devicePixelRatio !== "undefined" && devicePixelRatio) || 1;
    const c = this.canvas;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    const ctx = c.getContext?.("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  /** Label of an x-axis value (subclasses may override). */
  xLabel(v) {
    const u = this.get("x_unit");
    const t = formatValue(v, "%.3g");
    return u ? `${t} ${u}` : t;
  }

  drawAxes(ctx, area, r, colors, { yTicks = true } = {}) {
    const { X, Y } = this.mappers(area, r);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(area.x, area.y, area.w, area.h);
    ctx.font = "10px system-ui, sans-serif";
    ctx.strokeStyle = colors.grid;
    ctx.fillStyle = colors.fg;
    ctx.lineWidth = 1;
    if (yTicks) {
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (const v of niceTicks(r.y[0], r.y[1], 4)) {
        const y = Math.round(Y(v)) + 0.5;
        ctx.beginPath(); ctx.moveTo(area.x, y); ctx.lineTo(area.x + area.w, y); ctx.stroke();
        ctx.fillText(formatValue(v, "%.3g"), area.x - 4, y);
      }
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const v of niceTicks(r.x[0], r.x[1], 5)) {
      const x = Math.round(X(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, area.y); ctx.lineTo(x, area.y + area.h); ctx.stroke();
      ctx.fillText(this.xLabel(v), x, area.y + area.h + 4);
    }
  }

  /** Values under a cursor, as display strings (subclasses). */
  cursorText(_x) {
    return "";
  }

  drawOverlays(ctx, area, r, colors) {
    const { X, Y } = this.mappers(area, r);
    // annotations (CHART-105)
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    for (const a of this.get("annotations") || []) {
      const x = X(parseNumber(a.x));
      const y = Y(parseNumber(a.y));
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < area.x || x > area.x + area.w || y < area.y || y > area.y + area.h) continue;
      const col = safeColor(a.color) || colors.fg;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x, y, 3, 0, 2 * Math.PI); ctx.fill();
      ctx.fillText(String(a.text ?? ""), x + 5, y - 3);
    }
    // cursors (CHART-104)
    const cursors = this.get("cursors") || [];
    cursors.forEach((c, i) => {
      const cx = this.dragCursor?.index === i ? this.dragCursor.x : parseNumber(c.x);
      const x = Math.round(X(cx)) + 0.5;
      if (x < area.x || x > area.x + area.w) return;
      const col = safeColor(c.color) || colors.accent;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(x, area.y); ctx.lineTo(x, area.y + area.h); ctx.stroke();
      ctx.setLineDash([]);
      const label = `${c.name || `C${i + 1}`}: ${this.xLabel(cx)} ${this.cursorText(cx)}`.trim();
      ctx.font = "10px system-ui, sans-serif";
      const tw = ctx.measureText(label).width + 8;
      const lx = Math.min(x + 3, area.x + area.w - tw);
      const ly = area.y + 2 + i * 14;
      ctx.fillStyle = colors.bg;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(lx, ly, tw, 13);
      ctx.globalAlpha = 1;
      ctx.fillStyle = col;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(label, lx + 4, ly + 1);
    });
    ctx.strokeStyle = colors.fg;
    ctx.strokeRect(area.x + 0.5, area.y + 0.5, area.w - 1, area.h - 1);
    if (this.zoom) {
      ctx.fillStyle = colors.accent;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText("🔍 zoomed (double-click to reset)", area.x + 4, area.y + area.h - 14);
    }
  }

  renderCommon() {
    super.renderCommon();
    this.zoomBtn.setAttribute("aria-pressed", String(this.tool === "zoom"));
    for (const b of this.exportBtns) b.hidden = !this.get("export");
  }

  // -- export (CHART-107) ------------------------------------------------------------------
  /** Subclasses: rows for CSV export, first row is the header. */
  csvRows() {
    return [];
  }

  exportCsv() {
    const esc = (v) => {
      const s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const text = this.csvRows().map((row) => row.map(esc).join(",")).join("\n");
    download(new Blob([text], { type: "text/csv" }), `${this.get("label") || this.kind}.csv`);
  }

  exportPng() {
    this.canvas.toBlob((b) => b && download(b, `${this.get("label") || this.kind}.png`), "image/png");
  }

  /** Subclasses: SVG elements (paths) for the plot content. */
  svgContent(_area, _ranges, _colors) {
    return [];
  }

  buildSvg() {
    const [w, h] = this.get("size");
    const NS = "http://www.w3.org/2000/svg";
    const el = (tag, attrs = {}, text) => {
      const n = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      if (text !== undefined) n.textContent = text;
      return n;
    };
    const colors = this.colors();
    const area = this.area();
    const r = this.ranges();
    const { X, Y } = this.mappers(area, r);
    const root = el("svg", { xmlns: NS, width: w, height: h, viewBox: `0 0 ${w} ${h}`, "font-family": "sans-serif", "font-size": 10 });
    root.appendChild(el("rect", { x: area.x, y: area.y, width: area.w, height: area.h, fill: colors.bg, stroke: colors.fg }));
    for (const v of niceTicks(r.y[0], r.y[1], 4)) {
      root.appendChild(el("line", { x1: area.x, x2: area.x + area.w, y1: Y(v), y2: Y(v), stroke: colors.grid }));
      root.appendChild(el("text", { x: area.x - 4, y: Y(v), "text-anchor": "end", "dominant-baseline": "middle", fill: colors.fg }, formatValue(v, "%.3g")));
    }
    for (const v of niceTicks(r.x[0], r.x[1], 5)) {
      root.appendChild(el("line", { x1: X(v), x2: X(v), y1: area.y, y2: area.y + area.h, stroke: colors.grid }));
      root.appendChild(el("text", { x: X(v), y: area.y + area.h + 14, "text-anchor": "middle", fill: colors.fg }, this.xLabel(v)));
    }
    const clipId = `${this.id}-clip`;
    const defs = el("defs");
    const cp = el("clipPath", { id: clipId });
    cp.appendChild(el("rect", { x: area.x, y: area.y, width: area.w, height: area.h }));
    defs.appendChild(cp);
    root.appendChild(defs);
    const g = el("g", { "clip-path": `url(#${clipId})` });
    for (const item of this.svgContent(area, r, colors, el)) g.appendChild(item);
    root.appendChild(g);
    for (const a of this.get("annotations") || []) {
      root.appendChild(el("text", { x: X(parseNumber(a.x)) + 5, y: Y(parseNumber(a.y)) - 3, fill: safeColor(a.color) || colors.fg }, String(a.text ?? "")));
    }
    return root;
  }

  exportSvg() {
    const text = new XMLSerializer().serializeToString(this.buildSvg());
    download(new Blob([text], { type: "image/svg+xml" }), `${this.get("label") || this.kind}.svg`);
  }
}
