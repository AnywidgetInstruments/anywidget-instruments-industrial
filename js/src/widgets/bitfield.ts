// BitField: an integer word as a row of indicators, one per bit (IND-111, IND-112).
import { activeBits, bitOf, toggleBit, wordOf } from "../contract/bitfield.js";
import { clear, html, safeColor, setAttr, setText } from "../core/dom.js";
import { formatValue } from "../core/format.js";
import type { AnyModel } from "../core/model.js";
import { BaseView } from "../core/view.js";
import type { BitFieldTraits } from "../generated/contract.js";

const TRAITS = ["value", "bits", "labels", "colors", "on_color", "msb_first", "show_hex"];

/** Hexadecimal text of a word, all its digits shown ("0x0013" for 16 bits). */
export function wordHex(value: number, bits: number): string {
  return `0x${formatValue(wordOf(value, bits), `%0${bits / 4}X`)}`;
}

export class BitFieldView extends BaseView<BitFieldTraits> {
  readonly row: HTMLDivElement;
  readonly hex: HTMLSpanElement;
  cells: HTMLButtonElement[] = [];

  constructor(model: AnyModel<BitFieldTraits>, el: HTMLElement) {
    super(model, el, TRAITS);
    this.body.setAttribute("role", "group");
    this.row = html("div", { cls: "awi-bf-row" });
    this.hex = html("span", { cls: "awi-bf-hex" });
    this.body.append(this.row, this.hex);
    this.schedule();
  }

  /** Bit numbers in drawing order. */
  order(bits: number): number[] {
    const n = Array.from({ length: bits }, (_, k) => k);
    return this.get("msb_first") ? n.reverse() : n;
  }

  /** IND-112: a click on a bit toggles it (control mode). */
  toggle(bit: number): void {
    if (!this.interactive) return;
    this.model.set("value", toggleBit(this.get("value"), bit, this.get("bits")));
    this.model.save_changes();
  }

  override draw(): void {
    const bits = this.get("bits");
    const value = wordOf(this.get("value"), bits);
    const labels = this.get("labels");
    const colors = this.get("colors");
    const onColor = safeColor(this.get("on_color")) || "var(--awi-led-on)";
    const order = this.order(bits);
    if (this.cells.length !== bits || this.cells[0]?.dataset.bit !== String(order[0])) {
      clear(this.row);
      this.cells = order.map((bit) => {
        const cell = html("button", { cls: "awi-bf-bit", attrs: { type: "button", "data-bit": String(bit) } }, [
          html("span", { cls: "awi-bf-lamp", attrs: { "aria-hidden": "true" } }),
          html("span", { cls: "awi-bf-num", text: String(bit), attrs: { "aria-hidden": "true" } }),
          html("span", { cls: "awi-bf-label", attrs: { "aria-hidden": "true" } }),
        ]);
        cell.addEventListener("click", () => this.toggle(bit));
        // a gap after every 4 bits (a hexadecimal digit), as the word is read
        if (bit % 4 === (this.get("msb_first") ? 0 : 3) && bit !== order[order.length - 1]) cell.classList.add("awi-bf-nibble");
        this.row.appendChild(cell);
        return cell;
      });
    }
    const interactive = this.interactive;
    this.cells.forEach((cell) => {
      const bit = Number(cell.dataset.bit);
      const set = bitOf(value, bit);
      const label = labels[bit] || "";
      const name = label || `bit ${bit}`;
      cell.classList.toggle("awi-bf-on", set);
      cell.classList.toggle("awi-bf-unused", !label);
      cell.style.setProperty("--awi-bf-on", safeColor(colors[bit]) || onColor);
      // state as text as well as color (A11Y-003): 1 / 0 in the lamp
      setText(cell.children[0], set ? "1" : "0");
      setText(cell.children[2], label);
      setAttr(cell, "title", `bit ${bit}${label ? `: ${label}` : ""}`);
      setAttr(cell, "aria-label", `${name}, bit ${bit}`);
      setAttr(cell, "aria-pressed", String(set));
      if (cell.disabled !== !interactive) cell.disabled = !interactive;
    });
    this.hex.hidden = !this.get("show_hex");
    setText(this.hex, wordHex(value, bits));
    const on = activeBits(value, bits).map((bit) => (labels[bit] ? `${bit} ${labels[bit]}` : String(bit)));
    setAttr(this.body, "aria-label", `${this.get("label") || "Bit field"}: ${wordHex(value, bits)}, ${on.length ? `set: ${on.join(", ")}` : "no bit set"}`);
  }
}
