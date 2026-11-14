// UI 端到端：真人式点击与拖动滑块，验证成功局、重开、再到失真失败。
// 注意：页面本身不显示噪声频率，这里通过引擎内部参数读取目标值来模拟"对准"操作。
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
  fs.readFile(path.join(process.cwd(), decodeURIComponent(p)), (err, data) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(p)] || 'text/plain' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${port}/index.html`);

// 1) 点击启动，确认频谱画布在绘制
await page.click('#startBtn');
await page.waitForFunction(() => {
  const c = document.getElementById('spectrum');
  return c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data.length === 4;
});

// 2) 模拟玩家把前三段陷波器拖到噪声频率（从引擎内部取目标，UI 上无标注）
const targets = await page.evaluate(() => window.__app.getEngine().noiseFrequencies);
const setNotchUi = (i, freq, q) => page.evaluate(({ i, freq, q }) => {
  const unit = document.querySelectorAll('#notchRack .unit')[i];
  const ranges = unit.querySelectorAll('input[type=range]');
  ranges[0].value = freq;
  ranges[0].dispatchEvent(new Event('input', { bubbles: true }));
  ranges[1].value = q;
  ranges[1].dispatchEvent(new Event('input', { bubbles: true }));
}, { i, freq, q });
for (let i = 0; i < 3; i++) {
  await setNotchUi(i, targets[i], 2);
  await page.waitForTimeout(300);
}

await page.waitForSelector('#verdict.won', { timeout: 15000 });
const winText = await page.textContent('#verdict');

// 3) 同 seed 重开，确认状态清零
await page.click('#restartBtn');
await page.waitForFunction(() => window.__app.getEngine().distortion === 0);
const restartedFreqs = await page.evaluate(() => window.__app.getEngine().noiseFrequencies);

// 4) 过度调节：所有 Q 拉满、频率来回猛拖、相位拉满，直到失败
await page.evaluate(() => {
  const eng = window.__app.getEngine();
  eng.notches.forEach((_, i) => eng.setNotch(i, { q: 40 }));
  eng.phases.forEach((_, i) => eng.setPhase(i, { wet: 1, phaseDeg: 180 }));
});
for (let sweep = 0; sweep < 60; sweep++) {
  for (let i = 0; i < 4; i++) {
    await page.evaluate(({ i, freq }) => {
      const ranges = document.querySelectorAll('#notchRack .unit')[i].querySelectorAll('input[type=range]');
      ranges[0].value = freq;
      ranges[0].dispatchEvent(new Event('input', { bubbles: true }));
    }, { i, freq: sweep % 2 ? 3800 - i * 120 : 80 + i * 30 });
  }
  const cls = await page.getAttribute('#verdict', 'class');
  if (cls && cls.includes('failed')) break;
  await page.waitForTimeout(60);
}
await page.waitForSelector('#verdict.failed', { timeout: 15000 });
const failText = await page.textContent('#verdict');

const pass = winText.includes('成功') && failText.includes('失败')
  && JSON.stringify(restartedFreqs) === JSON.stringify(targets) && errors.length === 0;
console.log('成功判定:', winText.trim());
console.log('重开同频:', JSON.stringify(restartedFreqs) === JSON.stringify(targets));
console.log('失败判定:', failText.trim());
console.log('页面错误:', errors.length ? errors : '无');
console.log(pass ? 'UI VERIFY PASS' : 'UI VERIFY FAIL');

await browser.close();
server.close();
process.exit(pass ? 0 : 1);
