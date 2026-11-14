/* 端到端：真实浏览器中完成八格配置、重分配、播放、保存并重新载入验证 */
const assert = require("assert");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const p = path.join(ROOT, req.url === "/" ? "index.html" : req.url.split("?")[0]);
      fs.readFile(p, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "text/plain" });
        res.end(data);
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

(async () => {
  const srv = await serve();
  const url = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", e => { throw new Error("页面 JS 错误: " + e.message); });

  await page.goto(url);
  await page.waitForSelector(".prow");

  // 1. 八格编辑行已渲染
  assert.strictEqual(await page.locator(".prow").count(), 8, "应渲染 8 个格子行");

  // 2. 实际完成八格：逐格设置镜头类型
  const shots = ["long", "full", "medium", "close", "extreme-close", "insert", "pov", "medium"];
  for (let i = 0; i < 8; i++) {
    await page.locator(".prow").nth(i).locator("select").selectOption(shots[i]);
  }

  // 3. 手动修改第 2、5 格时长（锁定）
  await page.locator(".prow").nth(1).locator('input[type="number"]').fill("4");
  await page.locator(".prow").nth(1).locator('input[type="number"]').dispatchEvent("change");
  await page.locator(".prow").nth(4).locator('input[type="number"]').fill("2.5");
  await page.locator(".prow").nth(4).locator('input[type="number"]').dispatchEvent("change");

  // 4. 修改总长度 → 未锁定格等宽重分配，锁定格不变
  await page.locator("#totalLen").fill("24");
  await page.locator("#totalLen").dispatchEvent("change");
  let st = await page.evaluate(() => window.__app.getState());
  assert.strictEqual(st.panels[1].duration, 4, "锁定格 2 时长不应被覆盖");
  assert.strictEqual(st.panels[4].duration, 2.5, "锁定格 5 时长不应被覆盖");
  const freeDur = st.panels[0].duration;
  [0, 2, 3, 5, 6].forEach(i => assert.strictEqual(st.panels[i].duration, freeDur, "未锁定格应等宽"));
  const sum = st.panels.reduce((s, p) => s + p.duration, 0);
  assert.ok(Math.abs(sum - 24) < 1e-9, "总时长应为 24s");

  // 5. 修改 BPM
  await page.locator("#bpm").fill("90");
  await page.locator("#bpm").dispatchEvent("change");

  // 6. 播放：鼓点调度启动、播放头推进、当前镜头与节拍线同步
  await page.click("#playBtn");
  await page.waitForTimeout(600);
  assert.strictEqual(await page.locator("#playBtn").textContent(), "■ 停止");
  const sync = await page.evaluate(() => {
    const s = window.__app.getState();
    const M = window.__app.model;
    return { panel: M.panelAt(s, 0.5), beat: Math.floor(0.5 / (60 / s.bpm)) };
  });
  assert.strictEqual(sync.panel, 0, "0.5s 应在第 1 格");
  assert.strictEqual(sync.beat, 0, "0.5s@90bpm 应在第 1 拍");
  await page.click("#playBtn"); // 停止

  // 7. 保存 JSON：序列化内容完整
  const json = await page.evaluate(() => window.__app.model.serialize(window.__app.getState()));
  const parsed = JSON.parse(json);
  assert.strictEqual(parsed.panels.length, 8);
  assert.strictEqual(parsed.bpm, 90);
  assert.strictEqual(parsed.panels[1].locked, true);

  // 8. 重新载入页面：状态应从 localStorage 完整恢复
  await page.reload();
  await page.waitForSelector(".prow");
  st = await page.evaluate(() => window.__app.getState());
  assert.strictEqual(st.panels.length, 8, "重载后仍为 8 格");
  assert.strictEqual(st.bpm, 90, "BPM 应恢复");
  assert.strictEqual(st.totalLength, 24, "总长度应恢复");
  assert.strictEqual(st.panels[1].duration, 4, "重载后锁定格 2 时长保持");
  assert.strictEqual(st.panels[1].locked, true, "重载后锁定标记保持");
  assert.strictEqual(st.panels[4].duration, 2.5, "重载后锁定格 5 时长保持");
  for (let i = 0; i < 8; i++) {
    assert.strictEqual(st.panels[i].shotType, shots[i], `重载后第 ${i + 1} 格镜头类型保持`);
  }
  assert.strictEqual(await page.locator(".prow").count(), 8, "重载后编辑行完整");
  assert.strictEqual(await page.locator("#bpm").inputValue(), "90");
  assert.strictEqual(await page.locator("#totalLen").inputValue(), "24");

  await page.screenshot({ path: path.join(ROOT, "artifacts", "storyboard.png"), fullPage: true });

  await browser.close();
  srv.close();
  console.log("e2e.test.js: 八格配置 / 重分配 / 播放同步 / 保存并重载 全部通过");
})().catch(e => { console.error("E2E 失败:", e.message); process.exit(1); });
