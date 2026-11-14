const assert = require('assert');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeCtx() {
  return {
    calls: [],
    fillRect() {}, clearRect() {}, strokeRect() {},
    beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, closePath() {},
    fill() {}, stroke() {}, fillText() {}, drawImage() {},
    createImageData(w, h) {
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    },
    putImageData() {}, save() {}, restore() {},
    set fillStyle(v) {}, get fillStyle() { return ''; },
    set strokeStyle(v) {}, get strokeStyle() { return ''; },
    set lineWidth(v) {}, get lineWidth() { return 1; },
    set font(v) {}, get font() { return ''; },
    set textAlign(v) {}, get textAlign() { return ''; },
    set textBaseline(v) {}, get textBaseline() { return ''; },
    set globalAlpha(v) {}, get globalAlpha() { return 1; }
  };
}

function makeElement(tag) {
  const el = {
    tagName: tag,
    children: [],
    style: {},
    dataset: {},
    hidden: false,
    value: '',
    width: 1000,
    height: 750,
    innerHTML: '',
    textContent: '',
    classList: { add() {}, remove() {} },
    getContext() { return makeCtx(); },
    appendChild(child) { this.children.push(child); },
    addEventListener(type, fn) { (this._listeners ||= {})[type] = fn; },
    dispatch(type, evt) { this._listeners && this._listeners[type] && this._listeners[type](evt); },
    querySelector(sel) { return makeElement('q'); },
    toDataURL() { return 'data:image/png;base64,xxx'; },
    click() {}
  };
  return el;
}

function buildSandbox() {
  const registry = {};
  const document = {
    getElementById(id) {
      if (!registry[id]) registry[id] = makeElement('div');
      return registry[id];
    },
    createElement(tag) { return makeElement(tag); },
    querySelector() { return makeElement('q'); },
    querySelectorAll() { return [{}, {}, {}]; }
  };
  const sandbox = {
    document,
    window: { addEventListener() {} },
    console,
    Uint8Array, Uint8ClampedArray, Float32Array, Math, Buffer
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  const coverageSrc = fs.readFileSync(path.join(__dirname, '../src/coverage.js'), 'utf8');
  const appSrc = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  vm.runInContext(coverageSrc, sandbox);
  vm.runInContext(appSrc, sandbox);
  return { sandbox, registry };
}

test('页面初始化后渲染并输出实时统计', () => {
  const { registry } = buildSandbox();
  assert.ok(registry.statRate.textContent.endsWith('%'));
  assert.ok(registry.statBlind.textContent.includes('m²'));
  assert.ok(registry.stationControls.children.length === 3);
});

test('模拟拖动基站会同步更新坐标标签与统计', () => {
  const { sandbox, registry } = buildSandbox();
  const before = registry.statCovered.textContent;
  const canvas = registry.map;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 750 });
  canvas.dispatch('mousedown', { clientX: 520, clientY: 430 });
  canvas.dispatch('mousemove', { clientX: 620, clientY: 360 });
  sandbox.window.addEventListener;
  const after = registry.statCovered.textContent;
  assert.notStrictEqual(before, after);
  assert.ok(registry.mouseHud.textContent.includes('620'));
});

test('确认与导出按钮可执行', () => {
  const { registry } = buildSandbox();
  registry.btnConfirm.dispatch('click', {});
  assert.strictEqual(registry.confirmBox.hidden, false);
  assert.ok(registry.confirmRate.textContent.endsWith('%'));
  assert.doesNotThrow(() => registry.btnExport.dispatch('click', {}));
});
