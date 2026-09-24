// EventLog front end (IND-090..093).
import { describe, expect, it } from "vitest";
import widget from "../src/index.js";
import { eventsCsv, filterEvents } from "../src/widgets/eventlog.js";
import { common, fakeModel } from "./helpers.js";

const tick = () => new Promise((r) => setTimeout(r, 30));
const EVENTS = [
  { id: 1, time: 1767254400, source: "P-101", category: "state", message: "Pump started" },
  { id: 2, time: 1767254460, source: "Setpoint", category: "operator", message: "value: 10 → 12" },
  { id: 3, time: 1767254520, source: "LT-101", category: "alarm", message: "Level high, \"HI\"" },
];

describe("EventLog", () => {
  it("filters by category and text, newest first (IND-092)", () => {
    expect(filterEvents(EVENTS).map((e) => e.id)).toEqual([3, 2, 1]);
    expect(filterEvents(EVENTS, { category: "operator" }).map((e) => e.id)).toEqual([2]);
    expect(filterEvents(EVENTS, { text: "pump" }).map((e) => e.id)).toEqual([1]);
  });

  it("exports CSV oldest first with quoting", () => {
    const csv = eventsCsv(filterEvents(EVENTS)).split("\n");
    expect(csv[0]).toBe("time,category,source,message");
    expect(csv[1]).toBe("2026-01-01T08:00:00.000Z,state,P-101,Pump started");
    expect(csv[3]).toBe('2026-01-01T08:02:00.000Z,alarm,LT-101,"Level high, ""HI"""');
  });

  it("shows the events as a table with category chips", async () => {
    const model = fakeModel({ ...common, label: "Journal", mode: "indicator", _kind: "eventlog", value: EVENTS, max_events: 500, size: [600, 200] });
    const el = document.createElement("div");
    widget.render({ model, el });
    await tick();
    const rows = [...el.querySelectorAll("tbody tr")];
    expect(rows.map((r) => r.children[1].textContent)).toEqual(["ALARM", "OPERATOR", "STATE"]);
    expect(el.querySelector(".awi-al-counts").textContent).toBe("3 of 3 events");
    const sel = el.querySelector('select[aria-label="Category"]');
    sel.value = "alarm";
    sel.dispatchEvent(new Event("change"));
    await tick();
    expect(el.querySelectorAll("tbody tr").length).toBe(1);
    expect(el.querySelector(".awi-body").getAttribute("aria-label")).toBe('Journal: 3 events, latest Level high, "HI"');
  });
});
