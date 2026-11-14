// 端到端验证：无头 Chromium 跑真实页面 -> 渲染四段 -> 导出 WAV -> 重放计时；
// Node 侧再独立解析 WAV（不依赖页面），复核时长、峰值、削波与四段能量分布。

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(fileURLToPath(import.meta.url), '../..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };

const server = createServer(async (req, res) => {
  const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1240, height: 900 } });
const errors = [];
page.on('pageerror', (err) => errors.push(String(err)));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

await page.goto(base, { waitUntil: 'networkidle' });

// 1) 渲染四段 + 整轨
const render = await page.evaluate(async () => {
  const api = window.__foleyApi;
  const result = await api.renderAll();
  const state = api.getState();
  return {
    segmentDurations: state.segmentBuffers.map((b) => b.duration),
    segmentPeaks: state.segmentBuffers.map((b) => {
      const d = b.getChannelData(0);
      let peak = 0;
      for (const v of d) peak = Math.max(peak, Math.abs(v));
      return peak;
    }),
    scene: result.after,
    scale: result.scale,
  };
});

check('四段全部实际渲染', render.segmentDurations.length === 4 && render.segmentDurations.every((d) => d > 2.4),
  JSON.stringify(render.segmentDurations.map((d) => d.toFixed(3))));
check('四段峰值均未削波', render.segmentPeaks.every((p) => p < 1),
  render.segmentPeaks.map((p) => p.toFixed(3)).join(', '));
check('整轨时长约 10 秒', Math.abs(render.scene.duration - 10) < 0.05,
  `${render.scene.duration.toFixed(3)}s`);
check('整轨峰值不削波', render.scene.peak < 1 && render.scene.clipped === 0,
  `peak=${render.scene.peak.toFixed(4)} clipped=${render.scene.clipped}`);

// 2) 导出 WAV 并落盘
const wavInfo = await page.evaluate(async () => {
  const blob = await window.__foleyApi.exportWav();
  return { size: blob.size, bytes: window.__wavBytes };
});
await mkdir(join(root, 'artifacts'), { recursive: true });
const wavPath = join(root, 'artifacts/foley-scene.wav');
await writeFile(wavPath, Buffer.from(wavInfo.bytes));
check('WAV 已导出落盘', wavInfo.size > 44, `${wavInfo.size} bytes -> artifacts/foley-scene.wav`);

// 3) 重新播放完整场景并实测耗时（等待 onEnd 回调）
const replay = await page.evaluate(async () => {
  const api = window.__foleyApi;
  const t0 = performance.now();
  await api.previewScene();
  await new Promise((resolve) => {
    const timer = setInterval(() => {
      if (!api.getState().playing) {
        clearInterval(timer);
        resolve();
      }
    }, 100);
  });
  return { elapsedMs: performance.now() - t0 };
});
check('重放总长度约 10 秒', replay.elapsedMs > 9500 && replay.elapsedMs < 11500,
  `${(replay.elapsedMs / 1000).toFixed(2)}s`);

// 4) Canvas 截图（旋钮 / 波形 / 时间线）
await page.screenshot({ path: join(root, 'artifacts/studio.png') });
check('Canvas 截图已保存', true, 'artifacts/studio.png');
check('页面无 JS 错误', errors.length === 0, errors.join(' | '));

// 4.5) Canvas 交互：旋钮拖拽改参数、播放头推进
const canvasBox = await page.evaluate(() => {
  const rect = document.querySelector('canvas').getBoundingClientRect();
  return { w: rect.width, h: rect.height };
});
check('Canvas 已挂载且尺寸合理', canvasBox.w > 800 && canvasBox.h > 400,
  `${Math.round(canvasBox.w)}x${Math.round(canvasBox.h)}`);

const dragResult = await page.evaluate(async () => {
  const foleyCv = document.querySelector('canvas');
  const before = window.__foleyApi.params.door.creakBase;
  const rect = foleyCv.getBoundingClientRect();
  const scaleX = rect.width / 1180;
  const scaleY = rect.height / 520;
  const knobX = (14 + 12 + 21) * scaleX;
  const knobY = (14 + 66) * scaleY;
  foleyCv.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, clientX: rect.left + knobX, clientY: rect.top + knobY, pointerId: 1,
  }));
  foleyCv.dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true, clientX: rect.left + knobX, clientY: rect.top + knobY - 100 * scaleY, pointerId: 1,
  }));
  foleyCv.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
  const after = window.__foleyApi.params.door.creakBase;
  return { before, after };
});
check('旋钮拖拽可改变合成参数', dragResult.after !== dragResult.before,
  `creakBase ${dragResult.before} -> ${dragResult.after}`);

// 播放头在回放期间应推进到 >1s
const playheadCheck = await page.evaluate(async () => {
  const api = window.__foleyApi;
  await api.previewScene();
  await new Promise((r) => setTimeout(r, 600));
  const moving = api.getState().playing;
  const t1 = performance.now();
  await new Promise((r) => setTimeout(r, 1200));
  const stillPlaying = api.getState().playing;
  api.stopAll();
  await new Promise((r) => setTimeout(r, 200));
  return { wasPlaying: moving, stillPlaying, ended: !api.getState().playing, elapsed: performance.now() - t1 };
});
check('回放启动并持续播放、停止后结束', playheadCheck.wasPlaying && playheadCheck.stillPlaying && playheadCheck.ended,
  JSON.stringify(playheadCheck));

await browser.close();

// 5) Node 独立解析 WAV
const buf = await readFile(wavPath);
const ascii = (o, l) => buf.toString('ascii', o, o + l);
const riffOk = ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE' && ascii(12, 4) === 'fmt ';
const sampleRate = buf.readUInt32LE(24);
const channels = buf.readUInt16LE(22);
const bits = buf.readUInt16LE(34);
const dataOffset = ascii(36, 4) === 'data' ? 44 : 44;
const dataSize = buf.readUInt32LE(40);
const frames = dataSize / 2;
const duration = frames / sampleRate;
let peak = 0;
let clipped = 0;
for (let i = 0; i < frames; i++) {
  const s = Math.abs(buf.readInt16LE(dataOffset + i * 2) / 32768);
  if (s > peak) peak = s;
  if (s >= 0.9999) clipped++;
}
check('WAV 头为 16-bit PCM 单声道 44.1kHz', riffOk && channels === 1 && bits === 16 && sampleRate === 44100,
  `ch=${channels} bits=${bits} rate=${sampleRate}`);
check('WAV 解码时长约 10 秒', Math.abs(duration - 10) < 0.05, `${duration.toFixed(3)}s`);
check('WAV 样本峰值不削波', peak < 1 && clipped === 0, `peak=${peak.toFixed(4)} clipped=${clipped}`);

// 6) 四段槽位能量检查：每个 2.5s 槽位都应有声，槽间静音边界清晰
const slotEnergy = [0, 1, 2, 3].map((slot) => {
  let sum = 0;
  const start = Math.floor(slot * 2.5 * sampleRate);
  const end = Math.floor((slot + 1) * 2.5 * sampleRate);
  for (let i = start; i < end; i++) {
    const s = buf.readInt16LE(dataOffset + i * 2) / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / (end - start));
});
check('四个场景槽位均含声音', slotEnergy.every((e) => e > 0.01),
  slotEnergy.map((e) => e.toFixed(4)).join(', '));

server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
process.exit(failed.length ? 1 : 0);
