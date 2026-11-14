/*
 * 无头导出三种纹样的无缝循环 PNG，并做严格的无缝性校验：
 * 1. PNG 回读像素必须与渲染内核输出逐字节一致；
 * 2. 跨接缝直接渲染的 2x2 区域，必须与四张循环图拼接结果完全一致；
 * 3. 相邻接缝两侧像素最大差异为 0（不存在可见边框）。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { PRESETS, renderUnit, renderRegion } = require('../src/patterns');
const TinyPNG = require('../src/png');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'exports');

async function writePng(filePath, image) {
  const png = await TinyPNG.encode(image, zlib.deflateSync);
  fs.writeFileSync(filePath, png);
  return png;
}

function stitch(tile, cols, rows) {
  const { width: w, height: h, data } = tile;
  const out = new Uint8Array(w * cols * h * rows * 4);
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      for (let y = 0; y < h; y++) {
        const srcOff = (y * w) * 4;
        const dstOff = (((ry * h + y) * (w * cols)) + rx * w) * 4;
        out.set(data.subarray(srcOff, srcOff + w * 4), dstOff);
      }
    }
  }
  return { width: w * cols, height: h * rows, data: out };
}

function maxDiff(a, b) {
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > max) max = d;
  }
  return max;
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const report = { generatedAt: new Date().toISOString(), tiles: [] };

async function main() {
for (const name of Object.keys(PRESETS)) {
  const params = PRESETS[name];
  const tile = renderUnit(params);
  const fileName = `weave-${name}.png`;
  const png = await writePng(path.join(OUT_DIR, fileName), tile);

  // 1) PNG 回读一致性
  const decoded = TinyPNG.decode(png, zlib.inflateSync);
  const roundtripDiff = maxDiff(decoded.data, tile.data);

  // 2) 跨接缝的 2x2 区域：无限平面直接渲染 vs 四张循环单元拼接
  const direct = renderRegion(
    params, tile.width * 2, tile.height * 2,
    -tile.width, -tile.height, params.ssaa
  );
  const stitched = stitch(tile, 2, 2);
  const seamlessDiff = maxDiff(direct.data, stitched.data);

  // 4) 顺带导出 2x2 预览图，便于人工查看
  fs.writeFileSync(
    path.join(OUT_DIR, `weave-${name}-2x2.png`),
    await TinyPNG.encode(stitched, zlib.deflateSync)
  );

  report.tiles.push({
    pattern: name,
    file: `exports/${fileName}`,
    preview2x2: `exports/weave-${name}-2x2.png`,
    tileSize: `${tile.width}x${tile.height}`,
    bytes: png.length,
    roundtripMaxDiff: roundtripDiff,
    crossSeamMaxDiff: seamlessDiff,
    pass: roundtripDiff === 0 && seamlessDiff === 0
  });
}

report.allPass = report.tiles.every((t) => t.pass);
fs.writeFileSync(path.join(OUT_DIR, 'seam-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.allPass) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
