import { describe, expect, it } from "vitest";
import { liveness, markDead, recordBeat } from "../src/core/liveness.js";

describe("liveness", () => {
  it("is live while heartbeats arrive", () => {
    recordBeat("s1", 1000);
    expect(liveness({ session: "s1", interval: 2, since: 0, now: 5000 })).toBe("live");
    expect(liveness({ session: "s1", interval: 2, since: 0, now: 8500 })).toBe("stale");
  });
  it("reports nokernel when no heartbeat was ever received", () => {
    expect(liveness({ session: "never", interval: 2, since: 0, now: 3000 })).toBe("live");
    expect(liveness({ session: "never", interval: 2, since: 0, now: 10000 })).toBe("nokernel");
  });
  it("comm death forces stale until the next beat", () => {
    recordBeat("s2", 1000);
    markDead("s2");
    expect(liveness({ session: "s2", interval: 2, since: 0, now: 1001 })).toBe("stale");
    recordBeat("s2", 2000);
    expect(liveness({ session: "s2", interval: 2, since: 0, now: 2001 })).toBe("live");
  });
  it("interval 0 disables detection", () => {
    expect(liveness({ session: "x", interval: 0, since: 0, now: 1e9 })).toBe("live");
  });
});
