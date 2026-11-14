/* DOM 冒烟测试：用 jsdom + canvas 垫片加载完整页面，验证初始化与主要交互。 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { JSDOM } = require("jsdom");

function makeCanvas(width, height) {
  const ctx = {
    canvas: null,
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createBufferSource: null,
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    transform() {}, clearRect() {}, fillRect() {}, strokeRect() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {},
    arcTo() {}, stroke() {}, fill() {}, fillText() {}, setLineDash() {},
    connect() {}, drawImage() {},
  };
  const canvas = {
    width,
    height,
    style: {},
    getContext: () => ctx,
    addEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    setPointerCapture() {},
    releasePointerCapture() {},
    toDataURL: () => "data:image/png;base64,AAAA",
  };
  ctx.canvas = canvas;
  return canvas;
}

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://example.test/" });
const { window } = dom;

window.HTMLCanvasElement.prototype.getContext = function () {
  return makeCanvas(this.width || 300, this.height || 150).getContext();
};
window.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,AAAA";
window.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
window.cancelAnimationFrame = (id) => clearTimeout(id);
window.performance = { now: () => Date.now() };
window.AudioContext = function () {
  return {
    state: "running",
    currentTime: 0,
    sampleRate: 44100,
    destination: {},
    resume() {},
    createGain: () => ({ gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }),
    createBiquadFilter: () => ({ type: "", frequency: { value: 0 }, Q: { value: 0 }, connect() {} }),
    createBuffer: (ch, n) => ({ getChannelData: () => new Float32Array(n) }),
    createBufferSource: () => ({ connect() {}, start() {}, stop() {} }),
    createOscillator: () => ({
      type: "", frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() {}, start() {}, stop() {},
    }),
  };
};

const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
for (const src of scripts) {
  const code = fs.readFileSync(path.join(__dirname, "..", src), "utf8");
  window.eval(code);
}

const HH = window.HH;
assert.ok(HH && HH.Renderer && HH.Timeline && HH.CurveEditor, "全局命名空间与类已挂载");

const app = window.HH_APP;
assert.ok(app, "app.js 已完成初始化并暴露 HH_APP");
assert.strictEqual(app.timeline.totalFrames(), 120, "4 秒 30fps 应为 120 帧");

const $ = (id) => window.document.getElementById(id);

$("nextFrameBtn").click();
assert.strictEqual(app.timeline.currentFrame(), 1, "单帧前进共用同一时间线");
$("prevFrameBtn").click();
assert.strictEqual(app.timeline.currentFrame(), 0, "单帧后退");

$("durationInput").value = "2";
$("durationInput").dispatchEvent(new window.Event("change"));
assert.strictEqual(app.timeline.totalFrames(), 60, "修改时长后帧数更新");

$("fpsSelect").value = "60";
$("fpsSelect").dispatchEvent(new window.Event("change"));
assert.strictEqual(app.timeline.totalFrames(), 120, "2 秒 60fps 仍为 120 帧");

$("presetName").value = "测试预设";
$("savePresetBtn").click();
const names = HH.listPresets().map((p) => p.name);
assert.ok(names.includes("测试预设"), "自定义预设写入 localStorage");
const restored = HH.getPreset("测试预设");
assert.ok(restored.config.pan.points.length >= 2, "预设内容可读回");

const wild = HH.getPreset("剧烈奔跑（易露边）");
app.config.pan.points = wild.config.pan.points.map((p) => ({ ...p }));
app.refresh();
const wildHits = HH.findOvershoot(
  app.config, app.timeline.durationSec, app.timeline.fps,
  { sceneW: HH.SCENE_W, sceneH: HH.SCENE_H, viewW: HH.VIEW_W, viewH: HH.VIEW_H }
);
assert.ok(wildHits.length > 0, "剧烈预设应触发边缘露出警告");
$("presetSelect").value = "轻微手持（默认）";
$("presetSelect").dispatchEvent(new window.Event("change"));
const calmHits = HH.findOvershoot(
  app.config, app.timeline.durationSec, app.timeline.fps,
  { sceneW: HH.SCENE_W, sceneH: HH.SCENE_H, viewW: HH.VIEW_W, viewH: HH.VIEW_H }
);
assert.strictEqual(calmHits.length, 0, "切回默认预设后全片无露边");

$("audioEnableBtn").click();
assert.strictEqual(app.audio.enabled, true, "脚步声可启用");
$("stepRate").value = "2.4";
$("stepRate").dispatchEvent(new window.Event("change"));
assert.strictEqual(app.audio.rate, 2.4, "步频更新");

$("validateBtn").click();
const msg = $("validateMsg").textContent;
assert.ok(msg.length > 0, "全片校验产生结果文案");

$("exportLastBtn").click();
const endState = HH.cameraState(app.config, 1);
const endEdges = HH.overscanEdges(
  HH.SCENE_W, HH.SCENE_H, HH.VIEW_W, HH.VIEW_H, endState
);
assert.strictEqual(endEdges.length, 0, "默认预设末尾帧不越出画面");

const dataUrl = app.renderer.exportFrame(HH.cameraState(app.config, 0));
assert.ok(dataUrl.startsWith("data:image/png"), "当前帧可导出为 PNG data URL");

console.log("dom.smoke: 页面初始化与交互冒烟测试全部通过");
