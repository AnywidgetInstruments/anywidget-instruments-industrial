// Annunciator panel (IND-040..043): alarm windows following an ISA-18.1
// sequence, first-out mark, horn indicator and operator push buttons.
import type { AnnWindow } from "../contract/annunciator.js";
import { annunciatorAction, hostOwnsState } from "../contract/derived.js";
import { clear, html } from "../core/dom.js";
import type { AnyModel } from "../core/model.js";
import { BaseView } from "../core/view.js";
import type { AnnunciatorTraits } from "../generated/contract.js";

// State conveyed by text as well as by light and flash pattern (A11Y-003).
const STATE_TEXT: Record<string, string> = { normal: "", alert: "ALARM", acknowledged: "ACK", ringback: "RINGBACK" };

export class AnnunciatorView extends BaseView<AnnunciatorTraits> {
  readonly grid: HTMLDivElement;
  readonly bar: HTMLDivElement;
  readonly hornEl: HTMLSpanElement;
  readonly buttons: Record<string, HTMLButtonElement>;

  constructor(model: AnyModel<AnnunciatorTraits>, el: HTMLElement) {
    super(model, el, ["value", "columns", "sequence", "first_out", "horn", "test"]);
    const b = this.body;
    b.setAttribute("role", "group");
    this.grid = html("div", { cls: "awi-ann-grid" });
    this.bar = html("div", { cls: "awi-ann-bar" });
    this.hornEl = html("span", { cls: "awi-ann-horn", attrs: { role: "status" } });
    this.buttons = {};
    for (const [key, text] of [["silence", "SILENCE"], ["acknowledge", "ACK"], ["reset", "RESET"], ["test", "TEST"]]) {
      const btn = html("button", { cls: `awi-ann-btn awi-ann-${key}`, text, attrs: { type: "button" } });
      if (key === "test") {
        // lamp test while the button is held (pointer or keyboard)
        const on = (e: Event): void => {
          e.preventDefault();
          this.lampTest(true);
        };
        const off = (): void => this.lampTest(false);
        btn.addEventListener("pointerdown", on);
        btn.addEventListener("pointerup", off);
        btn.addEventListener("pointerleave", () => this.get("test") && off());
        btn.addEventListener("keydown", (e) => (e.key === " " || e.key === "Enter") && !e.repeat && on(e));
        btn.addEventListener("keyup", (e) => (e.key === " " || e.key === "Enter") && off());
      } else {
        btn.addEventListener("click", () => this.action(key as "acknowledge" | "reset" | "silence"));
      }
      this.buttons[key] = btn;
    }
    this.bar.append(this.hornEl, ...Object.values(this.buttons));
    b.append(this.grid, this.bar);
    this.schedule();
  }

  /**
   * Operator push button (IND-043): always sent to the host; applied by the
   * front end when no host owns the state (HOST-004).
   */
  action(key: "acknowledge" | "reset" | "silence"): void {
    if (!this.interactive) return;
    this.model.send({ type: key });
    annunciatorAction(this.model as unknown as AnyModel, key);
  }

  lampTest(on: boolean): void {
    if (!this.interactive) return;
    this.model.send({ type: "test", on });
    if (!hostOwnsState(this.model as unknown as AnyModel)) {
      this.model.set("test", on);
      this.model.save_changes();
    }
  }

  override draw(): void {
    const windows = (this.get("value") || []) as Partial<AnnWindow>[];
    const test = !!this.get("test");
    this.grid.style.gridTemplateColumns = `repeat(${Math.max(1, this.get("columns") || 4)}, 1fr)`;
    clear(this.grid);
    const summary: string[] = [];
    for (const w of windows) {
      const state = test ? "test" : w.state;
      const cell = html("div", { cls: `awi-ann-window awi-ann-${w.color || "amber"} awi-ann-st-${state}${w.first ? " awi-ann-first" : ""}` });
      cell.append(html("div", { cls: "awi-ann-tag", text: w.tag ?? "" }), html("div", { cls: "awi-ann-text", text: w.text || "" }));
      const status = test ? "TEST" : [w.first ? "1ST" : "", STATE_TEXT[w.state ?? "normal"] || ""].filter(Boolean).join(" · ");
      cell.appendChild(html("div", { cls: "awi-ann-status", text: status }));
      cell.setAttribute("role", "img");
      cell.setAttribute("aria-label", `${w.tag} ${w.text || ""}: ${status || "normal"}`);
      this.grid.appendChild(cell);
      if (w.state !== "normal") summary.push(`${w.tag} ${status}`);
    }
    const horn = !!this.get("horn");
    this.root.classList.toggle("awi-ann-sounding", horn);
    this.hornEl.textContent = horn ? "♪ HORN" : "";
    const control = this.get("mode") === "control";
    for (const btn of Object.values(this.buttons)) {
      btn.hidden = !control;
      btn.disabled = !!this.get("disabled");
    }
    // Reset only matters for sequences with a manual reset or a first-out mark
    this.buttons.reset.hidden = !control || (this.get("sequence") === "A" && !this.get("first_out"));
    this.body.setAttribute("aria-label", `${this.get("label") || "Annunciator"} (sequence ${this.get("sequence")}): ${summary.join(", ") || "all normal"}${horn ? ", horn sounding" : ""}`);
  }
}
