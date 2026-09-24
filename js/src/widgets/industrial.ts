// Operator panel objects: AnalogIndicator (IND-001..003), SelectorSwitch
// (IND-010..013) and StackLight (IND-020..022).
import { selectorValue, stackStates } from "../contract/industrial.js";
import { clear, html, svg, svgText } from "../core/dom.js";
import { formatValue, tickFormat } from "../core/format.js";
import { linearHit, parseNumber, ticks } from "../core/scale.js";
import type { AnyModel } from "../core/model.js";
import { BaseView } from "../core/view.js";
import type { AnalogIndicatorTraits, SelectorSwitchTraits, StackLightTraits } from "../generated/contract.js";
import { NumericView, svgPoint } from "./numeric.js";

// ---------------------------------------------------------------------------
// AnalogIndicator: grey scale, shaded normal band, limit marks, pointer
// ---------------------------------------------------------------------------
interface AITrack {
  a0: number;
  a1: number;
  b0: number;
  b1: number;
}

export class AnalogIndicatorView extends NumericView<AnalogIndicatorTraits> {
  readonly svgEl: SVGElement;
  track: AITrack | undefined;

  constructor(model: AnyModel<AnalogIndicatorTraits>, el: HTMLElement) {
    super(model, el, ["orientation", "normal_lo", "normal_hi", "target"], { role: "slider" });
    this.svgEl = svg("svg", { class: "awi-svg", "aria-hidden": "true" });
    this.body.appendChild(this.svgEl);
    // direct manipulation in control mode (API-014): drag along the scale
    const hit = (e: PointerEvent, final: boolean): void => {
      if (!this.track) return;
      const p = svgPoint(this.svgEl, e);
      this.commitFraction(linearHit(this.vertical ? p.y : p.x, this.track.a0, this.track.a1), final);
    };
    this.drag(this.svgEl, { start: (e) => hit(e, false), move: (e) => hit(e, false), end: (e) => hit(e, true) });
    this.schedule();
  }

  get vertical(): boolean {
    return this.get("orientation") === "vertical";
  }

  opt(name: string): number | null {
    const v = this.get(name);
    return v === null || v === undefined ? null : parseNumber(v);
  }

  override draw(): void {
    const [w, h] = this.get("size");
    const s = this.svgEl;
    s.setAttribute("viewBox", `0 0 ${w} ${h}`);
    clear(s);
    const v = this.vertical;
    // track geometry: [a0, a1] along the scale, [b0, b1] across it
    const t: AITrack = v ? { a0: h - 10, a1: 10, b0: w - 30, b1: w - 18 } : { a0: 12, a1: w - 12, b0: 14, b1: 26 };
    this.track = t;
    const at = (f: number): number => t.a0 + f * (t.a1 - t.a0);
    const rect = (f0: number, f1: number, b0: number, b1: number, cls: string): SVGElement => {
      const [p, q] = [at(f0), at(f1)].sort((x, y) => x - y);
      return svg("rect", v ? { class: cls, x: b0, y: p, width: b1 - b0, height: q - p } : { class: cls, x: p, y: b0, width: q - p, height: b1 - b0 });
    };
    s.appendChild(rect(0, 1, t.b0, t.b1, "awi-ai-track"));
    const lo = this.opt("normal_lo");
    const hi = this.opt("normal_hi");
    if (lo !== null || hi !== null) s.appendChild(rect(lo === null ? 0 : this.frac(lo), hi === null ? 1 : this.frac(hi), t.b0, t.b1, "awi-ai-normal"));

    // alarm limit marks (IND-002): grey ticks across the track, heavier for lolo/hihi
    if (this.get("show_limits")) {
      for (const k of ["lolo", "lo", "hi", "hihi"]) {
        const val = this.opt(k);
        if (val === null) continue;
        const p = at(this.frac(val));
        const d = v ? `M${t.b0 - 4} ${p}H${t.b1 + 4}` : `M${p} ${t.b0 - 4}V${t.b1 + 4}`;
        s.appendChild(svg("path", { class: `awi-ai-limit awi-ai-limit-${k}`, d }));
      }
    }
    // target (IND-003): hollow diamond on the far side of the track
    const target = this.opt("target");
    if (target !== null) {
      const p = at(this.frac(target));
      const c = v ? [t.b1 + 7, p] : [p, t.b1 + 7];
      s.appendChild(svg("path", { class: "awi-ai-target", d: `M${c[0]} ${c[1] - 5}L${c[0] + 5} ${c[1]}L${c[0]} ${c[1] + 5}L${c[0] - 5} ${c[1]}Z` }));
    }

    // scale
    const tk = ticks(this.min, this.max, this.get("ticks"), 0, this.scaleType);
    const fmt = tickFormat(this.get("format"));
    for (const val of tk.major) {
      const p = at(this.frac(val));
      const attrs = v ? { x: t.b0 - 6, y: p, "text-anchor": "end", "dominant-baseline": "central" } : { x: p, y: t.b1 + 22, "text-anchor": "middle" };
      s.appendChild(svgText(formatValue(val, fmt), { class: "awi-tick-label", ...attrs }));
      s.appendChild(svg("path", { class: "awi-tick-minor", d: v ? `M${t.b0 - 3} ${p}H${t.b0}` : `M${p} ${t.b1}V${t.b1 + 3}` }));
    }

    // pointer: triangle on the near side, pointing at the track
    const pos = this.pos();
    const p = at(pos.fraction);
    const d = v
      ? `M${t.b1 + 1} ${p}L${t.b1 + 12} ${p - 7}L${t.b1 + 12} ${p + 7}Z`
      : `M${p} ${t.b0 - 1}L${p - 7} ${t.b0 - 12}L${p + 7} ${t.b0 - 12}Z`;
    s.appendChild(svg("path", { class: "awi-ai-pointer", d }));
    s.appendChild(v ? svg("path", { class: "awi-ai-pointer-line", d: `M${t.b0} ${p}H${t.b1}` }) : svg("path", { class: "awi-ai-pointer-line", d: `M${p} ${t.b0}V${t.b1}` }));
  }
}

// ---------------------------------------------------------------------------
// SelectorSwitch: rotary handle with labelled positions
// ---------------------------------------------------------------------------
const SPREAD: Record<number, number> = { 2: 90, 3: 120, 4: 150, 5: 180 };

/** Handle angle (degrees, 0 = up, clockwise) of position `i` among `n`. */
export function selectorAngle(i: number, n: number): number {
  const spread = SPREAD[n] ?? 120;
  return n <= 1 ? 0 : -spread / 2 + (i * spread) / (n - 1);
}

export class SelectorView extends BaseView<SelectorSwitchTraits> {
  readonly svgEl: SVGElement;
  readonly stateEl: HTMLDivElement;
  readonly choice: HTMLSelectElement;

  constructor(model: AnyModel<SelectorSwitchTraits>, el: HTMLElement) {
    super(model, el, ["value", "positions", "keyed", "locked", "spring_return", "default_position"]);
    this.svgEl = svg("svg", { class: "awi-svg", viewBox: "0 0 100 100", "aria-hidden": "true" });
    this.body.appendChild(this.svgEl);
    this.stateEl = html("div", { cls: "awi-value-row" }, [html("span", { cls: "awi-value" })]);
    // form entry (API-014): the list of positions, in control mode
    this.choice = html("select", { cls: "awi-choice", attrs: { "data-lm-suppress-shortcuts": "true" } });
    this.choice.addEventListener("change", () => this.select(this.choice.value));
    this.choice.addEventListener("keydown", (e) => e.stopPropagation());
    this.stateEl.appendChild(this.choice);
    this.root.appendChild(this.stateEl);
    this.body.setAttribute("aria-labelledby", this.labelEl.id);
    this.body.addEventListener("keydown", (e) => this.onKey(e));
    this.body.addEventListener("keyup", () => this.release());
    this.body.addEventListener("pointerup", () => this.release());
    this.body.addEventListener("pointercancel", () => this.release());
    this.schedule();
  }

  get positions(): string[] {
    return this.get("positions") || [];
  }

  /** Selected position, resolved as the kernel does (x-awi-resolved). */
  get value(): string {
    return selectorValue(this.positions, this.get("value"), this.get("default_position"));
  }

  get canOperate(): boolean {
    return this.interactive && !(this.get("keyed") && this.get("locked"));
  }

  select(label: string): void {
    if (!this.canOperate || label === this.value) return;
    this.model.set("value", label);
    this.model.save_changes();
    this.schedule();
  }

  /** IND-013: spring-return positions go back to the default when released. */
  release(): void {
    const v = this.value;
    const def = this.get("default_position");
    if (def && (this.get("spring_return") || []).includes(v)) this.select(def);
  }

  onKey(e: KeyboardEvent): void {
    if (e.repeat && (e.key.startsWith("Arrow"))) return e.preventDefault();
    const pos = this.positions;
    const i = pos.indexOf(this.value);
    const map: Record<string, number> = { ArrowRight: i + 1, ArrowUp: i + 1, ArrowLeft: i - 1, ArrowDown: i - 1, Home: 0, End: pos.length - 1 };
    if (!(e.key in map)) return;
    e.preventDefault();
    const j = Math.min(pos.length - 1, Math.max(0, map[e.key]));
    this.select(pos[j]);
  }

  override draw(): void {
    const s = this.svgEl;
    clear(s);
    const pos = this.positions;
    const value = this.value;
    const idx = Math.max(0, pos.indexOf(value));
    const locked = !!(this.get("keyed") && this.get("locked"));
    this.root.classList.toggle("awi-locked", locked);
    s.appendChild(svg("circle", { class: "awi-sel-plate", cx: 50, cy: 58, r: 28 }));
    pos.forEach((label, i) => {
      const a = (selectorAngle(i, pos.length) * Math.PI) / 180;
      const [x, y] = [50 + 43 * Math.sin(a), 58 - 42 * Math.cos(a)];
      const [mx, my] = [50 + 29 * Math.sin(a), 58 - 29 * Math.cos(a)];
      s.appendChild(svg("path", { class: "awi-tick-major", d: `M${mx} ${my}L${50 + 33 * Math.sin(a)} ${58 - 33 * Math.cos(a)}` }));
      const text = svgText(label, { class: `awi-sel-label${i === idx ? " awi-sel-current" : ""}`, x, y, "text-anchor": "middle", "dominant-baseline": "central" });
      // pointer: press a label to select it (released on pointerup for spring return)
      const hit = svg("circle", { class: "awi-sel-hit", cx: x, cy: y, r: 11 });
      hit.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this.body.focus({ preventScroll: true });
        this.select(label);
      });
      s.append(text, hit);
    });
    const angle = selectorAngle(idx, pos.length);
    const handle = svg("g", { class: "awi-sel-handle", transform: `rotate(${angle} 50 58)` }, [
      svg("circle", { class: "awi-knob-body", cx: 50, cy: 58, r: 19 }),
      svg("rect", { class: "awi-sel-bar", x: 44.5, y: 36, width: 11, height: 44, rx: 5 }),
      svg("path", { class: "awi-sel-arrow", d: "M50 38L46 45H54Z" }),
    ]);
    s.appendChild(handle);
    if (this.get("keyed")) {
      // key slot, plus a padlock when locked (IND-012)
      s.appendChild(svg("rect", { class: "awi-sel-key", x: 47.5, y: 52, width: 5, height: 12, rx: 1 }));
      if (locked) {
        s.appendChild(svg("g", { class: "awi-sel-lock" }, [
          svg("path", { class: "awi-lock-shackle", d: "M6 88V83A5 5 0 0 1 16 83V88" }),
          svg("rect", { class: "awi-lock-body", x: 3, y: 88, width: 16, height: 11, rx: 2 }),
        ]));
      }
    }
    const text = `${value}${locked ? " · LOCKED" : ""}`;
    const valueEl = this.stateEl.firstChild as HTMLElement;
    valueEl.textContent = text;
    const list = this.get("mode") === "control";
    this.choice.hidden = !list;
    // with the list shown, the text only says whether the key switch is locked
    if (list) valueEl.textContent = locked ? "LOCKED" : "";
    valueEl.hidden = list && !locked;
    if (list) {
      const labels = [...this.choice.options].map((o) => o.value);
      if (labels.join("\u0000") !== pos.join("\u0000")) {
        clear(this.choice);
        for (const p of pos) this.choice.appendChild(html("option", { text: p, attrs: { value: p } }));
      }
      this.choice.value = value;
      this.choice.disabled = !this.canOperate;
      this.choice.setAttribute("aria-label", `${this.get("label") || "Selector"} position${locked ? " (locked)" : ""}`);
    }
    const b = this.body;
    b.tabIndex = this.get("mode") === "control" ? 0 : -1;
    b.setAttribute("role", this.get("mode") === "control" ? "slider" : "img");
    b.setAttribute("aria-valuemin", "0");
    b.setAttribute("aria-valuemax", String(pos.length - 1));
    b.setAttribute("aria-valuenow", String(idx));
    b.setAttribute("aria-valuetext", text);
    if (locked) b.setAttribute("aria-readonly", "true");
    else b.removeAttribute("aria-readonly");
  }
}

// ---------------------------------------------------------------------------
// StackLight: tiers with color, state glyph and text (IND-021)
// ---------------------------------------------------------------------------
const STATE_GLYPH: Record<string, string> = { off: "○", on: "●", blink: "◐" };

export class StackLightView extends BaseView<StackLightTraits> {
  readonly svgEl: SVGElement;

  constructor(model: AnyModel<StackLightTraits>, el: HTMLElement) {
    super(model, el, ["value", "tiers", "labels", "buzzer"]);
    this.svgEl = svg("svg", { class: "awi-svg", "aria-hidden": "true" });
    this.body.appendChild(this.svgEl);
    this.body.setAttribute("role", "status");
    this.schedule();
  }

  override draw(): void {
    const [w, h] = this.get("size");
    const s = this.svgEl;
    s.setAttribute("viewBox", `0 0 ${w} ${h}`);
    clear(s);
    const tiers = this.get("tiers") || [];
    // one state per tier, resolved as the kernel does (x-awi-resolved)
    const states = stackStates(tiers, this.get("value") || []);
    const labels = this.get("labels") || [];
    const buzzer = !!this.get("buzzer");
    const col = { x: 8, w: Math.min(40, w * 0.35) };
    const top = buzzer ? 26 : 8;
    const pole = 26;
    const tierH = Math.max(12, (h - top - pole - 4) / Math.max(1, tiers.length));
    const parts: string[] = [];
    if (buzzer) {
      s.appendChild(svg("rect", { class: "awi-stack-buzzer", x: col.x + 4, y: 6, width: col.w - 8, height: 16, rx: 3 }));
      s.appendChild(svg("path", { class: "awi-stack-waves", d: `M${col.x + col.w + 3} 9q4 5 0 10M${col.x + col.w + 8} 6q6 8 0 16` }));
      s.appendChild(svgText("♪ BUZZER", { class: "awi-stack-text", x: col.x + col.w + 16, y: 14, "dominant-baseline": "central" }));
      parts.push("buzzer sounding");
    }
    tiers.forEach((color, i) => {
      const state = states[i] || "off";
      const y = top + i * tierH;
      s.appendChild(svg("rect", { class: `awi-stack-tier awi-stack-${color} awi-stack-${state}`, x: col.x, y: y + 1, width: col.w, height: tierH - 2, rx: 3 }));
      const label = labels[i] || color;
      const text = `${STATE_GLYPH[state] || ""} ${label}: ${state.toUpperCase()}`;
      s.appendChild(svgText(text, { class: `awi-stack-text awi-stack-text-${state}`, x: col.x + col.w + 6, y: y + tierH / 2, "dominant-baseline": "central" }));
      parts.push(`${label} ${state}`);
    });
    const baseY = top + tiers.length * tierH;
    s.appendChild(svg("rect", { class: "awi-stack-pole", x: col.x + col.w / 2 - 3, y: baseY, width: 6, height: pole - 8 }));
    s.appendChild(svg("rect", { class: "awi-stack-pole", x: col.x, y: baseY + pole - 8, width: col.w, height: 6, rx: 2 }));
    this.body.setAttribute("aria-label", `${this.get("label") || "Stack light"}: ${parts.join(", ")}`);
  }
}
