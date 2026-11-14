import { SkyAudio } from "./audio.js";
import { SceneRenderer } from "./renderer.js";
import { MaintenanceWorld } from "./world.js";

const canvas = document.querySelector("#scene");
const startScreen = document.querySelector("#startScreen");
const startButton = document.querySelector("#startButton");
const winScreen = document.querySelector("#winScreen");
const againButton = document.querySelector("#againButton");
const restartButton = document.querySelector("#restartButton");
const soundToggle = document.querySelector("#soundToggle");
const progressValue = document.querySelector("#progressValue");
const anchorMeter = document.querySelector("#anchorMeter");
const cupMeter = document.querySelector("#cupMeter");
const anchorReadout = document.querySelector("#anchorReadout");
const cupReadout = document.querySelector("#cupReadout");
const statusLine = document.querySelector("#statusLine");
const statusText = document.querySelector("#statusText");
const winTime = document.querySelector("#winTime");
const winCup = document.querySelector("#winCup");
const winAngle = document.querySelector("#winAngle");

const world = new MaintenanceWorld();
const renderer = new SceneRenderer(canvas);
const audio = new SkyAudio();

const heldKeys = new Set();
const blockedKeys = new Set([
  "KeyW",
  "KeyS",
  "KeyF",
  "KeyR",
  "ArrowLeft",
  "ArrowRight",
  "Space",
]);

let started = false;
let victoryVisible = false;
let lastTime = performance.now();
let lastCompleteCount = 0;
let statusTone = "neutral";

function currentInput() {
  return {
    up: heldKeys.has("KeyW"),
    down: heldKeys.has("KeyS"),
    left: heldKeys.has("ArrowLeft"),
    right: heldKeys.has("ArrowRight"),
    anchor: heldKeys.has("KeyF"),
    dock: heldKeys.has("Space"),
  };
}

function updateMeter(element, value, color) {
  element.style.transform = `scaleX(${Math.max(0, Math.min(1, value))})`;
  if (color) element.style.background = color;
}

function setStatus(text, tone = "neutral") {
  statusText.textContent = text;
  if (statusTone === tone) return;
  statusTone = tone;
  statusLine.classList.toggle("is-alert", tone === "alert");
  statusLine.classList.toggle("is-good", tone === "good");
}

function deriveStatus() {
  if (!started) return ["等待入舱 · 按“开始检修”", "neutral"];
  if (world.notice) {
    return [world.notice.text, world.notice.tone === "bad" ? "alert" : "good"];
  }
  if (world.cupIntegrity <= 0) return ["吸盘失效 · 按 R 重新开始", "alert"];
  if (world.completed) return ["三个窗框固定完成 · 安全收工", "good"];
  if (world.docking && world.dockProgress > 0) {
    return [
      `吸附中 ${Math.round(world.dockProgress * 100)}% · 两人保持静止`,
      "good",
    ];
  }
  if (world.anchored) {
    return [`锚定中 · 蓄能 ${Math.round(world.anchorEnergy * 100)}%`, "good"];
  }
  if (world.inCaptureZone && world.nearestTarget) {
    if (world.angleSafe) {
      return [`已对准 ${world.nearestTarget.code} · P2 按住 Space 固定`, "good"];
    }
    return [
      `位置接近 · 接触角 ${world.contactAngle.toFixed(1)}° 偏大，请等待收敛`,
      "alert",
    ];
  }
  if (Math.abs(world.contactAngle) > 12) {
    return [
      `摆幅 ${world.contactAngle.toFixed(1)}° · 停止输入，P1 可按 F 短暂锚定`,
      "alert",
    ];
  }
  if (world.windSurge > 1.5) {
    return ["阵风增强 · 注意吊舱摆幅", "alert"];
  }
  return ["寻找窗框 · P1 升降，P2 横移", "neutral"];
}

function updateDom() {
  const completeCount = world.targets.filter((target) => target.complete).length;
  progressValue.textContent = completeCount;
  updateMeter(anchorMeter, world.anchorEnergy);
  updateMeter(
    cupMeter,
    world.cupIntegrity / 100,
    world.cupIntegrity <= 40 ? "#e1695f" : "#e8a85f",
  );
  anchorReadout.textContent = `${Math.round(world.anchorEnergy * 100)}%`;
  cupReadout.textContent = `${Math.round(world.cupIntegrity)}%`;

  const [status, tone] = deriveStatus();
  setStatus(status, tone);

  if (completeCount > lastCompleteCount) {
    lastCompleteCount = completeCount;
  }
}

function resetGame({ keepPlaying = false } = {}) {
  world.reset();
  heldKeys.clear();
  lastCompleteCount = 0;
  victoryVisible = false;
  winScreen.hidden = true;
  startScreen.classList.toggle("is-hidden", keepPlaying);
  started = keepPlaying;
  statusTone = "";
  updateDom();
}

async function startGame() {
  await audio.start();
  world.reset();
  heldKeys.clear();
  started = true;
  victoryVisible = false;
  winScreen.hidden = true;
  startScreen.classList.add("is-hidden");
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  statusTone = "";
  lastCompleteCount = 0;
  updateDom();
}

function showVictory() {
  victoryVisible = true;
  winTime.textContent = world.elapsedLabel;
  winCup.textContent = `${Math.round(world.cupIntegrity)}%`;
  winAngle.textContent = `${world.maxContactAngle.toFixed(1)}°`;
  winScreen.hidden = false;
  updateDom();
}

function processEvents(events) {
  const hasWin = events.some((event) => event.type === "win");
  for (const event of events) {
    if (event.type === "tick") audio.tick();
    if (event.type === "fail") audio.dockFail();
    if (event.type === "success" && !hasWin) audio.dockSuccess();
    if (event.type === "win") {
      audio.dockSuccess();
      audio.win();
    }
  }
}

function frame(now) {
  const delta = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (started) {
    world.update(delta, currentInput());
    processEvents(world.events);
  } else {
    world.windTime += delta;
  }

  audio.update({
    windSpeed: world.windSpeed,
    tension: world.tension,
    swing: world.contactAngle,
    anchored: world.anchored,
    active: started,
  });

  renderer.render(world, currentInput(), started, victoryVisible || world.completed);
  updateDom();

  if (started && world.completed && !victoryVisible && world.winTimer > 1.6) {
    showVictory();
  }

  requestAnimationFrame(frame);
}

window.addEventListener("keydown", (event) => {
  if (blockedKeys.has(event.code)) event.preventDefault();
  if (event.repeat) return;
  if (event.code === "Enter" && !started) {
    startGame();
    return;
  }
  if (event.code === "KeyR") {
    resetGame({ keepPlaying: started });
    return;
  }
  if (started) heldKeys.add(event.code);
});

window.addEventListener("keyup", (event) => {
  if (blockedKeys.has(event.code)) event.preventDefault();
  heldKeys.delete(event.code);
});

window.addEventListener("blur", () => heldKeys.clear());
document.addEventListener("visibilitychange", () => {
  heldKeys.clear();
  lastTime = performance.now();
});

startButton.addEventListener("click", startGame);
againButton.addEventListener("click", startGame);
restartButton.addEventListener("click", () => resetGame({ keepPlaying: started }));

soundToggle.addEventListener("click", async () => {
  await audio.start();
  const muted = !audio.muted;
  audio.setMuted(muted);
  soundToggle.setAttribute("aria-pressed", String(!muted));
  soundToggle.querySelector(".sound-icon").textContent = muted ? "◌" : "◖";
});

document.addEventListener("pointerdown", () => audio.start(), { once: true });

window.__TETHER__ = {
  world,
  audio,
  startGame,
  resetGame,
  getInput: currentInput,
  get started() {
    return started;
  },
};

updateDom();
requestAnimationFrame(frame);
