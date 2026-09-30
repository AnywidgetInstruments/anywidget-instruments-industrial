// AlarmIndicator (SCADA-005, SCADA-007, SCADA-008). Conventions: docs/alarm-conventions.md
import { hostOwnsState } from "../contract/derived.js";
import { applyTransition } from "../contract/transitions.js";
import { html, svg } from "anywidget-instruments/js/src/core/dom.js";
import type { AnyModel } from "anywidget-instruments/js/src/core/model.js";
import { BaseView } from "anywidget-instruments/js/src/core/view.js";
import type { AlarmIndicatorTraits } from "../generated/contract.js";

const STATE_TEXT: Record<string, string> = {
  normal: "NORMAL",
  active_unacknowledged: "ACTIVE · UNACK",
  active_acknowledged: "ACTIVE · ACK",
  cleared_unacknowledged: "CLEARED · UNACK",
};
const PRIORITY_TEXT: Record<string, string> = { low: "P4", medium: "P3", high: "P2", critical: "P1" };

// Redundant shape coding per priority (A11Y-003, ISA-101 practice).
function priorityShape(priority: string): SVGElement {
  switch (priority) {
    case "critical": return svg("path", { class: "awi-alarm-shape", d: "M12 1L23 12L12 23L1 12Z" }); // diamond
    case "high": return svg("path", { class: "awi-alarm-shape", d: "M12 1L23 22H1Z" }); // triangle
    case "medium": return svg("rect", { class: "awi-alarm-shape", x: 2, y: 2, width: 20, height: 20, rx: 2 }); // square
    default: return svg("circle", { class: "awi-alarm-shape", cx: 12, cy: 12, r: 10 }); // circle
  }
}

export class AlarmView extends BaseView<AlarmIndicatorTraits> {
  readonly icon: SVGElement;
  readonly text: HTMLDivElement;
  readonly stateEl: HTMLDivElement;
  readonly msgEl: HTMLDivElement;
  readonly ack: HTMLButtonElement;

  constructor(model: AnyModel<AlarmIndicatorTraits>, el: HTMLElement) {
    super(model, el, ["value", "priority", "message", "alarm_id"]);
    this.icon = svg("svg", { class: "awi-alarm-icon", viewBox: "0 0 24 24", "aria-hidden": "true" });
    this.text = html("div", { cls: "awi-alarm-text" });
    this.stateEl = html("div", { cls: "awi-alarm-state" });
    this.msgEl = html("div", { cls: "awi-alarm-msg" });
    this.text.append(this.stateEl, this.msgEl);
    this.ack = html("button", { cls: "awi-ack", text: "ACK", attrs: { type: "button" } });
    this.ack.addEventListener("click", () => this.acknowledge());
    this.body.append(this.icon, this.text, this.ack);
    this.body.setAttribute("role", "status");
    this.schedule();
  }

  /**
   * Operator acknowledgement (SCADA-007): always reported to the host; applied
   * by the front end itself when no host owns the state (HOST-004).
   */
  acknowledge(): void {
    if (!this.interactive) return;
    this.model.send({ type: "ack" });
    if (hostOwnsState(this.model as unknown as AnyModel)) return;
    const next = applyTransition(this.contract?.traits.value.transitions, this.get("value"), "acknowledge");
    if (next === this.get("value")) return;
    this.model.set("value", next as AlarmIndicatorTraits["value"]);
    this.model.save_changes();
  }

  override draw(): void {
    const state = this.get("value");
    const priority = this.get("priority");
    const r = this.root;
    for (const s of Object.keys(STATE_TEXT)) r.classList.toggle(`awi-state-${s}`, s === state);
    for (const p of Object.keys(PRIORITY_TEXT)) r.classList.toggle(`awi-prio-${p}`, p === priority);
    while (this.icon.firstChild) this.icon.removeChild(this.icon.firstChild);
    this.icon.appendChild(priorityShape(priority));
    this.stateEl.textContent = `${PRIORITY_TEXT[priority] || ""} ${STATE_TEXT[state] || state}`;
    const id = this.get("alarm_id");
    const msg = this.get("message");
    this.msgEl.textContent = id && msg ? `${id}: ${msg}` : id || msg;
    const unack = state === "active_unacknowledged" || state === "cleared_unacknowledged";
    this.ack.hidden = !(unack && this.get("mode") === "control");
    this.ack.disabled = !!this.get("disabled");
    this.body.setAttribute("aria-label", `${this.get("label") || "Alarm"} ${this.stateEl.textContent} ${this.msgEl.textContent}`.trim());
  }
}
