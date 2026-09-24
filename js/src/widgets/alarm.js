// AlarmIndicator (SCADA-005, SCADA-007, SCADA-008). Conventions: docs/alarm-conventions.md
import { html, svg } from "../core/dom.js";
import { BaseView } from "../core/view.js";

const STATE_TEXT = {
  normal: "NORMAL",
  active_unacknowledged: "ACTIVE · UNACK",
  active_acknowledged: "ACTIVE · ACK",
  cleared_unacknowledged: "CLEARED · UNACK",
};
const PRIORITY_TEXT = { low: "P4", medium: "P3", high: "P2", critical: "P1" };

// Redundant shape coding per priority (A11Y-003, ISA-101 practice).
function priorityShape(priority) {
  switch (priority) {
    case "critical": return svg("path", { class: "awi-alarm-shape", d: "M12 1L23 12L12 23L1 12Z" }); // diamond
    case "high": return svg("path", { class: "awi-alarm-shape", d: "M12 1L23 22H1Z" }); // triangle
    case "medium": return svg("rect", { class: "awi-alarm-shape", x: 2, y: 2, width: 20, height: 20, rx: 2 }); // square
    default: return svg("circle", { class: "awi-alarm-shape", cx: 12, cy: 12, r: 10 }); // circle
  }
}

export class AlarmView extends BaseView {
  constructor(model, el) {
    super(model, el, ["value", "priority", "message", "alarm_id"]);
    this.icon = svg("svg", { class: "awi-alarm-icon", viewBox: "0 0 24 24", "aria-hidden": "true" });
    this.iconText = null;
    this.text = html("div", { cls: "awi-alarm-text" });
    this.stateEl = html("div", { cls: "awi-alarm-state" });
    this.msgEl = html("div", { cls: "awi-alarm-msg" });
    this.text.append(this.stateEl, this.msgEl);
    this.ack = html("button", { cls: "awi-ack", text: "ACK", attrs: { type: "button" } });
    this.ack.addEventListener("click", () => {
      if (this.interactive) this.model.send({ type: "ack" });
    });
    this.body.append(this.icon, this.text, this.ack);
    this.body.setAttribute("role", "status");
    this.schedule();
  }

  draw() {
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
