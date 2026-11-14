import {
  LoomSimulation,
  LOOM_CONFIG,
  normalizeSettings,
  DEFAULT_SETTINGS,
} from "./loom-sim.js";
import { LoomAudio } from "./loom-audio.js";

const $ = (selector) => document.querySelector(selector);

const dom = {
  canvas: $("#loomCanvas"),
  canvasShell: $("#canvasShell"),
  canvasStatus: $("#canvasStatus"),
  canvasAlert: $("#canvasAlert"),
  chipDot: $("#chipDot"),
  cmReadout: $("#cmReadout"),
  machineState: $("#machineState"),
  statusText: $("#statusText"),
  soundToggle: $("#soundToggle"),
  lengthMetric: $("#lengthMetric"),
  defectMetric: $("#defectMetric"),
  tensionMetric: $("#tensionMetric"),
  speedMetric: $("#speedMetric"),
  progressFill: $("#progressFill"),
  lengthTrack: $("#lengthTrack"),
  gaugeNeedle: $("#gaugeNeedle"),
  syncValue: $("#syncValue"),
  windowReading: $("#windowReading"),
  threadReading: $("#threadReading"),
  pickReading: $("#pickReading"),
  rowCounter: $("#rowCounter"),
  eventLog: $("#eventLog"),
  openingRange: $("#openingRange"),
  openingOutput: $("#openingOutput"),
  openingHint: $("#openingHint"),
  tensionRange: $("#tensionRange"),
  tensionOutput: $("#tensionOutput"),
  tensionHint: $("#tensionHint"),
  speedRange: $("#speedRange"),
  speedOutput: $("#speedOutput"),
  speedHint: $("#speedHint"),
  runButton: $("#runButton"),
  runLabel: $("#runLabel"),
  resetButton: $("#resetButton"),
  resultDialog: $("#resultDialog"),
  resultSeal: $("#resultSeal"),
  resultEyebrow: $("#resultEyebrow"),
  resultTitle: $("#resultTitle"),
  resultCopy: $("#resultCopy"),
  resultLength: $("#resultLength"),
  resultDefects: $("#resultDefects"),
  resultGrade: $("#resultGrade"),
  weaveAgainButton: $("#weaveAgainButton"),
  closeResultButton: $("#closeResultButton"),
  toastHost: $("#toastHost"),
};

const STATUS_LABELS = {
  idle: "机台待机",
  running: "正在织造",
  paused: "织造暂停",
  broken: "纬线断裂",
  failed: "瑕疵超限",
  complete: "布面完成",
};

const RUN_LABELS = {
  idle: "落梭开织",
  running: "暂停织造",
  paused: "继续织造",
  broken: "重新上机",
  failed: "重新上机",
  complete: "再织一匹",
};

const audio = new LoomAudio();
let simulation = createSimulation();
let lastFrame = performance.now();
let lastRows = 0;
let lastStatus = simulation.status;
let activePickKey = null;
let lastRunMode = "";
let alertTimer = 0;
let resultTimer = 0;
let canvasSize = { width: 0, height: 0, dpr: 1 };

function createSimulation() {
  return new LoomSimulation({ seed: 220 });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function signed(value, digits = 1) {
  if (Math.abs(value) < 0.05) return (0).toFixed(digits);
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}`;
}

function timingOffset(opening = simulation.settings.opening) {
  return (opening - LOOM_CONFIG.idealOpening) * 0.24;
}

function nowLabel() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function addLog(message, tone = "") {
  const item = document.createElement("li");
  if (tone) item.className = tone;
  const time = document.createElement("time");
  time.textContent = nowLabel();
  const copy = document.createElement("span");
  copy.textContent = message;
  item.append(time, copy);
  dom.eventLog.prepend(item);
  while (dom.eventLog.children.length > 5) {
    dom.eventLog.lastElementChild.remove();
  }
}

function toast(message, tone = "") {
  const item = document.createElement("div");
  item.className = `toast ${tone}`.trim();
  item.textContent = message;
  dom.toastHost.append(item);
  while (dom.toastHost.children.length > 3) {
    dom.toastHost.firstElementChild.remove();
  }
  window.setTimeout(() => {
    item.classList.add("leaving");
    window.setTimeout(() => item.remove(), 220);
  }, 2400);
}

function showCanvasAlert(message, danger = false, duration = 2100) {
  window.clearTimeout(alertTimer);
  dom.canvasAlert.textContent = message;
  dom.canvasAlert.classList.toggle("danger", danger);
  dom.canvasAlert.classList.add("show");
  alertTimer = window.setTimeout(() => {
    dom.canvasAlert.classList.remove("show");
  }, duration);
}

function syncControlsFromSimulation() {
  const settings = simulation.settings;
  dom.openingRange.value = String(settings.opening);
  dom.tensionRange.value = String(settings.tension);
  dom.speedRange.value = String(settings.speed);
  refreshControlHints();
}

function refreshControlHints(snapshot = simulation.getSnapshot()) {
  const settings = snapshot.settings;
  const phaseError = snapshot.syncError * 0.24;
  const absolutePhase = Math.abs(snapshot.syncError);
  const safeTiming = absolutePhase <= LOOM_CONFIG.openingTolerance;
  const tension = settings.tension;
  const speed = settings.speed;

  dom.openingOutput.textContent = `${signed(phaseError)} ms`;
  dom.openingOutput.style.color = safeTiming ? "var(--moss-bright)" : "#e7a184";
  dom.openingHint.textContent = safeTiming
    ? "双综同步，开口干净利落"
    : `双综相差 ${Math.abs(phaseError).toFixed(1)} ms，布面正在起斜纹`;
  dom.openingHint.className = `control-hint ${safeTiming ? "safe" : "warn"}`;

  dom.tensionOutput.textContent = `${tension.toFixed(2)} N`;
  const tensionTone =
    tension < LOOM_CONFIG.tensionSafeMin
      ? "纬线松弛，容易漏织或浮线"
      : tension >= LOOM_CONFIG.tensionSafeMax
        ? tension >= LOOM_CONFIG.tensionBreakAt
          ? "超过断线点，落梭前必须回调"
          : "张力临界，再紧就会断经"
        : "张力稳定，纬线贴合经纱";
  dom.tensionHint.textContent = tensionTone;
  dom.tensionHint.className = `control-hint ${
    tension < LOOM_CONFIG.tensionSafeMin ||
    tension >= LOOM_CONFIG.tensionSafeMax
      ? "warn"
      : "safe"
  }`;

  dom.speedOutput.textContent = `${speed.toFixed(1)} 次/s`;
  const speedTone =
    speed >= LOOM_CONFIG.speedMisalignAt
      ? "梭子过快，落点即将错位"
      : speed > LOOM_CONFIG.speedSafeMax
        ? "速度偏快，开口时间正在被压缩"
        : "落梭节奏平稳，开口时间充足";
  dom.speedHint.textContent = speedTone;
  dom.speedHint.className = `control-hint ${
    speed > LOOM_CONFIG.speedSafeMax ? "warn" : "safe"
  }`;
}

async function toggleRun() {
  await audio.wake();

  if (
    simulation.status === "broken" ||
    simulation.status === "failed" ||
    simulation.status === "complete"
  ) {
    resetLoom({ keepSettings: true, announce: false });
  }

  if (simulation.status === "running") {
    simulation.pause();
  } else {
    if (simulation.status === "idle") {
      dom.eventLog.replaceChildren();
      addLog("双综就位，第一梭出发", "good");
    }
    simulation.start();
  }
  activePickKey = null;
  lastStatus = simulation.status;
  refreshUi(simulation.getSnapshot());
}

function resetLoom({ keepSettings = false, announce = true } = {}) {
  const preserved = keepSettings ? { ...simulation.settings } : null;
  simulation = createSimulation();
  if (preserved) simulation.setSettings(preserved);
  window.clearTimeout(resultTimer);
  if (dom.resultDialog.open) dom.resultDialog.close();
  lastRows = 0;
  lastStatus = simulation.status;
  activePickKey = null;
  lastRunMode = "";
  dom.eventLog.replaceChildren();
  dom.toastHost.replaceChildren();
  addLog(
    preserved ? "机台复位，保留上次校准" : "机台复位，双综等待校准",
    "muted",
  );
  dom.canvasAlert.classList.remove("show", "danger");
  syncControlsFromSimulation();
  refreshUi(simulation.getSnapshot());
  if (announce) toast("织机已复位，校准后可重新开织");
}

function showResult(status) {
  const snapshot = simulation.getSnapshot();
  const broken = status === "broken";
  const failed = status === "failed";
  dom.resultSeal.className = `result-seal${broken || failed ? " failure" : ""}`;

  if (broken) {
    const breakage = snapshot.breakages[0];
    dom.resultEyebrow.textContent = "THREAD BROKEN";
    dom.resultTitle.textContent = "纬线断了，别急着抽梭。";
    dom.resultCopy.textContent = `第 ${breakage?.row + 1 || 0} 梭时纬线张力达到 ${breakage?.tension.toFixed(2)} N，纬线在布面中段断头。先把张力降回 1.8 N 附近，再重新起机。`;
    dom.resultGrade.textContent = "断线";
  } else if (failed) {
    dom.resultEyebrow.textContent = "DEFECT LIMIT";
    dom.resultTitle.textContent = "瑕疵超限，布面停织。";
    dom.resultCopy.textContent =
      "斜纹和错位已经超过验收线。把开口差值收进绿色窗口、梭速压回 4.2 次/秒以内，再试一匹。";
    dom.resultGrade.textContent = "返工";
  } else {
    const grade =
      snapshot.defects === 0 ? "甲等" : snapshot.defects <= 2 ? "乙等" : "丙等";
    dom.resultEyebrow.textContent = "WEAVE COMPLETE";
    dom.resultTitle.textContent = "十厘米，完整落机。";
    dom.resultCopy.textContent =
      snapshot.defects === 0
        ? "三十梭一气呵成，没有断线，也没有漏织。布面平整，双综落点干净。"
        : `三十梭顺利走完，留下 ${snapshot.defects} 处可辨识瑕疵，仍在验收范围内。`;
    dom.resultGrade.textContent = grade;
  }

  dom.resultLength.textContent = `${snapshot.progressCm.toFixed(1)} cm`;
  dom.resultDefects.textContent =
    status === "complete" ? String(snapshot.defects) : `${snapshot.defects} / 超限`;
  dom.weaveAgainButton.textContent =
    status === "complete" ? "再织一匹" : "重新上机";

  if (!dom.resultDialog.open) dom.resultDialog.showModal();
}

function announceStatusChange(nextStatus) {
  const snapshot = simulation.getSnapshot();
  if (nextStatus === "paused") {
    addLog(`机台暂停在第 ${snapshot.rowsDone + 1} 梭`, "muted");
    showCanvasAlert("机台暂停 · 调整参数后继续");
  }

  if (nextStatus === "broken") {
    const tension = snapshot.breakages[0]?.tension ?? snapshot.settings.tension;
    addLog("纬线断头，织造中止", "warn");
    toast(`断线：张力 ${tension.toFixed(2)} N 超过纬线承受范围`, "danger");
    showCanvasAlert("纬线绷断 · 张力必须回调", true, 4200);
    audio.breakThread();
    window.clearTimeout(resultTimer);
    resultTimer = window.setTimeout(() => showResult("broken"), 650);
  }

  if (nextStatus === "failed") {
    addLog("瑕疵达到 6 处，布面停织", "warn");
    toast("瑕疵超限：布面没有达到验收标准", "danger");
    showCanvasAlert("瑕疵超限 · 检查开口与梭速", true, 4200);
    window.clearTimeout(resultTimer);
    resultTimer = window.setTimeout(() => showResult("failed"), 650);
  }

  if (nextStatus === "complete") {
    addLog(
      snapshot.success
        ? `十厘米完成，保留 ${snapshot.defects} 处瑕疵`
        : "织造结束，未通过验收",
      snapshot.success ? "good" : "warn",
    );
    if (snapshot.success) {
      toast("十厘米完整落机，验收通过", "good");
      audio.complete();
    }
    window.clearTimeout(resultTimer);
    resultTimer = window.setTimeout(() => showResult("complete"), 700);
  }
}

function handleSimulationEvents(snapshot) {
  if (snapshot.rowsDone > lastRows) {
    const row = snapshot.rows[snapshot.rows.length - 1];
    if (row?.defectKinds.includes("diagonal")) {
      addLog(`第 ${row.index + 1} 梭起斜纹，双综相差 ${(row.syncError * 0.24).toFixed(1)} ms`, "warn");
      toast("布面出现斜纹：开口时机没有对齐", "danger");
      showCanvasAlert("斜纹瑕疵 · 双综相位偏移", true);
      audio.defect();
    } else if (row?.defectKinds.includes("missed")) {
      addLog(`第 ${row.index + 1} 梭漏织，纬线张力过松`, "warn");
      toast("发现漏织：张力过松，纬线没有贴紧", "danger");
      showCanvasAlert("漏织瑕疵 · 回收纬线张力", true);
      audio.defect();
    } else if (row?.defectKinds.includes("misaligned")) {
      addLog(`第 ${row.index + 1} 梭错位，梭速超过安全值`, "warn");
      toast("落梭错位：梭子速度过快", "danger");
      showCanvasAlert("错位瑕疵 · 降低梭速", true);
      audio.defect();
    } else if (row && (row.index + 1) % 5 === 0) {
      addLog(`第 ${row.index + 1} 梭落点准确，布面平整`, "good");
    }
    lastRows = snapshot.rowsDone;
  }

  if (snapshot.active) {
    const key = `${snapshot.active.rowIndex}-${snapshot.active.direction}`;
    if (key !== activePickKey) {
      activePickKey = key;
      if (snapshot.status === "running") {
        audio.click(snapshot.active.direction);
      }
    }
  } else if (snapshot.status !== "running") {
    activePickKey = null;
  }

  if (snapshot.status !== lastStatus) {
    const previous = lastStatus;
    lastStatus = snapshot.status;
    if (previous === "idle" && snapshot.status === "running") {
      showCanvasAlert("织机启动 · 双综交替开口");
    }
    announceStatusChange(snapshot.status);
  }
}

function refreshUi(snapshot) {
  const status = snapshot.status;
  const statusLabel = STATUS_LABELS[status];
  const active = snapshot.active;
  const phaseMs = snapshot.syncError * 0.24;
  const absolutePhase = Math.abs(snapshot.syncError);
  const timingSafe = absolutePhase <= LOOM_CONFIG.openingTolerance;
  const tension = active?.tension ?? snapshot.settings.tension;
  const speed = active?.speed ?? snapshot.settings.speed;
  const needleAngle = clamp(snapshot.syncError / 31, -1, 1) * 62;

  dom.machineState.className = `machine-state ${status}`;
  dom.statusText.textContent = statusLabel;
  dom.canvasStatus.textContent =
    status === "running" && active
      ? `第 ${active.rowIndex + 1} 梭 · ${active.direction === "right" ? "向右" : "向左"}落梭`
      : statusLabel;
  dom.cmReadout.textContent = snapshot.progressCm.toFixed(1);
  dom.lengthMetric.textContent = snapshot.progressCm.toFixed(1);
  dom.defectMetric.textContent = String(snapshot.defects);
  dom.defectMetric.parentElement.classList.toggle("risk", snapshot.defects > 0);
  dom.tensionMetric.textContent = tension.toFixed(2);
  dom.tensionMetric.parentElement.classList.toggle(
    "risk",
    tension >= LOOM_CONFIG.tensionSafeMax || tension < LOOM_CONFIG.tensionSafeMin,
  );
  dom.speedMetric.textContent = speed.toFixed(1);
  dom.speedMetric.parentElement.classList.toggle(
    "risk",
    speed > LOOM_CONFIG.speedSafeMax,
  );
  dom.progressFill.style.width = `${(snapshot.progressCm / LOOM_CONFIG.lengthCm) * 100}%`;
  dom.lengthTrack.setAttribute("aria-valuenow", snapshot.progressCm.toFixed(1));
  dom.rowCounter.textContent = String(snapshot.rowsDone).padStart(2, "0");

  dom.syncValue.textContent = signed(phaseMs);
  dom.gaugeNeedle.style.transform = `translateX(-50%) rotate(${needleAngle}deg)`;
  dom.gaugeNeedle.classList.toggle("safe", timingSafe);
  dom.windowReading.textContent = timingSafe
    ? "同步良好"
    : `偏移 ${signed(phaseMs)} ms`;
  dom.windowReading.className = timingSafe ? "safe" : "warn";

  const threadTone =
    tension < LOOM_CONFIG.tensionSafeMin
      ? "纬线松弛"
      : tension >= LOOM_CONFIG.tensionBreakAt
        ? "即将断线"
        : tension >= LOOM_CONFIG.tensionSafeMax
          ? "张力临界"
          : "张力正常";
  dom.threadReading.textContent = threadTone;
  dom.threadReading.className =
    threadTone === "张力正常" ? "safe" : "warn";

  if (status === "running") {
    dom.pickReading.textContent = timingSafe ? "落点同步" : "落点偏移";
  } else if (status === "complete") {
    dom.pickReading.textContent = "30 梭完成";
  } else if (status === "broken") {
    dom.pickReading.textContent = "落梭中止";
  } else if (status === "failed") {
    dom.pickReading.textContent = "验收失败";
  } else if (status === "paused") {
    dom.pickReading.textContent = "节奏暂停";
  } else {
    dom.pickReading.textContent = "等待启动";
  }
  dom.pickReading.className =
    status === "running" && !timingSafe ? "warn" : "safe";

  refreshControlHints(snapshot);
  updateRunButton(status);
}

function updateRunButton(status) {
  if (lastRunMode !== status) {
    lastRunMode = status;
    dom.runLabel.textContent = RUN_LABELS[status];
    const icon = dom.runButton.querySelector(".button-icon");
    icon.innerHTML =
      status === "running"
        ? '<svg viewBox="0 0 24 24"><path d="M8 5h3v14H8V5Zm5 0h3v14h-3V5Z"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7V5Z"/></svg>';
  }
  dom.runButton.classList.toggle("running", status === "running");
  dom.runButton.setAttribute(
    "aria-label",
    status === "running" ? "暂停织造" : RUN_LABELS[status],
  );
}

function resizeCanvas() {
  const rect = dom.canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (
    canvasSize.width !== width ||
    canvasSize.height !== height ||
    canvasSize.dpr !== dpr
  ) {
    dom.canvas.width = width;
    dom.canvas.height = height;
    canvasSize = { width, height, dpr };
  }
  return {
    ctx: dom.canvas.getContext("2d"),
    width: rect.width,
    height: rect.height,
  };
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawLoomFrame(ctx, layout) {
  const { fabricX, fabricY, fabricW, fabricH, rulerX, top } = layout;
  ctx.save();

  ctx.strokeStyle = "rgba(203, 169, 107, 0.42)";
  ctx.lineWidth = 1;
  roundedRect(ctx, fabricX - 8, fabricY - 7, fabricW + 16, fabricH + 14, 5);
  ctx.stroke();

  ctx.strokeStyle = "rgba(203, 169, 107, 0.65)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(fabricX - 12, fabricY - 13);
  ctx.lineTo(fabricX + fabricW + 12, fabricY - 13);
  ctx.moveTo(fabricX - 12, fabricY + fabricH + 12);
  ctx.lineTo(fabricX + fabricW + 12, fabricY + fabricH + 12);
  ctx.stroke();

  for (const x of [fabricX - 12, fabricX + fabricW + 12]) {
    for (const y of [fabricY - 13, fabricY + fabricH + 12]) {
      ctx.fillStyle = "#b9955b";
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(8, 25, 20, 0.7)";
      ctx.beginPath();
      ctx.arc(x, y, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.fillStyle = "rgba(244, 236, 216, 0.21)";
  ctx.font = "8px 'DM Mono', monospace";
  ctx.textAlign = "left";
  ctx.fillText("WARP / 48", fabricX, top + 5);
  ctx.textAlign = "right";
  ctx.fillText("双综平织 · 30 PICKS", fabricX + fabricW, top + 5);

  ctx.strokeStyle = "rgba(244, 236, 216, 0.22)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(rulerX + 27, fabricY);
  ctx.lineTo(rulerX + 27, fabricY + fabricH);
  ctx.stroke();

  const rowHeight = fabricH / simulation.totalRows;
  for (let cm = 0; cm <= LOOM_CONFIG.lengthCm; cm += 1) {
    const y = fabricY + (cm / LOOM_CONFIG.lengthCm) * fabricH;
    const major = cm % 2 === 0;
    ctx.strokeStyle = major
      ? "rgba(244, 236, 216, 0.4)"
      : "rgba(244, 236, 216, 0.18)";
    ctx.beginPath();
    ctx.moveTo(rulerX + (major ? 18 : 22), y);
    ctx.lineTo(rulerX + 27, y);
    ctx.stroke();
    if (major) {
      ctx.fillStyle = "rgba(244, 236, 216, 0.52)";
      ctx.font = "7px 'DM Mono', monospace";
      ctx.textAlign = "right";
      ctx.fillText(String(cm), rulerX + 13, y + 2.5);
    }
  }

  ctx.fillStyle = "rgba(244, 236, 216, 0.3)";
  ctx.font = "7px 'DM Mono', monospace";
  ctx.textAlign = "right";
  ctx.fillText("CM", rulerX + 13, fabricY - 7);

  if (rowHeight > 7) {
    ctx.strokeStyle = "rgba(244, 236, 216, 0.06)";
    for (let row = 1; row < simulation.totalRows; row += 1) {
      const y = fabricY + row * rowHeight;
      ctx.beginPath();
      ctx.moveTo(rulerX + 28, y);
      ctx.lineTo(fabricX + 5, y);
      ctx.stroke();
    }
  }

  drawHeddleBars(ctx, layout, simulation.getSnapshot());
  ctx.restore();
}

function drawHeddleBars(ctx, layout, snapshot) {
  const { fabricX, fabricW, fabricY } = layout;
  const offset = clamp(snapshot.syncError, -24, 24) * 0.28;
  const barY = fabricY - 24;

  ctx.strokeStyle = "rgba(203, 169, 107, 0.42)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(fabricX + 8, barY - 6 + offset);
  ctx.lineTo(fabricX + fabricW - 8, barY - 6 + offset);
  ctx.stroke();
  ctx.strokeStyle = "rgba(195, 101, 69, 0.5)";
  ctx.beginPath();
  ctx.moveTo(fabricX + 8, barY + 2 - offset);
  ctx.lineTo(fabricX + fabricW - 8, barY + 2 - offset);
  ctx.stroke();

  ctx.fillStyle = "rgba(244, 236, 216, 0.28)";
  ctx.font = "6px 'DM Mono', monospace";
  ctx.textAlign = "left";
  ctx.fillText("A", fabricX - 25, barY - 4 + offset);
  ctx.fillStyle = "rgba(195, 101, 69, 0.75)";
  ctx.fillText("B", fabricX - 25, barY + 4 - offset);
}

function drawWarpThreads(ctx, layout, snapshot) {
  const { fabricX, fabricY, fabricW, fabricH } = layout;
  const count = 48;
  const gap = fabricW / count;
  const tension = snapshot.active?.tension ?? snapshot.settings.tension;
  const sag = clamp((2.35 - tension) * 1.25, 0, 2.1);
  const tight = tension >= LOOM_CONFIG.tensionSafeMax;

  for (let thread = 0; thread < count; thread += 1) {
    const x = fabricX + gap * (thread + 0.5);
    ctx.strokeStyle = tight
      ? "rgba(244, 236, 216, 0.26)"
      : "rgba(236, 219, 189, 0.2)";
    ctx.lineWidth = tight ? 0.9 : 0.7;
    ctx.beginPath();
    for (let step = 0; step <= 20; step += 1) {
      const t = step / 20;
      const y = fabricY + t * fabricH;
      const wobble =
        Math.sin(t * Math.PI * 2.7 + thread * 0.4) * sag +
        Math.sin(t * 9.4 + thread * 0.11) * sag * 0.35;
      if (step === 0) ctx.moveTo(x + wobble, y);
      else ctx.lineTo(x + wobble, y);
    }
    ctx.stroke();
  }
}

function drawWeftRow(ctx, layout, row, y, widthScale = 1, startSide = "left") {
  const { fabricX, fabricW } = layout;
  const rowHeight = layout.fabricH / simulation.totalRows;
  const thickness = clamp(rowHeight * 0.52, 1.7, 4.5);
  const startX = fabricX + 2;
  const endX = fabricX + fabricW - 2;
  const hasDiagonal = row.defectKinds.includes("diagonal");
  const hasMisalign = row.defectKinds.includes("misaligned");
  const span = endX - startX;
  const slope = hasDiagonal ? row.slant * rowHeight * 1.9 : row.slant * 1.2;
  const startOffset = hasMisalign ? (row.index % 2 ? -3 : 3) : 0;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(57, 38, 27, 0.35)";
  ctx.lineWidth = thickness + 1.4;
  ctx.beginPath();
  const left =
    startSide === "right"
      ? Math.max(startX, startX + startOffset)
      : endX - span * widthScale;
  const right =
    startSide === "right"
      ? Math.min(endX, left + span * widthScale)
      : endX;
  ctx.moveTo(left, y + 1.2);
  ctx.lineTo(right, y + slope + 1.2);
  ctx.stroke();

  ctx.strokeStyle = row.color;
  ctx.lineWidth = thickness;
  ctx.beginPath();
  if (row.missed) {
    const gapStart = left + span * 0.33;
    const gapEnd = left + span * 0.6;
    ctx.moveTo(left, y);
    ctx.lineTo(gapStart, y + slope * 0.33);
    ctx.moveTo(gapEnd, y + slope * 0.6);
    ctx.lineTo(right, y + slope);
  } else {
    ctx.moveTo(left, y);
    ctx.lineTo(right, y + slope);
  }
  ctx.stroke();

  ctx.globalAlpha = 0.32;
  ctx.strokeStyle = "#f6e7c5";
  ctx.lineWidth = Math.max(0.5, thickness * 0.27);
  ctx.beginPath();
  ctx.moveTo(left + 2, y - 1);
  ctx.lineTo(right, y + slope - 1);
  ctx.stroke();

  if (hasDiagonal || hasMisalign || row.missed) {
    const markerX = endX - 4;
    const markerY = y + slope;
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#bb4c33";
    ctx.beginPath();
    ctx.moveTo(markerX, markerY - 3.4);
    ctx.lineTo(markerX + 3.2, markerY + 2.5);
    ctx.lineTo(markerX - 3.2, markerY + 2.5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawFabric(ctx, layout, snapshot) {
  const { fabricX, fabricY, fabricW, fabricH } = layout;
  const rowHeight = fabricH / simulation.totalRows;
  const completedHeight =
    (snapshot.rowsDone / simulation.totalRows) * fabricH;

  ctx.save();
  ctx.beginPath();
  ctx.rect(fabricX, fabricY, fabricW, fabricH);
  ctx.clip();

  const clothGradient = ctx.createLinearGradient(
    0,
    fabricY,
    0,
    fabricY + fabricH,
  );
  clothGradient.addColorStop(0, "#bda777");
  clothGradient.addColorStop(0.55, "#cbb488");
  clothGradient.addColorStop(1, "#ad9166");
  ctx.fillStyle = clothGradient;
  ctx.fillRect(
    fabricX,
    fabricY,
    fabricW,
    Math.max(completedHeight, 1),
  );

  if (completedHeight > 1) {
    ctx.fillStyle = "rgba(80, 52, 32, 0.09)";
    for (let row = 0; row < snapshot.rowsDone; row += 2) {
      ctx.fillRect(
        fabricX,
        fabricY + row * rowHeight,
        fabricW,
        Math.max(0.7, rowHeight * 0.14),
      );
    }
  }

  drawWarpThreads(ctx, layout, snapshot);

  for (const row of snapshot.rows) {
    const y = fabricY + (row.index + 0.52) * rowHeight;
    drawWeftRow(ctx, layout, row, y);
  }

  if (snapshot.active) {
    const active = snapshot.active;
    const y = fabricY + (active.rowIndex + 0.52) * rowHeight;
    const widthScale = clamp(active.progress, 0.001, 1);
    drawWeftRow(
      ctx,
      layout,
      {
        ...active,
        missed: false,
        defectKinds: active.defectKinds,
      },
      y,
      widthScale,
      active.direction,
    );

    const shuttleX =
      active.direction === "right"
        ? fabricX + active.progress * fabricW
        : fabricX + fabricW - active.progress * fabricW;
    drawShuttle(
      ctx,
      shuttleX,
      y - 0.5,
      active.direction,
      active.progress,
      clamp(fabricW / 650, 0.72, 1.15),
    );
  }
  ctx.restore();
}

function drawShuttle(ctx, x, y, direction, progress, scale = 1) {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, 24 * scale);
  glow.addColorStop(0, "rgba(244, 214, 150, 0.24)");
  glow.addColorStop(1, "rgba(244, 214, 150, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, 24 * scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(direction === "right" ? scale : -scale, scale);
  ctx.transform(1, direction === "right" ? -0.05 : 0.05, 0, 1, 0, 0);
  const body = ctx.createLinearGradient(-14, -5, 16, 6);
  body.addColorStop(0, "#9e7443");
  body.addColorStop(0.5, "#e4c78e");
  body.addColorStop(1, "#f0dbaa");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-16, 0);
  ctx.quadraticCurveTo(-10, -6, 5, -5);
  ctx.quadraticCurveTo(16, -4, 19, 0);
  ctx.quadraticCurveTo(16, 4, 5, 5);
  ctx.quadraticCurveTo(-10, 6, -16, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(70, 47, 27, 0.68)";
  ctx.lineWidth = 0.9;
  ctx.stroke();

  ctx.fillStyle = "rgba(69, 41, 20, 0.54)";
  ctx.beginPath();
  ctx.ellipse(-3, 0, 2.1, 2.7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 242, 213, 0.45)";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(-12, -2.5);
  ctx.quadraticCurveTo(1, -5.5, 13, -1.8);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = "rgba(244, 214, 150, 0.28)";
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  ctx.beginPath();
  const trail = direction === "right" ? -28 : 28;
  ctx.moveTo(x + trail * progress, y);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawBrokenWeft(ctx, layout, snapshot) {
  if (snapshot.status !== "broken" || !snapshot.breakages.length) return;
  const breakage = snapshot.breakages[0];
  const { fabricX, fabricY, fabricW, fabricH } = layout;
  const x = fabricX + ((breakage.position + 0.5) / 48) * fabricW;
  const rowHeight = fabricH / simulation.totalRows;
  const y = fabricY + (breakage.row + 0.52) * rowHeight;
  const pulse = 0.5 + Math.sin(Date.now() * 0.006) * 0.18;

  ctx.save();
  ctx.strokeStyle = "rgba(238, 217, 182, 0.88)";
  ctx.lineWidth = clamp(rowHeight * 0.48, 1.8, 4.4);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(fabricX + 2, y);
  ctx.lineTo(x - 4, y - 1);
  ctx.stroke();

  ctx.strokeStyle = "rgba(203, 186, 153, 0.28)";
  ctx.lineWidth = 0.8;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(x + 7, y);
  ctx.lineTo(fabricX + fabricW - 3, y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = `rgba(198, 67, 47, ${pulse})`;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x - 4, y - 1);
  ctx.bezierCurveTo(x - 10, y - 9, x - 5, y - 11, x - 13, y - 13);
  ctx.moveTo(x - 4, y - 1);
  ctx.bezierCurveTo(x + 1, y + 5, x - 3, y + 10, x + 3, y + 13);
  ctx.stroke();

  ctx.fillStyle = `rgba(198, 67, 47, ${pulse})`;
  ctx.beginPath();
  ctx.arc(x - 4, y - 1, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 195, 165, 0.24)";
  ctx.beginPath();
  ctx.arc(x - 4, y - 1, 8.5, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 213, 192, 0.82)";
  ctx.font = "7px 'DM Mono', monospace";
  ctx.textAlign = "left";
  ctx.fillText("WEFT BREAK", Math.min(x + 8, fabricX + fabricW - 60), y - 10);
  ctx.restore();
}

function drawCanvasFooter(ctx, layout, snapshot) {
  const { width, height, fabricX, fabricW } = layout;
  const tension = snapshot.active?.tension ?? snapshot.settings.tension;
  const y = height - 12;
  const barX = fabricX + 62;
  const barWidth = Math.min(92, fabricW * 0.28);
  const tensionRatio = clamp(
    (tension - LOOM_CONFIG.minTension) /
      (LOOM_CONFIG.maxTension - LOOM_CONFIG.minTension),
    0,
    1,
  );
  const danger = tension >= LOOM_CONFIG.tensionSafeMax;

  ctx.save();
  ctx.font = "7px 'DM Mono', monospace";
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(244, 236, 216, 0.38)";
  ctx.fillText("WEFT TENSION", fabricX, y + 2.5);
  ctx.fillStyle = "rgba(244, 236, 216, 0.13)";
  roundedRect(ctx, barX, y - 2, barWidth, 3.5, 2);
  ctx.fill();
  ctx.fillStyle = danger ? "#c36545" : "#a8bd8b";
  roundedRect(ctx, barX, y - 2, Math.max(3, barWidth * tensionRatio), 3.5, 2);
  ctx.fill();
  ctx.fillStyle = danger ? "rgba(237, 160, 132, 0.9)" : "rgba(244, 236, 216, 0.52)";
  ctx.fillText(`${tension.toFixed(2)} N`, barX + barWidth + 7, y + 2.5);

  const active = snapshot.active;
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(244, 236, 216, 0.32)";
  if (active) {
    ctx.fillText(
      `SHUTTLE ${active.direction === "right" ? "→" : "←"} ${Math.round(active.progress * 100)
        .toString()
        .padStart(3, "0")}%`,
      fabricX + fabricW,
      y + 2.5,
    );
  } else {
    ctx.fillText(
      `${snapshot.rowsDone.toString().padStart(2, "0")} / 30 PICKS · ${width > 520 ? "DOUBLE HEDDLE" : "LOOM 02"}`,
      fabricX + fabricW,
      y + 2.5,
    );
  }
  ctx.restore();
}

function drawCanvasBackground(ctx, width, height) {
  const background = ctx.createRadialGradient(
    width * 0.48,
    height * 0.42,
    10,
    width * 0.5,
    height * 0.5,
    width * 0.75,
  );
  background.addColorStop(0, "#18372e");
  background.addColorStop(0.62, "#112b24");
  background.addColorStop(1, "#0b211b");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(244, 236, 216, 0.025)";
  ctx.lineWidth = 1;
  for (let x = 12; x < width; x += 18) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + height * 0.08, height);
    ctx.stroke();
  }
}

function renderCanvas(timestamp) {
  const { ctx, width, height } = resizeCanvas();
  if (!ctx) return;
  const { dpr } = canvasSize;
  const snapshot = simulation.getSnapshot();

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  drawCanvasBackground(ctx, width, height);

  const compact = width < 520;
  const top = compact ? 34 : 46;
  const rulerX = compact ? 9 : 17;
  const fabricX = rulerX + (compact ? 31 : 39);
  const layout = {
    width,
    height,
    top,
    rulerX,
    fabricX,
    fabricY: top,
    fabricW: Math.max(120, width - fabricX - (compact ? 14 : 22)),
    fabricH: Math.max(120, height - top - 27),
  };

  drawLoomFrame(ctx, layout);
  drawFabric(ctx, layout, snapshot);
  drawBrokenWeft(ctx, layout, snapshot);
  drawCanvasFooter(ctx, layout, snapshot);

  if (snapshot.status === "paused") {
    ctx.fillStyle = "rgba(11, 31, 25, 0.34)";
    ctx.fillRect(
      layout.fabricX,
      layout.fabricY,
      layout.fabricW,
      layout.fabricH,
    );
    ctx.fillStyle = "rgba(244, 236, 216, 0.7)";
    ctx.font = "9px 'DM Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText("LOOM PAUSED", width / 2, layout.fabricY + layout.fabricH / 2);
  }

  dom.canvas.dataset.renderTime = String(Math.round(timestamp));
}

function bindControls() {
  dom.openingRange.addEventListener("input", (event) => {
    simulation.setSettings({ opening: Number(event.target.value) });
    const snapshot = simulation.getSnapshot();
    refreshControlHints(snapshot);
    refreshUi(snapshot);
  });

  dom.tensionRange.addEventListener("input", (event) => {
    simulation.setSettings({ tension: Number(event.target.value) });
    const snapshot = simulation.getSnapshot();
    refreshControlHints(snapshot);
    refreshUi(snapshot);
  });

  dom.speedRange.addEventListener("input", (event) => {
    simulation.setSettings({ speed: Number(event.target.value) });
    const snapshot = simulation.getSnapshot();
    refreshControlHints(snapshot);
    refreshUi(snapshot);
  });

  dom.runButton.addEventListener("click", () => {
    toggleRun().catch((error) => {
      console.error(error);
      toast("音频引擎未能启动，织造仍可继续", "danger");
    });
  });

  dom.resetButton.addEventListener("click", () => {
    resetLoom();
  });

  dom.weaveAgainButton.addEventListener("click", () => {
    resetLoom({ keepSettings: true });
  });

  dom.closeResultButton.addEventListener("click", () => {
    dom.resultDialog.close();
  });

  dom.soundToggle.addEventListener("click", async () => {
    const enabled = !audio.enabled;
    audio.setEnabled(enabled);
    dom.soundToggle.classList.toggle("off", !enabled);
    dom.soundToggle.setAttribute("aria-pressed", String(enabled));
    dom.soundToggle.setAttribute(
      "aria-label",
      enabled ? "关闭织机声音" : "开启织机声音",
    );
    if (enabled) await audio.wake();
    toast(enabled ? "织机声音已开启" : "织机声音已关闭");
  });

  window.addEventListener("keydown", (event) => {
    if (
      event.code === "Space" &&
      !["INPUT", "BUTTON", "TEXTAREA", "SELECT"].includes(
        document.activeElement?.tagName,
      )
    ) {
      event.preventDefault();
      toggleRun().catch(console.error);
    }
  });
}

function frame(timestamp) {
  const delta = Math.min(140, Math.max(0, timestamp - lastFrame));
  lastFrame = timestamp;

  if (simulation.status === "running") {
    simulation.update(delta);
  }

  const snapshot = simulation.getSnapshot();
  handleSimulationEvents(snapshot);
  refreshUi(snapshot);
  audio.update(snapshot.settings.speed, snapshot.status === "running");
  renderCanvas(timestamp);

  window.requestAnimationFrame(frame);
}

syncControlsFromSimulation();
refreshUi(simulation.getSnapshot());
bindControls();
window.requestAnimationFrame(frame);

window.loomGame = {
  getSnapshot: () => simulation.getSnapshot(),
  getAudioState: () => ({
    enabled: audio.enabled,
    state: audio.context?.state ?? "uninitialized",
  }),
  setSettings: (settings) => {
    simulation.setSettings(settings);
    syncControlsFromSimulation();
    refreshUi(simulation.getSnapshot());
  },
  start: () => toggleRun(),
  reset: () => resetLoom({ announce: false }),
  config: LOOM_CONFIG,
  defaults: DEFAULT_SETTINGS,
  normalizeSettings,
};
