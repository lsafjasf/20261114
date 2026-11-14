import {
  BPM,
  CLIP_THRESHOLD,
  CONTROL_DEFS,
  DEFAULT_CONTROLS,
  DURATION,
  MixEngine,
  SAMPLE_RATE,
  TRACKS,
  encodeWav,
  renderOfflineMix,
} from './audio.js';
import {
  MeterRenderer,
  ScopeRenderer,
  TimelineRenderer,
  createFaderSurfaces,
} from './ui.js';

const PROJECT_NAME = 'NEON HALF-LIGHT';
const SAVED_KEY = 'dualBus.savedProject.v1';
const DRAFT_KEY = 'dualBus.draft.v1';

const dom = {
  saveButton: document.querySelector('#saveButton'),
  exportButton: document.querySelector('#exportButton'),
  transportButton: document.querySelector('#transportButton'),
  transportIcon: document.querySelector('#transportIcon'),
  transportLabel: document.querySelector('#transportLabel'),
  transportProgress: document.querySelector('#transportProgress'),
  timecode: document.querySelector('#timecode'),
  clipChip: document.querySelector('#clipChip'),
  clipCount: document.querySelector('#clipCount'),
  clipCard: document.querySelector('#clipCard'),
  peakValue: document.querySelector('#peakValue'),
  peakHold: document.querySelector('#peakHold'),
  meterState: document.querySelector('#meterState'),
  headroomValue: document.querySelector('#headroomValue'),
  captureValue: document.querySelector('#captureValue'),
  sampleRateLabel: document.querySelector('#sampleRateLabel'),
  footerStatus: document.querySelector('#footerStatus'),
  syncLabel: document.querySelector('#syncLabel'),
  toast: document.querySelector('#toast'),
  leftPeerWatch: document.querySelector('#leftPeerWatch'),
  rightPeerWatch: document.querySelector('#rightPeerWatch'),
  masterNote: document.querySelector('#masterNote'),
};

const scopeCanvas = document.querySelector('#scopeCanvas');
const meterCanvas = document.querySelector('#meterCanvas');
const timelineCanvas = document.querySelector('#timelineCanvas');

function cloneControls(source) {
  return {
    left: { ...source.left },
    right: { ...source.right },
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function loadControls() {
  for (const key of [SAVED_KEY, DRAFT_KEY]) {
    try {
      const stored = JSON.parse(localStorage.getItem(key) || 'null');
      if (!stored?.controls) continue;
      const next = cloneControls(DEFAULT_CONTROLS);
      for (const side of ['left', 'right']) {
        for (const def of CONTROL_DEFS[side]) {
          const candidate = Number(stored.controls?.[side]?.[def.key]);
          if (Number.isFinite(candidate)) next[side][def.key] = clamp(candidate, def.min, def.max);
        }
      }
      return next;
    } catch {
      // Ignore malformed local data and use the factory settings.
    }
  }
  return cloneControls(DEFAULT_CONTROLS);
}

let controls = loadControls();
let engine = null;
let audioContext = null;
let restoredSavedProject = false;
try {
  restoredSavedProject = Boolean(JSON.parse(localStorage.getItem(SAVED_KEY) || 'null'));
} catch {
  restoredSavedProject = false;
}

const session = {
  status: 'idle',
  elapsed: 0,
  capture: 0,
  onlineClips: 0,
  livePeak: 0,
  validated: false,
  exported: false,
  analysis: null,
  completion: null,
  resolveCompletion: null,
  clipNotified: false,
  savedAt: null,
};

const waveData = new Float32Array(2048);
const faders = createFaderSurfaces({ onControl: handleControl });
const scope = new ScopeRenderer(scopeCanvas, () => {
  if (engine) engine.getWaveform(waveData);
  else waveData.fill(0);
  return waveData;
});
const meter = new MeterRenderer(meterCanvas);
const timeline = new TimelineRenderer(timelineCanvas);

let toastTimer = 0;
const peerTimers = { left: 0, right: 0 };

function showToast(message, isError = false) {
  window.clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.toggle('is-error', isError);
  dom.toast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => {
    dom.toast.classList.remove('is-visible');
  }, 3600);
}

function peerLabel(side) {
  return side === 'left' ? '低频席' : '旋律席';
}

function pulsePeer(actor) {
  const target = actor === 'left' ? dom.rightPeerWatch : dom.leftPeerWatch;
  const name = peerLabel(actor);
  window.clearTimeout(peerTimers[actor]);
  target.classList.add('is-active');
  target.lastElementChild.textContent = `对方：${name}调节中 · 数值隐藏`;
  peerTimers[actor] = window.setTimeout(() => {
    target.classList.remove('is-active');
    target.lastElementChild.textContent = `对方：${name}活动`;
  }, 1200);
}

function persistDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      controls,
      updatedAt: new Date().toISOString(),
    }));
  } catch {
    // Draft persistence is best effort.
  }
}

function invalidateCapture(reason = '设置已改变，需重新播放') {
  if (session.status === 'playing' || session.status === 'validating') return;
  session.status = 'idle';
  session.elapsed = 0;
  session.capture = 0;
  session.validated = false;
  session.exported = false;
  session.analysis = null;
  session.onlineClips = 0;
  session.livePeak = 0;
  session.clipNotified = false;
  dom.exportButton.disabled = true;
  dom.footerStatus.textContent = reason;
}

function handleControl(side, key, value) {
  const def = CONTROL_DEFS[side].find((item) => item.key === key);
  if (!def) return;
  const next = clamp(Number(value), def.min, def.max);
  controls[side][key] = next;
  engine?.setControl(side, key, next);
  pulsePeer(side);
  if (session.validated || session.status === 'complete' || session.status === 'failed') {
    invalidateCapture();
  }
  persistDraft();
}

function formatTime(seconds) {
  const ms = Math.floor(clamp(seconds, 0, DURATION) * 1000);
  const minutes = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function dbText(value) {
  if (!Number.isFinite(value) || value <= 0) return '−∞';
  return `${(20 * Math.log10(value)).toFixed(1)}`;
}

function headroomText(peak) {
  if (!Number.isFinite(peak) || peak <= 0) return '—';
  const headroom = 20 * Math.log10(CLIP_THRESHOLD / Math.max(peak, 0.000001));
  return `${Math.max(0, headroom).toFixed(1)} dB`;
}

function resolveSession(result) {
  if (session.resolveCompletion) session.resolveCompletion(result);
  session.resolveCompletion = null;
}

async function startPlayback() {
  if (session.status === 'playing' || session.status === 'validating') return { started: false };
  if (engine) {
    engine.dispose();
    engine = null;
  }
  if (audioContext) {
    try {
      await audioContext.close();
    } catch {
      // Context is already closed.
    }
  }

  session.status = 'starting';
  session.elapsed = 0;
  session.capture = 0;
  session.onlineClips = 0;
  session.livePeak = 0;
  session.validated = false;
  session.exported = false;
  session.analysis = null;
  session.clipNotified = false;
  dom.exportButton.disabled = true;
  updateStaticState();

  audioContext = new AudioContext({ latencyHint: 'interactive' });
  await audioContext.resume();
  dom.sampleRateLabel.textContent = `${(audioContext.sampleRate / 1000).toFixed(1)} kHz`;
  engine = new MixEngine(audioContext, controls);
  engine.onClip = () => {
    if (session.clipNotified) return;
    session.clipNotified = true;
    dom.masterNote.innerHTML = '<span class="note-mark">!</span><p>总线已经削波。降低鼓组、低频或旋律增益，或下调压缩阈值后重新播放。</p>';
    showToast('检测到总线削波：调整增益后重新开始 32 秒播放', true);
  };
  session.status = 'playing';
  session.completion = new Promise((resolve) => {
    session.resolveCompletion = resolve;
  });
  updateStaticState();
  return { started: true, sampleRate: audioContext.sampleRate };
}

function stopPlayback(manual = true) {
  if (engine) {
    session.onlineClips = Math.max(session.onlineClips, engine.clipCount);
    session.livePeak = Math.max(session.livePeak, engine.onlinePeak);
    engine.dispose();
    engine = null;
  }
  if (audioContext) {
    audioContext = null;
  }
  if (manual) {
    session.status = 'idle';
    session.elapsed = 0;
    session.capture = 0;
    session.validated = false;
    session.exported = false;
    session.analysis = null;
    dom.exportButton.disabled = true;
    dom.footerStatus.textContent = '播放已停止 · 需要完整 32 秒';
  }
  resolveSession({ success: false, stopped: manual });
  updateStaticState();
}

async function finalizePlayback() {
  if (session.status !== 'playing') return;
  session.elapsed = DURATION;
  session.capture = 100;
  session.onlineClips = Math.max(session.onlineClips, engine?.clipCount || 0);
  session.livePeak = Math.max(session.livePeak, engine?.onlinePeak || 0);
  if (engine) engine.dispose();
  engine = null;
  audioContext = null;
  session.status = 'validating';
  dom.footerStatus.textContent = '正在离线复核 32 秒总线的每一个采样';
  updateStaticState();

  try {
    const result = await renderOfflineMix(controls);
    session.analysis = result.analysis;
    if (result.analysis.clipped || session.onlineClips > 0) {
      session.status = 'failed';
      session.validated = false;
      dom.exportButton.disabled = true;
      dom.footerStatus.textContent = '复核失败：削波。调整增益和压缩后重播';
      showToast(`总线仍有削波：${result.analysis.clippedSamples} 个采样过载`, true);
      resolveSession({ success: false, reason: 'clipped', analysis: result.analysis });
    } else {
      session.status = 'complete';
      session.validated = true;
      dom.exportButton.disabled = false;
      dom.footerStatus.textContent = `无削波捕获完成 · 峰值 ${result.analysis.peakDb.toFixed(1)} dBFS`;
      showToast('32 秒播放与离线复核完成，可以保存工程并导出混音');
      resolveSession({ success: true, analysis: result.analysis });
    }
  } catch (error) {
    session.status = 'failed';
    session.validated = false;
    dom.exportButton.disabled = true;
    dom.footerStatus.textContent = '离线复核失败，请重试';
    showToast(`离线复核失败：${error.message}`, true);
    resolveSession({ success: false, reason: 'render-error', message: error.message });
  }
  updateStaticState();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function projectPayload() {
  const savedAt = new Date().toISOString();
  return {
    schema: 'dual-bus-project/v1',
    name: 'NEON HALF-LIGHT',
    version: 'v01',
    savedAt,
    duration: DURATION,
    bpm: BPM,
    sampleRate: SAMPLE_RATE,
    roles: {
      left: ['drums', 'low', 'comp'],
      right: ['melody', 'echo', 'pan'],
    },
    controls: cloneControls(controls),
    tracks: TRACKS.map((track) => ({
      id: track.id,
      name: track.name,
      side: track.side,
      synthesis: 'Web Audio realtime',
    })),
    capture: {
      complete: session.validated,
      status: session.status,
      durationSeconds: session.elapsed,
      clipCount: session.analysis?.clippedSamples ?? session.onlineClips,
      peakDbfs: session.analysis?.peakDb ?? null,
      rmsDbfs: session.analysis?.rmsDb ?? null,
      verifiedOffline: Boolean(session.analysis),
    },
    export: {
      exported: session.exported,
      filename: 'neon-half-light_dual-bus_mix.wav',
    },
  };
}

function saveProject(options = {}) {
  const project = projectPayload();
  const text = JSON.stringify(project, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const filename = 'neon-half-light_dual-bus_project.json';
  session.savedAt = project.savedAt;
  try {
    localStorage.setItem(SAVED_KEY, text);
    localStorage.setItem(DRAFT_KEY, text);
  } catch {
    // Download still succeeds when storage is unavailable.
  }
  if (options.download !== false) downloadBlob(blob, filename);
  showToast(`工程已保存：${filename}`);
  dom.saveButton.blur();
  return { filename, project, size: blob.size };
}

async function exportMix(options = {}) {
  if (!session.validated || !session.analysis) {
    throw new Error('必须先完成一次完整 32 秒且无削波的播放');
  }
  dom.exportButton.disabled = true;
  dom.footerStatus.textContent = '正在执行全轨离线渲染与 WAV 编码';
  try {
    const result = await renderOfflineMix(controls);
    if (result.analysis.clipped) {
      session.status = 'failed';
      session.validated = false;
      session.analysis = result.analysis;
      throw new Error('导出复核发现削波，已阻止下载');
    }
    const blob = encodeWav(result.buffer);
    const filename = 'neon-half-light_dual-bus_mix.wav';
    if (options.download !== false) downloadBlob(blob, filename);
    session.exported = true;
    session.analysis = result.analysis;
    dom.footerStatus.textContent = `混音已导出 · ${(blob.size / 1024 / 1024).toFixed(1)} MB · 峰值 ${result.analysis.peakDb.toFixed(1)} dBFS`;
    showToast(`混音导出完成：${filename}`);
    return {
      filename,
      size: blob.size,
      analysis: result.analysis,
      blob,
    };
  } finally {
    dom.exportButton.disabled = !session.validated;
    updateStaticState();
  }
}

function formatClipCount(count) {
  if (!count) return '00';
  if (count > 999) return 'FAIL';
  return String(count).padStart(2, '0');
}

function updateStaticState() {
  const playing = session.status === 'playing';
  const starting = session.status === 'starting';
  const validating = session.status === 'validating';
  dom.transportButton.classList.toggle('is-playing', playing || validating);
  dom.transportButton.setAttribute('aria-label', playing ? '停止播放' : '开始 32 秒播放');
  dom.transportIcon.textContent = playing ? '■' : validating ? '…' : '▶';
  const labels = {
    idle: '待机 · 双人控制已连接',
    starting: '正在启动 Web Audio 合成引擎',
    playing: '实时合成中 · 两侧独立控制',
    validating: '离线复核 32 秒总线峰值',
    complete: '无削波捕获完成 · 可保存与导出',
    failed: '削波或不完整 · 请重播',
  };
  dom.transportLabel.textContent = labels[session.status] || labels.idle;
  const clips = session.analysis?.clippedSamples ?? session.onlineClips;
  dom.clipChip.textContent = `${formatClipCount(clips)} CLIPS`;
  dom.clipChip.classList.toggle('is-clipping', clips > 0);
  dom.clipCount.textContent = formatClipCount(clips);
  dom.clipCard.classList.toggle('is-danger', clips > 0);
  dom.clipCard.classList.toggle('is-safe', session.validated && clips === 0);
  dom.captureValue.textContent = `${Math.round(session.capture)}%`;
  dom.exportButton.disabled = !session.validated || session.status === 'validating';
  dom.meterState.textContent = clips > 0 ? 'OVER' : session.validated ? 'PASS' : 'SAFE';
  dom.meterState.classList.toggle('is-hot', clips > 0);
}

let lastUI = 0;
let lastFaderDraw = 0;
let lastTimelineDraw = 0;
let lastScopeDraw = 0;

function animationFrame(now) {
  let currentPeak = 0;
  if (engine && session.status === 'playing') {
    session.elapsed = engine.getElapsed();
    session.capture = clamp((session.elapsed / DURATION) * 100, 0, 100);
    const wave = engine.getWaveform(waveData);
    for (let i = 0; i < wave.length; i += 1) {
      const value = Math.abs(wave[i]);
      if (value > currentPeak) currentPeak = value;
    }
    session.livePeak = Math.max(session.livePeak, engine.onlinePeak, currentPeak);
    session.onlineClips = engine.clipCount;
    if (session.elapsed >= DURATION) finalizePlayback();
  } else if (session.status === 'complete' || session.status === 'failed') {
    session.elapsed = DURATION;
    currentPeak = session.analysis?.peak || 0;
  }

  const signalPeak = session.status === 'playing' ? currentPeak : (session.analysis?.peak || 0);
  if (now - lastFaderDraw > 32) {
    faders.left.setValues(controls.left, signalPeak);
    faders.right.setValues(controls.right, signalPeak);
    faders.left.draw(now);
    faders.right.draw(now);
    lastFaderDraw = now;
  }
  if (now - lastScopeDraw > 32) {
    scope.draw(now, session.status === 'playing');
    lastScopeDraw = now;
  }
  meter.draw(now, signalPeak, 0);
  if (now - lastTimelineDraw > 55) {
    timeline.draw(session.elapsed, controls, session.status === 'playing');
    lastTimelineDraw = now;
  }

  if (now - lastUI > 75) {
    const hold = Math.max(session.livePeak, signalPeak);
    dom.timecode.textContent = formatTime(session.elapsed);
    dom.transportProgress.style.width = `${(session.elapsed / DURATION) * 100}%`;
    dom.peakValue.textContent = dbText(signalPeak);
    dom.peakHold.textContent = signalPeak > 0 ? dbText(hold) : '−∞';
    dom.headroomValue.textContent = headroomText(signalPeak);
    updateStaticState();
    lastUI = now;
  }
  requestAnimationFrame(animationFrame);
}

dom.transportButton.addEventListener('click', async () => {
  if (session.status === 'playing') {
    stopPlayback(true);
    return;
  }
  if (session.status === 'validating') return;
  try {
    await startPlayback();
  } catch (error) {
    session.status = 'idle';
    updateStaticState();
    showToast(`音频启动失败：${error.message}`, true);
  }
});

dom.saveButton.addEventListener('click', () => saveProject());
dom.exportButton.addEventListener('click', () => {
  exportMix().catch((error) => showToast(error.message, true));
});

function setControlsDirect(next) {
  for (const side of ['left', 'right']) {
    for (const def of CONTROL_DEFS[side]) {
      const value = Number(next?.[side]?.[def.key]);
      if (Number.isFinite(value)) controls[side][def.key] = clamp(value, def.min, def.max);
    }
  }
  engine?.setControls(controls);
  persistDraft();
}

function getPublicState() {
  return {
    status: session.status,
    elapsed: session.elapsed,
    capture: session.capture,
    validated: session.validated,
    exported: session.exported,
    onlineClips: session.onlineClips,
    analysis: session.analysis,
    controls: cloneControls(controls),
    savedAt: session.savedAt,
    sampleRate: audioContext?.sampleRate || SAMPLE_RATE,
  };
}

window.MixApp = {
  getState: getPublicState,
  getControls: () => cloneControls(controls),
  setControl: handleControl,
  setControls: setControlsDirect,
  startPlayback,
  stopPlayback: () => stopPlayback(true),
  waitForPlayback: () => session.completion || Promise.resolve({ success: session.validated }),
  finalizePlayback,
  saveProject,
  exportMix,
  validate: async (nextControls = controls) => {
    const result = await renderOfflineMix(nextControls);
    return result.analysis;
  },
};

updateStaticState();
dom.clipCount.textContent = '00';
dom.captureValue.textContent = '0%';
dom.sampleRateLabel.textContent = `${(SAMPLE_RATE / 1000).toFixed(1)} kHz`;
dom.footerStatus.textContent = session.validated
  ? '工程已恢复 · 可直接导出'
  : '等待完整 32 秒无削波播放';
if (restoredSavedProject) {
  dom.masterNote.innerHTML = '<span class="note-mark">i</span><p>已恢复本地工程。两席共享电平表，左侧与右侧的推子参数互不公开。</p>';
}

requestAnimationFrame(animationFrame);
