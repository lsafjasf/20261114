/* 真实浏览器冒烟测试：Playwright 打开页面，按恢复策略操作并验证通关，截图存 artifacts/ */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const FILE_URL = 'file://' + path.resolve(__dirname, '..', 'web', 'index.html');

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    path.join(process.env.HOME || '', '.cache/ms-playwright'),
    '/home/hj/.cache/ms-playwright',
  ].filter(Boolean);
  for (const base of candidates) {
    if (!fs.existsSync(base)) continue;
    if (base.endsWith('chrome') && fs.existsSync(base)) return base;
    const dirs = fs.readdirSync(base).filter((d) => d.startsWith('chromium-'));
    for (const d of dirs) {
      const exe = path.join(base, d, 'chrome-linux64', 'chrome');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return undefined;
}

(async () => {
  const exePath = findChrome();
  const browser = await chromium.launch(exePath ? { executablePath: exePath, args: ['--no-sandbox'] } : {});
  const page = await browser.newPage({ viewport: { width: 1080, height: 1180 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(FILE_URL);
  await page.waitForSelector('canvas');
  await page.click('#btn-start');

  // 轮询内核状态，按“暂停清堵→分流→低速重启→排空→恢复常速”策略操作
  await page.waitForFunction(() => {
    const s = window.simRef ? window.simRef.state : null;
    return s && s.time > 1;
  }, { timeout: 3000 }).catch(() => {});

  // 通过页面内暴露的 sim 引用驱动（若未暴露则退化为按钮点击）
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      const timer = setInterval(() => {
        const sim = window.simRef;
        if (!sim) { resolve(); return; }
        const s = sim.state;
        const c = sim.controls;
        const A = s.branches.A;
        const B = s.branches.B;
        if (s.status !== 'running') { clearInterval(timer); resolve(); return; }
        if (A.jammed && !A.paused) { c.pause('A'); c.setDiverter('B'); }
        if (B.jammed && !B.paused) { c.pause('B'); c.setDiverter('A'); }
        if (A.paused && !A.jammed && A.resumeTimer === 0 && B.paused === false) {
          c.setSpeed('slow'); c.resume('A'); c.setDiverter('AUTO');
        }
        if (B.paused && !B.jammed && B.resumeTimer === 0 && A.paused === false && A.flushed) {
          c.setSpeed('slow'); c.resume('B'); c.setDiverter('AUTO');
        }
        if (A.flushed && B.flushed && s.speed !== 'normal') c.setSpeed('normal');
        if (s.time > 120) { clearInterval(timer); resolve(); }
      }, 60);
    });
  });

  await page.waitForTimeout(500);
  const finalState = await page.evaluate(() => window.simRef ? {
    status: window.simRef.state.status,
    goods: window.simRef.state.goods,
    switches: window.simRef.state.switches,
    time: window.simRef.state.time,
    failReason: window.simRef.state.failReason,
    flushedA: window.simRef.state.branches.A.flushed,
    flushedB: window.simRef.state.branches.B.flushed,
  } : null);

  await page.screenshot({ path: path.resolve(__dirname, '..', 'artifacts', 'browser-final.png'), fullPage: true });

  console.log('浏览器终态:', JSON.stringify(finalState));
  if (errors.length) console.log('页面错误:', errors);
  await browser.close();

  if (!finalState || finalState.status !== 'won' || finalState.goods !== 10) {
    console.error('冒烟测试失败：未在浏览器中通关');
    process.exit(1);
  }
  if (errors.length) process.exit(2);
  console.log('浏览器冒烟测试通过：页面无错误，模拟在真实浏览器中通关');
})();
