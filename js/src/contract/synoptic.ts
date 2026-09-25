// SynopticCanvas background (SCADA-010): the type of an image from its
// first bytes, the front-end port of SynopticCanvas._check_background
// (src/anywidget_instruments/_process.py), checked against
// tests/parity/synoptic.json.

export type ImageMime = "image/png" | "image/jpeg" | "image/svg+xml";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

const startsWith = (b: Uint8Array, sig: number[]): boolean => b.length >= sig.length && sig.every((v, i) => b[i] === v);

/** PNG, JPEG or SVG (an "<svg" in the first 2 kB), or "" when the bytes are none of them. */
export function imageMime(bytes: Uint8Array): ImageMime | "" {
  if (!bytes.length) return "";
  if (startsWith(bytes, PNG)) return "image/png";
  if (startsWith(bytes, JPEG)) return "image/jpeg";
  const head = bytes.subarray(0, 2048);
  for (let i = 0; i + 4 <= head.length; i++) {
    if (head[i] === 0x3c && head[i + 1] === 0x73 && head[i + 2] === 0x76 && head[i + 3] === 0x67) return "image/svg+xml"; // "<svg"
  }
  return "";
}
