// EquipmentTree: a hierarchy of equipment with a status per node (IND-119).
import { flattenTree, type NodeStatus, rollupStatus, type TreeNode, visibleIds } from "../contract/tree.js";
import { clear, html, setAttr } from "anywidget-instruments/js/src/core/dom.js";
import type { AnyModel } from "anywidget-instruments/js/src/core/model.js";
import { BaseView } from "anywidget-instruments/js/src/core/view.js";
import type { EquipmentTreeTraits } from "../generated/contract.js";

const TRAITS = ["value", "nodes", "expanded", "show_level"];

/** Symbol and word of each status: the state is not conveyed by color alone (A11Y-003). */
export const STATUS_TEXT: Record<Exclude<NodeStatus, "">, [string, string]> = {
  normal: ["●", "normal"],
  running: ["▶", "running"],
  stopped: ["■", "stopped"],
  offline: ["○", "offline"],
  maintenance: ["◇", "maintenance"],
  warning: ["▲", "warning"],
  alarm: ["◆", "alarm"],
  fault: ["✖", "fault"],
};

const RANK = (s: NodeStatus): number => Object.keys(STATUS_TEXT).indexOf(s);

export class TreeView extends BaseView<EquipmentTreeTraits> {
  readonly list: HTMLDivElement;
  /** Row that has the keyboard focus (roving tabindex). */
  focusId = "";
  flat: TreeNode[] = [];

  constructor(model: AnyModel<EquipmentTreeTraits>, el: HTMLElement) {
    super(model, el, TRAITS);
    this.list = html("div", { cls: "awi-et-list", attrs: { role: "tree" } });
    this.body.appendChild(this.list);
    this.list.addEventListener("keydown", (e) => this.onKey(e));
    this.schedule();
  }

  node(id: string): TreeNode | undefined {
    return this.flat.find((n) => n.id === id);
  }

  get canNavigate(): boolean {
    return !this.get("disabled") && this.stale === "live";
  }

  setExpanded(id: string, open: boolean): void {
    const n = this.node(id);
    if (!this.canNavigate || !n || !n.children.length) return;
    const cur = this.get("expanded");
    if (open === cur.includes(id)) return;
    this.model.set("expanded", open ? [...cur, id] : cur.filter((x) => x !== id));
    this.model.save_changes();
    this.schedule();
  }

  select(id: string): void {
    this.focusId = id;
    if (!this.interactive || !this.node(id)) return this.schedule();
    if (this.get("value") !== id) {
      this.model.set("value", id);
      this.model.save_changes();
    }
    this.schedule();
  }

  focusRow(id: string): void {
    this.focusId = id;
    this.draw();
    this.rowOf(id)?.focus();
  }

  rowOf(id: string): HTMLElement | undefined {
    return ([...this.list.children] as HTMLElement[]).find((r) => r.dataset.id === id);
  }

  onKey(e: KeyboardEvent): void {
    if (!this.canNavigate) return;
    const shown = visibleIds(this.flat, this.get("expanded"));
    const i = shown.indexOf(this.focusId);
    const n = this.node(this.focusId);
    const open = n ? this.get("expanded").includes(n.id) : false;
    switch (e.key) {
      case "ArrowDown":
        if (i < shown.length - 1) this.focusRow(shown[i + 1]);
        break;
      case "ArrowUp":
        if (i > 0) this.focusRow(shown[i - 1]);
        break;
      case "Home":
        if (shown.length) this.focusRow(shown[0]);
        break;
      case "End":
        if (shown.length) this.focusRow(shown[shown.length - 1]);
        break;
      case "ArrowRight":
        if (n && n.children.length && !open) this.setExpanded(n.id, true);
        else if (n && open) this.focusRow(n.children[0]);
        break;
      case "ArrowLeft":
        if (n && open) this.setExpanded(n.id, false);
        else if (n?.parent) this.focusRow(n.parent);
        break;
      case "Enter":
      case " ":
        if (n) this.select(n.id);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  override draw(): void {
    this.flat = flattenTree(this.get("nodes"));
    const expanded = this.get("expanded");
    const selected = this.get("value");
    const shown = visibleIds(this.flat, expanded);
    if (!shown.includes(this.focusId)) this.focusId = shown.includes(selected) ? selected : (shown[0] ?? "");
    const hadFocus = this.list.contains(document.activeElement);
    const showLevel = this.get("show_level");
    clear(this.list);
    const siblings = (n: TreeNode): string[] => (n.parent ? (this.node(n.parent)?.children ?? []) : this.flat.filter((m) => m.depth === 0).map((m) => m.id));
    for (const id of shown) {
      const n = this.node(id) as TreeNode;
      const open = expanded.includes(id);
      const below = n.children.length && !open ? rollupStatus(this.flat, id) : "";
      const rollup = below && RANK(below) > RANK(n.status) ? below : "";
      const sib = siblings(n);
      const twisty = html("span", { cls: "awi-et-twisty", text: n.children.length ? (open ? "▾" : "▸") : "", attrs: { "aria-hidden": "true" } });
      twisty.addEventListener("click", (e) => {
        e.stopPropagation();
        this.focusId = id;
        this.setExpanded(id, !open);
      });
      const parts: HTMLElement[] = [twisty];
      if (n.status) parts.push(this.chip(n.status, false));
      parts.push(html("span", { cls: "awi-et-label", text: n.label }));
      if (showLevel && n.level) parts.push(html("span", { cls: "awi-et-level", text: n.level }));
      if (rollup) parts.push(this.chip(rollup, true));
      const row = html("div", { cls: "awi-et-row", attrs: { "data-id": id, role: "treeitem", "data-lm-suppress-shortcuts": "true" } }, parts);
      row.style.paddingLeft = `${4 + 16 * n.depth}px`;
      row.classList.toggle("awi-et-selected", id === selected);
      const words = [n.label, showLevel && n.level ? n.level : "", n.status ? STATUS_TEXT[n.status][1] : "", rollup ? `${STATUS_TEXT[rollup][1]} below` : ""];
      setAttr(row, "aria-label", words.filter(Boolean).join(", "));
      setAttr(row, "aria-level", String(n.depth + 1));
      setAttr(row, "aria-setsize", String(sib.length));
      setAttr(row, "aria-posinset", String(sib.indexOf(id) + 1));
      setAttr(row, "aria-selected", String(id === selected));
      setAttr(row, "aria-expanded", n.children.length ? String(open) : null);
      row.tabIndex = id === this.focusId ? 0 : -1;
      row.addEventListener("click", () => this.select(id));
      row.addEventListener("dblclick", () => this.setExpanded(id, !open));
      this.list.appendChild(row);
    }
    setAttr(this.list, "aria-label", String(this.get("label") || "Equipment tree"));
    setAttr(this.list, "aria-disabled", this.canNavigate ? null : "true");
    if (hadFocus) this.rowOf(this.focusId)?.focus();
  }

  chip(status: Exclude<NodeStatus, "">, rollup: boolean): HTMLSpanElement {
    const [symbol, word] = STATUS_TEXT[status];
    return html("span", {
      cls: `awi-et-status awi-et-s-${status}${rollup ? " awi-et-rollup" : ""}`,
      text: rollup ? `${symbol} ${word} below` : `${symbol} ${word}`,
      attrs: { "aria-hidden": "true", title: rollup ? `Most severe status below: ${word}` : word },
    });
  }
}
