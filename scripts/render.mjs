// Node 离线渲染：输出同 seed 可复现画面，以及低 / 高密度对比。
import { createCanvas } from '@napi-rs/canvas';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AuroraEngine, BUFFER_WIDTH, BUFFER_HEIGHT } from '../src/engine.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'artifacts');

// 输出分辨率：内部 320x180 缓冲，上采样 4x 到 1280x720。
const SCALE = 4;
const W = BUFFER_WIDTH * SCALE;
const H = BUFFER_HEIGHT * SCALE;
const FREEZE_TIME = 9.5;

function makeEngine(overrides) {
  const buffer = createCanvas(BUFFER_WIDTH, BUFFER_HEIGHT);
  const engine = new AuroraEngine(buffer, overrides);
  const out = createCanvas(W, H);
  return { engine, buffer, out };
}

async function renderFrame(overrides, file) {
  const { engine, buffer, out } = makeEngine(overrides);
  engine.renderAt(overrides.time ?? FREEZE_TIME);
  const octx = out.getContext('2d');
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(buffer, 0, 0, W, H);
  if (file) await writeFile(join(OUT, file), await out.encode('png'));
  return { buffer, out, file };
}

// 简单的画面统计，用于量化密度差异。
function stats(canvas) {
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let lumSum = 0;
  let greenMask = 0;
  let lit = 0;
  const px = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lumSum += lum;
    if (g > r + 14 && g > 60) greenMask += 1;
    if (lum > 42) lit += 1;
  }
  return {
    meanLuma: +(lumSum / px).toFixed(2),
    litRatio: +((lit / px) * 100).toFixed(2),
    auroraPixelRatio: +((greenMask / px) * 100).toFixed(2),
  };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const seed = 20261114;

  const main = await renderFrame({ seed }, 'aurora-seed-20261114.png');

  // 复现性验证：同 seed / 同参数 / 同冻结时间再渲一次，逐字节比较。
  const again = await renderFrame({ seed });
  const a = await main.out.encode('png');
  const b = await again.out.encode('png');
  const reproducible = Buffer.compare(a, b) === 0;

  const low = await renderFrame({ seed, density: 0.12 }, 'density-low.png');
  const high = await renderFrame({ seed, density: 0.95 }, 'density-high.png');

  // 低 / 高密度左右并排对比图。
  const compare = createCanvas(W * 2 + 24, H + 56);
  const cctx = compare.getContext('2d');
  cctx.fillStyle = '#050a14';
  cctx.fillRect(0, 0, compare.width, compare.height);
  cctx.drawImage(low.out, 0, 48);
  cctx.drawImage(high.out, W + 24, 48);
  cctx.fillStyle = '#9fd4ff';
  cctx.font = '28px sans-serif';
  cctx.fillText('Low density = 0.12', 16, 34);
  cctx.fillText('High density = 0.95', W + 40, 34);
  await writeFile(join(OUT, 'density-comparison.png'), await compare.encode('png'));

  const report = {
    seed,
    freezeTime: FREEZE_TIME,
    outputSize: `${W}x${H}`,
    reproducible,
    lowDensity: { density: 0.12, ...stats(low.out) },
    highDensity: { density: 0.95, ...stats(high.out) },
    main: stats(main.out),
  };
  await writeFile(join(OUT, 'comparison.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
