// 验证：冷色调两端、时间演化（扭动）与参数响应。
import { createCanvas } from '@napi-rs/canvas';
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuroraEngine, BUFFER_WIDTH, BUFFER_HEIGHT } from '../src/engine.js';
import { hashSeed } from '../src/prng.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'artifacts');
const SCALE = 4;

async function shot(overrides, name) {
  const buffer = createCanvas(BUFFER_WIDTH, BUFFER_HEIGHT);
  const engine = new AuroraEngine(buffer, { seed: 20261114, ...overrides });
  engine.renderAt(overrides.time ?? 9.5);
  const out = createCanvas(BUFFER_WIDTH * SCALE, BUFFER_HEIGHT * SCALE);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(buffer, 0, 0, out.width, out.height);
  await writeFile(join(OUT, name), await out.encode('png'));
}

await shot({ cool: 0 }, 'check-cool-0.png');
await shot({ cool: 1 }, 'check-cool-1.png');
await shot({ time: 0 }, 'check-time-0.png');
await shot({ time: 20 }, 'check-time-20.png');

// 时间演化：同一 seed 在不同时间的逐帧遮罩必须不同，且星空保持稳定（同 seed）。
function pixelBuffer(overrides) {
  const buffer = createCanvas(BUFFER_WIDTH, BUFFER_HEIGHT);
  const engine = new AuroraEngine(buffer, { seed: 20261114, ...overrides });
  engine.renderAt(overrides.time ?? 9.5);
  return buffer.getContext('2d').getImageData(0, 0, BUFFER_WIDTH, BUFFER_HEIGHT).data;
}

function diffRatio(a, b) {
  let diff = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 12) diff++;
  }
  return +((diff / (a.length / 4)) * 100).toFixed(2);
}

const t0 = pixelBuffer({ time: 0 });
const t20 = pixelBuffer({ time: 20 });
const t0Again = pixelBuffer({ time: 0 });

// 性能：单帧渲染耗时（内部缓冲分辨率）。
const perfBuffer = createCanvas(BUFFER_WIDTH, BUFFER_HEIGHT);
const perfEngine = new AuroraEngine(perfBuffer, { seed: 20261114 });
const start = performance.now();
for (let i = 0; i < 60; i++) perfEngine.renderAt(i * 0.016);
const msPerFrame = +(((performance.now() - start) / 60)).toFixed(2);

console.log(
  JSON.stringify(
    {
      seedHash: hashSeed(20261114),
      changedPixelsOverTimePct: diffRatio(t0, t20),
      identicalOnRerenderPct: 100 - diffRatio(t0, t0Again),
      msPerFrame,
    },
    null,
    2,
  ),
);
