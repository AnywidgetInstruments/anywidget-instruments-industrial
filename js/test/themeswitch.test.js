// STYLE-007 / STYLE-008: theme switch, "system" theme and the page theme.
import { beforeEach, describe, expect, it } from "vitest";
import widget from "../src/index.js";
import { applyPageTheme, hostIsDark } from "../src/core/pagetheme.js";
import { common, fakeModel } from "./helpers.js";

const tick = () => new Promise((r) => setTimeout(r, 30));
const switchModel = (value, pageTheme = true) =>
  fakeModel({ ...common, label: "Theme", _kind: "themeswitch", value, page_theme: pageTheme, theme: "auto", size: [240, 30] });

beforeEach(() => {
  document.body.className = "light light-theme";
  document.body.dataset.theme = "light";
});

describe("page theme", () => {
  it("swaps the marimo body classes", () => {
    expect(applyPageTheme(document, "dark")).toBe(true);
    expect([...document.body.classList].sort()).toEqual(["dark", "dark-theme"]);
    expect(document.body.dataset.theme).toBe("dark");
    applyPageTheme(document, "light");
    expect([...document.body.classList].sort()).toEqual(["light", "light-theme"]);
  });

  it("leaves other hosts alone", () => {
    document.body.className = "jp-ThemedContainer";
    delete document.body.dataset.theme;
    expect(applyPageTheme(document, "dark")).toBe(false);
    expect(document.body.className).toBe("jp-ThemedContainer");
  });

  it("finds the host theme across shadow roots", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const inner = document.createElement("div");
    host.attachShadow({ mode: "open" }).appendChild(inner);
    expect(hostIsDark(inner)).toBe(false);
    document.body.className = "dark dark-theme";
    document.body.dataset.theme = "dark";
    expect(hostIsDark(inner)).toBe(true);
    host.remove();
  });
});

describe("theme switch", () => {
  it("offers three positions as a radio group and sets the page", async () => {
    const model = switchModel("auto");
    const el = document.createElement("div");
    widget.render({ model, el });
    await tick();
    const radios = [...el.querySelectorAll("[role=radio]")];
    expect(radios.map((b) => b.textContent)).toEqual(["☀ Light", "◐ System", "☾ Dark"]);
    expect(el.querySelector("[role=radiogroup]")).not.toBeNull();
    expect(radios.every((b) => b.getAttribute("aria-checked") === "false")).toBe(true);
    expect(document.body.classList.contains("light-theme")).toBe(true); // untouched at load
    radios[2].click();
    expect(model.get("value")).toBe("dark");
    expect(model.sent.length).toBe(1);
    expect(document.body.classList.contains("dark-theme")).toBe(true);
    await tick();
    expect(radios[2].getAttribute("aria-checked")).toBe("true");
    expect(radios[2].tabIndex).toBe(0);
    expect(radios[0].tabIndex).toBe(-1);
    // keyboard: arrows move between positions
    el.querySelector(".awi-body").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(model.get("value")).toBe("system");
  });

  it("a kernel change moves the page too, unless page_theme is off", () => {
    const model = switchModel("auto");
    widget.render({ model, el: document.createElement("div") });
    model.set("value", "dark");
    model.emit("change:value");
    expect(document.body.classList.contains("dark-theme")).toBe(true);
    const other = switchModel("auto", false);
    widget.render({ model: other, el: document.createElement("div") });
    other.set("value", "light");
    other.emit("change:value");
    expect(document.body.classList.contains("dark-theme")).toBe(true);
  });

  it("the system theme resolves to the host theme", async () => {
    document.body.className = "dark dark-theme";
    const model = fakeModel({ ...common, _kind: "gauge", value: 1, min: 0, max: 10, theme: "system", unit: "", format: "%.1f" });
    const el = document.createElement("div");
    document.body.appendChild(el);
    widget.render({ model, el });
    await tick();
    expect(el.querySelector(".awi-root").classList.contains("awi-theme-dark")).toBe(true);
    el.remove();
  });
});
