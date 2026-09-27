// Base view shared by every widget: common traits, render scheduling,
// throttled value sending and visibility handling.
import type { WidgetContract } from "../contract/spec.js";
import { plainValue, readTrait } from "../contract/traits.js";
import { BY_KIND } from "../generated/contract.js";
import { html, safeColor, setAttr, setHidden, setText } from "./dom.js";
import { type Liveness, liveness, recordBeat } from "./liveness.js";
import type { AnyModel, Handler, Traits } from "./model.js";
import { hostIsDark } from "./pagetheme.js";

export const COMMON_TRAITS = ["mode", "label", "disabled", "visible", "tooltip", "size", "style", "theme", "skin", "_heartbeat"];

/** Refresh period of the DOM state of a widget scrolled out of view (PERF-002, PERF-005). */
export const OFFSCREEN_MS = 100;

const STALE_TEXT: Record<Liveness, string> = {
  live: "", stale: "⚠ STALE — kernel lost", nokernel: "⚠ NO KERNEL — read-only" };

// Each widget may load its own copy of this module: ids need a random part.
let uid = 0;
const prefix = `awi${Math.random().toString(36).slice(2, 8)}`;

export class BaseView<T extends object = Traits> {
  readonly model: AnyModel<T>;
  readonly el: HTMLElement;
  readonly id: string;
  readonly kind: string;
  /** Trait contract of the widget, when its `_kind` has a schema (HOST-001). */
  readonly contract: WidgetContract | undefined;
  private _invalid = new Set<string>();
  /** Last read of each trait: the value is read again only when the raw value changes. */
  private _reads = new Map<string, { raw: unknown; value: unknown }>();
  readonly root: HTMLDivElement;
  readonly labelEl: HTMLDivElement;
  readonly body: HTMLDivElement;
  readonly staleBadge: HTMLDivElement;
  stale: Liveness;
  protected _frame: number;
  protected _offscreen: ReturnType<typeof setTimeout> | 0;
  protected _dirty: boolean;
  protected _inViewport: boolean;
  protected _disposers: Array<() => void>;
  protected _lastSend: number;
  protected _pendingSend: ReturnType<typeof setTimeout> | null;
  protected _pendingValue: unknown;
  protected _since: number;

  /**
   * @param model anywidget model (AFM interface)
   * @param el host element
   * @param traits widget-specific traits triggering a redraw
   */
  constructor(model: AnyModel<T>, el: HTMLElement, traits: string[] = []) {
    this.model = model;
    this.el = el;
    this.id = `${prefix}-${++uid}`;
    this.kind = String((model as unknown as AnyModel<Traits>).get("_kind") ?? "");
    this.contract = BY_KIND[this.kind];
    this._frame = 0;
    this._offscreen = 0;
    this._dirty = true;
    this._inViewport = true;
    this._disposers = [];
    this._lastSend = 0;
    this._pendingSend = null;

    // data-lm-suppress-shortcuts: keys typed in a widget (arrows, Space...)
    // must not trigger host shortcuts (JupyterLab / Notebook 7, A11Y-001)
    this.root = html("div", { cls: `awi-root awi-${this.kind}`, attrs: { "data-lm-suppress-shortcuts": "true" } });
    this.labelEl = html("div", { cls: "awi-label", attrs: { id: `${this.id}-label` } });
    this.body = html("div", { cls: "awi-body", attrs: { "data-lm-suppress-shortcuts": "true" } });
    this.staleBadge = html("div", { cls: "awi-stale-badge", attrs: { role: "status" } });
    this.staleBadge.hidden = true;
    this.root.append(this.labelEl, this.body, this.staleBadge);
    el.appendChild(this.root);

    // ROB-001 / ROB-004: stale-data indication when kernel heartbeats stop
    this.stale = "live";
    this._since = Date.now();
    this.listen("msg:custom", (msg: { type?: string; session?: unknown } | null) => {
      if (msg && msg.type === "hb") {
        recordBeat(msg.session);
        this.checkLiveness();
      }
    });
    const timer = setInterval(() => this.checkLiveness(), 1000);
    this._disposers.push(() => clearInterval(timer));

    for (const name of new Set([...COMMON_TRAITS, ...traits])) {
      this.listen(`change:${name}`, () => this.schedule());
    }

    // PERF-005: skip rendering while scrolled out of view.
    if (typeof IntersectionObserver !== "undefined") {
      const io = new IntersectionObserver((entries) => {
        this._inViewport = entries.some((e) => e.isIntersecting);
        if (this._inViewport && this._dirty) this.schedule();
      });
      io.observe(this.root);
      this._disposers.push(() => io.disconnect());
    }
    // STYLE-002: redraw canvas-based widgets when the OS theme changes.
    if (typeof matchMedia !== "undefined") {
      const mq = matchMedia("(prefers-color-scheme: dark)");
      const cb = () => this.schedule();
      mq.addEventListener?.("change", cb);
      this._disposers.push(() => mq.removeEventListener?.("change", cb));
    }
  }

  listen(event: string, cb: Handler): void {
    this.model.on(event, cb);
    this._disposers.push(() => this.model.off(event, cb));
  }

  /**
   * Trait value. For a widget with a schema, values are read through the
   * contract (HOST-002): wrong types fall back to the default, numbers are
   * clamped to the schema bounds, "nan" / "inf" strings are decoded.
   */
  get<K extends keyof T & string>(name: K): T[K];
  get(name: string): unknown;
  get(name: string): unknown {
    const raw = (this.model as unknown as AnyModel<Traits>).get(name);
    const spec = this.contract?.traits[name];
    // no schema to read it through, but a dictionary may still come as a Map
    if (!spec) return plainValue(raw);
    // renderCommon() reads some twenty traits on every change: a value
    // unchanged since the last read (same object) is not read again (PERF-002)
    const last = this._reads.get(name);
    if (last && Object.is(last.raw, raw)) return last.value;
    const value = readTrait(spec, raw, () => {
      if (this._invalid.has(name)) return;
      this._invalid.add(name);
      console.warn(`anywidget-instruments: ${this.kind}.${name}: invalid value ${JSON.stringify(raw)}, using the default`);
    });
    this._reads.set(name, { raw, value });
    return value;
  }

  /** True when user input may modify the value (API-004, API-011). */
  get interactive(): boolean {
    return this.get("mode") === "control" && !this.get("disabled") && !!this.get("visible") && this.stale === "live";
  }

  checkLiveness(): void {
    const state = liveness({ session: this.get("_session"), interval: this.get("_heartbeat"), since: this._since });
    if (state !== this.stale) {
      this.stale = state;
      this.schedule();
    }
  }

  /** PERF-003: coalesce updates, render at most once per animation frame. */
  schedule(): void {
    this._dirty = true;
    if (!this._inViewport) {
      // the DOM state (label, value text, ARIA) stays current off-screen, at
      // most every OFFSCREEN_MS: a kernel updating many hidden indicators
      // must not cost one update per message (PERF-002)
      if (!this._offscreen) {
        this._offscreen = setTimeout(() => {
          this._offscreen = 0;
          if (this._dirty) this.renderCommon();
        }, OFFSCREEN_MS);
      }
      return;
    }
    if (this._frame) return;
    const raf = typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame : (f: () => void): number => setTimeout(f, 16) as unknown as number;
    this._frame = raf(() => {
      this._frame = 0;
      if (!this._dirty) return;
      this._dirty = false;
      this.renderCommon();
      this.draw();
    });
  }

  renderCommon(): void {
    const r = this.root;
    const [w, h] = (this.get("size") as [number, number] | undefined) || [160, 160];
    r.classList.toggle("awi-indicator", this.get("mode") === "indicator");
    r.classList.toggle("awi-control", this.get("mode") === "control");
    r.classList.toggle("awi-disabled", !!this.get("disabled"));
    for (const s of ["modern", "classic", "system"]) r.classList.toggle(`awi-style-${s}`, this.get("style") === s);
    // STYLE-007: explicit light / dark theme ("auto" follows the style and the host),
    // "system" follows the host or the operating system whatever the style
    let theme = this.get("theme");
    if (theme === "system") theme = hostIsDark(this.el) ? "dark" : "light";
    for (const t of ["light", "dark"]) r.classList.toggle(`awi-theme-${t}`, theme === t);
    r.style.display = this.get("visible") ? "" : "none";
    r.style.setProperty("--awi-w", `${w}px`);
    r.style.setProperty("--awi-h", `${h}px`);
    this.body.style.width = `${w}px`;
    this.body.style.height = `${h}px`;
    const tip = this.get("tooltip") as string;
    setAttr(r, "title", tip || null);
    const label = String(this.get("label") || "");
    setText(this.labelEl, label);
    setHidden(this.labelEl, !label);
    r.classList.toggle("awi-stale", this.stale !== "live");
    setHidden(this.staleBadge, this.stale === "live");
    setText(this.staleBadge, STALE_TEXT[this.stale]);
    setAttr(r, "aria-disabled", this.get("disabled") || this.stale !== "live" ? "true" : null);
  }

  /** Subclasses draw their content here. */
  draw(): void {}

  /** Set a CSS custom property from a trait color, if it is a safe color. */
  setColorVar(name: string, value: unknown): void {
    const c = safeColor(value);
    if (c) this.root.style.setProperty(name, c);
    else this.root.style.removeProperty(name);
  }

  /**
   * Send a new value to the kernel (API-006). Intermediate values are rate
   * limited by `update_rate` (NUM-009); `final` values are always sent.
   */
  sendValue(value: unknown, final = false): void {
    if (this.stale !== "live") return;
    const rate = Number(this.get("update_rate")) || 30;
    const now = Date.now();
    const interval = 1000 / rate;
    const flush = () => {
      this._pendingSend = null;
      this._lastSend = Date.now();
      (this.model as unknown as AnyModel<Traits>).set("value", this._pendingValue);
      this.model.save_changes();
    };
    this._pendingValue = value;
    if (final || now - this._lastSend >= interval) {
      if (this._pendingSend) clearTimeout(this._pendingSend);
      flush();
    } else if (!this._pendingSend) {
      this._pendingSend = setTimeout(flush, interval - (now - this._lastSend));
    }
  }

  destroy(): void {
    if (this._frame && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(this._frame);
    if (this._offscreen) clearTimeout(this._offscreen);
    if (this._pendingSend) clearTimeout(this._pendingSend);
    for (const d of this._disposers) d();
    this.root.remove();
  }
}
