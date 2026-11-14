// UI 冒烟测试：在无头 Chrome 中真实点击 Canvas 节点，验证旋转/交换与成功判定。

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
    args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (err) => { throw err; });
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#stage');

    const boardSnapshot = () => page.evaluate(() =>
      window.app.board.map((card) => `${card.type}:${card.mode}`));

    const initial = await boardSnapshot();
    assert(initial[0].startsWith('delay'), `初始板首槽应为延迟，实际 ${initial[0]}`);

    // 点击第一张卡片中心两次：第一次选中，第二次旋转档位。
    const rect = await page.evaluate(() => {
      const r = window.app.renderer.cardRects[0];
      const box = document.getElementById('stage').getBoundingClientRect();
      return {
        x: box.left + (r.x + r.w / 2) * (box.width / 1080),
        y: box.top + (r.y + r.h / 2) * (box.height / 560),
      };
    });
    await page.mouse.click(rect.x, rect.y);
    await page.mouse.click(rect.x, rect.y);
    const rotated = await boardSnapshot();
    assert(rotated[0] === 'delay:1', `旋转后延迟应为档位 1，实际 ${rotated[0]}`);

    // 依次点击槽位 1 和槽位 2，验证交换。
    const rects = await page.evaluate(() => {
      const box = document.getElementById('stage').getBoundingClientRect();
      return window.app.renderer.cardRects.map((r) => ({
        x: box.left + (r.x + r.w / 2) * (box.width / 1080),
        y: box.top + (r.y + r.h / 2) * (box.height / 560),
      }));
    });
    await page.mouse.click(rects[0].x, rects[0].y);
    await page.mouse.click(rects[1].x, rects[1].y);
    const swapped = await boardSnapshot();
    assert(swapped[0].startsWith('gain') && swapped[1].startsWith('delay'),
      `交换后槽位 1/2 应为增益/延迟，实际 ${swapped.join(', ')}`);

    // 直接套用正确解（模拟玩家完成全部旋转+交换），检查成功横幅与判定。
    await page.evaluate(() => window.app.applySolvedBoard());
    const banner = await page.$eval('#banner', (el) => el.textContent);
    const solvedFlag = await page.evaluate(() => window.app.solved);
    assert(solvedFlag === true, 'applySolvedBoard 后 solved 应为 true');
    assert(banner.includes('修复成功'), `成功横幅文案不符：${banner}`);

    // 复位应回到固定故障板。
    await page.click('#reset-btn');
    const resetBoard = await boardSnapshot();
    assert(resetBoard[0].startsWith('delay') && resetBoard[0].endsWith(':0'),
      `复位后应回到故障板，实际 ${resetBoard.join(', ')}`);

    console.log('UI 冒烟测试通过：旋转、交换、成功判定、复位均正常。');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
