// Machine state model (IND-060..063): state diagram with the current state
// highlighted and the commands valid in that state.
import { clear, html, svg, svgText } from "../core/dom.js";
import { BaseView } from "../core/view.js";

const SC = "SC";
const FROM_ANY = new Set(["Stop", "Abort"]); // drawn as a note, not as arrows

/** Point where the segment from (x0, y0) to the centre (x1, y1) enters a w×h box. */
export function boxEdge(x0, y0, x1, y1, w, h) {
  const dx = x0 - x1;
  const dy = y0 - y1;
  if (dx === 0 && dy === 0) return [x1, y1];
  const k = 1 / Math.max(Math.abs(dx) / (w / 2), Math.abs(dy) / (h / 2));
  return [x1 + dx * k, y1 + dy * k];
}

export class StateMachineView extends BaseView {
  constructor(model, el) {
    super(model, el, ["value", "machine", "available_commands", "last_command"]);
    this.svgEl = svg("svg", { class: "awi-svg awi-sm-diagram", "aria-hidden": "true" });
    this.statusEl = html("div", { cls: "awi-sm-status", attrs: { role: "status" } });
    this.bar = html("div", { cls: "awi-sm-commands", attrs: { role: "group", "aria-label": "Commands" } });
    this.body.append(this.svgEl, this.statusEl, this.bar);
    this.body.setAttribute("role", "group");
    this.listen("msg:custom", (msg) => {
      if (msg && msg.type === "rejected") this.statusEl.textContent = `✖ ${msg.command} not allowed in ${msg.state}`;
    });
    this.schedule();
  }

  draw() {
    const m = this.get("machine") || { states: [], transitions: [], commands: [] };
    const current = this.get("value");
    const available = new Set(this.get("available_commands") || []);
    const [w, h] = this.get("size");
    const dh = Math.max(80, h - 62);
    const s = this.svgEl;
    s.setAttribute("viewBox", `0 0 ${w} ${dh}`);
    s.style.height = `${dh}px`;
    clear(s);
    const cols = Math.max(1, ...m.states.map((st) => st.x + 1));
    const rows = Math.max(1, ...m.states.map((st) => st.y + 1));
    const cw = w / cols;
    const ch = dh / rows;
    const bw = Math.min(cw - 14, 110);
    const bh = Math.min(ch - 12, 30);
    const centre = {};
    for (const st of m.states) centre[st.name] = [cw * (st.x + 0.5), ch * (st.y + 0.5)];

    // transitions (Stop / Abort from any state are summarised in the legend)
    const defs = svg("defs", {}, [
      svg("marker", { id: `${this.id}-arrow`, viewBox: "0 0 8 8", refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, markerUnits: "userSpaceOnUse", orient: "auto-start-reverse" }, [svg("path", { class: "awi-sm-arrowhead", d: "M0 0L8 4L0 8Z" })]),
    ]);
    s.appendChild(defs);
    const drawn = new Set();
    for (const [from, cmd, to] of m.transitions || []) {
      if (FROM_ANY.has(cmd) || !centre[from] || !centre[to] || drawn.has(`${from}>${to}`)) continue;
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
      s.appendChild(svgText(label, { class: `awi-sm-label${st.name === current ? " awi-sm-label-current" : ""}`, x: cx, y: cy, "text-anchor": "middle", "dominant-baseline": "central" }));
    }

    // status and commands (IND-061)
    const acting = m.states.find((st) => st.name === current)?.acting;
    const anyNote = (m.commands || []).some((c) => FROM_ANY.has(c)) ? " · Stop / Abort: from most states" : "";
    if (!this.statusEl.textContent.startsWith("✖") || this._shown !== current) {
      this.statusEl.textContent = `State: ${current}${acting ? " (acting, completes by itself)" : ""}${anyNote}`;
    }
    this._shown = current;
    clear(this.bar);
    const control = this.get("mode") === "control";
    for (const c of m.commands || []) {
      const ok = available.has(c);
      const btn = html("button", { cls: "awi-sm-cmd", text: c, attrs: { type: "button", "aria-disabled": String(!ok) } });
      btn.disabled = !control || !ok || !!this.get("disabled");
      btn.addEventListener("click", () => this.interactive && ok && this.model.send({ type: "command", command: c }));
      this.bar.appendChild(btn);
    }
    this.bar.hidden = !control;
    this.body.setAttribute("aria-label", `${this.get("label") || "State machine"}: ${current}; available commands: ${[...available].join(", ") || "none"}`);
  }
}
