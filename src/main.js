// Browser entry point. Reuses the identical geometry/shadow/renderer
// modules as the headless Node exporter.

import { renderScene, VIEW } from "./renderer.js";
import {
  buildBooks,
  buildCabinet,
  defaultLights,
  LIGHT_Z,
  project,
  unprojectBack,
} from "./scene.js";

const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d");
const statsEl = document.getElementById("stats");
const listEl = document.getElementById("light-list");

const boards = buildCabinet();
const books = buildBooks();
const lights = defaultLights();
let selectedId = lights[0].id;
let nextId = lights.reduce((max, light) => Math.max(max, light.id), 0) + 1;
let lastStats = null;

const browserCreateCanvas = (w, h) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

function drawHud() {
  if (!lastStats) return;
  ctx.save();
  ctx.fillStyle = "rgba(28,24,20,0.82)";
  ctx.fillRect(16, 16, 300, 92);
  ctx.fillStyle = "#f7ecd4";
  ctx.font = "15px sans-serif";
  ctx.fillText(`Light sources: ${lastStats.lightCount}`, 32, 44);
  ctx.fillText(`Shadow geometry: ${lastStats.geometryMs.toFixed(2)} ms`, 32, 68);
  ctx.fillText(`Mask + blur: ${lastStats.maskMs.toFixed(2)} ms`, 32, 92);
  ctx.restore();
}

function render() {
  lastStats = renderScene(browserCreateCanvas, ctx, lights, boards, books);
  drawHud();
  statsEl.innerHTML =
    `光源数量：<b>${lastStats.lightCount}</b><br>` +
    `阴影几何计算：${lastStats.geometryMs.toFixed(2)} ms<br>` +
    `模糊遮罩：${lastStats.maskMs.toFixed(2)} ms<br>` +
    `本帧总耗时：${lastStats.totalMs.toFixed(2)} ms`;
}

function hitTestLight(screen) {
  for (let i = lights.length - 1; i >= 0; i--) {
    const light = lights[i];
    const pos = project({ x: light.x, y: light.y, z: light.z ?? LIGHT_Z });
    if (Math.hypot(pos.x - screen.x, pos.y - screen.y) <= 14) return light;
  }
  return null;
}

function pointerPos(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * VIEW.width,
    y: ((event.clientY - rect.top) / rect.height) * VIEW.height,
  };
}

let dragging = null;
canvas.addEventListener("pointerdown", (event) => {
  const light = hitTestLight(pointerPos(event));
  if (light) {
    selectedId = light.id;
    dragging = light;
    canvas.setPointerCapture(event.pointerId);
    renderControls();
  }
});

canvas.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  const world = unprojectBack(pointerPos(event));
  dragging.x = Math.max(20, Math.min(460, world.x));
  dragging.y = Math.max(60, Math.min(510, world.y));
  render();
});

canvas.addEventListener("pointerup", () => {
  dragging = null;
});

function renderControls() {
  listEl.innerHTML = "";
  lights.forEach((light) => {
    const card = document.createElement("div");
    card.className = "light-card" + (light.id === selectedId ? " selected" : "");
    card.innerHTML = `
      <div class="light-head">
        <span>光源 #${light.id}</span>
        <label style="margin:0">
          <input type="checkbox" data-role="on" ${light.on ? "checked" : ""} /> 开启
        </label>
      </div>
      <label>柔和度 <span data-role="softness-value">${light.softness}</span> px
        <input type="range" min="0" max="40" step="1" value="${light.softness}" data-role="softness" />
      </label>
      <label>强度 <span data-role="intensity-value">${light.intensity.toFixed(2)}</span>
        <input type="range" min="0.05" max="0.6" step="0.01" value="${light.intensity}" data-role="intensity" />
      </label>
      <div style="margin-top:8px"><button data-role="remove">移除这盏灯</button></div>
    `;
    card.addEventListener("click", () => {
      selectedId = light.id;
      renderControls();
    });
    card.querySelector('[data-role="softness"]').addEventListener("input", (e) => {
      light.softness = Number(e.target.value);
      card.querySelector('[data-role="softness-value"]').textContent = light.softness;
      render();
    });
    card.querySelector('[data-role="intensity"]').addEventListener("input", (e) => {
      light.intensity = Number(e.target.value);
      card.querySelector('[data-role="intensity-value"]').textContent = light.intensity.toFixed(2);
      render();
    });
    card.querySelector('[data-role="on"]').addEventListener("change", (e) => {
      light.on = e.target.checked;
      render();
    });
    card.querySelector('[data-role="remove"]').addEventListener("click", () => {
      const index = lights.indexOf(light);
      lights.splice(index, 1);
      if (selectedId === light.id) selectedId = lights[0]?.id ?? null;
      renderControls();
      render();
    });
    listEl.appendChild(card);
  });
}

document.getElementById("add-light").addEventListener("click", () => {
  lights.push({
    id: nextId++,
    x: 80 + Math.random() * 320,
    y: 380 + Math.random() * 110,
    z: LIGHT_Z,
    softness: 14,
    intensity: 0.3,
    on: true,
  });
  selectedId = lights[lights.length - 1].id;
  renderControls();
  render();
});

document.getElementById("export-png").addEventListener("click", () => {
  const link = document.createElement("a");
  link.download = "bookshelf-scene.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
});

renderControls();
render();
