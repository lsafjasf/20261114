// 实时链路测试：正确板在真实 AudioContext 下持续运行不过载，且频谱有持续能量（回声保留）。

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

const assert = (condition, message) => {
  if (!condition) throw new Error(`断言失败: ${message}`);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const server = await startStaticServer();
  const port = server.address().port;
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (err) => { throw err; });
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.app');

    // 先套正确解再通电，避免故障板先触发失败。
    await page.evaluate(() => window.app.applySolvedBoard());
    await page.click('#start-btn');
    await page.waitForFunction('window.app.running === true');

    // 运行 10 秒（覆盖多个输入脉冲与回声周期）。
    await sleep(10000);
    const state = await page.evaluate(() => {
      const spectrum = window.app.engine.getSpectrum();
      let spectralEnergy = 0;
      for (const v of spectrum) spectralEnergy += v;
      return {
        failed: window.app.status.failed,
        overloaded: window.app.status.overloaded,
        peak: window.app.status.peak,
        rms: window.app.status.rms,
        ctxState: window.app.ctx.state,
        spectralEnergy,
        solved: window.app.solved,
      };
    });
    assert(state.failed === false, '正确板不应失败');
    assert(state.ctxState === 'running', `上下文应保持运行，实际 ${state.ctxState}`);
    assert(state.peak < 0.995, `峰值应低于满幅，实际 ${state.peak}`);
    assert(state.spectralEnergy > 1000, '频谱应有持续能量（主信号+回声可闻）');
    assert(state.solved === true, '应处于已修复状态');
    console.log('实时修复流程通过：正确板运行 10 秒不过载，频谱能量持续。', JSON.stringify(state));
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
