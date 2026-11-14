"use strict";

const TARGET = "PRINT CLEANLY";
const TARGET_GLYPHS = Array.from(TARGET).filter((char) => char !== " ");
const PARTS = ["linkage", "hammer", "ribbon"];
const SPEC = {
  linkage: { min: 59, max: 65, label: "连杆张力", symptom: "连击卡字" },
  hammer: { min: 41, max: 47, label: "字锤行程", symptom: "字距错位" },
  ribbon: { min: 69, max: 75, label: "卷轴间隙", symptom: "色带跳动" },
};
const NOTES = {
  linkage: "护盖下积着旧油泥。手册要求连杆保持 59–65 的余隙；松脱时字锤会连击。",
  hammer: "试印偏右 2.3 mm。字锤行程应锁在 41–47；过深会压歪相邻字面。",
  ribbon: "色带在导轨上弹跳。卷轴间隙调到 69–75，红黑带才会稳定经过印点。",
};
const WRONG_GLYPHS = ["#", "&", "%", "@", "?", "X", "B", "4", "8"];

const state = {
  inspected: { linkage: false, hammer: false, ribbon: false },
  settings: { linkage: 18, hammer: 86, ribbon: 32 },
  committed: { linkage: 18, hammer: 86, ribbon: 32 },
  adjustmentsLeft: 9,
  typed: [],
  marks: [],
  faultCount: 0,
  complete: false,
  passed: false,
  round: 0,
  strike: null,
  lastTick: 0,
  carriageKick: 0,
  ribbonAngle: 0,
  paperDrop: 0,
  resolving: false,
};

const els = {
  canvas: document.querySelector("#scene"),
  soundToggle: document.querySelector("#soundToggle"),
  soundLabel: document.querySelector(".sound-label"),
  adjustmentsLeft: document.querySelector("#adjustmentsLeft"),
  adjustmentCounter: document.querySelector("#adjustmentCounter"),
  targetProgress: document.querySelector("#targetProgress"),
  targetProgressBar: document.querySelector("#targetProgressBar"),
  checkedCount: document.querySelector("#checkedCount"),
  machineState: document.querySelector("#machineState"),
  actionHint: document.querySelector("#actionHint"),
  typeButton: document.querySelector("#typeButton"),
  newSheetButton: document.querySelector("#newSheetButton"),
  statusMessage: document.querySelector("#statusMessage"),
  statusbar: document.querySelector(".statusbar"),
  lens: document.querySelector("#inspectionLens"),
  lensTitle: document.querySelector("#lensTitle"),
  lensCopy: document.querySelector("#lensCopy"),
  typeHint: document.querySelector("#typeHint"),
  resultStamp: document.querySelector("#resultStamp"),
  paperTag: document.querySelector("#paperTag"),
};

for (const part of PARTS) {
  els[`${part}Value`] = document.querySelector(`#${part}Value`);
  els[`${part}Status`] = document.querySelector(`#${part}Status`);
  els[`${part}Range`] = document.querySelector(`#${part}Range`);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function inSpec(part) {
  const spec = SPEC[part];
  return state.settings[part] >= spec.min && state.settings[part] <= spec.max;
}

function allInspected() {
  return PARTS.every((part) => state.inspected[part]);
}

function allAligned() {
  return PARTS.every(inSpec);
}

function setStatus(message, tone = "") {
  els.statusMessage.lastElementChild.textContent = message;
  els.statusbar.classList.toggle("is-error", tone === "error");
  els.statusbar.classList.toggle("is-success", tone === "success");
}

class TypewriterAudio {
  constructor() {
    this.context = null;
    this.enabled = true;
    this.master = null;
    this.noiseBuffer = null;
  }

  init() {
    if (this.context) {
      if (this.context.state === "suspended") this.context.resume();
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      this.enabled = false;
      return;
    }
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = 0.36;
    this.master.connect(this.context.destination);
    this.noiseBuffer = this.makeNoise(1);
  }

  makeNoise(seconds) {
    const length = Math.floor(this.context.sampleRate * seconds);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  noise(duration, volume, filterFrequency) {
    if (!this.enabled || !this.context) return;
    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    source.buffer = this.noiseBuffer;
    filter.type = "bandpass";
    filter.frequency.value = filterFrequency;
    filter.Q.value = 0.8;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + duration);
  }

  tone(frequency, duration, volume, type = "sine", delay = 0) {
    if (!this.enabled || !this.context) return;
    const now = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(35, frequency * 0.75), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  keyStrike() {
    this.init();
    this.noise(0.075, 0.7, 1500);
    this.tone(118, 0.1, 0.34, "triangle");
    this.tone(880, 0.045, 0.08, "square", 0.012);
  }

  gear(strong = false) {
    this.init();
    const clicks = strong ? 4 : 1;
    for (let i = 0; i < clicks; i += 1) {
      this.noise(0.026, strong ? 0.23 : 0.1, 2300);
      this.tone(245 + i * 16, 0.028, 0.035, "square", i * 0.035);
    }
  }

  carriageReturn() {
    this.init();
    this.noise(0.24, 0.24, 850);
    this.tone(92, 0.3, 0.2, "sawtooth");
    for (let i = 0; i < 8; i += 1) {
      this.noise(0.025, 0.09, 2700 + i * 80);
      this.tone(180 - i * 5, 0.035, 0.035, "square", 0.11 + i * 0.055);
    }
    this.tone(740, 0.45, 0.07, "sine", 0.62);
  }

  complete() {
    this.init();
    this.tone(523.25, 0.45, 0.08, "sine");
    this.tone(659.25, 0.55, 0.07, "sine", 0.14);
    this.tone(783.99, 0.75, 0.06, "sine", 0.28);
  }
}

const audio = new TypewriterAudio();

function updateSoundButton() {
  els.soundToggle.setAttribute("aria-pressed", String(audio.enabled));
  els.soundLabel.textContent = audio.enabled ? "声音已开启" : "声音已静音";
}

function describeSetting(part) {
  const value = state.settings[part];
  const spec = SPEC[part];
  if (inSpec(part)) return "标定到位";
  if (part === "linkage") return value < spec.min ? "连杆松弛" : "连杆咬死";
  if (part === "hammer") return value < spec.min ? "行程过浅" : "行程过深";
  return value < spec.min ? "色带轻擦" : "色带跳轨";
}

function updateUI() {
  const checked = PARTS.filter((part) => state.inspected[part]).length;
  const aligned = PARTS.filter(inSpec).length;
  const total = TARGET_GLYPHS.length;
  const progress = state.typed.length;

  els.adjustmentsLeft.textContent = String(state.adjustmentsLeft).padStart(2, "0");
  els.adjustmentCounter.classList.toggle("is-low", state.adjustmentsLeft <= 3);
  els.checkedCount.textContent = `${checked} / 3`;
  els.targetProgress.textContent = `${progress} / ${total}`;
  els.targetProgressBar.style.width = `${(progress / total) * 100}%`;

  for (const part of PARTS) {
    const value = state.settings[part];
    const output = els[`${part}Value`];
    const status = els[`${part}Status`];
    const range = els[`${part}Range`];
    output.textContent = String(value).padStart(2, "0");
    status.textContent = state.inspected[part] ? describeSetting(part) : "待标定";
    status.classList.toggle("is-ok", state.inspected[part] && inSpec(part));
    status.classList.toggle("is-warning", state.inspected[part] && !inSpec(part));
    range.disabled = state.adjustmentsLeft <= 0 || state.passed;
    range.setAttribute("aria-valuetext", `${SPEC[part].label} ${value}，${describeSetting(part)}`);

    const zone = document.querySelector(`[data-zone="${part}"]`);
    zone.style.setProperty("--zone-start", SPEC[part].min);
    zone.style.setProperty("--zone-width", SPEC[part].max - SPEC[part].min);
    zone.style.opacity = state.inspected[part] ? "1" : "0";

    const card = document.querySelector(`[data-part="${part}"]`);
    card.classList.toggle("is-checked", state.inspected[part]);
    card.querySelector(".part-state").textContent = state.inspected[part]
      ? inSpec(part)
        ? "已归位"
        : "有偏差"
      : "待检查";
  }

  const noChecks = checked === 0;
  const someChecks = checked > 0 && checked < 3;
  if (state.passed) {
    els.actionHint.textContent = "目标行已通过质检。机器状态良好。";
    els.machineState.textContent = "质检通过";
    els.typeButton.disabled = true;
  } else if (state.complete) {
    els.actionHint.textContent = "这一行已结束。换纸后可重打；纸上的错误不会自动消失。";
    els.machineState.textContent = "纸面需重排";
    els.typeButton.disabled = true;
  } else if (state.adjustmentsLeft <= 0 && aligned < 3) {
    els.actionHint.textContent = "调整次数已用尽。点击「重新开单」从头诊断。";
    els.machineState.textContent = "调校受限";
    els.typeButton.disabled = true;
  } else if (noChecks) {
    els.actionHint.textContent = "先完成三处检查，读取标定区间。";
    els.machineState.textContent = "待检查";
    els.typeButton.disabled = true;
  } else if (someChecks) {
    els.actionHint.textContent = `还有 ${3 - checked} 处机械没有检查，暂不可试打。`;
    els.machineState.textContent = "检查中";
    els.typeButton.disabled = true;
  } else if (aligned === 3) {
    els.actionHint.textContent = "三处已归位。按空格逐字打完整目标行。";
    els.machineState.textContent = "标定完成";
    els.typeButton.disabled = false;
  } else {
    els.actionHint.textContent = "按空格诊断，观察纸面留下的真实痕迹。";
    els.machineState.textContent = `${3 - aligned} 处待校准`;
    els.typeButton.disabled = false;
  }

  els.typeHint.classList.toggle("is-hidden", !allInspected() || state.passed || state.complete);
  els.newSheetButton.textContent =
    state.adjustmentsLeft <= 0 && !allAligned() && !state.passed ? "重新开单" : "换纸";
}

function inspectPart(part) {
  audio.init();
  audio.gear(true);
  state.inspected[part] = true;
  const titles = {
    linkage: "A · 连杆余隙",
    hammer: "B · 字锤偏压",
    ribbon: "C · 色带轨迹",
  };
  els.lensTitle.textContent = titles[part];
  els.lensCopy.textContent = NOTES[part];
  els.lens.classList.add("is-active");
  document.querySelector(`#note${part[0].toUpperCase()}${part.slice(1)}`).hidden = false;
  document.querySelector(`#note${part[0].toUpperCase()}${part.slice(1)}`).textContent = NOTES[part];
  renderFocus(part);
  setStatus(`检查记录 ${PARTS.filter((item) => state.inspected[item]).length}/3：已读取${SPEC[part].label}标定区间。`);
  updateUI();
}

function renderFocus(part) {
  state.focusPart = part;
}

function tickGearSound() {
  const now = performance.now();
  if (now - state.lastTick < 45) return;
  state.lastTick = now;
  audio.gear(false);
}

function adjustControl(part, nextValue, commit = false) {
  if (state.adjustmentsLeft <= 0 || state.passed) {
    state.settings[part] = state.committed[part];
    els[`${part}Range`].value = String(state.committed[part]);
    setStatus("调整余量已用尽，参数已锁定。", "error");
    updateUI();
    return;
  }

  state.settings[part] = clamp(Math.round(nextValue), 0, 100);
  if (commit && state.settings[part] !== state.committed[part]) {
    state.committed[part] = state.settings[part];
    state.adjustmentsLeft -= 1;
    audio.gear(false);
    if (state.adjustmentsLeft === 0) {
      setStatus(allAligned() ? "最后一次调整完成：三处机械已归位。" : "调整余量归零。机械尚未全部归位。", allAligned() ? "success" : "error");
    } else {
      setStatus(`${SPEC[part].label}已锁定为 ${state.settings[part]}。剩余 ${state.adjustmentsLeft} 次调整。`);
    }
  }
  updateUI();
  if (allAligned() && !state.complete && state.typed.length === 0) {
    els.lens.classList.add("is-active");
    els.lensTitle.textContent = "机械标定完成";
    els.lensCopy.textContent = "连杆、字锤与色带均已进入标定区。按空格逐字打完整目标行。";
  }
}

function distanceOutside(part) {
  const value = state.settings[part];
  const spec = SPEC[part];
  if (value < spec.min) return (spec.min - value) / 24;
  if (value > spec.max) return (value - spec.max) / 24;
  return 0;
}

function createStrikeMarks(glyphIndex, correctChar) {
  const jam = distanceOutside("linkage");
  const registration = distanceOutside("hammer");
  const ribbon = distanceOutside("ribbon");
  const isFault = jam > 0 || registration > 0 || ribbon > 0;
  const now = performance.now();
  const jammed = jam > 0;
  const wrongChar = isFault && (jammed || registration > 0.45) && glyphIndex % 3 === 0
    ? WRONG_GLYPHS[glyphIndex % WRONG_GLYPHS.length]
    : correctChar;
  const marks = [];

  const baseMark = {
    glyphIndex,
    char: wrongChar,
    correctChar,
    xShift: (state.settings.hammer - 44) * 0.52 + (jam > 0 ? Math.sin(glyphIndex * 1.7) * 4 : 0),
    yShift: (state.settings.ribbon - 72) * 0.22 + (registration > 0 ? 1.4 : 0),
    rotation: (state.settings.hammer - 44) * 0.018,
    alpha: isFault ? 0.72 : 0.86,
    ink: isFault ? "#8d321e" : "#24231c",
    createdAt: now + 130,
    duplicate: jammed && glyphIndex % 2 === 0,
    ghost: ribbon > 0,
    overlap: isFault && (jammed || Math.abs(state.settings.hammer - 44) > 2 || Math.abs(state.settings.ribbon - 72) > 2),
    error: isFault,
  };
  marks.push(baseMark);

  if (baseMark.duplicate) {
    marks.push({
      ...baseMark,
      xShift: baseMark.xShift + 6.5,
      yShift: baseMark.yShift - 1.2,
      rotation: baseMark.rotation - 0.035,
      alpha: 0.44,
      overlap: true,
      createdAt: now + 190,
    });
  }
  if (baseMark.ghost) {
    marks.push({
      ...baseMark,
      char: correctChar === wrongChar ? wrongChar : correctChar,
      xShift: baseMark.xShift - 10,
      yShift: baseMark.yShift + 2.2,
      rotation: -baseMark.rotation,
      alpha: 0.23,
      duplicate: false,
      overlap: true,
      createdAt: now + 165,
    });
  }
  return marks;
}

function pressSpace() {
  if (!allInspected()) {
    setStatus("尚有机械没有检查，先逐项读取标定区间。", "error");
    return;
  }
  if (state.passed || state.complete || state.resolving) return;

  audio.init();
  const glyphIndex = state.typed.length;
  if (glyphIndex >= TARGET_GLYPHS.length) return;

  const correctChar = TARGET_GLYPHS[glyphIndex];
  const marks = createStrikeMarks(glyphIndex, correctChar);
  const hasFault = marks.some((mark) => mark.error);
  state.typed.push(marks[0]);
  state.marks.push(...marks);
  if (hasFault) state.faultCount += 1;

  state.strike = {
    startedAt: performance.now(),
    glyphIndex,
    fontIndex: targetFontIndex(correctChar),
    returns: false,
  };
  state.carriageKick = 1;
  state.ribbonAngle += 0.12;
  audio.keyStrike();

  if (hasFault) {
    const causes = [];
    if (distanceOutside("linkage") > 0) causes.push("连杆卡字");
    if (distanceOutside("hammer") > 0) causes.push("字锤错位");
    if (distanceOutside("ribbon") > 0) causes.push("色带跳动");
    setStatus(`第 ${glyphIndex + 1} 字落下，纸面出现${causes.join("、")}痕迹。`, "error");
    els.lens.classList.remove("is-active");
    els.lensTitle.textContent = `第 ${glyphIndex + 1} 字 · 不合格`;
    els.lensCopy.textContent = `${causes.join("、")}。错误墨迹已经留在纸上，换纸后可重打。`;
  } else {
    setStatus(`第 ${glyphIndex + 1} 字「${correctChar}」落点干净。`);
    els.lens.classList.remove("is-active");
    els.lensTitle.textContent = `第 ${glyphIndex + 1} 字 · 落点干净`;
    els.lensCopy.textContent = "字锤、色带与连杆同步到位。继续按空格完成目标行。";
  }

  if (state.typed.length === TARGET_GLYPHS.length) {
    state.resolving = true;
    window.setTimeout(resolveLine, 520);
  }
  updateUI();
}

function resolveLine() {
  state.resolving = false;
  state.complete = true;
  const overlaps = state.marks.filter((mark) => mark.overlap).length;
  const clean = allAligned() && state.faultCount === 0 && overlaps === 0;
  state.passed = clean;
  els.resultStamp.classList.add("is-visible");
  els.resultStamp.classList.toggle("is-rejected", !clean);

  if (clean) {
    els.resultStamp.querySelector("span:first-child").textContent = "QUALITY";
    els.resultStamp.querySelector("strong").textContent = "PASSED";
    els.resultStamp.querySelector("span:last-child").textContent = "14 · XI · 2026";
    setStatus("目标行完整，字距无重叠，墨色连续。质检通过。", "success");
    els.lensTitle.textContent = "PRINT CLEANLY";
    els.lensCopy.textContent = "十二个字全部落在目标基线上。卷轴归位，色带稳定，卡键已排除。";
    audio.complete();
  } else {
    els.resultStamp.querySelector("span:first-child").textContent = "REWORK";
    els.resultStamp.querySelector("strong").textContent = "REJECTED";
    els.resultStamp.querySelector("span:last-child").textContent = `${overlaps} OVERLAP${overlaps === 1 ? "" : "S"}`;
    setStatus(`目标行结束，但纸面上有 ${overlaps || state.faultCount} 处重叠或错误墨迹，不能通过。`, "error");
    els.lensTitle.textContent = "纸面不合格";
    els.lensCopy.textContent = "错误已经真实落在纸上。换一张纸，保持三处参数归位后再打。";
    audio.carriageReturn();
  }
  updateUI();
}

function targetFontIndex(char) {
  const code = char.charCodeAt(0);
  return clamp((code * 7 + 3) % 34, 0, 33);
}

function newSheet() {
  audio.init();
  const bankrupt = state.adjustmentsLeft <= 0 && !allAligned() && !state.passed;
  if (bankrupt) {
    resetGame();
    return;
  }

  state.round += 1;
  state.typed = [];
  state.marks = [];
  state.faultCount = 0;
  state.complete = false;
  state.passed = false;
  state.resolving = false;
  state.paperDrop = 1;
  state.strike = null;
  els.resultStamp.classList.remove("is-visible", "is-rejected");
  els.lens.classList.remove("is-active");
  els.lensTitle.textContent = "新纸已装入";
  els.lensCopy.textContent = allAligned()
    ? "三处机械保持归位。按空格逐字完成目标行。"
    : "当前参数仍有偏差，试打会留下可辨认的错误痕迹。";
  audio.carriageReturn();
  if (state.adjustmentsLeft <= 0) {
    setStatus("已换纸，但调整余量用尽；若无法归位需重新开单。", "error");
  } else if (allAligned()) {
    setStatus("新纸已装。三处机械归位，可以开始打完整目标行。", "success");
  } else {
    setStatus("新纸已装。错误墨迹已清除，机械偏差仍然存在。");
  }
  updateUI();
}

function resetGame() {
  state.inspected = { linkage: false, hammer: false, ribbon: false };
  state.settings = { linkage: 18, hammer: 86, ribbon: 32 };
  state.committed = { linkage: 18, hammer: 86, ribbon: 32 };
  state.adjustmentsLeft = 9;
  state.typed = [];
  state.marks = [];
  state.faultCount = 0;
  state.complete = false;
  state.passed = false;
  state.resolving = false;
  state.strike = null;
  state.round = 0;
  for (const part of PARTS) {
    els[`${part}Range`].value = String(state.settings[part]);
    document.querySelector(`#note${part[0].toUpperCase()}${part.slice(1)}`).hidden = true;
    document.querySelector(`[data-part="${part}"]`).classList.remove("is-checked");
  }
  els.resultStamp.classList.remove("is-visible", "is-rejected");
  els.lensTitle.textContent = "选择一处机械";
  els.lensCopy.textContent = "点击右侧检查卡，靠近连杆、字锤或卷轴间隙。";
  els.lens.classList.remove("is-active");
  setStatus("工单已重新打开。先检查三处机械，读取标定区间。");
  audio.carriageReturn();
  updateUI();
}

for (const part of PARTS) {
  const range = els[`${part}Range`];
  let valueAtStart = Number(range.value);

  range.addEventListener("pointerdown", () => {
    audio.init();
    valueAtStart = Number(range.value);
  });

  range.addEventListener("input", () => {
    if (state.adjustmentsLeft <= 0 || state.passed) {
      range.value = String(state.committed[part]);
      return;
    }
    const value = Number(range.value);
    if (value !== state.settings[part]) tickGearSound();
    adjustControl(part, value, false);
  });

  range.addEventListener("change", () => {
    const value = Number(range.value);
    if (value === state.committed[part]) return;
    if (value !== valueAtStart) {
      adjustControl(part, value, true);
    }
    valueAtStart = Number(range.value);
  });
}

document.querySelectorAll(".inspection-card").forEach((card) => {
  card.addEventListener("click", () => inspectPart(card.dataset.part));
});

els.typeButton.addEventListener("click", pressSpace);
els.newSheetButton.addEventListener("click", newSheet);
els.soundToggle.addEventListener("click", () => {
  audio.init();
  audio.enabled = !audio.enabled;
  updateSoundButton();
  if (audio.enabled) audio.gear(false);
  setStatus(audio.enabled ? "机械声已开启：按键、齿轮与回车均由 Web Audio 实时合成。" : "机械声已静音。");
});

window.addEventListener("keydown", (event) => {
  if (event.code === "Space" && !event.repeat) {
    event.preventDefault();
    pressSpace();
  }
});

document.addEventListener("pointerdown", () => audio.init(), { once: true });

const clock = document.querySelector("#clock");
function updateClock() {
  clock.textContent = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date());
}
updateClock();
window.setInterval(updateClock, 60_000);

updateSoundButton();
updateUI();

const canvas = els.canvas;
const ctx = canvas.getContext("2d");
let sceneWidth = 0;
let sceneHeight = 0;
let grainPattern = null;
let paperGrain = null;

function makeNoisePattern(size, alpha, base) {
  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const tileCtx = tile.getContext("2d");
  tileCtx.fillStyle = base;
  tileCtx.fillRect(0, 0, size, size);
  const image = tileCtx.getImageData(0, 0, size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const noise = Math.random() * 255;
    image.data[i] = noise;
    image.data[i + 1] = noise;
    image.data[i + 2] = noise;
    image.data[i + 3] = Math.random() * alpha;
  }
  tileCtx.putImageData(image, 0, 0);
  return ctx.createPattern(tile, "repeat");
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  sceneWidth = Math.max(1, rect.width);
  sceneHeight = Math.max(1, rect.height);
  canvas.width = Math.round(sceneWidth * dpr);
  canvas.height = Math.round(sceneHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  grainPattern = makeNoisePattern(96, 16, "#22251e");
  paperGrain = makeNoisePattern(80, 12, "#e8dfc8");
}

function getLayout() {
  const w = sceneWidth;
  const h = sceneHeight;
  const paperW = Math.min(w * 0.405, 430);
  const paperH = Math.min(h * 0.68, 525);
  const paperX = (w - paperW) * 0.48;
  const paperY = h * 0.052 + state.paperDrop * 4;
  const platenY = h * 0.59;
  const bodyTop = h * 0.575;
  const bodyBottom = h * 0.955;
  const bodyW = Math.min(w * 0.76, 840);
  const bodyX = (w - bodyW) / 2;
  return {
    w,
    h,
    paperW,
    paperH,
    paperX,
    paperY,
    platenY,
    bodyTop,
    bodyBottom,
    bodyW,
    bodyX,
    centerX: w / 2,
  };
}

function drawBackground(layout) {
  const { w, h } = layout;
  const desk = ctx.createLinearGradient(0, 0, 0, h);
  desk.addColorStop(0, "#1d211a");
  desk.addColorStop(0.48, "#2d2d21");
  desk.addColorStop(0.49, "#27271b");
  desk.addColorStop(1, "#191b14");
  ctx.fillStyle = desk;
  ctx.fillRect(0, 0, w, h);

  const lamp = ctx.createRadialGradient(w * 0.48, h * 0.18, 20, w * 0.48, h * 0.18, w * 0.66);
  lamp.addColorStop(0, "rgba(207, 188, 136, 0.17)");
  lamp.addColorStop(0.35, "rgba(160, 147, 105, 0.06)");
  lamp.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = lamp;
  ctx.fillRect(0, 0, w, h);

  if (grainPattern) {
    ctx.save();
    ctx.globalAlpha = 0.13;
    ctx.globalCompositeOperation = "soft-light";
    ctx.fillStyle = grainPattern;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  ctx.save();
  ctx.strokeStyle = "rgba(214, 196, 147, 0.045)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 7; i += 1) {
    const y = h * (0.18 + i * 0.115);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(w * 0.28, y - 16, w * 0.68, y + 24, w, y - 7);
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = "rgba(9, 11, 8, 0.3)";
  ctx.fillRect(0, h * 0.78, w, h * 0.22);
}

function paperSlots(layout) {
  const innerX = layout.paperX + layout.paperW * 0.09;
  const innerW = layout.paperW * 0.82;
  const cell = innerW / 13;
  const baseline = layout.paperY + layout.paperH * 0.38;
  const positions = [];
  let glyphIndex = 0;
  let cursor = 0;
  for (const char of TARGET) {
    if (char !== " ") {
      positions.push({
        glyphIndex,
        char,
        x: innerX + cell * (cursor + 0.5),
        y: baseline,
        cell,
      });
      glyphIndex += 1;
    }
    cursor += 1;
  }
  return positions;
}

function drawPaperShape(layout) {
  const { paperX, paperY, paperW, paperH } = layout;
  const tilt = -0.008;

  ctx.save();
  ctx.translate(paperX + paperW / 2, paperY + paperH / 2);
  ctx.rotate(tilt);
  ctx.translate(-paperX - paperW / 2, -paperY - paperH / 2);

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.48)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 20;
  ctx.fillStyle = "#bfb59e";
  ctx.fillRect(paperX + 8, paperY + 6, paperW, paperH);
  ctx.restore();

  ctx.fillStyle = "#cfc4aa";
  ctx.fillRect(paperX + 3, paperY + 2, paperW, paperH);

  const sheet = ctx.createLinearGradient(paperX, paperY, paperX + paperW, paperY + paperH);
  sheet.addColorStop(0, "#eee5cf");
  sheet.addColorStop(0.46, "#e9dfc7");
  sheet.addColorStop(1, "#dcd0b5");
  ctx.fillStyle = sheet;
  ctx.fillRect(paperX, paperY, paperW, paperH);

  if (paperGrain) {
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = paperGrain;
    ctx.fillRect(paperX, paperY, paperW, paperH);
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = 0.11;
  ctx.strokeStyle = "#6e634d";
  ctx.lineWidth = 0.7;
  for (let i = 0; i < 22; i += 1) {
    const y = paperY + 15 + i * 19;
    ctx.beginPath();
    ctx.moveTo(paperX + 7, y);
    ctx.bezierCurveTo(paperX + paperW * 0.3, y - 2, paperX + paperW * 0.7, y + 3, paperX + paperW - 7, y);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(paperX, paperY, paperW, paperH);
  ctx.clip();
  ctx.strokeStyle = "rgba(95, 83, 61, 0.18)";
  ctx.lineWidth = 1;
  ctx.strokeRect(paperX + 21, paperY + 21, paperW - 42, paperH - 42);
  ctx.restore();

  ctx.restore();
}

function drawPaperContent(layout) {
  const { paperX, paperY, paperW, paperH } = layout;
  const slots = paperSlots(layout);
  const rotate = -0.008;
  const pivotX = paperX + paperW / 2;
  const pivotY = paperY + paperH / 2;

  ctx.save();
  ctx.translate(pivotX, pivotY);
  ctx.rotate(rotate);
  ctx.translate(-pivotX, -pivotY);
  ctx.beginPath();
  ctx.rect(paperX, paperY, paperW, paperH);
  ctx.clip();

  ctx.fillStyle = "#343328";
  ctx.font = `600 ${Math.max(10, paperW * 0.03)}px "Courier New", monospace`;
  ctx.textAlign = "left";
  ctx.fillText("UNDERWOOD", paperX + paperW * 0.075, paperY + paperH * 0.056);
  ctx.fillStyle = "rgba(52, 51, 40, 0.48)";
  ctx.font = `500 ${Math.max(6, paperW * 0.0155)}px "Courier New", monospace`;
  ctx.letterSpacing = "1.5px";
  ctx.fillText("TYPEWRITER REPAIR BUREAU", paperX + paperW * 0.075, paperY + paperH * 0.083);
  ctx.textAlign = "right";
  ctx.fillText("PROOF / 047", paperX + paperW * 0.925, paperY + paperH * 0.073);

  ctx.strokeStyle = "rgba(52, 51, 40, 0.42)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(paperX + paperW * 0.075, paperY + paperH * 0.1);
  ctx.lineTo(paperX + paperW * 0.925, paperY + paperH * 0.1);
  ctx.moveTo(paperX + paperW * 0.075, paperY + paperH * 0.104);
  ctx.lineTo(paperX + paperW * 0.925, paperY + paperH * 0.104);
  ctx.stroke();

  const baseline = slots[0]?.y || paperY + paperH * 0.38;
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(57, 55, 42, 0.5)";
  ctx.font = `500 ${Math.max(6, paperW * 0.016)}px "Courier New", monospace`;
  ctx.fillText("TARGET IMPRESSION", paperX + paperW * 0.075, baseline - 42);
  ctx.textAlign = "right";
  ctx.fillText("12 GLYPHS · CARBON", paperX + paperW * 0.925, baseline - 42);

  ctx.strokeStyle = "rgba(60, 57, 43, 0.15)";
  ctx.beginPath();
  ctx.moveTo(paperX + paperW * 0.075, baseline + 8);
  ctx.lineTo(paperX + paperW * 0.925, baseline + 8);
  ctx.stroke();

  ctx.setLineDash([1, 4]);
  ctx.strokeStyle = "rgba(83, 76, 57, 0.19)";
  for (let i = 0; i < 13; i += 1) {
    const x = paperX + paperW * 0.09 + (paperW * 0.82 * (i + 0.5)) / 13;
    ctx.beginPath();
    ctx.moveTo(x, baseline - 20);
    ctx.lineTo(x, baseline + 8);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  const targetSize = clamp((paperW * 0.82) / 13 * 0.91, 15, 23);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  for (const slot of slots) {
    ctx.fillStyle = "rgba(57, 54, 40, 0.115)";
    ctx.font = `700 ${targetSize}px "Courier New", monospace`;
    ctx.fillText(slot.char, slot.x, slot.y);
  }

  const now = performance.now();
  for (const mark of state.marks) {
    const slot = slots[mark.glyphIndex];
    if (!slot) continue;
    const reveal = clamp((now - mark.createdAt) / 180, 0, 1);
    if (reveal <= 0) continue;
    const ease = 1 - Math.pow(1 - reveal, 3);
    const x = slot.x + mark.xShift;
    const y = slot.y + mark.yShift - (1 - ease) * 8;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(mark.rotation || 0);
    ctx.globalAlpha = mark.alpha * ease;
    ctx.fillStyle = mark.ink;
    ctx.font = `700 ${targetSize}px "Courier New", monospace`;
    ctx.fillText(mark.char, 0.45, 0.35);
    ctx.globalAlpha = mark.alpha * 0.27 * ease;
    ctx.fillText(mark.char, -0.35, -0.45);
    ctx.restore();

    if (mark.duplicate) {
      ctx.save();
      ctx.globalAlpha = 0.18 * ease;
      ctx.strokeStyle = "#7f2b1c";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 6, y + 5);
      ctx.lineTo(x + 8, y + 6);
      ctx.stroke();
      ctx.restore();
    }
  }

  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(53, 51, 40, 0.48)";
  ctx.font = `500 ${Math.max(6, paperW * 0.016)}px "Courier New", monospace`;
  ctx.fillText("OPERATOR  R-04", paperX + paperW * 0.075, paperY + paperH * 0.53);
  ctx.textAlign = "right";
  ctx.fillText("QC / LINE 01", paperX + paperW * 0.925, paperY + paperH * 0.53);

  ctx.strokeStyle = "rgba(70, 64, 47, 0.15)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(paperX + paperW * 0.075, paperY + paperH * 0.49);
  ctx.lineTo(paperX + paperW * 0.925, paperY + paperH * 0.49);
  ctx.stroke();

  ctx.save();
  ctx.translate(paperX + paperW * 0.83, paperY + paperH * 0.14);
  ctx.rotate(-0.07);
  ctx.strokeStyle = "rgba(142, 61, 40, 0.41)";
  ctx.lineWidth = 1.2;
  ctx.strokeRect(-29, -11, 58, 22);
  ctx.fillStyle = "rgba(142, 61, 40, 0.5)";
  ctx.textAlign = "center";
  ctx.font = `600 7px "Courier New", monospace`;
  ctx.fillText("NO. 047", 0, 2);
  ctx.restore();

  ctx.restore();
}

function drawPaper(layout) {
  drawPaperShape(layout);
  drawPaperContent(layout);
}

function roundedRect(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawMachineBody(layout) {
  const { w, h, bodyTop, bodyBottom, bodyW, bodyX, centerX } = layout;
  const left = bodyX;
  const right = bodyX + bodyW;

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 48;
  ctx.shadowOffsetY = 24;
  const shell = ctx.createLinearGradient(left, bodyTop, right, bodyBottom);
  shell.addColorStop(0, "#26332b");
  shell.addColorStop(0.25, "#17231c");
  shell.addColorStop(0.62, "#0f1813");
  shell.addColorStop(1, "#202c24");
  ctx.fillStyle = shell;
  ctx.beginPath();
  ctx.moveTo(left + 25, bodyBottom);
  ctx.bezierCurveTo(left - 5, bodyBottom - 54, left + 8, bodyTop + 64, left + w * 0.12, bodyTop + 26);
  ctx.bezierCurveTo(left + w * 0.2, bodyTop - 15, right - w * 0.2, bodyTop - 15, right - w * 0.12, bodyTop + 26);
  ctx.bezierCurveTo(right - 8, bodyTop + 64, right + 5, bodyBottom - 54, right - 25, bodyBottom);
  ctx.quadraticCurveTo(centerX, bodyBottom + 18, left + 25, bodyBottom);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const sheen = ctx.createLinearGradient(0, bodyTop, 0, bodyTop + 85);
  sheen.addColorStop(0, "rgba(189, 199, 172, 0.13)");
  sheen.addColorStop(0.25, "rgba(189, 199, 172, 0.035)");
  sheen.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = sheen;
  ctx.beginPath();
  ctx.moveTo(left + w * 0.13, bodyTop + 19);
  ctx.bezierCurveTo(centerX - w * 0.18, bodyTop - 20, centerX + w * 0.18, bodyTop - 20, right - w * 0.13, bodyTop + 19);
  ctx.bezierCurveTo(right - w * 0.2, bodyTop + 48, centerX, bodyTop + 62, left + w * 0.13, bodyTop + 19);
  ctx.fill();

  ctx.strokeStyle = "rgba(210, 185, 123, 0.22)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left + w * 0.14, bodyTop + 25);
  ctx.bezierCurveTo(left + w * 0.24, bodyTop + 5, right - w * 0.24, bodyTop + 5, right - w * 0.14, bodyTop + 25);
  ctx.stroke();

  const wellX = left + bodyW * 0.12;
  const wellY = bodyTop + h * 0.115;
  const wellW = bodyW * 0.76;
  const wellH = h * 0.26;
  const well = ctx.createLinearGradient(0, wellY, 0, wellY + wellH);
  well.addColorStop(0, "#0a100c");
  well.addColorStop(0.62, "#111a14");
  well.addColorStop(1, "#27332a");
  roundedRect(wellX, wellY, wellW, wellH, 44);
  ctx.fillStyle = well;
  ctx.fill();
  ctx.strokeStyle = "rgba(174, 149, 93, 0.32)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.strokeStyle = "rgba(231, 221, 195, 0.08)";
  ctx.lineWidth = 1;
  roundedRect(wellX + 7, wellY + 7, wellW - 14, wellH - 14, 38);
  ctx.stroke();

  ctx.fillStyle = "rgba(205, 178, 112, 0.58)";
  ctx.textAlign = "center";
  ctx.font = `400 ${Math.max(13, w * 0.014)}px Georgia, serif`;
  ctx.letterSpacing = "2px";
  ctx.fillText("UNDERWOOD", centerX, wellY + 20);
  ctx.letterSpacing = "0px";

  ctx.strokeStyle = "rgba(205, 178, 112, 0.3)";
  ctx.beginPath();
  ctx.moveTo(centerX - 58, wellY + 28);
  ctx.lineTo(centerX + 58, wellY + 28);
  ctx.stroke();

  const lower = ctx.createLinearGradient(0, bodyBottom - 105, 0, bodyBottom);
  lower.addColorStop(0, "rgba(255,255,255,0.015)");
  lower.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.fillStyle = lower;
  ctx.fillRect(left + 15, bodyBottom - 100, bodyW - 30, 92);
}

function drawCarriage(layout) {
  const { w, h, centerX, platenY, bodyW } = layout;
  const rollerW = Math.min(bodyW * 0.72, w * 0.55);
  const rollerX = centerX - rollerW / 2;
  const rollerH = Math.max(25, h * 0.043);

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 7;
  ctx.fillStyle = "#0d100d";
  roundedRect(rollerX - 9, platenY - rollerH / 2 - 4, rollerW + 18, rollerH + 8, 9);
  ctx.fill();
  ctx.restore();

  const roller = ctx.createLinearGradient(0, platenY - rollerH / 2, 0, platenY + rollerH / 2);
  roller.addColorStop(0, "#4c4c42");
  roller.addColorStop(0.2, "#262923");
  roller.addColorStop(0.58, "#141713");
  roller.addColorStop(1, "#34372e");
  ctx.fillStyle = roller;
  roundedRect(rollerX, platenY - rollerH / 2, rollerW, rollerH, 7);
  ctx.fill();

  ctx.strokeStyle = "rgba(222, 217, 193, 0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(rollerX + 12, platenY - rollerH / 2 + 5);
  ctx.lineTo(rollerX + rollerW - 12, platenY - rollerH / 2 + 5);
  ctx.stroke();

  const knobRadius = Math.max(18, h * 0.033);
  for (const side of [-1, 1]) {
    const x = side < 0 ? rollerX : rollerX + rollerW;
    const knob = ctx.createRadialGradient(x - 5, platenY - 7, 2, x, platenY, knobRadius);
    knob.addColorStop(0, "#d2bc87");
    knob.addColorStop(0.52, "#886a3b");
    knob.addColorStop(0.76, "#40331f");
    knob.addColorStop(1, "#a88952");
    ctx.fillStyle = knob;
    ctx.beginPath();
    ctx.arc(x, platenY, knobRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(34, 29, 18, 0.8)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.save();
    ctx.translate(x, platenY);
    ctx.rotate(state.carriageKick * 0.55);
    ctx.strokeStyle = "rgba(41, 36, 24, 0.65)";
    for (let i = 0; i < 4; i += 1) {
      ctx.rotate(Math.PI / 4);
      ctx.beginPath();
      ctx.moveTo(-knobRadius * 0.6, 0);
      ctx.lineTo(knobRadius * 0.6, 0);
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.strokeStyle = "#6e6249";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(rollerX - 1, platenY + rollerH / 2 + 8);
  ctx.lineTo(rollerX + rollerW + 1, platenY + rollerH / 2 + 8);
  ctx.stroke();

  ctx.strokeStyle = "rgba(220, 212, 184, 0.27)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 24; i += 1) {
    const x = rollerX + (rollerW * i) / 24;
    ctx.beginPath();
    ctx.moveTo(x, platenY - rollerH / 2 - 3);
    ctx.lineTo(x, platenY - rollerH / 2 + (i % 4 === 0 ? 6 : 2));
    ctx.stroke();
  }

  drawCarriageLever(layout, rollerX, platenY);
}

function drawCarriageLever(layout, rollerX, platenY) {
  const { h } = layout;
  const x = rollerX - 3;
  const kick = state.carriageKick * 12;
  ctx.strokeStyle = "#89734c";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, platenY + 10);
  ctx.bezierCurveTo(x - 26, platenY + 22, x - 52, platenY + 12 - kick, x - 62, platenY - 26 + kick);
  ctx.stroke();
  ctx.strokeStyle = "rgba(232, 209, 154, 0.38)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 2, platenY + 9);
  ctx.bezierCurveTo(x - 27, platenY + 19, x - 51, platenY + 10 - kick, x - 61, platenY - 25 + kick);
  ctx.stroke();
  ctx.fillStyle = "#957844";
  ctx.beginPath();
  ctx.arc(x - 62, platenY - 28 + kick, Math.max(4, h * 0.009), 0, Math.PI * 2);
  ctx.fill();
  ctx.lineCap = "butt";
}

function drawRibbon(layout) {
  const { h, centerX, platenY, w } = layout;
  const spoolOffset = Math.min(w * 0.225, 218);
  const radius = Math.max(16, h * 0.03);
  const angle = state.ribbonAngle;

  ctx.strokeStyle = "rgba(48, 38, 31, 0.9)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(centerX - spoolOffset + radius, platenY - 16);
  ctx.quadraticCurveTo(centerX, platenY - 3, centerX + spoolOffset - radius, platenY - 16);
  ctx.stroke();
  ctx.strokeStyle = "rgba(164, 62, 39, 0.72)";
  ctx.lineWidth = 2;
  ctx.stroke();

  for (const [side, color] of [[-1, "#a94e35"], [1, "#c4a76f"]]) {
    const x = centerX + side * spoolOffset;
    ctx.save();
    ctx.translate(x, platenY - 20);
    ctx.rotate(angle * side);
    ctx.shadowColor = "rgba(0, 0, 0, 0.38)";
    ctx.shadowBlur = 8;
    const metal = ctx.createRadialGradient(-radius * 0.3, -radius * 0.35, 2, 0, 0, radius);
    metal.addColorStop(0, "#d6c38d");
    metal.addColorStop(0.55, "#8a7042");
    metal.addColorStop(1, "#352b1c");
    ctx.fillStyle = metal;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(33, 29, 21, 0.8)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.63, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#211d17";
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.23, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(230, 211, 168, 0.45)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i += 1) {
      ctx.rotate((Math.PI * 2) / 5);
      ctx.beginPath();
      ctx.moveTo(radius * 0.27, 0);
      ctx.lineTo(radius * 0.57, 0);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function strikeProgress(now) {
  if (!state.strike) return 0;
  return clamp((now - state.strike.startedAt) / 280, 0, 1);
}

function drawTypebars(layout, now) {
  const { h, centerX, platenY, bodyTop, w } = layout;
  const pivotY = bodyTop + h * 0.205;
  const progress = strikeProgress(now);
  const swing = Math.sin(progress * Math.PI);
  const activeIndex = state.strike ? state.strike.fontIndex % 24 : -1;

  for (let i = 0; i < 24; i += 1) {
    const spread = (i - 11.5) / 11.5;
    const targetX = centerX + spread * w * 0.21;
    const targetY = platenY + 16 + Math.abs(spread) * 11;
    const active = i === activeIndex && state.strike;
    ctx.strokeStyle = active ? "rgba(215, 195, 145, 0.8)" : "rgba(128, 137, 121, 0.25)";
    ctx.lineWidth = active ? 2.2 : 1.1;
    ctx.beginPath();
    ctx.moveTo(centerX + spread * w * 0.049, pivotY);
    if (active) {
      ctx.quadraticCurveTo(
        centerX + spread * w * 0.12,
        pivotY - h * 0.06 * swing,
        targetX * (1 - swing) + centerX * swing,
        targetY * (1 - swing) + (platenY - 9) * swing
      );
    } else {
      ctx.quadraticCurveTo(centerX + spread * w * 0.105, pivotY - h * 0.035, targetX, targetY);
    }
    ctx.stroke();
  }

  ctx.fillStyle = "#171e18";
  ctx.strokeStyle = "rgba(187, 163, 105, 0.45)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(centerX, pivotY, w * 0.021, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const guideX = centerX;
  const guideY = platenY + 8;
  ctx.strokeStyle = "rgba(202, 194, 169, 0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(guideX - 14, guideY + 8);
  ctx.lineTo(guideX - 9, guideY - 10);
  ctx.quadraticCurveTo(guideX, guideY - 19, guideX + 9, guideY - 10);
  ctx.lineTo(guideX + 14, guideY + 8);
  ctx.stroke();
  if (state.strike && progress < 0.55) {
    const glow = Math.sin((progress / 0.55) * Math.PI);
    const glowGradient = ctx.createRadialGradient(guideX, guideY - 7, 0, guideX, guideY - 7, 28);
    glowGradient.addColorStop(0, `rgba(217, 192, 132, ${0.18 * glow})`);
    glowGradient.addColorStop(1, "rgba(217, 192, 132, 0)");
    ctx.fillStyle = glowGradient;
    ctx.beginPath();
    ctx.arc(guideX, guideY - 7, 28, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawKeys(layout, now) {
  const { h, centerX, bodyTop, bodyW, bodyBottom } = layout;
  const progress = strikeProgress(now);
  const press = Math.sin(progress * Math.PI);
  const rows = [
    { y: bodyTop + h * 0.157, labels: "1234567890", radius: h * 0.019, spread: bodyW * 0.51 },
    { y: bodyTop + h * 0.217, labels: "QWERTYUIOP", radius: h * 0.0195, spread: bodyW * 0.56 },
    { y: bodyTop + h * 0.281, labels: "ASDFGHJKL", radius: h * 0.021, spread: bodyW * 0.53 },
    { y: bodyTop + h * 0.345, labels: "ZXCVBNM", radius: h * 0.022, spread: bodyW * 0.43 },
  ];
  const allKeys = [];
  const activeIndex = state.strike ? state.strike.fontIndex : -1;
  let keyIndex = 0;

  rows.forEach((row, rowIndex) => {
    const count = row.labels.length;
    const gap = row.spread / Math.max(1, count - 1);
    const startX = centerX - row.spread / 2;
    for (let i = 0; i < count; i += 1) {
      const arc = Math.pow((i - (count - 1) / 2) / count, 2) * h * 0.025;
      const x = startX + i * gap;
      const y = row.y + arc;
      allKeys.push({ x, y, radius: row.radius, keyIndex, rowIndex, label: row.labels[i] });
      keyIndex += 1;
    }
  });

  const activeKey = allKeys[activeIndex] || null;
  allKeys.forEach((key) => {
    const active = key === activeKey && state.strike;
    drawKey(key, active ? press * 4.5 : 0, active);
  });

  const spaceY = Math.min(bodyBottom - h * 0.027, rows[3].y + h * 0.085);
  drawSpacebar(centerX, spaceY, bodyW * 0.19, Math.max(9, h * 0.014), activeKey ? press : 0);
}

function drawKey(key, depression, active) {
  const { x, y, radius, label } = key;
  ctx.save();
  ctx.globalAlpha = key.rowIndex === 0 ? 0.82 : 1;
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.beginPath();
  ctx.ellipse(x + 1, y + radius * 0.5 + 4, radius * 0.9, radius * 0.48, 0, 0, Math.PI * 2);
  ctx.fill();

  const ring = ctx.createLinearGradient(x, y - radius, x, y + radius);
  ring.addColorStop(0, active ? "#d8be7d" : "#a1997e");
  ring.addColorStop(0.5, "#575345");
  ring.addColorStop(1, "#272a23");
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.arc(x, y + depression, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(16, 19, 15, 0.9)";
  ctx.lineWidth = 1;
  ctx.stroke();

  const cap = ctx.createRadialGradient(
    x - radius * 0.35,
    y - radius * 0.45 + depression,
    1,
    x,
    y + depression,
    radius * 0.86
  );
  cap.addColorStop(0, active ? "#4d4631" : "#353930");
  cap.addColorStop(0.45, "#1f241e");
  cap.addColorStop(1, "#0d110e");
  ctx.fillStyle = cap;
  ctx.beginPath();
  ctx.arc(x, y + depression, radius * 0.78, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = active ? "rgba(226, 201, 141, 0.85)" : "rgba(218, 212, 190, 0.42)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y + depression, radius * 0.63, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = active ? "#f1dfae" : "#e2dac3";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.max(6, radius * 0.65)}px "Courier New", monospace`;
  ctx.fillText(label, x, y + depression * 1.05 + 0.4);
  ctx.restore();
}

function drawSpacebar(x, y, width, height, depression) {
  ctx.save();
  const dy = depression * 4;
  ctx.fillStyle = "rgba(0, 0, 0, 0.48)";
  roundedRect(x - width / 2 + 2, y - height / 2 + 5, width, height, height / 2);
  ctx.fill();
  const metal = ctx.createLinearGradient(0, y - height / 2, 0, y + height / 2);
  metal.addColorStop(0, "#8c846d");
  metal.addColorStop(0.35, "#34372f");
  metal.addColorStop(1, "#161a16");
  ctx.fillStyle = metal;
  roundedRect(x - width / 2, y - height / 2 + dy, width, height, height / 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(217, 206, 178, 0.33)";
  ctx.stroke();
  ctx.fillStyle = "rgba(226, 219, 196, 0.55)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.max(5, height * 0.46)}px "Courier New", monospace`;
  ctx.fillText("SPACE", x, y + dy + 0.5);
  ctx.restore();
}

function drawSideMechanism(layout) {
  const { h, bodyTop, bodyX, bodyW, bodyBottom } = layout;
  const x = bodyX + bodyW * 0.895;
  const y = bodyTop + h * 0.065;
  const panelW = bodyW * 0.067;
  const panelH = h * 0.14;

  ctx.save();
  roundedRect(x, y, panelW, panelH, 5);
  ctx.fillStyle = "#0b110d";
  ctx.fill();
  ctx.strokeStyle = "rgba(187, 169, 124, 0.32)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  roundedRect(x + 4, y + 4, panelW - 8, panelH - 8, 4);
  ctx.clip();
  const rod = ctx.createLinearGradient(x, y, x + panelW, y);
  rod.addColorStop(0, "#3d4238");
  rod.addColorStop(0.5, "#c0b89d");
  rod.addColorStop(1, "#4f4d40");
  ctx.strokeStyle = rod;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + panelW * 0.28, y + panelH * 0.18);
  ctx.lineTo(x + panelW * 0.67, y + panelH * 0.57);
  ctx.lineTo(x + panelW * 0.36, y + panelH * 0.8);
  ctx.stroke();
  ctx.strokeStyle = "rgba(203, 186, 142, 0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    ctx.arc(x + panelW * 0.46, y + panelH * 0.7, 4 + i * 2.2, Math.PI, Math.PI * 1.9);
  }
  ctx.stroke();
  ctx.fillStyle = "#897347";
  ctx.beginPath();
  ctx.arc(x + panelW * 0.7, y + panelH * 0.54, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.restore();

  ctx.save();
  const screwY1 = bodyBottom - h * 0.055;
  for (const screwX of [bodyX + bodyW * 0.075, bodyX + bodyW * 0.925]) {
    const grad = ctx.createRadialGradient(screwX - 1, screwY1 - 1, 0, screwX, screwY1, 5);
    grad.addColorStop(0, "#baa66f");
    grad.addColorStop(1, "#4b422d");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(screwX, screwY1, 4.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(19, 22, 17, 0.8)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(screwX - 2.4, screwY1);
    ctx.lineTo(screwX + 2.4, screwY1);
    ctx.stroke();
  }
  ctx.restore();
}

function focusGeometry(layout, part) {
  const { w, h, centerX, platenY, bodyX, bodyW, bodyTop } = layout;
  if (part === "linkage") {
    return {
      x: bodyX + bodyW * 0.928,
      y: bodyTop + h * 0.135,
      radius: Math.max(22, h * 0.039),
      label: "A / LINKAGE",
      anchorX: bodyX + bodyW * 0.895,
      anchorY: bodyTop + h * 0.06,
    };
  }
  if (part === "hammer") {
    return {
      x: centerX,
      y: platenY + 2,
      radius: Math.max(27, h * 0.048),
      label: "B / TYPEBAR",
      anchorX: centerX + w * 0.035,
      anchorY: platenY + 27,
    };
  }
  return {
    x: centerX - Math.min(w * 0.225, 218),
    y: platenY - 20,
    radius: Math.max(23, h * 0.038),
    label: "C / RIBBON",
    anchorX: centerX - Math.min(w * 0.225, 218) + 17,
    anchorY: platenY + 14,
  };
}

function drawInspectionFocus(layout, now) {
  if (!state.focusPart || state.passed) return;
  const geo = focusGeometry(layout, state.focusPart);
  const pulse = 0.56 + Math.sin(now / 650) * 0.17;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = `rgba(210, 179, 110, ${pulse})`;
  ctx.setLineDash([3, 5]);
  ctx.beginPath();
  ctx.arc(geo.x, geo.y, geo.radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = "rgba(210, 179, 110, 0.4)";
  ctx.beginPath();
  ctx.moveTo(geo.anchorX, geo.anchorY);
  ctx.lineTo(geo.x + geo.radius, geo.y - geo.radius * 0.3);
  ctx.stroke();

  ctx.fillStyle = "rgba(18, 23, 17, 0.88)";
  ctx.strokeStyle = "rgba(210, 179, 110, 0.36)";
  ctx.lineWidth = 1;
  const boxW = 83;
  const boxH = 18;
  const boxX = geo.x + geo.radius + 8;
  const boxY = geo.y - geo.radius - 2;
  roundedRect(boxX, boxY, boxW, boxH, 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#c5b78f";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `8px "Courier New", monospace`;
  ctx.fillText(geo.label, boxX + 7, boxY + boxH / 2 + 0.5);

  ctx.fillStyle = `rgba(210, 179, 110, ${pulse})`;
  ctx.beginPath();
  ctx.arc(geo.x, geo.y, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawMachine(layout, now) {
  drawMachineBody(layout);
  drawSideMechanism(layout);
  drawCarriage(layout);
  drawRibbon(layout);
  drawTypebars(layout, now);
  drawKeys(layout, now);
}

function drawSceneVignette(layout) {
  const { w, h } = layout;
  const vignette = ctx.createRadialGradient(w * 0.5, h * 0.44, h * 0.15, w * 0.5, h * 0.44, h * 0.83);
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(0.66, "rgba(0, 0, 0, 0.04)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.55)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "rgba(238, 222, 181, 0.09)";
  ctx.fillRect(0, 0, w, 1);
}

function render(now) {
  if (!sceneWidth || !sceneHeight) {
    resizeCanvas();
  }
  const layout = getLayout();
  ctx.clearRect(0, 0, sceneWidth, sceneHeight);
  drawBackground(layout);
  drawPaper(layout);
  drawMachine(layout, now);
  drawInspectionFocus(layout, now);
  drawSceneVignette(layout);

  state.carriageKick *= 0.94;
  state.paperDrop *= 0.93;
  if (state.strike && now - state.strike.startedAt > 430) {
    state.strike = null;
  }
  requestAnimationFrame(render);
}

const resizeObserver = new ResizeObserver(resizeCanvas);
resizeObserver.observe(canvas);
resizeCanvas();
requestAnimationFrame(render);
