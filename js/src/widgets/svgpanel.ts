// SvgPanel: a front panel drawn in a vector editor; labelled elements are
// animated from the values and act as controls (IND-120 .. IND-126).
import { CONTROL_ROLES, matches, optionValue, parseRole, type Role, rotateAngle, stepValue, fraction, truthy } from "../contract/svgpanel.js";
import { clear, html, parseSkin, safeColor, setAttr, setHidden, setText } from "../core/dom.js";
import { checkEntry } from "../core/entry.js";
import { formatValue, withUnit } from "../core/format.js";
import type { AnyModel } from "../core/model.js";
import { BaseView } from "../core/view.js";
import type { SvgPanelTraits } from "../generated/contract.js";

const TRAITS = ["svg", "value", "problems", "show_entries"];

type Values = Record<string, unknown>;

interface Binding extends Role {
  el: SVGGraphicsElement;
  /** transform attribute of the drawing, kept under the animation */
  base: string;
  /** state name of a case element */
  state?: string;
  pivot?: [number, number] | null;
}

/**
 * Role label of an element: its data-awi attribute, else its editor label,
 * read by its qualified name (the kernel keeps the inkscape prefix; the
 * bundle holds no URL, not even a namespace name, GEN-005).
 */
export function labelOf(el: Element): string {
  return el.getAttribute("data-awi") || el.getAttribute("inkscape:label") || "";
}

/** Bindings and problems of a drawing (the front-end port of scan_svg). */
export function scanDrawing(root: Element): { bindings: Binding[]; problems: string[] } {
  const bindings: Binding[] = [];
  const problems: string[] = [];
  const walk = (el: Element, state: string | null): void => {
    const label = labelOf(el);
    const parsed = label ? parseRole(label) : null;
    const where = el.getAttribute("id") || label;
    let here = state;
    if (typeof parsed === "string") problems.push(`${where}: ${parsed}`);
    else if (parsed) {
      if (parsed.role === "case" && state === null) problems.push(`${where}: a 'case' must be inside a 'state' element`);
      else bindings.push({ ...parsed, el: el as SVGGraphicsElement, base: el.getAttribute("transform") || "", state: parsed.role === "case" ? (state as string) : undefined });
      if (parsed.role === "state") here = parsed.name;
    }
    for (const child of Array.from(el.children)) walk(child, here);
  };
  walk(root, null);
  return { bindings, problems };
}

/** Bounding box of an element, or null where the browser cannot measure it. */
function bbox(el: SVGGraphicsElement): DOMRect | null {
  try {
    const b = el.getBBox();
    return b.width || b.height ? b : null;
  } catch {
    return null;
  }
}

export class SvgPanelView extends BaseView<SvgPanelTraits> {
  readonly stage: HTMLDivElement;
  readonly entries: HTMLDivElement;
  readonly msg: HTMLDivElement;
  bindings: Binding[] = [];
  localProblems: string[] = [];
  private _svgKey: unknown = undefined;
  private _entryKey = "";

  constructor(model: AnyModel<SvgPanelTraits>, el: HTMLElement) {
    super(model, el, TRAITS);
    this.body.setAttribute("role", "group");
    this.stage = html("div", { cls: "awi-svp-stage" });
    this.entries = html("div", { cls: "awi-svp-entries" });
    this.msg = html("div", { cls: "awi-svp-msg", attrs: { role: "status" } });
    this.body.append(this.stage, this.entries, this.msg);
    this.schedule();
  }

  values(): Values {
    const v = this.get("value");
    return v && typeof v === "object" ? (v as Values) : {};
  }

  /** Operator action (IND-123): the new value goes to the kernel. */
  write(name: string, value: unknown): void {
    if (!this.interactive) return;
    this.model.set("value", { ...this.values(), [name]: value });
    this.model.save_changes();
    this.schedule();
  }

  build(): void {
    clear(this.stage);
    this.bindings = [];
    this.localProblems = [];
    const root = parseSkin(this.get("svg"));
    if (!root) {
      if (this.get("svg")) this.localProblems.push("the drawing is not a valid SVG document");
      return;
    }
    root.setAttribute("class", "awi-svp-svg");
    root.removeAttribute("width");
    root.removeAttribute("height");
    this.stage.appendChild(root);
    const { bindings, problems } = scanDrawing(root);
    this.bindings = bindings;
    this.localProblems = problems;
    for (const b of bindings) if (CONTROL_ROLES.includes(b.role)) this.attachControl(b);
  }

  attachControl(b: Binding): void {
    const el = b.el;
    const name = String(b.options.label || (b.role === "set" ? b.options.value : "") || b.name);
    el.classList.add("awi-svp-control");
    el.setAttribute("data-lm-suppress-shortcuts", "true");
    el.setAttribute("role", b.role === "step" ? "spinbutton" : "button");
    el.setAttribute("aria-label", name);
    const act = (dir = 1): void => {
      const v = this.values()[b.name];
      if (b.role === "button") this.write(b.name, !truthy(v));
      else if (b.role === "set") this.write(b.name, optionValue(String(b.options.value)));
      else if (b.role === "step") this.write(b.name, stepValue(v, dir, b.options));
    };
    if (b.role === "momentary") {
      const press = (on: boolean): void => {
        if (truthy(this.values()[b.name]) !== on) this.write(b.name, on);
      };
      el.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        el.setPointerCapture?.(e.pointerId);
        press(true);
      });
      for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) el.addEventListener(ev, () => press(false));
      el.addEventListener("keydown", (e) => {
        if (e.key !== " " && e.key !== "Enter") return;
        e.preventDefault();
        if (!e.repeat) press(true);
      });
      el.addEventListener("keyup", (e) => {
        if (e.key === " " || e.key === "Enter") press(false);
      });
      el.addEventListener("blur", () => press(false));
      return;
    }
    el.addEventListener("click", (e) => act((e as MouseEvent).shiftKey ? -1 : 1));
    el.addEventListener("keydown", (e) => {
      const key = (e as KeyboardEvent).key;
      if (key === " " || key === "Enter") act(1);
      else if (b.role === "step" && (key === "ArrowUp" || key === "ArrowRight")) act(1);
      else if (b.role === "step" && (key === "ArrowDown" || key === "ArrowLeft")) act(-1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
  }

  /** Pivot of a rotate element: cx / cy, the editor's rotation center, or the element center. */
  pivot(b: Binding): [number, number] | null {
    if (b.pivot !== undefined && b.pivot !== null) return b.pivot;
    const { cx, cy } = b.options;
    if (typeof cx === "number" && typeof cy === "number") return (b.pivot = [cx, cy]);
    const box = bbox(b.el);
    if (!box) return null; // not measurable yet (hidden): try again at the next frame
    const tx = Number(b.el.getAttribute("inkscape:transform-center-x")) || 0;
    const ty = Number(b.el.getAttribute("inkscape:transform-center-y")) || 0;
    // the editor stores the offset from the box center, y pointing up
    return (b.pivot = [box.x + box.width / 2 + tx, box.y + box.height / 2 - ty]);
  }

  apply(values: Values): void {
    for (const b of this.bindings) {
      const v = values[b.name];
      const o = b.options;
      switch (b.role) {
        case "text": {
          const target = b.el.querySelector("tspan") ?? b.el;
          const text = typeof v === "number" ? withUnit(formatValue(v, String(o.format)), String(o.unit)) : v === null || v === undefined ? "—" : String(v);
          setText(target, text);
          break;
        }
        case "rotate": {
          const a = rotateAngle(v, o);
          const p = a === null ? null : this.pivot(b);
          if (a !== null && p) setAttr(b.el, "transform", `${b.base} rotate(${a.toFixed(2)} ${p[0]} ${p[1]})`.trim());
          break;
        }
        case "scale": {
          const f = fraction(v, o);
          const box = f === null ? null : bbox(b.el);
          if (f === null || !box) break;
          const t =
            o.edge === "bottom" || o.edge === "top"
              ? ((ay: number) => `translate(0 ${ay}) scale(1 ${f.toFixed(4)}) translate(0 ${-ay})`)(o.edge === "bottom" ? box.y + box.height : box.y)
              : ((ax: number) => `translate(${ax} 0) scale(${f.toFixed(4)} 1) translate(${-ax} 0)`)(o.edge === "left" ? box.x : box.x + box.width);
          setAttr(b.el, "transform", `${b.base} ${t}`.trim());
          break;
        }
        case "show":
          setAttr(b.el, "display", (o.eq === null ? truthy(v) : matches(String(o.eq), v)) ? null : "none");
          break;
        case "case":
          setAttr(b.el, "display", matches(b.name, values[b.state as string]) ? null : "none");
          break;
        case "color": {
          const on = o.eq === null ? truthy(v) : matches(String(o.eq), v);
          const c = safeColor(on ? o.on : o.off);
          if (c) b.el.style.setProperty("fill", c);
          break;
        }
        case "button":
          setAttr(b.el, "aria-pressed", String(truthy(v)));
          break;
        case "momentary":
          setAttr(b.el, "aria-pressed", String(truthy(v)));
          break;
        case "step":
          setAttr(b.el, "aria-valuenow", typeof v === "number" ? String(v) : null);
          setAttr(b.el, "aria-valuemin", String(o.min));
          setAttr(b.el, "aria-valuemax", String(o.max));
          break;
      }
      if (CONTROL_ROLES.includes(b.role)) {
        setAttr(b.el, "tabindex", this.interactive ? "0" : "-1");
        setAttr(b.el, "aria-disabled", this.interactive ? null : "true");
      }
    }
  }

  /** Entry fields of the step values (IND-124). */
  renderEntries(values: Values): void {
    const steps = new Map<string, Binding>();
    for (const b of this.bindings) if (b.role === "step" && !steps.has(b.name)) steps.set(b.name, b);
    const show = this.get("show_entries") && steps.size > 0;
    setHidden(this.entries, !show);
    if (!show) return;
    const key = JSON.stringify([...steps.keys()]);
    if (key !== this._entryKey) {
      this._entryKey = key;
      clear(this.entries);
      for (const [name, b] of steps) {
        const o = b.options;
        const input = html("input", { cls: "awi-entry", attrs: { type: "text", inputmode: "decimal", autocomplete: "off", spellcheck: "false", "data-lm-suppress-shortcuts": "true", "data-name": name } });
        const err = html("span", { cls: "awi-entry-msg", attrs: { role: "alert" } });
        const label = String(o.label || name);
        input.setAttribute("aria-label", `${label} (${formatValue(o.min as number, String(o.format))} to ${formatValue(o.max as number, String(o.format))})`);
        const commit = (): void => {
          const r = checkEntry(input.value, { min: o.min as number, max: o.max as number, step: o.step as number, unit: String(o.unit), format: String(o.format) });
          setText(err, r.ok ? "" : r.reason);
          if (r.ok) this.write(name, r.value);
        };
        input.addEventListener("keydown", (e) => {
          e.stopPropagation();
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setText(err, "");
            input.blur();
            this.schedule();
          }
        });
        input.addEventListener("change", commit);
        this.entries.appendChild(html("label", { cls: "awi-svp-entry" }, [html("span", { text: label }), input, html("span", { cls: "awi-entry-unit", text: String(o.unit) }), err]));
      }
    }
    for (const input of Array.from(this.entries.querySelectorAll("input"))) {
      const name = input.getAttribute("data-name") as string;
      const b = steps.get(name) as Binding;
      if (input.disabled !== !this.interactive) input.disabled = !this.interactive;
      if (document.activeElement !== input) {
        const v = values[name];
        input.value = typeof v === "number" ? formatValue(v, String(b.options.format)) : "";
      }
    }
  }

  override draw(): void {
    const svgSource = this.get("svg");
    if (svgSource !== this._svgKey) {
      this._svgKey = svgSource;
      this._entryKey = "";
      this.build();
    }
    const values = this.values();
    this.apply(values);
    this.renderEntries(values);
    const [, h] = this.get("size");
    this.stage.style.height = `${Math.max(40, h - 34 - (this.entries.hidden ? 0 : this.entries.offsetHeight + 4))}px`;
    const kernel = this.get("problems") || [];
    const problems = kernel.length ? kernel : this.localProblems;
    setText(this.msg, problems.length ? `⚠ ${problems.length === 1 ? "1 problem" : `${problems.length} problems`}: ${problems.join("; ")}` : "");
    setHidden(this.msg, problems.length === 0);
    const names = [...new Set(this.bindings.filter((b) => b.role !== "case").map((b) => b.name))].sort();
    const described = names.map((n) => {
      const v = values[n];
      return `${n} ${typeof v === "number" ? formatValue(v, "%.4g") : v === undefined || v === null ? "—" : String(v)}`;
    });
    setAttr(this.body, "aria-label", `${this.get("label") || "SVG panel"}${described.length ? `: ${described.join(", ")}` : ""}`);
  }
}
