'use strict';
/* e2e.js — Playwright 真实浏览器验证：渲染无报错、自动巡航完成三点巡检、潮水封路失败 */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1620, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('file://' + path.resolve(__dirname, 'index.html'));
  await page.waitForFunction(() => window.__game && window.__game.state().status === 'running');

  // 注入自动巡航策略（与 test.js 相同：依次巡检 → 撤回坡道）
  await page.evaluate(() => {
    const SIM = window.SIM, G = window.__game;
    window.__runMission = (linger) => {
      G.restart();
      let idx = 0;
      const exit = { x: SIM.WORLD.W / 2, y: SIM.WORLD.exitY + 40 };
      const farNorth = { x: SIM.WORLD.W / 2, y: 320 };
      G.setAuto((s) => {
        const w = G.world();
        if (linger) {
          if (!s.inspections[0].done) return SIM.autopilot(s, w.points[0]);
          return SIM.autopilot(s, farNorth); // 滞留深处，错过潮位窗口
        }
        while (idx < w.points.length && s.inspections[idx].done) idx++;
        return SIM.autopilot(s, idx < w.points.length ? w.points[idx] : exit);
      });
      return G.ff(300);
    };
  });

  // 用例 1：三点巡检 + 窗口内撤离
  await page.evaluate(() => { window.__r1 = window.__runMission(false); });
  await page.waitForTimeout(300); // 等一帧渲染
  const s1 = await page.evaluate(() => {
    const s = window.__game.state();
    return { status: s.status, done: s.doneCount, time: s.time, skirt: s.skirt, tideY: s.tideY };
  });
  console.log('任务一:', JSON.stringify(s1));
  await page.screenshot({ path: 'artifacts/e2e_win.png' });

  // 用例 2：滞留 → 潮水封路失败
  await page.evaluate(() => { window.__r2 = window.__runMission(true); });
  await page.waitForTimeout(300);
  const s2 = await page.evaluate(() => {
    const s = window.__game.state();
    return { status: s.status, reason: s.failReason, time: s.time, tideY: s.tideY, craftY: s.craft.y };
  });
  console.log('任务二:', JSON.stringify(s2));
  await page.screenshot({ path: 'artifacts/e2e_tide_fail.png' });

  await browser.close();

  let ok = true;
  const assert = (name, cond) => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`);
    if (!cond) ok = false;
  };
  assert('浏览器无 JS 报错', errors.length === 0);
  if (errors.length) console.log(errors.join('\n'));
  assert('E2E 三点巡检完成并撤离', s1.status === 'won' && s1.done === 3);
  assert('E2E 潮水封路失败', s2.status === 'failed' && s2.reason === 'tide');
  process.exit(ok ? 0 : 1);
})();
