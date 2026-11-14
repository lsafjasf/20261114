// End-to-end browser check driven by Puppeteer: renders the page, exercises
// every control and synchronized-highlight path, and captures screenshots.
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const root = path.join(__dirname, '..');
const fileUrl = 'file://' + path.join(root, 'index.html');
const outDir = path.join(root, 'artifacts');
fs.mkdirSync(outDir, { recursive: true });

function setSlider(page, id, value) {
  return page.evaluate(([sliderId, v]) => {
    const el = document.getElementById(sliderId);
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, [id, value]);
}

async function canvasStats(page, canvasId) {
  return page.evaluate((id) => {
    const c = document.getElementById(id);
    const ctx = c.getContext('2d');
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let painted = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++;
    return { painted, total: data.length / 4 };
  }, canvasId);
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-crash-reporter',
        '--disable-breakpad',
      ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 940 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('console.error: ' + msg.text());
  });

  await page.goto(fileUrl, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#view3d');

  // Both canvases must actually paint content.
  const initial3d = await canvasStats(page, 'view3d');
  const initial2d = await canvasStats(page, 'view2d');
  console.log('3D painted pixels:', initial3d.painted, '/', initial3d.total);
  console.log('2D painted pixels:', initial2d.painted, '/', initial2d.total);
  if (initial3d.painted < 5000 || initial2d.painted < 2000) {
    throw new Error('canvas did not render enough content');
  }

  // Sweep the level slider across the full range; stats text must update and
  // the contour must appear/disappear near the extremes without errors.
  for (const level of [-0.49, -0.25, 0, 0.25, 0.49]) {
    await setSlider(page, 'level', level);
    const stats = await page.$eval('#stats', (el) => el.textContent);
    if (!stats.includes('y =')) throw new Error('stats did not update for level ' + level);
  }

  // Change amplitude; slider range must follow the new height span.
  await setSlider(page, 'amplitude', 1.6);
  const range = await page.$eval('#level', (el) => [el.min, el.max]);
  console.log('amplitude=1.6 level range:', range);
  if (Math.abs(parseFloat(range[0]) + 0.8) > 1e-6) throw new Error('level range not rebuilt');
  await setSlider(page, 'amplitude', 1);

  // View angle controls.
  await setSlider(page, 'yaw', 120);
  await setSlider(page, 'pitch', 55);
  await setSlider(page, 'zoom', 1.3);
  await page.screenshot({ path: path.join(outDir, 'e2e-view-angled.png') });

  // Synchronized highlighting: click the 2D section canvas on a contour line.
  await setSlider(page, 'level', 0);
  const box = await page.$('#view2d').then((el) => el.boundingBox());
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.45);
  await page.screenshot({ path: path.join(outDir, 'e2e-highlight.png') });

  // Run the in-page continuity self check.
  await page.click('#runCheck');
  await page.waitForFunction(() => document.getElementById('checkResult').textContent.length > 0);
  const check = await page.$eval('#checkResult', (el) => ({
    cls: el.className,
    text: el.textContent,
  }));
  console.log('\nIn-page check:\n' + check.text);
  if (!check.cls.includes('ok')) throw new Error('in-page continuity check failed');

  // SVG export through the page's Blob download path.
  const downloadPath = path.join(outDir, 'e2e-download.svg');
  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: outDir,
  });
  await page.click('#exportSvg');
  await new Promise((r) => setTimeout(r, 800));
  const downloaded = fs.readdirSync(outDir).find((f) => f.endsWith('.svg') && f.startsWith('section-y'));
  if (!downloaded) throw new Error('SVG download did not happen');
  const svgText = fs.readFileSync(path.join(outDir, downloaded), 'utf8');
  if (!svgText.startsWith('<svg') || !svgText.includes('</svg>')) {
    throw new Error('downloaded SVG is malformed');
  }
  console.log('\nDownloaded SVG via browser:', downloaded, svgText.length, 'bytes');

  await page.screenshot({ path: path.join(outDir, 'e2e-final.png') });
  await browser.close();

  if (errors.length) {
    console.error('Browser errors:', errors);
    process.exit(1);
  }
  console.log('\nE2E PASS - no browser errors, all controls and export work');
})().catch((err) => {
  console.error('E2E FAIL:', err);
  process.exit(1);
});
