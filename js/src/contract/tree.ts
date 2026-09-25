// EquipmentTree rules shared with the Python kernel (IND-119).
// Python: flatten_tree, rollup_status, visible_ids (_tree.py); both sides are
// checked against tests/parity/tree.json.

/** Node statuses, from the least to the most severe (the order of the roll-up). */
export const NODE_STATUSES = ["", "normal", "running", "stopped", "offline", "maintenance", "warning", "alarm", "fault"] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];

export interface TreeNode {
  id: string;
  label: string;
  level: string;
  status: NodeStatus;
  depth: number;
  parent: string;
  children: string[];
}

/**
 * Nodes in display order. A node without an id gets the path of labels from
 * the root ("Plant/Area 1/Mixer"). The kernel refuses a node without a label,
 * an unknown status or a repeated id; without a kernel such a node is
 * skipped with the nodes below it.
 */
export function flattenTree(nodes: unknown): TreeNode[] {
  const out: TreeNode[] = [];
  const seen = new Set<string>();
  const walk = (items: unknown, depth: number, parent: string): string[] => {
    const ids: string[] = [];
    for (const raw of Array.isArray(items) ? items : []) {
      const r = (raw && typeof raw === "object" ? raw : {}) as { id?: unknown; label?: unknown; level?: unknown; status?: unknown; children?: unknown };
      if (typeof r.label !== "string") continue;
      const id = r.id === undefined || r.id === null || r.id === "" ? (parent ? `${parent}/${r.label}` : r.label) : String(r.id);
      const status = (r.status ?? "") as NodeStatus;
      if (!NODE_STATUSES.includes(status) || seen.has(id)) continue;
      seen.add(id);
      const node: TreeNode = { id, label: r.label, level: typeof r.level === "string" ? r.level : "", status, depth, parent, children: [] };
      out.push(node);
      node.children = walk(r.children, depth + 1, id);
      ids.push(id);
    }
    return ids;
  };
  walk(nodes, 0, "");
  return out;
}

/** Most severe status of a node and of all the nodes below it. */
export function rollupStatus(flat: TreeNode[], id: string): NodeStatus {
  const byId = new Map(flat.map((n) => [n.id, n]));
  let worst: NodeStatus = "";
  const stack = [id];
  while (stack.length) {
    const n = byId.get(stack.pop() as string);
    if (!n) continue;
    if (NODE_STATUSES.indexOf(n.status) > NODE_STATUSES.indexOf(worst)) worst = n.status;
    stack.push(...n.children);
  }
  return worst;
}

/** Ids of the rows shown: the roots and the children of expanded, shown nodes. */
export function visibleIds(flat: TreeNode[], expanded: readonly string[]): string[] {
  const open = new Set(expanded);
  const shown = new Set<string>();
  const out: string[] = [];
  for (const n of flat) {
    if (n.parent === "" || (shown.has(n.parent) && open.has(n.parent))) {
      shown.add(n.id);
      out.push(n.id);
    }
  }
  return out;
}
