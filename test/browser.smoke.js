const { chromium } = require('playwright');
const assert = require('assert');
const path = require('path');

const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(URL);
  await page.waitForSelector('#badge.ok');

  const badgeText = () => page.textContent('#badge');
  assert.ok((await badgeText()).includes('无断裂'), 'initial integrity badge');

  // same seed determinism, evaluated inside the page against the kernel
  const det = await page.evaluate(() => {
    const T = window.Terrain;
    const a = T.createHeightField(72, 20261114);
    const b = T.createHeightField(72, 20261114);
    let identical = a.length === b.length;
    for (let i = 0; identical && i < a.length; i++) if (a[i] !== b[i]) identical = false;
    return identical;
  });
  assert.ok(det, 'same seed gives identical field in browser');

  // tide sweep: contours must stay unbroken at every step
  const sweep = await page.evaluate(async () => {
    const T = window.Terrain;
    const s = window.__seabed.state;
    const slider = document.getElementById('tide');
    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    let broken = null;
    const bands = new Set();
    for (let t = min; t <= max; t += (max - min) / 40) {
      slider.value = t.toFixed(3);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      s.tideContour = T.extractContour(s.grid, 72, t);
      const v = T.verifyContours(s.contours.concat([s.tideContour]), 72);
      if (!v.ok) { broken = { t, reason: v.reason }; break; }
      bands.add(T.shoalBand(t, s.stats.min, s.spacing).name);
    }
    await new Promise((r) => requestAnimationFrame(r));
    return { broken, bandCount: bands.size };
  });
  assert.strictEqual(sweep.broken, null,
    'tide sweep contour integrity: ' + JSON.stringify(sweep.broken));
  assert.ok(sweep.bandCount >= 3, 'shoal band switches while tide rises');

  // spacing change recomputes contours and keeps them valid
  const gapCheck = await page.evaluate(() => {
    const T = window.Terrain;
    const s = window.__seabed.state;
    const gap = document.getElementById('gap');
    gap.value = '0.25';
    gap.dispatchEvent(new Event('input', { bubbles: true }));
    const v1 = T.verifyContours(s.contours, 72);
    gap.value = '1.2';
    gap.dispatchEvent(new Event('input', { bubbles: true }));
    const v2 = T.verifyContours(s.contours, 72);
    return { v1, v2, levels: s.levels.length };
  });
  assert.ok(gapCheck.v1.ok && gapCheck.v2.ok, 'contours valid after spacing change');
  assert.ok(gapCheck.levels > 0, 'levels recomputed');

  // drag orbit changes camera and redraws without errors
  const canvas = await page.$('#view');
  const before = await page.evaluate(() => window.__seabed.state.yaw);
  await canvas.hover();
  await page.mouse.down();
  await page.mouse.move(400, 300);
  await page.mouse.move(520, 220);
  await page.mouse.up();
  const after = await page.evaluate(() => window.__seabed.state.yaw);
  assert.notStrictEqual(before, after, 'drag rotates the view');

  // SVG export content
  const svg = await page.evaluate(() => {
    let captured = null;
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { captured = this.href; };
    document.getElementById('exportSvg').click();
    HTMLAnchorElement.prototype.click = orig;
    return captured;
  });
  assert.ok(svg && svg.startsWith('blob:'), 'svg export triggers download');

  // PNG export produces a non-empty blob
  const png = await page.evaluate(() => new Promise((resolve) => {
    const c = document.getElementById('view');
    c.toBlob((b) => resolve({ size: b.size, type: b.type }), 'image/png');
  }));
  assert.strictEqual(png.type, 'image/png');
  assert.ok(png.size > 20000, 'png has rendered content');

  // reseed changes terrain but same reseed value reproduces it
  const seedCheck = await page.evaluate(() => {
    const T = window.Terrain;
    const a = T.createHeightField(72, 111);
    const b = T.createHeightField(72, 111);
    const c = T.createHeightField(72, 222);
    let same = true;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) same = false;
      if (a[i] !== c[i]) diff++;
    }
    return { same, diffRatio: diff / a.length };
  });
  assert.ok(seedCheck.same, 'same seed reproducible');
  assert.ok(seedCheck.diffRatio > 0.9, 'different seed differs');

  await page.screenshot({ path: path.resolve(__dirname, '..', 'artifacts', 'overview.png') });
  await browser.close();

  assert.strictEqual(errors.length, 0, 'no console/page errors: ' + errors.join(' | '));
  console.log('browser smoke test passed (' + sweep.bandCount + ' shoal bands observed)');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
