// Event log (IND-090..093): newest first, filter by category and text, CSV.
import { clear, html } from "anywidget-instruments/js/src/core/dom.js";
import type { AnyModel } from "anywidget-instruments/js/src/core/model.js";
import { download } from "../core/plot.js";
import { BaseView } from "anywidget-instruments/js/src/core/view.js";
import type { EventLogTraits } from "../generated/contract.js";

export type LogEvent = EventLogTraits["value"][number];

export const CATEGORIES: Record<string, string> = { all: "All categories", operator: "Operator", state: "State", alarm: "Alarm", system: "System" };
const pad = (n: number): string => String(n).padStart(2, "0");

/** Local "YYYY-MM-DD HH:MM:SS" of Unix seconds. */
export function eventTime(t: unknown): string {
  const d = new Date(Number(t) * 1000);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Events to show: filtered by category and text, newest first (IND-092). */
export function filterEvents(events: readonly LogEvent[], { category = "all", text = "" }: { category?: string; text?: string } = {}): LogEvent[] {
  const needle = text.trim().toLowerCase();
  return events
    .filter((e) => (category === "all" || e.category === category) && (!needle || `${e.source} ${e.message}`.toLowerCase().includes(needle)))
    .slice()
    .sort((a, b) => Number(b.time) - Number(a.time) || Number(b.id) - Number(a.id));
}

/** CSV text of events (oldest first), with a header row. */
export function eventsCsv(events: readonly LogEvent[]): string {
  const esc = (v: unknown): string => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows: unknown[][] = [["time", "category", "source", "message"]];
  for (const e of [...events].reverse()) rows.push([new Date(Number(e.time) * 1000).toISOString(), e.category, e.source, e.message]);
  return rows.map((r) => r.map(esc).join(",")).join("\n");
}

export class EventLogView extends BaseView<EventLogTraits> {
  filters: { category: string; text: string };
  shown: LogEvent[] = [];
  readonly catSel: HTMLSelectElement;
  readonly search: HTMLInputElement;
  readonly counts: HTMLDivElement;
  readonly table: HTMLTableElement;
  readonly tbody: HTMLTableSectionElement;

  constructor(model: AnyModel<EventLogTraits>, el: HTMLElement) {
    super(model, el, ["value", "max_events"]);
    this.filters = { category: "all", text: "" };
    const b = this.body;
    b.setAttribute("role", "region");
    this.catSel = html("select", { attrs: { "aria-label": "Category", "data-lm-suppress-shortcuts": "true" } }, Object.entries(CATEGORIES).map(([v, t]) => html("option", { text: t, attrs: { value: v } })));
    this.catSel.addEventListener("change", () => {
      this.filters.category = this.catSel.value;
      this.schedule();
    });
    this.search = html("input", { cls: "awi-al-search", attrs: { type: "search", placeholder: "Filter…", "aria-label": "Filter text", "data-lm-suppress-shortcuts": "true" } });
    this.search.addEventListener("input", () => {
      this.filters.text = this.search.value;
      this.schedule();
    });
    const csv = html("button", { cls: "awi-al-sort", text: "CSV", attrs: { type: "button", title: "Download the shown events as CSV", "aria-label": "Download the shown events as CSV" } });
    csv.addEventListener("click", () => download(new Blob([eventsCsv(this.shown || [])], { type: "text/csv" }), `${this.get("label") || "events"}.csv`));
    this.counts = html("div", { cls: "awi-al-counts", attrs: { role: "status" } });
    this.table = html("table", { cls: "awi-banner-table awi-ev-table" });
    const head = html("tr", {}, ["Time", "Category", "Source", "Message"].map((t) => html("th", { text: t, attrs: { scope: "col" } })));
    this.tbody = html("tbody");
    this.table.append(html("thead", {}, [head]), this.tbody);
    b.append(html("div", { cls: "awi-al-tools" }, [this.catSel, this.search, csv]), this.counts, html("div", { cls: "awi-banner-scroll" }, [this.table]));
    this.schedule();
  }

  override draw(): void {
    // at most the newest max_events, as the kernel keeps them
    const events = (this.get("value") || []).slice(-(Number(this.get("max_events")) || 1));
    const shown = (this.shown = filterEvents(events, this.filters));
    this.counts.textContent = `${shown.length} of ${events.length} events`;
    clear(this.tbody);
    for (const e of shown) {
      const cat = e.category && CATEGORIES[e.category] ? e.category : "system";
      const chip = html("span", { cls: `awi-ev-cat awi-ev-${cat}`, text: CATEGORIES[cat].toUpperCase() });
      this.tbody.appendChild(html("tr", { cls: `awi-ev-row-${cat}` }, [html("td", { text: eventTime(e.time) }), html("td", {}, [chip]), html("td", { text: e.source || "" }), html("td", { text: e.message || "" })]));
    }
    const latest = events.length ? events[events.length - 1] : null;
    this.body.setAttribute("aria-label", `${this.get("label") || "Event log"}: ${events.length} events${latest ? `, latest ${latest.message ?? ""}` : ""}`);
  }
}
