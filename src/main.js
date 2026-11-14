import { NoiseEngine, RESIDUAL_GOAL } from './engine.js';
import { buildControls, createInitialState } from './controls.js';
import { drawSpectrum } from './spectrum.js';
import { runVerification } from './verifier.js';

const el = (id) => document.getElementById(id);
const canvas = el('spectrum');

let engine = null;
let state = createInitialState();
let inputs = null;
let rafId = 0;
let currentSeed = el('seedInput').value;

function startEngine(seed) {
  if (engine) {
    cancelAnimationFrame(rafId);
    engine.dispose();
  }
  const ctx = new AudioContext();
  engine = new NoiseEngine(ctx, seed);
  state = createInitialState();
  inputs = buildControls(engine, state, () => {});
  el('verdict').className = 'verdict hidden';
  el('verifyLog').textContent = '尚未运行。';
  currentSeed = seed;
  loop();
}

function loop() {
  syncStateFromEngine();
  const snap = engine.update(state);
  drawSpectrum(canvas, snap.spectrum, snap.binHz);

  const residualPct = snap.residualRatio * 100;
  el('residualBar').style.width = `${Math.min(100, residualPct)}%`;
  el('residualValue').textContent = `${residualPct.toFixed(1)}%（参考值的比例）`;
  el('thresholdValue').textContent = `阈值 ${RESIDUAL_GOAL * 100}%`;
  el('thresholdLine').style.left = `${RESIDUAL_GOAL * 100}%`;

  el('distortionBar').style.width = `${snap.distortion}%`;
  el('distortionValue').textContent = `${snap.distortion.toFixed(1)}%`;

  if (snap.state === 'won' || snap.state === 'failed') {
    showVerdict(snap);
    return;
  }
  rafId = requestAnimationFrame(loop);
}

// 引擎参数为单一数据源：外部（如自检/自动化）直接改引擎后，回填 state 供应力评估
function syncStateFromEngine() {
  engine.notches.forEach((n, i) => {
    state.notches[i].frequency = n.frequency.value;
    state.notches[i].q = n.Q.value;
  });
  engine.phases.forEach((u, i) => {
    const delay = u.delay.delayTime.value;
    state.phases[i].phaseDeg = Math.round((delay / 0.00167) * 180);
    state.phases[i].wet = Math.abs(u.wet.gain.value);
  });
}

function showVerdict(snap) {
  const box = el('verdict');
  box.classList.remove('hidden');
  if (snap.state === 'won') {
    box.classList.add('won');
    box.classList.remove('failed');
    box.textContent = `成功：残余能量已压到阈值以下（${(snap.residualRatio * 100).toFixed(1)}%），失真仅 ${snap.distortion.toFixed(1)}%`;
  } else {
    box.classList.add('failed');
    box.classList.remove('won');
    box.textContent = `失败：主声源累计失真爆表（${snap.distortion.toFixed(1)}%）。同 seed 重开再试。`;
  }
}

el('startBtn').addEventListener('click', () => {
  startEngine(el('seedInput').value || '20261114');
});

el('resetBtn').addEventListener('click', () => {
  if (!engine) return;
  engine.resetControls();
  state = createInitialState();
  inputs = buildControls(engine, state, () => {});
});

el('restartBtn').addEventListener('click', () => {
  startEngine(currentSeed);
});

el('verifyBtn').addEventListener('click', async () => {
  const btn = el('verifyBtn');
  btn.disabled = true;
  const logEl = el('verifyLog');
  const lines = [];
  const log = (msg) => {
    lines.push(msg);
    logEl.textContent = lines.join('\n');
  };
  try {
    const seed = el('seedInput').value || currentSeed;
    const result = await runVerification(seed, log);
    window.__lastVerification = result;
  } catch (err) {
    log(`自检异常：${err.stack || err.message}`);
  } finally {
    btn.disabled = false;
  }
});

// 供无头测试直接调用
window.__app = { startEngine, runVerification, getEngine: () => engine };
