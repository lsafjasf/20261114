// 页面主逻辑：状态管理、交互、播放动画与音效联动。
import {
  CONFIG,
  STARS,
  simulate,
  goodSchedule,
  badSchedule,
  cloneActions,
  starById,
} from './engine.js';
import { renderSky } from './render-sky.js';
import { renderTimeline, hitTest } from './render-timeline.js';
import { SoundBoard } from './audio.js';

const sky = document.getElementById('sky');
const timeline = document.getElementById('timeline');
const sound = new SoundBoard();

const state = {
  actions: goodSchedule(),
  selected: -1,
  t: 0,
  playing: false,
  rafId: null,
  lastTs: null,
  firedKeys: new Set(),
  result: null,
};

const $ = (id) => document.getElementById(id);

// ---- 目标下拉 ----
function initStarSelect() {
  const select = $('starSelect');
  for (const star of STARS) {
    const option = document.createElement('option');
    option.value = star.id;
    option.textContent = `${star.name}（${star.filter}片/${star.required}分）`;
    select.appendChild(option);
  }
}

function initLegend() {
  const legend = $('skyLegend');
  const items = [
    ['#7bed9f', '可观测窗口'],
    ['#ffd166', '月光屏蔽 / 过强'],
    ['#3a4f96', '转台动作'],
    ['#7a5ea8', '换色片动作'],
    ['#2f7d5f', '曝光动作'],
    ['#ff8fa3', '当前播放指针'],
  ];
  legend.innerHTML = items
    .map(([color, text]) => `<span style="--c:${color}">${text}</span>`)
    .join('');
}

// ---- 动作编辑 ----
function readForm() {
  return {
    starId: Number($('starSelect').value),
    start: Number($('startInput').value),
    duration: Number($('durationInput').value),
  };
}

function addAction(kind) {
  const form = readForm();
  if (Number.isNaN(form.start) || form.start < 0 || form.start >= CONFIG.sessionEnd) {
    alert('开始时间需在 0-60 分钟之间');
    return;
  }
  const action = { kind, start: form.start, end: form.start + form.duration };
  if (kind === 'filter') {
    const star = starById(form.starId);
    action.filter = star.filter;
    action.end = action.start + CONFIG.filterTime;
  } else {
    action.starId = form.starId;
    if (kind === 'slew') action.end = action.start + CONFIG.slewTime;
  }
  state.actions.push(action);
  state.actions.sort((a, b) => a.start - b.start);
  state.selected = state.actions.indexOf(action);
  renderAll();
}

function deleteSelected() {
  if (state.selected < 0) return;
  state.actions.splice(state.selected, 1);
  state.selected = -1;
  renderAll();
}

function loadSchedule(factory) {
  stopPlayback();
  state.actions = factory();
  state.selected = -1;
  state.t = 0;
  state.result = null;
  renderAll();
}

// ---- 验证与结果展示 ----
function runValidation() {
  const result = simulate(state.actions);
  state.result = result;
  const verdict = $('verdict');
  if (result.passed) {
    verdict.className = 'verdict pass';
    verdict.textContent = '✅ 排程通过：三颗目标星均在窗口关闭前完成足额有效曝光，且未超出总时长。';
  } else {
    verdict.className = 'verdict fail';
    const names = result.missed.map((m) => m.name).join('、') || '无';
    verdict.textContent = `❌ 排程未通过。错过窗口：${names}；共 ${result.issues.length} 条违规记录，详见日志。`;
  }

  const stats = $('stats');
  stats.innerHTML = STARS.map((star) => {
    const got = result.validExposure[star.id] || 0;
    const ok = got >= star.required;
    return `<span class="chip ${ok ? 'ok' : 'no'}">${star.name}：有效曝光 ${got}/${star.required} 分${ok ? ' ✓' : ''}</span>`;
  }).join('');

  const log = $('log');
  const issueSet = new Set(result.issues);
  const rows = result.events
    .slice()
    .sort((a, b) => a.time - b.time || a.message.localeCompare(b.message));
  log.innerHTML = rows
    .map((event) => {
      const bad =
        event.type === 'missed' ||
        event.type === 'expose-blocked' ||
        event.type === 'expose-invalid';
      const good = event.type === 'expose';
      return `<li class="${bad ? 'bad' : good ? 'good' : ''}">t=${event.time} 分｜${event.message}</li>`;
    })
    .join('');
  if (result.issues.some((i) => !rows.some((r) => r.message === i))) {
    for (const issue of result.issues) {
      if (!rows.some((r) => r.message === issue)) {
        log.insertAdjacentHTML('beforeend', `<li class="bad">${issue}</li>`);
      }
    }
  }
}

// ---- 渲染 ----
function currentTargetAt(t) {
  let target = CONFIG.initialTarget;
  for (const action of state.actions) {
    if (action.kind === 'slew' && action.end <= t) target = action.starId;
  }
  return target;
}

function currentValidMap() {
  const map = new Map();
  if (!state.result) return map;
  for (const [id, mins] of Object.entries(state.result.validExposure)) {
    map.set(Number(id), mins);
  }
  return map;
}

function renderAll() {
  renderSky(sky, state.t, currentTargetAt(state.t), currentValidMap());
  renderTimeline(timeline, state.actions, state.t, state.selected);
}

// ---- 播放：1 现实秒 ≈ 4 模拟分钟 ----
const PLAY_RATE = 4;

function stopPlayback() {
  state.playing = false;
  if (state.rafId !== null) window.cancelAnimationFrame(state.rafId);
  state.rafId = null;
  state.lastTs = null;
}

function fireSounds(t) {
  for (const action of state.actions) {
    const key = `${action.kind}-${action.starId || action.filter}-${action.start}`;
    if (state.firedKeys.has(key)) continue;
    if (action.start > t + 0.01) continue;
    state.firedKeys.add(key);
    if (action.kind === 'slew') sound.slew();
    else if (action.kind === 'filter') sound.click();
    else if (action.kind === 'expose') sound.shutter();
  }
  if (state.result) {
    for (const missed of state.result.missed) {
      const key = `missed-${missed.starId}`;
      if (!state.firedKeys.has(key) && missed.windowEnd <= t + 0.01) {
        state.firedKeys.add(key);
        sound.warn();
      }
    }
  }
}

function tick(ts) {
  if (!state.playing) return;
  if (state.lastTs === null) state.lastTs = ts;
  const dtSec = (ts - state.lastTs) / 1000;
  state.lastTs = ts;
  state.t = Math.min(CONFIG.sessionEnd, state.t + dtSec * PLAY_RATE);
  fireSounds(state.t);
  renderAll();
  if (state.t >= CONFIG.sessionEnd) {
    stopPlayback();
    return;
  }
  state.rafId = window.requestAnimationFrame(tick);
}

function startPlayback() {
  sound.ensure();
  if (state.playing) return;
  if (state.t >= CONFIG.sessionEnd) {
    state.t = 0;
    state.firedKeys.clear();
  }
  if (!state.result) runValidation();
  state.playing = true;
  state.rafId = window.requestAnimationFrame(tick);
}

function resetPlayback() {
  stopPlayback();
  state.t = 0;
  state.firedKeys.clear();
  renderAll();
}

// ---- 时间轴点击选择 ----
timeline.addEventListener('click', (event) => {
  const rect = timeline.getBoundingClientRect();
  const scaleX = timeline.width / rect.width;
  const scaleY = timeline.height / rect.height;
  const px = (event.clientX - rect.left) * scaleX;
  const py = (event.clientY - rect.top) * scaleY;
  state.selected = hitTest(timeline, state.actions, px, py);
  if (state.selected >= 0) {
    const action = state.actions[state.selected];
    $('startInput').value = action.start;
    $('durationInput').value = action.end - action.start;
    if (action.starId) $('starSelect').value = action.starId;
  }
  renderAll();
});

// ---- 按钮绑定 ----
$('addSlew').addEventListener('click', () => addAction('slew'));
$('addFilter').addEventListener('click', () => addAction('filter'));
$('addExpose').addEventListener('click', () => addAction('expose'));
$('deleteAction').addEventListener('click', deleteSelected);
$('loadGood').addEventListener('click', () => loadSchedule(goodSchedule));
$('loadBad').addEventListener('click', () => loadSchedule(badSchedule));
$('clearAll').addEventListener('click', () =>
  loadSchedule(() => [])
);
$('validate').addEventListener('click', runValidation);
$('play').addEventListener('click', startPlayback);
$('reset').addEventListener('click', resetPlayback);
$('muteToggle').addEventListener('change', (event) => {
  sound.setMuted(event.target.checked);
});

initStarSelect();
initLegend();
renderAll();

export {
  state,
  addAction,
  deleteSelected,
  loadSchedule,
  runValidation,
  renderAll,
  startPlayback,
  resetPlayback,
  stopPlayback,
};
