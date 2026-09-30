// RecipeTable: typed columns edited by the operator (IND-113, IND-114).
import { hostOwnsState } from "../contract/derived.js";
import { type CellCheck, checkCell, checkTyped, type Column, defaultRow, normalizeColumn, sortedOrder } from "../contract/recipe.js";
import { clear, html, setAttr, setText } from "anywidget-instruments/js/src/core/dom.js";
import { formatValue, withUnit } from "../core/format.js";
import type { AnyModel } from "anywidget-instruments/js/src/core/model.js";
import { BaseView } from "anywidget-instruments/js/src/core/view.js";
import type { RecipeTableTraits } from "../generated/contract.js";

const TRAITS = ["columns", "value", "row_edit", "max_rows"];

type Row = Record<string, unknown>;

/** Text of a cell as displayed (numbers with the column format). */
export function cellText(col: Column, v: unknown): string {
  if (col.type === "bool") return v === true ? "☑ yes" : "☐ no";
  if (col.type === "number") return typeof v === "number" ? formatValue(v, col.format) : "";
  return v === undefined || v === null ? "" : String(v);
}

export class RecipeView extends BaseView<RecipeTableTraits> {
  readonly table: HTMLTableElement;
  readonly thead: HTMLTableSectionElement;
  readonly tbody: HTMLTableSectionElement;
  readonly msg: HTMLDivElement;
  readonly addBtn: HTMLButtonElement;
  sortColumn: string | null = null;
  sortDesc = false;
  /** An edit field has the focus: redraws wait until it is left. */
  editing = false;

  constructor(model: AnyModel<RecipeTableTraits>, el: HTMLElement) {
    super(model, el, TRAITS);
    this.body.setAttribute("role", "region");
    this.table = html("table", { cls: "awi-rt-table" });
    this.thead = html("thead");
    this.tbody = html("tbody");
    this.table.append(this.thead, this.tbody);
    this.msg = html("div", { cls: "awi-entry-msg awi-rt-msg", attrs: { role: "alert" } });
    this.addBtn = html("button", { cls: "awi-rt-add", text: "+ Add row", attrs: { type: "button" } });
    this.addBtn.addEventListener("click", () => this.addRow());
    this.body.append(html("div", { cls: "awi-rt-scroll" }, [this.table]), html("div", { cls: "awi-rt-foot" }, [this.addBtn, this.msg]));
    this.tbody.addEventListener("focusin", () => (this.editing = true));
    this.tbody.addEventListener("focusout", () => {
      this.editing = false;
      this.schedule();
    });
    this.listen("msg:custom", (msg: unknown) => {
      const m = msg as { type?: unknown; row?: unknown; column?: unknown; reason?: unknown } | null;
      if (!m || m.type !== "rejected") return;
      const col = this.columns().find((c) => c.name === m.column);
      this.showMessage(`${typeof m.row === "number" ? `Row ${m.row + 1}` : "Row"}${col ? `, ${col.title}` : ""}: ${String(m.reason ?? "rejected")}`);
    });
    this.schedule();
  }

  columns(): Column[] {
    return this.get("columns").map((c, i) => normalizeColumn(c, i));
  }

  rows(): Row[] {
    return this.get("value");
  }

  showMessage(text: string): void {
    setText(this.msg, text);
  }

  /** Rows written by the front end when no host owns the state (HOST-012). */
  applyLocally(rows: Row[]): void {
    if (hostOwnsState(this.model as unknown as AnyModel)) return;
    this.model.set("value", rows as RecipeTableTraits["value"]);
    this.model.save_changes();
  }

  /** Confirm a cell (IND-113): checked here, sent to the host, applied without one. */
  commit(row: number, col: Column, check: CellCheck, field?: HTMLElement): boolean {
    if (!this.interactive) return false;
    field?.toggleAttribute("aria-invalid", !check.ok);
    if (!check.ok) {
      this.showMessage(`Row ${row + 1}, ${col.title}: ${check.reason}`);
      return false;
    }
    this.showMessage("");
    const rows = this.rows();
    if (rows[row]?.[col.name] === check.value) return true;
    this.model.send({ type: "edit", row, column: col.name, value: check.value });
    this.applyLocally(rows.map((r, i) => (i === row ? { ...r, [col.name]: check.value } : r)));
    return true;
  }

  addRow(): void {
    if (!this.interactive || !this.get("row_edit") || this.rows().length >= this.get("max_rows")) return;
    this.model.send({ type: "add" });
    this.applyLocally([...this.rows(), defaultRow(this.columns())]);
  }

  deleteRow(row: number): void {
    if (!this.interactive || !this.get("row_edit")) return;
    this.model.send({ type: "delete", row });
    this.applyLocally(this.rows().filter((_, i) => i !== row));
  }

  sortBy(name: string): void {
    this.sortDesc = this.sortColumn === name ? !this.sortDesc : false;
    this.sortColumn = name;
    this.schedule();
  }

  /** Edit field of a cell (control mode). */
  editor(row: number, col: Column, v: unknown): HTMLElement {
    const label = `Row ${row + 1}, ${col.title}`;
    if (col.type === "bool") {
      const box = html("input", { attrs: { type: "checkbox", "aria-label": label } });
      box.checked = v === true;
      box.addEventListener("change", () => this.commit(row, col, checkCell(col, box.checked), box));
      return box;
    }
    if (col.type === "choice") {
      const sel = html("select", { attrs: { "aria-label": label } }, col.choices.map((c) => html("option", { text: c, attrs: { value: c } })));
      sel.value = String(v ?? "");
      sel.addEventListener("change", () => this.commit(row, col, checkCell(col, sel.value), sel));
      return sel;
    }
    const field = html("input", { cls: "awi-entry", attrs: { type: "text", "aria-label": label, inputmode: col.type === "number" ? "decimal" : "text" } });
    const shown = cellText(col, v);
    field.value = shown;
    let committed = shown;
    const confirm = (): boolean => {
      if (field.value === committed) return true;
      const ok = this.commit(row, col, col.type === "number" ? checkTyped(col, field.value) : checkCell(col, field.value), field);
      if (ok) committed = field.value;
      return ok;
    };
    field.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        if (confirm()) field.blur();
      } else if (e.key === "Escape") {
        field.value = committed;
        field.removeAttribute("aria-invalid");
        this.showMessage("");
        field.blur();
      }
    });
    // leaving a changed field confirms it, as Enter does
    field.addEventListener("change", () => void confirm());
    return field;
  }

  override draw(): void {
    if (this.editing) return; // redrawn when the edit field is left
    const cols = this.columns();
    const rows = this.rows();
    const interactive = this.interactive;
    const rowEdit = interactive && !!this.get("row_edit");
    // header: one sort button per column (IND-114)
    clear(this.thead);
    const head = html("tr", {}, [html("th", { text: "#", attrs: { scope: "col" } })]);
    for (const col of cols) {
      const sorted = this.sortColumn === col.name;
      const btn = html("button", { cls: "awi-rt-sort", text: `${col.title}${col.unit ? ` (${col.unit})` : ""}${sorted ? (this.sortDesc ? " ▼" : " ▲") : ""}`, attrs: { type: "button", title: `Sort by ${col.title}` } });
      btn.addEventListener("click", () => this.sortBy(col.name));
      head.appendChild(html("th", { attrs: { scope: "col", "aria-sort": sorted ? (this.sortDesc ? "descending" : "ascending") : "none" } }, [btn]));
    }
    if (rowEdit) head.appendChild(html("th", { attrs: { scope: "col", "aria-label": "Actions" } }));
    this.thead.appendChild(head);
    clear(this.tbody);
    for (const i of sortedOrder(rows, this.sortColumn, this.sortDesc)) {
      const tr = html("tr", {}, [html("th", { text: String(i + 1), attrs: { scope: "row" } })]);
      for (const col of cols) {
        const v = rows[i][col.name];
        const invalid = !checkCell(col, v).ok;
        const td = html("td", { cls: `awi-rt-${col.type}${invalid ? " awi-rt-invalid" : ""}` });
        if (interactive && !col.readonly) td.appendChild(this.editor(i, col, v));
        else td.textContent = invalid ? `⚠ ${String(v ?? "")}` : cellText(col, v);
        tr.appendChild(td);
      }
      if (rowEdit) {
        const del = html("button", { cls: "awi-rt-del", text: "✕", attrs: { type: "button", "aria-label": `Delete row ${i + 1}`, title: `Delete row ${i + 1}` } });
        del.addEventListener("click", () => this.deleteRow(i));
        tr.appendChild(html("td", {}, [del]));
      }
      this.tbody.appendChild(tr);
    }
    this.addBtn.hidden = !rowEdit;
    this.addBtn.disabled = rows.length >= this.get("max_rows");
    setAttr(this.body, "aria-label", `${this.get("label") || "Recipe table"}: ${rows.length} row${rows.length === 1 ? "" : "s"}, ${cols.length} column${cols.length === 1 ? "" : "s"}${cols.length ? ` (${cols.map((c) => withUnit(c.title, c.unit)).join(", ")})` : ""}`);
  }
}
