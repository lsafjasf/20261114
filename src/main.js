import { CONFIG as C, KEYS } from './config.js';
import { makeWorld, stepWorld } from './physics.js';
import { createPilot, pilotInput } from './autopilot.js';
import { TensionAudio } from './audio.js';
import { render, makeParticles } from './renderer.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

const state = {
  world: makeWorld(),
  particles: makeParticles(),
  pilot: createPilot(),
  autopilot: false,
  started: false,
  running: true,
  keys: new Set(),
  ui: { thrust: 0, rearLateral: 0 }
};
const audio = new TensionAudio();

function readHumanInput() {
  const k = state.keys;
  let thrust = 0;
  if (KEYS.thrustForward.some((c) => k.has(c))) thrust += 1;
  if (KEYS.thrustReverse.some((c) => k.has(c))) thrust -= 1;
  let rearLateral = 0;
  if (KEYS.rearUp.some((c) => k.has(c))) rearLateral -= 1;
  if (KEYS.rearDown.some((c) => k.has(c))) rearLateral += 1;
  let anchor = null;
  if (k.has('ShiftLeft')) anchor = 'front';
  else if (k.has('ShiftRight')) anchor = 'rear';
  return { thrust, rearLateral, anchor };
}

function currentInput() {
  if (state.autopilot) {
    const inp = pilotInput(state.pilot, state.world);
    state.ui.thrust = inp.thrust;
    state.ui.rearLateral = inp.rearLateral;
    return inp;
  }
  const inp = readHumanInput();
  state.ui.thrust = inp.thrust;
  state.ui.rearLateral = inp.rearLateral;
  return inp;
}

function reset() {
  state.world = makeWorld();
  state.pilot = createPilot();
  state.running = true;
  hideOverlay();
}

function togglePilot() {
  state.autopilot = !state.autopilot;
  state.pilot = createPilot();
  $('pilotLine').textContent = '自动驾驶：' + (state.autopilot ? state.pilot.label : '关');
}

function showOverlay(title, body, buttonText) {
  $('overlayTitle').textContent = title;
  $('overlayBody').innerHTML = body;
  $('startBtn').textContent = buttonText;
  $('overlay').classList.remove('hidden');
}

function hideOverlay() {
  $('overlay').classList.add('hidden');
}

function updateHud() {
  const w = state.world;
  const t = Math.round(w.rope.tension);
  $('tensionText').textContent = `缆绳张力 ${t} / 安全 ${C.rope.safeTension}`;
  const pct = Math.min(100, (w.rope.tension / (C.rope.safeTension * 1.25)) * 100);
  $('tensionBar').style.width = pct + '%';
  $('tensionBar').style.background =
    w.rope.tension > C.rope.safeTension ? '#ff5a52' : '';
  let ropeLabel = '缆绳松弛（无法施力）';
  if (w.rope.tension > C.rope.safeTension) ropeLabel = '过紧！船体正在受损';
  else if (w.rope.tension > 4) ropeLabel = '牵引中';
  $('ropeState').textContent = ropeLabel;
  $('hpText').textContent =
    `前船 HP ${Math.ceil(w.front.hp)}　后船 HP ${Math.ceil(w.rear.hp)}　用时 ${w.time.toFixed(1)}s`;
  if (state.autopilot) {
    $('pilotLine').textContent = '自动驾驶：' + state.pilot.label;
  }
}

function finishOverlay() {
  const w = state.world;
  if (w.status === 'won') {
    showOverlay('救援成功',
      `两船均已进入安全区，用时 ${w.time.toFixed(1)} 秒，前船 HP ${Math.ceil(w.front.hp)}，后船 HP ${Math.ceil(w.rear.hp)}。`,
      '再来一次 (R)');
  } else if (w.status === 'lost') {
    showOverlay('救援失败',
      '船体损伤过重，救援船失去动力。注意张力音高，缆绳过紧前及时反推卸力。',
      '重新开始 (R)');
  }
}

let acc = 0;
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const delta = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (state.started && state.running) {
    acc += delta;
    while (acc >= C.dt) {
      const input = currentInput();
      const before = state.world.event;
      stepWorld(state.world, input, C.dt);
      if (state.world.event === 'damage' && before !== 'damage') {
        audio.blip(180, 0.18, 'sawtooth', 0.09);
      }
      if (state.world.event === 'rock') audio.blip(140, 0.15, 'square', 0.1);
      if (state.world.event === 'win') audio.blip(880, 0.35, 'triangle', 0.14);
      if (state.world.event === 'lose') audio.blip(90, 0.6, 'sawtooth', 0.14);
      acc -= C.dt;
    }
    audio.update(state.world.rope.tension);
    if (state.world.status !== 'running') {
      state.running = false;
      audio.update(0);
      finishOverlay();
    }
  }
  render(ctx, state.world, state.particles, state.ui);
  updateHud();
}
requestAnimationFrame(frame);

function startGame() {
  if (!state.started) {
    state.started = true;
    audio.init();
    hideOverlay();
  }
}

window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ShiftLeft', 'ShiftRight', 'Space'].includes(e.code)) {
    e.preventDefault();
  }
  startGame();
  if (e.code === 'KeyR') reset();
  if (e.code === 'KeyP') togglePilot();
  if (e.code === 'KeyM') $('muteBtn').textContent = audio.toggleMute() ? '取消静音 (M)' : '静音 (M)';
  state.keys.add(e.code);
});

window.addEventListener('keyup', (e) => state.keys.delete(e.code));

$('startBtn').addEventListener('click', () => { startGame(); });
$('restartBtn').addEventListener('click', () => reset());
$('pilotBtn').addEventListener('click', () => { startGame(); togglePilot(); });
$('muteBtn').addEventListener('click', () => {
  audio.init();
  $('muteBtn').textContent = audio.toggleMute() ? '取消静音 (M)' : '静音 (M)';
});
