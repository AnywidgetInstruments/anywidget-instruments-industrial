// One documentation page per widget, with its picture in the light and the
// dark theme (DOC-008).
//
// The pictures are captures of the real widgets, drawn by the preview page
// (js/preview/index.html) with the built front end; the pages are written
// from the trait contract (static/contract.json and the schemas), so that the
// site shows the current look and the current traits.
//
//   npm run build
//   node js/scripts/widget-pages.mjs
//
// Writes docs/img/widgets/<page>-{light,dark}.png, docs/widgets/<page>.md,
// the widget pages of the nav in mkdocs.yml and the links of the "At a
// glance" table of docs/widgets.md (the families come from that table).
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const STATIC = join(ROOT, "src/anywidget_instruments/static");
const SCHEMAS = join(ROOT, "src/anywidget_instruments/schema");
const PAGES = join(ROOT, "docs/widgets");
const IMAGES = join(ROOT, "docs/img/widgets");
const CATALOG = join(ROOT, "docs/widgets.md");
const MKDOCS = join(ROOT, "mkdocs.yml");

if (!existsSync(join(STATIC, "contract.json"))) {
  console.error("Missing static/contract.json: run `npm run build` first.");
  process.exit(1);
}
const contract = JSON.parse(readFileSync(join(STATIC, "contract.json"), "utf8"));
const widgets = Object.values(contract.widgets).filter((w) => !w.abstract);

/** Page name of a class: Gauge -> gauge, PIDFaceplate -> pid-faceplate. */
export const pageName = (cls) =>
  cls.replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

// Families: the rows of the "At a glance" table of the catalog.
const catalog = readFileSync(CATALOG, "utf8");
const glance = catalog.slice(catalog.indexOf("## At a glance"), catalog.indexOf("\n## ", catalog.indexOf("## At a glance") + 1));
const families = [];
for (const row of glance.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Group"))) {
  const [group, cells] = row.split("|").slice(1, 3).map((c) => c.trim());
  const members = [...cells.matchAll(/`([A-Za-z]+)`/g)].map((m) => m[1]).filter((c) => contract.widgets[c]);
  if (members.length) families.push({ group, members });
}
const familyOf = Object.fromEntries(families.flatMap((f) => f.members.map((c) => [c, f.group])));
const orphans = widgets.filter((w) => !familyOf[w.class]).map((w) => w.class);
if (orphans.length) {
  console.error(`Not in the "At a glance" table of docs/widgets.md: ${orphans.join(", ")}`);
  process.exit(1);
}

// Pictures ------------------------------------------------------------------

// Widgets the preview page does not show, drawn here for their picture.
const EXTRA = {
  picture: {
    spec: { _kind: "picture", mode: "indicator", label: "PictureControl", background: "", size: [320, 200] },
    // A small scene with the drawing commands; "currentColor" follows the theme.
    draw: [
      { op: "rect", x: 20, y: 20, w: 280, h: 150, stroke: "currentColor", fill: null, width: 1 },
      { op: "polygon", points: [[40, 150], [110, 70], [160, 120], [200, 90], [280, 150]], closed: true, stroke: null, fill: "#60a5fa" },
      { op: "arc", cx: 240, cy: 55, r: 18, start: 0, end: 360, stroke: null, fill: "#f59e0b" },
      { op: "line", x0: 160, y0: 30, x1: 160, y1: 160, stroke: "#ef4444", width: 1 },
      { op: "line", x0: 30, y0: 95, x1: 290, y1: 95, stroke: "#ef4444", width: 1 },
      { op: "text", x: 166, y: 44, text: "ROI 1", size: 12, anchor: "start", stroke: null, fill: "currentColor" },
    ],
  },
};

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".map": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

function serve() {
  const server = createServer((req, res) => {
    const path = join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!path.startsWith(ROOT) || !existsSync(path)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" });
    res.end(readFileSync(path));
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

/** Captures every widget in one theme; returns {kind: {spec, width}}. */
async function capture(browser, port, scheme) {
  // Reduced motion: blinking and flowing widgets are captured in a steady state.
  const page = await browser.newPage({
    viewport: { width: 1300, height: 900 },
    colorScheme: scheme,
    reducedMotion: "reduce",
    deviceScaleFactor: 2,
  });
  // "system": the widgets follow the page, which the preview marks as dark with ?dark.
  const query = `visual&style=modern&theme=system${scheme === "dark" ? "&dark" : ""}`;
  await page.goto(`http://127.0.0.1:${port}/js/preview/index.html?${query}`);
  await page.waitForFunction(() => Array.isArray(window.specs));
  // Transparent pictures: they sit on the light or the dark page of the site.
  await page.addStyleTag({ content: "body, body.dark { background: transparent !important; }" });
  await page.evaluate(async ({ extra }) => {
    const { default: widget } = await import("/src/anywidget_instruments/static/index.js");
    const grid = document.getElementById("grid");
    for (const { spec, draw } of Object.values(extra)) {
      const handlers = {};
      const state = { style: "modern", theme: "system", disabled: false, visible: true, tooltip: "", skin: {}, ...spec };
      const model = {
        get: (k) => state[k],
        set: (k, v) => { state[k] = v; },
        save_changes: () => {},
        on: (e, cb) => (handlers[e] ||= []).push(cb),
        off: () => {},
        send: () => {},
      };
      const el = document.createElement("div");
      grid.appendChild(el);
      window.specs.push(state);
      widget.render({ model, el });
      // render() may subscribe after an await: send the drawing once it listens.
      await new Promise((ok) => setTimeout(ok, 100));
      if (draw) (handlers["msg:custom"] || []).forEach((h) => h({ type: "draw", clear: true, commands: draw }, []));
    }
  }, { extra: EXTRA });
  await page.evaluate(() => document.fonts.ready);
  const specs = await page.evaluate(() => window.specs);
  const out = {};
  mkdirSync(IMAGES, { recursive: true });
  for (const w of widgets) {
    const index = specs.findIndex((s) => s._kind === w.kind);
    if (index < 0) throw new Error(`${w.class}: not on the preview page`);
    const el = page.locator("#grid > div").nth(index);
    // Off-screen widgets skip drawing: bring each one into view first.
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await el.screenshot({ path: join(IMAGES, `${pageName(w.class)}-${scheme}.png`), omitBackground: true });
    const box = await el.boundingBox();
    out[w.kind] = { spec: specs[index], width: Math.round(box.width) };
  }
  await page.close();
  return out;
}

// Pages ---------------------------------------------------------------------

const WIDTH = 88;

/**
 * A JSON value as a Python literal, wrapped like black within WIDTH columns:
 * `indent` is the indentation of the line where the value starts, `lead` the
 * number of characters before it on that line after the indentation.
 */
function py(v, indent = 0, lead = 0) {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  const fits = (text) => !text.includes("\n") && indent + lead + text.length + 1 <= WIDTH;
  const pad = " ".repeat(indent + 4);
  const end = " ".repeat(indent);
  if (typeof v === "string") {
    const flat = JSON.stringify(v);
    if (fits(flat)) return flat;
    // Adjacent string literals, cut after a space or a closing bracket.
    const room = WIDTH - indent - 8;
    const parts = [];
    let rest = v;
    while (rest.length) {
      let cut = rest.length <= room ? rest.length : Math.max(rest.lastIndexOf(" ", room), rest.lastIndexOf(">", room)) + 1;
      if (cut <= 0) cut = room;
      parts.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    return `(\n${parts.map((x) => pad + JSON.stringify(x)).join("\n")}\n${end})`;
  }
  const array = Array.isArray(v);
  const [open, close] = array ? ["[", "]"] : ["{", "}"];
  const flat = array
    ? `[${v.map((x) => py(x, 0, 0)).join(", ")}]`
    : `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${py(x, 0, 0)}`).join(", ")}}`;
  if (fits(flat)) return flat;
  if (array && v.every((x) => typeof x === "number")) {
    // Numbers: as many per line as fit.
    const lines = [];
    let line = "";
    for (const x of v.map((n) => py(n))) {
      if (line && pad.length + line.length + x.length + 1 > WIDTH) {
        lines.push(line.trimEnd());
        line = "";
      }
      line += `${x}, `;
    }
    lines.push(line.trimEnd());
    return `${open}\n${lines.map((l) => pad + l).join("\n")}\n${end}${close}`;
  }
  const items = array
    ? v.map((x) => py(x, indent + 4, 0))
    : Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${py(x, indent + 4, JSON.stringify(k).length + 2)}`);
  return `${open}\n${items.map((x) => `${pad}${x},`).join("\n")}\n${end}${close}`;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Traits of the preview model that only set up the picture.
const PICTURE_ONLY = new Set(["style", "theme", "skin", "update_rate", "animate", "animation_ms"]);

/** The keyword arguments that set the traits of the picture, value and label first. */
function kwargs(w, spec, skip = []) {
  const first = ["value", "label"].filter((n) => n in spec);
  const names = [...first, ...Object.keys(spec).filter((n) => !first.includes(n))];
  const out = [];
  for (const name of names) {
    const trait = w.traits[name];
    const value = spec[name];
    if (!trait || name.startsWith("_") || PICTURE_ONLY.has(name) || skip.includes(name)) continue;
    if ((trait.writer !== "host" && trait.writer !== "both") || trait.readOnly) continue;
    if (same(value, trait.default)) continue;
    if (value === null && !trait.nullable) continue;
    out.push([name, name === "size" && Array.isArray(value) ? `(${value.join(", ")})` : null, value]);
  }
  return out;
}

function call(head, args) {
  const one = `${head}(${args.map(([n, lit, v]) => `${n}=${lit ?? py(v)}`).join(", ")})`;
  if (one.length <= WIDTH && !one.includes("\n")) return one;
  return `${head}(\n${args.map(([n, lit, v]) => `    ${n}=${lit ?? py(v, 4, n.length + 1)},`).join("\n")}\n)`;
}

// Data computed or taken from a template: the expression rather than its numbers.
const EXAMPLES = {
  PolarPlot: (w, spec) => [
    "theta = np.arange(0, 361, 5)",
    "r = np.abs(np.cos(np.radians(theta))) ** 3",
    call("ai.PolarPlot", [
      ["value", '[{"name": "pattern", "r": r.tolist(), "theta": theta.tolist()}]'],
      ...kwargs(w, spec, ["value"]),
    ]),
  ].join("\n"),
  SmithChart: (w, spec) => [
    "k = np.arange(12) / 3",
    "gamma = 0.6 * np.exp(1j * k)  # reflection coefficients",
    "re, im = gamma.real.tolist(), gamma.imag.tolist()",
    call("ai.SmithChart", [
      ["value", '[{"name": "sweep", "style": "both", "re": re, "im": im}]'],
      ...kwargs(w, spec, ["value"]),
    ]),
  ].join("\n"),
  SvgPanel: (w, spec) => call('ai.SvgPanel.template', [["name", '"voltmeter"'], ...kwargs(w, spec, ["svg"])]).replace("name=", ""),
};

/** The Python code that sets the traits of the picture. */
function example(w, spec) {
  return EXAMPLES[w.class]?.(w, spec) ?? call(`ai.${w.class}`, kwargs(w, spec));
}

// Data drawn from messages (samples, history): the example sets the traits only.
const MESSAGE_DATA = new Set(["intensitychart", "digitalgraph", "mixedgraph", "sparkline", "kpitile", "trendchart", "xygraph", "waveformchart", "picture"]);

const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");

function typeOf(t) {
  let s = t.type;
  if (t.type === "enum" || t.type === "const") s = t.values.map((v) => `\`${JSON.stringify(v)}\``).join(", ");
  else if (t.type === "array" && t.items?.type) s = `array of ${t.items.type}`;
  return t.nullable ? `${s} or null` : s;
}

function defaultOf(t) {
  const s = JSON.stringify(t.default);
  if (s === undefined) return "";
  return s.length > 40 ? "…" : `\`${s}\``;
}

const WRITERS = { host: "host", front: "widget", both: "host, widget", derived: "derived" };

function table(w, names) {
  const rows = names.map((n) => {
    const t = w.traits[n];
    return `| \`${n}\` | ${cell(typeOf(t))} | ${defaultOf(t)} | ${WRITERS[t.writer] ?? t.writer} | ${cell(t.description ?? "")} |`;
  });
  return ["| Trait | Type | Default | Set by | Description |", "|---|---|---|---|---|", ...rows].join("\n");
}

// DOC-007: the page of a safety-related widget warns before anything else.
const NOT_SAFETY_SYSTEM =
  "It is for visualization, teaching, simulation and supervision; it is not a safety-related system and must not perform a safety function.";
const SAFETY = {
  EmergencyStop: [
    "Not an emergency stop device",
    "This widget draws an emergency stop button on a screen; it is not an emergency stop device. A real emergency stop is a hardwired device that stops the machine through a safety-rated circuit, independently of any software. Use the widget to represent or simulate an emergency stop, never as the means of stopping a machine.",
  ],
  AlarmIndicator: ["Not a safety-related system", `The alarm shown here may be delayed, lost or stale. ${NOT_SAFETY_SYSTEM}`],
  AlarmBanner: ["Not a safety-related system", `The alarms shown here may be delayed, lost or stale. ${NOT_SAFETY_SYSTEM}`],
  AlarmList: ["Not a safety-related system", `The alarms shown here may be delayed, lost or stale. ${NOT_SAFETY_SYSTEM}`],
  Annunciator: ["Not a safety-related system", `The alarms shown here may be delayed, lost or stale. ${NOT_SAFETY_SYSTEM}`],
  PIDFaceplate: ["Not a safety-related system", `A controller in a notebook runs with no timing guarantee. ${NOT_SAFETY_SYSTEM}`],
  StateMachine: ["Not a safety-related system", `A state model in a notebook runs with no timing guarantee. ${NOT_SAFETY_SYSTEM}`],
};

function safetyNotice(cls) {
  const notice = SAFETY[cls];
  if (!notice) return [];
  const [title, text] = notice;
  return [`!!! danger "${title}"`, `    ${text} See the [safety notice](../safety.md).`, ""];
}

function page(w, shot) {
  const schema = JSON.parse(readFileSync(join(SCHEMAS, w.schema.replace(/^schema\//, "")), "utf8"));
  const own = Object.keys(schema.properties ?? {}).filter((n) => !n.startsWith("_") && w.traits[n]);
  const inherited = Object.keys(w.traits).filter((n) => !n.startsWith("_") && !own.includes(n));
  const name = pageName(w.class);
  const width = `{ width="${shot.width}" }`;
  const family = familyOf[w.class];
  const lines = [
    `# ${w.class}`,
    "",
    "<!-- Generated by js/scripts/widget-pages.mjs from the trait contract: edit the schema",
    "     or the script, then run it again. -->",
    "",
    schema.description ?? "",
    "",
    ...safetyNotice(w.class),
    `![${w.class}, light theme](../img/widgets/${name}-light.png#only-light)${width}`,
    `![${w.class}, dark theme](../img/widgets/${name}-dark.png#only-dark)${width}`,
    "",
    `**${family}** · [Widget catalog](../widgets.md) · [API reference](../api.md#anywidget_instruments.${w.class}) ·`,
    `schema [\`${w.schema.replace(/^schema\//, "")}\`](../trait-contract.md)`,
    "",
    "## Example",
    "",
  ];
  lines.push("The traits of the picture above:", "", "```python", example(w, shot.spec), "```", "");
  if (MESSAGE_DATA.has(w.kind)) {
    lines.push(
      "The data of the picture (samples, history or drawing) is sent with the widget's methods,",
      "not as traits: see the [widget catalog](../widgets.md).",
      "",
    );
  }
  lines.push("## Traits", "");
  lines.push(own.length ? table(w, own) : `\`${w.class}\` adds no trait of its own.`, "");
  if (inherited.length) {
    lines.push(
      `<details markdown>`,
      `<summary>Common traits (${inherited.length}), shared with other widgets</summary>`,
      "",
      table(w, inherited),
      "",
      "</details>",
      "",
    );
  }
  lines.push(
    "*Set by*: `host`, the program (Python, Julia, ...); `widget`, the user through the widget;",
    "`derived`, computed from other traits by the host that owns the state, or by the widget.",
    "See the [trait contract](../trait-contract.md).",
    "",
  );
  return lines.join("\n");
}

// Run -------------------------------------------------------------------------

const server = await serve();
const browser = await chromium.launch();
let shots;
try {
  const { port } = server.address();
  shots = await capture(browser, port, "light");
  await capture(browser, port, "dark");
} finally {
  await browser.close();
  server.close();
}

mkdirSync(PAGES, { recursive: true });
for (const w of widgets) writeFileSync(join(PAGES, `${pageName(w.class)}.md`), page(w, shots[w.kind]));

// Nav: the widget pages by family, between the markers of mkdocs.yml.
const nav = families
  .map((f) => [`      - ${f.group}:`, ...f.members.map((c) => `          - ${c}: widgets/${pageName(c)}.md`)].join("\n"))
  .join("\n");
const yml = readFileSync(MKDOCS, "utf8");
const begin = "      # BEGIN widget pages (js/scripts/widget-pages.mjs)\n";
const end = "      # END widget pages\n";
if (!yml.includes(begin) || !yml.includes(end)) {
  console.error("mkdocs.yml: widget page markers not found");
  process.exit(1);
}
writeFileSync(MKDOCS, yml.slice(0, yml.indexOf(begin) + begin.length) + nav + "\n" + yml.slice(yml.indexOf(end)));

// Catalog: link the widget names of the "At a glance" table to their page.
const linked = glance.replace(/(?<!\[)`([A-Za-z]+)`(?!\])/g, (m, c) =>
  contract.widgets[c] && !contract.widgets[c].abstract ? `[\`${c}\`](widgets/${pageName(c)}.md)` : m,
);
writeFileSync(CATALOG, catalog.replace(glance, linked));

console.log(`${widgets.length} widget pages and pictures written.`);
