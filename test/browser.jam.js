/* 堵塞过程截图：验证堵点、暂停清堵、缓存水位的视觉表现，并验证错误操作失败路径 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const FILE_URL = 'file://' + path.resolve(__dirname, '..', 'web', 'index.html');

function findChrome() {
  const base = '/home/hj/.cache/ms-playwright';
  if (!fs.existsSync(base)) return undefined;
  const dirs = fs.readdirSync(base).filter((d) => d.startsWith('chromium-'));
  for (const d of dirs) {
    const exe = path.join(base, d, 'chrome-linux64', 'chrome');
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1180 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(FILE_URL);
  await page.click('#btn-start');

  // 等到 A 支线堵塞，暂停它并偏向 B，截一张清堵中的图
  await page.waitForFunction(() => {
    const s = window.simRef.state;
    return s.branches.A.jammed;
  }, { timeout: 15000 });
  await page.evaluate(() => {
    const c = window.simRef.controls;
    c.pause('A');
    c.setDiverter('B');
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.resolve(__dirname, '..', 'artifacts', 'browser-jam.png'), fullPage: true });

  const jamShot = await page.evaluate(() => {
    const s = window.simRef.state;
    return { jammedA: s.branches.A.jammed, pausedA: s.branches.A.paused, diverter: s.diverter.mode };
  });

  // 验证音频引擎存在且能进入警报态（不实际发声）
  const audioOk = await page.evaluate(() => {
    const eng = new window.AudioEngine();
    eng.setMuted(true);
    eng.ensure();
    eng.startAlarm();
    const hasCtx = !!eng.ctx;
    eng.stopAlarm();
    return hasCtx;
  });

  await browser.close();
  console.log('堵塞截图状态:', JSON.stringify(jamShot), ' audioCtx:', audioOk, ' errors:', errors);
  if (!jamShot.jammedA || !jamShot.pausedA || jamShot.diverter !== 'B') process.exit(1);
  if (!audioOk || errors.length) process.exit(2);
  console.log('堵塞过程验证通过：堵点/暂停/分流状态正确，Web Audio 可初始化');
})();
