// Alarm summary (IND-050..053): sort and filter, acknowledge, shelve and
// unshelve; shelved, suppressed and out-of-service alarms shown apart.
import type { AlarmRow } from "../contract/alarms.js";
import { alarmAction } from "../contract/derived.js";
import { clear, html } from "../core/dom.js";
import type { AnyModel } from "../core/model.js";
import { BaseView } from "../core/view.js";
import type { AlarmListTraits } from "../generated/contract.js";

type Filters = { view: string; priority: string; text: string; sort: string };

const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const PRIORITY_TEXT: Record<string, string> = { critical: "P1", high: "P2", medium: "P3", low: "P4" };
const STATE_TEXT: Record<string, string> = { active_unacknowledged: "ACTIVE · UNACK", active_acknowledged: "ACTIVE · ACK", cleared_unacknowledged: "CLEARED · UNACK", normal: "NORMAL" };
export const VIEWS: Record<string, string> = { active: "Active", unack: "Unacknowledged", shelved: "Shelved", suppressed: "Suppressed / out of service", all: "All" };

/** Category of an alarm for the operator views (IND-051, IND-052). */
export function category(a: AlarmRow): string {
  if (a.out_of_service || a.suppressed) return "suppressed";
  if (a.shelved_until) return "shelved";
  return "active";
}

/** Filter and sort alarms for display (IND-050). */
export function filterAlarms(alarms: readonly AlarmRow[], { view = "active", priority = "all", text = "", sort = "priority" }: Partial<Filters> = {}): AlarmRow[] {
  const needle = text.trim().toLowerCase();
  const out = alarms.filter((a) => {
    const cat = category(a);
    if (view === "active" && (cat !== "active" || a.state === "normal")) return false;
    if (view === "unack" && (cat !== "active" || !String(a.state).includes("unacknowledged"))) return false;
    if (view === "shelved" && cat !== "shelved") return false;
    if (view === "suppressed" && cat !== "suppressed") return false;
    if (priority !== "all" && a.priority !== priority) return false;
    if (needle && !`${a.id} ${a.source} ${a.message}`.toLowerCase().includes(needle)) return false;
    return true;
  });
  const byTime = (a: AlarmRow, b: AlarmRow): number => String(b.timestamp).localeCompare(String(a.timestamp));
  const unack = (a: AlarmRow): number => (String(a.state).includes("unacknowledged") ? 0 : 1);
  return out.sort(sort === "time" ? byTime : (a, b) => unack(a) - unack(b) || (RANK[String(a.priority)] ?? 9) - (RANK[String(b.priority)] ?? 9) || byTime(a, b));
}

function formatDuration(s: number): string {
  return s >= 3600 ? `${+(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`;
}

export class AlarmListView extends BaseView<AlarmListTraits> {
  filters: Filters;
  readonly viewSel: HTMLSelectElement;
  readonly prioSel: HTMLSelectElement;
  readonly search: HTMLInputElement;
  readonly sortBtn: HTMLButtonElement;
  readonly counts: HTMLDivElement;
  readonly table: HTMLTableElement;
  readonly tbody: HTMLTableSectionElement;

  constructor(model: AnyModel<AlarmListTraits>, el: HTMLElement) {
    super(model, el, ["value", "shelve_durations"]);
    this.filters = { view: "active", priority: "all", text: "", sort: "priority" };
    const b = this.body;
    b.setAttribute("role", "region");
    const select = (label: string, options: Record<string, string>, key: keyof Filters): HTMLSelectElement => {
      const s = html("select", { attrs: { "aria-label": label, "data-lm-suppress-shortcuts": "true" } }, Object.entries(options).map(([v, t]) => html("option", { text: t, attrs: { value: v } })));
      s.value = this.filters[key];
      s.addEventListener("change", () => {
        this.filters[key] = s.value;
        this.schedule();
      });
      return s;
    };
    this.viewSel = select("View", VIEWS, "view");
    this.prioSel = select("Priority", { all: "All priorities", critical: "P1", high: "P2", medium: "P3", low: "P4" }, "priority");
    this.search = html("input", { cls: "awi-al-search", attrs: { type: "search", placeholder: "Filter…", "aria-label": "Filter text", "data-lm-suppress-shortcuts": "true" } });
    this.search.addEventListener("input", () => {
      this.filters.text = this.search.value;
      this.schedule();
    });
    this.sortBtn = html("button", { cls: "awi-al-sort", attrs: { type: "button" } });
    this.sortBtn.addEventListener("click", () => {
      this.filters.sort = this.filters.sort === "priority" ? "time" : "priority";
      this.schedule();
    });
    this.counts = html("div", { cls: "awi-al-counts", attrs: { role: "status" } });
    const tools = html("div", { cls: "awi-al-tools" }, [this.viewSel, this.prioSel, this.search, this.sortBtn]);
    this.table = html("table", { cls: "awi-banner-table awi-al-table" });
    const head = html("tr", {}, ["Time", "Prio", "Tag", "Message", "State", ""].map((t) => html("th", { text: t, attrs: { scope: "col" } })));
    this.tbody = html("tbody");
    this.table.append(html("thead", {}, [head]), this.tbody);
    b.append(tools, this.counts, html("div", { cls: "awi-banner-scroll" }, [this.table]));
    this.schedule();
  }

  /** Operator action: always sent to the host; applied by the front end when no host owns the state (HOST-004). */
  send(msg: { type: string; alarm_id?: string; seconds?: number }): void {
    if (!this.interactive) return;
    this.model.send(msg);
    alarmAction(this.model as unknown as AnyModel, msg);
  }

  actions(a: AlarmRow): HTMLTableCellElement {
    const cell = html("td", { cls: "awi-al-actions" });
    if (this.get("mode") !== "control") return cell;
    const cat = category(a);
    if (String(a.state).includes("unacknowledged") && cat !== "suppressed") {
      const ack = html("button", { cls: "awi-ack", text: "ACK", attrs: { type: "button", "aria-label": `Acknowledge ${a.id}` } });
      ack.addEventListener("click", () => this.send({ type: "ack", alarm_id: a.id }));
      cell.appendChild(ack);
    }
    if (cat === "shelved") {
      const un = html("button", { cls: "awi-ack", text: "UNSHELVE", attrs: { type: "button", "aria-label": `Unshelve ${a.id}` } });
      un.addEventListener("click", () => this.send({ type: "unshelve", alarm_id: a.id }));
      cell.appendChild(un);
    } else if (cat === "active" && a.state !== "normal") {
      const durations = this.get("shelve_durations") || [];
      const sel = html("select", { cls: "awi-al-shelve", attrs: { "aria-label": `Shelve ${a.id}`, "data-lm-suppress-shortcuts": "true" } }, [
        html("option", { text: "Shelve…", attrs: { value: "" } }),
        ...durations.map((s) => html("option", { text: formatDuration(s), attrs: { value: String(s) } })),
      ]);
      sel.addEventListener("change", () => {
        if (sel.value) this.send({ type: "shelve", alarm_id: a.id, seconds: Number(sel.value) });
      });
      cell.appendChild(sel);
    }
    return cell;
  }

  override draw(): void {
    const alarms = (this.get("value") || []) as AlarmRow[];
    const count = (pred: (a: AlarmRow) => boolean): number => alarms.filter(pred).length;
    const active = count((a) => category(a) === "active" && a.state !== "normal");
    const unack = count((a) => category(a) === "active" && String(a.state).includes("unacknowledged"));
    const shelved = count((a) => category(a) === "shelved");
    const suppressed = count((a) => category(a) === "suppressed");
    this.counts.textContent = `${active} active · ${unack} unacknowledged · ${shelved} shelved · ${suppressed} suppressed / OOS`;
    this.sortBtn.textContent = this.filters.sort === "priority" ? "Sort: priority" : "Sort: time";
    this.body.setAttribute("aria-label", `${this.get("label") || "Alarm list"}: ${this.counts.textContent}`);
    const rows = filterAlarms(alarms, this.filters);
    clear(this.tbody);
    for (const a of rows) {
      const cat = category(a);
      let state = STATE_TEXT[a.state] || a.state;
      if (a.out_of_service) state = "OUT OF SERVICE";
      else if (a.suppressed) state = "SUPPRESSED";
      else if (cat === "shelved") state = `SHELVED until ${String(a.shelved_until).slice(11, 16)}`;
      const row = html("tr", { cls: `awi-prio-${a.priority} awi-state-${a.state} awi-al-${cat}` }, [
        html("td", { text: String(a.timestamp || "").replace("T", " ") }),
        html("td", {}, [html("span", { cls: "awi-prio-chip", text: PRIORITY_TEXT[String(a.priority)] || String(a.priority) })]),
        html("td", { text: String(a.source || a.id) }),
        html("td", { text: String(a.message || a.id) }),
        html("td", { cls: "awi-al-state", text: state }),
        this.actions(a),
      ]);
      this.tbody.appendChild(row);
    }
    if (!rows.length) this.tbody.appendChild(html("tr", {}, [html("td", { text: "No alarm in this view", attrs: { colspan: "6" } })]));
  }
}
