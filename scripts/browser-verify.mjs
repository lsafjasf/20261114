import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const port = 5479;
const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${port}`;
const screenshotDir = "artifacts/screenshots";
let serverProcess = null;

if (!process.env.BASE_URL) {
  serverProcess = spawn(process.execPath, ["server.mjs"], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  process.on("exit", () => serverProcess?.kill());
  while (true) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }
}

await mkdir(screenshotDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 980 },
  deviceScaleFactor: 1,
});
const runtimeErrors = [];
page.on("pageerror", (error) => runtimeErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") runtimeErrors.push(message.text());
});

await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.loomGame), null, {
  timeout: 10000,
});
await page.waitForTimeout(500);
await page.screenshot({
  path: `${screenshotDir}/loom-initial.png`,
  fullPage: true,
});

await page.evaluate(() =>
  window.loomGame.setSettings({ opening: 50, tension: 1.8, speed: 4.2 }),
);
await page.click("#runButton");
await page.waitForFunction(
  () => window.loomGame.getSnapshot().status === "complete",
  null,
  { timeout: 20000 },
);
await page.waitForTimeout(900);

const fabric = await page.evaluate(() => window.loomGame.getSnapshot());
const audioState = await page.evaluate(() => window.loomGame.getAudioState());
const dialogTitle = await page.locator("#resultTitle").textContent();
const defectText = await page.locator("#defectMetric").textContent();

assert.equal(fabric.status, "complete");
assert.equal(fabric.progressCm, 10);
assert.equal(fabric.rowsDone, 30);
assert.ok(fabric.defects < fabric.defectLimit);
assert.equal(fabric.breakages.length, 0);
assert.equal(fabric.success, true);
assert.equal(defectText, String(fabric.defects));
assert.match(dialogTitle || "", /十厘米/);

await page.screenshot({
  path: `${screenshotDir}/loom-complete.png`,
  fullPage: true,
});
await page.click("#closeResultButton");
await page.screenshot({
  path: `${screenshotDir}/loom-complete-fabric.png`,
  fullPage: true,
});

const canvasDataLength = await page.evaluate(() => {
  const canvas = document.querySelector("#loomCanvas");
  return canvas.toDataURL("image/png").length;
});
assert.ok(canvasDataLength > 20000, "Canvas should contain a rendered fabric");

await page.evaluate(() => {
  window.loomGame.reset();
  window.loomGame.setSettings({ opening: 50, tension: 3.3, speed: 3.1 });
});
await page.click("#runButton");
await page.waitForFunction(
  () => window.loomGame.getSnapshot().status === "broken",
  null,
  { timeout: 8000 },
);
await page.waitForTimeout(900);

const broken = await page.evaluate(() => window.loomGame.getSnapshot());
const breakTitle = await page.locator("#resultTitle").textContent();
const breakCopy = await page.locator("#resultCopy").textContent();

assert.equal(broken.status, "broken");
assert.equal(broken.failureReason, "thread-break");
assert.ok(broken.breakages.length > 0);
assert.equal(broken.success, false);
assert.match(breakTitle || "", /断了/);
assert.match(breakCopy || "", /张力|断/);

await page.screenshot({
  path: `${screenshotDir}/loom-broken.png`,
  fullPage: true,
});
await page.click("#closeResultButton");
await page.screenshot({
  path: `${screenshotDir}/loom-broken-fabric.png`,
  fullPage: true,
});

await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => window.loomGame.reset());
await page.waitForTimeout(400);
const mobileLayout = await page.evaluate(() => ({
  viewport: window.innerWidth,
  scrollWidth: document.documentElement.scrollWidth,
  canvasWidth: Math.round(
    document.querySelector("#loomCanvas").getBoundingClientRect().width,
  ),
}));
assert.ok(
  mobileLayout.scrollWidth <= mobileLayout.viewport + 1,
  "Mobile layout should not overflow horizontally",
);
await page.screenshot({
  path: `${screenshotDir}/loom-mobile.png`,
  fullPage: true,
});

const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  fabric: {
    status: fabric.status,
    lengthCm: fabric.progressCm,
    rows: fabric.rowsDone,
    defects: fabric.defects,
    success: fabric.success,
    canvasPngBytes: canvasDataLength,
  },
  threadBreak: {
    status: broken.status,
    reason: broken.failureReason,
    breakPosition: broken.breakages[0]?.position,
    tension: broken.breakages[0]?.tension,
    success: broken.success,
  },
  audio: audioState,
  mobileLayout,
  runtimeErrors,
  screenshots: [
    "loom-initial.png",
    "loom-complete.png",
    "loom-complete-fabric.png",
    "loom-broken.png",
    "loom-broken-fabric.png",
    "loom-mobile.png",
  ],
};

assert.equal(runtimeErrors.length, 0, runtimeErrors.join("\n"));
await writeFile(
  "artifacts/browser-verification.json",
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
await browser.close();
serverProcess?.kill();
