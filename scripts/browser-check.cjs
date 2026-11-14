// Optional end-to-end check. Requires Puppeteer and a running HTTP server.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const puppeteer = require("puppeteer");

const baseUrl = process.argv[2] || "http://127.0.0.1:4173";
const artifactDir = path.resolve("artifacts/screenshots");
fs.mkdirSync(artifactDir, { recursive: true });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let browser;

(async () => {
  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-webgl"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 810, deviceScaleFactor: 1 });

  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText || ""}`);
  });

  await page.goto(baseUrl, { waitUntil: "networkidle0" });
  await delay(700);
  await page.screenshot({ path: path.join(artifactDir, "01-start.png") });

  const preview = await page.evaluate(() => window.__ferryDebug.snapshot());
  assert.equal(preview.started, false);
  assert.equal(preview.waiting, 6);

  await page.$eval("#seed-input", (input) => {
    input.value = "";
  });
  await page.type("#seed-input", "lantern-126");
  await page.click(".voyage-form .launch");
  await delay(500);

  const firstBoarding = await page.evaluate(() => window.__ferryDebug.snapshot());
  assert.equal(firstBoarding.started, true);
  assert.equal(firstBoarding.load, 3);
  assert.equal(firstBoarding.waiting, 3);
  assert.equal(firstBoarding.handling.mass, 2.02);
  await page.keyboard.press("Space");
  await delay(80);
  const echo = await page.evaluate(() => window.__ferryDebug.snapshot());
  assert.ok(echo.echo > 0.5, "a short whistle should reveal the beacon bearings");
  await page.screenshot({ path: path.join(artifactDir, "02-first-batch.png") });

  const crewedSpeed = firstBoarding.handling.maxSpeed;
  const beforeY = firstBoarding.boat.y;
  await page.keyboard.down("ArrowUp");
  await delay(650);
  await page.keyboard.up("ArrowUp");
  await delay(120);
  const moved = await page.evaluate(() => window.__ferryDebug.snapshot());
  assert.ok(moved.boat.y < beforeY - 10, "arrow key should move the ferry north");
  assert.ok(moved.boat.vx > 0, "lateral current should pull the ferry east");
  assert.ok(moved.handling.acceleration < 190);

  await page.keyboard.down("ArrowUp");
  let braking = false;
  let afterFirstDelivery = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await delay(80);
    const state = await page.evaluate(() => window.__ferryDebug.snapshot());
    if (state.delivered === 3) {
      afterFirstDelivery = state;
      break;
    }
    if (!braking && state.boat.y < 250) {
      await page.keyboard.up("ArrowUp");
      await page.keyboard.down("ArrowDown");
      braking = true;
    } else if (braking && Math.abs(state.boat.vy) < 25) {
      await page.keyboard.up("ArrowDown");
      await page.keyboard.down("ArrowUp");
      braking = false;
    }
  }
  await page.keyboard.up("ArrowUp");
  await page.keyboard.up("ArrowDown");
  assert.ok(afterFirstDelivery, "the ferry should reach the north dock by keyboard");
  assert.equal(afterFirstDelivery.load, 0);
  assert.equal(afterFirstDelivery.delivered, 3);
  assert.equal(afterFirstDelivery.waiting, 3);

  const secondBoarding = await page.evaluate(() => window.__ferryDebug.dock("south"));
  assert.equal(secondBoarding.load, 3);
  assert.equal(secondBoarding.delivered, 3);
  assert.equal(secondBoarding.waiting, 0);
  assert.equal(secondBoarding.handling.maxSpeed, crewedSpeed);
  await page.screenshot({ path: path.join(artifactDir, "03-second-batch.png") });

  const afterSecondDelivery = await page.evaluate(() => window.__ferryDebug.dock("north"));
  assert.equal(afterSecondDelivery.delivered, 6);
  assert.equal(afterSecondDelivery.load, 0);
  assert.equal(afterSecondDelivery.finalReturn, true);

  const completed = await page.evaluate(() => window.__ferryDebug.dock("south"));
  assert.equal(completed.complete, true);
  assert.equal(completed.objective, "return");
  await delay(450);
  await page.screenshot({ path: path.join(artifactDir, "04-complete.png") });

  const resultVisible = await page.evaluate(() => {
    const screen = document.getElementById("result-screen");
    return !screen.classList.contains("hidden") && document.getElementById("result-time").textContent;
  });
  assert.ok(resultVisible);
  assert.deepEqual(errors, []);

  console.log(
    JSON.stringify(
      {
        seed: completed.seed,
        firstBatch: firstBoarding.load,
        firstDelivery: afterFirstDelivery.delivered,
        secondBatch: secondBoarding.load,
        finalDelivered: afterSecondDelivery.delivered,
        complete: completed.complete,
        screenshots: artifactDir,
        browserErrors: errors.length,
      },
      null,
      2,
    ),
  );
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  browser?.close();
});
