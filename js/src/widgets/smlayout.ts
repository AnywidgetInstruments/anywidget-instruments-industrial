// Layout of a state diagram (IND-066): right-angle routing of the
// transitions, outlines of zones made of rectangles, and the point where a
// zone's command leaves the zone. Pure geometry, in pixels or in cell units.

export type Pt = [number, number];

export interface Box {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** [x0, y0, x1, y1] in cell units (a state at (x, y) fills [x, x+1] × [y, y+1]). */
export type Rect = [number, number, number, number];

const inX = (b: Box, x: number, pad = 0): boolean => Math.abs(x - b.cx) <= b.w / 2 - pad;
const inY = (b: Box, y: number, pad = 0): boolean => Math.abs(y - b.cy) <= b.h / 2 - pad;

/** Point where a right-angle path leaves box `b` towards `p` (vertically when p is above or below it). */
function portal(b: Box, p: Pt): Pt {
  if (inX(b, p[0], 2)) return [p[0], p[1] < b.cy ? b.cy - b.h / 2 : b.cy + b.h / 2];
  if (inY(b, p[1], 2)) return [p[0] < b.cx ? b.cx - b.w / 2 : b.cx + b.w / 2, p[1]];
  // not aligned with the box: leave from the side facing the point
  return Math.abs(p[0] - b.cx) / b.w > Math.abs(p[1] - b.cy) / b.h ? [p[0] < b.cx ? b.cx - b.w / 2 : b.cx + b.w / 2, b.cy] : [b.cx, p[1] < b.cy ? b.cy - b.h / 2 : b.cy + b.h / 2];
}

/** Whether the axis-aligned segment p–q crosses the inside of box b. */
function crosses(p: Pt, q: Pt, b: Box): boolean {
  const [x0, x1] = [Math.min(p[0], q[0]), Math.max(p[0], q[0])];
  const [y0, y1] = [Math.min(p[1], q[1]), Math.max(p[1], q[1])];
  return x1 > b.cx - b.w / 2 + 1 && x0 < b.cx + b.w / 2 - 1 && y1 > b.cy - b.h / 2 + 1 && y0 < b.cy + b.h / 2 - 1;
}

/** Segments already drawn, so that the next arrows avoid running over them. */
export type Segment = [Pt, Pt];

export interface RouteContext {
  /** Boxes the arrow must not cross (all the states, a and b included). */
  boxes: Box[];
  /** Segments of the arrows already drawn. */
  used: Segment[];
  /** Coordinates of the free channels between the rows (y) and the columns (x). */
  rowGaps: number[];
  colGaps: number[];
}

/** Length along which two axis-aligned segments run over each other (closer than 4 px). */
function overlap(p: Pt, q: Pt, r: Pt, t: Pt): number {
  const h1 = p[1] === q[1];
  const h2 = r[1] === t[1];
  if (h1 !== h2) return 0;
  const [i, j] = h1 ? [1, 0] : [0, 1];
  if (Math.abs(p[i] - r[i]) >= 4) return 0;
  const lo = Math.max(Math.min(p[j], q[j]), Math.min(r[j], t[j]));
  const hi = Math.min(Math.max(p[j], q[j]), Math.max(r[j], t[j]));
  return Math.max(0, hi - lo);
}

/** Whether two axis-aligned segments cross at right angles. */
function cuts(p: Pt, q: Pt, r: Pt, t: Pt): boolean {
  const h1 = p[1] === q[1];
  if (h1 === (r[1] === t[1])) return false;
  const [hp, hq, vr, vt] = h1 ? [p, q, r, t] : [r, t, p, q];
  const x = vr[0];
  const y = hp[1];
  return x > Math.min(hp[0], hq[0]) && x < Math.max(hp[0], hq[0]) && y > Math.min(vr[1], vt[1]) && y < Math.max(vr[1], vt[1]);
}

/** Cost of a path: crossed states first, then arrows run over, crossings, bends and length. */
export function pathCost(points: Pt[], a: Box, b: Box, ctx: RouteContext): number {
  let cost = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const [p, q] = [points[i], points[i + 1]];
    if (p[0] !== q[0] && p[1] !== q[1]) cost += 5000; // never a diagonal
    for (const box of ctx.boxes) {
      // the end boxes may only be touched by the first and the last segment
      if ((box === a && i === 0) || (box === b && i === points.length - 2)) continue;
      if (crosses(p, q, box)) cost += 1000;
    }
    for (const [r, t] of ctx.used) {
      cost += 8 * overlap(p, q, r, t);
      if (cuts(p, q, r, t)) cost += 12;
    }
    cost += Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]);
  }
  return cost + 25 * (points.length - 2);
}

/** Point on the side of box b facing (x, y) along one axis. */
const side = (b: Box, horizontal: boolean, towards: number, offset: number): Pt =>
  horizontal ? [towards < b.cx ? b.cx - b.w / 2 : b.cx + b.w / 2, b.cy + offset] : [b.cx + offset, towards < b.cy ? b.cy - b.h / 2 : b.cy + b.h / 2];

/**
 * Right-angle path from box a to box b, the cheapest of: a straight arrow
 * when the boxes face each other, an L, or a detour through a channel
 * between the rows or the columns (pathCost). Waypoints, when given, fix
 * the path.
 */
export function routePoints(a: Box, b: Box, waypoints: Pt[] | null, ctx: RouteContext | Box[] = []): Pt[] {
  if (waypoints && waypoints.length) {
    return [portal(a, waypoints[0]), ...waypoints, portal(b, waypoints[waypoints.length - 1])];
  }
  const c: RouteContext = Array.isArray(ctx) ? { boxes: ctx, used: [], rowGaps: [], colGaps: [] } : ctx;
  const candidates: Pt[][] = [];
  const offsX = [0, -a.w / 4, a.w / 4, -a.w / 8, a.w / 8];
  const offsY = [0, -a.h / 4, a.h / 4];
  // straight, shifted so that the arrows of a return trip run side by side
  const oy0 = Math.max(a.cy - a.h / 2, b.cy - b.h / 2);
  const oy1 = Math.min(a.cy + a.h / 2, b.cy + b.h / 2);
  if (oy1 - oy0 > 4) {
    for (const o of offsY) {
      const y = (oy0 + oy1) / 2 + o;
      if (y > oy0 + 2 && y < oy1 - 2) candidates.push([side(a, true, b.cx, y - a.cy), side(b, true, a.cx, y - b.cy)]);
    }
  }
  const ox0 = Math.max(a.cx - a.w / 2, b.cx - b.w / 2);
  const ox1 = Math.min(a.cx + a.w / 2, b.cx + b.w / 2);
  if (ox1 - ox0 > 4) {
    for (const o of offsX) {
      const x = (ox0 + ox1) / 2 + o;
      if (x > ox0 + 2 && x < ox1 - 2) candidates.push([side(a, false, b.cy, x - a.cx), side(b, false, a.cy, x - b.cx)]);
    }
  }
  // L: leave a sideways and enter b vertically, or the reverse
  for (const o of offsY) {
    for (const ob of offsX) {
      const p0 = side(a, true, b.cx, o);
      const p2 = side(b, false, a.cy, ob);
      candidates.push([p0, [p2[0], p0[1]], p2]);
    }
  }
  for (const oa of offsX) {
    for (const o of offsY) {
      const p0 = side(a, false, b.cy, oa);
      const p2 = side(b, true, a.cx, o);
      candidates.push([p0, [p0[0], p2[1]], p2]);
    }
  }
  // detours through a channel: out of a vertically, along a row gap, into b
  // vertically (or the same with a column gap)
  for (const g of c.rowGaps) {
    for (const d of [-5, 0, 5]) {
      const y = g + d;
      for (const oa of offsX) {
        for (const ob of offsX) {
          const p0 = side(a, false, y, oa);
          const p3 = side(b, false, y, ob);
          if ((y - a.cy) * (p0[1] - a.cy) <= 0 || (y - b.cy) * (p3[1] - b.cy) <= 0) continue;
          candidates.push([p0, [p0[0], y], [p3[0], y], p3]);
        }
      }
    }
  }
  for (const g of c.colGaps) {
    for (const d of [-5, 0, 5]) {
      const x = g + d;
      for (const oa of offsY) {
        for (const ob of offsY) {
          const p0 = side(a, true, x, oa);
          const p3 = side(b, true, x, ob);
          if ((x - a.cx) * (p0[0] - a.cx) <= 0 || (x - b.cx) * (p3[0] - b.cx) <= 0) continue;
          candidates.push([p0, [x, p0[1]], [x, p3[1]], p3]);
        }
      }
    }
  }
  let best = candidates[0];
  let bestCost = Infinity;
  for (const pts of candidates) {
    const clean = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
    const cost = pathCost(clean, a, b, c);
    if (cost < bestCost) [best, bestCost] = [clean, cost];
  }
  return best;
}

/** Label position: x, y and the anchor of the text. */
export interface LabelSpot {
  x: number;
  y: number;
  horizontal: boolean;
  /** Above (horizontal) or right (vertical) of the line: 1; below or left: -1. */
  side?: number;
}

/** Middle of the longest segment of a path, and whether that segment is horizontal. */
export function labelAnchor(points: Pt[]): LabelSpot {
  let best = 0;
  let len = -1;
  for (let i = 0; i + 1 < points.length; i++) {
    const l = Math.abs(points[i + 1][0] - points[i][0]) + Math.abs(points[i + 1][1] - points[i][1]);
    if (l > len) [best, len] = [i, l];
  }
  const [p, q] = [points[best], points[best + 1]];
  return { x: (p[0] + q[0]) / 2, y: (p[1] + q[1]) / 2, horizontal: Math.abs(q[0] - p[0]) >= Math.abs(q[1] - p[1]) };
}

/** Rectangle [x0, y0, x1, y1] taken by a label of `width` pixels at a spot (see the view). */
export function labelRect(spot: LabelSpot, width: number): Rect {
  const side = spot.side ?? 1;
  if (spot.horizontal) return side > 0 ? [spot.x - width / 2, spot.y - 12, spot.x + width / 2, spot.y - 1] : [spot.x - width / 2, spot.y + 1, spot.x + width / 2, spot.y + 12];
  return side > 0 ? [spot.x + 3, spot.y - 6, spot.x + 4 + width, spot.y + 6] : [spot.x - 4 - width, spot.y - 6, spot.x - 3, spot.y + 6];
}


/**
 * Where to write the label of a path: along its segments, longest first,
 * the first spot that neither covers a state nor another label; else the
 * middle of the longest segment. The rectangle taken is added to `taken`.
 */
export function placeLabel(points: Pt[], width: number, boxes: Box[], taken: Rect[]): LabelSpot {
  const segs = points.slice(1).map((q, i) => [points[i], q] as Segment);
  segs.sort((s, t) => Math.abs(t[1][0] - t[0][0]) + Math.abs(t[1][1] - t[0][1]) - (Math.abs(s[1][0] - s[0][0]) + Math.abs(s[1][1] - s[0][1])));
  const boxRects = boxes.map((b): Rect => [b.cx - b.w / 2, b.cy - b.h / 2, b.cx + b.w / 2, b.cy + b.h / 2]);
  // the spot that covers the least of the other labels, then of the states
  // (a label has a halo, so it stays readable over the edge of a state)
  const area = (r: Rect, t: Rect): number => Math.max(0, Math.min(r[2], t[2]) - Math.max(r[0], t[0])) * Math.max(0, Math.min(r[3], t[3]) - Math.max(r[1], t[1]));
  let best: LabelSpot | null = null;
  let bestCost = Infinity;
  for (const side of [1, -1]) {
    for (const [p, q] of segs) {
      for (const f of [0.5, 0.3, 0.7, 0.15, 0.85]) {
        const spot = { x: p[0] + (q[0] - p[0]) * f, y: p[1] + (q[1] - p[1]) * f, horizontal: p[1] === q[1], side };
        const r = labelRect(spot, width);
        const cost = taken.reduce((c, t) => c + 10 * area(r, t), 0) + boxRects.reduce((c, t) => c + area(r, t), 0);
        if (cost < bestCost - 1e-9) [best, bestCost] = [spot, cost];
        if (cost === 0) break;
      }
      if (bestCost === 0) break;
    }
    if (bestCost === 0) break;
  }
  if (best) {
    taken.push(labelRect(best, width));
    return best;
  }
  const spot = labelAnchor(points);
  taken.push(labelRect(spot, width));
  return spot;
}

/** Whether the point (cell units) lies in the union of the rectangles. */
export function inZone(rects: Rect[], x: number, y: number): boolean {
  return rects.some(([x0, y0, x1, y1]) => x > x0 && x < x1 && y > y0 && y < y1);
}

/** Boundary of the union of rectangles, as horizontal and vertical segments [x0, y0, x1, y1]. */
export function zoneOutline(rects: Rect[]): Rect[] {
  const xs = [...new Set(rects.flatMap((r) => [r[0], r[2]]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => [r[1], r[3]]))].sort((a, b) => a - b);
  const cov = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < xs.length - 1 && j < ys.length - 1 && inZone(rects, (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2);
  const segs: Rect[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      if (!cov(i, j)) continue;
      if (!cov(i, j - 1)) segs.push([xs[i], ys[j], xs[i + 1], ys[j]]);
      if (!cov(i, j + 1)) segs.push([xs[i], ys[j + 1], xs[i + 1], ys[j + 1]]);
      if (!cov(i - 1, j)) segs.push([xs[i], ys[j], xs[i], ys[j + 1]]);
      if (!cov(i + 1, j)) segs.push([xs[i + 1], ys[j], xs[i + 1], ys[j + 1]]);
    }
  }
  // merge collinear neighbours, so that dashes run evenly
  const merged: Rect[] = [];
  const key = (s: Rect): string => (s[1] === s[3] ? `h${s[1]}` : `v${s[0]}`);
  const byLine = new Map<string, Rect[]>();
  for (const s of segs) byLine.set(key(s), [...(byLine.get(key(s)) || []), s]);
  for (const [k, list] of byLine) {
    const horizontal = k.startsWith("h");
    list.sort((p, q) => (horizontal ? p[0] - q[0] : p[1] - q[1]));
    let cur = [...list[0]] as Rect;
    for (const s of list.slice(1)) {
      if (horizontal ? s[0] === cur[2] : s[1] === cur[3]) cur = horizontal ? [cur[0], cur[1], s[2], cur[3]] : [cur[0], cur[1], cur[2], s[3]];
      else {
        merged.push(cur);
        cur = [...s] as Rect;
      }
    }
    merged.push(cur);
  }
  return merged;
}

/**
 * Outline of a zone in pixels, moved `inset` pixels inwards: each segment
 * shifts towards the covered side, shortened at an outer corner and
 * lengthened at an inner one, so that the corners still meet.
 */
export function insetOutline(rects: Rect[], cw: number, ch: number, inset: number): Rect[] {
  const e = 1e-3;
  const inside = (x: number, y: number): boolean => inZone(rects, x, y);
  return zoneOutline(rects).map(([x0, y0, x1, y1]): Rect => {
    if (y0 === y1) {
      const down = inside((x0 + x1) / 2, y0 + e) ? 1 : -1; // covered side
      const a = inside(x0 - e, y0 + down * e) ? -inset : inset;
      const b = inside(x1 + e, y0 + down * e) ? inset : -inset;
      const y = y0 * ch + down * inset;
      return [x0 * cw + a, y, x1 * cw + b, y];
    }
    const right = inside(x0 + e, (y0 + y1) / 2) ? 1 : -1;
    const a = inside(x0 + right * e, y0 - e) ? -inset : inset;
    const b = inside(x0 + right * e, y1 + e) ? inset : -inset;
    const x = x0 * cw + right * inset;
    return [x, y0 * ch + a, x, y1 * ch + b];
  });
}

/**
 * Where an arrow from a zone to a state outside it starts: the nearest point
 * of the zone straight above, below, left or right of the state's center
 * (cell units), or null when none is within `reach` cells.
 */
export function zoneExit(rects: Rect[], x: number, y: number, reach = 6): Pt | null {
  const step = 0.01;
  let best: Pt | null = null;
  let bestD = Infinity;
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    for (let d = step; d <= reach && d < bestD; d += step) {
      if (inZone(rects, x + dx * d, y + dy * d)) {
        bestD = d;
        best = [x + dx * (d - step), y + dy * (d - step)];
        break;
      }
    }
  }
  return best;
}
