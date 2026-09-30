// Digital and mixed-signal graphs (CHART-102, CHART-103): decoding of the
// data message, bus values and the cursor readout, the front-end ports of
// DigitalWaveformGraph.bus_values / values_at
// (src/anywidget_instruments_industrial/_graphs.py), checked against
// tests/parity/digital.json.
import { type BufferLike, toFloat32, toUint8 } from "../core/buffers.js";

export interface DigitalData {
  /** Logic levels, row-major (nSamples, nLines). */
  bits: Uint8Array;
  nSamples: number;
  nLines: number;
  /** Analog samples, row-major (nAnalog, nTraces). */
  analog: Float32Array;
  nAnalog: number;
  nTraces: number;
}

export const EMPTY_DATA: DigitalData = { bits: new Uint8Array(0), nSamples: 0, nLines: 0, analog: new Float32Array(0), nAnalog: 0, nTraces: 0 };

const count = (v: unknown): number => Math.max(0, Math.floor(Number(v) || 0));

/** Data of a data message; sample counts are bounded by the buffers received. */
export function decodeDigital(msg: { n_samples?: unknown; n_lines?: unknown; n_analog?: unknown; n_traces?: unknown }, buffers: BufferLike[] | undefined): DigitalData {
  const bits = toUint8(buffers?.[0]);
  const analog = toFloat32(buffers?.[1]);
  const nLines = count(msg.n_lines);
  const nTraces = count(msg.n_traces);
  return {
    bits,
    nLines,
    nSamples: nLines ? Math.min(count(msg.n_samples), Math.floor(bits.length / nLines)) : 0,
    analog,
    nTraces,
    nAnalog: nTraces ? Math.min(count(msg.n_analog), Math.floor(analog.length / nTraces)) : 0,
  };
}

/** Integer value of a bus (first listed line = MSB) at sample i. */
export function busValue(bits: Uint8Array, nLines: number, lines: readonly number[], i: number): number {
  let v = 0;
  for (const l of lines) v = v * 2 + (bits[i * nLines + l] ? 1 : 0);
  return v;
}

/** Hexadecimal text of a bus value, as the readouts show it. */
export const hex = (v: number): string => `0x${v.toString(16).toUpperCase()}`;

/** Lines of a bus that exist in the data (a host may name missing ones). */
export function busLines(bus: { lines?: unknown }, nLines: number): number[] {
  return (Array.isArray(bus.lines) ? bus.lines : []).map(Number).filter((l) => Number.isInteger(l) && l >= 0 && l < nLines);
}

/** Sample shown at x-axis position `x`. */
export function sampleAt(x: number, x0: number, dt: number): number {
  return dt ? Math.floor((x - x0) / dt) : 0;
}

/** Values at x: each line level, each bus in hexadecimal, then each analog trace. */
export function digitalValuesAt(d: DigitalData, x: number, { x0, dt, buses }: { x0: number; dt: number; buses: ReadonlyArray<{ lines?: unknown }> }): Array<number | string> {
  const i = sampleAt(x, x0, dt);
  const out: Array<number | string> = [];
  if (i >= 0 && i < d.nSamples) {
    for (let l = 0; l < d.nLines; l++) out.push(d.bits[i * d.nLines + l]);
    for (const b of buses) out.push(hex(busValue(d.bits, d.nLines, busLines(b, d.nLines), i)));
  }
  if (i >= 0 && i < d.nAnalog) for (let j = 0; j < d.nTraces; j++) out.push(d.analog[i * d.nTraces + j]);
  return out;
}

/** Runs of constant value: [{ start, end, value }] over samples [i0, i1). */
export function runs<V>(valueAt: (i: number) => V, i0: number, i1: number): Array<{ start: number; end: number; value: V }> {
  const out: Array<{ start: number; end: number; value: V }> = [];
  if (i1 <= i0) return out;
  let start = i0;
  let cur = valueAt(i0);
  for (let i = i0 + 1; i < i1; i++) {
    const v = valueAt(i);
    if (v !== cur) {
      out.push({ start, end: i, value: cur });
      start = i;
      cur = v;
    }
  }
  out.push({ start, end: i1, value: cur });
  return out;
}
