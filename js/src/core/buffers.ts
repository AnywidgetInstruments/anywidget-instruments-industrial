// Binary buffers received from the host: DataView (anywidget), ArrayBuffer
// (hosts that pass raw buffers) or any typed array.

export type BufferLike = ArrayBuffer | ArrayBufferView | null | undefined;

/** Copy of the bytes, in an ArrayBuffer aligned for any typed array. */
function bytesOf(b: BufferLike): ArrayBuffer {
  if (!b) return new ArrayBuffer(0);
  if (b instanceof ArrayBuffer) return b;
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

export const toFloat32 = (b: BufferLike): Float32Array => new Float32Array(bytesOf(b));
export const toUint8 = (b: BufferLike): Uint8Array => new Uint8Array(bytesOf(b));
export const toFloat64 = (b: BufferLike): Float64Array => new Float64Array(bytesOf(b));
