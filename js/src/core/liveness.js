// Kernel liveness (ROB-001, ROB-004). The kernel sends a heartbeat through one
// widget; every view of the same kernel session shares the timestamp.
const REG = (globalThis.__awiLiveness ||= { beats: {} });

export function recordBeat(session, now = Date.now()) {
  if (session) REG.beats[session] = now;
}

/** Force the stale state until the next heartbeat (e.g. comm closed). */
export function markDead(session) {
  if (session) REG.beats[session] = -Infinity;
}

/**
 * Liveness state of a view: "live", "stale" (heartbeats stopped) or
 * "nokernel" (no heartbeat ever received since the view was created).
 * `interval` is the heartbeat period in seconds; 0 disables detection.
 */
export function liveness({ session, interval, since, now = Date.now() }) {
  if (!interval || !session) return "live";
  const limit = (3 * interval + 1) * 1000;
  const last = REG.beats[session];
  if (last === undefined) return now - since > limit + 2000 ? "nokernel" : "live";
  return now - last > limit ? "stale" : "live";
}

/** Model-level hook: listen to heartbeats even when no view is displayed. */
export function watchModel(model) {
  model.on("msg:custom", (msg) => {
    if (msg && msg.type === "hb") recordBeat(msg.session);
  });
  // Jupyter: the comm died (kernel restart / shutdown)
  model.on("comm_live_update", () => markDead(model.get("_session")));
}
