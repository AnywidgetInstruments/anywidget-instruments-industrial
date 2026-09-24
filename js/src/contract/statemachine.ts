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
}

export interface Machine {
  states: MachineState[];
  transitions: Array<[string, string, string]>;
  commands: string[];
  initial: string;
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
    states.push({ name: st.name as string, x: "x" in st ? Number(st.x) : k % 5, y: "y" in st ? Number(st.y) : Math.floor(k / 5), acting: "acting" in st ? !!st.acting : false });
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
  return { states, transitions, commands, initial };
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

/** Current state: `value` when it is a state of the model, else the initial state. */
export function resolveState(machine: Machine, value: unknown): string {
  return typeof value === "string" && machine.states.some((s) => s.name === value) ? value : machine.initial;
}
