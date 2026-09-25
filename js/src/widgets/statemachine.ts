// Machine state model (IND-060..063): state diagram with the current state
// highlighted and the commands valid in that state.
import { hostOwnsState, machineOf } from "../contract/derived.js";
import { globalCommands, type Machine, nextState } from "../contract/statemachine.js";
import { clear, html, svg, svgText } from "../core/dom.js";
import type { AnyModel } from "../core/model.js";
import { BaseView } from "../core/view.js";
import type { StateMachineTraits } from "../generated/contract.js";
import { type Box, inZone, insetOutline, placeLabel, type Pt, type Rect, routePoints, type Segment, zoneExit } from "./smlayout.js";

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
    // boxes leave room between rows and columns for the arrows and their labels
    const bw = Math.max(20, Math.min(cw - 40, titled ? 130 : 112));
    const bh = Math.max(14, Math.min(ch - 24, titled ? 44 : 30));
    const px = (p: Pt): Pt => [p[0] * cw, p[1] * ch];
    const boxes: Record<string, Box> = {};
    for (const st of m.states) boxes[st.name] = { cx: cw * (st.x + 0.5), cy: ch * (st.y + 0.5), w: bw, h: bh };
    const edges = svg("g", { class: "awi-sm-edges" });
    const labels = svg("g", { class: "awi-sm-edge-labels" });
    const arrow = `url(#${this.id}-arrow)`;
    const all = Object.values(boxes);
    const used: Segment[] = [];
    const taken: Rect[] = [];
    // zone names go on top of everything, and the arrow labels keep clear of them
    const zoneLabels = svg("g", { class: "awi-sm-zone-labels" });
    const zoneLabel = (text: string, x: number, y: number): void => {
      zoneLabels.appendChild(svgText(text, { class: "awi-sm-zone-label", x, y, "dominant-baseline": "hanging" }));
      taken.push([x - 2, y - 1, x + text.length * 5.8 + 2, y + 11]);
    };
    const edge = (points: Pt[], text: string, next: boolean, extra = ""): void => {
      const d = points.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("");
      edges.appendChild(svg("path", { class: `awi-sm-edge${extra}${next ? " awi-sm-edge-next" : ""}`, d, "marker-end": arrow }));
      for (let i = 0; i + 1 < points.length; i++) used.push([points[i], points[i + 1]]);
      const a = placeLabel(points, text.length * 5.2 + 4, all, taken);
      const above = (a.side ?? 1) > 0;
      const attrs = a.horizontal
        ? { x: a.x, y: above ? a.y - 3 : a.y + 3, "text-anchor": "middle", "dominant-baseline": above ? "auto" : "hanging" }
        : { x: above ? a.x + 4 : a.x - 4, y: a.y, "text-anchor": above ? "start" : "end", "dominant-baseline": "central" };
      labels.appendChild(svgText(text, { class: `awi-sm-edge-label${next ? " awi-sm-edge-label-next" : ""}`, ...attrs }));
    };

    // group zones (IND-066): the cells of a group shaded, the group named once
    const groups = [...new Set(m.states.map((st) => st.group).filter((g): g is string => !!g))];
    for (const st of m.states) {
      if (!st.group) continue;
      s.appendChild(svg("rect", { class: `awi-sm-zone awi-sm-zone-${groups.indexOf(st.group) % 3}`, x: cw * st.x, y: ch * st.y, width: cw, height: ch }));
    }
    for (const g of groups) {
      const first = m.states.filter((st) => st.group === g).sort((a, b) => a.y - b.y || a.x - b.x)[0];
      zoneLabel(g, cw * first.x + 3, ch * first.y + 2);
    }

    // drawn zones (IND-066): nested dashed outlines, each inset a little more
    // than the previous one; a command valid from every state of a zone to
    // one state outside it is drawn as a single arrow leaving the zone
    const zoneCmds = new Set<string>();
    (m.zones || []).forEach((z, i) => {
      const inset = 3 + 5 * i;
      const inside = m.states.filter((st) => inZone(z.rects, st.x + 0.5, st.y + 0.5));
      if (z.shade) {
        for (const [x0, y0, x1, y1] of z.rects) s.appendChild(svg("rect", { class: "awi-sm-area-shade", x: x0 * cw, y: y0 * ch, width: (x1 - x0) * cw, height: (y1 - y0) * ch }));
      }
      const d = insetOutline(z.rects, cw, ch, inset)
        .map(([x0, y0, x1, y1]) => `M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}`)
        .join("");
      s.appendChild(svg("path", { class: "awi-sm-area", d }));
      if (z.label) zoneLabel(z.label, z.rects[0][0] * cw + inset + 3, z.rects[0][1] * ch + inset + 2);
      for (const c of z.commands || []) {
        const targets = new Set(inside.map((st) => nextState(m, st.name, c)));
        const [to] = targets;
        if (!inside.length || targets.size !== 1 || !to || !boxes[to]) continue;
        const target = m.states.find((st) => st.name === to)!;
        const exit = zoneExit(z.rects, target.x + 0.5, target.y + 0.5);
        if (!exit) continue;
        const b = boxes[to];
        const [ex, ey] = px(exit);
        const vertical = Math.abs(ex - b.cx) < 0.5;
        const start: Pt = vertical ? [ex, ey + (ey < b.cy ? -inset : inset)] : [ex + (ex < b.cx ? -inset : inset), ey];
        const end: Pt = vertical ? [b.cx, b.cy + (ey < b.cy ? -bh / 2 : bh / 2)] : [b.cx + (ex < b.cx ? -bw / 2 : bw / 2), b.cy];
        const here = inside.some((st) => st.name === current);
        edge([start, end], c, here && available.has(c), " awi-sm-zone-edge");
        zoneCmds.add(c);
      }
    });

    // transitions: right-angle arrows, each labelled with its commands;
    // global commands not drawn as a zone arrow are summarised in the status
    const fromAny = new Set(globalCommands(m));
    const pairs = new Map<string, string[]>();
    for (const [from, cmd, to] of m.transitions || []) {
      if (fromAny.has(cmd) || zoneCmds.has(cmd) || !boxes[from] || !boxes[to] || from === to) continue;
      const key = `${from}>${to}`;
      pairs.set(key, [...(pairs.get(key) || []), cmd]);
    }
    // the gaps between the rows and the columns of states are the channels of the detours
    const rowGaps = Array.from({ length: rows + 1 }, (_, k) => Math.min(dh - 3, Math.max(3, k * ch)));
    const colGaps = Array.from({ length: cols + 1 }, (_, k) => Math.min(w - 3, Math.max(3, k * cw)));
    // routes fixed by the model first, then the shortest arrows
    const order = [...pairs.keys()].sort((p, q) => {
      const fixed = Number(!m.routes?.[p]) - Number(!m.routes?.[q]);
      const dist = (k: string): number => {
        const [f, t] = k.split(">");
        return Math.abs(boxes[f].cx - boxes[t].cx) + Math.abs(boxes[f].cy - boxes[t].cy);
      };
      return fixed || dist(p) - dist(q);
    });
    for (const key of order) {
      const cmds = pairs.get(key)!;
      const [from, to] = key.split(">");
      const route = m.routes?.[key]?.map(px) ?? null;
      const points = routePoints(boxes[from], boxes[to], route, { boxes: all, used, rowGaps, colGaps });
      const next = from === current && cmds.some((c) => c === SC || available.has(c));
      edge(points, cmds.join(" / "), next);
    }
    s.appendChild(
      svg("defs", {}, [
        svg("marker", { id: `${this.id}-arrow`, viewBox: "0 0 8 8", refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, markerUnits: "userSpaceOnUse", orient: "auto-start-reverse" }, [svg("path", { class: "awi-sm-arrowhead", d: "M0 0L8 4L0 8Z" })]),
      ]),
    );
    s.append(edges);

    // states: acting states (they complete by themselves) rounded and warm,
    // wait states square, cool and in capitals (IND-060)
    for (const st of m.states) {
      const { cx, cy } = boxes[st.name];
      const cls = `awi-sm-state ${st.acting ? "awi-sm-acting" : "awi-sm-wait"}${st.name === current ? " awi-sm-current" : ""}`;
      s.appendChild(svg("rect", { class: cls, x: cx - bw / 2, y: cy - bh / 2, width: bw, height: bh, rx: st.acting ? Math.min(12, bh / 2) : 2 }));
      const label = st.name === current ? `▶ ${st.name}` : st.name;
      const lines = st.title && bh >= 26 ? wrapTitle(st.title, Math.max(8, Math.floor(bw / 4.8)), bh >= 40 ? 2 : 1) : [];
      const top = cy - (lines.length * 10) / 2;
      const kind = st.acting ? "" : " awi-sm-label-wait";
      s.appendChild(svgText(label, { class: `awi-sm-label${kind}${st.name === current ? " awi-sm-label-current" : ""}`, x: cx, y: lines.length ? top : cy, "text-anchor": "middle", "dominant-baseline": "central" }));
      lines.forEach((line, i) => {
        s.appendChild(svgText(line, { class: `awi-sm-title${st.name === current ? " awi-sm-title-current" : ""}`, x: cx, y: top + 10 * (i + 1), "text-anchor": "middle", "dominant-baseline": "central" }));
      });
    }

    s.append(labels, zoneLabels); // over the boxes: a label never hides behind a state

    // status and commands (IND-061)
    const here = m.states.find((st) => st.name === current);
    const named = here?.title ? `${current} ${here.title}` : current;
    const notes = (m.commands || []).filter((c) => fromAny.has(c) && !zoneCmds.has(c));
    const anyNote = notes.length ? ` · ${notes.join(" / ")}: from most states` : "";
    if (!this.statusEl.textContent.startsWith("✖") || this._shown !== current) {
      this.statusEl.textContent = `State: ${named}${here?.acting ? " (acting, completes by itself)" : ""}${anyNote}`;
    }
    this._shown = current;
    this.body.setAttribute("aria-label", `${this.get("label") || "State machine"}: ${named}; available commands: ${[...available].join(", ") || "none"}`);
  }
}
