import {
  MATERIAL_BY_ID,
  evaluateTimeline,
  formatPan,
  generateRound,
  normalizeComponent,
  normalizeSeed,
} from "./engine.js";
import { EchoSynth, impulseProfile } from "./audio.js";
import { StageRenderer } from "./canvas.js";

const DEFAULT_SEED = "481516";
const canvas = document.querySelector("#stage");
const ui = {
  seedInput: document.querySelector("#seed-input"),
  applySeed: document.querySelector("#apply-seed"),
  sameSeed: document.querySelector("#same-seed"),
  newSeed: document.querySelector("#new-seed"),
  selectedLabel: document.querySelector("#selected-label"),
  selectedMaterial: document.querySelector("#selected-material"),
  meterEcho: document.querySelector("#meter-echo"),
  meterPan: document.querySelector("#meter-pan"),
  meterLow: document.querySelector("#meter-low"),
  valueEcho: document.querySelector("#value-echo"),
  valuePan: document.querySelector("#value-pan"),
  valueLow: document.querySelector("#value-low"),
  materialNote: document.querySelector("#material-note"),
  play: document.querySelector("#play-button"),
  stop: document.querySelector("#stop-button"),
  door: document.querySelector("#door-button"),
  reverb: document.querySelector("#reverb-status"),
  placedCount: document.querySelector("#placed-count"),
  attemptCount: document.querySelector("#attempt-count"),
  lock: document.querySelector("#lock-button"),
  status: document.querySelector("#status-line"),
  footerSeed: document.querySelector("#footer-seed"),
  toast: document.querySelector("#toast"),
};

const state = {
  round: null,
  placement: new Map(),
  slotEventId: Array(6).fill(null),
  selectedId: null,
  phase: "idle",
  evaluation: null,
  attempts: 0,
  playing: false,
  playingId: null,
  playStarted: 0,
  duration: 0,
  liveSamples: null,
  successAt: 0,
  playProgress(now = performance.now()) {
    if (!this.duration) return 0;
    const progress = (now - this.playStarted) / (this.duration * 1000);
    return Math.max(0, Math.min(1, progress));
  },
};

let pointerState = null;
let toastTimer = 0;
let synth = null;
let stage = null;

init();

function init() {
  const querySeed = new URLSearchParams(location.search).get("seed");
  synth = new EchoSynth({ onState: handleAudioState });
  stage = new StageRenderer(canvas, { onDoor: toggleDoor });

  startRound(querySeed || DEFAULT_SEED, { replaceUrl: Boolean(querySeed) });
  bindControls();
  bindCanvas();
  requestAnimationFrame(frame);
}

function startRound(inputSeed, { replaceUrl = true } = {}) {
  const seed = normalizeSeed(inputSeed);
  synth?.stop();
  const round = generateRound(seed);
  state.round = round;
  state.placement = new Map();
  state.slotEventId = Array(6).fill(null);
  state.selectedId = round.events[0].id;
  state.phase = "idle";
  state.evaluation = null;
  state.attempts = 0;
  state.playing = false;
  state.playingId = null;
  state.duration = 0;
  state.liveSamples = null;
  state.successAt = 0;
  pointerState = null;

  if (stage) {
    stage.setModel(state);
    stage.resize();
    stage.hitTest(-1, -1);
  }
  ui.seedInput.value = round.seed;
  ui.footerSeed.textContent = `SEED ${round.seed}`;
  if (replaceUrl) {
    const url = new URL(location.href);
    url.searchParams.set("seed", round.seed);
    history.replaceState(null, "", url);
  }
  document.title = `B1 / ${round.seed} · 地下回声测绘`;
  refreshUI();
  setStatus("等待六段声纹落位", "");
}

function bindControls() {
  ui.applySeed.addEventListener("click", () => {
    startRound(ui.seedInput.value || DEFAULT_SEED);
    toast(`已载入 seed ${state.round.seed}`);
  });
  ui.seedInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    startRound(ui.seedInput.value || DEFAULT_SEED);
    toast(`已载入 seed ${state.round.seed}`);
  });
  ui.sameSeed.addEventListener("click", () => {
    startRound(state.round.seed);
    toast(`相同 seed 已重建 · ${state.round.seed}`);
  });
  ui.newSeed.addEventListener("click", () => {
    const seed = String(randomSeed());
    startRound(seed);
    toast(`新 session seed · ${seed}`);
  });
  ui.play.addEventListener("click", playSelected);
  ui.stop.addEventListener("click", () => synth.stop());
  ui.door.addEventListener("click", toggleDoor);
  ui.lock.addEventListener("click", lockTimeline);
}

function bindCanvas() {
  canvas.addEventListener("pointerdown", (event) => {
    if (state.phase === "success") return;
    const point = canvasPoint(event);
    const hit = stage.pointerDown(point.x, point.y);
    if (!hit || hit.kind !== "event") {
      pointerState = null;
      return;
    }
    stage.setDrag(null);
    pointerState = {
      eventId: hit.eventId,
      origin: hit.origin,
      slot: hit.slot,
      startX: point.x,
      startY: point.y,
      moved: false,
      pointerId: event.pointerId,
    };
    canvas.setPointerCapture(event.pointerId);
    selectEvent(hit.eventId, false);
  });

  canvas.addEventListener("pointermove", (event) => {
    const point = canvasPoint(event);
    stage.pointerMove(point.x, point.y, Boolean(pointerState));
    if (!pointerState || state.phase === "success") return;
    const distance = Math.hypot(point.x - pointerState.startX, point.y - pointerState.startY);
    if (distance < 5 || pointerState.moved) return;
    pointerState.moved = true;
    stage.setDrag({
      kind: "event",
      eventId: pointerState.eventId,
      origin: pointerState.origin,
      slot: pointerState.slot,
    });
  });

  canvas.addEventListener("pointerup", (event) => {
    const point = canvasPoint(event);
    stage.pointerMove(point.x, point.y, false);
    stage.pointerUp();
    if (!pointerState) return;
    const current = pointerState;
    pointerState = null;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    if (current.moved) {
      handleDrop(current, point);
    } else {
      selectEvent(current.eventId, true);
    }
    stage.setDrag(null);
  });

  canvas.addEventListener("pointercancel", () => {
    pointerState = null;
    stage.pointerUp();
    stage.setDrag(null);
  });

  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
}

function handleDrop(current, point) {
  if (state.phase === "success") return;
  const drop = stage.hover;
  let changed = false;

  if (drop?.kind === "slot") {
    const targetSlot = drop.slot;
    const sourceSlot = current.origin === "slot" ? current.slot : null;
    if (sourceSlot === targetSlot) return;
    const occupant = state.slotEventId[targetSlot];

    if (occupant) {
      if (sourceSlot !== null) {
        state.placement.set(occupant, sourceSlot);
      } else {
        state.placement.delete(occupant);
      }
    }
    state.placement.set(current.eventId, targetSlot);
    changed = true;
  } else if (
    current.origin === "slot" &&
    point.y < stage.layout.corridorTop - 4
  ) {
    state.placement.delete(current.eventId);
    changed = true;
  }

  if (!changed) return;
  syncSlotOwners();
  if (state.phase === "failed" || state.phase === "adjusting") {
    state.phase = "idle";
    state.evaluation = null;
  }
  state.selectedId = current.eventId;
  refreshUI();
  setStatus(
    state.placement.size === 6 ? "六段声纹已满位，可锁定时间线" : "继续调整落位",
    "",
  );
  playSelected();
}

function syncSlotOwners() {
  state.slotEventId = Array(6).fill(null);
  for (const [eventId, slot] of state.placement) {
    state.slotEventId[slot] = eventId;
  }
}

function selectEvent(eventId, shouldPlay) {
  if (state.phase === "success" && shouldPlay) return;
  state.selectedId = eventId;
  refreshUI();
  if (shouldPlay) playSelected();
}

async function playSelected() {
  const event = selectedEvent();
  if (!event) return;
  state.playingId = event.id;
  try {
    await synth.preview(event, state.round.doorOpen);
    refreshReverb();
  } catch (error) {
    state.playing = false;
    state.playingId = null;
    toast(error.message || "音频初始化失败");
  }
}

async function toggleDoor() {
  state.round.doorOpen = !state.round.doorOpen;
  refreshReverb();
  try {
    await synth.doorCreak();
  } catch {
    toast("门声需要浏览器音频权限");
  }
  toast(state.round.doorOpen ? "侧门开启 · 混响耦合已接入" : "侧门封闭 · 混响恢复");
}

function lockTimeline() {
  if (state.phase === "success") return;
  if (state.placement.size < 6) {
    toast(`仍有 ${6 - state.placement.size} 段声纹未落位`);
    return;
  }
  state.attempts += 1;
  const evaluation = evaluateTimeline(state.round, state.placement);
  state.evaluation = evaluation;

  if (evaluation.passed) {
    state.phase = "success";
    state.successAt = performance.now();
    stage.bump("success");
    setStatus(`路径吻合 · 容差内错位 ${evaluation.mismatches} / 6`, "success");
    toast("声源路径已复原");
  } else {
    state.phase = "failed";
    stage.bump("error");
    setStatus(`校准失败 · ${evaluation.mismatches} 段错位（阈值 ≥ 2）`, "warn");
    toast("未通过：至少两段错位，真实位置仍保持隐藏");
  }
  refreshUI();
}

function handleAudioState(payload) {
  if (payload.playing) {
    state.playing = true;
    state.playingId = payload.eventId || state.playingId;
    state.playStarted = payload.startedAt;
    state.duration = payload.duration;
    state.liveSamples = null;
  } else {
    state.playing = false;
    state.playingId = null;
    state.liveSamples = null;
  }
}

function refreshUI() {
  syncSlotOwners();
  const event = selectedEvent();
  const material = event ? MATERIAL_BY_ID[event.materialId] : null;
  const components = event ? normalizeComponent(event) : null;

  if (event && material) {
    ui.selectedLabel.textContent = `${event.label} / ${material.code}`;
    ui.selectedMaterial.textContent = material.name;
    ui.materialNote.textContent = material.note;
    ui.meterEcho.style.width = `${Math.round(components.echo * 100)}%`;
    ui.meterPan.style.width = `${Math.round(components.pan * 100)}%`;
    ui.meterLow.style.width = `${Math.round(components.low * 100)}%`;
    ui.valueEcho.textContent = `${event.echoMs}ms`;
    ui.valuePan.textContent = formatPan(event.pan);
    ui.valueLow.textContent = `${event.lowFreq}%`;
    refreshReverb();
  }

  ui.placedCount.textContent = String(state.placement.size);
  ui.attemptCount.textContent = String(state.attempts);
  ui.lock.disabled = state.placement.size !== 6 || state.phase === "success";
  ui.door.textContent = state.round.doorOpen ? "关闭电平门" : "触发电平门";
  if (state.phase === "idle") {
    setStatus(
      state.placement.size === 6
        ? "六段声纹已满位，可锁定时间线"
        : `仍有 ${6 - state.placement.size} 段未落位`,
      "",
    );
  }
}

function refreshReverb() {
  const event = selectedEvent();
  if (!event) {
    ui.reverb.textContent = "IR 待构建";
    return;
  }
  const material = MATERIAL_BY_ID[event.materialId];
  const profile = impulseProfile(event, material, state.round.doorOpen);
  ui.reverb.textContent = `IR ${profile.tail}ms · 墙返 ${profile.wallDelayMs}ms · ${profile.coupling === "open" ? "OPEN" : "SEALED"}`;
}

function selectedEvent() {
  return state.round?.events.find((event) => event.id === state.selectedId) || null;
}

function setStatus(text, tone) {
  ui.status.textContent = text;
  ui.status.dataset.tone = tone;
}

function toast(message) {
  clearTimeout(toastTimer);
  ui.toast.textContent = message;
  ui.toast.classList.add("visible");
  toastTimer = setTimeout(() => ui.toast.classList.remove("visible"), 2600);
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * stage.width,
    y: ((event.clientY - rect.top) / rect.height) * stage.height,
  };
}

function randomSeed() {
  if (globalThis.crypto?.getRandomValues) {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return 100000 + (values[0] % 900000);
  }
  return Math.floor(100000 + Math.random() * 900000);
}

function frame(now) {
  if (state.playing) {
    state.liveSamples = synth.liveWaveform(76);
  }
  stage.render(now);
  requestAnimationFrame(frame);
}
