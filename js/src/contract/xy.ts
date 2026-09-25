// XYGraph cursor readout (IND-115, CHART-104): the front-end port of
// xy_value_at (src/anywidget_instruments/_xygraph.py), checked against
// tests/parity/xy.json.

/**
 * y of a data set at `x`: linear interpolation between its points sorted by
 * x (stable for equal x). NaN outside the x range, for an empty set or a
 * non-finite x; points with a non-finite coordinate are ignored.
 */
export function xyValueAt(xs: ArrayLike<number>, ys: ArrayLike<number>, x: number): number {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) pts.push([xs[i], ys[i]]);
  if (!pts.length || !Number.isFinite(x)) return NaN;
  pts.sort((a, b) => a[0] - b[0]); // Array.prototype.sort is stable
  if (x < pts[0][0] || x > pts[pts.length - 1][0]) return NaN;
  // as numpy.interp: the first point with a larger x bounds the segment
  let k = 0;
  while (k < pts.length - 1 && pts[k + 1][0] <= x) k++;
  if (k === pts.length - 1 || pts[k][0] === x) return pts[k][1];
  const [x0, y0] = pts[k];
  const [x1, y1] = pts[k + 1];
  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}
