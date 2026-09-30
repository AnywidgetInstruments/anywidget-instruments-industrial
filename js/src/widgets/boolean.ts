// Boolean widgets and mechanical actions (BOOL-001..BOOL-014).
import { clear, svg, svgText } from "anywidget-instruments/js/src/core/dom.js";
import type { AnyModel } from "anywidget-instruments/js/src/core/model.js";
import { BaseView } from "anywidget-instruments/js/src/core/view.js";
import type { BooleanTraits, LEDTraits, PushButtonTraits, ToggleSwitchTraits } from "../generated/contract.js";

/** Traits of the Boolean widgets, from their schemas (LED and PushButton both have a shape). */
export type BooleanViewTraits = BooleanTraits &
  Partial<Pick<LEDTraits, "on_color" | "off_color" | "blink" | "blink_hz"> & Pick<ToggleSwitchTraits, "orientation"> & Pick<PushButtonTraits, "text" | "color" | "lamp" | "lamp_color" | "lamp_blink">> & {
    shape?: LEDTraits["shape"] | PushButtonTraits["shape"];
  };

type Phase = "press" | "release";

const BOOL_TRAITS = [
  "value", "default_state", "mechanical_action", "confirm", "shape", "on_color", "off_color",
  "blink", "blink_hz", "orientation", "text", "_pressed", "color", "lamp", "lamp_color", "lamp_blink",
];

/**
 * Value transitions of a mechanical action.
 * Returns the value to set on "press" / "release", or null for no change.
 */
export function mechanicalTransition(action: string, phase: Phase, value: boolean, defaultState: boolean): boolean | null {
  const active = !defaultState;
  switch (action) {
    case "switch_when_pressed":
      return phase === "press" ? !value : null;
    case "switch_when_released":
      return phase === "release" ? !value : null;
    case "switch_until_released":
      return phase === "press" ? active : defaultState;
    case "latch_when_pressed":
    case "latch_until_released":
      return phase === "press" ? active : null;
    case "latch_when_released":
      return phase === "release" ? active : null;
    default:
      return null;
  }
}

export class BooleanView extends BaseView<BooleanViewTraits> {
  readonly svgEl: SVGElement;
  readonly stateText: SVGElement;
  protected _armedUntil: number;
  protected _pressed: boolean;

  constructor(model: AnyModel<BooleanViewTraits>, el: HTMLElement) {
    super(model, el, BOOL_TRAITS);
    this.svgEl = svg("svg", { class: "awi-svg", "aria-hidden": "true" });
    this.body.appendChild(this.svgEl);
    this.stateText = svgText("", { class: "awi-state-text", "text-anchor": "middle", "dominant-baseline": "central" });
    this._armedUntil = 0;
    this._pressed = false;
    const b = this.body;
    b.setAttribute("aria-labelledby", this.labelEl.id);
    b.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !this.interactive) return;
      e.preventDefault();
      b.focus({ preventScroll: true });
      b.setPointerCapture?.(e.pointerId);
      this.phase("press");
    });
    b.addEventListener("pointerup", (e) => {
      if (!this._pressed) return;
      const r = b.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      this.phase("release", inside);
    });
    b.addEventListener("pointercancel", () => this._pressed && this.phase("release", false));
    b.addEventListener("keydown", (e) => {
      if ((e.key === " " || e.key === "Enter") && this.interactive) {
        e.preventDefault();
        if (!e.repeat) this.phase("press");
      }
    });
    b.addEventListener("keyup", (e) => {
      if ((e.key === " " || e.key === "Enter") && this._pressed) {
        e.preventDefault();
        this.phase("release", true);
      }
    });
    this.listen("msg:custom", (msg: { type?: string } | null) => {
      if (msg && msg.type === "latch_expired") {
        this.root.classList.add("awi-expired");
        setTimeout(() => this.root.classList.remove("awi-expired"), 600);
      }
    });
    this.schedule();
  }

  get isLed(): boolean {
    return this.kind === "led";
  }

  phase(phase: Phase, inside = true): void {
    const value = !!this.get("value");
    const def = !!this.get("default_state");
    const action = this.get("mechanical_action");
    if (this.kind === "emergencystop") {
      // Latches on press; only the kernel reset() returns it to false.
      if (phase === "press" && !value) this.write(true, true);
      else this.write(null, phase === "press");
      return;
    }
    let next: boolean | null = mechanicalTransition(action, phase, value, def);
    if (phase === "release" && !inside && action !== "switch_until_released") next = null; // released outside: cancel
    // BOOL-014: two-step confirmation for toggling actions
    if (next !== null && this.get("confirm") && action !== "switch_until_released" && next !== value) {
      if (Date.now() > this._armedUntil) {
        this._armedUntil = Date.now() + 3000;
        this.root.classList.add("awi-armed");
        this.schedule();
        setTimeout(() => { this.root.classList.remove("awi-armed"); this.schedule(); }, 3000);
        next = null;
      } else {
        this._armedUntil = 0;
        this.root.classList.remove("awi-armed");
      }
    }
    this.write(next, phase === "press");
  }

  write(value: boolean | null, pressed: boolean): void {
    if (this.stale !== "live") return;
    this._pressed = pressed;
    this.root.classList.toggle("awi-pressed", pressed);
    if (value !== null) this.model.set("value", value);
    this.model.set("_pressed", pressed);
    // numbered, so that a host applying the update twice counts one press
    this.model.set("_seq", (this.get("_seq") || 0) + 1);
    this.model.save_changes();
    this.schedule();
  }

  override draw(): void {
    const on = !!this.get("value");
    const [w, h] = this.get("size");
    const s = this.svgEl;
    s.setAttribute("viewBox", `0 0 ${w} ${h}`);
    clear(s);
    this.root.classList.toggle("awi-on", on);
    this.root.classList.toggle("awi-blink", this.isLed && on && !!this.get("blink"));
    this.root.style.setProperty("--awi-blink-period", `${1 / (this.get("blink_hz") || 2)}s`);
    this.setColorVar("--awi-led-on", this.get("on_color"));
    this.setColorVar("--awi-led-off", this.get("off_color"));

    const control = this.get("mode") === "control" && !this.isLed;
    const b = this.body;
    b.tabIndex = control ? 0 : -1;
    const armed = this.root.classList.contains("awi-armed");
    const stateWord = armed ? "confirm?" : on ? "on" : "off";
    if (this.isLed || !control) {
      b.setAttribute("role", "img");
      b.setAttribute("aria-label", `${this.get("label") || this.kind}: ${stateWord}`);
      b.removeAttribute("aria-checked");
      b.removeAttribute("aria-pressed");
    } else if (this.kind === "pushbutton" || this.kind === "emergencystop") {
      b.setAttribute("role", "button");
      b.setAttribute("aria-pressed", String(on));
      b.removeAttribute("aria-label");
      if (!this.get("label")) b.setAttribute("aria-label", this.kind === "pushbutton" ? String(this.get("text") ?? "") : "Emergency stop");
      const lamp = this.get("lamp");
      if (this.kind === "pushbutton" && (lamp === true || lamp === false)) b.setAttribute("aria-description", `lamp ${lamp ? "on" : "off"}${lamp && this.get("lamp_blink") ? ", flashing" : ""}`);
      else b.removeAttribute("aria-description");
    } else {
      b.setAttribute("role", "switch");
      b.setAttribute("aria-checked", String(on));
      if (!this.get("label")) b.setAttribute("aria-label", this.kind);
    }

    const draw = ({
      led: () => this.drawLed(w, h, on),
      toggleswitch: () => this.drawToggle(w, h, on),
      rockerswitch: () => this.drawRocker(w, h, on),
      slideswitch: () => this.drawSlide(w, h, on),
      pushbutton: () => this.drawPush(w, h, on, armed),
      emergencystop: () => this.drawEstop(w, h, on),
    } as Record<string, () => void>)[this.kind];
    draw?.();
  }

  drawLed(w: number, h: number, on: boolean): void {
    const r = Math.min(w, h) / 2 - 3;
    const cx = w / 2;
    const cy = h / 2;
    const shape = this.get("shape") === "square"
      ? svg("rect", { class: "awi-led", x: cx - r, y: cy - r, width: 2 * r, height: 2 * r, rx: 3 })
      : svg("circle", { class: "awi-led", cx, cy, r });
    this.svgEl.appendChild(shape);
    // A11Y-003: the "on" state also shows a highlight shape, not only a color.
    if (on) this.svgEl.appendChild(svg("circle", { class: "awi-led-glint", cx: cx - r * 0.35, cy: cy - r * 0.35, r: r * 0.25 }));
  }

  drawToggle(w: number, h: number, on: boolean): void {
    const vertical = this.get("orientation") !== "horizontal";
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.28;
    this.svgEl.appendChild(svg("rect", { class: "awi-plate", x: 2, y: 2, width: w - 4, height: h - 4, rx: 6 }));
    this.svgEl.appendChild(svg("circle", { class: "awi-bezel", cx, cy, r }));
    const len = (vertical ? h : w) * 0.36;
    const dir = on ? -1 : 1;
    const [x2, y2] = vertical ? [cx, cy + dir * len] : [cx - dir * len, cy];
    this.svgEl.appendChild(svg("line", { class: "awi-lever", x1: cx, y1: cy, x2, y2, "stroke-linecap": "round" }));
    this.svgEl.appendChild(svg("circle", { class: "awi-lever-tip", cx: x2, cy: y2, r: r * 0.55 }));
    // state text on the side opposite to the lever tip
    const [tx, ty] = vertical ? [cx, on ? h - 11 : 11] : [on ? 16 : w - 16, cy];
    const label = svgText(on ? "ON" : "OFF", { class: "awi-state-small", x: tx, y: ty, "text-anchor": "middle", "dominant-baseline": "central" });
    this.svgEl.appendChild(label);
  }

  drawRocker(w: number, h: number, on: boolean): void {
    const s = this.svgEl;
    s.appendChild(svg("rect", { class: "awi-plate", x: 2, y: 2, width: w - 4, height: h - 4, rx: 6 }));
    const inset = 8;
    const half = (h - 2 * inset) / 2;
    s.appendChild(svg("rect", { class: on ? "awi-rocker awi-down" : "awi-rocker", x: inset, y: inset, width: w - 2 * inset, height: half, rx: 3 }));
    s.appendChild(svg("rect", { class: on ? "awi-rocker" : "awi-rocker awi-down", x: inset, y: inset + half, width: w - 2 * inset, height: half, rx: 3 }));
    s.appendChild(svgText("I", { class: "awi-state-text", x: w / 2, y: inset + half / 2, "text-anchor": "middle", "dominant-baseline": "central" }));
    s.appendChild(svgText("O", { class: "awi-state-text", x: w / 2, y: inset + half * 1.5, "text-anchor": "middle", "dominant-baseline": "central" }));
  }

  drawSlide(w: number, h: number, on: boolean): void {
    const s = this.svgEl;
    const r = (h - 8) / 2;
    s.appendChild(svg("rect", { class: "awi-slide-track", x: 4, y: 4, width: w - 8, height: h - 8, rx: r }));
    const cx = on ? w - 4 - r : 4 + r;
    s.appendChild(svg("circle", { class: "awi-slide-thumb", cx, cy: h / 2, r: r - 3 }));
    s.appendChild(svgText(on ? "ON" : "OFF", { class: "awi-state-small", x: on ? 4 + r + 4 : w - 4 - r - 4, y: h / 2, "text-anchor": "middle", "dominant-baseline": "central" }));
  }

  drawPush(w: number, h: number, on: boolean, armed: boolean): void {
    const s = this.svgEl;
    const lamp = this.get("lamp");
    const hasLamp = lamp === true || lamp === false;
    // an illuminated button has a translucent cap in the lamp color (BOOL-015)
    const cap = hasLamp ? `awi-lamp-${this.get("lamp_color")}` : `awi-cap-${this.get("color") || "grey"}`;
    const lit = hasLamp && lamp;
    const cls = `awi-button ${cap}${lit ? " awi-lit" : ""}${lit && this.get("lamp_blink") ? " awi-lamp-blink" : ""}${this._pressed || on ? " awi-down" : ""}`;
    const text = armed ? "Confirm?" : String(this.get("text") ?? "");
    if (this.get("shape") === "round") {
      const cx = w / 2;
      const cy = h / 2;
      const R = Math.min(w, h) / 2 - 2;
      s.appendChild(svg("circle", { class: "awi-bezel", cx, cy, r: R }));
      s.appendChild(svg("circle", { class: cls, cx, cy, r: R * (this._pressed || on ? 0.7 : 0.76) }));
      // A11Y-003: a lit lamp also shows a ring, not only a color
      if (lit) s.appendChild(svg("circle", { class: "awi-lamp-ring", cx, cy, r: R * 0.88 }));
    } else {
      s.appendChild(svg("rect", { class: cls, x: 2, y: 2, width: w - 4, height: h - 4, rx: 8 }));
      if (lit) s.appendChild(svg("rect", { class: "awi-lamp-ring", x: 5, y: 5, width: w - 10, height: h - 10, rx: 6 }));
    }
    const ink = hasLamp ? (lit ? `awi-ink-lamp ${cap}` : "awi-ink-dark") : cap;
    s.appendChild(svgText(text, { class: `awi-button-text ${ink}`, x: w / 2, y: h / 2, "text-anchor": "middle", "dominant-baseline": "central" }));
    if (on && !hasLamp && this.get("shape") !== "round") s.appendChild(svg("rect", { class: "awi-button-lamp", x: 8, y: h - 8, width: w - 16, height: 3, rx: 1.5 }));
  }

  drawEstop(w: number, h: number, on: boolean): void {
    const s = this.svgEl;
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) / 2 - 2;
    s.appendChild(svg("circle", { class: "awi-estop-plate", cx, cy, r: R }));
    s.appendChild(svg("circle", { class: "awi-estop-mushroom", cx, cy, r: R * (on ? 0.58 : 0.66) }));
    s.appendChild(svgText(on ? "STOPPED" : "STOP", { class: "awi-estop-text", x: cx, y: cy, "text-anchor": "middle", "dominant-baseline": "central" }));
  }
}
