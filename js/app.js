import {
  DEFAULT_PARAMS,
  FRAME_COUNT,
  FRAME_DURATION,
  HEIGHT,
  WIDTH,
  renderScene,
} from './scene.js';
import { computeDiff, drawMaxMarker, renderView } from './diff.js';

const els = {
  canvas: document.getElementById('stage'),
  slider: document.getElementById('timeline'),
  frameLabel: document.getElementById('frame-label'),
  timeLabel: document.getElementById('time-label'),
  ratioLabel: document.getElementById('ratio-label'),
  maxLabel: document.getElementById('max-label'),
  meanLabel: document.getElementById('mean-label'),
  hueSlider: document.getElementById('hue-b'),
  hueValue: document.getElementById('hue-b-value'),
  thresholdSlider: document.getElementById('threshold'),
  thresholdValue: document.getElementById('threshold-value'),
  playBtn: document.getElementById('play'),
  status: document.getElementById('status'),
};

const ctx = els.canvas.getContext('2d');
const imageData = ctx.createImageData(WIDTH, HEIGHT);

const state = {
  frame: 0,
  mode: 'original',
  playing: false,
  paramsB: { ...DEFAULT_PARAMS, sunHue: 15 }, // B 段太阳色相不同
  threshold: 25,
};

// 按需缓存两段动画的关键帧像素，全部由 renderScene 实时生成
const cacheA = new Map();
const cacheB = new Map();

function getFrame(frame) {
  if (!cacheA.has(frame)) cacheA.set(frame, renderScene(frame, DEFAULT_PARAMS));
  if (!cacheB.has(frame)) cacheB.set(frame, renderScene(frame, state.paramsB));
  return { bufA: cacheA.get(frame), bufB: cacheB.get(frame) };
}

function invalidateB() {
  cacheB.clear();
  els.status.textContent =
    `B 的 ${FRAME_COUNT} 个关键帧缓存已失效，已按新颜色参数重新渲染并重算差分`;
}

function frameTime(frame) {
  return (frame * FRAME_DURATION).toFixed(3);
}

function update() {
  const { bufA, bufB } = getFrame(state.frame);
  const diff = computeDiff(bufA, bufB, state.threshold);
  renderView(imageData, bufA, bufB, diff, state.mode, state.threshold);
  ctx.putImageData(imageData, 0, 0);

  if (state.mode !== 'original' && diff.maxDistance > 0) {
    drawMaxMarker(ctx, diff.maxX, diff.maxY);
  }

  els.frameLabel.textContent = `${state.frame} / ${FRAME_COUNT - 1}`;
  els.timeLabel.textContent = `${frameTime(state.frame)} s`;
  els.ratioLabel.textContent = `${(diff.changedRatio * 100).toFixed(2)}%`;
  els.meanLabel.textContent = diff.meanDistance.toFixed(2);
  els.maxLabel.textContent =
    `(${diff.maxX}, ${diff.maxY})  d=${diff.maxDistance.toFixed(1)}`;
}

export function setMode(mode) {
  state.mode = mode;
  document
    .querySelectorAll('.mode-btn')
    .forEach((btn) =>
      btn.classList.toggle('active', btn.dataset.mode === mode),
    );
  update();
}

export function setFrame(frame) {
  state.frame = Math.min(FRAME_COUNT - 1, Math.max(0, Number(frame)));
  els.slider.value = String(state.frame);
  update();
}

function bindUi() {
  els.slider.max = FRAME_COUNT - 1;
  els.slider.addEventListener('input', (e) => {
    state.playing = false;
    els.playBtn.textContent = '播放';
    setFrame(e.target.value);
  });

  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  els.hueSlider.addEventListener('input', (e) => {
    state.paramsB.sunHue = Number(e.target.value);
    els.hueValue.textContent = `${state.paramsB.sunHue}°`;
    invalidateB();
    update();
  });

  els.thresholdSlider.addEventListener('input', (e) => {
    state.threshold = Number(e.target.value);
    els.thresholdValue.textContent = String(state.threshold);
    update();
  });

  els.playBtn.addEventListener('click', () => {
    state.playing = !state.playing;
    els.playBtn.textContent = state.playing ? '暂停' : '播放';
  });
}

function tick() {
  if (state.playing) {
    const next = (state.frame + 1) % FRAME_COUNT;
    setFrame(next);
  }
  window.setTimeout(tick, FRAME_DURATION * 1000);
}

bindUi();
setMode('diff');
update();
tick();
