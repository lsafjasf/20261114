"use strict";

/* ========== 常量与状态 ========== */
const TUBE_COUNT = 8;
const BARS = 16, BEATS_PER_BAR = 4, STEPS_PER_BEAT = 4;
const TOTAL_STEPS = BARS * BEATS_PER_BAR * STEPS_PER_BEAT; // 256 个十六分音符
const BASE_FREQS = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];
const HEAT_RATE = 14;    // 每秒升温（持续振动时）
const COOL_RATE = 5;     // 每秒降温
const DETUNE_CENTS_PER_DEG = 1.5; // 每度失谐的音分数
const UNLOCK_HYSTERESIS = 15;

const state = {
  audioReady: false,
  recording: false,
  playing: false,
  tempo: 100,
  tempLimit: 80,
  events: [],            // {step, tube, dur, freq}
  transportStep: 0,      // 当前音序位置（浮点步）
  transportRunning: false,
  recordNoteCount: 0,
};

const tubes = [];
for (let i = 0; i < TUBE_COUNT; i++) {
  tubes.push({
    index: i,
    baseFreq: BASE_FREQS[i],
    tuneCents: 0,
    temp: 20,
    locked: false,
    vibrating: false,
    amplitude: 0,
    voice: null,         // 当前发声节点组
    noteStartStep: 0,
    lastFreq: BASE_FREQS[i],
  });
}

function tubeFreq(t) {
  const detune = -(t.temp - 20) * DETUNE_CENTS_PER_DEG;
  return t.baseFreq * Math.pow(2, (t.tuneCents + detune) / 1200);
}

/* ========== Web Audio ========== */
let ctx, master, analyser, delayNode, delayFeedback, delayWet;

function initAudio() {
  if (state.audioReady) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.gain.value = 0.6;
  analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
  delayNode = ctx.createDelay(1.0); delayNode.delayTime.value = 0.27;
  delayFeedback = ctx.createGain(); delayFeedback.gain.value = 0.34;
  delayWet = ctx.createGain(); delayWet.gain.value = 0.28;
  delayNode.connect(delayFeedback); delayFeedback.connect(delayNode);
  delayNode.connect(delayWet); delayWet.connect(master);
  master.connect(analyser); analyser.connect(ctx.destination);
  state.audioReady = true;
}

function noteOn(ti) {
  const t = tubes[ti];
  if (!state.audioReady || t.locked || t.voice) return false;
  const freq = tubeFreq(t);
  t.lastFreq = freq;
  const now = ctx.currentTime;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(0.5, now + 0.02);
  const partials = [[1, 1.0], [2, 0.32], [3, 0.13], [4.2, 0.05]];
  const oscs = partials.map(([mult, amp]) => {
    const o = ctx.createOscillator();
    o.type = "sine"; o.frequency.value = freq * mult;
    const og = ctx.createGain(); og.gain.value = amp;
    o.connect(og); og.connect(g); o.start(now);
    return o;
  });
  g.connect(master); g.connect(delayNode);
  t.voice = { oscs, gain: g };
  t.vibrating = true;
  if (state.recording) t.noteStartStep = state.transportStep;
  return true;
}

function noteOff(ti) {
  const t = tubes[ti];
  if (!t.voice) return;
  const now = ctx.currentTime;
  const { oscs, gain } = t.voice;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  oscs.forEach(o => o.stop(now + 0.4));
  t.voice = null;
  t.vibrating = false;
  if (state.recording) {
    const dur = Math.max(0.25, state.transportStep - t.noteStartStep);
    state.events.push({
      step: +t.noteStartStep.toFixed(3),
      tube: ti,
      dur: +dur.toFixed(3),
      freq: +t.lastFreq.toFixed(2),
    });
    state.recordNoteCount++;
    updateStatus();
  }
}

/* ========== 温度模型 ========== */
function tickTemperature(dt) {
  for (const t of tubes) {
    if (t.vibrating) t.temp = Math.min(120, t.temp + HEAT_RATE * dt);
    else t.temp = Math.max(20, t.temp - COOL_RATE * dt);
    if (!t.locked && t.temp >= state.tempLimit) {
      t.locked = true;
      noteOff(t.index);
    } else if (t.locked && t.temp <= state.tempLimit - UNLOCK_HYSTERESIS) {
      t.locked = false;
    }
  }
}

/* ========== 音序器（16 小节循环） ========== */
let transportTimer = null, lastTickTime = 0;
const scheduled = new Set();

function stepDuration() { return 60 / state.tempo / STEPS_PER_BEAT; }

function startTransport() {
  if (transportTimer) return;
  state.transportRunning = true;
  lastTickTime = performance.now();
  transportTimer = setInterval(() => {
    const now = performance.now();
    const dt = (now - lastTickTime) / 1000;
    lastTickTime = now;
    const prev = state.transportStep;
    state.transportStep = (state.transportStep + dt / stepDuration()) % TOTAL_STEPS;
    if (state.playing) schedulePlayback(prev, state.transportStep);
  }, 20);
}

function stopTransport() {
  clearInterval(transportTimer);
  transportTimer = null;
  state.transportRunning = false;
}

function schedulePlayback(prev, cur) {
  for (const ev of state.events) {
    const hit = prev <= cur
      ? (ev.step >= prev && ev.step < cur)
      : (ev.step >= prev || ev.step < cur); // 跨循环边界
    if (hit && !scheduled.has(ev)) {
      scheduled.add(ev);
      setTimeout(() => scheduled.delete(ev), 500);
      playEvent(ev);
    }
  }
}

function playEvent(ev) {
  const t = tubes[ev.tube];
  if (t.locked) return;
  if (noteOn(ev.tube)) {
    setTimeout(() => noteOff(ev.tube), ev.dur * stepDuration() * 1000);
  }
}

function startRecording() {
  if (!state.audioReady) return;
  state.recording = true;
  state.events = [];
  state.recordNoteCount = 0;
  state.transportStep = 0;
  startTransport();
  updateStatus();
}

function stopRecording() {
  state.recording = false;
  tubes.forEach((_, i) => noteOff(i));
  if (!state.playing) stopTransport();
  updateStatus();
}

function startPlayback() {
  if (!state.audioReady || state.events.length === 0) return;
  state.playing = true;
  state.transportStep = 0;
  startTransport();
  updateStatus();
}

function stopPlayback() {
  state.playing = false;
  if (!state.recording) stopTransport();
  tubes.forEach((_, i) => noteOff(i));
  updateStatus();
}

/* ========== 工程导入 / 导出 ========== */
function exportProject() {
  const project = {
    app: "glass-tube-instrument",
    version: 1,
    tempo: state.tempo,
    tempLimit: state.tempLimit,
    bars: BARS,
    tubes: tubes.map(t => ({ baseFreq: t.baseFreq, tuneCents: t.tuneCents })),
    events: state.events,
  };
  const blob = new Blob([JSON.stringify(project, null, 2)],
    { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "glass-project.json";
  a.click();
  URL.revokeObjectURL(a.href);
  return project;
}

function importProject(project) {
  if (!project || project.app !== "glass-tube-instrument") {
    throw new Error("不是有效的玻璃管琴工程文件");
  }
  state.tempo = project.tempo ?? 100;
  state.tempLimit = project.tempLimit ?? 80;
  (project.tubes || []).forEach((pt, i) => {
    if (tubes[i]) { tubes[i].baseFreq = pt.baseFreq; tubes[i].tuneCents = pt.tuneCents; }
  });
  state.events = project.events || [];
  document.getElementById("tempo").value = state.tempo;
  document.getElementById("tempoVal").textContent = state.tempo;
  document.getElementById("tempLimit").value = state.tempLimit;
  document.getElementById("tempLimitVal").textContent = state.tempLimit;
  refreshTunerUI();
  updateButtons();
  updateStatus();
}

/* ========== Canvas 渲染 ========== */
const stage = document.getElementById("stage");
const wave = document.getElementById("wave");
const sctx = stage.getContext("2d");
const wctx = wave.getContext("2d");
let phase = 0, lastFrame = performance.now();

function resize() {
  stage.width = stage.clientWidth * devicePixelRatio;
  stage.height = stage.clientHeight * devicePixelRatio;
  wave.width = wave.clientWidth * devicePixelRatio;
  wave.height = wave.clientHeight * devicePixelRatio;
}
window.addEventListener("resize", resize);

function tempColor(temp) {
  const k = Math.min(1, Math.max(0, (temp - 20) / 80));
  return `hsl(${210 - 190 * k}, 85%, ${45 + 15 * k}%)`;
}

function tubeRect(i) {
  const w = stage.width / TUBE_COUNT;
  const len = stage.height * (0.55 + 0.35 * (1 - i / TUBE_COUNT));
  return { x: i * w + w * 0.2, y: 20 * devicePixelRatio,
           w: w * 0.6, h: len };
}

function draw() {
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  phase += dt * 30;
  tickTemperature(dt);
  tubes.forEach(t => {
    t.amplitude += ((t.vibrating ? 1 : 0) - t.amplitude) * Math.min(1, dt * 8);
  });

  sctx.clearRect(0, 0, stage.width, stage.height);
  for (const t of tubes) {
    const r = tubeRect(t.index);
    const wob = Math.sin(phase + t.index) * 4 * t.amplitude * devicePixelRatio;
    sctx.save();
    sctx.translate(wob, 0);
    const grad = sctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
    grad.addColorStop(0, "rgba(160,220,255,0.25)");
    grad.addColorStop(1, tempColor(t.temp));
    sctx.fillStyle = grad;
    sctx.beginPath();
    sctx.roundRect(r.x, r.y, r.w, r.h, r.w / 2);
    sctx.fill();
    sctx.strokeStyle = t.locked ? "#ff5566" : "rgba(200,230,255,0.7)";
    sctx.lineWidth = 2 * devicePixelRatio;
    sctx.stroke();
    sctx.restore();
    // 温度计
    const gx = r.x + r.w + 6 * devicePixelRatio;
    const gh = r.h * Math.min(1, t.temp / 100);
    sctx.fillStyle = tempColor(t.temp);
    sctx.fillRect(gx, r.y + r.h - gh, 5 * devicePixelRatio, gh);
    // 温度上限刻度
    const ly = r.y + r.h * (1 - state.tempLimit / 100);
    sctx.fillStyle = "#ff8899";
    sctx.fillRect(r.x, ly, r.w, 1.5 * devicePixelRatio);
    sctx.fillStyle = "#cfe0ff";
    sctx.font = `${11 * devicePixelRatio}px monospace`;
    sctx.textAlign = "center";
    sctx.fillText(`${tubeFreq(t).toFixed(1)}Hz`, r.x + r.w / 2, r.y + r.h + 16 * devicePixelRatio);
    sctx.fillText(`${t.temp.toFixed(0)}°${t.locked ? " 锁定" : ""}`,
      r.x + r.w / 2, r.y + r.h + 32 * devicePixelRatio);
  }

  // 波形
  wctx.clearRect(0, 0, wave.width, wave.height);
  if (state.audioReady) {
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    wctx.strokeStyle = "#7fd8ff";
    wctx.lineWidth = 1.5 * devicePixelRatio;
    wctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = (i / data.length) * wave.width;
      const y = wave.height / 2 + data[i] * wave.height * 0.45;
      i === 0 ? wctx.moveTo(x, y) : wctx.lineTo(x, y);
    }
    wctx.stroke();
  }
  // 音序进度
  if (state.transportRunning) {
    const bar = Math.floor(state.transportStep / (BEATS_PER_BAR * STEPS_PER_BEAT)) + 1;
    sctx.fillStyle = "#9fb4e8";
    sctx.font = `${12 * devicePixelRatio}px monospace`;
    sctx.textAlign = "left";
    sctx.fillText(`小节 ${bar}/16  步 ${state.transportStep.toFixed(1)}/${TOTAL_STEPS}`,
      10 * devicePixelRatio, 14 * devicePixelRatio);
  }
  requestAnimationFrame(draw);
}

/* ========== 交互与 UI ========== */
function tubeAt(x, y) {
  for (let i = 0; i < TUBE_COUNT; i++) {
    const r = tubeRect(i);
    const px = x * devicePixelRatio, py = y * devicePixelRatio;
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return i;
  }
  return -1;
}

let hoverTube = -1;
stage.addEventListener("pointermove", e => {
  const rect = stage.getBoundingClientRect();
  const i = tubeAt(e.clientX - rect.left, e.clientY - rect.top);
  if (i !== hoverTube) {
    if (hoverTube >= 0) noteOff(hoverTube);
    hoverTube = i;
    if (i >= 0) noteOn(i);
  }
});
stage.addEventListener("pointerleave", () => {
  if (hoverTube >= 0) noteOff(hoverTube);
  hoverTube = -1;
});

function refreshTunerUI() {
  document.querySelectorAll(".tuner input").forEach((el, i) => {
    el.value = tubes[i].tuneCents;
    el.nextElementSibling.textContent = `${tubes[i].tuneCents > 0 ? "+" : ""}${tubes[i].tuneCents}¢`;
  });
}

function buildTuners() {
  const box = document.getElementById("tuners");
  tubes.forEach((t, i) => {
    const div = document.createElement("div");
    div.className = "tuner";
    div.innerHTML = `管${i + 1}<input type="range" min="-100" max="100" value="0"><span>0¢</span>`;
    div.querySelector("input").addEventListener("input", e => {
      t.tuneCents = +e.target.value;
      e.target.nextElementSibling.textContent =
        `${t.tuneCents > 0 ? "+" : ""}${t.tuneCents}¢`;
    });
    box.appendChild(div);
  });
}

function updateButtons() {
  document.getElementById("btnRecord").classList.toggle("active", state.recording);
  document.getElementById("btnPlay").classList.toggle("active", state.playing);
  document.getElementById("btnPlay").disabled = state.events.length === 0;
  document.getElementById("btnExport").disabled = state.events.length === 0;
  document.getElementById("btnStop").disabled = !state.recording && !state.playing;
}

function updateStatus() {
  updateButtons();
  const hot = tubes.filter(t => t.locked).length;
  document.getElementById("status").textContent =
    `录音:${state.recording ? "进行中" : "关"}  回放:${state.playing ? "循环中" : "关"}  ` +
    `已录音符:${state.events.length}  过热管:${hot}  温度上限:${state.tempLimit}°`;
}

document.getElementById("btnAudio").addEventListener("click", () => {
  initAudio();
  ctx.resume();
  updateStatus();
});
document.getElementById("btnRecord").addEventListener("click", () => {
  state.recording ? stopRecording() : startRecording();
});
document.getElementById("btnPlay").addEventListener("click", () => {
  state.playing ? stopPlayback() : startPlayback();
});
document.getElementById("btnStop").addEventListener("click", () => {
  if (state.recording) stopRecording();
  if (state.playing) stopPlayback();
});
document.getElementById("btnExport").addEventListener("click", exportProject);
document.getElementById("btnImport").addEventListener("click", () => {
  document.getElementById("fileInput").click();
});
document.getElementById("fileInput").addEventListener("change", e => {
  const f = e.target.files[0];
  if (!f) return;
  f.text().then(txt => importProject(JSON.parse(txt)))
    .catch(err => alert(err.message));
});
document.getElementById("tempo").addEventListener("input", e => {
  state.tempo = +e.target.value;
  document.getElementById("tempoVal").textContent = state.tempo;
});
document.getElementById("tempLimit").addEventListener("input", e => {
  state.tempLimit = +e.target.value;
  document.getElementById("tempLimitVal").textContent = state.tempLimit;
  updateStatus();
});

/* 测试钩子 */
window.__glass = {
  state, tubes, TOTAL_STEPS,
  noteOn, noteOff, tubeFreq,
  startRecording, stopRecording, startPlayback, stopPlayback,
  exportProject, importProject, initAudio,
};

buildTuners();
resize();
updateStatus();
requestAnimationFrame(draw);
