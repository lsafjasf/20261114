import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let BASE = '';
const require = createRequire(import.meta.url);

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    'playwright',
    '/home/hj/userfeedback/uid132/node_modules/playwright',
    '/home/hj/userfeedback/uid8/node_modules/playwright'
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (candidate.startsWith('/')) return require(candidate);
      return require(candidate);
    } catch (error) {
      // Try the next fallback.
    }
  }
  throw new Error('Playwright not found. Set PLAYWRIGHT_MODULE to a playwright install.');
}

function findChrome(playwright) {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const caches = [path.join(process.env.HOME || '', '.cache/ms-playwright'), '/home/hj/.cache/ms-playwright'];
  const known = [
    path.join(caches[0], 'chromium-1234/chrome-linux64/chrome'),
    path.join(caches[0], 'chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell'),
    path.join(caches[1], 'chromium-1234/chrome-linux64/chrome'),
    path.join(caches[1], 'chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell')
  ];
  for (const candidate of known) if (fs.existsSync(candidate)) return candidate;
  for (const cache of caches) {
    if (!fs.existsSync(cache)) continue;
    for (const dir of fs.readdirSync(cache)) {
      for (const suffix of ['chrome-linux64/chrome', 'chrome-headless-shell-linux64/chrome-headless-shell']) {
        const candidate = path.join(cache, dir, suffix);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return playwright.chromium.executablePath();
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json'
};

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(ROOT, relative);
  if (!file.startsWith(ROOT + path.sep)) {
    response.writeHead(403).end('forbidden');
    return;
  }
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(response);
  });
});

const playwright = loadPlaywright();
const executablePath = findChrome(playwright);
let browser;

try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  BASE = `http://127.0.0.1:${server.address().port}/`;
  browser = await playwright.chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('favicon')) errors.push(message.text());
  });

  const report = {};
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#startOverlay').isVisible(), true);
  const canvasBytes = await page.evaluate(() => document.getElementById('scene').toDataURL().length);
  assert.ok(canvasBytes > 10000, 'canvas should contain a rendered scene');

  await page.click('#startBtn');
  await page.waitForTimeout(250);
  const audioInfo = await page.evaluate(() => ({
    ready: window.__railGame.audio.ready,
    state: window.__railGame.audio.ctx ? window.__railGame.audio.ctx.state : null
  }));
  assert.equal(audioInfo.ready, true, 'Web Audio engine should initialize');
  assert.ok(audioInfo.state === 'running' || audioInfo.state === 'suspended');
  await page.evaluate(() => window.__railGame.setManual(true));
  await page.click('[data-switch="NE"]');
  await page.click('[data-switch="SE"]');

  let nwFlipped = false;
  let seFlipped = false;
  let finalState = null;
  for (let i = 0; i < 420; i += 1) {
    const state = await page.evaluate(() => window.__railGame.tick(0.5));
    const blue = state.trains.find((train) => train.id === 'blue');
    if (!nwFlipped && blue.p > 0.29 && !blue.done) {
      await page.click('[data-switch="NW"]');
      nwFlipped = true;
    }
    if (!seFlipped && blue.p > 0.81 && !blue.done) {
      await page.click('[data-switch="SE"]');
      seFlipped = true;
    }
    if (state.result) {
      finalState = state;
      break;
    }
  }
  assert.ok(finalState, 'the accelerated UI run should finish');
  assert.equal(finalState.result, 'win', JSON.stringify(finalState.failure));
  assert.deepEqual(finalState.trains.map((train) => train.stationCount), [3, 3]);
  assert.deepEqual(finalState.trains.map((train) => train.emergencyStops), [0, 0]);
  report.fullRun = {
    result: finalState.result,
    elapsed: Number(finalState.elapsed.toFixed(2)),
    trains: finalState.trains.map((train) => ({
      name: train.name,
      stations: train.stationCount,
      finishedAt: Number((train.finishedAt || 0).toFixed(2)),
      emergencyStops: train.emergencyStops,
      wear: train.wear
    }))
  };
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(ROOT, 'artifacts/e2e-win.png'), fullPage: true });

  await page.click('#againBtn');
  await page.evaluate(() => window.__railGame.setManual(true));
  await page.click('[data-switch="NW"]');
  let heldState = null;
  for (let i = 0; i < 260; i += 1) {
    const state = await page.evaluate(() => window.__railGame.tick(0.25));
    const blue = state.trains.find((train) => train.id === 'blue');
    if (blue.status === 'held') {
      heldState = state;
      break;
    }
  }
  assert.ok(heldState, 'a wrong turnout must stop the blue train');
  assert.equal(heldState.trains[0].hold.type, 'signal');
  assert.equal(heldState.trains[0].hold.junction, 'NW');
  assert.equal(heldState.trains[0].wear, 18);
  assert.match(await page.locator('#toast').textContent(), /保护停车|道岔方向错误/);
  report.wrongSwitchStop = {
    train: heldState.trains[0].name,
    junction: heldState.trains[0].hold.junction,
    p: Number(heldState.trains[0].p.toFixed(3)),
    wear: heldState.trains[0].wear,
    emergencyStops: heldState.trains[0].emergencyStops
  };
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(ROOT, 'artifacts/e2e-wrong-stop.png'), fullPage: true });

  const heldP = heldState.trains[0].p;
  await page.click('[data-switch="NW"]');
  let resumedState = null;
  for (let i = 0; i < 24; i += 1) {
    resumedState = await page.evaluate(() => window.__railGame.tick(0.25));
  }
  assert.notEqual(resumedState.trains[0].status, 'held');
  assert.ok(resumedState.trains[0].p > heldP);
  report.recovery = { status: resumedState.trains[0].status, p: Number(resumedState.trains[0].p.toFixed(3)) };

  await page.click('#resetBtn');
  await page.click('#startBtn');
  await page.evaluate(() => window.__railGame.setManual(true));
  let occupiedState = null;
  for (let i = 0; i < 180; i += 1) {
    const state = await page.evaluate(() => window.__railGame.tick(0.1));
    if (state.switches.find((item) => item.id === 'NW').occupied) {
      occupiedState = state;
      break;
    }
  }
  assert.ok(occupiedState, 'NW should be occupied while blue is on the interlocking zone');
  await page.click('[data-switch="NW"]');
  assert.equal(await page.evaluate(() => window.__railGame.state().switches.find((item) => item.id === 'NW').state), 'straight');
  assert.match(await page.locator('#toast').textContent(), /占用|锁闭/);
  report.occupiedLock = {
    junction: 'NW',
    rejectedAt: Number(occupiedState.elapsed.toFixed(2)),
    stateAfterClick: await page.evaluate(() => window.__railGame.state().switches.find((item) => item.id === 'NW').state)
  };
  await page.screenshot({ path: path.join(ROOT, 'artifacts/e2e-lock.png'), fullPage: true });

  await page.click('#resetBtn');
  await page.click('#startBtn');
  await page.evaluate(() => window.__railGame.setManual(true));
  await page.evaluate(() => window.__railGame.tick(1));
  const beforePause = await page.evaluate(() => window.__railGame.state().elapsed);
  await page.click('#pauseBtn');
  assert.equal(await page.locator('#pauseOverlay').isVisible(), true);
  await page.screenshot({ path: path.join(ROOT, 'artifacts/e2e-pause.png'), fullPage: true });
  await page.evaluate(() => window.__railGame.tick(3));
  assert.equal(await page.evaluate(() => window.__railGame.state().elapsed), beforePause);
  await page.click('#resumeBtn');
  await page.evaluate(() => window.__railGame.tick(1));
  const afterPause = await page.evaluate(() => window.__railGame.state().elapsed);
  assert.ok(afterPause > beforePause);
  report.pause = { frozenElapsed: Number(beforePause.toFixed(2)), resumedElapsed: Number(afterPause.toFixed(2)) };

  assert.deepEqual(errors, []);
  fs.mkdirSync(path.join(ROOT, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'artifacts/e2e-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log('E2E passed: full run, wrong-switch stop, occupied lock, and pause.');
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (browser) await browser.close();
  server.close();
}
