// NumericEntry: numeric keypad for touch panels (IND-104).
import { html } from "../core/dom.js";
import { checkEntry } from "../core/entry.js";
import { formatValue, withUnit } from "../core/format.js";
import { parseNumber } from "../core/scale.js";
import { BaseView } from "../core/view.js";

const TRAITS = ["value", "min", "max", "unit", "format", "confirm_delta", "coerce"];

/** Keys: [text, action, accessible name]; four per row. */
export const KEYS = [
  ["7", "7", "7"], ["8", "8", "8"], ["9", "9", "9"], ["⌫", "back", "Backspace"],
  ["4", "4", "4"], ["5", "5", "5"], ["6", "6", "6"], ["C", "clear", "Clear the entry"],
  ["1", "1", "1"], ["2", "2", "2"], ["3", "3", "3"], ["±", "sign", "Change the sign"],
  ["0", "0", "0"], [".", ".", "Decimal point"], ["Esc", "cancel", "Cancel"], ["↵", "enter", "Enter"],
];

/** Draft text after pressing `key` (digits, ".", "back", "clear", "sign"). */
export function editDraft(draft, key) {
  const d = draft ?? "";
  if (/^\d$/.test(key)) return d === "0" ? key : d === "-0" ? `-${key}` : d + key;
  if (key === ".") return d.includes(".") ? d : `${d === "" || d === "-" ? `${d}0` : d}.`;
  if (key === "back") return d.slice(0, -1);
  if (key === "clear") return "";
  if (key === "sign") return d.startsWith("-") ? d.slice(1) : `-${d}`;
  return d;
}

export class KeypadView extends BaseView {
  constructor(model, el) {
    super(model, el, TRAITS);
    this.draft = null; // text being typed; null while showing the value
    this.armed = null; // value waiting for confirmation (confirm_delta)
    const b = this.body;
    b.setAttribute("role", "group");
    b.setAttribute("aria-labelledby", this.labelEl.id);
    b.tabIndex = 0;
    this.display = html("div", { cls: "awi-kp-display", attrs: { role: "status", "aria-live": "polite" } });
    this.msg = html("div", { cls: "awi-entry-msg awi-kp-msg", attrs: { role: "alert" } });
    this.keys = KEYS.map(([text, action, name]) => {
      const key = html("button", { cls: `awi-kp-key awi-kp-${/^\d$/.test(action) ? "digit" : action}`, text, attrs: { type: "button", "aria-label": name } });
      key.addEventListener("click", () => this.press(action));
      return key;
    });
    b.append(this.display, this.msg, html("div", { cls: "awi-kp-grid" }, this.keys));
    b.addEventListener("keydown", (e) => {
      const map = { Enter: "enter", Escape: "cancel", Backspace: "back", Delete: "clear", ",": ".", ".": ".", "-": "sign" };
      const action = /^\d$/.test(e.key) ? e.key : map[e.key];
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      this.press(action);
    });
    this.schedule();
  }

  press(action) {
    if (!this.interactive) return;
    if (action === "cancel") {
      this.draft = null;
      this.armed = null;
      this.msg.textContent = "";
    } else if (action === "enter") {
      this.commit();
    } else {
      this.draft = editDraft(this.draft, action);
      this.armed = null;
      this.msg.textContent = "";
    }
    this.schedule();
  }

  commit() {
    if (this.draft === null || this.draft === "" || this.draft === "-") return;
    const r = checkEntry(this.draft, {
      min: parseNumber(this.get("min")),
      max: parseNumber(this.get("max")),
      unit: this.get("unit") || "",
      coerce: !!this.get("coerce"),
      format: this.get("format"),
    });
    if (!r.ok) {
      this.msg.textContent = r.reason;
      return;
    }
    const delta = this.get("confirm_delta");
    const current = parseNumber(this.get("value"));
    if (delta !== null && delta !== undefined && Number.isFinite(current) && Math.abs(r.value - current) > delta && this.armed !== r.value) {
      // IND-104: a large change needs a second Enter
      this.armed = r.value;
      this.msg.textContent = `Large change: press Enter again to set ${withUnit(formatValue(r.value, this.get("format")), this.get("unit"))}`;
      return;
    }
    this.model.set("value", r.value);
    this.model.save_changes();
    this.draft = null;
    this.armed = null;
    this.msg.textContent = "";
  }

  draw() {
    const unit = this.get("unit") || "";
    const editing = this.draft !== null;
    const text = editing ? `${this.draft || "…"}${unit ? ` ${unit}` : ""}` : withUnit(formatValue(parseNumber(this.get("value")), this.get("format")), unit);
    this.display.textContent = text;
    this.display.classList.toggle("awi-kp-editing", editing);
    this.root.classList.toggle("awi-kp-armed", this.armed !== null);
    const on = this.interactive;
    for (const k of this.keys) k.disabled = !on;
    const range = `${formatValue(parseNumber(this.get("min")), this.get("format"))} to ${formatValue(parseNumber(this.get("max")), this.get("format"))}`;
    this.body.setAttribute("aria-description", `value ${withUnit(formatValue(parseNumber(this.get("value")), this.get("format")), unit)}, range ${range}${editing ? `, typing ${this.draft}` : ""}`);
  }
}
