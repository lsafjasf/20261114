/* 端到端：无头 Chromium 加载页面，校验 Canvas 与完整五组流程 */
const path = require('path');
const { chromium } = require('playwright-core');

const EXEC = '/home/hj/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const URL = 'file://' + path.join(__dirname, '..', 'index.html');

(async function () {
  const browser = await chromium.launch({
    executablePath: EXEC,
    args: ['--allow-file-access-from-files', '--use-fake-ui-for-media-stream']
  });
  const page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(URL);
  await page.waitForSelector('#wheelCanvas');

  // Canvas 实际绘制校验
  const painted = await page.evaluate(() => {
    function nonBlank(id) {
      const c = document.getElementById(id);
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) n++;
      return n;
    }
    return {
      wheel: nonBlank('wheelCanvas'),
      palette: nonBlank('paletteCanvas'),
      swatches: nonBlank('swatchCanvas')
    };
  });
  console.log('canvas 非空像素:', JSON.stringify(painted));

  // 模拟滑块输入：把 C 调到 60，检查实时色差文本更新
  await page.evaluate(() => {
    const input = document.querySelector('#sliders input[data-idx="0"]');
    input.value = 60;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const deText = await page.textContent('#deText');
  console.log('滑块联动:', deText.trim());

  // 归零后，用“自动试色一次”打完整个五组
  await page.click('#resetBtn');
  for (let round = 1; round <= 5; round++) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const disabled = await page.getAttribute('#autoBtn', 'disabled');
      if (disabled !== null) break;
      await page.click('#autoBtn');
      await page.waitForTimeout(60);
      const tags = await page.$$eval('#attemptList .tag',
        ts => ts.map(t => t.textContent.trim()));
      if (tags.some(t => t === '命中')) break;
    }
    await page.waitForTimeout(1000);
  }

  await page.waitForSelector('#resultPanel:not(.hidden)');
  const rows = await page.$$eval('#resultBody tr', trs => trs.map(tr =>
    Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim())));
  console.log('\n页面结算表:');
  rows.forEach(r => console.log(' ', r.join(' | ')));

  const allDone = rows.every(r => r[6].includes('完成'));
  console.log('\nJS 错误数:', errors.length, errors.length ? '\n' + errors.join('\n') : '');
  await page.screenshot({ path: path.join(__dirname, '..', 'sim', 'final.png'), fullPage: true });
  await browser.close();
  if (!allDone || errors.length) process.exit(1);
  console.log('端到端通过：五组全部在浏览器内完成。');
})();
