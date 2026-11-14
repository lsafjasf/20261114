// 端到端验证：在无头 Chrome 中用 OfflineAudioContext 渲染真实 Web Audio 链路。
// 断言：故障接法持续过载并在 5 秒处判失败；正确接法不过载且回声保留。

import puppeteer from 'puppeteer';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function startStaticServer() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
      try {
        const body = await readFile(join(ROOT, urlPath));
        res.writeHead(200, { 'Content-Type': MIME[extname(urlPath)] || 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// 在页面内执行：离线路径复用 buildOfflineGraph（与实时链路同一套图构建代码）。
const PAGE_SCRIPT = `
(async () => {
  const duration = 12;
  const sr = 44100;
  async function render(board) {
    const ctx = new OfflineAudioContext(1, sr * duration, sr);
    const engine = window.engineModule.buildOfflineGraph(ctx, board, duration);
    const buffer = await ctx.startRendering();
    const data = buffer.getChannelData(0);
    // 按 0.1 秒窗口分析，复刻实时 update() 的过载累计逻辑。
    const windowSize = Math.floor(sr * 0.1);
    let consecutive = 0;
    let failAt = null;
    let overloadStart = null;
    let runStart = null;
    let longestRun = { start: null, windows: 0 };
    const windowPeaks = [];
    for (let start = 0; start < data.length; start += windowSize) {
      let peak = 0;
      for (let i = start; i < Math.min(start + windowSize, data.length); i++) {
        const v = Math.abs(data[i]);
        if (v > peak) peak = v;
      }
      windowPeaks.push(peak);
      if (peak >= 0.995) {
        if (overloadStart === null) overloadStart = start / sr;
        if (consecutive === 0) runStart = start / sr;
        consecutive += 1;
        if (consecutive > longestRun.windows) {
          longestRun = { start: runStart, windows: consecutive };
        }
        if (consecutive >= 50 && failAt === null) failAt = (start + windowSize) / sr;
      } else {
        consecutive = 0;
      }
    }
    // 回声检测：最后一个输入脉冲之后，拖尾里应保留逐次衰减的回声。
    const tailStart = Math.floor(sr * (duration - 4.4));
    const afterLastPing = data.slice(tailStart);
    let echoEnergy = 0;
    for (const v of afterLastPing) echoEnergy += v * v;
    const echoWindow = Math.floor(sr * 0.1);
    const envelope = [];
    for (let k = 0; k < 12; k++) {
      let p = 0;
      for (let i = tailStart + k * echoWindow; i < tailStart + (k + 1) * echoWindow; i++) {
        if (i < data.length && Math.abs(data[i]) > p) p = Math.abs(data[i]);
      }
      envelope.push(p);
    }
    const echoPeaks = envelope
      .map((value, k) => ({ value, k }))
      .filter(({ value, k }) => value > 0.005
        && value >= (envelope[k - 1] ?? 0)
        && value >= (envelope[k + 1] ?? 0))
      .map(({ value }) => value)
      .slice(0, 3);
    return { failAt, overloadStart, longestRun, echoEnergy, echoPeaks, length: data.length };
  }
  const faultyResult = await render(window.modelModule.createFaultyBoard());
  const solvedResult = await render(window.modelModule.createSolvedBoard());
  return { faultyResult, solvedResult, duration, modelSolved: window.modelModule.isSolved(window.modelModule.createSolvedBoard()) };
})()
`;

const assert = (condition, message) => {
  if (!condition) throw new Error(`断言失败: ${message}`);
};

async function main() {
  const server = await startStaticServer();
  const port = server.address().port;
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
    });
    const page = await browser.newPage();
    page.on('pageerror', (err) => { throw err; });
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle0' });
    await page.addScriptTag({ type: 'module', content: `
      import * as modelModule from '/src/model.js';
      import * as engineModule from '/src/engine.js';
      window.modelModule = modelModule;
      window.engineModule = engineModule;
    `});
    await page.waitForFunction('window.modelModule && window.engineModule');
    const result = await page.evaluate(PAGE_SCRIPT);
    console.log(JSON.stringify(result, null, 2));

    const { faultyResult, solvedResult } = result;
    assert(result.modelSolved === true, 'isSolved 应识别正确板');
    assert(faultyResult.failAt !== null, '故障接法必须触发持续过载失败');
    assert(faultyResult.longestRun.windows >= 50,
      `故障接法最长连续过载段应达 50 窗，实际 ${faultyResult.longestRun.windows}`);
    const failDelay = faultyResult.failAt - faultyResult.longestRun.start;
    assert(Math.abs(failDelay - 5) <= 0.2,
      `故障接法应在持续过载 5 秒后失败，实际 ${failDelay}s`);
    assert(solvedResult.failAt === null, '正确接法不得触发过载失败');
    assert(solvedResult.echoEnergy > 0.01, '正确接法必须保留可测量的回声能量');
    assert(solvedResult.echoPeaks.length >= 3, '应检测到至少 3 个回声峰值');
    const [a, b, c] = solvedResult.echoPeaks;
    assert(a > b && b > c && a > 0.01,
      `回声应逐次衰减，实际峰值 ${JSON.stringify(solvedResult.echoPeaks)}`);
    console.log('\n全部验证通过：错误接法 5 秒持续过载失败；修复后不过载且回声衰减保留。');
  } finally {
    await browser?.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
