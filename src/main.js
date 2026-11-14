import { RiverAudio } from "./audio.js";
import { FerryGame } from "./game.js";

const $ = (id) => document.getElementById(id);

const words = ["reed", "heron", "lantern", "mist", "tide", "ash", "moon", "ferry"];

function randomSeed() {
  const values = new Uint32Array(2);
  crypto.getRandomValues(values);
  const word = words[values[0] % words.length];
  return `${word}-${String(values[1] % 10000).padStart(4, "0")}`;
}

const ui = {
  seedValue: $("seed-value"),
  objectiveLabel: $("objective-label"),
  objectiveDetail: $("objective-detail"),
  passengerList: $("passenger-list"),
  deliveredCount: $("delivered-count"),
  batchState: $("batch-state"),
  vesselState: $("vessel-state"),
  loadReadout: $("load-readout"),
  loadBar: $("load-bar"),
  speedReadout: $("speed-readout"),
  speedBar: $("speed-bar"),
  handlingNote: $("handling-note"),
  toast: $("toast"),
  damageFlash: $("damage-flash"),
  startScreen: $("start-screen"),
  resultScreen: $("result-screen"),
  resultTime: $("result-time"),
  resultHits: $("result-hits"),
  resultDamage: $("result-damage"),
};

const audio = new RiverAudio();
const game = new FerryGame($("river"), ui, audio);
const seedInput = $("seed-input");
const initialSeed = new URLSearchParams(window.location.search).get("seed") || randomSeed();
seedInput.value = initialSeed;
game.reset(initialSeed);

$("voyage-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const seed = seedInput.value.trim() || randomSeed();
  seedInput.value = seed;
  seedInput.blur();
  const url = new URL(window.location.href);
  url.searchParams.set("seed", seed);
  window.history.replaceState({}, "", url);
  game.start(seed);
});

$("random-seed").addEventListener("click", () => {
  seedInput.value = randomSeed();
  seedInput.focus();
});

$("seed-chip").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(game.seed);
    game.showToast(`种子 ${game.seed} 已复制`, 1500);
  } catch {
    game.showToast(`本次种子：${game.seed}`, 1800);
  }
});

$("sail-again").addEventListener("click", () => {
  game.start(game.seed);
});

const handledKeys = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyM",
  "KeyR",
]);

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (!handledKeys.has(event.code)) return;
  event.preventDefault();

  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) {
    game.setKey(event.code, true);
  }
  if (event.repeat) return;
  if (event.code === "Space") game.soundWhistle();
  if (event.code === "KeyM") game.toggleMute();
  if (event.code === "KeyR") game.restart();
});

window.addEventListener("keyup", (event) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) {
    game.setKey(event.code, false);
  }
});

window.addEventListener("blur", () => game.keys.clear());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) game.keys.clear();
});

let previous = performance.now();
function frame(now) {
  const delta = (now - previous) / 1000;
  previous = now;
  game.update(delta);
  game.renderer.render(game);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__ferryGame = game;
window.__ferryDebug = {
  snapshot: () => game.debugSnapshot(),
  dock: (side) => game.debugDock(side),
  start: (seed) => game.start(seed),
};
