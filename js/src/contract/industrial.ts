// Resolved defaults of the operator objects (HOST-002, x-awi-resolved):
// the front-end port of the defaults the Python classes resolve when a
// widget is created (_industrial.py). Checked against the shared cases of
// tests/parity/resolved.json.

/**
 * Selected position of a selector: `value` when it is one of `positions`,
 * else `default_position` when it is one, else the middle position (IND-010).
 */
export function selectorValue(positions: readonly string[], value: unknown, defaultPosition: unknown): string {
  if (typeof value === "string" && positions.includes(value)) return value;
  if (typeof defaultPosition === "string" && positions.includes(defaultPosition)) return defaultPosition;
  return positions[Math.floor(positions.length / 2)];
}

/** One state per tier of a stack light: missing states are "off", extra ones dropped (IND-020). */
export function stackStates(tiers: readonly unknown[], value: readonly string[]): string[] {
  return [...value, ...Array<string>(tiers.length).fill("off")].slice(0, tiers.length);
}
