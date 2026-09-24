// AlarmBanner (SCADA-006, SCADA-007).
import type { AlarmRow } from "../contract/alarms.js";
import { alarmAction } from "../contract/derived.js";
import { clear, html } from "../core/dom.js";
import type { AnyModel } from "../core/model.js";
import { BaseView } from "../core/view.js";
import type { AlarmBannerTraits } from "../generated/contract.js";

const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const PRIORITY_TEXT: Record<string, string> = { critical: "P1", high: "P2", medium: "P3", low: "P4" };
const STATE_TEXT: Record<string, string> = { active_unacknowledged: "ACTIVE · UNACK", active_acknowledged: "ACTIVE · ACK", cleared_unacknowledged: "CLEARED · UNACK" };

/** Sort alarms: unacknowledged first, then priority, then newest first. */
export function sortAlarms(alarms: readonly AlarmRow[]): AlarmRow[] {
  const unack = (a: AlarmRow): number => (a.state === "active_acknowledged" ? 1 : 0);
  return [...alarms].sort((a, b) => unack(a) - unack(b) || (RANK[String(a.priority)] ?? 9) - (RANK[String(b.priority)] ?? 9) || String(b.timestamp).localeCompare(String(a.timestamp)));
}

export class BannerView extends BaseView<AlarmBannerTraits> {
  readonly header: HTMLDivElement;
  readonly count: HTMLSpanElement;
  readonly ackAll: HTMLButtonElement;
  readonly table: HTMLTableElement;
  readonly tbody: HTMLTableSectionElement;
  readonly scroller: HTMLDivElement;

  constructor(model: AnyModel<AlarmBannerTraits>, el: HTMLElement) {
    super(model, el, ["value"]);
    this.header = html("div", { cls: "awi-banner-head" });
    this.count = html("span", { cls: "awi-banner-count" });
    this.ackAll = html("button", { cls: "awi-ack", text: "ACK ALL", attrs: { type: "button" } });
    this.ackAll.addEventListener("click", () => this.send({ type: "ack_all" }));
    this.header.append(this.count, this.ackAll);
    this.table = html("table", { cls: "awi-banner-table" });
    const head = html("tr", {}, ["Time", "Prio", "Source", "Message", "State", ""].map((t) => html("th", { text: t, attrs: { scope: "col" } })));
    this.table.appendChild(html("thead", {}, [head]));
    this.tbody = html("tbody");
    this.table.appendChild(this.tbody);
    this.scroller = html("div", { cls: "awi-banner-scroll" }, [this.table]);
    this.body.append(this.header, this.scroller);
    this.body.setAttribute("role", "region");
    this.schedule();
  }

  /** Operator action: always sent to the host; applied by the front end when no host owns the state (HOST-004). */
  send(msg: { type: string; alarm_id?: string }): void {
    if (!this.interactive) return;
    this.model.send(msg);
    alarmAction(this.model as unknown as AnyModel, msg);
  }

  override draw(): void {
    const alarms = sortAlarms((this.get("value") || []) as AlarmRow[]);
    const unacked = alarms.filter((a) => a.state !== "active_acknowledged").length;
    this.count.textContent = `${alarms.length} alarm${alarms.length === 1 ? "" : "s"} · ${unacked} unacknowledged`;
    this.ackAll.hidden = !(unacked && this.get("mode") === "control");
    this.body.setAttribute("aria-label", `${this.get("label") || "Alarm banner"}: ${this.count.textContent}`);
    clear(this.tbody);
    for (const a of alarms) {
      const time = String(a.timestamp || "").replace("T", " ");
      const ack = html("button", { cls: "awi-ack", text: "ACK", attrs: { type: "button", "aria-label": `Acknowledge ${a.id}` } });
      ack.hidden = !(a.state !== "active_acknowledged" && this.get("mode") === "control");
      ack.addEventListener("click", () => this.send({ type: "ack", alarm_id: a.id }));
      const prio = html("td", {}, [html("span", { cls: "awi-prio-chip", text: PRIORITY_TEXT[String(a.priority)] || String(a.priority) })]);
      const row = html("tr", { cls: `awi-prio-${a.priority} awi-state-${a.state}` }, [
        html("td", { text: time }),
        prio,
        html("td", { text: String(a.source || "") }),
        html("td", { text: `${a.id}${a.message ? `: ${a.message}` : ""}` }),
        html("td", { text: STATE_TEXT[a.state] || a.state }),
        html("td", {}, [ack]),
      ]);
      this.tbody.appendChild(row);
    }
    if (!alarms.length) this.tbody.appendChild(html("tr", {}, [html("td", { text: "No active alarm", attrs: { colspan: "6" } })]));
  }
}
