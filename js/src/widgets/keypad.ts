// NumericEntry: numeric keypad for touch panels (IND-104).
import { html, setText } from "../core/dom.js";
import { checkEntry } from "../core/entry.js";
import { formatValue, radixOf, withUnit } from "../core/format.js";
import type { AnyModel } from "../core/model.js";
import { parseNumber } from "../core/scale.js";
import { BaseView } from "../core/view.js";
import type { NumericEntryTraits } from "../generated/contract.js";

const TRAITS = ["value", "min", "max", "unit", "format", "confirm_delta", "coerce"];

/** Keys: [text, action, accessible name]; four per row. */
export const KEYS: Array<[string, string, string]> = [
  ["7", "7", "7"], ["8", "8", "8"], ["9", "9", "9"], ["⌫", "back", "Backspace"],
  ["4", "4", "4"], ["5", "5", "5"], ["6", "6", "6"], ["C", "clear", "Clear the entry"],
  ["1", "1", "1"], ["2", "2", "2"], ["3", "3", "3"], ["±", "sign", "Change the sign"],
  ["0", "0", "0"], [".", ".", "Decimal point"], ["Esc", "cancel", "Cancel"], ["↵", "enter", "Enter"],
  // hexadecimal digits, shown only for a hexadecimal format (IND-110)
  ["A", "A", "A"], ["B", "B", "B"], ["C", "hexC", "C"], ["D", "D", "D"], ["E", "E", "E"], ["F", "F", "F"],
];

const DIGIT = /^[0-9A-F]$/;

/** Value of a digit key, or -1 (the C digit is "hexC": the label C is the clear key). */
function digitOf(action: string): number {
  if (action === "hexC") return 12;
  return DIGIT.test(action) ? parseInt(action, 16) : -1;
}

/** True when `action` can be used with values in base `radix`. */
export function keyAllowed(action: string, radix: number): boolean {
  const digit = digitOf(action);
  if (digit >= 0) return digit < radix;
  return action !== "." || radix === 10;
}

/** Draft text after pressing `key` (digits, "A".."F", ".", "back", "clear", "sign"). */
export function editDraft(draft: string | null | undefined, key: string): string {
  const d = draft ?? "";
  if (key === "hexC") key = "C";
  if (DIGIT.test(key)) return d === "0" ? key : d === "-0" ? `-${key}` : d + key;
  if (key === ".") return d.includes(".") ? d : `${d === "" || d === "-" ? `${d}0` : d}.`;
  if (key === "back") return d.slice(0, -1);
  if (key === "clear") return "";
  if (key === "sign") return d.startsWith("-") ? d.slice(1) : `-${d}`;
  return d;
}

export class KeypadView extends BaseView<NumericEntryTraits> {
  /** Text being typed; null while showing the value. */
  draft: string | null;
  /** Value waiting for confirmation (confirm_delta). */
  armed: number | null;
  readonly display: HTMLDivElement;
  readonly msg: HTMLDivElement;
  readonly keys: HTMLButtonElement[];

  constructor(model: AnyModel<NumericEntryTraits>, el: HTMLElement) {
    super(model, el, TRAITS);
    this.draft = null;
    this.armed = null;
    const b = this.body;
    b.setAttribute("role", "group");
    b.setAttribute("aria-labelledby", this.labelEl.id);
    b.tabIndex = 0;
    this.display = html("div", { cls: "awi-kp-display", attrs: { role: "status", "aria-live": "polite" } });
    this.msg = html("div", { cls: "awi-entry-msg awi-kp-msg", attrs: { role: "alert" } });
    this.keys = KEYS.map(([text, action, name]) => {
      const kind = /^\d$/.test(action) ? "digit" : digitOf(action) >= 0 ? "digit awi-kp-hex" : action;
      const key = html("button", { cls: `awi-kp-key awi-kp-${kind}`, text, attrs: { type: "button", "aria-label": name } });
      key.addEventListener("click", () => this.press(action));
      return key;
    });
    b.append(this.display, this.msg, html("div", { cls: "awi-kp-grid" }, this.keys));
    b.addEventListener("keydown", (e) => {
      const map: Record<string, string> = { Enter: "enter", Escape: "cancel", Backspace: "back", Delete: "clear", ",": ".", ".": ".", "-": "sign" };
      const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      const hex = radixOf(this.get("format")) === 16;
      const action = /^\d$/.test(k) || (hex && /^[A-F]$/.test(k)) ? (k === "C" ? "hexC" : k) : map[e.key];
      if (!action || !keyAllowed(action, radixOf(this.get("format")))) return;
      e.preventDefault();
      e.stopPropagation();
      this.press(action);
    });
    this.schedule();
  }

  press(action: string): void {
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

  commit(): void {
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

  override draw(): void {
    const unit = this.get("unit") || "";
    const editing = this.draft !== null;
    const text = editing ? `${this.draft || "…"}${unit ? ` ${unit}` : ""}` : withUnit(formatValue(parseNumber(this.get("value")), this.get("format")), unit);
    this.display.textContent = text;
    this.display.classList.toggle("awi-kp-editing", editing);
    this.root.classList.toggle("awi-kp-armed", this.armed !== null);
    const on = this.interactive;
    const radix = radixOf(this.get("format"));
    this.keys.forEach((k, i) => {
      const action = KEYS[i][1];
      k.disabled = !on || !keyAllowed(action, radix);
      k.hidden = digitOf(action) >= 10 && radix !== 16;
      // the C digit and the clear key must not look alike in hexadecimal
      if (action === "clear") setText(k, radix === 16 ? "Clr" : KEYS[i][0]);
    });
    const range = `${formatValue(parseNumber(this.get("min")), this.get("format"))} to ${formatValue(parseNumber(this.get("max")), this.get("format"))}`;
    this.body.setAttribute("aria-description", `value ${withUnit(formatValue(parseNumber(this.get("value")), this.get("format")), unit)}, range ${range}${editing ? `, typing ${this.draft}` : ""}`);
  }
}
