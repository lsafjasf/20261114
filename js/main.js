import { PumpAudio } from './audio.js';
import { renderStation } from './renderer.js';
import {
  DURATION_SECONDS,
  PASS_STORAGE_LITERS,
  WaterStationSimulation
} from './simulation.js';

const $ = (id) => document.getElementById(id);
const canvas = $('stationCanvas');
const controls = {
  bypass: $('bypassInput'),
  pumpPressure: $('pressureInput'),
  backwashCycle: $('cycleInput'),
  autoBackwash: $('autoBackwashInput'),
  speed: $('speedSelect')
};

const simulation = new WaterStationSimulation();
const audio = new PumpAudio();
let running = false;
let lastFrame = performance.now();
let accumulator = 0;
let soundOn = false;
let lastBackwashId = null;

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const rest = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${rest}`;
}

function addLog(message) {
  const item = document.createElement('li');
  item.textContent = `${formatTime(simulation.elapsed)}  ${message}`;
  $('logList').prepend(item);
  while ($('logList').children.length > 12) {
    $('logList').lastElementChild.remove();
  }
}

function syncControls() {
  $('bypassValue').textContent = `${simulation.bypass.toFixed(0)}%`;
  $('pressureValue').textContent = `${simulation.pumpPressure.toFixed(0)} bar`;
  $('cycleValue').textContent = `${simulation.backwashCycle.toFixed(0)} s`;
  controls.bypass.value = simulation.bypass;
  controls.pumpPressure.value = simulation.pumpPressure;
  controls.backwashCycle.value = simulation.backwashCycle;
  controls.autoBackwash.checked = simulation.autoBackwash;
  controls.speed.value = String(simulation.speed);
}

function updateMembraneCard(element, membrane) {
  const state = membrane.clogged ? '堵塞' : membrane.backwashing ? '反洗中' : '运行';
  element.innerHTML = `
    <div class="membrane-title"><span>膜 ${membrane.id}</span><span>${state}</span></div>
    <div class="bar"><i style="width:${membrane.fouling}%"></i></div>
    <div class="membrane-meta"><span>污染 ${membrane.fouling.toFixed(1)}%</span><span>流量 ${membrane.flow.toFixed(2)} L/s</span></div>
    <div class="bar life"><i style="width:${membrane.life}%"></i></div>
    <div class="membrane-meta"><span>剩余寿命 ${membrane.life.toFixed(1)}%</span><span>堵塞阈值 100%</span></div>
  `;
}

function updateBanner(state) {
  const banner = $('resultBanner');
  banner.className = 'banner';
  if (state.failureReason) {
    banner.classList.add('fail');
    banner.textContent = `失败：${state.failureReason}`;
  } else if (state.passed) {
    banner.classList.add('pass');
    banner.textContent = `通过：全程最低储水 ${state.minStorage.toFixed(0)} L / 要求 ${state.passStorage} L`;
  } else if (running) {
    banner.classList.add('running');
    banner.textContent = `运行中：保持储水高于 ${PASS_STORAGE_LITERS} L`;
  } else {
    banner.classList.add('idle');
    banner.textContent = '等待启动';
  }
}

function render() {
  const state = simulation.snapshot();
  renderStation(canvas, state);
  $('timeValue').textContent = formatTime(state.remaining);
  $('turbidityValue').textContent = `${state.turbidity.toFixed(1)} NTU`;
  $('storageValue').textContent = `${state.storage.toFixed(0)} L`;
  $('minStorageValue').textContent = `${state.minStorage.toFixed(0)} L`;
  $('flowValue').textContent = `${state.production.toFixed(2)} L/s`;
  $('backwashWaterValue').textContent = `${state.backwashWaterUsed.toFixed(0)} L`;
  updateMembraneCard($('membraneA'), state.membranes[0]);
  updateMembraneCard($('membraneB'), state.membranes[1]);
  updateBanner(state);

  if (state.backwash && state.backwash.membraneId !== lastBackwashId) {
    lastBackwashId = state.backwash.membraneId;
    addLog(`开始反洗膜 ${state.backwash.membraneId}，将消耗 54 L 储水`);
  }
  if (!state.backwash) lastBackwashId = null;

  $('startButton').disabled = state.finished;
  $('backwashButton').disabled = state.finished || Boolean(state.backwash);
  $('turbidityEventButton').disabled = state.finished;
  audio.update(state.pumpPressure, running && !state.finished);
}

function finishIfNeeded(previousFailure) {
  const state = simulation.snapshot();
  if (state.failureReason && state.failureReason !== previousFailure) {
    running = false;
    addLog(state.failureReason);
  }
  if (state.elapsed >= DURATION_SECONDS && running) {
    running = false;
    addLog(state.passed
      ? `模拟通过，全程最低储水 ${state.minStorage.toFixed(0)} L，达到 ${state.passStorage} L 要求`
      : `模拟未通过，全程最低储水 ${state.minStorage.toFixed(0)} L，低于 ${state.passStorage} L`);
  }
}

function animate(now) {
  const delta = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (running) {
    accumulator += delta * simulation.speed;
    while (accumulator >= 1 && running) {
      const previousFailure = simulation.failureReason;
      simulation.step(1);
      accumulator -= 1;
      finishIfNeeded(previousFailure);
      if (simulation.failureReason) break;
    }
  }
  render();
  requestAnimationFrame(animate);
}

for (const [name, input] of Object.entries(controls)) {
  input.addEventListener('input', () => {
    const value = input.type === 'checkbox' ? input.checked : Number(input.value);
    simulation.setControl(name, value);
    syncControls();
  });
}

$('startButton').addEventListener('click', () => {
  if (simulation.finished || running) return;
  running = true;
  lastFrame = performance.now();
  addLog('模拟开始，高压泵运行');
});

$('backwashButton').addEventListener('click', () => {
  const alreadyDue = simulation.autoBackwash &&
    simulation.elapsed - simulation.lastBackwashStart >= simulation.backwashCycle;
  if (alreadyDue || simulation.backwash) return;
  simulation.requestBackwash();
  addLog('手动反洗请求已排队');
});

$('turbidityEventButton').addEventListener('click', () => {
  simulation.scheduleTurbidityEvent(45, 50);
  addLog('高浊度来水进入取水口');
});

$('restartButton').addEventListener('click', () => {
  running = false;
  accumulator = 0;
  lastBackwashId = null;
  simulation.reset();
  $('logList').innerHTML = '';
  syncControls();
  addLog('系统已重置');
});

$('soundToggle').addEventListener('click', async () => {
  if (!soundOn) {
    await audio.enable();
    soundOn = true;
    $('soundToggle').textContent = '关闭泵音';
    addLog('泵音已开启，音调随泵压变化');
  } else {
    audio.disable();
    soundOn = false;
    $('soundToggle').textContent = '启动泵音';
  }
});

syncControls();
addLog('系统待命：建议低旁路、中压并保持周期反洗');
requestAnimationFrame(animate);
