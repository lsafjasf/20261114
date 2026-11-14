/* 用 node-canvas 真实执行街景绘制与相机变换，导出 PNG 并检查越界黑边。 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { createCanvas } = require("canvas");

global.window = global;
global.document = { createElement: () => createCanvas(2, 2) };
global.localStorage = {
  _data: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; },
  setItem(k, v) { this._data[k] = String(v); },
  removeItem(k) { delete this._data[k]; },
};

function load(file) {
  global.eval(fs.readFileSync(path.join(__dirname, "..", file), "utf8"));
}

load("js/math-core.js");
load("js/presets.js");
load("js/scene.js");
load("js/render.js");
const HH = global.HH;

const outDir = path.join(__dirname, "..", "artifacts", "render-check");
fs.mkdirSync(outDir, { recursive: true });

const stage = createCanvas(HH.VIEW_W, HH.VIEW_H);
const scene = HH.createStreetScene();
const renderer = new HH.Renderer(stage, scene);
renderer.showSafe = false;

function blackPixelRatio(canvas) {
  const ctx = canvas.getContext("2d");
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let black = 0;
  for (let i = 0; i < img.length; i += 4) {
    if (img[i] < 12 && img[i + 1] < 12 && img[i + 2] < 12) black++;
  }
  return black / (img.length / 4);
}

function edgeBlackRatio(canvas) {
  const ctx = canvas.getContext("2d");
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let black = 0;
  let total = 0;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (x > 3 && x < canvas.width - 4 && y > 3 && y < canvas.height - 4) continue;
      total++;
      const i = (y * canvas.width + x) * 4;
      if (img[i] < 12 && img[i + 1] < 12 && img[i + 2] < 12) black++;
    }
  }
  return black / total;
}

function save(canvas, name) {
  fs.writeFileSync(path.join(outDir, name), canvas.toBuffer("image/png"));
}

{
  const state = HH.cameraState(HH.defaultConfig(), 0);
  const edges = renderer.render(state, 0);
  save(stage, "frame-default-start.png");
  assert.strictEqual(edges.length, 0, "默认首帧无越界");
  assert.ok(blackPixelRatio(stage) < 0.02, "首帧几乎没有黑边");
}

{
  const wild = HH.getPreset("剧烈奔跑（易露边）").config;
  const hits = HH.findOvershoot(
    wild, 4, 30,
    { sceneW: HH.SCENE_W, sceneH: HH.SCENE_H, viewW: HH.VIEW_W, viewH: HH.VIEW_H }
  );
  const hit = hits[Math.floor(hits.length / 2)];
  const state = HH.cameraState(wild, hit.t);
  const edges = renderer.render(state, hit.t);
  save(stage, "frame-overshoot-warning.png");
  assert.ok(edges.length > 0, "剧烈预设中段出现露边");
  const exported = createCanvas(HH.VIEW_W, HH.VIEW_H);
  const img = new (require("canvas").Image)();
  img.src = renderer.exportFrame(state);
  exported.getContext("2d").drawImage(img, 0, 0);
  const overshootBlack = blackPixelRatio(exported);
  console.log("露边帧黑边比例", overshootBlack.toFixed(4), "边", edges.join("/"));
  assert.ok(overshootBlack > 0.002, "露边帧出现黑色未覆盖区域");
}

{
  const wild = HH.getPreset("剧烈奔跑（易露边）").config;
  const endState = HH.cameraState(wild, 1);
  const edges = renderer.render(endState, 1);
  const dataUrl = renderer.exportFrame(endState);
  assert.strictEqual(edges.length, 0, "末尾帧不越出画面");
  assert.ok(dataUrl.startsWith("data:image/png"), "末尾帧可导出");
  save(stage, "frame-last-safe.png");
  const lastImg = new (require("canvas").Image)();
  lastImg.src = dataUrl;
  const lastCanvas = createCanvas(HH.VIEW_W, HH.VIEW_H);
  lastCanvas.getContext("2d").drawImage(lastImg, 0, 0);
  assert.strictEqual(edgeBlackRatio(lastCanvas), 0, "末尾帧四条边缘无黑边");
}

{
  fs.writeFileSync(
    path.join(outDir, "scene-full.png"),
    scene.toBuffer("image/png")
  );
  assert.strictEqual(scene.width, HH.SCENE_W, "街景全图尺寸正确");
}

console.log("render.check: 渲染与导出检查通过，PNG 已写入 artifacts/render-check/");
