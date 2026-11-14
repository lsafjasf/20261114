import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:4187/";
const ARTIFACT_DIR = new URL("../artifacts/", import.meta.url).pathname;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureServer() {
  try {
    const response = await fetch(BASE_URL);
    if (response.ok) return null;
  } catch {
    // Start the local static server below.
  }

  const server = spawn(
    "python3",
    ["-m", "http.server", "4187", "--bind", "127.0.0.1"],
    { cwd: new URL("..", import.meta.url).pathname, stdio: "ignore" }
  );
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(150);
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return server;
    } catch {
      // Server is still starting.
    }
  }
  server.kill();
  throw new Error(`Could not start test server at ${BASE_URL}`);
}

async function run() {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  const server = await ensureServer();
  const browser = await chromium.launch({
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"]
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const runtimeErrors = [];
  const held = new Set();

  page.on("pageerror", (error) => runtimeErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });

  async function snapshot() {
    return page.evaluate(() => window.__iceRig.snapshot());
  }

  async function setKey(key, pressed) {
    if (pressed === held.has(key)) return;
    if (pressed) {
      await page.keyboard.down(key);
      held.add(key);
    } else {
      await page.keyboard.up(key);
      held.delete(key);
    }
  }

  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const initial = await snapshot();
    assert.equal(initial.phase, "ready");
    assert.equal(initial.mode, "duo");
    assert.equal(initial.totalDepth, 330);
    await page.screenshot({ path: `${ARTIFACT_DIR}01-briefing.png`, fullPage: true });

    await page.locator("#startButton").click();
    await page.waitForTimeout(350);
    const started = await snapshot();
    assert.equal(started.phase, "running");
    assert.equal(started.audio.state, "running", "Web Audio should unlock from the start gesture");

    const audioAtStart = started.audio.frequency;
    await setKey("a", true);
    await setKey("ArrowUp", true);
    await setKey(" ", true);
    await page.waitForTimeout(900);

    const simultaneous = await snapshot();
    assert(simultaneous.activeInputs.includes("pressureUp"), "left operator input is missing");
    assert(simultaneous.activeInputs.includes("rpmUp"), "right operator throttle input is missing");
    assert(simultaneous.activeInputs.includes("clear"), "right operator chip input is missing");
    assert(simultaneous.audio.frequency > audioAtStart, "load-driven audio pitch should rise");
    assert(simultaneous.depth > 0, "drilling should begin");
    await page.screenshot({ path: `${ARTIFACT_DIR}02-drilling.png`, fullPage: true });

    let last = simultaneous;
    let simultaneousFrames = 1;
    const deadline = Date.now() + 55000;

    while (Date.now() < deadline) {
      last = await snapshot();
      if (last.phase === "complete") break;
      assert.notEqual(last.phase, "failed", `run failed: ${JSON.stringify(last)}`);

      const layerTarget = [0.58, 0.56, 0.5][last.layerIndex] ?? 0.5;
      let targetPressure = layerTarget -
        Math.max(0, Math.min(0.22, (last.temperature - 64) * 0.009));
      if (last.jammed || last.jamTimer > 0.1) targetPressure = 0.25;

      const forceUp = last.pressure < targetPressure - 0.012;
      const forceDown = last.pressure > targetPressure + 0.025;
      const rpmUp = last.rpmNormalized < 0.93;
      const rpmDown = last.rpmNormalized > 0.98;

      await setKey("a", forceUp);
      await setKey("z", forceDown);
      await setKey("ArrowUp", rpmUp);
      await setKey("ArrowDown", rpmDown);
      await setKey(" ", true);
      await page.waitForTimeout(110);

      const inputs = (await snapshot()).activeInputs;
      if (
        (inputs.includes("pressureUp") || inputs.includes("pressureDown")) &&
        (inputs.includes("rpmUp") || inputs.includes("rpmDown") || inputs.includes("clear"))
      ) {
        simultaneousFrames += 1;
      }
    }

    for (const key of [...held]) await setKey(key, false);
    const completed = await snapshot();
    assert.equal(completed.phase, "complete", `drilling did not complete: ${JSON.stringify(completed)}`);
    assert.equal(completed.depth, 330);
    assert(completed.elapsed > 5, "completion should be a real-time drill run");
    assert(completed.maxTemperature < 100, "completion should not include a thermal failure");
    assert(simultaneousFrames > 5, "the run should contain repeated simultaneous two-player input");

    const resultVisible = await page.locator("#resultCard").isVisible();
    assert(resultVisible, "completion result card should be visible");
    await page.screenshot({ path: `${ARTIFACT_DIR}03-complete.png`, fullPage: true });

    await page.locator("#retryButton").click();
    await page.keyboard.press("p");
    await page.waitForTimeout(250);
    const soloMode = await snapshot();
    assert.equal(soloMode.mode, "solo", "P should activate single-player debug mode");
    assert(await page.locator("#debugPanel").isVisible(), "debug telemetry should be visible");
    assert(await page.locator("body").evaluate((body) => body.classList.contains("solo")));

    const soloPressureBefore = soloMode.pressure;
    const soloRpmBefore = soloMode.rpmNormalized;
    await setKey("w", true);
    await setKey("ArrowUp", true);
    await setKey(" ", true);
    await page.waitForTimeout(1000);
    const soloActive = await snapshot();
    assert(soloActive.activeInputs.includes("pressureUp"), "solo W pressure mapping failed");
    assert(soloActive.activeInputs.includes("rpmUp"), "solo throttle mapping failed");
    assert(soloActive.activeInputs.includes("clear"), "solo chip mapping failed");
    assert(soloActive.pressure > soloPressureBefore, "solo pressure input did not change force");
    assert(soloActive.rpmNormalized > soloRpmBefore, "solo throttle input did not change rpm");
    assert.equal(soloActive.mode, "solo");
    assert.equal(await page.locator("#modeLabel").textContent(), "单人调试");
    await page.screenshot({ path: `${ARTIFACT_DIR}04-solo-debug.png`, fullPage: true });

    for (const key of [...held]) await setKey(key, false);
    assert.deepEqual(runtimeErrors, [], `browser runtime errors: ${runtimeErrors.join(" | ")}`);

    const report = {
      passed: true,
      completedAt: new Date().toISOString(),
      browser: "Chromium (Playwright)",
      duoRun: {
        initialAudioHz: audioAtStart,
        finalAudioHz: completed.audio.frequency,
        depthMeters: completed.depth,
        elapsedSeconds: completed.elapsed,
        maxTemperatureC: completed.maxTemperature,
        finalPressure: completed.pressure,
        finalRpm: completed.rpm,
        simultaneousInputSamples: simultaneousFrames,
        evidence: simultaneous.activeInputs
      },
      soloDebug: {
        mode: soloActive.mode,
        activeInputs: soloActive.activeInputs,
        debugPanelVisible: true,
        depthMeters: soloActive.depth,
        audioState: soloActive.audio.state
      },
      screenshots: [
        "artifacts/01-briefing.png",
        "artifacts/02-drilling.png",
        "artifacts/03-complete.png",
        "artifacts/04-solo-debug.png"
      ]
    };
    await writeFile(`${ARTIFACT_DIR}verification.json`, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    for (const key of [...held]) {
      await page.keyboard.up(key).catch(() => {});
    }
    await browser.close();
    if (server) server.kill();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
