// ISA-18.1 annunciator (IND-040 .. IND-043): the front-end port of
// annunciator_transition and of the panel logic of Annunciator (set,
// acknowledge, reset, silence, first-out mark, horn) in
// src/anywidget_instruments_industrial/_annunciator.py. Both are checked against the
// shared cases of tests/parity/annunciator.json.

export type Sequence = "A" | "M" | "R";
export type AnnEvent = "process" | "acknowledge" | "reset";

export interface AnnWindow {
  tag: string;
  text: string;
  color: string;
  active: boolean;
  state: string;
  first: boolean;
}

export interface Panel {
  windows: AnnWindow[];
  sequence: Sequence;
  firstOut: boolean;
  /** Horn silenced until the next alert (not a trait: kept per model). */
  silenced: boolean;
}

const CLEARED: Record<Sequence, string> = { A: "normal", M: "acknowledged", R: "ringback" };

/** Window state after `event` (see annunciator_transition). */
export function annunciatorTransition(state: string, active: boolean, event: AnnEvent, sequence: Sequence): string {
  if (event === "process") {
    if (active && (state === "normal" || state === "ringback")) return "alert";
    if (!active && state === "acknowledged") return CLEARED[sequence];
    return state;
  }
  if (event === "acknowledge") {
    if (state !== "alert") return state;
    return active ? "acknowledged" : CLEARED[sequence];
  }
  if (active) return state;
  if ((sequence === "M" && state === "acknowledged") || (sequence === "R" && state === "ringback")) return "normal";
  return state;
}

/** Windows as the kernel stores them: missing fields filled in. */
export function normalizeWindows(raw: unknown): AnnWindow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((w): w is Record<string, unknown> => !!w && typeof w === "object" && typeof (w as { tag?: unknown }).tag === "string")
    .map((w) => ({
      tag: w.tag as string,
      text: typeof w.text === "string" ? w.text : "",
      color: typeof w.color === "string" ? w.color : "amber",
      active: !!w.active,
      state: typeof w.state === "string" ? w.state : "normal",
      first: !!w.first,
    }));
}

const copy = (p: Panel): Panel => ({ ...p, windows: p.windows.map((w) => ({ ...w })) });

/** Process side: the condition of window `tag` becomes `active` (Annunciator.set). */
export function setProcess(panel: Panel, tag: string, active: boolean): Panel {
  const p = copy(panel);
  const w = p.windows.find((x) => x.tag === tag);
  if (!w) return p;
  w.active = active;
  const old = w.state;
  w.state = annunciatorTransition(old, active, "process", p.sequence);
  if ((w.state === "alert" || w.state === "ringback") && old !== w.state) p.silenced = false; // a new alert sounds again
  if (p.firstOut && old === "normal" && w.state === "alert" && !p.windows.some((x) => x.first)) w.first = true;
  if (w.state === "normal") w.first = false;
  return p;
}

/** Operator action on the whole panel (IND-043). */
export function panelAction(panel: Panel, action: "acknowledge" | "reset" | "silence"): Panel {
  const p = copy(panel);
  if (action === "silence") {
    p.silenced = true;
    return p;
  }
  for (const w of p.windows) {
    w.state = annunciatorTransition(w.state, w.active, action, p.sequence);
    if (w.state === "normal" || action === "reset") w.first = false;
  }
  return p;
}

/** True while an alert or ringback is not silenced. */
export function hornOn(panel: Panel): boolean {
  return !panel.silenced && panel.windows.some((w) => w.state === "alert" || w.state === "ringback");
}
