import { createSimulation, step, FIXED_DT } from './sim.js';
import { createRenderer } from './render.js';
import { createAudioEngine } from './audio.js';
import { autopilotInput } from './autopilot.js';
import { DEFAULT_SEED } from './map.js';

const canvas = document.getElementById('game');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlayTitle');
const overlayText = document.getElementById('overlayText');
const startBtn = document.getElementById('startBtn');
const hud = {
  durBar: document.getElementById('durBar'),
  durText: document.getElementById('durText'),
  speed: document.getElementById('speedText'),
  load: document.getElementById('loadText'),
  rescue: document.getElementById('rescueText'),
  wind: document.getElementById('windText'),
  closure: document.getElementById('closureText'),
  time: document.getElementById('timeText'),
};

const audio = createAudioEngine();
let state = createSimulation({ seed: DEFAULT_SEED });
const renderer = createRenderer(canvas, state.map);
const keys = new Set();
let running = false;
let paused = false;
let autoMode = false;
let accumulator = 0;
let lastTs = 0;
let lastEventCount = 0;

window.addEventListener('keydown', (e) => {
  keys.add(e.key.toLowerCase());
  if (e.key.toLowerCase() === 'p' && running) paused = !paused;
  if (e.key.toLowerCase() === 'r') resetGame();
  if (e.key === '1') {
    autoMode = false;
    resetGame();
  }
  if (e.key === '2') {
    autoMode = true;
    resetGame();
  }
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(e.key.toLowerCase())) {
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

startBtn.addEventListener('click', async () => {
  await audio.start();
  resetGame();
  running = true;
  overlay.classList.add('hidden');
});

function resetGame() {
  state = createSimulation({ seed: DEFAULT_SEED });
  accumulator = 0;
  lastEventCount = 0;
  paused = false;
  running = true;
  overlay.classList.add('hidden');
}

function manualInput() {
  const left = keys.has('a') || keys.has('arrowleft');
  const right = keys.has('d') || keys.has('arrowright');
  return {
    throttle: keys.has('w') || keys.has('arrowup'),
    brake: keys.has('s') || keys.has('arrowdown'),
    steer: (right ? 1 : 0) - (left ? 1 : 0),
  };
}

function frame(ts) {
  requestAnimationFrame(frame);
  if (!lastTs) lastTs = ts;
  const frameDt = Math.min(0.1, (ts - lastTs) / 1000);
  lastTs = ts;

  if (running && !paused) {
    accumulator += frameDt;
    let guard = 0;
    while (accumulator >= FIXED_DT && guard < 8 && state.status === 'running') {
      const input = autoMode ? autopilotInput(state) : manualInput();
      step(state, input);
      accumulator -= FIXED_DT;
      guard += 1;
    }
    handleNewEvents();
    audio.update(state);
    if (state.status !== 'running') showEndScreen();
  }
  renderer.draw(state, manualInput());
  updateHud();
}

function handleNewEvents() {
  const events = state.events;
  for (let i = lastEventCount; i < events.length; i++) {
    const e = events[i];
    if (e.type === 'wall' || e.type === 'rockHit' || e.type === 'ram') audio.crash();
    if (e.type === 'rescue') audio.rescue();
  }
  lastEventCount = events.length;
}

const FAIL_TEXT = {
  skid: '侧滑失控！车辆被侧坡推出路面，救援失败。',
  durability: '耐久度耗尽！清雪车在冰墙与落石撞击中瘫痪。',
  blizzard: '暴风雪封闭了道路，受困车辆没能及时撤出。',
};

function showEndScreen() {
  running = false;
  overlay.classList.remove('hidden');
  if (state.status === 'won') {
    overlayTitle.textContent = '救援成功';
    overlayText.textContent =
      `用时 ${state.time.toFixed(1)} 秒，三辆受困车全部救出，剩余耐久 ${state.plow.durability}，` +
      `共发生 ${state.collisions} 次碰撞。按 R 或点击按钮再来一次。`;
  } else {
    overlayTitle.textContent = '救援失败';
    overlayText.textContent =
      (FAIL_TEXT[state.failReason] || '任务失败。') +
      `（坚持 ${state.time.toFixed(1)} 秒，已救 ${state.rescued}/3）按 R 重试。`;
  }
  startBtn.textContent = '重新开始';
}

function updateHud() {
  const p = state.plow;
  hud.durBar.style.width = `${p.durability}%`;
  hud.durText.textContent = Math.round(p.durability);
  hud.speed.textContent = Math.round(Math.hypot(p.vx, p.vy));
  hud.load.textContent = p.load;
  hud.rescue.textContent = state.rescued;
  hud.wind.textContent = state.wind.toFixed(1);
  if (state.time < state.closureDelay) {
    hud.closure.textContent = `${(state.closureDelay - state.time).toFixed(1)}s 后推进`;
  } else {
    const gap = p.y - state.closureY;
    hud.closure.textContent = `前沿差 ${Math.max(0, gap).toFixed(0)}px`;
  }
  hud.time.textContent = state.time.toFixed(1);
}

requestAnimationFrame(frame);
