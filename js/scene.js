/* 程序化静态街景，绘制到离屏 canvas，尺寸大于取景框以给手持晃动留边。 */
(function () {
  "use strict";
  const HH = (window.HH = window.HH || globalThis.HH || {}); globalThis.HH = HH;

  HH.SCENE_W = 1920;
  HH.SCENE_H = 1080;
  HH.VIEW_W = 1280;
  HH.VIEW_H = 720;

  function seededRandom(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawBuilding(ctx, rand, x, w, h, baseY, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, baseY - h, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(x, baseY - h, 6, h);
    const cols = Math.max(2, Math.floor(w / 56));
    const rows = Math.max(3, Math.floor(h / 72));
    const gapX = w / cols;
    const gapY = h / rows;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const lit = rand() > 0.55;
        ctx.fillStyle = lit ? "rgba(255,214,140,0.9)" : "rgba(20,28,40,0.85)";
        const wx = x + gapX * c + gapX * 0.24;
        const wy = baseY - h + gapY * r + gapY * 0.22;
        ctx.fillRect(wx, wy, gapX * 0.5, gapY * 0.5);
      }
    }
  }

  function drawCar(ctx, x, y, scale, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = color;
    roundedRect(ctx, -110, -34, 220, 46, 12);
    ctx.fill();
    roundedRect(ctx, -58, -68, 120, 40, 10);
    ctx.fill();
    ctx.fillStyle = "rgba(180,220,255,0.9)";
    ctx.fillRect(-46, -60, 44, 24);
    ctx.fillRect(8, -60, 44, 24);
    ctx.fillStyle = "#15181d";
    ctx.beginPath();
    ctx.arc(-66, 14, 18, 0, Math.PI * 2);
    ctx.arc(66, 14, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,240,180,0.9)";
    ctx.fillRect(96, -22, 10, 12);
    ctx.restore();
  }

  HH.createStreetScene = function createStreetScene() {
    const canvas = document.createElement("canvas");
    canvas.width = HH.SCENE_W;
    canvas.height = HH.SCENE_H;
    const ctx = canvas.getContext("2d");
    const rand = seededRandom(20261114);

    const sky = ctx.createLinearGradient(0, 0, 0, 720);
    sky.addColorStop(0, "#1b2a44");
    sky.addColorStop(0.7, "#3d5170");
    sky.addColorStop(1, "#c98a6a");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, HH.SCENE_W, 720);

    ctx.fillStyle = "rgba(255,225,180,0.85)";
    ctx.beginPath();
    ctx.arc(1480, 180, 46, 0, Math.PI * 2);
    ctx.fill();

    const baseY = 760;
    const palette = ["#2c3544", "#343e50", "#28303d", "#3a4356", "#31394a"];
    let bx = -40;
    while (bx < HH.SCENE_W) {
      const w = 150 + rand() * 130;
      const h = 260 + rand() * 380;
      drawBuilding(ctx, rand, bx, w, h, baseY, palette[Math.floor(rand() * palette.length)]);
      bx += w + 14;
    }

    ctx.fillStyle = "#4a4f57";
    ctx.fillRect(0, baseY - 18, HH.SCENE_W, 18);

    const sidewalk = ctx.createLinearGradient(0, baseY, 0, baseY + 70);
    sidewalk.addColorStop(0, "#8b8f96");
    sidewalk.addColorStop(1, "#6f737a");
    ctx.fillStyle = sidewalk;
    ctx.fillRect(0, baseY, HH.SCENE_W, 70);

    const road = ctx.createLinearGradient(0, 830, 0, 1080);
    road.addColorStop(0, "#3c4046");
    road.addColorStop(1, "#23262b");
    ctx.fillStyle = road;
    ctx.fillRect(0, 830, HH.SCENE_W, 250);

    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 6;
    ctx.setLineDash([46, 40]);
    ctx.beginPath();
    ctx.moveTo(0, 952);
    ctx.lineTo(HH.SCENE_W, 952);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = "#e8c25a";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 838);
    ctx.lineTo(HH.SCENE_W, 838);
    ctx.moveTo(0, 1066);
    ctx.lineTo(HH.SCENE_W, 1066);
    ctx.stroke();

    for (let i = 0; i < 6; i++) {
      const lx = 120 + i * 340;
      ctx.strokeStyle = "#20242b";
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(lx, baseY - 10);
      ctx.lineTo(lx, baseY + 56);
      ctx.stroke();
      ctx.fillStyle = "#2a2f37";
      ctx.fillRect(lx - 26, baseY + 50, 52, 10);
      ctx.fillStyle = "#ffd27a";
      ctx.beginPath();
      ctx.arc(lx, baseY - 18, 12, 0, Math.PI * 2);
      ctx.fill();
    }

    drawCar(ctx, 360, 900, 0.9, "#b3433a");
    drawCar(ctx, 1180, 1010, 1.1, "#3f6fb3");
    drawCar(ctx, 1620, 880, 0.75, "#d8d2c4");

    const people = [
      [620, baseY + 40, 1.0], [700, baseY + 44, 0.92],
      [1380, baseY + 38, 1.05], [1470, baseY + 42, 0.88],
      [250, baseY + 46, 0.95],
    ];
    people.forEach(([px, py, ps], idx) => {
      ctx.save();
      ctx.translate(px, py);
      ctx.scale(ps, ps);
      ctx.fillStyle = idx % 2 ? "#2e3f5c" : "#5c3a3a";
      ctx.beginPath();
      ctx.arc(0, -44, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-10, -34, 20, 34);
      ctx.strokeStyle = "#1d2026";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(-4, 0);
      ctx.lineTo(-10, 26);
      ctx.moveTo(4, 0);
      ctx.lineTo(12, 26);
      ctx.stroke();
      ctx.restore();
    });

    return canvas;
  };
})();
