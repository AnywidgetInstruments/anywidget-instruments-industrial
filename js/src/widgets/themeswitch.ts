// Light / system / dark theme switch (STYLE-007, STYLE-008).
import { html } from "anywidget-instruments/js/src/core/dom.js";
import type { AnyModel } from "anywidget-instruments/js/src/core/model.js";
import { applyPageTheme } from "anywidget-instruments/js/src/core/pagetheme.js";
import { BaseView } from "anywidget-instruments/js/src/core/view.js";
import type { ThemeSwitchTraits } from "../generated/contract.js";

type Theme = ThemeSwitchTraits["value"];

export const THEME_POSITIONS: Array<[Theme, string]> = [
  ["light", "☀ Light"],
  ["system", "◐ System"],
  ["dark", "☾ Dark"],
];

export class ThemeSwitchView extends BaseView<ThemeSwitchTraits> {
  readonly buttons: HTMLButtonElement[];

  constructor(model: AnyModel<ThemeSwitchTraits>, el: HTMLElement) {
    super(model, el, ["value", "page_theme"]);
    const b = this.body;
    b.setAttribute("role", "radiogroup");
    b.setAttribute("aria-labelledby", this.labelEl.id);
    b.removeAttribute("data-lm-suppress-shortcuts"); // the buttons carry it
    this.buttons = THEME_POSITIONS.map(([value, text]) => {
      const btn = html("button", { cls: "awi-theme-opt", text, attrs: { type: "button", role: "radio", "data-value": value } });
      btn.addEventListener("click", () => this.choose(value));
      return btn;
    });
    b.append(...this.buttons);
    b.addEventListener("keydown", (e) => {
      const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[e.key];
      if (!step) return;
      e.preventDefault();
      const k = Math.max(0, THEME_POSITIONS.findIndex(([v]) => v === this.get("value")));
      const next = Math.min(THEME_POSITIONS.length - 1, Math.max(0, k + step));
      this.choose(THEME_POSITIONS[next][0]);
      this.buttons[next].focus();
    });
    // the page follows the switch; at load an "auto" switch leaves the host alone
    this.listen("change:value", () => this.applyPage());
    if (this.get("value") !== "auto") this.applyPage();
    this.schedule();
  }

  applyPage(): void {
    if (this.get("page_theme") && this.get("value") !== "auto") applyPageTheme(this.el.ownerDocument, this.get("value"));
  }

  choose(value: Theme): void {
    if (!this.interactive || value === this.get("value")) return;
    this.sendValue(value, true);
    this.applyPage();
    this.schedule();
  }

  override draw(): void {
    const value = this.get("value");
    const on = this.interactive;
    this.buttons.forEach((btn, k) => {
      const checked = THEME_POSITIONS[k][0] === value;
      btn.setAttribute("aria-checked", String(checked));
      btn.classList.toggle("awi-on", checked);
      // roving focus: one tab stop, on the checked position (or the first)
      btn.tabIndex = checked || (k === 0 && !THEME_POSITIONS.some(([v]) => v === value)) ? 0 : -1;
      btn.disabled = !on;
    });
  }
}
