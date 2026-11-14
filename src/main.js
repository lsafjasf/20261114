import { EngineAudio } from "./audio.js";
import { SceneRenderer } from "./renderer.js";
import {
  createGame,
  deployState,
  handlingLabel,
  nextGuideZone,
  routeToTarget,
  stepGame,
  WORLD
} from "./simulation.js";
import { northPassageOpen, verifyRoutes } from "./world.js";

const canvas = document.querySelector("#sea");
const renderer = new SceneRenderer(canvas);
const audio = new EngineAudio();
const elements = {
  seed: document.querySelector("#seed-label"),
  progress: document.querySelector("#progress-label"),
  zones: document.querySelector("#zone-list"),
  tide: document.querySelector("#tide-label"),
  tideFill: document.querySelector("#tide-fill"),
  tideNote: document.querySelector("#tide-note"),
  returnTime: document.querySelector("#return-time"),
  clockRing: document.querySelector("#clock-ring"),
  cargo: document.querySelector("#cargo-label"),
  pips: document.querySelector("#cargo-pips"),
  speed: document.querySelector("#speed-label"),
  throttle: document.querySelector("#throttle-label"),
  handling: document.querySelector("#handling-label"),
  engineFill: document.querySelector("#engine-fill"),
  status: document.querySelector("#status-chip"),
  toast: document.querySelector("#toast"),
  soundPrompt: document.querySelector("#sound-prompt"),
  verifyPanel: document.querySelector("#verify-panel"),
  verifyContent: document.querySelector("#verify-content"),
  verifyClose: document.querySelector("#verify-close"),
  endScreen: document.querySelector("#end-screen"),
  endKicker: document.querySelector("#end-kicker"),
  endTitle: document.querySelector("#end-title"),
  endCopy: document.querySelector("#end-copy"),
  endStats: document.querySelector("#end-stats"),
  restart: document.querySelector("#restart-button")
};

const params = new URLSearchParams(window.location.search);
const initialSeed = params.get("seed") || "20261114";
let seed = initialSeed;
let game = createGame(seed);
let keys = new Set();
let deployPulse = false;
let routeVisible = true;
let verifyOpen = false;
let audioUnlocked = false;
let lastFrame = performance.now();
let displayTime = 0;
let toastUntil = 0;
let lastPrompt = "";
let warningShown = false;
let strandedTime = 0;
let endVisible = false;
let lastRouteRefresh = -10;
let lastTideWarning = -10;

const ui = {
  time: 0,
  route: null,
  blocked: false
};

function showToast(text, duration = 2200) {
  toastUntil = performance.now() + duration;
  elements.toast.textContent = text;
  elements.toast.classList.add("show");
}

function hideToast() {
  elements.toast.classList.remove("show");
}

function buildZoneList() {
  elements.zones.textContent = "";
  for (const zone of game.world.zones) {
    const row = document.createElement("div");
    row.className = "zone-row";
    row.dataset.zone = zone.id;
    const badge = document.createElement("span");
    badge.className = "zone-badge";
    badge.textContent = zone.id;
    const copy = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = zone.name;
    const note = document.createElement("small");
    note.textContent = zone.note;
    copy.append(name, note);
    const state = document.createElement("i");
    state.className = "zone-state";
    state.textContent = "待布设";
    row.append(badge, copy, state);
    elements.zones.append(row);
  }

  elements.pips.textContent = "";
  for (let index = 0; index < 3; index += 1) {
    const pip = document.createElement("i");
    elements.pips.append(pip);
  }
}

function resetGame() {
  game = createGame(seed);
  keys = new Set();
  deployPulse = false;
  warningShown = false;
  strandedTime = 0;
  endVisible = false;
  routeVisible = true;
  toastUntil = 0;
  lastPrompt = "";
  ui.route = routeToTarget(game);
  buildZoneList();
  elements.seed.textContent = game.world.seedLabel;
  elements.endScreen.classList.remove("open");
  elements.endScreen.setAttribute("aria-hidden", "true");
  hideToast();
  showToast("北湾潮窗正在收窄 · 建议优先布设 A 区", 4200);
}

async function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  const started = await audio.start();
  if (started) elements.soundPrompt.classList.add("hidden");
}

function formatClock(seconds) {
  const safe = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function tideMeters(tide) {
  const profile = game.world.tideProfile;
  return ((tide - profile.start) / (profile.high - profile.start)) * 2.6;
}

function updateUI() {
  const boat = game.boat;
  const speed = Math.hypot(boat.vx, boat.vy);
  const deployed = game.world.zones.filter((zone) => zone.status === "deployed").length;
  elements.progress.textContent = `${deployed} / 3`;
  elements.tide.textContent = `+${tideMeters(game.tide).toFixed(1)} m`;
  const tideProgress = (game.tide - game.world.tideProfile.start)
    / (game.world.tideProfile.high - game.world.tideProfile.start);
  elements.tideFill.style.width = `${Math.max(0, Math.min(1, tideProgress)) * 100}%`;
  elements.returnTime.textContent = formatClock(game.remaining);
  elements.clockRing.style.setProperty("--remaining", game.remaining / WORLD.missionSeconds);
  elements.cargo.textContent = `${boat.cargo} / 3`;
  elements.speed.textContent = (speed / 4.1).toFixed(1);
  elements.throttle.textContent = String(Math.round(Math.abs(boat.engine) * 100));
  elements.handling.textContent = handlingLabel(game);
  elements.engineFill.style.width = `${Math.abs(boat.engine) * 100}%`;

  for (const row of elements.zones.children) {
    const zone = game.world.zones.find((item) => item.id === row.dataset.zone);
    const isDeployed = zone.status === "deployed";
    const isTarget = game.route?.target?.id === zone.id && !isDeployed;
    row.classList.toggle("done", isDeployed);
    row.classList.toggle("active", isTarget);
    row.querySelector(".zone-state").textContent = isDeployed ? "已上线" : isTarget ? "航向" : "待布设";
  }
  [...elements.pips.children].forEach((pip, index) => {
    pip.classList.toggle("spent", index >= boat.cargo);
  });

  if (boat.grounded) {
    elements.status.textContent = "搁浅";
    elements.status.className = "warn";
  } else if (game.phase === "win") {
    elements.status.textContent = "任务完成";
    elements.status.className = "good";
  } else if (game.phase === "lost") {
    elements.status.textContent = "任务中止";
    elements.status.className = "warn";
  } else if (deployState(game) === "ready") {
    elements.status.textContent = "可投放";
    elements.status.className = "good";
  } else {
    elements.status.textContent = "航行中";
    elements.status.className = "";
  }

  const north = game.world.zones.find((zone) => zone.id === "A");
  if (north.status === "deployed") {
    elements.tideNote.textContent = "北湾站已上线，潮窗风险解除";
    elements.tideNote.className = "safe";
  } else if (ui.blocked) {
    elements.tideNote.textContent = "北湾窄口已被浅滩截断";
    elements.tideNote.className = "danger";
  } else if (!northPassageOpen(game.world, game.tide)) {
    elements.tideNote.textContent = "北湾窄口接近封锁";
    elements.tideNote.className = "danger";
  } else if (game.tide > 0.37) {
    elements.tideNote.textContent = "北湾窄口正在收窄";
    elements.tideNote.className = "warn-text";
  } else {
    elements.tideNote.textContent = "北湾窄口尚可通行";
    elements.tideNote.className = "";
  }

  const prompt = game.phase !== "running"
    ? ""
    : deployState(game) === "ready"
      ? `E  在 ${game.world.zones.find((zone) => zone.status !== "deployed" && Math.hypot(zone.x - boat.x, zone.y - boat.y) < zone.radius)?.id || ""} 区投放传感器`
      : boat.grounded
        ? "浅滩擦底 · 倒车脱离"
        : ui.blocked
          ? "北湾航线封锁 · 浅滩正在扩展"
          : "";

  if (prompt && prompt !== lastPrompt && performance.now() > toastUntil) {
    showToast(prompt, 3100);
    lastPrompt = prompt;
  } else if (!prompt) {
    lastPrompt = "";
  }
  if (performance.now() > toastUntil) hideToast();
}

function refreshRoute(force = false) {
  if (!routeVisible) {
    ui.route = null;
    return;
  }
  const target = nextGuideZone(game);
  if (!target) {
    ui.route = null;
    return;
  }
  if (!force && ui.route?.target?.id === target.id && performance.now() - lastRouteRefresh < 720) return;
  lastRouteRefresh = performance.now();
  const route = routeToTarget(game, target);
  game.route = route;
  ui.route = route;
  ui.blocked = target.id === "A" && !route.path;
  if (ui.blocked && !warningShown) {
    warningShown = true;
    showToast("北湾窄口被高潮浅滩截断 · 航线已封锁", 5200);
    audio.warning();
  }
}

function handleEvents(events) {
  for (const event of events) {
    if (event.type === "deployed") {
      audio.chime();
      const left = game.boat.cargo;
      showToast(`${event.zone.id} 区传感器已入水 · 剩余载荷 ${left}`, 3200);
      elements.toast.classList.add("success");
      setTimeout(() => elements.toast.classList.remove("success"), 900);
      refreshRoute(true);
    } else if (event.type === "grounded") {
      audio.warning();
      showToast("浅滩擦底 · 发动机卸载，倒车脱离", 2400);
    } else if (event.type === "driftwood") {
      showToast("撞上漂木 · 修正航向", 1900);
    } else if (event.type === "deploy-failed") {
      const message = event.reason === "outside-zone"
        ? "需驶入投放环内再释放传感器"
        : event.reason === "already-deployed"
          ? "该投放区已经完成"
          : "没有可用的传感器载荷";
      showToast(message, 1900);
    } else if (event.type === "win") {
      showEnd("win");
    } else if (event.type === "lose") {
      showEnd(event.reason);
    }
  }
}

function showEnd(reason) {
  if (endVisible) return;
  endVisible = true;
  const success = reason === "win";
  elements.endScreen.classList.add("open");
  elements.endScreen.setAttribute("aria-hidden", "false");
  elements.endKicker.textContent = success ? "MISSION COMPLETE" : "MISSION ABORTED";
  if (success) {
    elements.endTitle.textContent = "三座传感器已上线";
    elements.endCopy.textContent = "潮位剖面正在回传。维修艇赶在回流前完成布设。";
    audio.chime("win");
  } else if (reason === "passage-blocked") {
    elements.endTitle.textContent = "北湾航道已被浅滩截断";
    elements.endCopy.textContent = "高潮淹过窄口，A 区航线失去可通行水路。";
    audio.warning();
  } else {
    elements.endTitle.textContent = "回流窗口已关闭";
    elements.endCopy.textContent = "传感器未能全部上线，维修艇撤回待命。";
    audio.warning();
  }
  const stats = [
    ["用时", formatClock(game.elapsed)],
    ["已布设", `${game.boat.deployed} / 3`],
    ["最终潮位", `+${tideMeters(game.tide).toFixed(1)} m`]
  ];
  elements.endStats.textContent = "";
  for (const [label, value] of stats) {
    const item = document.createElement("div");
    const key = document.createElement("span");
    const data = document.createElement("strong");
    key.textContent = label;
    data.textContent = value;
    item.append(key, data);
    elements.endStats.append(item);
  }
}

function routeAuditRow(route, index) {
  return `<div class="audit-zone ${route.reachable ? "open" : "closed"}">
    <span class="audit-letter">${route.id}</span>
    <div><strong>${route.name}</strong><small>${route.reachable ? "可通行" : "无通行水路"}</small></div>
    <i>${route.reachable ? "OK" : "BLOCKED"}</i>
  </div>`;
}

function renderVerification() {
  const low = verifyRoutes(game.world, WORLD.startTide);
  const high = verifyRoutes(game.world, 0.88);
  const highBlocked = high.routes.filter((route) => !route.reachable);
  elements.verifyContent.innerHTML = `
    <p class="audit-intro">沿当前种子的 A* 水域网格检查。高潮模拟不会改变本局计时。</p>
    <section class="audit-block">
      <div class="audit-heading"><span>LOW WATER</span><strong>低潮 +0.0 m</strong></div>
      ${low.routes.map(routeAuditRow).join("")}
    </section>
    <section class="audit-block high">
      <div class="audit-heading"><span>FLOOD TIDE</span><strong>高潮 +2.3 m</strong></div>
      ${high.routes.map(routeAuditRow).join("")}
    </section>
    <div class="audit-result ${highBlocked.length ? "passed" : "failed"}">
      <span>${highBlocked.length ? "✓" : "!"}</span>
      <div>
        <strong>${highBlocked.length ? `${highBlocked.map((route) => route.id).join("、")} 区航线被浅滩阻塞` : "高潮航线仍全部开放"}</strong>
        <small>窄口通行状态：${high.passageOpen ? "开放" : "封闭"} · 种子 ${game.world.seedLabel}</small>
      </div>
    </div>
  `;
}

function toggleVerification(force) {
  verifyOpen = typeof force === "boolean" ? force : !verifyOpen;
  if (verifyOpen) renderVerification();
  elements.verifyPanel.classList.toggle("open", verifyOpen);
  elements.verifyPanel.setAttribute("aria-hidden", String(!verifyOpen));
  if (verifyOpen) showToast("航线自检已暂停本局计时", 1600);
}

function toggleRoute() {
  routeVisible = !routeVisible;
  if (!routeVisible) ui.route = null;
  else refreshRoute(true);
  showToast(routeVisible ? "航线提示已开启" : "航线提示已关闭", 1500);
}

function toggleMute() {
  audio.setMuted(!audio.muted);
  showToast(audio.muted ? "引擎声已静音" : "引擎声已恢复", 1400);
}

function handleKeyDown(event) {
  const code = event.code;
  if (!audioUnlocked) unlockAudio();
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(code)) {
    event.preventDefault();
  }
  if (code === "KeyE" && !event.repeat) deployPulse = true;
  if (code === "KeyG" && !event.repeat) toggleRoute();
  if (code === "KeyV" && !event.repeat) toggleVerification();
  if (code === "KeyM" && !event.repeat) toggleMute();
  if (code === "Escape" && verifyOpen) toggleVerification(false);
  if (code === "KeyR" && !event.repeat) {
    resetGame();
    lastRouteRefresh = -10;
  }
  keys.add(code);
}

function controlsFromKeys() {
  const throttle = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0)
    - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
  const steer = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0)
    - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
  return { throttle, steer, deploy: deployPulse };
}

window.addEventListener("keydown", handleKeyDown);
window.addEventListener("keyup", (event) => keys.delete(event.code));
window.addEventListener("blur", () => keys.clear());
window.addEventListener("pointerdown", unlockAudio, { passive: true });
window.addEventListener("resize", () => renderer.resize());
document.addEventListener("visibilitychange", () => {
  lastFrame = performance.now();
});
elements.verifyClose.addEventListener("click", () => toggleVerification(false));
elements.restart.addEventListener("click", () => {
  resetGame();
  lastRouteRefresh = -10;
});

function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  displayTime += dt;

  if (game.phase === "running" && !verifyOpen) {
    const events = stepGame(game, dt, controlsFromKeys());
    deployPulse = false;
    handleEvents(events);

    if (game.phase === "running") {
      refreshRoute();
      if (ui.blocked && game.world.zones[0].status !== "deployed") {
        strandedTime += dt;
        if (strandedTime > 7.5) {
          game.phase = "lost";
          game.reason = "passage-blocked";
          showEnd("passage-blocked");
        }
      } else {
        strandedTime = 0;
      }
      if (game.remaining < 20 && now - lastTideWarning > 5000) {
        lastTideWarning = now;
        audio.warning();
      }
    }
  }

  updateUI();
  ui.time = displayTime;
  renderer.render(game, ui, dt);
  audio.update({
    throttle: game.boat.engine,
    speed: Math.hypot(game.boat.vx, game.boat.vy),
    cargo: game.boat.cargo,
    tide: game.tide,
    phase: game.phase
  });
  requestAnimationFrame(frame);
}

function placeFloodMarker() {
  const profile = game.world.tideProfile;
  let openTide = profile.start;
  let closedTide = profile.high;
  for (let index = 0; index < 24; index += 1) {
    const middle = (openTide + closedTide) / 2;
    if (northPassageOpen(game.world, middle)) openTide = middle;
    else closedTide = middle;
  }
  const closureMarker = ((closedTide - profile.start) / (profile.high - profile.start)) * 100;
  document.querySelector(".flood-mark").style.left = `${closureMarker}%`;
}
renderer.resize();
resetGame();
placeFloodMarker();
window.__tideGame = {
  get game() {
    return game;
  },
  audit: (tide = 0.88) => verifyRoutes(game.world, tide),
  route: () => routeToTarget(game, nextGuideZone(game)),
  reset: resetGame
};
requestAnimationFrame(frame);
