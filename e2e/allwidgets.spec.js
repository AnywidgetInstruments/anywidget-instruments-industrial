// QA-003: kernel -> front end and front end -> kernel synchronization for
// every widget, in JupyterLab.
import { expect, test } from "@playwright/test";
import { kernelExec, runNotebook, widget } from "./helpers.js";

const NB = "allwidgets.ipynb";
const numericControls = ["Knob", "Dial", "FillSlide"];
const numericIndicators = ["Gauge", "Meter", "VUMeter", "Tank", "Thermometer", "SevenSegment", "Compass", "AnalogIndicator"];
const booleans = ["ToggleSwitch", "RockerSwitch", "SlideSwitch", "PushButton", "EmergencyStop"];

test.describe.configure({ mode: "serial" });

test.describe("every widget", () => {
  let page;
  const py = (code) => kernelExec(page, NB, code);
  const body = (name) => widget(page, name).locator(":scope > .awi-body");

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    await runNotebook(page, NB);
    await expect(widget(page, "Knob").locator(".awi-value")).toHaveText("10.0", { timeout: 60_000 });
  });

  test.afterAll(async () => page.close());

  for (const name of [...numericControls, ...numericIndicators]) {
    test(`${name}: both directions`, async () => {
      await widget(page, name).scrollIntoViewIfNeeded();
      await py(`W["${name}"].value = 42`);
      await expect(body(name)).toHaveAttribute("aria-valuenow", "42");
      // indicators become controls through the kernel, then the user acts
      await py(`W["${name}"].mode = "control"`);
      await body(name).focus();
      await page.keyboard.press("Home");
      await expect.poll(() => py(`print(W["${name}"].value == W["${name}"].min)`)).toBe("True");
    });
  }

  test("LED: kernel -> front", async () => {
    await widget(page, "LED").scrollIntoViewIfNeeded(); // off-screen widgets skip drawing (PERF-005)
    await py('W["LED"].value = True');
    await expect(widget(page, "LED")).toHaveClass(/awi-on/);
  });

  for (const name of booleans) {
    test(`${name}: both directions`, async () => {
      await widget(page, name).scrollIntoViewIfNeeded();
      if (name !== "EmergencyStop") {
        await py(`W["${name}"].value = True`);
        await expect(widget(page, name)).toHaveClass(/awi-on/);
        await py(`W["${name}"].value = False`);
        await expect(widget(page, name)).not.toHaveClass(/awi-on/);
      }
      await body(name).focus();
      await page.keyboard.down("Space");
      await page.keyboard.up("Space");
      await expect.poll(() => py(`print(W["${name}"].value)`)).toBe("True");
      await expect(widget(page, name)).toHaveClass(/awi-on/);
    });
  }

  test("AlarmIndicator: both directions", async () => {
    await py('W["AlarmIndicator"].activate("high level")');
    const w = widget(page, "AlarmIndicator");
    await w.scrollIntoViewIfNeeded();
    await expect(w).toHaveClass(/awi-state-active_unacknowledged/);
    await w.getByRole("button", { name: "ACK" }).click();
    await expect.poll(() => py('print(W["AlarmIndicator"].value)')).toBe("active_acknowledged");
  });

  test("AlarmBanner: both directions", async () => {
    await py('W["AlarmBanner"].raise_alarm("B1", "boom")');
    const w = widget(page, "AlarmBanner");
    await w.scrollIntoViewIfNeeded();
    await expect(w.locator("tbody tr")).toContainText("B1: boom");
    await w.getByRole("button", { name: "Acknowledge B1" }).click();
    await expect.poll(() => py('print(W["AlarmBanner"].state_of("B1"))')).toBe("active_acknowledged");
  });

  for (const [name, command, state] of [["Valve", "Open", "OPEN"], ["Pump", "Start", "RUNNING"], ["Motor", "Forward", "FWD"]]) {
    test(`${name}: both directions`, async () => {
      const w = widget(page, name);
      await w.scrollIntoViewIfNeeded();
      await py(`W["${name}"].value = "fault"`);
      await expect(w.locator(".awi-process-state")).toContainText("FAULT");
      await w.locator(":scope > .awi-body").click();
      await w.getByRole("dialog").getByRole("button", { name: command }).click();
      await expect(w.locator(".awi-process-state")).toContainText(state);
      await expect.poll(() => py(`print(W["${name}"].value != "fault")`)).toBe("True");
      await page.keyboard.press("Escape");
    });
  }

  test("Pipe: kernel -> front", async () => {
    await widget(page, "Pipe").scrollIntoViewIfNeeded();
    await py('W["Pipe"].value = True');
    await expect(widget(page, "Pipe").locator(".awi-pipe-fluid.awi-flowing")).toHaveCount(1);
  });

  for (const name of ["WaveformChart", "IntensityChart", "DigitalWaveformGraph", "MixedSignalGraph"]) {
    test(`${name}: data in, cursor out`, async () => {
      const w = widget(page, name);
      await w.scrollIntoViewIfNeeded();
      const feed = {
        WaveformChart: 'W["WaveformChart"].append(np.arange(5.0))',
        IntensityChart: 'W["IntensityChart"].append(np.ones((5, 8)))',
        DigitalWaveformGraph: 'W["DigitalWaveformGraph"].set_data([1, 2, 3], n_bits=2)',
        MixedSignalGraph: 'W["MixedSignalGraph"].set_analog(np.arange(4.0)); W["MixedSignalGraph"].set_data([1, 0, 1, 0], n_bits=1)',
      }[name];
      await py(feed);
      const expected = {
        WaveformChart: /latest 4\b/,
        IntensityChart: /5 rows/,
        DigitalWaveformGraph: /2 lines, 3 samples/,
        MixedSignalGraph: /1 lines, 4 samples/,
      }[name];
      await expect(w.locator(":scope > .awi-body")).toHaveAttribute("aria-label", expected);
      await w.getByRole("button", { name: "Add a cursor" }).click();
      await expect.poll(() => py(`print(len(W["${name}"].cursor_values))`)).toBe("1");
    });
  }

  for (const [name, code, expected] of [
    ["PolarPlot", 'W["PolarPlot"].plot([1, 2], [0, 90], name="p")', /1 data set \(p\)/],
    ["SmithChart", 'W["SmithChart"].plot([50, 100], name="z")', /1 data set \(z\)/],
    ["RadarChart", 'W["RadarChart"].plot([1, 2, 3], name="r")', /1 data set \(r\)/],
  ]) {
    test(`${name}: kernel -> front`, async () => {
      await widget(page, name).scrollIntoViewIfNeeded();
      await py(code);
      await expect(widget(page, name).locator(":scope > .awi-body")).toHaveAttribute("aria-label", expected);
    });
  }

  test("PictureControl: both directions", async () => {
    const w = widget(page, "PictureControl");
    await w.scrollIntoViewIfNeeded();
    await py('W["PictureControl"].rect(0, 0, 20, 20, stroke=None, fill="#00ff00"); W["PictureControl"].flush()');
    const canvas = w.locator("canvas");
    await expect
      .poll(() => canvas.evaluate((c) => Array.from(c.getContext("2d").getImageData(5 * devicePixelRatio, 5 * devicePixelRatio, 1, 1).data)))
      .toEqual([0, 255, 0, 255]);
    await canvas.click({ position: { x: 60, y: 30 } });
    await expect.poll(() => py('print(round(W["PictureControl"].value.get("x", -1)))')).toBe("60");
  });

  test("SynopticCanvas: kernel -> front", async () => {
    await widget(page, "SynopticCanvas").scrollIntoViewIfNeeded();
    await py('W["SynopticCanvas"].add(ai.LED(True, label="child led"), x=10, y=10)');
    await expect(widget(page, "child led")).toHaveClass(/awi-on/);
  });

  // industrial operator objects (IND-*)
  test("SelectorSwitch: both directions", async () => {
    await widget(page, "SelectorSwitch").scrollIntoViewIfNeeded();
    await py('W["SelectorSwitch"].value = "AUTO"');
    await expect(body("SelectorSwitch")).toHaveAttribute("aria-valuetext", "AUTO");
    await body("SelectorSwitch").focus();
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => py('print(W["SelectorSwitch"].value)')).toBe("OFF");
  });

  test("StackLight: kernel -> front", async () => {
    await widget(page, "StackLight").scrollIntoViewIfNeeded();
    await py('W["StackLight"].set("green", "blink")');
    await expect(body("StackLight")).toHaveAttribute("aria-label", /green blink/);
  });

  test("PIDFaceplate: both directions", async () => {
    const w = widget(page, "PIDFaceplate");
    await w.scrollIntoViewIfNeeded();
    await py('W["PIDFaceplate"].step(35.0, 1.0)');
    await expect(w.locator(".awi-pid-pv .awi-pid-val")).toHaveText("35.0");
    await w.getByRole("spinbutton", { name: "New SP" }).fill("45");
    await w.getByRole("button", { name: "Set SP" }).click();
    await expect.poll(() => py('print(W["PIDFaceplate"].sp)')).toBe("45.0");
    await w.getByRole("button", { name: "MAN", exact: true }).click();
    await expect.poll(() => py('print(W["PIDFaceplate"].loop_mode)')).toBe("MAN");
    await expect(w.getByRole("spinbutton", { name: "New OP" })).toBeVisible();
  });

  test("Annunciator: both directions", async () => {
    const w = widget(page, "Annunciator");
    await w.scrollIntoViewIfNeeded();
    await py('W["Annunciator"].set("XA-1")');
    await expect(w.locator(".awi-ann-status")).toHaveText("ALARM");
    await w.getByRole("button", { name: "ACK" }).click();
    await expect.poll(() => py('print(W["Annunciator"].state_of("XA-1"))')).toBe("acknowledged");
  });

  test("AlarmList: both directions", async () => {
    const w = widget(page, "AlarmList");
    await w.scrollIntoViewIfNeeded();
    await py('W["AlarmList"].raise_alarm("L1", "boom", "TI-1")');
    await expect(w.locator("tbody tr")).toContainText("boom");
    await w.getByRole("button", { name: "Acknowledge L1" }).click();
    await expect.poll(() => py('print(W["AlarmList"].state_of("L1"))')).toBe("active_acknowledged");
    await w.getByRole("combobox", { name: "Shelve L1" }).selectOption("300");
    await expect.poll(() => py('print(W["AlarmList"].is_shelved("L1"))')).toBe("True");
  });

  test("StateMachine: both directions", async () => {
    const w = widget(page, "StateMachine");
    await w.scrollIntoViewIfNeeded();
    await w.getByRole("button", { name: "Reset", exact: true }).click();
    await expect.poll(() => py('print(W["StateMachine"].value)')).toBe("Resetting");
    await py('W["StateMachine"].state_complete()');
    await expect(w.locator(".awi-sm-label-current")).toHaveText("▶ Idle");
    await expect(w.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
  });
});
