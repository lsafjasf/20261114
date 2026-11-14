import { AuroraEngine, DEFAULTS, BUFFER_WIDTH, BUFFER_HEIGHT } from './engine.js';

const canvas = document.getElementById('aurora');
const canvasCtx = canvas.getContext('2d');
const display = document.createElement('canvas');
display.width = canvas.width;
display.height = canvas.height;
const dctx = display.getContext('2d');
dctx.imageSmoothingEnabled = true;
dctx.imageSmoothingQuality = 'high';

// 内部低分辨率缓冲做逐帧计算，再上采样到显示画布，保留柔化雾化边缘。
const buffer = document.createElement('canvas');
buffer.width = BUFFER_WIDTH;
buffer.height = BUFFER_HEIGHT;
const engine = new AuroraEngine(buffer, { ...DEFAULTS });

const $ = (id) => document.getElementById(id);
const rangeIds = ['sourceX', 'sourceY', 'brightness', 'density', 'cool'];

function syncControls() {
  $('seed').value = engine.params.seed;
  for (const id of rangeIds) {
    $(id).value = engine.params[id];
    $(`${id}Val`).textContent = Number(engine.params[id]).toFixed(2);
  }
}

function setStatus() {
  $('status').textContent = engine.params.playing ? '运行中' : '已暂停';
  $('togglePlay').textContent = engine.params.playing ? '暂停' : '继续';
}

function frame(now) {
  engine.tick(now);
  dctx.clearRect(0, 0, display.width, display.height);
  dctx.drawImage(buffer, 0, 0, display.width, display.height);
  canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
  canvasCtx.drawImage(display, 0, 0);
  requestAnimationFrame(frame);
}

for (const id of rangeIds) {
  $(id).addEventListener('input', (e) => {
    const value = Number(e.target.value);
    engine.setParam(id, value);
    $(`${id}Val`).textContent = value.toFixed(2);
  });
}

$('seed').addEventListener('change', (e) => {
  const value = Number(e.target.value) >>> 0;
  engine.setParam('seed', value);
  e.target.value = value;
});

$('randomSeed').addEventListener('click', () => {
  engine.setParam('seed', (crypto.getRandomValues(new Uint32Array(1))[0]));
  syncControls();
});

$('togglePlay').addEventListener('click', () => {
  engine.setParam('playing', !engine.params.playing);
  setStatus();
});

// 在画面上拖动直接改变光源位置。
let dragging = false;
function updateSourceFromPointer(event) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
  engine.setParams({ sourceX: x, sourceY: y });
  syncControls();
}
canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  canvas.setPointerCapture(e.pointerId);
  updateSourceFromPointer(e);
});
canvas.addEventListener('pointermove', (e) => {
  if (dragging) updateSourceFromPointer(e);
});
canvas.addEventListener('pointerup', () => {
  dragging = false;
});

// 保存当前帧 PNG；暂停时截图与当前画面完全一致，且同 seed 可复现。
$('screenshot').addEventListener('click', () => {
  engine.renderAt(engine.params.time);
  dctx.clearRect(0, 0, display.width, display.height);
  dctx.drawImage(buffer, 0, 0, display.width, display.height);
  const link = document.createElement('a');
  link.download = `aurora-seed-${engine.params.seed}.png`;
  link.href = display.toDataURL('image/png');
  link.click();
});

syncControls();
setStatus();
requestAnimationFrame(frame);
