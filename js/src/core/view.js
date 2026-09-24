// Base view shared by every widget: common traits, render scheduling,
// throttled value sending and visibility handling.
import { html, safeColor } from "./dom.js";
import { liveness, recordBeat } from "./liveness.js";
import { hostIsDark } from "./pagetheme.js";

export const COMMON_TRAITS = ["mode", "label", "disabled", "visible", "tooltip", "size", "style", "theme", "skin", "_heartbeat"];

const STALE_TEXT = { stale: "⚠ STALE — kernel lost", nokernel: "⚠ NO KERNEL — read-only" };

// Each widget may load its own copy of this module: ids need a random part.
let uid = 0;
const prefix = `awi${Math.random().toString(36).slice(2, 8)}`;

export class BaseView {
  /**
   * @param {object} model anywidget model (AFM interface)
   * @param {HTMLElement} el host element
   * @param {string[]} traits widget-specific traits triggering a redraw
   */
  constructor(model, el, traits = []) {
    this.model = model;
    this.el = el;
    this.id = `${prefix}-${++uid}`;
    this.kind = model.get("_kind");
    this._frame = 0;
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
    this.listen("msg:custom", (msg) => {
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

  listen(event, cb) {
    this.model.on(event, cb);
    this._disposers.push(() => this.model.off(event, cb));
  }

  get(name) {
    return this.model.get(name);
  }

  /** True when user input may modify the value (API-004, API-011). */
  get interactive() {
    return this.get("mode") === "control" && !this.get("disabled") && this.get("visible") && this.stale === "live";
  }

  checkLiveness() {
    const state = liveness({ session: this.get("_session"), interval: this.get("_heartbeat"), since: this._since });
    if (state !== this.stale) {
      this.stale = state;
      this.schedule();
    }
  }

  /** PERF-003: coalesce updates, render at most once per animation frame. */
  schedule() {
    this._dirty = true;
    if (!this._inViewport) {
      this.renderCommon(); // cheap DOM state (label, classes) stays current off-screen
      return;
    }
    if (this._frame) return;
    const raf = typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame : (f) => setTimeout(f, 16);
    this._frame = raf(() => {
      this._frame = 0;
      if (!this._dirty) return;
      this._dirty = false;
      this.renderCommon();
      this.draw();
    });
  }

  renderCommon() {
    const r = this.root;
    const [w, h] = this.get("size") || [160, 160];
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
    const tip = this.get("tooltip");
    if (tip) r.title = tip;
    else r.removeAttribute("title");
    const label = this.get("label") || "";
    this.labelEl.textContent = label;
    this.labelEl.hidden = !label;
    r.classList.toggle("awi-stale", this.stale !== "live");
    this.staleBadge.hidden = this.stale === "live";
    this.staleBadge.textContent = STALE_TEXT[this.stale] || "";
    if (this.get("disabled") || this.stale !== "live") r.setAttribute("aria-disabled", "true");
    else r.removeAttribute("aria-disabled");
  }

  /** Subclasses draw their content here. */
  draw() {}

  /** Set a CSS custom property from a trait color, if it is a safe color. */
  setColorVar(name, value) {
    const c = safeColor(value);
    if (c) this.root.style.setProperty(name, c);
    else this.root.style.removeProperty(name);
  }

  /**
   * Send a new value to the kernel (API-006). Intermediate values are rate
   * limited by `update_rate` (NUM-009); `final` values are always sent.
   */
  sendValue(value, final = false) {
    if (this.stale !== "live") return;
    const rate = this.get("update_rate") || 30;
    const now = Date.now();
    const interval = 1000 / rate;
    const flush = () => {
      this._pendingSend = null;
      this._lastSend = Date.now();
      this.model.set("value", this._pendingValue);
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

  destroy() {
    if (this._frame && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(this._frame);
    if (this._pendingSend) clearTimeout(this._pendingSend);
    for (const d of this._disposers) d();
    this.root.remove();
  }
}
