import { createSim, step, nudgeValve, fastClose, setPump, LIMITS } from './sim.js';
import { createDirector, directorTick } from './director.js';
import { drawScene } from './render.js';
import { PumpAudio } from './audio.js';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

let sim = createSim();
let dir = createDirector(sim);
let running = false;
let autoMode = false;
let lastFrame = performance.now();
let acc = 0;
let renderTime = 0;
let loggedEvents = 0;
const DT = 0.05;
const audio = new PumpAudio();

const PHASE_TEXT = {
  steady: '科目一 · 稳态调节',
  preinject: '隔离前减载',
  inject: '注入快关尖峰',
  mitigate: '科目二 · 尖峰处置',
  done: '科目完成',
};

// 构建三个阀门的手动控制块
const valveWrap = $('valveControls');
for (let i = 0; i < 3; i++) {
  const div = document.createElement('div');
  div.className = 'valve';
  div.innerHTML = `
    <div class="valve-head"><span>阀门 V${i + 1}</span><b id="vOpen${i}">--</b></div>
    <div class="valve-btns">
      <button data-i="${i}" data-d="-0.15">慢关</button>
      <button data-i="${i}" data-d="0.15">慢开</button>
      <button data-i="${i}" class="danger" data-fast="1">快关</button>
    </div>`;
  valveWrap.appendChild(div);
}

valveWrap.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || sim.failed) return;
  const i = Number(btn.dataset.i);
  if (btn.dataset.fast) {
    fastClose(sim, i);
  } else {
    nudgeValve(sim, i, Number(btn.dataset.d));
  }
});

$('pumpSlider').addEventListener('input', (e) => {
  setPump(sim, Number(e.target.value));
});

$('btnSpike').addEventListener('click', () => {
  if (!sim.failed) fastClose(sim, 0);
});

$('btnStart').addEventListener('click', () => {
  if (sim.failed) reset();
  running = true;
});
$('btnPause').addEventListener('click', () => { running = false; });
$('btnReset').addEventListener('click', reset);
$('overlayReset').addEventListener('click', () => { reset(); $('overlay').classList.add('hidden'); });

$('btnSound').addEventListener('click', async (e) => {
  if (audio.enabled) {
    audio.disable();
    e.target.classList.remove('on');
    e.target.textContent = '声音 关';
  } else {
    await audio.enable();
    e.target.classList.add('on');
    e.target.textContent = '声音 开';
  }
});

$('btnAuto').addEventListener('click', () => {
  reset();
  autoMode = true;
  running = true;
});

function reset() {
  sim = createSim();
  dir = createDirector(sim);
  running = false;
  autoMode = false;
  acc = 0;
  loggedEvents = 0;
  $('log').innerHTML = '';
  $('pumpSlider').value = sim.pumpTarget;
  $('overlay').classList.add('hidden');
  syncLogs();
}

function loop(now) {
  const frameDt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  renderTime += frameDt;
  if (running && !sim.failed) {
    acc += frameDt;
    while (acc >= DT) {
      step(sim, DT);
      if (autoMode) directorTick(sim, dir, DT);
      acc -= DT;
    }
  }
  drawScene(ctx, sim, renderTime);
  updateGauges();
  syncLogs();
  audio.update(sim.pump, sim.spike);
  if (sim.failed || (autoMode && !sim.running)) finishCheck();
  requestAnimationFrame(loop);
}

function finishCheck() {
  if (!running) return;
  running = false;
  const overlay = $('overlay');
  const card = overlay.querySelector('.overlay-card');
  if (sim.failed) {
    card.className = 'overlay-card fail';
    $('overlayTitle').textContent = '任务失败';
    $('overlayText').textContent = `${sim.failReason}。回顾日志，注意温度/压力/流量的持续越限计时。`;
  } else if (dir.spikeHandled) {
    card.className = 'overlay-card ok';
    $('overlayTitle').textContent = '两个科目均已完成';
    const p1 = dir.phase1Stats;
    $('overlayText').innerHTML =
      `稳态调节：t=${p1.t.toFixed(1)}s，温度压到 ${p1.temp.toFixed(1)}℃，耗电 ${(100 - p1.battery).toFixed(1)}%。<br>` +
      `尖峰处理：峰值压力 ${sim.metrics.maxPressure.toFixed(2)}bar（未击穿硬限 ${LIMITS.pressure.high}bar），处置后回落 ${sim.pressure.toFixed(2)}bar。`;
  } else {
    return;
  }
  overlay.classList.remove('hidden');
}

requestAnimationFrame(loop);

function bandClass(value, lim) {
  if (value > lim.high || value < lim.low) return 'alarm';
  if (value > (lim.warnHigh ?? lim.high) || (lim.warnLow !== undefined && value < lim.warnLow)) return 'warn';
  return '';
}

function updateGauges() {
  $('vTemp').textContent = sim.temp.toFixed(1);
  $('vPress').textContent = sim.pressure.toFixed(2);
  $('vFlow').textContent = sim.flow.toFixed(2);
  $('vBatt').textContent = sim.battery.toFixed(0);
  $('battFill').style.width = `${sim.battery}%`;
  $('battFill').style.background =
    sim.battery < 25 ? 'linear-gradient(90deg,#ff5d6c,#ffc24b)' : 'linear-gradient(90deg,#46d39a,#4cc2ff)';

  setGauge('gTemp', bandClass(sim.temp, LIMITS.temp));
  setGauge('gPress', bandClass(sim.pressure, LIMITS.pressure));
  setGauge('gFlow', bandClass(sim.flow, LIMITS.flow));

  for (let i = 0; i < 3; i++) {
    $('vOpen' + i).textContent = `${(sim.valves[i] * 100) | 0}%`;
  }
  $('pumpVal').textContent = `${(sim.pump * 100) | 0}%`;
  if (document.activeElement !== $('pumpSlider')) $('pumpSlider').value = sim.pumpTarget;

  $('phaseBadge').textContent = autoMode
    ? (PHASE_TEXT[dir.phase] || '运行中')
    : sim.failed ? '任务失败' : running ? '手动运行中' : '待启动 / 暂停';
}

function setGauge(id, cls) {
  const el = $(id);
  el.classList.toggle('warn', cls === 'warn');
  el.classList.toggle('alarm', cls === 'alarm');
}

function syncLogs() {
  if (sim.events.length === loggedEvents) return;
  const ul = $('log');
  for (let i = loggedEvents; i < sim.events.length; i++) {
    const ev = sim.events[i];
    const li = document.createElement('li');
    li.className = ev.type === 'warn' ? 'warn' : ev.type === 'fail' ? 'fail' : ev.type === 'fast-close' ? 'fast-close' : '';
    li.innerHTML = `<span class="time">${ev.t.toFixed(1)}s</span>${ev.text}`;
    ul.appendChild(li);
  }
  loggedEvents = sim.events.length;
  ul.scrollTop = ul.scrollHeight;
}

updateGauges();
