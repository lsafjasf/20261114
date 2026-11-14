// 浏览器冒烟测试：加载游戏页面、模拟按键、收集报错、截图
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('file:///home/hj/userfeedback/uid206/index.html');
  await page.waitForTimeout(1500);

  // 模拟操作：转舵、调帆、压舱
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(800);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(600);
  await page.keyboard.up('ArrowUp');
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(600);
  await page.keyboard.up('KeyE');
  await page.keyboard.press('KeyM'); // 静音切换
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(1200);

  const hud = await page.evaluate(() => ({
    leg: document.getElementById('hud-leg').textContent,
    speed: document.getElementById('hud-speed').textContent,
    wind: document.getElementById('hud-wind').textContent,
    heel: document.getElementById('hud-heel').textContent,
    rudder: document.getElementById('hud-rudder').textContent,
    sheet: document.getElementById('hud-sheet').textContent,
    ballast: document.getElementById('hud-ballast').textContent,
    msg: document.getElementById('message').textContent
  }));
  console.log('HUD:', JSON.stringify(hud, null, 2));

  // 像素 sanity：画布不应该是纯色
  const distinct = await page.evaluate(() => {
    const c = document.getElementById('game');
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const set = new Set();
    for (let i = 0; i < d.length; i += 4000) set.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]);
    return set.size;
  });
  console.log('画布采样不同颜色数:', distinct);

  await page.screenshot({ path: '/home/hj/userfeedback/uid206/artifacts/screenshot.png' });
  console.log('错误数:', errors.length);
  errors.slice(0, 10).forEach(e => console.log('  ' + e));
  await browser.close();
  process.exit(errors.length === 0 && distinct > 8 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
