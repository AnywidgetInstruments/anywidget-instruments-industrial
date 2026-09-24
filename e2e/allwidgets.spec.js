// QA-003: kernel -> front end and front end -> kernel synchronization for
// every widget, in JupyterLab.
import { expect, test } from "@playwright/test";
import { kernelExec, runNotebook, widget } from "./helpers.js";

const NB = "allwidgets.ipynb";
const numericControls = ["Knob", "Dial", "FillSlide"];
const numericIndicators = ["Gauge", "Meter", "VUMeter", "Tank", "Thermometer", "SevenSegment", "Compass", "AnalogIndicator", "Transmitter"];
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

  test("PushButton lamp: kernel -> front (BOOL-015)", async () => {
    await widget(page, "PushButton").scrollIntoViewIfNeeded();
    await py(`W["PushButton"].lamp_color = "amber"; W["PushButton"].lamp = True`);
    await expect(widget(page, "PushButton").locator(".awi-button.awi-lit.awi-lamp-amber")).toHaveCount(1);
    await expect(body("PushButton")).toHaveAttribute("aria-description", "lamp on");
    await py(`W["PushButton"].lamp = None`);
    await expect(widget(page, "PushButton").locator(".awi-lit")).toHaveCount(0);
  });

  test("ThemeSwitch: both directions (STYLE-008)", async () => {
    const w = widget(page, "ThemeSwitch");
    await w.scrollIntoViewIfNeeded();
    try {
      await w.getByRole("radio", { name: "☾ Dark" }).click();
      await expect.poll(() => py(`print(W["ThemeSwitch"].value, W["Knob"].theme)`)).toBe("dark dark");
      await expect(widget(page, "Knob")).toHaveClass(/awi-theme-dark/);
      await py(`W["ThemeSwitch"].value = "light"`);
      await expect(w.getByRole("radio", { name: "☀ Light" })).toHaveAttribute("aria-checked", "true");
    } finally {
      await py(`W["ThemeSwitch"].value = "auto"`);
    }
    await expect(widget(page, "Knob")).not.toHaveClass(/awi-theme-(dark|light)/);
  });

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

  test("Transmitter: device status, kernel -> front (IND-081, IND-082)", async () => {
    const w = widget(page, "Transmitter");
    await w.scrollIntoViewIfNeeded();
    await py('W["Transmitter"].status = "failure"');
    await expect(w.locator(".awi-value")).toHaveText("✕ BAD");
    await expect(w.locator(".awi-tx-status")).toHaveText("✕ FAILURE");
    await py('W["Transmitter"].status = "ok"');
    await expect(w.locator(".awi-tx-status")).toHaveText("OK");
  });

  test("EventLog: kernel -> front, filter in the front end (IND-091, IND-092)", async () => {
    const w = widget(page, "EventLog");
    await w.scrollIntoViewIfNeeded();
    await py('W["EventLog"].log("Pump started", source="P-101", category="state"); W["EventLog"].log("Level high", source="LT-101", category="alarm")');
    await expect(w.locator("tbody tr")).toHaveCount(2);
    await expect(w.locator("tbody tr").first()).toContainText("Level high");
    await w.getByRole("combobox", { name: "Category" }).selectOption("state");
    await expect(w.locator("tbody tr")).toHaveCount(1);
    await expect(w.locator("tbody tr")).toContainText("Pump started");
  });

  test("TrendChart: both directions (IND-071, IND-072)", async () => {
    const w = widget(page, "TrendChart");
    await w.scrollIntoViewIfNeeded();
    await py('W["TrendChart"].add("LT", [1.0, 2.5], time=[1767254400.0, 1767254405.0])');
    await expect(w.locator(":scope > .awi-body")).toHaveAttribute("aria-label", "TrendChart: LT 2.5 m");
    await w.getByRole("combobox", { name: "Time span" }).selectOption("3600");
    await expect.poll(() => py('print(W["TrendChart"].span)')).toBe("3600.0");
    await w.getByRole("button", { name: "Earlier" }).click();
    await expect(w.locator(":scope > .awi-body")).toHaveAttribute("aria-label", /\(history\)/);
    await w.getByRole("button", { name: "Follow the latest data" }).click();
    await expect(w.locator(":scope > .awi-body")).not.toHaveAttribute("aria-label", /history/);
  });

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

  // API-014: every control can also be set by a form entry
  test("numeric entry: typed value reaches the kernel, out of range is rejected", async () => {
    await widget(page, "Knob").scrollIntoViewIfNeeded();
    await py('W["Knob"].mode = "control"; W["Knob"].value = 10; W["Knob"].step = 1')
    const field = widget(page, "Knob").getByRole("textbox", { name: /Knob value/ });
    await field.fill("37");
    await field.press("Enter");
    await expect.poll(() => py('print(W["Knob"].value)')).toBe("37.0");
    await field.fill("250");
    await field.press("Enter");
    await expect(widget(page, "Knob").locator(".awi-entry-msg")).toContainText("Out of range");
    await expect.poll(() => py('print(W["Knob"].value)')).toBe("37.0");
  });

  test("SelectorSwitch: position list", async () => {
    await widget(page, "SelectorSwitch").scrollIntoViewIfNeeded();
    await widget(page, "SelectorSwitch").getByRole("combobox").selectOption("HAND");
    await expect.poll(() => py('print(W["SelectorSwitch"].value)')).toBe("HAND");
  });

  test("PIDFaceplate: drag the setpoint marker", async () => {
    const w = widget(page, "PIDFaceplate");
    await w.scrollIntoViewIfNeeded();
    await py('W["PIDFaceplate"].loop_mode = "AUTO"; W["PIDFaceplate"].sp = 40.0')
    const bars = w.locator(".awi-pid-bars");
    const box = await bars.boundingBox();
    // viewBox 240 x 116, scaled to fit ("meet"); the PV scale spans y = 102 (0) .. 8 (100)
    const k = Math.min(box.width / 240, box.height / 116);
    const top = box.y + (box.height - 116 * k) / 2;
    const yFor = (v) => top + (102 - (v / 100) * 94) * k;
    await page.mouse.move(box.x + (box.width - 240 * k) / 2 + 57 * k, yFor(40));
    await page.mouse.down();
    await page.mouse.move(box.x + (box.width - 240 * k) / 2 + 57 * k, yFor(70), { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => Number(await py('print(W["PIDFaceplate"].sp)'))).toBeGreaterThan(65);
  });

  test("Valve: position demand from the faceplate", async () => {
    await py('W["Valve"].position = 20.0; W["Valve"].auto = False')
    const w = widget(page, "Valve");
    await w.scrollIntoViewIfNeeded();
    await w.locator(":scope > .awi-body").click();
    const field = w.getByRole("textbox", { name: /Position demand/ });
    await field.fill("65");
    await field.press("Enter");
    await expect.poll(() => py('print(W["Valve"].position)')).toBe("65.0");
    await page.keyboard.press("Escape");
  });

  test("WaveformChart: typed cursor position", async () => {
    const w = widget(page, "WaveformChart");
    await w.scrollIntoViewIfNeeded();
    const field = w.getByRole("textbox", { name: /Position of cursor/ }).first();
    await field.fill("2");
    await field.press("Enter");
    await expect.poll(() => py('print(W["WaveformChart"].cursors[0]["x"])')).toBe("2.0");
  });

  test("WaveformChart: typed axis ranges reach the kernel (CHART-108)", async () => {
    const w = widget(page, "WaveformChart");
    await w.scrollIntoViewIfNeeded();
    await expect(w.locator(".awi-axes-panel")).toBeHidden(); // opens on demand only
    await w.getByRole("button", { name: "Set the axis ranges" }).click();
    await expect(w.locator(".awi-axes-panel")).toBeVisible();
    await w.getByRole("textbox", { name: "Y minimum" }).fill("-2");
    await w.getByRole("textbox", { name: "Y maximum" }).fill("8");
    await w.getByRole("button", { name: "Apply" }).click();
    await expect.poll(() => py('print(W["WaveformChart"].y_min, W["WaveformChart"].y_max, W["WaveformChart"].autoscale_y)')).toBe("-2.0 8.0 False");
  });

  test("PolarPlot: typed radial range (CHART-108)", async () => {
    const w = widget(page, "PolarPlot");
    await w.scrollIntoViewIfNeeded();
    const field = w.getByRole("textbox", { name: "Radial range maximum" });
    await field.fill("5");
    await field.press("Enter");
    await expect.poll(() => py('print(W["PolarPlot"].r_max)')).toBe("5.0");
  });
});
