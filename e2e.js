const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const p = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'text/plain' });
    res.end(data);
  });
});

function dispatch(t, sc, cfg) {
  const solar = Math.min(sc.solarAvail[t], cfg.lineCaps.solar);
  let deficit = sc.loadDemand[t] - solar;
  let batt = 0, gen = 0;
  if (deficit > 0) {
    batt = Math.min(cfg.lineCaps.battery, deficit);
    deficit -= batt;
    gen = Math.min(cfg.lineCaps.gen, deficit);
  } else {
    batt = -Math.min(cfg.lineCaps.battery, -deficit);
  }
  return { solar, gen, battery: batt };
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 700 } });
  page.on('pageerror', (e) => { console.error('页面错误:', e.message); process.exitCode = 1; });
  await page.goto(`http://127.0.0.1:${port}/`);

  const meta = await page.evaluate(() => ({
    scenario: EnergySim.SCENARIO, cfg: EnergySim.CONFIG,
  }));

  console.log('[e2e-1] 浏览器内完成一次 20 秒调度');
  await page.evaluate((inp) => { EnergyApp.setInputs(inp); EnergyApp.start(); },
    dispatch(0, meta.scenario, meta.cfg));
  let shotMid = false;
  for (let i = 0; i < 600; i++) {
    await page.waitForTimeout(100);
    const s = await page.evaluate(() => ({ t: EnergyApp.t, status: EnergyApp.status }));
    if (s.status !== 'running') break;
    if (!shotMid && s.t === 8) { // 云层+高峰最吃紧的时刻
      await page.screenshot({ path: 'artifacts/e2e-running.png' });
      shotMid = true;
    }
    await page.evaluate((inp) => EnergyApp.setInputs(inp), dispatch(s.t, meta.scenario, meta.cfg));
  }
  const final1 = await page.evaluate(() => EnergyApp.status);
  console.log('  状态:', final1, final1 === 'success' ? 'PASS' : 'FAIL');
  if (final1 !== 'success') process.exitCode = 1;
  await page.screenshot({ path: 'artifacts/e2e-success.png' });

  console.log('[e2e-2] 过载演示：发电机 50kW > 线路 40kW');
  await page.click('#btn-overload');
  await page.waitForTimeout(1200);
  const ov = await page.evaluate(() => EnergyApp.lastResult.lines.gen);
  console.log('  发电机线路:', JSON.stringify(ov), ov.overload ? 'PASS 变红' : 'FAIL');
  if (!ov.overload) process.exitCode = 1;
  await page.screenshot({ path: 'artifacts/e2e-overload-red.png' });
  await page.waitForTimeout(2500);
  const final2 = await page.evaluate(() => EnergyApp.status);
  const banner = await page.textContent('#banner');
  console.log('  状态:', final2, '横幅:', banner, final2 === 'tripped' ? 'PASS' : 'FAIL');
  if (final2 !== 'tripped') process.exitCode = 1;
  await page.screenshot({ path: 'artifacts/e2e-tripped.png' });

  await browser.close();
  server.close();
  console.log(process.exitCode ? 'e2e 存在失败项' : 'e2e 全部通过');
})();
