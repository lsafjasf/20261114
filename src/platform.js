// Platform shim: the same rendering code runs in a browser and under
// node-canvas. Node loads the native module lazily so bundlers never need it.

export const hasPerformance = typeof performance !== "undefined";

export function nowMs() {
  if (hasPerformance) return performance.now();
  const hr = process.hrtime();
  return hr[0] * 1000 + hr[1] / 1e6;
}

export async function nodeCreateCanvas(width, height) {
  const { createCanvas } = await import("canvas");
  return createCanvas(width, height);
}
