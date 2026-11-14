import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright-core";

const root = process.cwd();
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const server = createServer(async (request, response) => {
  try {
    const requestPath = decodeURIComponent((request.url || "/").split("?")[0]);
    const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
    const filePath = join(root, normalize(relativePath));
    if (!filePath.startsWith(root)) throw new Error("Invalid path");
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const browserCandidates = [
  process.env.CHROME_PATH,
  "/tmp/chrome-extracted-157/chrome-linux64/chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
].filter(Boolean);
const executablePath = browserCandidates.find((candidate) => existsSync(candidate));

if (!executablePath) {
  server.close();
  throw new Error("Chrome not found. Set CHROME_PATH to run the browser verification.");
}

const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-crash-reporter"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const snapshot = () => page.evaluate(() => window.rainTerrain.getSnapshot());
const report = () => page.evaluate(() => window.rainTerrain.getSyncReport());
const audioMetrics = () => page.evaluate(() => window.rainTerrain.getAudioMetrics());

try {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  const initial = await snapshot();
  expect(initial.markerCount === 0, "Initial marker count must be zero");
  expect(initial.timeHours === 0, "Initial time must be zero");
  expect(initial.renderedTimeHours === 0, "Initial render must match time zero");

  await page.locator("#playBtn").click();
  await page.waitForFunction(() => {
    const state = window.rainTerrain.getSnapshot();
    return state.playing && state.timeHours > 0.04;
  });
  await sleep(650);
  const playing = await snapshot();
  const playingReport = await report();
  expect(playing.playing, "Play button must start playback");
  expect(playing.audioReady, "Audio context must be ready after play");
  expect(playing.audioState === "running", "Audio context must be running");
  expect(playingReport.gainMatch, "Rain volume must match the visual rain intensity");
  expect(playingReport.panMatch, "Audio pan must match the visual wind direction");
  expect(playingReport.renderedDeltaMs < 0.1, "Playback frame and audio time must match");

  const timeline = await page.locator("#timelineFrame").boundingBox();
  await page.mouse.move(timeline.x + timeline.width * 0.12, timeline.y + timeline.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(timeline.x + timeline.width * 0.57, timeline.y + timeline.height * 0.55, { steps: 14 });
  await page.mouse.up();
  await sleep(280);
  const dragged = await snapshot();
  const draggedReport = await report();
  const draggedAudio = await audioMetrics();
  expect(dragged.playing, "Dragging must preserve playback state");
  expect(dragged.timeHours > 12 && dragged.timeHours < 15, "Playhead must follow the pointer drag");
  expect(dragged.clockText === dragged.timeLabel, "Clock must match the dragged playhead");
  expect(dragged.renderedTimeHours === dragged.timeHours, "Rendered frame must match the dragged playhead");
  expect(draggedReport.gainMatch && draggedReport.panMatch, "Audio targets must follow the drag");
  expect(draggedAudio.gainTarget > 0, "Rain audio must remain audible while playing");
  expect(Math.abs(draggedAudio.panActual - draggedAudio.panTarget) < 0.02, "Stereo pan must converge after drag");

  await page.locator("#playBtn").click();
  await sleep(240);
  const pausedStart = await snapshot();
  await sleep(520);
  const pausedEnd = await snapshot();
  const pausedReport = await report();
  expect(!pausedStart.playing && !pausedEnd.playing, "Pause button must stop playback");
  expect(Math.abs(pausedEnd.timeHours - pausedStart.timeHours) < 0.000001, "Paused playhead must not drift");
  expect(pausedReport.gainMatch, "Paused audio gain must be zero and synchronized");

  const ids = ["storm-front", "train-echo", "wind-shift"];
  for (const id of ids) {
    await page.locator(`.anomaly-item[data-anomaly-id="${id}"]`).click();
    await sleep(90);
  }
  const marked = await snapshot();
  const markerRows = await page.locator(".marker-list li").count();
  const markerPins = await page.locator(".marker-pin").count();
  expect(marked.markerCount === 3, "Three anomaly periods must create three markers");
  expect(JSON.stringify(marked.markerIds) === JSON.stringify(ids), "Marker IDs must match all anomalies");
  expect(markerRows === 3, "Marker list must contain three rows");
  expect(markerPins === 3, "Timeline must contain three marker pins");

  await page.locator("#playBtn").click();
  await sleep(180);
  const focusTimes = [4.42, 12.4, 16.35];
  const visualStates = [];
  const audioStates = [];
  let thunderSynced = false;
  for (const hour of focusTimes) {
    await page.evaluate((focusHour) => window.rainTerrain.seek(focusHour), hour);
    await sleep(280);
    const state = await snapshot();
    const sync = await report();
    const audio = await audioMetrics();
    visualStates.push(state);
    audioStates.push(audio);
    expect(sync.gainMatch && sync.panMatch, `Audio parameters diverged at ${hour}h`);
    expect(sync.clockMatch && sync.timelineMatch, `UI time diverged at ${hour}h`);
    expect(sync.renderedDeltaMs < 0.1, `Render time diverged at ${hour}h`);
    expect(audio.gainTarget > 0, `Rain audio was muted while playing at ${hour}h`);
    expect(Math.abs(audio.panActual - audio.panTarget) < 0.02, `Pan lagged at ${hour}h`);
    if (hour === 4.42) {
      thunderSynced = state.thunder > 0 && audio.thunderTriggers > 0;
    }
  }
  expect(thunderSynced, "Thunder flash and pulse must start together near a storm event");

  await page.locator("#playBtn").click();
  await sleep(220);
  const hashes = [];
  for (const hour of focusTimes) {
    await page.evaluate((focusHour) => window.rainTerrain.seek(focusHour), hour);
    await sleep(120);
    hashes.push(await page.evaluate(() => {
      const canvas = document.querySelector("#terrainCanvas");
      const context = canvas.getContext("2d");
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2166136261;
      for (let index = 0; index < pixels.length; index += 97) {
        hash = Math.imul(hash ^ pixels[index], 16777619);
      }
      return hash >>> 0;
    }));
  }
  expect(new Set(hashes).size === 3, "Cloud, river and city scene must redraw at all three marker times");
  expect(new Set(visualStates.map((state) => state.cityBrightness.toFixed(3))).size === 3, "City brightness must update");
  expect(new Set(visualStates.map((state) => state.cloudDensity.toFixed(3))).size === 3, "Cloud density must update");
  expect(new Set(visualStates.map((state) => state.riverGlow.toFixed(3))).size === 3, "River glow must update");
  expect(consoleErrors.length === 0, `Browser console errors: ${consoleErrors.join(" | ")}`);

  await page.screenshot({ path: "artifacts/verified.png", fullPage: true });
  console.log(JSON.stringify({
    status: "PASS",
    playback: {
      startedAtHours: playing.timeHours,
      pausedAtHours: pausedStart.timeHours,
      pausedDriftHours: pausedEnd.timeHours - pausedStart.timeHours,
    },
    drag: {
      timeHours: dragged.timeHours,
      timeLabel: dragged.timeLabel,
      pan: dragged.pan,
      audioGain: draggedAudio.gainTarget,
    },
    markers: marked.markerIds,
    thunderFlashAndPulse: thunderSynced,
    audioVisualMatches: audioStates.map((state, index) => ({
      timeHours: focusTimes[index],
      gain: state.gainTarget,
      pan: state.panTarget,
    })),
    sceneHashes: hashes,
    consoleErrors,
  }, null, 2));
} finally {
  await browser.close();
  server.close();
}
