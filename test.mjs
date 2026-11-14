import { chromium } from "playwright-core";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) process.exitCode = 1;
}

const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", e => { console.error("页面错误:", e.message); process.exitCode = 1; });
await page.goto("file://" + path.join(dir, "index.html"));

// 1. 启动音频
await page.click("#btnAudio");
await page.waitForFunction(() => window.__glass.state.audioReady);
check("音频上下文启动", true);

// 2. 录音：鼠标依次划过 8 根管
await page.evaluate(() => { window.__glass.state.tempo = 180; });
await page.click("#btnRecord");
const box = await page.locator("#stage").boundingBox();
const tubeX = i => box.x + (i + 0.5) * (box.width / 8);
for (let i = 0; i < 8; i++) {
  await page.mouse.move(tubeX(i), box.y + 100);
  await page.waitForTimeout(320);
}
await page.mouse.move(box.x + 10, box.y - 30); // 移出画布，结束最后一个音
await page.waitForTimeout(200);
await page.click("#btnRecord"); // 停止录音
const noteCount = await page.evaluate(() => window.__glass.state.events.length);
check("录制至少 8 个音符", noteCount >= 8, `实际 ${noteCount} 个`);
const distinctTubes = await page.evaluate(
  () => new Set(window.__glass.state.events.map(e => e.tube)).size);
check("覆盖全部 8 根管", distinctTubes === 8, `覆盖 ${distinctTubes} 根`);

// 3. 温度影响：持续振动升温 + 失谐
await page.evaluate(() => { window.__glass.state.tempLimit = 40; });
await page.mouse.move(tubeX(3), box.y + 100);
await page.waitForTimeout(150);
const before = await page.evaluate(() => ({
  temp: window.__glass.tubes[3].temp,
  freq: window.__glass.tubeFreq(window.__glass.tubes[3]),
}));
await page.waitForFunction(
  () => window.__glass.tubes[3].temp > 30, null, { timeout: 5000 });
const mid = await page.evaluate(() => ({
  temp: window.__glass.tubes[3].temp,
  freq: window.__glass.tubeFreq(window.__glass.tubes[3]),
}));
check("持续振动导致升温", mid.temp > before.temp,
  `${before.temp.toFixed(1)}° → ${mid.temp.toFixed(1)}°`);
check("升温导致失谐（频率下降）", mid.freq < before.freq,
  `${before.freq.toFixed(2)}Hz → ${mid.freq.toFixed(2)}Hz`);

// 4. 过热锁定与冷却解锁
await page.waitForFunction(
  () => window.__glass.tubes[3].locked, null, { timeout: 8000 });
const lockedState = await page.evaluate(() => ({
  locked: window.__glass.tubes[3].locked,
  vibrating: window.__glass.tubes[3].vibrating,
}));
check("超过温度上限自动锁定并停止发声",
  lockedState.locked && !lockedState.vibrating);
await page.mouse.move(box.x + 10, box.y - 30);
await page.evaluate(() => { window.__glass.state.tempLimit = 80; });
await page.waitForFunction(
  () => !window.__glass.tubes[3].locked, null, { timeout: 8000 });
check("冷却后自动解锁", true);

// 5. 循环回放
await page.click("#btnPlay");
await page.waitForFunction(
  () => window.__glass.tubes.some(t => t.vibrating), null, { timeout: 15000 });
check("回放触发音符发声", true);
await page.evaluate(() => {
  window.__glass.state.transportStep = window.__glass.TOTAL_STEPS - 0.5;
});
await page.waitForFunction(
  () => window.__glass.state.transportStep < 2, null, { timeout: 5000 });
check("16 小节音序循环回卷", true);
await page.click("#btnStop");

// 6. 导出工程 JSON（先调一根管的音以验证工程数据完整性）
await page.evaluate(() => { window.__glass.tubes[2].tuneCents = 50; });
const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.click("#btnExport"),
]);
const outPath = path.join(dir, "artifacts", "glass-project.json");
await download.saveAs(outPath);
const project = JSON.parse(fs.readFileSync(outPath, "utf8"));
check("导出 JSON 结构完整",
  project.app === "glass-tube-instrument" &&
  project.tubes.length === 8 &&
  project.events.length === noteCount &&
  project.tubes[2].tuneCents === 50 &&
  project.bars === 16,
  `events=${project.events.length}`);

// 7. 重新载入并导入工程
await page.reload();
await page.click("#btnAudio");
await page.waitForFunction(() => window.__glass.state.audioReady);
await page.setInputFiles("#fileInput", outPath);
await page.waitForFunction(
  n => window.__glass.state.events.length === n, noteCount);
const restored = await page.evaluate(() => ({
  events: window.__glass.state.events.length,
  cents: window.__glass.tubes[2].tuneCents,
  tempo: window.__glass.state.tempo,
}));
check("重新载入后工程恢复",
  restored.events === noteCount && restored.cents === 50 && restored.tempo === 180,
  JSON.stringify(restored));
await page.click("#btnPlay");
await page.waitForFunction(
  () => window.__glass.tubes.some(t => t.vibrating), null, { timeout: 15000 });
check("载入的工程可正常回放", true);

await page.screenshot({ path: path.join(dir, "artifacts", "screenshot.png") });
await browser.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 项通过`);
