/* 使用 node-canvas 真实渲染 chart.js，输出 PNG 并校验画面非空 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
let canvasImpl;
try {
  canvasImpl = require('canvas');
} catch (err) {
  console.log('跳过真实渲染测试（未安装 node-canvas）：' + err.message);
  process.exit(0);
}
const { createCanvas, Image } = canvasImpl;

global.window = { devicePixelRatio: 1 };
const Core = require('../js/core.js');
const Chart = require('../js/chart.js');

const canvas = createCanvas(1100, 420);
Object.defineProperty(canvas, 'clientWidth', { value: 1100, configurable: true });
Object.defineProperty(canvas, 'clientHeight', { value: 420, configurable: true });
canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1100, height: 420 });

const series = Core.generateSeries();
const result = Core.repairSeries(series.points, series.segments);
const meta = Chart.draw(canvas, series.points, series.segments, result.points);
assert.ok(meta.sc && meta.range, 'draw 应返回坐标与量程');

const png = canvas.toBuffer('image/png');
const outFile = path.join(__dirname, 'chart-render.png');
fs.writeFileSync(outFile, png);

const img = new Image();
img.src = png;
const probe = createCanvas(img.width, img.height);
const ctx = probe.getContext('2d');
ctx.drawImage(img, 0, 0);
const data = ctx.getImageData(0, 0, img.width, img.height).data;
let painted = 0;
for (let i = 3; i < data.length; i += 4) {
  if (data[i] > 0) painted++;
}
assert.ok(painted > 5000, '画布应包含大量已绘制像素，实际 ' + painted);

const hit = Chart.hitTest(canvas, { clientX: 300, clientY: 100 }, meta.sc, meta.range, series.points);
assert.ok(hit >= 0 && hit < series.points.length, 'hitTest 应返回合法索引');

const edgeSeries = Core.generateSeries({
  segments: [{ id: 'Z', type: 'gap_short', start: 0, end: 2, strategy: 'linear' }],
  count: 30
});
const edgeResult = Core.repairSeries(edgeSeries.points, edgeSeries.segments);
assert.ok(edgeResult.points.slice(0, 3).every(p => p.status === 'replaced'),
  '边界缺测也应被填充（退化为保持后值）');
Chart.draw(canvas, edgeSeries.points, edgeSeries.segments, edgeResult.points);

console.log('真实 Canvas 渲染通过，已输出截图：' + outFile + '（绘制像素 ' + painted + '）');
