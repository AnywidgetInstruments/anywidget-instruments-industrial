// Machine state model (IND-060 .. IND-063): the front-end port of
// _check_model, StateMachine._next and _update_commands
// (src/anywidget_instruments/_statemachine.py). Both are checked against the
// shared cases of tests/parity/statemachine.json.

/** Completion of an acting state: a host event, not an operator command. */
export const SC = "SC";

export interface MachineState {
  name: string;
  x: number;
  y: number;
  acting: boolean;
  /** Shown under the name (IND-066). */
  title?: string;
  /** States of a group share a shaded zone (IND-066). */
  group?: string;
}

export interface Machine {
  states: MachineState[];
  transitions: Array<[string, string, string]>;
  commands: string[];
  initial: string;
  /** Commands valid from most states, drawn as a note (IND-066). */
  global_commands?: string[];
  /** Dashed areas of the drawing; a command of the area leaves it as one arrow (IND-066). */
  zones?: MachineZone[];
  /** Waypoints of a transition arrow, by "From>To", in cell units (IND-066). */
  routes?: Record<string, Array<[number, number]>>;
}

export interface MachineZone {
  label?: string;
  /** Union of rectangles [x0, y0, x1, y1] in cell units: a state at (x, y) fills [x, x+1] × [y, y+1]. */
  rects: Array<[number, number, number, number]>;
  /** Commands valid from every state of the zone to the same state, drawn as a single arrow. */
  commands?: string[];
  shade?: boolean;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Zones and routes as the kernel checks them (_check_drawing), or null when invalid. */
function drawingOf(m: Record<string, unknown>, names: string[], commands: string[]): Pick<Machine, "zones" | "routes"> | null {
  const out: Pick<Machine, "zones" | "routes"> = {};
  if ("zones" in m) {
    if (!Array.isArray(m.zones)) return null;
    const zones: MachineZone[] = [];
    for (const z of m.zones) {
      if (!z || typeof z !== "object") return null;
      const zr = z as Record<string, unknown>;
      if (!Array.isArray(zr.rects) || !zr.rects.length || !zr.rects.every((r) => Array.isArray(r) && r.length === 4 && r.every(isNum))) return null;
      const zone: MachineZone = { rects: zr.rects.map((r) => [...r] as [number, number, number, number]) };
      if ("label" in zr) {
        if (typeof zr.label !== "string") return null;
        zone.label = zr.label;
      }
      if ("commands" in zr) {
        if (!Array.isArray(zr.commands) || zr.commands.some((c) => !commands.includes(c))) return null;
        zone.commands = zr.commands.map(String);
      }
      if ("shade" in zr) zone.shade = !!zr.shade;
      zones.push(zone);
    }
    out.zones = zones;
  }
  if ("routes" in m) {
    if (!m.routes || typeof m.routes !== "object" || Array.isArray(m.routes)) return null;
    const routes: Record<string, Array<[number, number]>> = {};
    for (const [key, pts] of Object.entries(m.routes as Record<string, unknown>)) {
      const ends = key.split(">");
      if (ends.length !== 2 || !ends.every((n) => names.includes(n))) return null;
      if (!Array.isArray(pts) || !pts.every((p) => Array.isArray(p) && p.length === 2 && p.every(isNum))) return null;
      routes[key] = pts.map((p) => [p[0], p[1]] as [number, number]);
    }
    out.routes = routes;
  }
  return out;
}

/**
 * Model as the kernel stores it: default positions (5 per row) and acting
 * flags, commands completed from the transitions, initial state (the first
 * one by default). Returns null for a model the kernel would refuse.
 */
export function normalizeMachine(raw: unknown): Machine | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (!Array.isArray(m.states) || m.states.length === 0) return null;
  const states: MachineState[] = [];
  for (const [k, s] of m.states.entries()) {
    if (!s || typeof s !== "object" || typeof (s as { name?: unknown }).name !== "string") return null;
    const st = s as Record<string, unknown>;
    const state: MachineState = { name: st.name as string, x: "x" in st ? Number(st.x) : k % 5, y: "y" in st ? Number(st.y) : Math.floor(k / 5), acting: "acting" in st ? !!st.acting : false };
    for (const key of ["title", "group"] as const) {
      if (!(key in st)) continue;
      if (typeof st[key] !== "string") return null;
      state[key] = st[key] as string;
    }
    states.push(state);
  }
  const names = states.map((s) => s.name);
  if (new Set(names).size !== names.length) return null;
  const commands = Array.isArray(m.commands) ? m.commands.map(String) : [];
  const transitions: Array<[string, string, string]> = [];
  for (const tr of Array.isArray(m.transitions) ? m.transitions : []) {
    if (!Array.isArray(tr) || tr.length !== 3 || !names.includes(tr[0]) || !names.includes(tr[2])) return null;
    transitions.push([String(tr[0]), String(tr[1]), String(tr[2])]);
    if (tr[1] !== SC && !commands.includes(String(tr[1]))) commands.push(String(tr[1]));
  }
  const initial = "initial" in m ? m.initial : names[0];
  if (typeof initial !== "string" || !names.includes(initial)) return null;
  const machine: Machine = { states, transitions, commands, initial };
  if ("global_commands" in m) {
    const global = Array.isArray(m.global_commands) ? m.global_commands.map(String) : null;
    if (!global || global.some((c) => !commands.includes(c))) return null;
    machine.global_commands = global;
  }
  const drawing = drawingOf(m, names, commands);
  if (!drawing) return null;
  return { ...machine, ...drawing };
}

/** State after `command` from `state`, or null when the command is not valid there. */
export function nextState(machine: Machine, state: string, command: string): string | null {
  const tr = machine.transitions.find(([from, cmd]) => from === state && cmd === command);
  return tr ? tr[2] : null;
}

/** Commands valid in `state`, in the order of the model (IND-061). */
export function availableCommands(machine: Machine, state: string): string[] {
  return machine.commands.filter((c) => nextState(machine, state, c) !== null);
}

/** Commands drawn as a note rather than as arrows: global_commands, else Stop and Abort. */
export function globalCommands(machine: Machine): string[] {
  return machine.global_commands ?? ["Stop", "Abort"];
}

/** Current state: `value` when it is a state of the model, else the initial state. */
export function resolveState(machine: Machine, value: unknown): string {
  return typeof value === "string" && machine.states.some((s) => s.name === value) ? value : machine.initial;
}
