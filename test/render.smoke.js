'use strict';

// 渲染冒烟：用记录型 Canvas 2D mock 跑真实 Renderer，覆盖三种物体的全部动画阶段。
const path = require('node:path');
const fs = require('node:fs');

function makeCtx() {
  const grad = { addColorStop() {} };
  return new Proxy({
    canvas: { width: 640, height: 480 },
    measureText: () => ({ width: 10 }),
    createRadialGradient: () => grad,
    createLinearGradient: () => grad,
    getImageData: () => ({ data: [] }),
  }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => {};
    },
    set() { return true; },
  });
}

const canvas = { width: 640, height: 480, getContext: () => makeCtx() };
global.window = {};
global.document = {};

const rendererCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'renderer.js'), 'utf8');
const simCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'sim.js'), 'utf8');
new Function('window', 'globalThis', simCode + '\nglobalThis.OBJECTS = OBJECTS; globalThis.GraspSim = GraspSim; globalThis.GAP = GAP;')(global.window, global);
new Function('window', 'globalThis', rendererCode + '\nglobalThis.Renderer = Renderer;')(global.window, global);

const STRATEGIES = {
  soft: { pressure: 20, speed: 20, feedback: 20 },
  medium: { pressure: 36, speed: 45, feedback: 36 },
  hard: { pressure: 65, speed: 60, feedback: 65 },
};

const seenPhases = new Set();
for (const objectId of ['soft', 'medium', 'hard']) {
  const renderer = new Renderer(canvas, OBJECTS[objectId]);
  const sim = new GraspSim({ objectId, ...STRATEGIES[objectId] });
  sim.start();
  let frames = 0;
  while (!sim.passed && !sim.failed && frames < 1000) {
    sim.update(1 / 60);
    renderer.draw(sim.snapshot(), OBJECTS[objectId].maxSafe);
    seenPhases.add(sim.phase);
    frames++;
  }
  if (!sim.passed) throw new Error(`${objectId} 渲染循环中未通过`);
}

// 压坏/滑脱路径也要能渲染
const crush = new GraspSim({ objectId: 'soft', pressure: 70, speed: 80, feedback: 70 });
const r1 = new Renderer(canvas, OBJECTS.soft);
crush.start();
while (!crush.failed) { crush.update(1 / 60); r1.draw(crush.snapshot(), 8); }

const slip = new GraspSim({ objectId: 'hard', pressure: 25, speed: 30, feedback: 25 });
const r2 = new Renderer(canvas, OBJECTS.hard);
slip.start();
while (!slip.failed) { slip.update(1 / 60); r2.draw(slip.snapshot(), 30); }

const required = ['approaching', 'compressing', 'holding', 'lifting', 'passed', 'failed'];
for (const phase of required) {
  if (!seenPhases.has(phase) && phase !== 'failed') throw new Error(`缺少阶段渲染: ${phase}`);
}
console.log('渲染冒烟通过：三物体全阶段 + 压坏/滑脱画面均正常绘制');
