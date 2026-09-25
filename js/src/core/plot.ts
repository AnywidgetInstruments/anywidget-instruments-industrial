// Base view of every graph: canvas plot area, axes, zoom tool, cursors,
// annotations and export (CHART-104..107).
import type { GraphWidgetTraits } from "../generated/contract.js";
import { clear, html, safeColor, setAttr, setHidden, setText } from "./dom.js";
import { checkEntry, type EntryResult } from "./entry.js";
import { formatValue, parseEntry } from "./format.js";
import type { AnyModel } from "./model.js";
import { niceTicks, parseNumber } from "./scale.js";
import { BaseView } from "./view.js";

export const PLOT_TRAITS = ["cursors", "cursor_values", "annotations", "export", "x_unit", "unit"];

export type Range = [number, number];
export interface Ranges {
  x: Range;
  y: Range;
}
/** Zoom state: `fx` is a fraction of the full x range, `y` a data range (null: full). */
export interface Zoom {
  fx?: Range;
  y?: Range | null;
}
export interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface Mappers {
  X: (x: number) => number;
  Y: (y: number) => number;
  invX: (px: number) => number;
}
export interface Colors {
  fg: string;
  muted: string;
  grid: string;
  bg: string;
  accent: string;
  trace: (i: number) => string;
}
/** Builder of SVG elements for the SVG export. */
export type SvgBuilder = (tag: string, attrs?: Record<string, string | number>, text?: string) => SVGElement;
type Cell = string | number | null | undefined;

/** Zoom state → data ranges. */
export function zoomedRanges(full: Ranges, zoom: Zoom | null): Ranges {
  if (!zoom) return full;
  const span = full.x[1] - full.x[0];
  const x: Range = zoom.fx ? [full.x[0] + zoom.fx[0] * span, full.x[0] + zoom.fx[1] * span] : full.x;
  return { x, y: zoom.y || full.y };
}

/** Rectangle (pixels in the plot area) → zoom state. */
export function zoomFromRect(full: Ranges, current: Zoom | null, area: Area, r: Rect): Zoom {
  const cur = zoomedRanges(full, current);
  const fx = (px: number): number => (px - area.x) / area.w;
  const fy = (py: number): number => 1 - (py - area.y) / area.h;
  const xa = cur.x[0] + Math.min(fx(r.x0), fx(r.x1)) * (cur.x[1] - cur.x[0]);
  const xb = cur.x[0] + Math.max(fx(r.x0), fx(r.x1)) * (cur.x[1] - cur.x[0]);
  const ya = cur.y[0] + Math.min(fy(r.y0), fy(r.y1)) * (cur.y[1] - cur.y[0]);
  const yb = cur.y[0] + Math.max(fy(r.y0), fy(r.y1)) * (cur.y[1] - cur.y[0]);
  const span = full.x[1] - full.x[0] || 1;
  return { fx: [(xa - full.x[0]) / span, (xb - full.x[0]) / span], y: [ya, yb] };
}

/** Trigger a browser download of a Blob (no network access involved). */
export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = html("a", { attrs: { href: url, download: filename } });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export class PlotView<T extends GraphWidgetTraits = GraphWidgetTraits> extends BaseView<T> {
  margin = { left: 52, right: 12, top: 8, bottom: 24 };
  readonly canvas: HTMLCanvasElement;
  readonly zoomBox: HTMLDivElement;
  readonly toolbar: HTMLDivElement;
  readonly cursorBar: HTMLDivElement;
  readonly axesPanel: HTMLDivElement;
  readonly legend: HTMLDivElement;
  axisFields!: { x0: HTMLInputElement; x1: HTMLInputElement; y0: HTMLInputElement; y1: HTMLInputElement };
  axisUnits!: { x: HTMLSpanElement; y: HTMLSpanElement };
  axesMsg!: HTMLDivElement;
  zoomBtn!: HTMLButtonElement;
  axesBtn!: HTMLButtonElement;
  exportBtns: HTMLButtonElement[] = [];
  zoom: Zoom | null = null;
  tool: "none" | "zoom" = "none";
  dragCursor: { index: number; x: number } | null = null;
  zoomRect: Rect | null = null;

  constructor(model: AnyModel<T>, el: HTMLElement, traits: string[] = []) {
    super(model, el, [...PLOT_TRAITS, ...traits]);
    this.canvas = html("canvas", { cls: "awi-canvas" });
    this.zoomBox = html("div", { cls: "awi-zoom-box" });
    this.zoomBox.hidden = true;
    this.body.append(this.canvas, this.zoomBox);
    this.body.setAttribute("role", "img");
    this.toolbar = html("div", { cls: "awi-toolbar", attrs: { role: "toolbar", "aria-label": "Graph tools" } });
    this.root.insertBefore(this.toolbar, this.body);
    // form entry for cursor positions (API-014): one field per cursor
    this.cursorBar = html("div", { cls: "awi-cursor-bar", attrs: { role: "group", "aria-label": "Cursor positions" } });
    this.axesPanel = this.buildAxesPanel();
    this.root.insertBefore(this.axesPanel, this.body);
    this.legend = html("div", { cls: "awi-legend" });
    this.root.append(this.cursorBar, this.legend);
    this.buildToolbar();
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    c.addEventListener("pointermove", (e) => this.onHover(e));
    c.addEventListener("dblclick", () => this.resetZoom());
    c.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
  }

  /** Graph interactions (zoom, cursors) are allowed on indicators too. */
  get canInteract(): boolean {
    return !this.get("disabled") && this.stale === "live";
  }

  // -- toolbar -------------------------------------------------------------------
  buildToolbar(): void {
    const btn = (text: string, label: string, onClick: () => void): HTMLButtonElement => {
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
    this.axesBtn = btn("↕ Axes", "Set the axis ranges", () => this.toggleAxesPanel());
    this.exportBtns = [btn("CSV", "Download data as CSV", () => this.exportCsv()), btn("PNG", "Download image as PNG", () => this.exportPng()), btn("SVG", "Download image as SVG", () => this.exportSvg())];
  }

  // -- axis ranges by form entry (CHART-108) --------------------------------------------
  buildAxesPanel(): HTMLDivElement {
    const panel = html("div", { cls: "awi-axes-panel", attrs: { role: "group", "aria-label": "Axis ranges" } });
    panel.hidden = true;
    const field = (name: string): HTMLInputElement => {
      const f = html("input", { cls: "awi-entry", attrs: { type: "text", inputmode: "decimal", "aria-label": name, "data-lm-suppress-shortcuts": "true" } });
      f.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          this.applyAxes();
        } else if (e.key === "Escape") this.toggleAxesPanel(false);
      });
      return f;
    };
    this.axisFields = { x0: field("X minimum"), x1: field("X maximum"), y0: field("Y minimum"), y1: field("Y maximum") };
    this.axisUnits = { x: html("span", { cls: "awi-entry-unit" }), y: html("span", { cls: "awi-entry-unit" }) };
    const apply = html("button", { text: "Apply", attrs: { type: "button" } });
    apply.addEventListener("click", () => this.applyAxes());
    const auto = html("button", { text: "Auto", attrs: { type: "button", title: "Full range and automatic scale" } });
    auto.addEventListener("click", () => this.autoAxes());
    this.axesMsg = html("div", { cls: "awi-entry-msg", attrs: { role: "alert" } });
    const f = this.axisFields;
    panel.append(
      html("span", { cls: "awi-axis-row" }, [html("b", { text: "X" }), f.x0, html("span", { text: "…" }), f.x1, this.axisUnits.x]),
      html("span", { cls: "awi-axis-row" }, [html("b", { text: "Y" }), f.y0, html("span", { text: "…" }), f.y1, this.axisUnits.y]),
      apply,
      auto,
      this.axesMsg,
    );
    return panel;
  }

  toggleAxesPanel(open: boolean = this.axesPanel.hidden): void {
    this.axesPanel.hidden = !open;
    this.axesBtn?.setAttribute("aria-pressed", String(open));
    if (!open) return;
    const r = this.ranges();
    const fmt = (v: number): string => formatValue(v, "%.4g");
    const f = this.axisFields;
    [f.x0.value, f.x1.value, f.y0.value, f.y1.value] = [this.xText(r.x[0]), this.xText(r.x[1]), fmt(r.y[0]), fmt(r.y[1])];
    this.axisUnits.x.textContent = this.get("x_unit") || "";
    this.axisUnits.y.textContent = this.get("unit") || "";
    this.axesMsg.textContent = "";
    f.x0.focus();
  }

  /** Charts whose Y scale is a synchronized setting (WaveformChart). */
  get yIsSetting(): boolean {
    return this.get("autoscale_y") !== undefined;
  }

  applyAxes(): void {
    if (!this.canInteract) return;
    const f = this.axisFields;
    const unit = this.get("unit") || "";
    const [x0, x1] = [this.parseX(f.x0.value), this.parseX(f.x1.value)];
    const [y0, y1] = [parseEntry(f.y0.value, unit), parseEntry(f.y1.value, unit)];
    for (const [a, b, name] of [[x0, x1, "X"], [y0, y1, "Y"]] as Array<[number, number, string]>) {
      if (!Number.isFinite(a) || !Number.isFinite(b)) return this.axisError(`${name}: enter two numbers`);
      if (!(a < b)) return this.axisError(`${name}: the minimum must be below the maximum`);
    }
    this.axisError("");
    const full = this.fullRange();
    const span = full.x[1] - full.x[0] || 1;
    const zoom: Zoom = { fx: [(x0 - full.x[0]) / span, (x1 - full.x[0]) / span], y: [y0, y1] };
    if (this.yIsSetting) {
      // the Y range is a chart setting: the host keeps it (autoscale off)
      zoom.y = null;
      const m = this.model as unknown as AnyModel;
      m.set("autoscale_y", false);
      m.set("y_min", y0);
      m.set("y_max", y1);
      m.save_changes();
    }
    this.zoom = zoom;
    this.schedule();
  }

  autoAxes(): void {
    if (!this.canInteract) return;
    this.zoom = null;
    if (this.yIsSetting) {
      const m = this.model as unknown as AnyModel;
      m.set("autoscale_y", true);
      m.save_changes();
    }
    this.axisError("");
    this.toggleAxesPanel(false);
    this.schedule();
  }

  axisError(reason: string): void {
    this.axesMsg.textContent = reason;
    for (const field of Object.values(this.axisFields)) field.toggleAttribute("aria-invalid", !!reason);
  }

  /** Cursor position fields (API-014); fields being edited are left alone. */
  renderCursorFields(): void {
    const cursors = this.get("cursors");
    const fields = [...this.cursorBar.querySelectorAll("input")];
    if (fields.length !== cursors.length) {
      clear(this.cursorBar);
      cursors.forEach((_cur, i) => {
        const field = html("input", { cls: "awi-entry", attrs: { type: "text", inputmode: "decimal", "data-lm-suppress-shortcuts": "true" } });
        const msg = html("span", { cls: "awi-entry-msg", attrs: { role: "alert" } });
        field.addEventListener("keydown", (e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            this.setCursorFromField(i, field, msg);
          } else if (e.key === "Escape") {
            field.blur();
            this.schedule();
          }
        });
        field.addEventListener("blur", () => this.schedule());
        const name = html("span", { cls: "awi-cursor-name" });
        this.cursorBar.appendChild(html("label", { cls: "awi-cursor-field" }, [name, field, html("span", { cls: "awi-entry-unit" }), msg]));
      });
    }
    const unit = this.get("x_unit") || "";
    [...this.cursorBar.children].forEach((row, i) => {
      const cur = cursors[i];
      const [name, field, unitEl] = [...row.children] as [HTMLElement, HTMLInputElement, HTMLElement];
      setText(name, `${cur.name || `C${i + 1}`} x =`);
      setText(unitEl, unit);
      setAttr(field, "aria-label", `Position of cursor ${cur.name || i + 1}`);
      if (field.disabled !== !this.canInteract) field.disabled = !this.canInteract;
      if (document.activeElement !== field) field.value = this.xText(parseNumber(cur.x));
    });
    setHidden(this.cursorBar, cursors.length === 0);
  }

  setCursorFromField(i: number, field: HTMLInputElement, msg: HTMLElement): void {
    if (!this.canInteract) return;
    const r = this.checkX(field.value);
    msg.textContent = r.ok ? "" : (r.reason ?? "");
    field.toggleAttribute("aria-invalid", !r.ok);
    if (!r.ok || r.value === undefined) return;
    const x = r.value;
    this.setCursors(this.get("cursors").map((cur, k) => (k === i ? { ...cur, x } : cur)));
    field.blur();
    this.schedule();
  }

  setCursors(cursors: T["cursors"]): void {
    this.model.set("cursors", cursors);
    this.model.save_changes();
  }

  // -- x-axis values as text (time axes override these) ---------------------------------
  /** Text of an x value in the entry fields. */
  xText(v: number): string {
    return formatValue(v, "%.4g");
  }

  /** x value typed in an entry field (NaN if not understood). */
  parseX(text: string): number {
    return parseEntry(text, this.get("x_unit") || "");
  }

  /** Check a typed x value against the full x range (API-014). */
  checkX(text: string): EntryResult {
    const [a, b] = this.fullRange().x;
    return checkEntry(text, { min: Math.min(a, b), max: Math.max(a, b), unit: this.get("x_unit") || "", format: "%.4g" });
  }

  /** Tick positions of the x axis. */
  xTicks(a: number, b: number): number[] {
    return niceTicks(a, b, 5);
  }

  resetZoom(): void {
    this.zoom = null;
    this.schedule();
  }

  // -- geometry --------------------------------------------------------------------
  area(): Area {
    const [w, h] = this.get("size");
    const m = this.margin;
    return { x: m.left, y: m.top, w: Math.max(10, w - m.left - m.right), h: Math.max(10, h - m.top - m.bottom) };
  }

  /** Subclasses: full data ranges. */
  fullRange(): Ranges {
    return { x: [0, 1], y: [0, 1] };
  }

  ranges(): Ranges {
    return zoomedRanges(this.fullRange(), this.zoom);
  }

  mappers(area: Area, r: Ranges): Mappers {
    const X = (x: number): number => area.x + ((x - r.x[0]) / (r.x[1] - r.x[0] || 1)) * area.w;
    const Y = (y: number): number => area.y + area.h - ((y - r.y[0]) / (r.y[1] - r.y[0] || 1)) * area.h;
    const invX = (px: number): number => r.x[0] + ((px - area.x) / area.w) * (r.x[1] - r.x[0]);
    return { X, Y, invX };
  }

  colors(): Colors {
    const cs = getComputedStyle(this.root);
    const v = (n: string, d: string): string => cs.getPropertyValue(n).trim() || d;
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
  localPoint(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    const [w, h] = this.get("size");
    return { x: ((e.clientX - r.left) * w) / (r.width || w), y: ((e.clientY - r.top) * h) / (r.height || h) };
  }

  cursorAt(px: number): number {
    const { X } = this.mappers(this.area(), this.ranges());
    const cursors = this.get("cursors");
    for (let i = cursors.length - 1; i >= 0; i--) {
      if (Math.abs(X(parseNumber(cursors[i].x)) - px) <= 5) return i;
    }
    return -1;
  }

  onHover(e: PointerEvent): void {
    if (this.dragCursor || this.zoomRect) return;
    const p = this.localPoint(e);
    this.canvas.style.cursor = this.canInteract && this.cursorAt(p.x) >= 0 ? "ew-resize" : this.tool === "zoom" ? "crosshair" : "";
  }

  onPointerDown(e: PointerEvent): void {
    if (!this.canInteract || e.button !== 0) return;
    const p = this.localPoint(e);
    const area = this.area();
    const idx = this.cursorAt(p.x);
    const c = this.canvas;
    c.setPointerCapture?.(e.pointerId);
    let move: (ev: PointerEvent) => void;
    let up: () => void;
    if (idx >= 0) {
      // CHART-104: drag a cursor
      const { invX } = this.mappers(area, this.ranges());
      const drag = (this.dragCursor = { index: idx, x: invX(p.x) });
      move = (ev) => {
        const q = this.localPoint(ev);
        const clamped = Math.min(area.x + area.w, Math.max(area.x, q.x));
        drag.x = this.mappers(area, this.ranges()).invX(clamped);
        this.schedule();
      };
      up = () => {
        const cursors = this.get("cursors").map((cur, i) => (i === drag.index ? { ...cur, x: drag.x } : cur));
        this.dragCursor = null;
        this.setCursors(cursors);
        this.schedule();
      };
    } else if (this.tool === "zoom") {
      // CHART-106: zoom on the selected region
      const rect = (this.zoomRect = { x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      move = (ev) => {
        const q = this.localPoint(ev);
        rect.x1 = Math.min(area.x + area.w, Math.max(area.x, q.x));
        rect.y1 = Math.min(area.y + area.h, Math.max(area.y, q.y));
        this.showZoomBox();
      };
      up = () => {
        this.zoomRect = null;
        this.zoomBox.hidden = true;
        if (Math.abs(rect.x1 - rect.x0) > 4 && Math.abs(rect.y1 - rect.y0) > 4) {
          this.zoom = zoomFromRect(this.fullRange(), this.zoom, area, rect);
          this.schedule();
        }
      };
    } else if (this.zoom) {
      // pan the zoomed view along x
      const x0 = p.x;
      const fx0: Range = this.zoom.fx ? [this.zoom.fx[0], this.zoom.fx[1]] : [0, 1];
      const z0 = { ...this.zoom };
      move = (ev) => {
        const span = fx0[1] - fx0[0];
        let d = (-(this.localPoint(ev).x - x0) / area.w) * span;
        d = Math.max(-fx0[0], Math.min(1 - fx0[1], d));
        this.zoom = { ...z0, fx: [fx0[0] + d, fx0[1] + d] };
        this.schedule();
      };
      up = () => {};
    } else {
      return;
    }
    const end = (): void => {
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", end);
      c.removeEventListener("pointercancel", end);
      up();
    };
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
  }

  showZoomBox(): void {
    const r = this.zoomRect;
    if (!r) return;
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

  onWheel(e: WheelEvent): void {
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

  addCursor(): void {
    if (!this.canInteract) return;
    const r = this.ranges();
    const cursors = this.get("cursors");
    this.setCursors([...cursors, { x: (r.x[0] + r.x[1]) / 2, name: `C${cursors.length + 1}`, color: "" }]);
    this.schedule();
  }

  // -- drawing --------------------------------------------------------------------------
  prepareCanvas(): CanvasRenderingContext2D | null {
    const [w, h] = this.get("size");
    const dpr = (typeof devicePixelRatio !== "undefined" && devicePixelRatio) || 1;
    const c = this.canvas;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = c.getContext?.("2d") ?? null;
    } catch {
      ctx = null; // no canvas support (e.g. a DOM without layout)
    }
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  /** Label of an x-axis value (subclasses may override). */
  xLabel(v: number): string {
    const u = this.get("x_unit");
    const t = formatValue(v, "%.3g");
    return u ? `${t} ${u}` : t;
  }

  drawAxes(ctx: CanvasRenderingContext2D, area: Area, r: Ranges, colors: Colors, { yTicks = true }: { yTicks?: boolean } = {}): void {
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
        ctx.beginPath();
        ctx.moveTo(area.x, y);
        ctx.lineTo(area.x + area.w, y);
        ctx.stroke();
        ctx.fillText(formatValue(v, "%.3g"), area.x - 4, y);
      }
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const v of this.xTicks(r.x[0], r.x[1])) {
      const x = Math.round(X(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, area.y);
      ctx.lineTo(x, area.y + area.h);
      ctx.stroke();
      ctx.fillText(this.xLabel(v), x, area.y + area.h + 4);
    }
  }

  /** Values under a cursor, as display strings (subclasses). */
  cursorText(_x: number): string {
    return "";
  }

  drawOverlays(ctx: CanvasRenderingContext2D, area: Area, r: Ranges, colors: Colors): void {
    const { X, Y } = this.mappers(area, r);
    // annotations (CHART-105)
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    for (const a of this.get("annotations")) {
      const x = X(parseNumber(a.x));
      const y = Y(parseNumber(a.y));
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < area.x || x > area.x + area.w || y < area.y || y > area.y + area.h) continue;
      ctx.fillStyle = safeColor(a.color) || colors.fg;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillText(String(a.text ?? ""), x + 5, y - 3);
    }
    // cursors (CHART-104)
    this.get("cursors").forEach((c, i) => {
      const cx = this.dragCursor?.index === i ? this.dragCursor.x : parseNumber(c.x);
      const x = Math.round(X(cx)) + 0.5;
      if (x < area.x || x > area.x + area.w) return;
      const col = safeColor(c.color) || colors.accent;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x, area.y);
      ctx.lineTo(x, area.y + area.h);
      ctx.stroke();
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

  override renderCommon(): void {
    super.renderCommon();
    this.renderCursorFields();
    setAttr(this.zoomBtn, "aria-pressed", String(this.tool === "zoom"));
    for (const b of this.exportBtns) setHidden(b, !this.get("export"));
  }

  // -- export (CHART-107) ------------------------------------------------------------------
  /** Subclasses: rows for CSV export, first row is the header. */
  csvRows(): Cell[][] {
    return [];
  }

  exportCsv(): void {
    const esc = (v: Cell): string => {
      const s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const text = this.csvRows()
      .map((row) => row.map(esc).join(","))
      .join("\n");
    download(new Blob([text], { type: "text/csv" }), `${this.get("label") || this.kind}.csv`);
  }

  exportPng(): void {
    this.canvas.toBlob((b) => b && download(b, `${this.get("label") || this.kind}.png`), "image/png");
  }

  /** Subclasses: SVG elements (paths) for the plot content. */
  svgContent(_area: Area, _ranges: Ranges, _colors: Colors, _el: SvgBuilder): SVGElement[] {
    return [];
  }

  buildSvg(): SVGElement {
    const [w, h] = this.get("size");
    const NS = "http://www.w3.org/2000/svg";
    const el: SvgBuilder = (tag, attrs = {}, text) => {
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
    for (const v of this.xTicks(r.x[0], r.x[1])) {
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
    for (const a of this.get("annotations")) {
      root.appendChild(el("text", { x: X(parseNumber(a.x)) + 5, y: Y(parseNumber(a.y)) - 3, fill: safeColor(a.color) || colors.fg }, String(a.text ?? "")));
    }
    return root;
  }

  exportSvg(): void {
    const text = new XMLSerializer().serializeToString(this.buildSvg());
    download(new Blob([text], { type: "image/svg+xml" }), `${this.get("label") || this.kind}.svg`);
  }
}
