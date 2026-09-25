// Machine state model (IND-060..063): state diagram with the current state
// highlighted and the commands valid in that state.
import { hostOwnsState, machineOf } from "../contract/derived.js";
import { globalCommands, type Machine, nextState } from "../contract/statemachine.js";
import { clear, html, svg, svgText } from "../core/dom.js";
import type { AnyModel } from "../core/model.js";
import { BaseView } from "../core/view.js";
import type { StateMachineTraits } from "../generated/contract.js";

const SC = "SC";

/** Split a state title into at most `lines` lines of about `width` characters. */
export function wrapTitle(title: string, width: number, lines = 2): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of title.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  if (out.length <= lines) return out;
  const kept = out.slice(0, lines);
  kept[lines - 1] = `${kept[lines - 1].slice(0, Math.max(1, width - 1))}…`;
  return kept;
}

/** Point where the segment from (x0, y0) to the centre (x1, y1) enters a w×h box. */
export function boxEdge(x0: number, y0: number, x1: number, y1: number, w: number, h: number): [number, number] {
  const dx = x0 - x1;
  const dy = y0 - y1;
  if (dx === 0 && dy === 0) return [x1, y1];
  const k = 1 / Math.max(Math.abs(dx) / (w / 2), Math.abs(dy) / (h / 2));
  return [x1 + dx * k, y1 + dy * k];
}

export class StateMachineView extends BaseView<StateMachineTraits> {
  readonly svgEl: SVGElement;
  readonly statusEl: HTMLDivElement;
  readonly bar: HTMLDivElement;
  protected _shown: string | undefined;

  constructor(model: AnyModel<StateMachineTraits>, el: HTMLElement) {
    super(model, el, ["value", "machine", "available_commands", "last_command"]);
    this.svgEl = svg("svg", { class: "awi-svg awi-sm-diagram", "aria-hidden": "true" });
    this.statusEl = html("div", { cls: "awi-sm-status", attrs: { role: "status" } });
    this.bar = html("div", { cls: "awi-sm-commands", attrs: { role: "group", "aria-label": "Commands" } });
    this.body.append(this.svgEl, this.statusEl, this.bar);
    this.body.setAttribute("role", "group");
    this.listen("msg:custom", (msg: { type?: string; command?: string; state?: string } | null) => {
      if (msg && msg.type === "rejected") this.reject(String(msg.command), String(msg.state));
    });
    this.schedule();
  }

  get machine(): Machine {
    return this.contract ? machineOf(this.model as unknown as AnyModel, this.contract) : (this.get("machine") as unknown as Machine);
  }

  reject(command: string, state: string): void {
    this.statusEl.textContent = `✖ ${command} not allowed in ${state}`;
  }

  /**
   * Operator command (IND-061): always sent to the host; applied by the front
   * end when no host owns the state (HOST-004).
   */
  command(c: string): void {
    if (!this.interactive) return;
    this.model.send({ type: "command", command: c });
    const model = this.model as unknown as AnyModel;
    if (hostOwnsState(model)) return;
    const state = String(this.get("value"));
    const next = nextState(this.machine, state, c);
    if (next === null) return this.reject(c, state);
    model.set("last_command", c);
    model.set("value", next); // available_commands follows (contract/derived.ts)
    model.save_changes();
  }

  /** Command buttons (IND-061), enabled when valid in the current state. */
  renderCommands(m: Machine, available: Set<string>): void {
    clear(this.bar);
    const control = this.get("mode") === "control";
    for (const c of m.commands || []) {
      const ok = available.has(c);
      const btn = html("button", { cls: "awi-sm-cmd", text: c, attrs: { type: "button", "aria-disabled": String(!ok) } });
      btn.disabled = !control || !ok || !!this.get("disabled");
      btn.addEventListener("click", () => ok && this.command(c));
      this.bar.appendChild(btn);
    }
    this.bar.hidden = !control;
  }

  override draw(): void {
    const m = this.machine;
    const current = String(this.get("value"));
    const available = new Set(this.get("available_commands") || []);
    const [w, h] = this.get("size");
    this.renderCommands(m, available);
    // the diagram takes what the status line and the command rows leave
    const barH = this.bar.hidden ? 0 : Math.max(24, this.bar.offsetHeight + 4);
    const dh = Math.max(80, h - 38 - barH);
    const s = this.svgEl;
    s.setAttribute("viewBox", `0 0 ${w} ${dh}`);
    s.style.height = `${dh}px`;
    clear(s);
    const cols = Math.max(1, ...m.states.map((st) => st.x + 1));
    const rows = Math.max(1, ...m.states.map((st) => st.y + 1));
    const cw = w / cols;
    const ch = dh / rows;
    const titled = m.states.some((st) => st.title);
    const bw = Math.min(cw - 14, titled ? 130 : 110);
    const bh = Math.min(ch - 12, titled ? 44 : 30);
    const centre: Record<string, [number, number]> = {};
    for (const st of m.states) centre[st.name] = [cw * (st.x + 0.5), ch * (st.y + 0.5)];
    const fromAny = new Set(globalCommands(m)); // drawn as a note, not as arrows

    // group zones (IND-066): the cells of a group shaded, the group named once
    const groups = [...new Set(m.states.map((st) => st.group).filter((g): g is string => !!g))];
    for (const st of m.states) {
      if (!st.group) continue;
      s.appendChild(svg("rect", { class: `awi-sm-zone awi-sm-zone-${groups.indexOf(st.group) % 3}`, x: cw * st.x, y: ch * st.y, width: cw, height: ch }));
    }
    for (const g of groups) {
      const first = m.states.filter((st) => st.group === g).sort((a, b) => a.y - b.y || a.x - b.x)[0];
      s.appendChild(svgText(g, { class: "awi-sm-zone-label", x: cw * first.x + 3, y: ch * first.y + 2, "dominant-baseline": "hanging" }));
    }

    // transitions (Stop / Abort from any state are summarised in the legend)
    const defs = svg("defs", {}, [
      svg("marker", { id: `${this.id}-arrow`, viewBox: "0 0 8 8", refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, markerUnits: "userSpaceOnUse", orient: "auto-start-reverse" }, [svg("path", { class: "awi-sm-arrowhead", d: "M0 0L8 4L0 8Z" })]),
    ]);
    s.appendChild(defs);
    const drawn = new Set<string>();
    for (const [from, cmd, to] of m.transitions || []) {
      if (fromAny.has(cmd) || !centre[from] || !centre[to] || drawn.has(`${from}>${to}`)) continue;
      drawn.add(`${from}>${to}`);
      const [x0, y0] = centre[from];
      const [x1, y1] = centre[to];
      const [ex, ey] = boxEdge(x0, y0, x1, y1, bw + 4, bh + 4);
      const [sx, sy] = boxEdge(x1, y1, x0, y0, bw, bh);
      const active = from === current && (cmd === SC || available.has(cmd));
      s.appendChild(svg("path", { class: `awi-sm-edge${active ? " awi-sm-edge-next" : ""}`, d: `M${sx} ${sy}L${ex} ${ey}`, "marker-end": `url(#${this.id}-arrow)` }));
    }
    for (const st of m.states) {
      const [cx, cy] = centre[st.name];
      const cls = `awi-sm-state${st.acting ? " awi-sm-acting" : ""}${st.name === current ? " awi-sm-current" : ""}`;
      s.appendChild(svg("rect", { class: cls, x: cx - bw / 2, y: cy - bh / 2, width: bw, height: bh, rx: st.acting ? 12 : 3 }));
      const label = st.name === current ? `▶ ${st.name}` : st.name;
      const lines = st.title && bh >= 26 ? wrapTitle(st.title, Math.max(8, Math.floor(bw / 4.8)), bh >= 40 ? 2 : 1) : [];
      const top = cy - (lines.length * 10) / 2;
      s.appendChild(svgText(label, { class: `awi-sm-label${st.name === current ? " awi-sm-label-current" : ""}`, x: cx, y: lines.length ? top : cy, "text-anchor": "middle", "dominant-baseline": "central" }));
      lines.forEach((line, i) => {
        s.appendChild(svgText(line, { class: `awi-sm-title${st.name === current ? " awi-sm-title-current" : ""}`, x: cx, y: top + 10 * (i + 1), "text-anchor": "middle", "dominant-baseline": "central" }));
      });
    }

    // status and commands (IND-061)
    const here = m.states.find((st) => st.name === current);
    const named = here?.title ? `${current} ${here.title}` : current;
    const notes = (m.commands || []).filter((c) => fromAny.has(c));
    const anyNote = notes.length ? ` · ${notes.join(" / ")}: from most states` : "";
    if (!this.statusEl.textContent.startsWith("✖") || this._shown !== current) {
      this.statusEl.textContent = `State: ${named}${here?.acting ? " (acting, completes by itself)" : ""}${anyNote}`;
    }
    this._shown = current;
    this.body.setAttribute("aria-label", `${this.get("label") || "State machine"}: ${named}; available commands: ${[...available].join(", ") || "none"}`);
  }
}
