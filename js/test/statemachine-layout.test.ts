// StateMachine drawing cost (IND-067, PERF-002): the routed geometry depends
// on the model and the size only, so a state change must not route again.
import { expect, test } from "vitest";
import { CONTRACTS } from "../src/generated/contract.js";
import { pathCost, routePoints } from "../src/widgets/smlayout.js";
import { StateMachineView } from "../src/widgets/statemachine.js";

function view(machine: unknown, size: [number, number]) {
  const st: Record<string, unknown> = Object.fromEntries(Object.entries(CONTRACTS.StateMachine.traits).map(([k, s]) => [k, s.default]));
  Object.assign(st, { machine, size, _session: "kernel" });
  const model = { get: (k: string) => st[k], set: (k: string, v: unknown) => void (st[k] = v), save_changes() {}, on() {}, off() {}, send() {} };
  const el = document.createElement("div");
  document.body.appendChild(el);
  return { st, v: new StateMachineView(model as never, el) };
}

test("a state change reuses the routed geometry; a new size routes again", () => {
  const gemma = CONTRACTS.StateMachine.traits.machine.presets?.gemma;
  const { st, v } = view(gemma, [760, 400]);
  v.draw();
  const first = (v as unknown as { _layout: object })._layout;
  expect(first).toBeTruthy();
  for (const s of ["F1", "A2", "D1"]) {
    st.value = s;
    v.draw();
    expect((v as unknown as { _layout: object })._layout).toBe(first);
  }
  st.size = [800, 420];
  v.draw();
  expect((v as unknown as { _layout: object })._layout).not.toBe(first);
});

test("the router's early stop does not change the cheapest path", () => {
  const box = (cx: number, cy: number) => ({ cx, cy, w: 60, h: 24 });
  const a = box(50, 50);
  const b = box(350, 150);
  const others = [box(200, 50), box(200, 150), box(50, 150)];
  const ctx = { boxes: [a, b, ...others], used: [], rowGaps: [3, 100, 197], colGaps: [3, 125, 275, 397] };
  const pts = routePoints(a, b, null, ctx);
  const cost = pathCost(pts, a, b, ctx);
  expect(cost).toBeLessThan(1000); // crosses no state
  // with a limit, counting stops at the limit: never below the true cost
  expect(pathCost(pts, a, b, ctx, cost / 2)).toBeGreaterThanOrEqual(cost / 2);
});
