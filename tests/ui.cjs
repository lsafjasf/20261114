const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const url = process.env.APP_URL || "http://127.0.0.1:4181";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  assert.ok((await page.locator("#sceneCanvas").evaluate((canvas) => canvas.width)) > 600);

  await page.locator('[data-vent="2"]').click();
  await page.locator("#fanRange").fill("68");
  await page.waitForTimeout(250);
  assert.equal(await page.locator("#fanValue").innerText(), "68%");
  assert.match(await page.locator('[data-vent="2"]').getAttribute("class"), /is-open/);

  await page.evaluate(() => {
    const state = window.GrainApp.getSim();
    state.elapsed = 75;
    window.GrainSim.step(state, 1);
  });
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => window.GrainApp.getSim().hotspotTriggered), true);
  assert.match(await page.locator("#hotspotText").innerText(), /热点/);
  await page.screenshot({ path: "screenshots/hotspot.png", fullPage: true });

  await page.locator('[data-turner="1"]').click();
  await page.evaluate(() => window.GrainSim.step(window.GrainApp.getSim(), 31));
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => window.GrainApp.getSim().bins[1].handled), true);
  assert.equal(await page.locator("#hotspotCount").innerText(), "1/1");

  await page.locator("#validateButton").click();
  await page.waitForTimeout(150);
  assert.match(await page.locator("#validationTitle").innerText(), /2\/2/);
  assert.equal(await page.locator(".validation-row.is-pass").count(), 2);
  await page.screenshot({ path: "screenshots/validation.png", fullPage: true });
  await page.locator("#closeValidationButton").click();
  await page.waitForTimeout(100);
  await page.screenshot({ path: "screenshots/interaction.png", fullPage: true });

  await page.reload({ waitUntil: "networkidle" });
  await page.evaluate(() => {
    const state = window.GrainApp.getSim();
    state.controls.fan = 0;
    state.controls.vents = [false, false, false];
    for (let i = 0; i < 32 && state.status === "running"; i += 1) {
      window.GrainSim.step(state, 20);
    }
  });
  await page.waitForTimeout(300);
  assert.equal(await page.locator("#resultModal").isVisible(), true);
  assert.match(await page.locator("#resultTitle").innerText(), /失守/);
  await page.screenshot({ path: "screenshots/mold-failure.png", fullPage: true });

  assert.deepEqual(errors, []);
  console.log("UI checks passed: controls, hotspot, turner, validation modal, mold failure");
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
