import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.join(root, "artifacts");
const chromeCandidates = [
  process.env.CHROME_PATH,
  "/home/hj/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome",
  "/home/hj/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
].filter(Boolean);

function contentType(file) {
  const ext = path.extname(file);
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".png": "image/png",
  }[ext] || "application/octet-stream";
}

async function startServer() {
  const server = createServer(async (request, response) => {
    try {
      const urlPath = decodeURIComponent((request.url || "/").split("?")[0]);
      const relative = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
      const file = path.join(root, relative);
      if (!file.startsWith(root)) throw new Error("Invalid path");
      await stat(file);
      const body = await readFile(file);
      response.writeHead(200, { "Content-Type": contentType(file) });
      response.end(body);
    } catch (error) {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function chooseChrome() {
  for (const candidate of chromeCandidates) {
    try {
      await stat(candidate);
      return candidate;
    } catch (error) {
      // Try the next known Chromium location.
    }
  }
  throw new Error("No Chromium executable found. Set CHROME_PATH.");
}

async function setSliders(page, temp, humidity) {
  await page.evaluate(({ nextTemp, nextHumidity }) => {
    const tempSlider = document.querySelector("#temperatureSlider");
    const humiditySlider = document.querySelector("#humiditySlider");
    tempSlider.value = String(nextTemp);
    humiditySlider.value = String(nextHumidity);
    tempSlider.dispatchEvent(new Event("input", { bubbles: true }));
    humiditySlider.dispatchEvent(new Event("input", { bubbles: true }));
  }, { nextTemp: temp, nextHumidity: humidity });
}

async function snapshot(page) {
  return page.evaluate(() => window.bakeryGame.snapshot());
}

async function waitForApp(page) {
  await page.waitForFunction(() => Boolean(window.bakeryGame));
}

async function runSuccessScenario(page, url, errors) {
  await page.goto(url, { waitUntil: "networkidle" });
  await waitForApp(page);
  await setSliders(page, 27, 76);
  await page.locator("#startButton").click();
  await page.waitForFunction(() => window.bakeryGame.snapshot().phase === "running");
  const audioState = await page.evaluate(() => window.bakeryGame.audio.context?.state);
  if (audioState !== "running") {
    throw new Error(`Web Audio did not start: ${audioState}`);
  }

  const deadline = Date.now() + 70000;
  let lastBakeAttempt = 0;
  while (Date.now() < deadline) {
    if (errors.length) throw new Error(`Browser failed during success run: ${errors[0]}`);
    const state = await snapshot(page);
    if (state.phase === "success") break;
    if (state.phase === "failure") {
      throw new Error(`Success scenario unexpectedly failed: ${JSON.stringify(state)}`);
    }
    if (state.oven.phase === "idle" && Date.now() - lastBakeAttempt > 250) {
      const ready = state.batches.find((batch) => batch.status === "ready");
      if (ready) {
        lastBakeAttempt = Date.now();
        await page.locator(`.batch-card[data-id="${ready.id}"] .batch-action`).click();
      }
    }
    await page.waitForTimeout(200);
  }

  const finalState = await snapshot(page);
  if (finalState.phase !== "success") {
    throw new Error(`Success scenario timed out: ${JSON.stringify(finalState)}`);
  }
  for (const batch of finalState.batches) {
    if (batch.status !== "baked") throw new Error(`Batch not baked: ${batch.id}`);
    if (batch.enteredAt < 76 || batch.enteredAt >= 100) {
      throw new Error(`Batch outside quality window: ${batch.id} ${batch.enteredAt}`);
    }
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(artifacts, "success.png"), fullPage: true });
  return finalState;
}

async function runOverproofScenario(page, url, errors) {
  await page.goto(url, { waitUntil: "networkidle" });
  await waitForApp(page);
  await page.locator("#startButton").click();
  await setSliders(page, 36, 95);
  await page.waitForFunction(() => window.bakeryGame.snapshot().phase === "running");

  await page.waitForFunction(
    () => {
      if (window.__e2eError) throw new Error(window.__e2eError);
      return window.bakeryGame.snapshot().phase === "failure";
    },
    null,
    { timeout: 35000 }
  );
  const finalState = await snapshot(page);
  const overproof = finalState.batches.find((batch) => batch.status === "overproof");
  if (!overproof) throw new Error(`No overproof batch: ${JSON.stringify(finalState)}`);
  if (overproof.maturity < 100) throw new Error(`Overproof maturity too low: ${overproof.maturity}`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(artifacts, "overproof.png"), fullPage: true });
  return finalState;
}

const { server, url } = await startServer();
let browser;
try {
  browser = await chromium.launch({
    executablePath: await chooseChrome(),
    headless: true,
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => {
    const message = error.stack || error.message;
    errors.push(message);
    console.error("[browser error]", message);
    page.evaluate((nextMessage) => {
      window.__e2eError = nextMessage;
    }, message).catch(() => {});
  });
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(url, { waitUntil: "networkidle" });
  await waitForApp(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLayout = await page.evaluate(() => ({
    innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clockVisible: Boolean(document.querySelector("#sessionClock").offsetParent),
  }));
  if (mobileLayout.scrollWidth > mobileLayout.innerWidth) {
    throw new Error(`Mobile layout overflows horizontally: ${JSON.stringify(mobileLayout)}`);
  }
  if (!mobileLayout.clockVisible) throw new Error("Mobile timer is hidden");
  await page.setViewportSize({ width: 1440, height: 900 });

  const successfulRun = await runSuccessScenario(page, url, errors);
  const failedRun = await runOverproofScenario(page, url, errors);
  if (errors.length) throw new Error(`Browser errors:\n${errors.join("\n")}`);

  console.log(JSON.stringify({
    success: {
      phase: successfulRun.phase,
      elapsed: successfulRun.elapsed.toFixed(1),
      batches: successfulRun.batches.map((batch) => ({
        id: batch.id,
        enteredAt: batch.enteredAt.toFixed(1),
        status: batch.status,
      })),
    },
    overproof: {
      phase: failedRun.phase,
      elapsed: failedRun.elapsed.toFixed(1),
      batch: failedRun.batches.find((batch) => batch.status === "overproof"),
    },
  }, null, 2));
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
