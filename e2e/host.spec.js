// Widgets hosted without a Python kernel (HOST-001 .. HOST-004): a plain
// dictionary of traits built from the class defaults, as KaimonSlate.jl's
// SlateAFM does, in a real browser with the built bundle.
import { expect, test } from "@playwright/test";

const URL = "http://127.0.0.1:8766/e2e/host/index.html";
const widget = (page, label) => page.locator(".awi-root").filter({ has: page.locator(":scope > .awi-label", { hasText: label }) });

test("a trait dictionary renders bounded values and alarms, without NO KERNEL", async ({ page }) => {
  await page.clock.install();
  await page.goto(URL);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  const knob = widget(page, "Hostless knob");
  const tank = widget(page, "Hostless tank");

  // bounded: value 150 with coerce is shown at max, the alarm computed by the front end
  await expect(knob.locator(":scope > .awi-body")).toHaveAttribute("aria-valuenow", "100");
  await expect(knob).toHaveClass(/awi-alarm-hi/);
  await expect(knob.locator(".awi-badge")).toHaveText("HI");
  expect(await page.evaluate(() => window.models.knob.get("alarm_level"))).toBe("hi");
  await expect(tank).toHaveClass(/awi-indicator/);
  await expect(tank).toHaveClass(/awi-alarm-hi/);

  // a value pushed by the host: hysteresis applied by the front end
  await page.evaluate(() => window.models.knob.push("value", 87));
  await page.clock.runFor(100);
  await expect(knob).toHaveClass(/awi-alarm-hi/);
  await page.evaluate(() => window.models.knob.push("value", 80));
  await page.clock.runFor(100);
  await expect(knob).not.toHaveClass(/awi-alarm-hi/);
  expect(await page.evaluate(() => window.models.knob.saved.at(-1).alarm_level)).toBe("normal");

  // no heartbeat announced: never stale, however long it runs
  await page.clock.runFor(60_000);
  await expect(knob).not.toHaveClass(/awi-stale/);
  await expect(knob.locator(".awi-stale-badge")).toBeHidden();
  await expect(tank.locator(".awi-stale-badge")).toBeHidden();
});

test("the Julia batch reactor: host writes and messages, operator actions in the trait dictionaries", async ({ page }) => {
  await page.goto("http://127.0.0.1:8766/e2e/host/reactor.html");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  // off-screen widgets skip drawing: scroll each into view before checking it
  const seen = async (label) => {
    const w = widget(page, label);
    await w.scrollIntoViewIfNeeded();
    return w;
  };
  const traits = (id) => page.evaluate((id) => structuredClone(window.models[id].traits), id);
  const setw = (id, kw) => page.evaluate(([id, kw]) => window.models[id].setw(kw), [id, kw]);
  // complete!() of the notebook: follow the SC transition of the widget's own table
  const complete = () => page.evaluate(() => {
    const m = window.models.machine;
    const tr = m.traits.machine.transitions.find(([from, cmd]) => from === m.traits.value && cmd === "SC");
    m.setw({ value: tr[2], last_command: "SC" });
  });

  // state machine: operator commands applied by the front end, SC by the host
  const machine = await seen("R-101 state (PackML)");
  await expect(machine.locator(".awi-sm-label-current")).toHaveText("▶ Stopped");
  expect((await traits("machine")).value).toBe("Stopped");
  await machine.getByRole("button", { name: "Reset", exact: true }).click();
  expect((await traits("machine")).value).toBe("Resetting");
  await complete();
  await expect(machine.locator(".awi-sm-label-current")).toHaveText("▶ Idle");
  await machine.getByRole("button", { name: "Start", exact: true }).click();
  expect((await traits("machine")).value).toBe("Starting");

  // process values and indicators written by the host
  await setw("level", { value: 2.5 });
  await setw("tic", { pv: 64.2, op: 38.5 });
  await setw("agitator", { value: "fault" });
  await setw("light", { value: ["blink", "off", "on"] });
  await setw("plant", { nodes: await page.evaluate(() => window.plantNodes({ agit: "fault" })) });
  await expect((await seen("LT-101 level")).locator(":scope > .awi-body")).toHaveAttribute("aria-valuenow", "2.5");
  await expect((await seen("Jacket temperature")).locator(".awi-pid-pv .awi-pid-val")).toHaveText("64.2 °C");
  await expect(await seen("Agitator")).toContainText("FAULT");
  await expect((await seen("Plant model")).getByRole("treeitem", { name: "Agitator (M-101), fault" })).toBeVisible();

  // trend and KPI tile: append messages with float64 times and float32 values
  await page.evaluate(() => {
    const f8 = (x) => new Float64Array([x]).buffer;
    const f4 = (x) => new Float32Array([x]).buffer;
    const now = Date.now() / 1000;
    window.models.trend.emit({ type: "append", pens: [[0, 1, 1], [1, 1, 1], [2, 1, 1]] }, [f8(now), f4(2.5), f8(now), f4(64.2), f8(now), f4(38.5)]);
    window.models.trend.setw({ value: { Level: 2.5, Temperature: 64.2, Heater: 38.5 } });
    window.models.batches.setw({ value: 1 });
    window.models.batches.emit({ type: "append", n: 1 }, [f4(1)]);
  });
  await expect((await seen("Trend")).locator(".awi-legend")).toContainText("64.2");
  await expect(await seen("Batches today")).toContainText("1 batches");

  // alarm and event rows written by the host; ACK applied by the front end
  await setw("alarms", { value: [{ id: "M-101.TRIP", timestamp: "2026-09-25T05:12:07", source: "M-101", priority: "high", message: "Agitator M-101 overload trip", state: "active_unacknowledged", shelved_until: null, suppressed: false, out_of_service: false }] });
  await setw("events", { value: [{ id: 1, time: Date.now() / 1000, source: "M-101.TRIP", category: "alarm", message: "Agitator M-101 overload trip" }] });
  const alarms = await seen("Alarms");
  await expect(alarms).toContainText("Agitator M-101 overload trip");
  await alarms.getByRole("button", { name: "Acknowledge M-101.TRIP" }).click();
  expect((await traits("alarms")).value[0].state).toBe("active_acknowledged");
  await expect(await seen("Event log")).toContainText("Agitator M-101 overload trip");

  // operator inputs the notebook reads: trip button, setpoint, recipe cell
  await (await seen("Simulate a fault")).locator(":scope > .awi-body").click();
  expect((await traits("trip")).value).toBe(true);
  const sp = (await seen("Jacket temperature")).getByRole("spinbutton", { name: "New SP" });
  await sp.fill("75");
  await (await seen("Jacket temperature")).getByRole("button", { name: "Set SP" }).click();
  expect((await traits("tic")).sp).toBe(75);
  const cell = (await seen("Recipe PR-12 (edit while Idle)")).getByRole("textbox", { name: "Row 3, Hold" });
  await cell.fill("90");
  await cell.press("Enter");
  expect((await traits("recipe")).value[2].hold).toBe(90);
});
