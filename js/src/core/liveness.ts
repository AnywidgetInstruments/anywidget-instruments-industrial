// Kernel liveness (ROB-001, ROB-004, HOST-003).
//
// Detection is off unless the host announces heartbeats: a non-empty
// `_session` and `_heartbeat > 0`. The Python package announces them for
// every widget; a host that does nothing (a plain dictionary of traits) never
// sees a stale indication. The host then sends `{"type": "hb", "session"}`
// every `_heartbeat` seconds through any widget; every view of the same
// session shares the timestamp.
import type { AnyModel } from "./model.js";
import { parseNumber } from "./scale.js";

export type Liveness = "live" | "stale" | "nokernel";

interface Registry {
  beats: Record<string, number>;
}
const scope = globalThis as typeof globalThis & { __awiLiveness?: Registry };
const REG: Registry = (scope.__awiLiveness ||= { beats: {} });

export function recordBeat(session: unknown, now = Date.now()): void {
  if (typeof session === "string" && session) REG.beats[session] = now;
}

/** Force the stale state until the next heartbeat (e.g. comm closed). */
export function markDead(session: unknown): void {
  if (typeof session === "string" && session) REG.beats[session] = -Infinity;
}

/** Heartbeat period announced by the host, in seconds; 0 when not announced. */
export function announcedInterval(session: unknown, interval: unknown): number {
  if (typeof session !== "string" || !session) return 0;
  const s = parseNumber(interval);
  return Number.isFinite(s) && s > 0 ? s : 0;
}

/**
 * Liveness state of a view: "live", "stale" (heartbeats stopped) or
 * "nokernel" (no heartbeat ever received since the view was created).
 * Always "live" when the host did not announce heartbeats.
 */
export function liveness({ session, interval, since, now = Date.now() }: { session: unknown; interval: unknown; since: number; now?: number }): Liveness {
  const period = announcedInterval(session, interval);
  if (!period) return "live";
  const limit = (3 * period + 1) * 1000;
  const last = REG.beats[session as string];
  if (last === undefined) return now - since > limit + 2000 ? "nokernel" : "live";
  return now - last > limit ? "stale" : "live";
}

/** Model-level hook: listen to heartbeats even when no view is displayed. */
export function watchModel(model: AnyModel): void {
  model.on("msg:custom", (msg: { type?: string; session?: unknown } | null) => {
    if (msg && msg.type === "hb") recordBeat(msg.session);
  });
  // Jupyter: the comm died (kernel restart / shutdown)
  model.on("comm_live_update", () => markDead(model.get("_session")));
}
