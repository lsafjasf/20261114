import { CONFIG, StationEngine, energyCost } from "./engine.js";
import { Soundscape } from "./audio.js";
import { StationRenderer } from "./renderer.js";

const elements = {
  served: document.querySelector("#served-value"),
  timer: document.querySelector("#timer"),
  status: document.querySelector("#status-text"),
  queueCount: document.querySelector("#queue-count"),
  queueList: document.querySelector("#queue-list"),
  batteryList: document.querySelector("#battery-list"),
  deliveryPips: [...document.querySelectorAll("#delivery-pips span")],
  selectedPack: document.querySelector("#selected-pack-label"),
  feed: document.querySelector("#event-message"),
  toast: document.querySelector("#toast"),
  pause: document.querySelector("#pause-button"),
  sound: document.querySelector("#sound-button"),
  modal: document.querySelector("#modal"),
  modalKicker: document.querySelector("#modal-kicker"),
  modalTitle: document.querySelector("#modal-title"),
  modalCopy: document.querySelector("#modal-copy"),
  modalRules: document.querySelector("#modal-rules"),
  modalPrimary: document.querySelector("#modal-primary"),
  modalSecondary: document.querySelector("#modal-secondary"),
};

const sound = new Soundscape();
let selectedBatteryId = "P3";
let renderer;
let autoTick = true;
let toastTimer = 0;
let outcomeTimer = 0;
let lastFrame = performance.now();
let queueSignature = "";
let batteryCards = new Map();

const formatTime = (seconds) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
};

function showToast(message, alert = false) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("is-alert", alert);
  elements.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2600);
}

function setFeed(message) {
  elements.feed.textContent = message;
}

function selectBattery(id, announce = true) {
  if (!engine.batteries.some((battery) => battery.id === id)) return;
  selectedBatteryId = id;
  renderUI();
  if (announce) {
    const battery = engine.batteries.find((item) => item.id === id);
    showToast(`${id} 已设为下一单电池 · ${battery.charge.toFixed(0)}% / ${battery.temp.toFixed(1)}°C`);
  }
}

function clearOutcomeTimer() {
  window.clearTimeout(outcomeTimer);
  outcomeTimer = 0;
}

function setModal({
  kicker,
  title,
  copy,
  rules = [],
  primaryLabel,
  onPrimary,
  secondaryLabel = "",
  onSecondary = null,
  tone = "normal",
}) {
  elements.modalKicker.textContent = kicker;
  elements.modalTitle.textContent = title;
  elements.modalCopy.textContent = copy;
  elements.modalRules.innerHTML = rules.map((rule) => `<span>${rule}</span>`).join("");
  elements.modalPrimary.textContent = primaryLabel;
  elements.modalPrimary.onclick = onPrimary;
  elements.modalSecondary.textContent = secondaryLabel;
  elements.modalSecondary.onclick = onSecondary;
  elements.modalSecondary.hidden = !secondaryLabel;
  elements.modal.dataset.tone = tone;
  elements.modal.classList.add("is-visible");
}

function hideModal() {
  elements.modal.classList.remove("is-visible");
}

function showStartModal() {
  setModal({
    kicker: "TIDE-9 / SHIFT BRIEF",
    title: "今晚，只有一条热限。",
    copy:
      "六辆车陆续抵达。调度两座工位与四块电池，在电池过热前送走五辆车。快换更快，但更耗电、更热；慢充更稳，却会拉长队列。",
    rules: ["2 工位", "4 电池", "热限 84°C", "目标 5 辆"],
    primaryLabel: "进入站台",
    onPrimary: startShift,
  });
}

function showPauseModal() {
  setModal({
    kicker: "SHIFT CONTROL / HOLD",
    title: "班次暂停。",
    copy: "车辆耐心、工位倒计时、电池温度和机械臂作业均已冻结。",
    rules: ["全部计时冻结", "可重新规划电池"],
    primaryLabel: "继续作业",
    onPrimary: resumeShift,
    secondaryLabel: "重新开始",
    onSecondary: restartShift,
  });
}

function showOutcomeModal(event) {
  if (event.type === "win") {
    setModal({
      kicker: "SHIFT COMPLETE / ZERO THERMAL EVENTS",
      title: "五车离站，热限守住。",
      copy: `你在 ${formatTime(event.elapsed)} 内完成高峰交付，没有出现电池过热。队列调度与温度管理均达标。`,
      rules: [`交付 ${event.served} 辆`, `用时 ${formatTime(event.elapsed)}`, "热失控 0 次"],
      primaryLabel: "再跑一班",
      onPrimary: restartShift,
      secondaryLabel: "留在站台",
      onSecondary: hideModal,
      tone: "success",
    });
    return;
  }

  setModal({
    kicker:
      event.reason === "overheat"
        ? "SHIFT FAILED / THERMAL EVENT"
        : "SHIFT FAILED / QUEUE ATTRITION",
    title: event.reason === "overheat" ? "热限突破。" : "队列失去目标。",
    copy:
      event.reason === "overheat"
        ? "电池温度达到 84°C，站台强制停机。下次请轮换电池，并在高温警报出现时及时冷却。"
        : "等待超时的车辆太多，剩余可交付车辆已不足五辆。请优先调度耐心较低的车辆。",
    rules: [`已交付 ${event.served} 辆`, `用时 ${formatTime(event.elapsed)}`, "重新调度"],
    primaryLabel: "重试高峰",
    onPrimary: restartShift,
    tone: "danger",
  });
}

function handleEvent(event) {
  if (event.message) {
    setFeed(event.message);
  }

  switch (event.type) {
    case "start":
      break;
    case "arrival":
      sound.arrival();
      break;
    case "dispatch":
      sound.ensure();
      sound.arm(event.mode);
      break;
    case "warning":
      sound.alarm();
      showToast(event.message, true);
      break;
    case "cooling":
      sound.cooling();
      showToast(event.message);
      break;
    case "cooled":
      showToast(event.message);
      break;
    case "delivered":
      sound.delivered();
      break;
    case "left":
      sound.leftQueue();
      showToast(event.message, true);
      break;
    case "reject":
      showToast(event.message, true);
      break;
    case "win":
      sound.win();
      clearOutcomeTimer();
      outcomeTimer = window.setTimeout(() => showOutcomeModal(event), 900);
      break;
    case "overheat":
      sound.overheat();
      clearOutcomeTimer();
      outcomeTimer = window.setTimeout(() => showOutcomeModal(event), 650);
      break;
    case "abandoned":
      sound.leftQueue();
      clearOutcomeTimer();
      outcomeTimer = window.setTimeout(() => showOutcomeModal(event), 650);
      break;
    default:
      break;
  }

  renderUI();
}

const engine = new StationEngine({ onEvent: handleEvent });

renderer = new StationRenderer(document.querySelector("#station-canvas"), engine, {
  getSelectedBattery: () => selectedBatteryId,
  onBatteryClick: (id) => selectBattery(id),
});

function startShift() {
  sound.ensure();
  clearOutcomeTimer();
  hideModal();
  engine.start();
  setFeed("站台开放。选择电池，再派出第一辆车。");
  renderUI(true);
  document.querySelector("#station-canvas").focus?.();
}

function togglePause() {
  if (engine.status === "running") {
    engine.pause();
    showPauseModal();
  } else if (engine.status === "paused") {
    resumeShift();
  }
  renderUI(true);
}

function resumeShift() {
  if (engine.resume()) {
    hideModal();
    setFeed("继续营业。");
  }
  renderUI(true);
}

function restartShift() {
  clearOutcomeTimer();
  hideModal();
  selectedBatteryId = "P3";
  engine.reset();
  engine.start();
  queueSignature = "";
  setFeed("新班次开始。A-01 已抵达，电池库恢复初始状态。");
  showToast("高峰已重置，计时与队列归零。");
  renderUI(true);
}

function buildQueueRows() {
  if (engine.queue.length === 0) {
    elements.queueList.innerHTML =
      '<p class="empty-state">暂无车辆等待 · 留意下一辆驶入站台。</p>';
    return;
  }

  elements.queueList.innerHTML = engine.queue
    .map((car, index) => {
      const swapCost = energyCost("swap", car.demand);
      const chargeCost = energyCost("charge", car.demand);
      return `
        <article class="queue-card" data-car-card="${car.id}">
          <div class="queue-main">
            <span class="queue-order">${String(index + 1).padStart(2, "0")}</span>
            <div class="queue-info">
              <div class="queue-title">
                <strong>${car.id}</strong>
                <span class="queue-tag">需求 ${car.demand}%</span>
              </div>
              <div class="wait-row">
                <span>耐心</span>
                <div class="wait-track"><i></i></div>
                <b class="wait-time">${(car.patience - car.waited).toFixed(1)}s</b>
              </div>
            </div>
            <button class="move-up" type="button" data-move-up="${car.id}"
              aria-label="将 ${car.id} 前移一位" ${index === 0 ? "disabled" : ""}>↑</button>
          </div>
          <div class="action-row">
            <button class="dispatch-button swap" type="button" data-action="swap"
              data-car="${car.id}" title="消耗 ${swapCost}% 电量，快换耗时 ${CONFIG.swapDuration}s">快换 -${swapCost}%</button>
            <button class="dispatch-button charge" type="button" data-action="charge"
              data-car="${car.id}" title="消耗 ${chargeCost}% 电量，慢充耗时 ${CONFIG.chargeDuration}s">慢充 -${chargeCost}%</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function buildBatteryRows() {
  elements.batteryList.innerHTML = engine.batteries
    .map(
      (battery) => `
        <article class="pack-card" data-battery="${battery.id}" role="button" tabindex="0"
          aria-label="选择电池 ${battery.id}">
          <span class="pack-id">${battery.id}</span>
          <div class="pack-data">
            <div class="pack-topline">
              <span>电量</span>
              <strong><span class="pack-charge">${battery.charge.toFixed(0)}</span>%</strong>
            </div>
            <div class="charge-track"><i></i></div>
            <div class="pack-meta">
              <span class="pack-temp">${battery.temp.toFixed(1)}°C</span>
              <span class="pack-state">待命</span>
            </div>
          </div>
          <button class="cool-button" type="button" data-cool="${battery.id}">冷却</button>
        </article>
      `,
    )
    .join("");
  batteryCards = new Map(
    [...elements.batteryList.querySelectorAll(".pack-card")].map((card) => [
      card.dataset.battery,
      card,
    ]),
  );
}

function updateQueueUI() {
  const idleBay = engine.bays.some((bay) => bay.status === "idle");
  const canDispatch = engine.status === "running" && idleBay;
  const selected = engine.batteries.find((battery) => battery.id === selectedBatteryId);

  for (const [index, car] of engine.queue.entries()) {
    const card = elements.queueList.querySelector(`[data-car-card="${car.id}"]`);
    if (!card) continue;
    const ratio = Math.max(0, Math.min(1, car.waited / car.patience));
    card.classList.toggle("is-urgent", ratio > 0.58 && ratio <= 0.82);
    card.classList.toggle("is-critical", ratio > 0.82);
    card.querySelector(".wait-track i").style.transform = `scaleX(${1 - ratio})`;
    card.querySelector(".wait-time").textContent = `${Math.max(0, car.patience - car.waited).toFixed(1)}s`;
    const moveButton = card.querySelector(".move-up");
    moveButton.disabled = index === 0;

    for (const button of card.querySelectorAll(".dispatch-button")) {
      const mode = button.dataset.action;
      const cost = energyCost(mode, car.demand);
      const batteryReady =
        selected && !selected.cooling && selected.inUseBay === null && selected.charge >= cost;
      button.disabled = !canDispatch || !batteryReady;
    }
  }
}

function updateBatteryUI() {
  for (const battery of engine.batteries) {
    const card = batteryCards.get(battery.id);
    if (!card) continue;
    const warning = battery.temp >= CONFIG.warningTemp;
    const hot = battery.temp >= CONFIG.overheatTemp - 8;
    card.classList.toggle("is-selected", battery.id === selectedBatteryId);
    card.classList.toggle("is-warning", warning && !hot);
    card.classList.toggle("is-hot", hot);
    card.setAttribute("aria-pressed", String(battery.id === selectedBatteryId));
    card.querySelector(".pack-charge").textContent = battery.charge.toFixed(0);
    card.querySelector(".charge-track i").style.transform = `scaleX(${battery.charge / 100})`;
    const temp = card.querySelector(".pack-temp");
    temp.textContent = `${battery.temp.toFixed(1)}°C`;
    temp.classList.toggle("is-warning", warning && !hot);
    temp.classList.toggle("is-hot", hot);
    card.querySelector(".pack-state").textContent = battery.cooling
      ? `液冷 ${battery.coolingRemaining.toFixed(1)}s`
      : battery.inUseBay !== null
        ? `工位 0${battery.inUseBay}`
        : warning
          ? "高温"
          : "待命";
    const cool = card.querySelector(".cool-button");
    cool.disabled =
      battery.cooling ||
      battery.inUseBay !== null ||
      battery.temp < 42 ||
      engine.status !== "running";
    cool.textContent = battery.cooling
      ? `冷却 ${battery.coolingRemaining.toFixed(1)}s`
      : battery.inUseBay !== null
        ? "作业中"
        : "冷却";
  }
}

function renderUI(force = false) {
  elements.served.textContent = String(engine.served);
  elements.timer.textContent = formatTime(engine.elapsed);
  elements.queueCount.textContent = `队列 ${engine.queue.length}`;
  elements.selectedPack.textContent = `已选 ${selectedBatteryId}`;
  elements.deliveryPips.forEach((pip, index) => {
    pip.classList.toggle("is-filled", index < engine.served);
  });

  const status = engine.paused
    ? "班次暂停 · 计时冻结"
    : engine.status === "won"
      ? "高峰完成 · 全站安全"
      : engine.status === "lost"
        ? "班次中止 · 热限 / 流失"
        : engine.status === "ready"
          ? "站台待命"
          : engine.bays.some((bay) => bay.status === "service")
            ? `${engine.bays.filter((bay) => bay.status === "service").map((bay) => `${bay.id}号工位${bay.mode === "swap" ? "快换" : "慢充"}`).join(" · ")} · 队列 ${engine.queue.length}`
            : `工位空闲 · 队列 ${engine.queue.length}`;
  elements.status.textContent = status;
  elements.pause.textContent = engine.status === "paused" ? "继续" : "暂停";
  elements.pause.disabled = engine.status === "ready" || engine.status === "won" || engine.status === "lost";
  elements.sound.textContent = sound.muted ? "音频 关" : "音频 开";
  elements.sound.setAttribute("aria-pressed", String(!sound.muted));

  const signature = `${engine.queue.map((car) => car.id).join("|")}::${selectedBatteryId}`;
  if (force || signature !== queueSignature) {
    queueSignature = signature;
    buildQueueRows();
  }
  updateQueueUI();

  if (batteryCards.size !== engine.batteries.length) buildBatteryRows();
  updateBatteryUI();
}

elements.queueList.addEventListener("click", (event) => {
  const moveButton = event.target.closest("[data-move-up]");
  if (moveButton) {
    engine.reorder(moveButton.dataset.moveUp, -1);
    return;
  }

  const dispatchButton = event.target.closest("[data-action]");
  if (!dispatchButton || dispatchButton.disabled) return;
  sound.ensure();
  engine.dispatch(
    dispatchButton.dataset.car,
    dispatchButton.dataset.action,
    selectedBatteryId,
  );
});

elements.batteryList.addEventListener("click", (event) => {
  const coolButton = event.target.closest("[data-cool]");
  if (coolButton) {
    sound.ensure();
    engine.startCooling(coolButton.dataset.cool);
    return;
  }
  const card = event.target.closest("[data-battery]");
  if (card) selectBattery(card.dataset.battery);
});

elements.batteryList.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const card = event.target.closest("[data-battery]");
  if (!card || event.target.closest("[data-cool]")) return;
  event.preventDefault();
  selectBattery(card.dataset.battery);
});

elements.pause.addEventListener("click", () => {
  if (engine.status === "paused") resumeShift();
  else togglePause();
});

elements.sound.addEventListener("click", () => {
  sound.ensure();
  sound.setMuted(!sound.muted);
  renderUI(true);
  showToast(sound.muted ? "音频已关闭。" : "音频已开启：机械臂与警报均为 Web Audio 合成。");
});

document.addEventListener("keydown", (event) => {
  if (event.repeat || event.code !== "Space") return;
  const tag = document.activeElement?.tagName;
  if (tag === "BUTTON" || tag === "INPUT" || tag === "TEXTAREA") return;
  if (elements.modal.classList.contains("is-visible") && engine.status !== "paused") return;
  event.preventDefault();
  togglePause();
});

function debugSnapshot() {
  return {
    ...engine.snapshot(),
    selectedBattery: selectedBatteryId,
    autoTick,
    modalVisible: elements.modal.classList.contains("is-visible"),
    modalTitle: elements.modalTitle.textContent,
    audio: {
      contextCreated: Boolean(sound.context),
      state: sound.context?.state ?? "closed",
      muted: sound.muted,
      stats: { ...sound.stats },
    },
  };
}

window.stationGame = {
  start: startShift,
  pause: togglePause,
  resume: resumeShift,
  restart: restartShift,
  selectBattery,
  dispatch: (carId, mode, batteryId = selectedBatteryId) =>
    engine.dispatch(carId, mode, batteryId),
  cool: (batteryId) => engine.startCooling(batteryId),
  reorder: (carId, direction) => engine.reorder(carId, direction),
  setAutoTick: (enabled) => {
    autoTick = Boolean(enabled);
    return autoTick;
  },
  advance: (seconds) => {
    engine.tick(seconds);
    renderer.render(0.016);
    renderUI(true);
    return debugSnapshot();
  },
  snapshot: debugSnapshot,
  engine,
  sound,
  renderer,
};

function frame(now) {
  const delta = Math.min(0.12, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  if (autoTick) engine.tick(delta);
  renderer.render(delta);
  renderUI();
  requestAnimationFrame(frame);
}

showStartModal();
buildBatteryRows();
renderUI(true);
requestAnimationFrame(frame);
