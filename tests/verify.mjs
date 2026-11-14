import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from './browser.mjs';

const root = process.cwd();
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.otf': 'font/otf',
  '.json': 'application/json; charset=utf-8',
};

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent((request.url || '/').split('?')[0]);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(root, relative);
  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end('forbidden');
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end('not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(data);
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;

const browser = await launchChromium({
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => {
  pageErrors.push(error.message);
  console.error('[pageerror]', error.message);
});

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => Boolean(window.MixApp));
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(200);

const defaults = await page.evaluate(() => window.MixApp.getControls());
const defaultAnalysis = await page.evaluate((controls) => window.MixApp.validate(controls), defaults);
if (!defaultAnalysis.clipped) throw new Error('默认热混音应触发总线削波');

const simultaneous = await page.evaluate(() => {
  const targets = {
    left: { drums: 0.56, low: 0.5, comp: -17.5 },
    right: { melody: 0.5, echo: 0.34, pan: -0.12 },
  };
  const defs = {
    left: [
      { key: 'drums', min: 0, max: 1 },
      { key: 'low', min: 0, max: 1 },
      { key: 'comp', min: -24, max: -3 },
    ],
    right: [
      { key: 'melody', min: 0, max: 1 },
      { key: 'echo', min: 0, max: 1 },
      { key: 'pan', min: -1, max: 1 },
    ],
  };
  const canvases = {
    left: document.querySelector('#leftFaders'),
    right: document.querySelector('#rightFaders'),
  };
  const events = [];
  let pointerId = 41;
  const fire = (side, index, value) => {
    const canvas = canvases[side];
    const rect = canvas.getBoundingClientRect();
    const slot = rect.width / 3;
    const top = 87;
    const bottom = canvas.clientHeight - 39;
    const def = defs[side][index];
    const ratio = (value - def.min) / (def.max - def.min);
    const x = rect.left + slot * index + slot / 2;
    const y = rect.top + bottom - ratio * (bottom - top);
    const id = pointerId;
    pointerId += 1;
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      pointerId: id,
      pointerType: 'touch',
      clientX: x,
      clientY: y,
    }));
    canvas.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      pointerId: id,
      pointerType: 'touch',
      clientX: x,
      clientY: y,
    }));
    events.push({ side, key: def.key, at: performance.now() });
  };

  for (let index = 0; index < 3; index += 1) {
    fire('left', index, Object.values(targets.left)[index]);
    fire('right', index, Object.values(targets.right)[index]);
  }
  const controls = window.MixApp.getControls();
  return {
    controls,
    events,
    leftIsActive: document.querySelector('#rightPeerWatch').classList.contains('is-active'),
    rightIsActive: document.querySelector('#leftPeerWatch').classList.contains('is-active'),
  };
});

const closeEnough = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
const pointerPass = closeEnough(simultaneous.controls.left.drums, 0.56, 0.035)
  && closeEnough(simultaneous.controls.left.low, 0.5, 0.035)
  && closeEnough(simultaneous.controls.left.comp, -17.5, 0.7)
  && closeEnough(simultaneous.controls.right.melody, 0.5, 0.035)
  && closeEnough(simultaneous.controls.right.echo, 0.34, 0.035)
  && closeEnough(simultaneous.controls.right.pan, -0.12, 0.06);

if (!pointerPass) {
  await page.evaluate(() => window.MixApp.setControls({
    left: { drums: 0.56, low: 0.5, comp: -17.5 },
    right: { melody: 0.5, echo: 0.34, pan: -0.12 },
  }));
}

const safeAnalysis = await page.evaluate(() => window.MixApp.validate(window.MixApp.getControls()));
if (safeAnalysis.clipped) throw new Error('双人调整后的混音仍然削波');

await page.click('#transportButton');
await page.waitForTimeout(5200);
const midState = await page.evaluate(() => window.MixApp.getState());
await page.screenshot({ path: 'artifacts/session-live.png', fullPage: true });

await page.waitForFunction(
  () => ['complete', 'failed'].includes(window.MixApp.getState().status),
  null,
  { timeout: 70000 },
);
const completed = await page.evaluate(async () => {
  const result = await window.MixApp.waitForPlayback();
  return { result, state: window.MixApp.getState() };
});
if (!completed.result.success || completed.state.status !== 'complete') {
  throw new Error(`播放未通过: ${JSON.stringify(completed.state.analysis)}`);
}

const mixDownloadPromise = page.waitForEvent('download', { timeout: 45000 });
await page.click('#exportButton');
const mixDownload = await mixDownloadPromise;
const mixPath = path.join(root, 'artifacts', 'neon-half-light_dual-bus_mix.wav');
await mixDownload.saveAs(mixPath);

const projectDownloadPromise = page.waitForEvent('download');
await page.click('#saveButton');
const projectDownload = await projectDownloadPromise;
const projectPath = path.join(root, 'artifacts', 'neon-half-light_dual-bus_project.json');
await projectDownload.saveAs(projectPath);

await page.waitForTimeout(250);
await page.screenshot({ path: 'artifacts/session-complete.png', fullPage: true });

const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
const wav = fs.readFileSync(mixPath);
const channels = wav.readUInt16LE(22);
const sampleRate = wav.readUInt32LE(24);
const bits = wav.readUInt16LE(34);
const dataSize = wav.readUInt32LE(40);
let absolutePeak = 0;
for (let offset = 44; offset + 1 < 44 + dataSize; offset += 2) {
  absolutePeak = Math.max(absolutePeak, Math.abs(wav.readInt16LE(offset)));
}
const normalizedPeak = absolutePeak / 32768;
const wavDuration = dataSize / (channels * (bits / 8)) / sampleRate;
const wavPass = wav.toString('ascii', 0, 4) === 'RIFF'
  && wav.toString('ascii', 8, 12) === 'WAVE'
  && channels === 2
  && bits === 16
  && Math.abs(wavDuration - 32) < 0.02
  && normalizedPeak < 0.985;

const pass = pointerPass
  && pageErrors.length === 0
  && !safeAnalysis.clipped
  && midState.status === 'playing'
  && completed.result.success
  && project.capture.complete
  && project.capture.verifiedOffline
  && project.capture.clipCount === 0
  && wavPass;

const report = {
  pass,
  pageErrors,
  pointerSimultaneous: pointerPass,
  pointerEvents: simultaneous.events,
  peersSignalled: {
    leftPanel: simultaneous.rightIsActive,
    rightPanel: simultaneous.leftIsActive,
  },
  controls: simultaneous.controls,
  defaultMix: {
    clipped: defaultAnalysis.clipped,
    peakDb: defaultAnalysis.peakDb,
    clippedSamples: defaultAnalysis.clippedSamples,
  },
  safeMix: {
    clipped: safeAnalysis.clipped,
    peakDb: safeAnalysis.peakDb,
    rmsDb: safeAnalysis.rmsDb,
  },
  playback: {
    midState,
    finalStatus: completed.state.status,
    validated: completed.result.success,
    analysis: completed.state.analysis,
  },
  project: {
    path: projectPath,
    bytes: fs.statSync(projectPath).size,
    capture: project.capture,
  },
  wav: {
    path: mixPath,
    bytes: wav.length,
    duration: wavDuration,
    channels,
    sampleRate,
    bits,
    peak: normalizedPeak,
    peakDb: 20 * Math.log10(normalizedPeak),
  },
};
fs.writeFileSync(
  path.join(root, 'artifacts', 'verification.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);

console.log(JSON.stringify(report, null, 2));
await context.close();
await browser.close();
server.close();
if (!pass) process.exitCode = 1;
