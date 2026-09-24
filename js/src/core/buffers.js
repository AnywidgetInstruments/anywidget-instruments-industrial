// Binary buffers received from the kernel (DataView, ArrayBuffer or typed array).

function bytesOf(b) {
  if (!b) return new ArrayBuffer(0);
  if (b instanceof ArrayBuffer) return b;
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

export const toFloat32 = (b) => new Float32Array(bytesOf(b));
export const toUint8 = (b) => new Uint8Array(bytesOf(b));
