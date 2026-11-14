import { test, expect } from "@playwright/test";

async function bootShift(page) {
  await page.goto("/");
  await page.locator("#modal-primary").click();
  await page.evaluate(() => window.stationGame.setAutoTick(false));
}

async function advance(page, seconds) {
  return page.evaluate((amount) => window.stationGame.advance(amount), seconds);
}

async function snapshot(page) {
  return page.evaluate(() => window.stationGame.snapshot());
}

async function selectPack(page, packId) {
  await page.locator(`.pack-card[data-battery="${packId}"] .pack-id`).click();
}

async function dispatchCar(page, carId, mode = "swap") {
  await page.locator(`[data-car="${carId}"][data-action="${mode}"]`).click();
}

test("completes a six-car rush, freezes on pause, and resets on retry", async ({ page }) => {
  await bootShift(page);
  await advance(page, 2);

  await page.locator("#pause-button").click();
  const frozen = await snapshot(page);
  expect(frozen.status).toBe("paused");
  expect(frozen.modalVisible).toBe(true);
  expect(frozen.modalTitle).toBe("班次暂停。");
  await page.waitForTimeout(240);
  await page.screenshot({ path: "artifacts/02-paused.png", fullPage: true });

  await advance(page, 3);
  const pausedLater = await snapshot(page);
  expect(pausedLater.elapsed).toBeCloseTo(frozen.elapsed, 4);
  expect(pausedLater.queue[0].waited).toBeCloseTo(frozen.queue[0].waited, 4);
  expect(pausedLater.batteries[0].temp).toBeCloseTo(frozen.batteries[0].temp, 4);

  await page.locator("#modal-primary").click();
  expect((await snapshot(page)).paused).toBe(false);
  await advance(page, 1);
  expect((await snapshot(page)).elapsed).toBeGreaterThan(frozen.elapsed);

  await advance(page, 20.5);
  const peak = await snapshot(page);
  expect(peak.queue.map((car) => car.id)).toEqual([
    "A-01",
    "A-02",
    "A-03",
    "A-04",
    "A-05",
    "A-06",
  ]);
  await page.locator('[data-move-up="A-02"]').click();
  expect((await snapshot(page)).queue.map((car) => car.id).slice(0, 2)).toEqual([
    "A-02",
    "A-01",
  ]);
  await page.locator('[data-move-up="A-01"]').click();
  expect((await snapshot(page)).queue.map((car) => car.id).slice(0, 2)).toEqual([
    "A-01",
    "A-02",
  ]);
  await page.screenshot({ path: "artifacts/03-rush-peak.png", fullPage: true });

  await selectPack(page, "P3");
  await dispatchCar(page, "A-01", "swap");
  await selectPack(page, "P2");
  await dispatchCar(page, "A-02", "charge");
  await page.locator('[data-cool="P4"]').click();
  expect((await snapshot(page)).batteries.find((battery) => battery.id === "P4").cooling).toBe(true);
  await page.screenshot({ path: "artifacts/04-bays-active.png", fullPage: true });

  await advance(page, 6.7);
  expect((await snapshot(page)).served).toBe(1);

  await selectPack(page, "P1");
  await dispatchCar(page, "A-03", "swap");
  await advance(page, 3.55);
  expect((await snapshot(page)).served).toBe(2);

  await selectPack(page, "P4");
  await dispatchCar(page, "A-04", "swap");
  await advance(page, 3.2);
  expect((await snapshot(page)).served).toBe(3);

  await selectPack(page, "P3");
  await dispatchCar(page, "A-05", "swap");
  const won = await advance(page, 5);
  expect(won.status).toBe("won");
  expect(won.served).toBe(5);
  expect(won.left).toEqual([]);
  expect(won.deliveryOrder).toHaveLength(5);
  expect(Math.max(...won.batteries.map((battery) => battery.temp))).toBeLessThan(84);

  await expect(page.locator("#modal")).toHaveClass(/is-visible/);
  await expect(page.locator("#modal-title")).toHaveText("五车离站，热限守住。");
  const audio = (await snapshot(page)).audio;
  expect(audio.contextCreated).toBe(true);
  expect(audio.state).toBe("running");
  expect(audio.stats.arm).toBeGreaterThanOrEqual(5);
  expect(audio.stats.cooling).toBeGreaterThanOrEqual(1);
  await page.screenshot({ path: "artifacts/04-success.png", fullPage: true });

  await page.locator("#modal-primary").click();
  await page.waitForTimeout(280);
  const reset = await snapshot(page);
  expect(reset.status).toBe("running");
  expect(reset.elapsed).toBe(0);
  expect(reset.served).toBe(0);
  expect(reset.queue.map((car) => car.id)).toEqual(["A-01"]);
  expect(reset.selectedBattery).toBe("P3");
  expect(reset.paused).toBe(false);
  expect(reset.modalVisible).toBe(false);
  await page.screenshot({ path: "artifacts/05-retry.png", fullPage: true });
});

test("raises a synthesized thermal alarm and retries after overheat", async ({ page }) => {
  await bootShift(page);
  await selectPack(page, "P1");
  await dispatchCar(page, "A-01", "swap");
  await advance(page, 6.7);

  await selectPack(page, "P1");
  await dispatchCar(page, "A-02", "swap");
  const failed = await advance(page, 6);
  expect(failed.status).toBe("lost");
  expect(failed.audio.stats.arm).toBeGreaterThanOrEqual(2);
  expect(failed.audio.stats.alarm).toBeGreaterThanOrEqual(1);

  await page.waitForTimeout(720);
  await expect(page.locator("#modal")).toHaveClass(/is-visible/);
  await expect(page.locator("#modal-title")).toHaveText("热限突破。");
  await page.screenshot({ path: "artifacts/06-thermal-failure.png", fullPage: true });

  await page.locator("#modal-primary").click();
  await page.waitForTimeout(280);
  const reset = await snapshot(page);
  expect(reset.status).toBe("running");
  expect(reset.elapsed).toBe(0);
  expect(reset.served).toBe(0);
  expect(reset.queue.map((car) => car.id)).toEqual(["A-01"]);
});

test("removes impatient cars from the queue and reports queue loss", async ({ page }) => {
  await bootShift(page);
  const failed = await advance(page, 30);
  expect(failed.status).toBe("lost");
  expect(failed.left).toEqual(["A-01", "A-02"]);
  expect(failed.queue.map((car) => car.id)).toEqual(["A-03", "A-04", "A-05", "A-06"]);

  await page.waitForTimeout(720);
  await expect(page.locator("#modal")).toHaveClass(/is-visible/);
  await expect(page.locator("#modal-title")).toHaveText("队列失去目标。");
  await page.screenshot({ path: "artifacts/07-queue-timeout.png", fullPage: true });
});
