// 渲染截图：保存故障板与修复板两张 Canvas 效果图到 artifacts/。

import puppeteer from 'puppeteer';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
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

async function main() {
  const server = await startStaticServer();
  const port = server.address().port;
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1180, height: 820 });
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.app');
    await page.click('#start-btn');
    await page.waitForFunction('window.app.running === true');
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const runningShot = await page.screenshot();
    await writeFile(join(ROOT, 'artifacts/running-faulty.png'), runningShot);
    await page.click('#reset-btn');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const faultyShot = await page.screenshot();
    await writeFile(join(ROOT, 'artifacts/faulty-board.png'), faultyShot);

    await page.evaluate(() => window.app.applySolvedBoard());
    await new Promise((resolve) => setTimeout(resolve, 300));
    const solvedShot = await page.screenshot();
    await writeFile(join(ROOT, 'artifacts/solved-board.png'), solvedShot);
    console.log('截图已保存到 artifacts/faulty-board.png 与 artifacts/solved-board.png');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
