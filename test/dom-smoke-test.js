'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const napi = require('@napi-rs/canvas');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;

// Real pixel-backed canvas for every <canvas>, so getImageData/putImageData work.
window.HTMLCanvasElement.prototype.getContext = function () {
  if (!this._real) {
    this._real = napi.createCanvas(this.width, this.height);
  }
  return this._real.getContext('2d');
};
let rafQueue = [];
window.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
window.cancelAnimationFrame = () => { rafQueue = []; };
let clockMs = 0;
Object.defineProperty(window, 'performance', {
  value: { now: () => clockMs }, configurable: true
});
window.Blob = class { constructor(parts) { this.parts = parts; } };
window.URL.createObjectURL = () => 'blob:fake';
window.URL.revokeObjectURL = () => {};

const coreSrc = fs.readFileSync(path.join(ROOT, 'js/core.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
window.eval(coreSrc);
window.eval(appSrc);

const doc = window.document;
const $ = (id) => doc.getElementById(id);
const fail = [];
function assert(cond, msg) { if (!cond) fail.push(msg); }

// 1. initial render: seam panels populated, badge says uncorrected
assert($('modeBadge').textContent.includes('未修正'), 'initial badge should be uncorrected');
assert($('rawMetrics').textContent.includes('MAE'), 'raw metrics rendered');
assert($('fixMetrics').textContent.includes('MAE'), 'fix metrics rendered');
assert($('snapTable').querySelectorAll('tr').length > 50, 'snap table populated');
const json1 = JSON.parse($('jsonView').textContent);
assert(json1.normalizedSeed === 1489236305, 'seed normalized in export');

// 2. toggle correction -> badge + seam frames switch
$('fixToggle').checked = true;
$('fixToggle').dispatchEvent(new window.Event('change'));
assert($('modeBadge').textContent.includes('已修正'), 'badge flips to corrected');
const json2 = JSON.parse($('jsonView').textContent);
assert(json2.correction.enabled === true, 'export records correction state');

// 3. scrub to last frame then back to first
$('scrubber').value = '8';
$('scrubber').dispatchEvent(new window.Event('input'));
assert($('timeRead').textContent.includes('8.00'), 'scrubber reaches t=8');
$('firstBtn').click();
assert($('timeRead').textContent.includes('0.00'), 'first-frame button resets t');

// 4. three-round live playback: drive rAF clock to 24.1s
$('loop3Btn').click();
clockMs = 24100;
const pending = rafQueue.slice();
rafQueue = [];
pending.forEach((cb) => cb(clockMs));
assert($('roundCount').textContent === '3', 'three rounds counted, got ' + $('roundCount').textContent);
assert($('loopStatus').textContent.includes('3 轮'), 'loop status message shown');

// 5. offline analysis runs synchronously behind setTimeout(30)
$('offlineBtn').click();
clockMs += 40;
// jsdom does not expose timers; use a short real wait instead
setTimeout(() => {
  const status = $('loopStatus').textContent;
  assert(status.includes('离线结果'), 'offline analysis finished: ' + status);
  assert(status.includes('修正前') && status.includes('修正后'), 'both modes compared');

  // 6. new seed changes params; same seed reproduces byte-identical export
  $('seedInput').value = 'abc';
  $('regenBtn').click();
  const jsonA = $('jsonView').textContent;
  $('seedInput').value = 'zzz';
  $('regenBtn').click();
  assert($('jsonView').textContent !== jsonA, 'different seed => different params');
  $('seedInput').value = 'abc';
  $('regenBtn').click();
  assert($('jsonView').textContent === jsonA, 'same seed => byte-identical params');

  // 7. load JSON round trip
  const file = { name: 'p.json', type: 'application/json' };
  const readerResult = jsonA;
  window.FileReader = class {
    readAsText() { this.result = readerResult; this.onload(); }
  };
  Object.defineProperty($('fileInput'), 'files', { value: [file], configurable: true });
  $('fileInput').dispatchEvent(new window.Event('change'));
  setTimeout(() => {
    assert($('ioStatus').textContent.includes('已载入'), 'JSON file loaded');
    if (fail.length) {
      console.error('DOM SMOKE FAIL:\n - ' + fail.join('\n - '));
      process.exit(1);
    }
    console.log('DOM SMOKE PASS: 7 interaction groups,', json1.normalizedSeed, 'seed verified');
  }, 50);
}, 100);
