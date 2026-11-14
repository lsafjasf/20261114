import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { generateRound } from "../src/engine.js";

const url = process.env.APP_URL || "http://127.0.0.1:4311/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));

await page.addInitScript(() => {
  window.__canvasTexts = new Set();
  const fillText = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function patched(text, ...args) {
    window.__canvasTexts.add(String(text));
    return fillText.call(this, text, ...args);
  };
});

try {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  assert.equal(await page.locator("#seed-input").inputValue(), "481516");
  assert.match(await page.locator("#status-line").innerText(), /等待六段声纹落位/);
  const initialUi = await readRoundUi(page);

  const before = await canvasTexts(page);
  assert.equal(before.includes("复原声源路径"), false);
  assert.equal(before.includes("MATCH"), false);

  const round = generateRound("481516");
  const box = await page.locator("#stage").boundingBox();
  const geometry = canvasGeometry(box);
  const eventIndex = new Map(round.events.map((event, index) => [event.id, index]));

  for (const eventId of round.targetOrder) {
    const slot = round.events.find((event) => event.id === eventId).targetSlot;
    await dragCard(page, box, geometry, eventIndex.get(eventId), slot);
  }
  assert.equal(await page.locator("#placed-count").innerText(), "6");
  assert.match(await page.locator("#status-line").innerText(), /可锁定/);

  const prefilled = await canvasTexts(page);
  assert.equal(prefilled.includes("复原声源路径"), false);
  assert.equal(prefilled.includes("MATCH"), false);

  await page.locator("#lock-button").click();
  await page.waitForTimeout(1000);
  assert.match(await page.locator("#status-line").innerText(), /路径吻合/);
  assert.match(await page.locator("#status-line").innerText(), /容差内错位 0/);
  const revealed = await canvasTexts(page);
  assert.equal(revealed.includes("复原声源路径"), true);
  assert.equal(revealed.includes("MATCH"), true);
  await mkdir("artifacts", { recursive: true });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: "artifacts/success-path.png" });

  await page.locator("#same-seed").click();
  await page.waitForTimeout(500);
  const afterRestart = await readRoundUi(page);
  assert.deepEqual(afterRestart, initialUi);
  assert.equal(await page.locator("#placed-count").innerText(), "0");
  assert.equal((await canvasTexts(page)).includes("复原声源路径"), false);

  await page.locator("#play-button").click();
  await page.waitForTimeout(350);
  const reverbBefore = await page.locator("#reverb-status").innerText();
  await page.locator("#door-button").click();
  await page.waitForTimeout(600);
  const reverbAfter = await page.locator("#reverb-status").innerText();
  assert.match(reverbAfter, /OPEN/);
  assert.notEqual(reverbAfter, reverbBefore);

  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await page.locator("#same-seed").click();
  const wrongRound = generateRound("481516");
  for (const event of wrongRound.events) {
    const wrongSlot = (event.targetSlot + 2) % 6;
    await dragCard(page, box, geometry, eventIndex.get(event.id), wrongSlot);
  }
  await page.waitForTimeout(200);
  await page.locator("#lock-button").click();
  await page.waitForTimeout(500);
  assert.match(await page.locator("#status-line").innerText(), /校准失败/);
  assert.equal((await canvasTexts(page)).includes("复原声源路径"), false);
  assert.equal((await canvasTexts(page)).includes("MATCH"), false);

  assert.deepEqual(errors, []);
  console.log("Browser verification passed: drag, failure threshold, secret path, restart, reverb.");
} finally {
  await browser.close();
}

async function dragCard(page, box, geometry, cardIndex, slotIndex) {
  const from = {
    x: box.x + geometry.cardCenters[cardIndex] * geometry.scaleX,
    y: box.y + geometry.cardY * geometry.scaleY,
  };
  const to = {
    x: box.x + geometry.slotCenters[slotIndex] * geometry.scaleX,
    y: box.y + geometry.slotY * geometry.scaleY,
  };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(35);
}

function canvasGeometry(box) {
  const width = Math.max(760, box.width);
  const height = Math.max(640, box.height);
  const pad = 28;
  const gap = 12;
  const cardWidth = (width - pad * 2 - gap * 5) / 6;
  const slotWidth = (width - pad * 2 - gap * 5) / 6;
  const corridorTop = 50 + 142 + 26 + 132 + 28;
  const corridorBottom = height - 26;
  const slotY = corridorBottom - 104 + 52;
  return {
    scaleX: box.width / width,
    scaleY: box.height / height,
    cardY: 50 + 142 / 2,
    cardCenters: Array.from({ length: 6 }, (_, index) => pad + index * (cardWidth + gap) + cardWidth / 2),
    slotCenters: Array.from({ length: 6 }, (_, index) => pad + index * (slotWidth + gap) + slotWidth / 2),
    slotY,
    corridorTop,
  };
}

async function canvasTexts(page) {
  await page.evaluate(() => window.__canvasTexts.clear());
  await page.waitForTimeout(120);
  return page.evaluate(() => [...window.__canvasTexts].map((text) => text.trim()));
}

async function readRoundUi(page) {
  return {
    seed: await page.locator("#seed-input").inputValue(),
    label: await page.locator("#selected-label").innerText(),
    material: await page.locator("#selected-material").innerText(),
    echo: await page.locator("#value-echo").innerText(),
    pan: await page.locator("#value-pan").innerText(),
    low: await page.locator("#value-low").innerText(),
  };
}
