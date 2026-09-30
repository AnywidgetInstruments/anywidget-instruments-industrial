// Transmitter: instrument bubble, value and device status (IND-080..083).
import { clear, html, svg, svgText } from "anywidget-instruments/js/src/core/dom.js";
import type { AnyModel } from "anywidget-instruments/js/src/core/model.js";
import type { TransmitterTraits } from "../generated/contract.js";
import { NumericView } from "./numeric.js";

type Status = TransmitterTraits["status"];

/** Device status: symbol (shape, not only color) and text (IND-081). */
export const DEVICE_STATUS: Record<Status, { symbol: string; text: string }> = {
  ok: { symbol: "", text: "OK" },
  failure: { symbol: "✕", text: "FAILURE" },
  check: { symbol: "▲", text: "FUNCTION CHECK" },
  out_of_spec: { symbol: "?", text: "OUT OF SPEC" },
  maintenance: { symbol: "◆", text: "MAINTENANCE" },
};

/** "LT-101" → ["LT", "101"]; "PT101A" → ["PT", "101A"]. */
export function splitTag(tag: unknown): [string, string] {
  const s = String(tag ?? "").trim();
  const dash = s.indexOf("-");
  if (dash > 0) return [s.slice(0, dash), s.slice(dash + 1)];
  const m = /^([A-Za-z]+)(.*)$/.exec(s);
  return m ? [m[1], m[2]] : [s, ""];
}

export class TransmitterView extends NumericView<TransmitterTraits> {
  readonly svgEl: SVGElement;
  readonly statusEl: HTMLDivElement;

  constructor(model: AnyModel<TransmitterTraits>, el: HTMLElement) {
    super(model, el, ["tag", "status", "status_text"], { role: "meter" });
    this.svgEl = svg("svg", { class: "awi-svg", "aria-hidden": "true" });
    this.body.appendChild(this.svgEl);
    this.statusEl = html("div", { cls: "awi-tx-status" });
    this.root.insertBefore(this.statusEl, this.entryMsg);
    this.schedule();
  }

  /** Device status (read through the schema: unknown values read as "ok"). */
  get status(): Status {
    const s = this.get("status");
    return DEVICE_STATUS[s] ? s : "ok";
  }

  override renderCommon(): void {
    super.renderCommon();
    const st = this.status;
    const info = DEVICE_STATUS[st];
    const r = this.root;
    for (const k of Object.keys(DEVICE_STATUS)) r.classList.toggle(`awi-ne107-${k}`, st === k);
    const detail = this.get("status_text") || "";
    this.statusEl.textContent = `${info.symbol ? `${info.symbol} ` : ""}${info.text}${detail ? ` · ${detail}` : ""}`;
    this.statusEl.setAttribute("title", detail || info.text);
    const b = this.body;
    const tag = this.get("tag") || "";
    if (st === "failure") {
      // IND-082: the value is not a normal reading any more
      this.valueText.textContent = "✕ BAD";
      b.removeAttribute("aria-valuenow");
      b.setAttribute("aria-valuetext", `invalid value, device failure${detail ? `: ${detail}` : ""}`);
    } else {
      const text = b.getAttribute("aria-valuetext") || "";
      if (st !== "ok") b.setAttribute("aria-valuetext", `${text}, ${info.text.toLowerCase()}${detail ? `: ${detail}` : ""}`);
    }
    if (tag && !this.get("label")) b.setAttribute("aria-label", tag);
  }

  override draw(): void {
    const [w, h] = this.get("size");
    const s = this.svgEl;
    s.setAttribute("viewBox", `0 0 ${w} ${h}`);
    clear(s);
    const r = Math.min(h / 2 - 4, 34);
    const cx = w / 2;
    const cy = h / 2;
    // ISA-5.1 style bubble: function letters above the line, loop number below
    s.appendChild(svg("circle", { class: "awi-tx-bubble", cx, cy, r }));
    s.appendChild(svg("path", { class: "awi-tx-line", d: `M${cx - r} ${cy}H${cx + r}` }));
    const [letters, loop] = splitTag(this.get("tag"));
    s.appendChild(svgText(letters, { class: "awi-tx-letters", x: cx, y: cy - r * 0.32, "text-anchor": "middle", "dominant-baseline": "central" }));
    s.appendChild(svgText(loop, { class: "awi-tx-loop", x: cx, y: cy + r * 0.36, "text-anchor": "middle", "dominant-baseline": "central" }));
    // device status symbol: a distinct shape per category (IND-081)
    const st = this.status;
    const x = cx + r * 0.75;
    const y = cy - r * 0.75;
    const k = Math.max(7, r * 0.3);
    const shape = ({
      failure: () => svg("circle", { cx: x, cy: y, r: k }),
      check: () => svg("path", { d: `M${x} ${y - k}L${x + k} ${y + k * 0.8}L${x - k} ${y + k * 0.8}Z` }),
      out_of_spec: () => svg("path", { d: `M${x} ${y - k}L${x + k} ${y}L${x} ${y + k}L${x - k} ${y}Z` }),
      maintenance: () => svg("rect", { x: x - k * 0.85, y: y - k * 0.85, width: k * 1.7, height: k * 1.7, rx: 2 }),
    } as Record<string, () => SVGElement>)[st];
    if (shape) {
      const g = svg("g", { class: `awi-ne107-symbol awi-ne107-symbol-${st}` });
      g.appendChild(shape());
      g.appendChild(svgText(DEVICE_STATUS[st].symbol, { class: "awi-ne107-glyph", x, y: st === "check" ? y + k * 0.25 : y, "text-anchor": "middle", "dominant-baseline": "central" }));
      s.appendChild(g);
    }
  }
}
