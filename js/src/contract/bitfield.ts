// BitField word (IND-111, IND-112): the front-end port of BitField.toggle_bit
// and BitField.active_bits (src/anywidget_instruments/_bitfield.py), checked
// against tests/parity/bitfield.json.

/** The word limited to its `bits` (unsigned; a host may send a larger value). */
export function wordOf(value: number, bits: number): number {
  const v = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  return bits >= 32 ? v % 2 ** 32 : v % 2 ** bits;
}

/** State of bit `n` of `value`. */
export function bitOf(value: number, n: number): boolean {
  return Math.floor(value / 2 ** n) % 2 === 1;
}

/** Word with bit `n` inverted (IND-112). */
export function toggleBit(value: number, n: number, bits: number): number {
  const v = wordOf(value, bits);
  return bitOf(v, n) ? v - 2 ** n : v + 2 ** n;
}

/** Numbers of the bits that are set, least significant first. */
export function activeBits(value: number, bits: number): number[] {
  const v = wordOf(value, bits);
  return Array.from({ length: bits }, (_, n) => n).filter((n) => bitOf(v, n));
}
