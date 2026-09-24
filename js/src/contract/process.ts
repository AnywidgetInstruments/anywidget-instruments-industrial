// Faceplate commands of the process objects (SCADA-009): the front-end port
// of ProcessObject.command and Valve.demand_position (_process.py), applied
// when no host owns the state (HOST-004). Both are checked against the
// shared cases of tests/parity/process.json.

export interface ProcessState {
  auto: boolean;
  simulate: boolean;
  commands: readonly string[];
  /** Simulated state after each command (x-awi-simulated). */
  simulated: Readonly<Record<string, string>>;
  /** Opening of a control valve in %, null for other objects. */
  position: number | null;
}

export type ProcessChanges = Partial<{ auto: boolean; value: string; position: number }>;

/** Trait changes caused by a faceplate command (auto, manual, or one of `commands`). */
export function processCommand(command: string, s: ProcessState): ProcessChanges {
  if (command === "auto") return { auto: true };
  if (command === "manual") return { auto: false };
  if (!s.commands.includes(command) || !s.simulate) return {};
  const out: ProcessChanges = {};
  if (s.position !== null && (command === "open" || command === "close")) out.position = command === "open" ? 100 : 0;
  if (command in s.simulated) out.value = s.simulated[command];
  return out;
}

/** Trait changes caused by a control valve position demand (0 to 100 %). */
export function positionDemand(percent: number, s: ProcessState): ProcessChanges {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100 || !s.simulate) return {};
  return { position: percent, value: percent > 0 ? "open" : "closed" };
}
