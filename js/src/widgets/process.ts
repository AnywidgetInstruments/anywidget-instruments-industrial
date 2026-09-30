// Supervisory objects: Valve, Pump, Motor (SCADA-001..003, SCADA-009),
// Pipe (SCADA-004), SynopticCanvas (SCADA-010).
import { hostOwnsState } from "../contract/derived.js";
import { type ProcessChanges, positionDemand, processCommand, type ProcessState } from "../contract/process.js";
import { imageMime } from "../contract/synoptic.js";
import { clear, html, safeColor, svg, svgText } from "anywidget-instruments/js/src/core/dom.js";
import { checkEntry } from "../core/entry.js";
import type { AnyModel, Traits } from "anywidget-instruments/js/src/core/model.js";
import { BaseView } from "anywidget-instruments/js/src/core/view.js";
import type { PipeTraits, ProcessTraits, PumpTraits, SynopticCanvasTraits, ValveTraits } from "../generated/contract.js";

/** Traits of Valve, Pump and Motor, from their schemas. */
export type ProcessViewTraits = ProcessTraits & { value: string } & Partial<Pick<ValveTraits, "position" | "orientation"> & Pick<PumpTraits, "animate" | "direction">>;

const STATE_TEXT: Record<string, string> = {
  open: "OPEN", closed: "CLOSED", transit: "TRANSIT", fault: "FAULT",
  stopped: "STOPPED", running: "RUNNING", forward: "FWD", reverse: "REV",
};

// Shared across module copies: the open faceplate, if any.
const scope = globalThis as typeof globalThis & { __awiFaceplate?: { current: ProcessView | null } };
const OPEN = (scope.__awiFaceplate ||= { current: null });

const COMMAND_TEXT: Record<string, string> = { open: "Open", close: "Close", start: "Start", stop: "Stop", forward: "Forward", reverse: "Reverse" };

export class ProcessView extends BaseView<ProcessViewTraits> {
  readonly svgEl: SVGElement;
  readonly stateEl: HTMLDivElement;
  faceplate: HTMLDivElement | null;
  fpMain: HTMLDivElement | null = null;
  fpPos: { row: HTMLDivElement; slider: HTMLInputElement; field: HTMLInputElement; msg: HTMLDivElement } | null = null;
  protected _outside: ((e: Event) => void) | undefined;

  constructor(model: AnyModel<ProcessViewTraits>, el: HTMLElement) {
    super(model, el, ["value", "position", "orientation", "animate", "direction", "tag", "auto", "simulate", "commands"]);
    this.svgEl = svg("svg", { class: "awi-svg", viewBox: "0 0 100 100", "aria-hidden": "true" });
    this.stateEl = html("div", { cls: "awi-process-state" });
    this.body.append(this.svgEl);
    this.root.append(this.stateEl);
    this.faceplate = null;
    this.body.addEventListener("click", () => this.interactive && this.toggleFaceplate());
    this.body.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && this.interactive) {
        e.preventDefault();
        this.toggleFaceplate();
      } else if (e.key === "Escape") this.closeFaceplate();
    });
    this._disposers.push(() => this.closeFaceplate(false));
    this.schedule();
  }

  // -- faceplate (SCADA-009) ------------------------------------------------------
  toggleFaceplate(): void {
    if (this.faceplate) this.closeFaceplate();
    else this.openFaceplate();
  }

  closeFaceplate(refocus = true): void {
    if (!this.faceplate) return;
    this.faceplate.remove();
    this.faceplate = null;
    this.fpMain = null;
    this.fpPos = null;
    if (this._outside) document.removeEventListener("pointerdown", this._outside, true);
    if (OPEN.current === this) OPEN.current = null;
    if (refocus) this.body.focus({ preventScroll: true });
  }

  openFaceplate(): void {
    // one faceplate at a time, closed by a click outside or Escape
    if (OPEN.current && OPEN.current !== this) OPEN.current.closeFaceplate(false);
    OPEN.current = this;
    this._outside ||= (e) => {
      if (!e.composedPath().includes(this.root)) this.closeFaceplate(false);
    };
    document.addEventListener("pointerdown", this._outside, true);
    const fp = html("div", { cls: "awi-faceplate", attrs: { role: "dialog", "aria-label": `${this.get("tag") || this.get("label") || this.kind} faceplate` } });
    this.faceplate = fp;
    this.root.appendChild(fp);
    this.renderFaceplate();
    fp.addEventListener("keydown", (e) => e.key === "Escape" && this.closeFaceplate());
    fp.querySelector("button")?.focus();
  }

  /** Faceplate state for the command rules (x-awi-simulated in the schema). */
  get processState(): ProcessState {
    const pos = this.get("position");
    return {
      auto: !!this.get("auto"),
      simulate: !!this.get("simulate"),
      commands: this.get("commands") || [],
      simulated: this.contract?.traits.commands.simulated ?? {},
      position: pos === null || pos === undefined ? null : Number(pos),
    };
  }

  renderFaceplate(): void {
    if (!this.faceplate) return;
    // the position row is kept across renders: typing must survive feedback updates
    if (!this.fpMain) {
      this.fpMain = html("div");
      this.faceplate.appendChild(this.fpMain);
    }
    if (this.fpMain.parentNode !== this.faceplate) this.faceplate.prepend(this.fpMain);
    const fp = this.fpMain;
    clear(fp);
    const head = html("div", { cls: "awi-faceplate-head" }, [
      html("span", { text: this.get("tag") || this.get("label") || this.kind }),
      html("button", { cls: "awi-fp-close", text: "×", attrs: { type: "button", "aria-label": "Close" } }),
    ]);
    head.querySelector("button")?.addEventListener("click", () => this.closeFaceplate());
    fp.appendChild(head);
    fp.appendChild(html("div", { cls: "awi-fp-row", text: `State: ${STATE_TEXT[this.get("value")] || this.get("value")}` }));
    const auto = !!this.get("auto");
    const mode = html("div", { cls: "awi-fp-row awi-fp-mode" });
    for (const m of ["auto", "manual"]) {
      const b = html("button", { text: m === "auto" ? "Auto" : "Manual", attrs: { type: "button", "aria-pressed": String((m === "auto") === auto) } });
      b.addEventListener("click", () => this.send(m));
      mode.appendChild(b);
    }
    fp.appendChild(mode);
    const cmds = html("div", { cls: "awi-fp-row awi-fp-commands" });
    for (const c of this.get("commands") || []) {
      const b = html("button", { text: COMMAND_TEXT[c] || c, attrs: { type: "button" } });
      b.disabled = auto; // commands are operator actions: manual mode only
      b.title = auto ? "Switch to manual to operate" : "";
      b.addEventListener("click", () => this.send(c));
      cmds.appendChild(b);
    }
    fp.appendChild(cmds);
    this.renderPositionRow();
  }

  /** Control valve position demand (API-014): slider and typed value, manual mode only. */
  renderPositionRow(): void {
    const pos = this.get("position");
    const show = this.kind === "valve" && pos !== null && pos !== undefined;
    if (!show) {
      this.fpPos?.row.remove();
      return;
    }
    if (!this.fpPos || this.fpPos.row.parentNode !== this.faceplate) {
      const slider = html("input", { cls: "awi-fp-slider", attrs: { type: "range", min: "0", max: "100", step: "1", "aria-label": "Position demand %", "data-lm-suppress-shortcuts": "true" } });
      const field = html("input", { cls: "awi-entry", attrs: { type: "text", inputmode: "decimal", "aria-label": "Position demand % (0 to 100)", "data-lm-suppress-shortcuts": "true" } });
      const msg = html("div", { cls: "awi-entry-msg", attrs: { role: "alert" } });
      const send = (v: number): void => {
        if (!this.interactive) return;
        this.model.send({ type: "command", command: "position", value: v });
        this.applyLocally(positionDemand(v, this.processState));
      };
      slider.addEventListener("change", () => send(Number(slider.value)));
      field.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key !== "Enter") return;
        e.preventDefault();
        const r = checkEntry(field.value, { min: 0, max: 100, unit: "%", format: "%.0f" });
        msg.textContent = r.ok ? "" : r.reason;
        field.toggleAttribute("aria-invalid", !r.ok);
        if (r.ok) send(r.value);
      });
      const row = html("div", { cls: "awi-fp-row awi-fp-position" }, [html("span", { text: "Position %" }), slider, field, msg]);
      this.fpPos = { row, slider, field, msg };
      this.faceplate?.appendChild(row);
    }
    const { slider, field } = this.fpPos;
    const manual = !this.get("auto");
    slider.disabled = !manual;
    field.disabled = !manual;
    if (document.activeElement !== slider) slider.value = String(Math.round(Number(pos)));
    if (document.activeElement !== field) field.value = String(Math.round(Number(pos)));
  }

  /** Faceplate command: always sent to the host; applied by the front end when no host owns the state (HOST-004). */
  send(command: string): void {
    if (!this.interactive) return;
    this.model.send({ type: "command", command });
    this.applyLocally(processCommand(command, this.processState));
  }

  applyLocally(changes: ProcessChanges): void {
    const model = this.model as unknown as AnyModel<Traits>;
    if (hostOwnsState(model) || Object.keys(changes).length === 0) return;
    for (const [name, v] of Object.entries(changes)) model.set(name, v);
    model.save_changes();
  }

  // -- drawing -------------------------------------------------------------------
  override draw(): void {
    const state = this.get("value");
    const r = this.root;
    for (const s of Object.keys(STATE_TEXT)) r.classList.toggle(`awi-st-${s}`, s === state);
    r.classList.toggle("awi-anim", !!this.get("animate"));
    const s = this.svgEl;
    clear(s);
    ({ valve: () => this.drawValve(s, state), pump: () => this.drawPump(s, state), motor: () => this.drawMotor(s, state) } as Record<string, () => void>)[this.kind]?.();
    if (state === "fault") s.appendChild(svgText("!", { class: "awi-fault-mark", x: 88, y: 16, "text-anchor": "middle", "dominant-baseline": "central" }));
    const pos = this.get("position");
    const parts = [STATE_TEXT[state] || state];
    if (this.kind === "valve" && pos !== null && pos !== undefined) parts.push(`${Math.round(Number(pos))} %`);
    if (!this.get("auto")) parts.push("MAN");
    this.stateEl.textContent = parts.join(" · ");
    const b = this.body;
    b.tabIndex = this.get("mode") === "control" ? 0 : -1;
    b.setAttribute("role", this.get("mode") === "control" ? "button" : "img");
    b.setAttribute("aria-label", `${this.get("tag") || this.get("label") || this.kind}: ${parts.join(", ")}`);
    if (this.get("mode") === "control") b.setAttribute("aria-haspopup", "dialog");
    else b.removeAttribute("aria-haspopup");
    this.renderFaceplate();
  }

  drawValve(s: SVGElement, state: string): void {
    const g = svg("g", { transform: this.get("orientation") === "vertical" ? "rotate(90 50 50)" : "" });
    const pos = this.get("position");
    // actuator
    g.appendChild(svg("line", { class: "awi-stem", x1: 50, y1: 55, x2: 50, y2: 30 }));
    g.appendChild(svg("path", { class: "awi-actuator", d: "M34 30 A16 14 0 0 1 66 30 Z" }));
    // body: two triangles (bow tie)
    const left = svg("path", { class: "awi-valve-body awi-vl", d: "M14 36 L50 55 L14 74 Z" });
    const right = svg("path", { class: "awi-valve-body awi-vr", d: "M86 36 L50 55 L86 74 Z" });
    g.append(left, right);
    if (pos !== null && pos !== undefined && state !== "fault") {
      // control valve: opening shown as a bar under the body
      g.appendChild(svg("rect", { class: "awi-track", x: 14, y: 82, width: 72, height: 6, rx: 2 }));
      g.appendChild(svg("rect", { class: "awi-fill", x: 14, y: 82, width: (72 * Math.max(0, Math.min(100, Number(pos)))) / 100, height: 6, rx: 2 }));
    }
    s.appendChild(g);
  }

  drawPump(s: SVGElement, state: string): void {
    const rot = ({ right: 0, down: 90, left: 180, up: 270 } as Record<string, number>)[String(this.get("direction"))] || 0;
    const g = svg("g", { transform: `rotate(${rot} 50 50)` });
    g.appendChild(svg("path", { class: "awi-pump-outlet", d: "M50 18 H88 V36 H72" }));
    g.appendChild(svg("circle", { class: "awi-pump-body", cx: 50, cy: 52, r: 32 }));
    const imp = svg("g", { class: "awi-rotor" });
    for (const a of [0, 120, 240]) imp.appendChild(svg("path", { class: "awi-blade", d: "M50 52 Q58 40 50 28", transform: `rotate(${a} 50 52)` }));
    imp.style.transformOrigin = "50px 52px";
    g.appendChild(imp);
    s.appendChild(g);
    s.appendChild(svg("path", { class: "awi-base", d: "M22 94 L34 80 H66 L78 94 Z" }));
    void state;
  }

  drawMotor(s: SVGElement, state: string): void {
    s.appendChild(svg("rect", { class: "awi-motor-shaft", x: 82, y: 45, width: 14, height: 10, rx: 2 }));
    s.appendChild(svg("circle", { class: "awi-motor-body", cx: 46, cy: 50, r: 36 }));
    s.appendChild(svgText("M", { class: "awi-motor-letter", x: 46, y: 51, "text-anchor": "middle", "dominant-baseline": "central" }));
    if (state === "forward" || state === "reverse") {
      const arc = svg("g", { class: `awi-rotor${state === "reverse" ? " awi-ccw" : ""}` });
      const d = state === "forward" ? "M46 8 A42 42 0 0 1 84 32" : "M84 32 A42 42 0 0 0 46 8";
      arc.appendChild(svg("path", { class: "awi-dir-arrow", d }));
      const tip = state === "forward" ? "M84 32 l-9 -1 l5 -7 Z" : "M46 8 l8 -4 l0 8 Z";
      arc.appendChild(svg("path", { class: "awi-dir-tip", d: tip }));
      s.appendChild(arc);
    }
  }
}

// -- pipes -----------------------------------------------------------------------------
const PIPE_PATHS: Record<string, string[]> = {
  straight: ["M0 50 H100"],
  elbow: ["M0 50 H50 V100"],
  tee: ["M0 50 H100", "M50 50 V100"],
  cross: ["M0 50 H100", "M50 0 V100"],
};

function flowPath(parent: SVGElement, d: string, { flow, reverse, width, color, animate }: { flow: boolean; reverse: boolean; width: number; color: string; animate: boolean }): void {
  const pipe = svg("path", { class: "awi-pipe", d, "stroke-width": width, fill: "none" });
  const fluid = svg("path", { class: `awi-pipe-fluid${flow ? " awi-flowing" : ""}${reverse ? " awi-reverse" : ""}${animate ? " awi-anim-flow" : ""}`, d, "stroke-width": width * 0.45, fill: "none" });
  if (color) fluid.style.stroke = color;
  parent.append(pipe, fluid);
}

export class PipeView extends BaseView<PipeTraits> {
  readonly svgEl: SVGElement;

  constructor(model: AnyModel<PipeTraits>, el: HTMLElement) {
    super(model, el, ["value", "shape", "rotation", "flow_animation", "flow_direction", "fluid_color", "thickness"]);
    this.svgEl = svg("svg", { class: "awi-svg", viewBox: "0 0 100 100", preserveAspectRatio: "none", "aria-hidden": "true" });
    this.body.appendChild(this.svgEl);
    this.body.setAttribute("role", "img");
    this.schedule();
  }

  override draw(): void {
    const s = this.svgEl;
    clear(s);
    const g = svg("g", { transform: `rotate(${Number(this.get("rotation")) || 0} 50 50)` });
    const [w, h] = this.get("size");
    const width = (Number(this.get("thickness")) || 14) * (100 / Math.min(w, h));
    for (const d of PIPE_PATHS[this.get("shape")] || PIPE_PATHS.straight) {
      flowPath(g, d, { flow: !!this.get("value"), reverse: this.get("flow_direction") === "reverse", width, color: safeColor(this.get("fluid_color")), animate: !!this.get("flow_animation") });
    }
    s.appendChild(g);
    this.body.setAttribute("aria-label", `${this.get("label") || "Pipe"}: ${this.get("value") ? `flow ${this.get("flow_direction")}` : "no flow"}`);
  }
}

// -- synoptic canvas --------------------------------------------------------------------
interface ChildView {
  el: HTMLElement;
  remove?(): void;
  trigger?(event: string): void;
}

interface WidgetManager {
  get_model(id: string): Promise<unknown>;
  create_view(model: unknown, options: object): Promise<ChildView>;
}

/** SynopticCanvas: nested widgets need a Jupyter widget manager (migrated last). */
const IMAGE_MIMES = ["image/png", "image/jpeg", "image/svg+xml"];

export class SynopticView extends BaseView<SynopticCanvasTraits> {
  readonly bg: HTMLImageElement;
  readonly pipeLayer: SVGElement;
  readonly childLayer: HTMLDivElement;
  readonly views: Map<string, { el: HTMLElement; view: ChildView | null }>;
  bgUrl: string | null;

  constructor(model: AnyModel<SynopticCanvasTraits>, el: HTMLElement) {
    super(model, el, ["items", "pipes", "background", "background_mime"]);
    this.body.classList.add("awi-synoptic-body");
    this.bg = html("img", { cls: "awi-synoptic-bg", attrs: { alt: "" } });
    this.pipeLayer = svg("svg", { class: "awi-synoptic-pipes", "aria-hidden": "true" });
    this.childLayer = html("div", { cls: "awi-synoptic-children" });
    this.body.append(this.bg, this.pipeLayer, this.childLayer);
    this.body.setAttribute("role", "group");
    this.views = new Map(); // model id -> holder element and child view
    this.bgUrl = null;
    this._disposers.push(() => {
      if (this.bgUrl) URL.revokeObjectURL(this.bgUrl);
      for (const { view } of this.views.values()) view?.remove?.();
    });
    this.listen("change:items", () => this.syncChildren());
    this.listen("change:background", () => this.updateBackground());
    this.updateBackground();
    this.syncChildren();
    this.schedule();
  }

  updateBackground(): void {
    if (this.bgUrl) URL.revokeObjectURL(this.bgUrl);
    this.bgUrl = null;
    // bytes: a buffer from Jupyter, base64 text from a JSON-only host (read through the contract)
    const bytes = this.get("background") as unknown as Uint8Array;
    const given = this.get("background_mime");
    // the type Python sets; a host that does not set it: detected from the bytes, as Python does
    const mime = IMAGE_MIMES.includes(given) ? given : imageMime(bytes);
    if (bytes.length && mime) {
      this.bgUrl = URL.createObjectURL(new Blob([bytes.slice()], { type: mime }));
      this.bg.src = this.bgUrl;
      this.bg.hidden = false;
    } else {
      this.bg.removeAttribute("src");
      this.bg.hidden = true;
    }
  }

  async syncChildren(): Promise<void> {
    const items = this.get("items");
    const wm = this.model.widget_manager as Partial<WidgetManager> | undefined;
    const wanted = new Set<string>();
    for (const it of items) {
      const ref = typeof it.widget === "string" ? it.widget.replace(/^IPY_MODEL_/, "") : null;
      if (!ref) continue;
      wanted.add(ref);
      let entry = this.views.get(ref);
      if (!entry) {
        const holder = html("div", { cls: "awi-synoptic-item" });
        entry = { el: holder, view: null as ChildView | null };
        this.views.set(ref, entry);
        this.childLayer.appendChild(holder);
        if (wm && typeof wm.get_model === "function" && typeof wm.create_view === "function") {
          try {
            const child = await wm.get_model(ref);
            const view = await wm.create_view(child, {});
            entry.view = view;
            holder.appendChild(view.el);
            view.trigger?.("displayed");
          } catch {
            holder.textContent = "⚠ widget unavailable";
          }
        } else {
          holder.textContent = "⚠ nested widgets need a Jupyter host";
        }
      }
      entry.el.style.left = `${Number(it.x) || 0}px`;
      entry.el.style.top = `${Number(it.y) || 0}px`;
    }
    for (const [ref, entry] of this.views) {
      if (!wanted.has(ref)) {
        entry.view?.remove?.();
        entry.el.remove();
        this.views.delete(ref);
      }
    }
  }

  override draw(): void {
    const [w, h] = this.get("size");
    this.pipeLayer.setAttribute("viewBox", `0 0 ${w} ${h}`);
    clear(this.pipeLayer);
    for (const p of this.get("pipes")) {
      const pts = (Array.isArray(p.points) ? p.points : []).filter((q): q is [number, number] => Array.isArray(q));
      if (pts.length < 2) continue;
      const d = pts.map((q, i) => `${i ? "L" : "M"}${Number(q[0]) || 0} ${Number(q[1]) || 0}`).join("");
      flowPath(this.pipeLayer, d, { flow: !!p.flow, reverse: p.direction === "reverse", width: Number(p.thickness) || 10, color: safeColor(p.color), animate: true });
    }
    this.body.setAttribute("aria-label", String(this.get("label") || "Synoptic"));
  }
}
