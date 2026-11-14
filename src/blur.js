// Separable Gaussian blur implemented directly on ImageData so the exact
// same softness code runs in the browser and under node-canvas (whose
// ctx.filter support is build-dependent).

function makeKernel(radius, sigma) {
  const kernel = new Float64Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const value = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = value;
    sum += value;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  return kernel;
}

// Blur a single 8-bit channel in place using an intermediate buffer.
export function blurChannel(data, width, height, channelIndex, radius) {
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return;
  const sigma = Math.max(r / 2, 0.5);
  const kernel = makeKernel(r, sigma);
  const stride = 4;
  const tmp = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    const rowStart = y * width;
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) {
        const sx = Math.min(width - 1, Math.max(0, x + k));
        acc += data[(rowStart + sx) * stride + channelIndex] * kernel[k + r];
      }
      tmp[rowStart + x] = acc;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) {
        const sy = Math.min(height - 1, Math.max(0, y + k));
        acc += tmp[sy * width + x] * kernel[k + r];
      }
      data[(y * width + x) * stride + channelIndex] = Math.round(
        Math.min(255, Math.max(0, acc))
      );
    }
  }
}
