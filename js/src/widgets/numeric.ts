// Shared behaviour of numeric widgets: value text, alarm and range badges,
// keyboard / wheel interaction and ARIA attributes.
import { coerceValue, type Scale, ScaleGuard } from "../contract/numeric.js";
import { html, parseSkin, svg } from "../core/dom.js";
import { checkEntry } from "../core/entry.js";
import { formatValue, withUnit } from "../core/format.js";
import type { AnyModel } from "../core/model.js";
import { fromFraction, keyStep, parseNumber, type Position, position, snap, toFraction } from "../core/scale.js";
import { BaseView } from "../core/view.js";
import type { NumericTraits } from "../generated/contract.js";

export { checkEntry };

export const NUMERIC_TRAITS = [
  "value", "min", "max", "step", "unit", "scale", "ticks", "minor_ticks", "format",
  "lolo", "lo", "hi", "hihi", "show_limits", "alarm_level", "animate", "animation_ms",
  "entry", "coerce",
];

const ALARM_TEXT: Record<string, string> = { lolo: "LOLO", lo: "LO", hi: "HI", hihi: "HIHI" };

export interface Zone {
  from: number;
  to: number;
  level: "lolo" | "lo" | "hi" | "hihi";
}

export class NumericView<T extends object = NumericTraits> extends BaseView<T> {
  readonly role: string;
  readonly valueRow: HTMLDivElement;
  readonly valueText: HTMLSpanElement;
  readonly badge: HTMLSpanElement;
  readonly entryEl: HTMLInputElement;
  readonly entryUnit: HTMLSpanElement;
  readonly entryMsg: HTMLDivElement;
  protected _lastValid: number | null;
  protected _entryShown = "";
  /** Keeps the last valid scale of a widget with a schema (HOST-002). */
  private readonly _scaleGuard: ScaleGuard | null;

  constructor(model: AnyModel<T>, el: HTMLElement, traits: string[] = [], { role = "slider" }: { role?: string } = {}) {
    super(model, el, [...NUMERIC_TRAITS, ...traits]);
    this._scaleGuard = this.contract ? new ScaleGuard({ min: Number(this.contract.traits.min.default), max: Number(this.contract.traits.max.default), scale: "linear" }) : null;
    this.role = role;
    this.valueRow = html("div", { cls: "awi-value-row" });
    this.valueText = html("span", { cls: "awi-value" });
    this.badge = html("span", { cls: "awi-badge" });
    // form entry (API-014, NUM-010): editable value in control mode
    this.entryEl = html("input", { cls: "awi-entry", attrs: { type: "text", inputmode: "decimal", autocomplete: "off", spellcheck: "false", "data-lm-suppress-shortcuts": "true" } });
    this.entryUnit = html("span", { cls: "awi-entry-unit" });
    this.entryMsg = html("div", { cls: "awi-entry-msg", attrs: { role: "alert" } });
    this.entryEl.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        this.commitEntry();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.resetEntry();
        this.entryEl.blur();
      }
    });
    this.entryEl.addEventListener("input", () => this.showEntryError(""));
    this.entryEl.addEventListener("blur", () => {
      if (this.entryEl.value !== this._entryShown) this.commitEntry();
    });
    this.valueRow.append(this.valueText, this.entryEl, this.entryUnit, this.badge);
    this.root.append(this.valueRow, this.entryMsg);
    this.body.tabIndex = 0;
    this.body.setAttribute("aria-labelledby", this.labelEl.id);
    this.body.addEventListener("keydown", (e) => this.onKey(e));
    this.body.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    this._lastValid = null;
  }

  // -- model accessors ----------------------------------------------------
  /** Scale in use: for a widget with a schema, the last valid one (HOST-002). */
  get scaleNow(): Scale {
    const s = { min: parseNumber(this.get("min")), max: parseNumber(this.get("max")), scale: String(this.get("scale")) };
    return this._scaleGuard ? this._scaleGuard.resolve(s, this.kind) : s;
  }
  get min(): number { return this.scaleNow.min; }
  get max(): number { return this.scaleNow.max; }
  get step(): number { return parseNumber(this.get("step")) || 0; }
  get scaleType(): string { return this.scaleNow.scale; }
  /**
   * Current value. For a widget with a schema, the value as the kernel
   * stores it: clamped to [min, max] when `coerce` is set (NUM-010).
   */
  get value(): number {
    const v = parseNumber(this.get("value"));
    if (!this.contract) return v;
    const s = this.scaleNow;
    return coerceValue(v, s.min, s.max, !!this.get("coerce"));
  }

  /** Position of the current value; for invalid values the pointer stays put (NUM-007). */
  pos(): Position & { fraction: number } {
    const p = position(this.value, this.min, this.max, this.scaleType);
    if (p.invalid || p.fraction === null) return { ...p, fraction: this._lastValid ?? 0 };
    this._lastValid = p.fraction;
    return { ...p, fraction: p.fraction };
  }

  frac(v: number): number {
    return Math.min(1, Math.max(0, toFraction(v, this.min, this.max, this.scaleType)));
  }

  /** Alarm zones [{from, to, level}] as fractions of the scale (ALARM-005). */
  limitZones(): Zone[] {
    const g = (k: string): number | null => {
      const v = this.get(k);
      return v === null || v === undefined ? null : parseNumber(v);
    };
    const [lolo, lo, hi, hihi] = [g("lolo"), g("lo"), g("hi"), g("hihi")];
    const zones: Zone[] = [];
    if (lolo !== null) zones.push({ from: 0, to: this.frac(lolo), level: "lolo" });
    if (lo !== null) zones.push({ from: lolo !== null ? this.frac(lolo) : 0, to: this.frac(lo), level: "lo" });
    if (hi !== null) zones.push({ from: this.frac(hi), to: hihi !== null ? this.frac(hihi) : 1, level: "hi" });
    if (hihi !== null) zones.push({ from: this.frac(hihi), to: 1, level: "hihi" });
    return zones.filter((z) => z.to > z.from);
  }

  // -- rendering ----------------------------------------------------------
  override renderCommon(): void {
    super.renderCommon();
    const v = this.value;
    const p = this.pos();
    const level = String(this.get("alarm_level") || "normal");
    const r = this.root;
    for (const l of ["lolo", "lo", "hi", "hihi"]) r.classList.toggle(`awi-alarm-${l}`, level === l);
    r.classList.toggle("awi-invalid", p.invalid);
    r.classList.toggle("awi-animate", !!this.get("animate"));
    r.style.setProperty("--awi-anim", `${Math.min(300, Number(this.get("animation_ms")) || 0)}ms`);

    const format = this.get("format") as string;
    const unit = this.get("unit") as string;
    const text = withUnit(formatValue(v, format), unit);
    this.valueText.textContent = text;
    this.renderEntry(v);
    // A11Y-003: state conveyed by text, not only by color.
    const parts: string[] = [];
    if (p.over) parts.push("▲ OVER");
    if (p.under) parts.push("▼ UNDER");
    if (ALARM_TEXT[level]) parts.push(ALARM_TEXT[level]);
    this.badge.textContent = parts.join(" ");
    this.badge.hidden = parts.length === 0;

    // A11Y-002
    const b = this.body;
    b.setAttribute("role", this.get("mode") === "control" ? this.role : "meter");
    b.setAttribute("aria-valuemin", String(this.min));
    b.setAttribute("aria-valuemax", String(this.max));
    if (Number.isFinite(v)) b.setAttribute("aria-valuenow", String(v));
    else b.removeAttribute("aria-valuenow");
    b.setAttribute("aria-valuetext", `${text}${parts.length ? ` (${parts.join(", ")})` : ""}`);
    if (!this.get("label")) b.setAttribute("aria-label", this.kind);
    else b.removeAttribute("aria-label");
    b.tabIndex = this.get("mode") === "control" ? 0 : -1;
  }

  /** Show the entry field in control mode (NUM-010), without disturbing typing. */
  renderEntry(v: number): void {
    const on = this.get("mode") === "control" && this.get("entry") !== false;
    const unit = (this.get("unit") as string) || "";
    const format = this.get("format") as string;
    this.root.classList.toggle("awi-has-entry", on);
    this.entryEl.hidden = !on;
    this.entryUnit.hidden = !on || !unit;
    this.valueText.setAttribute("aria-hidden", on ? "true" : "false");
    if (!on) {
      this.showEntryError("");
      return;
    }
    this.entryEl.disabled = !this.interactive;
    this.entryUnit.textContent = unit;
    const label = (this.get("label") as string) || this.kind;
    this.entryEl.setAttribute("aria-label", `${label} value (${formatValue(this.min, format)} to ${formatValue(this.max, format)})`);
    if (document.activeElement !== this.entryEl) this.resetEntry(v);
  }

  resetEntry(v: number = this.value): void {
    const format = this.get("format") as string;
    this._entryShown = Number.isFinite(v) ? formatValue(v, format) : "";
    this.entryEl.value = this._entryShown;
    this.entryEl.placeholder = Number.isFinite(v) ? "" : formatValue(v);
    this.showEntryError("");
  }

  showEntryError(reason: string): void {
    this.entryMsg.textContent = reason;
    this.entryMsg.hidden = !reason;
    if (reason) this.entryEl.setAttribute("aria-invalid", "true");
    else this.entryEl.removeAttribute("aria-invalid");
  }

  /** Validate and send the typed value (NUM-010); rejected entries stay for correction. */
  commitEntry(): void {
    if (!this.interactive) return this.resetEntry();
    const r = checkEntry(this.entryEl.value, { min: this.min, max: this.max, step: this.step, unit: (this.get("unit") as string) || "", coerce: !!this.get("coerce"), format: this.get("format") as string });
    if (!r.ok) return this.showEntryError(r.reason);
    this.showEntryError("");
    this.commit(r.value, true);
    this.resetEntry(r.value);
  }

  /**
   * Skin part (STYLE-005) fitted into the box (x, y, w, h), or null when no
   * skin is supplied for `name`. Parts: background, housing, knob, needle.
   */
  skinPart(name: string, w: number, h: number, x = 0, y = 0, align = "xMidYMid meet"): SVGElement | null {
    const skin = (this.get("skin") as Record<string, string> | undefined) || {};
    const node = parseSkin(skin[name]);
    if (!node) return null;
    node.setAttribute("x", String(x));
    node.setAttribute("y", String(y));
    node.setAttribute("width", String(w));
    node.setAttribute("height", String(h));
    node.setAttribute("preserveAspectRatio", align);
    return svg("g", { class: `awi-skin awi-skin-${name}` }, [node]);
  }

  // -- interaction ------------------------------------------------------------
  /** Commit a new value (snapped to step and clamped, NUM-005). */
  commit(v: number, final = false): void {
    if (!this.interactive || !Number.isFinite(v)) return;
    const next = snap(v, this.min, this.max, this.step);
    (this.model as unknown as AnyModel).set("value", next);
    this.schedule();
    this.sendValue(next, final);
  }

  commitFraction(f: number, final = false): void {
    this.commit(fromFraction(f, this.min, this.max, this.scaleType), final);
  }

  nudge(k: number): void {
    const base = Number.isFinite(this.value) ? this.value : this.min;
    if (this.scaleType === "log") {
      const f = this.frac(base) + k * 0.01;
      this.commitFraction(Math.min(1, Math.max(0, f)), true);
    } else {
      this.commit(base + k * keyStep(this.min, this.max, this.step), true);
    }
  }

  onKey(e: KeyboardEvent): void {
    if (!this.interactive) return;
    const map: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 };
    if (e.key in map) this.nudge(map[e.key]);
    else if (e.key === "Home") this.commit(this.min, true);
    else if (e.key === "End") this.commit(this.max, true);
    else return;
    e.preventDefault();
  }

  onWheel(e: WheelEvent): void {
    if (!this.interactive || document.activeElement !== this.body) return;
    e.preventDefault();
    this.nudge(e.deltaY < 0 ? 1 : -1);
  }

  /** Pointer capture helper: calls move(e) during the drag and end(e) on release. */
  drag(target: Element, { start, move, end }: { start?: (e: PointerEvent) => void; move?: (e: PointerEvent) => void; end?: (e: PointerEvent) => void }): void {
    target.addEventListener("pointerdown", (ev) => {
      const e = ev as PointerEvent;
      if (!this.interactive || e.button !== 0) return;
      e.preventDefault();
      this.body.focus({ preventScroll: true });
      target.setPointerCapture?.(e.pointerId);
      this.root.classList.add("awi-dragging");
      start?.(e);
      const onMove = (m: Event): void => move?.(m as PointerEvent);
      const onUp = (u: Event): void => {
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
        this.root.classList.remove("awi-dragging");
        end?.(u as PointerEvent);
      };
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    });
  }
}

/** Convert a pointer event to SVG user coordinates. */
export function svgPoint(svgEl: SVGSVGElement | SVGElement, e: { clientX: number; clientY: number }): { x: number; y: number } {
  const ctm = (svgEl as SVGGraphicsElement).getScreenCTM?.();
  if (!ctm) return { x: 0, y: 0 };
  const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
  return { x: pt.x, y: pt.y };
}
