// 无头验证：真实 Chromium 中加载页面，用同一 seed 验证一次成功 + 一次失真失败。
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const seed = process.argv[2] || '20261114';

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
  const filePath = path.join(process.cwd(), decodeURIComponent(urlPath));
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const pageUrl = `http://127.0.0.1:${port}/index.html`;

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream'],
});
const context = await browser.newContext();
const page = await context.newPage();
page.on('console', (msg) => console.log(`[browser:${msg.type()}]`, msg.text()));
page.on('pageerror', (err) => {
  console.error('[pageerror]', err.message);
  process.exitCode = 1;
});

await page.goto(pageUrl);
await page.waitForFunction(() => !!window.__app);

// 先校验 seed 决定的三组频率是确定的
const freqCheck = await page.evaluate(async (s) => {
  const { pickFrequencies } = await import('/src/rng.js');
  const a = pickFrequencies(s);
  const b = pickFrequencies(s);
  const c = pickFrequencies(s + 'x');
  return { a, b, c, deterministic: JSON.stringify(a) === JSON.stringify(b), differs: JSON.stringify(a) !== JSON.stringify(c) };
}, seed);
console.log('seed 频率检查:', JSON.stringify(freqCheck));
if (!freqCheck.deterministic || !freqCheck.differs) {
  console.error('FAIL: seed 确定性不成立');
  process.exitCode = 1;
}

const result = await page.evaluate(async (s) => {
  const logs = [];
  const r = await window.__app.runVerification(s, (m) => logs.push(m));
  return { ...r, logs };
}, seed);

console.log('\n===== 自检日志 =====');
for (const line of result.logs) console.log(line);
console.log('====================');
console.log('success 局 state:', result.first.state,
  '| 残余:', (result.first.residualRatio * 100).toFixed(1) + '%',
  '| 失真:', result.first.distortion.toFixed(1) + '%');
console.log('failure 局 state:', result.second.state,
  '| 失真:', result.second.distortion.toFixed(1) + '%');

const ok = result.pass && freqCheck.deterministic && freqCheck.differs;
console.log(ok ? '\nVERIFY PASS' : '\nVERIFY FAIL');

await context.close();
await browser.close();
server.close();
process.exit(ok ? 0 : 1);
