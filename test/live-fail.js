// 实时链路测试：用真实 AudioContext 跑故障板，验证持续过载 5 秒后引擎判失败并挂起。

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

async function main() {
  const server = await startStaticServer();
  const port = server.address().port;
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required',
      '--use-fake-audio-stream-capture'],
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (err) => { throw err; });
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.app');
    await page.click('#start-btn');
    await page.waitForFunction('window.app.running === true');

    // 故障板持续过载，最长等 16 秒，失败后 onFail 会挂起 AudioContext。
    await page.waitForFunction('window.app.status.failed === true', { timeout: 30000 });
    const state = await page.evaluate(() => ({
      failed: window.app.engine.failed,
      ctxState: window.app.ctx.state,
      running: window.app.running,
      overloadSeconds: window.app.status.overloadSeconds,
      banner: document.getElementById('banner').textContent,
    }));
    assert(state.failed === true, '引擎应标记 failed');
    assert(state.ctxState === 'suspended', `失败后音频上下文应挂起，实际 ${state.ctxState}`);
    assert(state.running === false, '失败后运行标志应为 false');
    assert(state.overloadSeconds >= 5, `过载计时应达到 5 秒，实际 ${state.overloadSeconds}`);
    assert(state.banner.includes('失败'), `横幅应提示失败，实际：${state.banner}`);
    console.log('实时失败流程通过：故障板持续过载 5 秒后判失败并静音挂起。', JSON.stringify(state));
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
