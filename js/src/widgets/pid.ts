// PID faceplate (IND-030..034): PV / SP / OP bars and values, loop mode,
// operator entries with mode rules and confirmation of large changes.
import { hostOwnsState, pidState } from "../contract/derived.js";
import { loopModeChange, operatorSet, type PIDState } from "../contract/pid.js";
import { clear, html, svg, svgText } from "../core/dom.js";
import { formatValue, tickFormat, withUnit } from "../core/format.js";
import { fromFraction, linearHit, parseNumber, ticks, toFraction } from "../core/scale.js";
import type { AnyModel } from "../core/model.js";
import { BaseView } from "../core/view.js";
import type { PIDFaceplateTraits } from "../generated/contract.js";
import { svgPoint } from "./numeric.js";

type Field = "pv" | "sp" | "op";

const ALARM_TEXT: Record<string, string> = { lolo: "LOLO", lo: "LO", hi: "HI", hihi: "HIHI" };
const EDITABLE_IN: Record<string, string> = { sp: "AUTO", op: "MAN" };

/**
 * Operator entry check done before sending (the kernel checks again): the
 * rules of operatorSet (contract/pid.ts), with whether a confirmation is needed.
 */
export function entryDecision({ field, mode, value, current, min, max, confirmDelta }: { field: string; mode: string; value: number; current: number; min: number; max: number; confirmDelta?: number | null }): { ok: true; value: number; confirm: boolean } | { ok: false; reason: string } {
  const s: PIDState = { pv: NaN, sp: current, op: current, loop_mode: mode, modes: [mode], pv_min: min, pv_max: max, sp_min: null, sp_max: null, op_min: min, op_max: max, confirm_delta: confirmDelta ?? null, sp_tracking: false };
  const r = operatorSet(s, field, value, true);
  if (!r.ok) return r;
  return { ok: true, value: r.value, confirm: confirmDelta !== null && confirmDelta !== undefined && Math.abs(r.value - current) > confirmDelta };
}

export class PIDView extends BaseView<PIDFaceplateTraits> {
  readonly head: HTMLDivElement;
  readonly tagEl: HTMLSpanElement;
  readonly modeBar: HTMLDivElement;
  readonly svgEl: SVGElement;
  readonly rows: Record<string, { row: HTMLDivElement; val: HTMLSpanElement; input: HTMLInputElement; set: HTMLButtonElement }>;
  readonly note: HTMLDivElement;
  pending: string | null;
  preview: { field: Field; value: number } | null;
  barGeom: { pv: [number, number]; op: [number, number]; y0: number; y1: number } | undefined;

  constructor(model: AnyModel<PIDFaceplateTraits>, el: HTMLElement) {
    super(model, el, ["value", "tag", "unit", "op_unit", "format", "pv", "sp", "op", "loop_mode", "modes", "pv_min", "pv_max", "sp_min", "sp_max", "op_min", "op_max", "confirm_delta", "lolo", "lo", "hi", "hihi", "alarm_level"]);
    const b = this.body;
    b.setAttribute("role", "group");
    this.head = html("div", { cls: "awi-pid-head" });
    this.tagEl = html("span", { cls: "awi-pid-tag" });
    this.modeBar = html("div", { cls: "awi-pid-modes", attrs: { role: "group", "aria-label": "Loop mode" } });
    this.head.append(this.tagEl, this.modeBar);
    this.svgEl = svg("svg", { class: "awi-svg awi-pid-bars", "aria-hidden": "true" });
    this.rows = {};
    const table = html("div", { cls: "awi-pid-rows" });
    for (const f of ["pv", "sp", "op"] as Field[]) {
      const name = html("span", { cls: "awi-pid-name", text: f.toUpperCase() });
      const val = html("span", { cls: "awi-pid-val" });
      const input = html("input", { cls: "awi-pid-input", attrs: { type: "number", "aria-label": `New ${f.toUpperCase()}`, "data-lm-suppress-shortcuts": "true" } });
      const set = html("button", { cls: "awi-pid-set", text: "Set", attrs: { type: "button", "aria-label": `Set ${f.toUpperCase()}` } });
      const commit = () => this.enter(f, parseNumber(input.value));
      set.addEventListener("click", commit);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          input.value = "";
          input.blur();
        }
      });
      const row = html("div", { cls: `awi-pid-row awi-pid-${f}` }, [name, val, f === "pv" ? null : input, f === "pv" ? null : set]);
      table.appendChild(row);
      this.rows[f] = { row, val, input, set };
    }
    this.note = html("div", { cls: "awi-pid-note", attrs: { role: "status", "aria-live": "polite" } });
    b.append(this.head, this.svgEl, table, this.note);
    this.pending = null;
    // direct manipulation (API-014): drag the SP marker in AUTO, the OP bar in MAN
    this.preview = null;
    this.svgEl.addEventListener("pointerdown", (e) => this.startDrag(e));
    this.listen("msg:custom", (msg: { type?: string; reason?: string } | null) => {
      if (msg && msg.type === "rejected") this.showNote(`✖ ${msg.reason}`);
    });
    this.schedule();
  }

  num(name: string): number | null {
    const v = this.get(name);
    if (v === null || v === undefined) return null;
    // SP and OP as the kernel stores them: clamped to their limits
    if (this.contract && (name === "sp" || name === "op")) return this.state[name];
    return parseNumber(v);
  }

  /** Operator-rule state, read through the contract. */
  get state(): PIDState {
    return pidState((k) => this.get(k));
  }

  /** Apply an accepted operator action when no host owns the state (HOST-004). */
  applyLocally(changes: Record<string, unknown>): void {
    const model = this.model as unknown as AnyModel;
    if (!this.contract || hostOwnsState(model)) return;
    for (const [k, v] of Object.entries(changes)) model.set(k, v);
    model.save_changes();
  }

  spLimits(): [number, number] {
    return [(this.num("sp_min") ?? this.num("pv_min")) as number, (this.num("sp_max") ?? this.num("pv_max")) as number];
  }

  showNote(text: string, buttons: HTMLElement[] = []): void {
    clear(this.note);
    this.note.appendChild(html("span", { text }));
    for (const btn of buttons) this.note.appendChild(btn);
  }

  /** Operator entry (IND-031, IND-032). */
  enter(field: Field, value: number): void {
    if (!this.interactive) return;
    const [min, max] = field === "sp" ? this.spLimits() : [this.num("op_min") as number, this.num("op_max") as number];
    const d = entryDecision({ field, mode: this.get("loop_mode"), value, current: this.num(field) as number, min, max, confirmDelta: this.num("confirm_delta") });
    if (!d.ok) return this.showNote(`✖ ${d.reason}`);
    const send = (confirmed: boolean): void => {
      this.model.send({ type: "set", field, value: d.value, confirmed });
      const r = operatorSet(this.state, field, d.value, confirmed);
      if (r.ok) this.applyLocally({ [r.field]: r.value });
      this.rows[field].input.value = "";
      this.showNote("");
      this.pending = null;
    };
    if (!d.confirm) return send(false);
    const fmt = this.get("format");
    const ok = html("button", { cls: "awi-pid-confirm", text: "Confirm", attrs: { type: "button" } });
    const cancel = html("button", { text: "Cancel", attrs: { type: "button" } });
    ok.addEventListener("click", () => send(true));
    cancel.addEventListener("click", () => {
      this.pending = null;
      this.showNote("");
    });
    this.pending = field;
    this.showNote(`Change ${field.toUpperCase()} ${formatValue(this.num(field) as number, fmt)} → ${formatValue(d.value, fmt)}?`, [ok, cancel]);
    ok.focus();
  }

  /** Field and value under the pointer, or null when that field is not editable now. */
  dragTarget(e: PointerEvent): { field: Field; value: number } | null {
    const g = this.barGeom;
    if (!g) return null;
    const p = svgPoint(this.svgEl, e);
    const field: Field | null = p.x >= g.op[0] ? "op" : p.x <= g.pv[1] ? "sp" : null;
    if (!field || EDITABLE_IN[field] !== this.get("loop_mode")) return null;
    const [a, b] = (field === "sp" ? [this.num("pv_min"), this.num("pv_max")] : [this.num("op_min"), this.num("op_max")]) as [number, number];
    return { field, value: fromFraction(linearHit(p.y, g.y0, g.y1), a, b) };
  }

  startDrag(e: PointerEvent): void {
    if (!this.interactive || this.get("mode") !== "control" || e.button !== 0) return;
    const first = this.dragTarget(e);
    if (!first) return;
    e.preventDefault();
    this.svgEl.setPointerCapture?.(e.pointerId);
    const move = (ev: PointerEvent): void => {
      const t = this.dragTarget(ev);
      if (t && t.field === first.field) this.preview = t;
      this.drawBars();
    };
    const up = (ev: PointerEvent): void => {
      this.svgEl.removeEventListener("pointermove", move);
      this.svgEl.removeEventListener("pointerup", up);
      this.svgEl.removeEventListener("pointercancel", up);
      const t = ev.type === "pointerup" ? this.preview : null;
      this.preview = null;
      this.drawBars();
      if (t) this.enter(t.field, Number(t.value.toPrecision(12)));
    };
    this.preview = first;
    this.drawBars();
    this.svgEl.addEventListener("pointermove", move);
    this.svgEl.addEventListener("pointerup", up);
    this.svgEl.addEventListener("pointercancel", up);
  }

  setMode(m: string): void {
    if (!this.interactive || m === this.get("loop_mode")) return;
    this.model.send({ type: "loop_mode", mode: m });
    const r = loopModeChange(this.state, m);
    if (r.ok) this.applyLocally(r.changes);
    else if (this.contract && !hostOwnsState(this.model as unknown as AnyModel)) this.showNote(`✖ ${r.reason}`);
  }

  override draw(): void {
    const fmt = this.get("format");
    const unit = this.get("unit");
    const mode = this.get("loop_mode");
    const control = this.get("mode") === "control";
    this.tagEl.textContent = this.get("tag") || this.get("label") || "PID";

    // mode buttons: text and pressed state (not color only)
    clear(this.modeBar);
    for (const m of this.get("modes") || []) {
      const btn = html("button", { cls: "awi-pid-mode", text: m, attrs: { type: "button", "aria-pressed": String(m === mode) } });
      btn.disabled = !control || !!this.get("disabled");
      btn.addEventListener("click", () => this.setMode(m));
      this.modeBar.appendChild(btn);
    }
    if (!(this.get("modes") || []).includes(mode)) this.modeBar.appendChild(html("span", { cls: "awi-pid-mode", text: mode }));

    // values and editors
    const level = this.get("alarm_level") || "normal";
    for (const l of Object.keys(ALARM_TEXT)) this.root.classList.toggle(`awi-alarm-${l}`, level === l);
    const pvText = withUnit(formatValue(parseNumber(this.get("pv")), fmt), unit);
    this.rows.pv.val.textContent = ALARM_TEXT[level] ? `${pvText} ${ALARM_TEXT[level]}` : pvText;
    this.rows.sp.val.textContent = withUnit(formatValue(this.num("sp") as number, fmt), unit);
    this.rows.op.val.textContent = withUnit(formatValue(this.num("op") as number, fmt), this.get("op_unit"));
    for (const f of ["sp", "op"] as Field[]) {
      const r = this.rows[f];
      const editable = control && EDITABLE_IN[f] === mode;
      r.input.hidden = !editable;
      r.set.hidden = !editable;
      r.input.disabled = !!this.get("disabled");
      r.set.disabled = !!this.get("disabled");
      const [min, max] = f === "sp" ? this.spLimits() : [this.num("op_min") as number, this.num("op_max") as number];
      r.input.min = String(min);
      r.input.max = String(max);
      r.input.step = "any";
      if (document.activeElement !== r.input && !r.input.value) r.input.placeholder = formatValue(this.num(f) as number, fmt);
    }
    this.root.classList.toggle("awi-pid-man", mode === "MAN");
    this.drawBars();
    this.body.setAttribute("aria-label", `${this.tagEl.textContent}: PV ${this.rows.pv.val.textContent}, SP ${this.rows.sp.val.textContent}, OP ${this.rows.op.val.textContent}, mode ${mode}`);
  }

  drawBars(): void {
    const [w] = this.get("size");
    const h = 116;
    const s = this.svgEl;
    s.setAttribute("viewBox", `0 0 ${w} ${h}`);
    s.style.height = `${h}px`;
    clear(s);
    const [pmin, pmax] = [this.num("pv_min") as number, this.num("pv_max") as number];
    const [omin, omax] = [this.num("op_min") as number, this.num("op_max") as number];
    const y0 = h - 14;
    const y1 = 8;
    const yOf = (v: number, a: number, b: number): number => y0 - Math.min(1, Math.max(0, toFraction(v, a, b))) * (y0 - y1);
    // PV / SP column
    const pvX = 44;
    const barW = 26;
    s.appendChild(svg("rect", { class: "awi-ai-track", x: pvX, y: y1, width: barW, height: y0 - y1 }));
    const pv = parseNumber(this.get("pv"));
    if (Number.isFinite(pv)) {
      const y = yOf(pv, pmin, pmax);
      s.appendChild(svg("rect", { class: "awi-pid-pv-bar", x: pvX, y, width: barW, height: y0 - y }));
    }
    for (const k of ["lolo", "lo", "hi", "hihi"]) {
      const v = this.num(k);
      if (v !== null) s.appendChild(svg("path", { class: `awi-ai-limit awi-ai-limit-${k}`, d: `M${pvX - 4} ${yOf(v, pmin, pmax)}H${pvX + barW + 4}` }));
    }
    const spShown = (this.preview?.field === "sp" ? this.preview.value : this.num("sp")) as number;
    const sy = yOf(spShown, pmin, pmax);
    s.appendChild(svg("path", { class: "awi-pid-sp-mark", d: `M${pvX + barW + 2} ${sy}L${pvX + barW + 12} ${sy - 6}L${pvX + barW + 12} ${sy + 6}Z` }));
    s.appendChild(svgText("SP", { class: "awi-tick-label", x: pvX + barW + 14, y: sy, "dominant-baseline": "central" }));
    const tk = ticks(pmin, pmax, 4, 0);
    const tf = tickFormat(this.get("format"));
    for (const v of tk.major) {
      const y = yOf(v, pmin, pmax);
      s.appendChild(svgText(formatValue(v, tf), { class: "awi-tick-label", x: pvX - 6, y, "text-anchor": "end", "dominant-baseline": "central" }));
    }
    s.appendChild(svgText("PV", { class: "awi-tick-label", x: pvX + barW / 2, y: h - 2, "text-anchor": "middle" }));
    // OP column
    const opX = w - 50;
    this.barGeom = { pv: [0, pvX + barW + 30], op: [opX - 8, w], y0, y1 };
    const loop = this.get("loop_mode");
    const drag = this.get("mode") === "control" && this.interactive;
    s.classList.toggle("awi-pid-drag-sp", drag && loop === "AUTO");
    s.classList.toggle("awi-pid-drag-op", drag && loop === "MAN");
    s.appendChild(svg("rect", { class: "awi-ai-track", x: opX, y: y1, width: 18, height: y0 - y1 }));
    const opShown = (this.preview?.field === "op" ? this.preview.value : this.num("op")) as number;
    const oy = yOf(opShown, omin, omax);
    s.appendChild(svg("rect", { class: "awi-pid-op-bar", x: opX, y: oy, width: 18, height: y0 - oy }));
    s.appendChild(svgText(formatValue(omax, tf), { class: "awi-tick-label", x: opX + 22, y: y1, "dominant-baseline": "central" }));
    s.appendChild(svgText(formatValue(omin, tf), { class: "awi-tick-label", x: opX + 22, y: y0, "dominant-baseline": "central" }));
    s.appendChild(svgText("OP", { class: "awi-tick-label", x: opX + 9, y: h - 2, "text-anchor": "middle" }));
  }
}
