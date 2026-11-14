import { TRAINS, JUNCTIONS, STATIONS, SIM } from './config.js';
import { RailSim } from './sim.js';
import { Renderer } from './renderer.js';
import { AudioEngine } from './audio.js';

const sim = new RailSim();
const renderer = new Renderer(document.getElementById('scene'));
const audio = new AudioEngine();

const els = {
  startOverlay: document.getElementById('startOverlay'),
  pauseOverlay: document.getElementById('pauseOverlay'),
  resultOverlay: document.getElementById('resultOverlay'),
  resultCard: document.getElementById('resultCard'),
  resultTitle: document.getElementById('resultTitle'),
  resultMessage: document.getElementById('resultMessage'),
  resultStats: document.getElementById('resultStats'),
  startBtn: document.getElementById('startBtn'),
  pauseBtn: document.getElementById('pauseBtn'),
  pauseText: document.getElementById('pauseText'),
  resumeBtn: document.getElementById('resumeBtn'),
  resetBtn: document.getElementById('resetBtn'),
  soundBtn: document.getElementById('soundBtn'),
  soundText: document.getElementById('soundText'),
  againBtn: document.getElementById('againBtn'),
  trainCards: document.getElementById('trainCards'),
  switchBoard: document.getElementById('switchBoard'),
  clock: document.getElementById('clock'),
  stopTotal: document.getElementById('stopTotal'),
  stopCount: document.getElementById('stopCount'),
  wearValue: document.getElementById('wearValue'),
  wearBar: document.getElementById('wearBar'),
  log: document.getElementById('log'),
  toast: document.getElementById('toast')
};

let manual = false;
let started = false;
let resultShown = false;
let lastFrame = performance.now();
let lastUi = 0;
let lastLogEvent = 0;
let lastHandledEvent = 0;
let toastTimer = null;
let switchEls = new Map();

const STATE_LABEL = {
  running: '运行中',
  braking: '制动中',
  held: '保护停车',
  dwell: '停靠中',
  waiting: '待发',
  done: '已完成'
};

function formatClock(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function stateLabel(state) {
  return state === 'cross' ? '越线' : '直行';
}

function trainStatusText(train) {
  if (train.derailed) return '脱轨';
  return STATE_LABEL[train.status] || train.status;
}

function showToast(message, tone = 'warn') {
  els.toast.textContent = message;
  els.toast.style.borderColor = tone === 'good' ? 'rgba(138, 199, 154, 0.5)' : 'rgba(224, 90, 69, 0.45)';
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
}

function buildSwitchBoard() {
  els.switchBoard.innerHTML = JUNCTIONS.map((junction, index) => `
    <button class="switch-card" type="button" data-switch="${junction.id}" aria-label="扳动 ${junction.label}">
      <span class="switch-top">
        <span class="switch-key">${index + 1}</span>
        <span class="switch-id">${junction.id} 岔</span>
        <span class="switch-lock">锁闭</span>
      </span>
      <span class="switch-graphic">
        <span class="main-rail"></span>
        <span class="branch-rail"></span>
        <span class="blade"></span>
        <span class="lamp"></span>
      </span>
      <span class="switch-bottom">
        <span class="switch-state">直行</span>
        <span class="switch-demand"></span>
      </span>
    </button>
  `).join('');
  switchEls = new Map(JUNCTIONS.map((junction) => [junction.id, els.switchBoard.querySelector(`[data-switch="${junction.id}"]`)]));
}

function refreshUi(state = sim.getState()) {
  renderTrainCards(state);
  updateSwitchBoard(state);
  updateStatus(state);
  updateLog(state);
}

function toggleSwitch(id) {
  if (!sim.started || sim.result) return;
  const result = sim.toggleSwitch(id);
  if (result.ok) {
    const state = sim.getState();
    const item = state.switches.find((entry) => entry.id === id);
    showToast(`${id} 道岔已扳向${stateLabel(item.state)}`, 'good');
  } else if (result.reason === 'occupied') {
    showToast(`${id} 岔区被占用，联锁拒绝扳动`);
  } else if (result.reason === 'finished') {
    showToast('本局已结束，请重新开始');
  }
  refreshUi();
}

function startGame() {
  if (started && !sim.result) return;
  if (sim.result) resetGame();
  audio.init();
  sim.start();
  started = true;
  els.startOverlay.classList.add('hidden');
  els.resultOverlay.classList.add('hidden');
  els.pauseOverlay.classList.add('hidden');
  els.toast.classList.remove('show');
  clearTimeout(toastTimer);
  resultShown = false;
  lastLogEvent = 0;
  lastHandledEvent = 0;
  refreshUi();
}

function resetGame() {
  sim.reset();
  started = false;
  resultShown = false;
  lastLogEvent = 0;
  lastHandledEvent = 0;
  renderer.trails = { blue: [], amber: [] };
  renderer.lastPoses = { blue: null, amber: null };
  renderer.lastElapsed = 0;
  els.startOverlay.classList.remove('hidden');
  els.resultOverlay.classList.add('hidden');
  els.pauseOverlay.classList.add('hidden');
  els.toast.classList.remove('show');
  clearTimeout(toastTimer);
  els.pauseText.textContent = '暂停';
  els.pauseBtn.classList.remove('on');
  refreshUi();
}

function togglePause() {
  if (!sim.started || sim.result) return;
  if (sim.paused) {
    sim.resume();
    els.pauseOverlay.classList.add('hidden');
    els.pauseText.textContent = '暂停';
    els.pauseBtn.classList.remove('on');
  } else {
    sim.pause();
    els.pauseOverlay.classList.remove('hidden');
    els.pauseText.textContent = '继续';
    els.pauseBtn.classList.add('on');
  }
}

function toggleSound() {
  const enabled = !audio.enabled;
  audio.setEnabled(enabled);
  els.soundText.textContent = enabled ? '声音开' : '声音关';
  els.soundBtn.classList.toggle('on', enabled);
}

function renderTrainCards(state) {
  const specs = new Map(TRAINS.map((spec) => [spec.id, spec]));
  const switchMap = new Map(state.switches.map((item) => [item.id, item]));
  els.trainCards.innerHTML = state.trains.map((train) => {
    const spec = specs.get(train.id);
    const held = train.status === 'held' || train.status === 'braking';
    let nextHtml = '';
    if (train.done) {
      nextHtml = `三站完成 · ${train.finishedAt ? train.finishedAt.toFixed(1) : '--'} 秒`;
    } else if (train.status === 'waiting') {
      const left = Math.max(0, train.departAt - state.elapsed);
      nextHtml = `等待发车 · <b>${left.toFixed(1)}s</b> <span class="next-flag">固定间隔</span>`;
    } else if (train.hold && train.hold.type === 'signal') {
      nextHtml = `在 <b>${train.hold.junction}</b> 信号前停车 <span class="next-flag warn">等待纠正</span>`;
    } else if (train.hold && train.hold.type === 'block') {
      nextHtml = `前方区间占用 <span class="next-flag warn">防护停车</span>`;
    } else if (train.nextEvent && train.nextEvent.kind === 'switch') {
      const item = switchMap.get(train.nextEvent.junction);
      const mismatch = item && item.state !== train.nextEvent.state;
      nextHtml = `下一道岔 <b>${train.nextEvent.junction}</b> <span class="next-flag ${mismatch ? 'warn' : ''}">需${stateLabel(train.nextEvent.state)}</span>`;
    } else if (train.nextEvent && train.nextEvent.kind === 'station') {
      const station = STATIONS.find((entry) => entry.id === train.nextEvent.station);
      nextHtml = `下一站 <b>${station ? station.name : train.nextEvent.station}</b> <span class="next-flag">${station ? station.code : ''}</span>`;
    } else if (train.nextEvent && train.nextEvent.kind === 'finish') {
      nextHtml = '三站完成，返回待避线';
    }
    const pips = spec.stations.map((station) => {
      const visited = train.visited.includes(station.id);
      const isNext = train.nextEvent && train.nextEvent.kind === 'station' && train.nextEvent.station === station.id;
      return `<span class="station-pip ${visited ? 'visited' : ''} ${isNext ? 'next' : ''}"><i class="pip-dot"></i><span>${station.label}</span></span>`;
    }).join('');
    const pct = Math.max(0, Math.min(100, (train.p / 1.001) * 100));
    const wearClass = train.wear > 0 ? 'hot' : '';
    return `
      <article class="train-card ${held ? 'held' : ''}" style="--train-color:${train.color}" data-train="${train.id}">
        <div class="train-head">
          <i class="train-swatch"></i>
          <span class="train-name">${train.name}</span>
          <span class="train-state ${train.status}">${trainStatusText(train)}</span>
        </div>
        <div class="train-next">${nextHtml}</div>
        <div class="station-pips">${pips}</div>
        <div class="train-foot">
          <span class="lap-track"><span style="width:${pct}%"></span></span>
          <span class="wear-mini ${wearClass}">${train.emergencyStops} 次保护 · ${train.wear}%</span>
        </div>
      </article>
    `;
  }).join('');
}

function updateSwitchBoard(state) {
  const byId = new Map(state.switches.map((item) => [item.id, item]));
  for (const junction of JUNCTIONS) {
    const item = byId.get(junction.id);
    const el = switchEls.get(junction.id);
    if (!item || !el) continue;
    el.classList.toggle('cross', item.state === 'cross');
    el.classList.toggle('occupied', item.occupied);
    el.setAttribute('aria-label', `${junction.label}，当前${stateLabel(item.state)}${item.occupied ? '，区间占用锁闭' : ''}`);
    const stateEl = el.querySelector('.switch-state');
    stateEl.innerHTML = item.occupied ? '<em>锁闭</em>' : `<em>${stateLabel(item.state)}</em>`;
    const demands = state.trains
      .filter((train) => !train.done && train.nextEvent && train.nextEvent.kind === 'switch' && train.nextEvent.junction === junction.id)
      .map((train) => `<span class="demand-chip" style="--train-color:${train.color}" title="${train.name} 需要${stateLabel(train.nextEvent.state)}">${train.name.slice(0, 1)} ${stateLabel(train.nextEvent.state)}</span>`)
      .join('');
    el.querySelector('.switch-demand').innerHTML = demands || '<span class="empty">—</span>';
  }
}

function updateStatus(state) {
  els.clock.textContent = formatClock(state.elapsed);
  const stops = state.trains.reduce((sum, train) => sum + train.stationCount, 0);
  const emergencies = state.trains.reduce((sum, train) => sum + train.emergencyStops, 0);
  const wear = Math.max(0, ...state.trains.map((train) => train.wear));
  els.stopTotal.textContent = `${stops}/6`;
  els.stopCount.textContent = String(emergencies);
  els.wearValue.textContent = `${wear}%`;
  els.stopCount.classList.toggle('hot', emergencies > 0);
  els.wearValue.classList.toggle('hot', wear > 0);
  els.wearBar.style.width = `${Math.min(100, wear)}%`;
  if (state.result) showResult(state);
}

function updateLog(state) {
  if (!state.events.length) {
    if (lastLogEvent !== -1) {
      els.log.innerHTML = '<div class="log-empty">等待发车指令…<br />事件记录将在这里滚动显示</div>';
      lastLogEvent = -1;
    }
    return;
  }
  const latest = state.events[state.events.length - 1].id;
  if (latest === lastLogEvent) return;
  const good = new Set(['station', 'done', 'win', 'signal-clear', 'block-clear']);
  const warn = new Set(['signal-stop', 'protect-brake', 'block-stop', 'lock', 'fail', 'missed']);
  const gold = new Set(['switch', 'switch-passed', 'depart', 'start', 'interval']);
  els.log.innerHTML = state.events.map((event) => {
    const tone = warn.has(event.type) ? 'warn' : good.has(event.type) ? 'good' : gold.has(event.type) ? 'gold' : '';
    return `<div class="log-row ${tone}"><span class="log-time">${formatClock(event.time)}</span><span><i class="tag"></i>${event.message}</span></div>`;
  }).join('');
  els.log.scrollTop = els.log.scrollHeight;
  lastLogEvent = latest;
}

function showResult(state) {
  if (resultShown) return;
  resultShown = true;
  els.pauseOverlay.classList.add('hidden');
  els.pauseText.textContent = '暂停';
  els.pauseBtn.classList.remove('on');
  const win = state.result === 'win';
  const totalStops = state.trains.reduce((sum, train) => sum + train.stationCount, 0);
  const emergencies = state.trains.reduce((sum, train) => sum + train.emergencyStops, 0);
  const wear = Math.max(0, ...state.trains.map((train) => train.wear));
  const finish = Math.max(0, ...state.trains.map((train) => train.finishedAt || 0));
  els.resultCard.classList.remove('win', 'fail');
  els.resultCard.classList.add(win ? 'win' : 'fail');
  els.resultTitle.textContent = win ? '任务通过' : '调度失败';
  if (win) {
    els.resultMessage.textContent = '两列微缩列车均完成三站停靠。轨道无碰撞、无脱轨，沙盘运行正常。';
  } else if (state.failure && state.failure.kind === 'collision') {
    els.resultMessage.textContent = '两列车进入同一轨道区间并发生碰撞，调度停止。事件已记录在案。';
  } else {
    els.resultMessage.textContent = '紧急制动累积的轮轨磨损达到上限，列车脱轨。沙盘运行终止。';
  }
  els.resultStats.innerHTML = `
    <div><span>${win ? '完成用时' : '运行时间'}</span><strong>${formatClock(win ? finish : state.elapsed)}</strong></div>
    <div><span>停靠合计</span><strong>${totalStops}/6</strong></div>
    <div><span>保护停车</span><strong>${emergencies}</strong></div>
    <div><span>最大磨损</span><strong>${wear}%</strong></div>
  `;
  els.resultOverlay.classList.remove('hidden');
}

function processEvents(state) {
  const events = state.events.filter((event) => event.id > lastHandledEvent);
  if (!events.length) return;
  for (const event of events) {
    if (event.type === 'switch') audio.switchClunk();
    else if (event.type === 'lock') audio.lockBuzz();
    else if (event.type === 'station') audio.chime();
    else if (event.type === 'signal-stop' || event.type === 'block-stop' || event.type === 'protect-brake') {
      audio.brake();
      showToast(event.message);
    } else if (event.type === 'brake') audio.brake();
    else if (event.type === 'win') {
      audio.fanfare();
      showResult(state);
    } else if (event.type === 'fail') {
      audio.failTone();
      showResult(state);
    }
    lastHandledEvent = Math.max(lastHandledEvent, event.id);
  }
}

function tick(seconds) {
  let remaining = Math.max(0, seconds);
  while (remaining > 0 && !sim.result) {
    const step = Math.min(0.25, remaining);
    sim.advance(step);
    remaining -= step;
  }
  const state = sim.getState();
  renderer.draw(state, performance.now());
  processEvents(state);
  refreshUi(state);
  lastUi = performance.now();
  return state;
}

function frame(now) {
  if (!lastFrame) lastFrame = now;
  const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  if (!manual && started && !sim.paused && !sim.result) sim.advance(dt);
  const state = sim.getState();
  renderer.draw(state, now);
  audio.update(state);
  processEvents(state);
  if (now - lastUi > 90) {
    refreshUi(state);
    lastUi = now;
  }
  requestAnimationFrame(frame);
}

els.startBtn.addEventListener('click', startGame);
els.pauseBtn.addEventListener('click', togglePause);
els.resumeBtn.addEventListener('click', togglePause);
els.resetBtn.addEventListener('click', resetGame);
els.againBtn.addEventListener('click', () => {
  resetGame();
  startGame();
});
els.soundBtn.addEventListener('click', toggleSound);
els.switchBoard.addEventListener('click', (event) => {
  const button = event.target.closest('[data-switch]');
  if (button) toggleSwitch(button.dataset.switch);
});

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.code === 'Space') {
    event.preventDefault();
    if (started && !sim.result) togglePause();
    return;
  }
  if (/^Digit[1-4]$/.test(event.code)) {
    event.preventDefault();
    const index = Number(event.code.slice(-1)) - 1;
    if (started && JUNCTIONS[index]) toggleSwitch(JUNCTIONS[index].id);
    return;
  }
  if (event.key.toLowerCase() === 'r') resetGame();
  if (event.key.toLowerCase() === 'm') toggleSound();
});

window.addEventListener('resize', () => renderer.resize());

window.__railGame = {
  sim,
  renderer,
  audio,
  start: startGame,
  reset: resetGame,
  pause: () => { if (started && !sim.result && !sim.paused) togglePause(); },
  resume: () => { if (started && sim.paused) togglePause(); },
  toggleSwitch,
  setSwitch: (id, state) => {
    const result = sim.setSwitch(id, state);
    refreshUi();
    return result;
  },
  tick,
  setManual: (value) => { manual = Boolean(value); },
  isManual: () => manual,
  state: () => sim.getState()
};

buildSwitchBoard();
refreshUi();
requestAnimationFrame(frame);
