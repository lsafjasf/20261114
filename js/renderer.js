import { CONFIG } from "./engine.js";

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 620;
const FONT_NUM = '"Courier New", "Noto Sans SC Local", monospace';
const FONT_CN = '"Noto Sans SC Local", "PingFang SC", "Microsoft YaHei", sans-serif';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (from, to, amount) => from + (to - from) * amount;

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

function label(ctx, text, x, y, size = 11, color = "#829b92", align = "left", weight = 600) {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${FONT_CN}`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

function mono(ctx, text, x, y, size = 11, color = "#ceff56", align = "left", weight = 600) {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${FONT_NUM}`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

function drawCar(ctx, x, y, width, color, bodyColor = "#d7e8e0", facing = 1) {
  const height = width * 0.42;
  ctx.save();
  ctx.translate(x, y);
  if (facing < 0) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }

  ctx.fillStyle = "rgba(0, 0, 0, 0.34)";
  ctx.beginPath();
  ctx.ellipse(width * 0.5, height * 0.92, width * 0.46, height * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();

  const bodyGradient = ctx.createLinearGradient(0, 0, 0, height);
  bodyGradient.addColorStop(0, bodyColor);
  bodyGradient.addColorStop(0.55, color);
  bodyGradient.addColorStop(1, "#263b37");
  ctx.fillStyle = bodyGradient;
  ctx.beginPath();
  ctx.moveTo(width * 0.04, height * 0.66);
  ctx.lineTo(width * 0.1, height * 0.38);
  ctx.quadraticCurveTo(width * 0.18, height * 0.13, width * 0.38, height * 0.12);
  ctx.lineTo(width * 0.68, height * 0.13);
  ctx.quadraticCurveTo(width * 0.82, height * 0.17, width * 0.93, height * 0.44);
  ctx.lineTo(width * 0.97, height * 0.64);
  ctx.quadraticCurveTo(width * 0.95, height * 0.78, width * 0.84, height * 0.8);
  ctx.lineTo(width * 0.15, height * 0.8);
  ctx.quadraticCurveTo(width * 0.05, height * 0.79, width * 0.04, height * 0.66);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(235, 255, 246, 0.22)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "rgba(8, 27, 26, 0.8)";
  ctx.beginPath();
  ctx.moveTo(width * 0.22, height * 0.4);
  ctx.lineTo(width * 0.34, height * 0.2);
  ctx.lineTo(width * 0.64, height * 0.21);
  ctx.lineTo(width * 0.77, height * 0.42);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.42;
  ctx.stroke();
  ctx.globalAlpha = 1;

  for (const wheelX of [0.27, 0.76]) {
    ctx.fillStyle = "#020606";
    ctx.beginPath();
    ctx.arc(width * wheelX, height * 0.8, height * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#547069";
    ctx.lineWidth = Math.max(1, width * 0.018);
    ctx.stroke();
    ctx.fillStyle = "#a9c2b8";
    ctx.beginPath();
    ctx.arc(width * wheelX, height * 0.8, height * 0.075, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#efffd3";
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.fillRect(width * 0.92, height * 0.47, width * 0.055, height * 0.08);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255, 85, 69, 0.8)";
  ctx.fillRect(width * 0.03, height * 0.5, width * 0.04, height * 0.055);
  ctx.restore();
}

function drawBatteryIcon(ctx, battery, x, y, width, height, selected) {
  const tempRatio = clamp((battery.temp - CONFIG.ambientTemp) / (CONFIG.overheatTemp - CONFIG.ambientTemp), 0, 1);
  const danger = battery.temp >= CONFIG.warningTemp;
  const color = danger ? "#ff6259" : battery.cooling ? "#85d9ff" : battery.color;

  ctx.save();
  if (selected) {
    ctx.shadowColor = "#ceff56";
    ctx.shadowBlur = 14;
  }
  ctx.fillStyle = "#081413";
  roundedRect(ctx, x, y, width, height, 5);
  ctx.fill();
  ctx.strokeStyle = selected ? "#ceff56" : danger ? "#ff6259" : "rgba(159, 210, 192, 0.27)";
  ctx.lineWidth = selected ? 1.6 : 1;
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.fillStyle = "#5d756c";
  ctx.fillRect(x + width * 0.36, y - 3, width * 0.28, 4);

  const fillHeight = height * 0.72 * (battery.charge / 100);
  const fillGradient = ctx.createLinearGradient(0, y + height, 0, y);
  fillGradient.addColorStop(0, "#1e6d5c");
  fillGradient.addColorStop(1, color);
  ctx.fillStyle = fillGradient;
  roundedRect(ctx, x + 4, y + height - fillHeight - 4, width - 8, fillHeight, 2);
  ctx.fill();

  ctx.globalAlpha = 0.45;
  for (let line = 1; line < 4; line += 1) {
    ctx.fillStyle = "#071211";
    ctx.fillRect(x + 4, y + (height * line) / 4, width - 8, 1);
  }
  ctx.globalAlpha = 1;

  if (battery.cooling) {
    const mist = ctx.createLinearGradient(x, y, x + width, y + height);
    mist.addColorStop(0, "rgba(133, 217, 255, 0)");
    mist.addColorStop(0.5, "rgba(133, 217, 255, 0.32)");
    mist.addColorStop(1, "rgba(133, 217, 255, 0)");
    ctx.fillStyle = mist;
    roundedRect(ctx, x, y, width, height, 4);
    ctx.fill();
  }

  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  ctx.fillRect(x + 5, y + 5, width - 10, 2);
  ctx.fillStyle = danger ? "#ff6259" : "#ffcf75";
  ctx.fillRect(x + 4, y + height - 4 - (height - 8) * tempRatio, width - 8, 2);
  ctx.restore();
}

export class StationRenderer {
  constructor(canvas, engine, { getSelectedBattery = () => null, onBatteryClick = () => {} } = {}) {
    this.canvas = canvas;
    this.engine = engine;
    this.ctx = canvas.getContext("2d");
    this.getSelectedBattery = getSelectedBattery;
    this.onBatteryClick = onBatteryClick;
    this.time = 0;
    this.lastServed = 0;
    this.deliveryPulse = -20;
    this.batteryHitboxes = [];
    this.stars = Array.from({ length: 60 }, (_, index) => ({
      x: ((index * 173 + 47) % 1000) + 0.5,
      y: ((index * 83 + 19) % 245) + 8,
      alpha: ((index * 29) % 70) / 100 + 0.15,
      size: (index % 3) * 0.45 + 0.5,
    }));

    canvas.addEventListener("click", (event) => this.handleCanvasClick(event));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
  }

  handleCanvasClick(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * WORLD_WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * WORLD_HEIGHT;
    const hit = this.batteryHitboxes.find(
      (box) => x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height,
    );
    if (hit) this.onBatteryClick(hit.id);
  }

  render(deltaSeconds = 0.016) {
    this.time += deltaSeconds;
    const ctx = this.ctx;
    if (!ctx || this.canvas.width <= 0) return;
    const scaleX = this.canvas.width / WORLD_WIDTH;
    const scaleY = this.canvas.height / WORLD_HEIGHT;
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    ctx.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    if (this.engine.served > this.lastServed) {
      this.lastServed = this.engine.served;
      this.deliveryPulse = this.time;
    }
    if (this.engine.served < this.lastServed) this.lastServed = this.engine.served;

    this.drawBackground(ctx);
    this.drawQueue(ctx);
    this.drawBays(ctx);
    this.drawBatteryRack(ctx);
    this.drawFooter(ctx);
    this.drawOverlayEffects(ctx);
  }

  drawBackground(ctx) {
    const sky = ctx.createLinearGradient(0, 0, 0, WORLD_HEIGHT);
    sky.addColorStop(0, "#071615");
    sky.addColorStop(0.55, "#07100f");
    sky.addColorStop(1, "#030909");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    for (const star of this.stars) {
      ctx.globalAlpha = star.alpha * (0.72 + Math.sin(this.time + star.x) * 0.18);
      ctx.fillStyle = "#c9e1d7";
      ctx.fillRect(star.x, star.y, star.size, star.size);
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = "#050b0b";
    const skyline = [
      [0, 245, 62, 150], [50, 220, 72, 175], [110, 254, 44, 141], [146, 202, 57, 193],
      [198, 237, 86, 158], [270, 188, 60, 207], [322, 230, 92, 165], [400, 211, 46, 184],
      [440, 178, 72, 217], [500, 225, 91, 170], [580, 199, 58, 196], [628, 248, 82, 147],
      [700, 214, 68, 181], [758, 190, 41, 205], [792, 236, 85, 159], [868, 205, 58, 190],
      [916, 245, 84, 150],
    ];
    for (const [x, y, width, height] of skyline) {
      ctx.fillRect(x, y, width, height);
      ctx.fillStyle = "rgba(206, 255, 86, 0.12)";
      ctx.fillRect(x + 5, y + 12, width - 12, 1);
      ctx.fillStyle = "#050b0b";
    }

    const glow = ctx.createRadialGradient(508, 92, 5, 508, 92, 260);
    glow.addColorStop(0, "rgba(206, 255, 86, 0.12)");
    glow.addColorStop(1, "rgba(206, 255, 86, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(240, 0, 540, 340);

    ctx.strokeStyle = "rgba(113, 173, 151, 0.1)";
    ctx.lineWidth = 1;
    for (let x = -200; x <= 1200; x += 68) {
      ctx.beginPath();
      ctx.moveTo(500 + (x - 500) * 0.24, 390);
      ctx.lineTo(x, 620);
      ctx.stroke();
    }
    for (let y = 420; y < 620; y += 34) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1000, y);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(206, 255, 86, 0.22)";
    ctx.setLineDash([24, 18]);
    ctx.beginPath();
    ctx.moveTo(0, 412);
    ctx.quadraticCurveTo(330, 395, 566, 430);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(4, 11, 11, 0.88)";
    ctx.fillRect(0, 0, WORLD_WIDTH, 44);
    ctx.fillStyle = "rgba(206, 255, 86, 0.35)";
    ctx.fillRect(0, 43, WORLD_WIDTH, 1);
  }

  drawQueue(ctx) {
    const x = 24;
    const y = 82;
    const width = 292;
    const height = 488;
    ctx.fillStyle = "rgba(5, 15, 14, 0.78)";
    ctx.strokeStyle = "rgba(149, 196, 178, 0.19)";
    ctx.lineWidth = 1;
    roundedRect(ctx, x, y, width, height, 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(206, 255, 86, 0.07)";
    ctx.fillRect(x, y, 3, height);
    mono(ctx, "ENTRY QUEUE", x + 13, y + 17, 9, "#7f9b90");
    mono(ctx, "LIVE", x + width - 13, y + 17, 9, "#ceff56", "right");
    ctx.fillStyle = "rgba(149, 196, 178, 0.14)";
    ctx.fillRect(x + 12, y + 29, width - 24, 1);

    for (let index = 0; index < 6; index += 1) {
      const rowY = y + 39 + index * 73;
      const rowX = x + 12;
      const rowWidth = width - 24;
      const car = this.engine.queue[index];
      this.drawQueueSlot(ctx, car, index, rowX, rowY, rowWidth, 64);
    }

    const nextArrival = this.engine.cars
      .slice(this.engine.arrivalsDone)
      .sort((a, b) => a.arrival - b.arrival)[0];
    if (nextArrival && this.engine.status !== "won" && this.engine.status !== "lost") {
      const eta = Math.max(0, nextArrival.arrival - this.engine.elapsed);
      mono(
        ctx,
        `NEXT INBOUND  ${eta.toFixed(1).padStart(4, "0")}s`,
        x + 13,
        y + height - 12,
        8,
        "#647d73",
      );
      ctx.fillStyle = "rgba(255, 181, 78, 0.6)";
      ctx.beginPath();
      ctx.arc(x + width - 19, y + height - 12, 2 + Math.sin(this.time * 4) * 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawQueueSlot(ctx, car, index, x, y, width, height) {
    if (!car) {
      ctx.strokeStyle = "rgba(129, 168, 153, 0.09)";
      ctx.setLineDash([4, 6]);
      roundedRect(ctx, x, y, width, height, 2);
      ctx.stroke();
      ctx.setLineDash([]);
      mono(ctx, String(index + 1).padStart(2, "0"), x + 10, y + 13, 8, "#31423c");
      return;
    }

    const patienceRatio = clamp(car.waited / car.patience, 0, 1);
    const remaining = Math.max(0, car.patience - car.waited);
    const critical = patienceRatio > 0.82;
    const urgent = patienceRatio > 0.58;
    const accent = critical ? "#ff6259" : urgent ? "#ffb54e" : car.color;

    ctx.fillStyle = critical ? "rgba(255, 98, 89, 0.08)" : "rgba(9, 24, 21, 0.88)";
    roundedRect(ctx, x, y, width, height, 2);
    ctx.fill();
    ctx.strokeStyle = critical
      ? `rgba(255, 98, 89, ${0.55 + Math.sin(this.time * 7) * 0.2})`
      : "rgba(149, 196, 178, 0.12)";
    ctx.stroke();

    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(x, y, 2, height);
    ctx.globalAlpha = 1;

    mono(ctx, String(index + 1).padStart(2, "0"), x + 8, y + 14, 8, "#617971");
    drawCar(ctx, x + 20, y + 9, 62, accent, car.body, 1);
    mono(ctx, car.id, x + 92, y + 16, 12, "#edf8f1", "left", 700);
    mono(ctx, `DEMAND ${car.demand}%`, x + 92, y + 33, 7, "#70897f");
    mono(ctx, `${remaining.toFixed(1)}s`, x + width - 9, y + 16, 9, accent, "right", 700);
    label(ctx, "耐心", x + width - 40, y + 33, 7, "#566d64", "left");

    ctx.fillStyle = "rgba(125, 168, 151, 0.12)";
    ctx.fillRect(x + 92, y + 45, width - 101, 4);
    ctx.fillStyle = accent;
    ctx.fillRect(x + 92, y + 45, (width - 101) * (1 - patienceRatio), 4);
    for (let mark = 1; mark < 4; mark += 1) {
      ctx.fillStyle = "rgba(5, 13, 12, 0.75)";
      ctx.fillRect(x + 92 + ((width - 101) * mark) / 4, y + 45, 1, 4);
    }

    mono(ctx, `PATIENCE ${Math.round(patienceRatio * 100)}%`, x + 8, y + height - 8, 7, "#42574f");
    if (critical) {
      mono(ctx, "LEAVING", x + width - 9, y + height - 8, 7, "#ff6259", "right", 700);
    } else if (index === 0) {
      mono(ctx, "NEXT", x + width - 9, y + height - 8, 7, "#ceff56", "right", 700);
    }
  }

  drawBays(ctx) {
    mono(ctx, "SERVICE BAYS", 334, 70, 9, "#7f9b90");
    for (let index = 0; index < this.engine.bays.length; index += 1) {
      const bay = this.engine.bays[index];
      const x = 330 + index * 210;
      const y = 82;
      const width = 200;
      const height = 488;
      this.drawBay(ctx, bay, x, y, width, height);
    }
  }

  drawBay(ctx, bay, x, y, width, height) {
    const active = bay.status === "service";
    const cooling = bay.status === "cooldown";
    const modeColor = bay.mode === "swap" ? "#ffb54e" : "#5be7dc";
    const car = active ? this.engine.cars.find((item) => item.id === bay.carId) : null;
    const battery = bay.batteryId
      ? this.engine.batteries.find((item) => item.id === bay.batteryId)
      : null;
    const pulseAge = this.time - this.deliveryPulse;
    const showPulse = pulseAge >= 0 && pulseAge < 0.75;

    ctx.fillStyle = "rgba(4, 14, 13, 0.84)";
    ctx.strokeStyle = active
      ? `${modeColor}77`
      : cooling
        ? "rgba(255, 181, 78, 0.22)"
        : "rgba(149, 196, 178, 0.18)";
    ctx.lineWidth = 1;
    roundedRect(ctx, x, y, width, height, 2);
    ctx.fill();
    ctx.stroke();

    const statusText = active ? (bay.mode === "swap" ? "快换作业" : "慢充作业") : cooling ? "工位切换" : "待命";
    const statusColor = active ? modeColor : cooling ? "#ffb54e" : "#637a71";
    mono(ctx, `BAY 0${bay.id}`, x + 12, y + 17, 9, "#7f9b90");
    ctx.fillStyle = active ? `${modeColor}18` : cooling ? "rgba(255, 181, 78, 0.1)" : "rgba(115, 148, 135, 0.08)";
    ctx.fillRect(x + width - 62, y + 9, 50, 16);
    label(ctx, statusText, x + width - 37, y + 17, 7, statusColor, "center", 700);
    ctx.fillStyle = "rgba(149, 196, 178, 0.13)";
    ctx.fillRect(x + 12, y + 31, width - 24, 1);

    const bayFloor = ctx.createLinearGradient(x, y + 52, x, y + 285);
    bayFloor.addColorStop(0, active ? `${modeColor}0d` : "rgba(16, 38, 33, 0.2)");
    bayFloor.addColorStop(1, "rgba(3, 9, 8, 0.95)");
    ctx.fillStyle = bayFloor;
    ctx.fillRect(x + 11, y + 43, width - 22, 246);

    ctx.strokeStyle = "rgba(149, 196, 178, 0.16)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 17, y + 51);
    ctx.lineTo(x + width - 17, y + 51);
    ctx.stroke();
    ctx.fillStyle = "#405a50";
    ctx.fillRect(x + 18, y + 46, width - 36, 4);
    for (let bolt = 0; bolt < 8; bolt += 1) {
      ctx.fillStyle = "rgba(206, 255, 86, 0.3)";
      ctx.fillRect(x + 25 + bolt * 21, y + 47, 9, 1);
    }

    this.drawRobotArm(ctx, x + width / 2, y + 59, active, bay.mode, bay.id);

    if (active && car) {
      const enterAmount = clamp(bay.progress * 4, 0, 1);
      const carX = lerp(x + 2, x + 24, enterAmount);
      const lift = Math.sin(this.time * 3.2) * 1.2;
      ctx.save();
      if (bay.mode === "charge") {
        ctx.shadowColor = "#5be7dc";
        ctx.shadowBlur = 13 + Math.sin(this.time * 4) * 5;
      }
      drawCar(ctx, carX, y + 138 + lift, 154, car.color, car.body, -1);
      ctx.restore();

      ctx.strokeStyle = "rgba(255, 224, 143, 0.45)";
      ctx.lineWidth = 1;
      for (let vent = 0; vent < 5; vent += 1) {
        const ventX = x + 61 + vent * 19;
        ctx.beginPath();
        ctx.moveTo(ventX, y + 199);
        ctx.lineTo(ventX + 6, y + 204);
        ctx.stroke();
      }

      if (bay.mode === "charge") {
        const cableX = x + width / 2 + 37;
        ctx.strokeStyle = "rgba(91, 231, 220, 0.65)";
        ctx.beginPath();
        ctx.moveTo(x + width - 42, y + 75);
        ctx.bezierCurveTo(cableX + 22, y + 112, cableX + 8, y + 174, x + 163, y + 170);
        ctx.stroke();
        for (let spark = 0; spark < 4; spark += 1) {
          const phase = (this.time * 1.7 + spark * 0.25) % 1;
          ctx.fillStyle = "#ceff56";
          ctx.beginPath();
          ctx.arc(
            lerp(x + width - 42, x + 163, phase),
            lerp(y + 76, y + 170, phase) + Math.sin(phase * Math.PI) * 16,
            1.4,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }
    } else if (cooling) {
      const fade = 1 - clamp(bay.progress, 0, 1);
      ctx.globalAlpha = fade * 0.35;
      const lastCar = bay.lastCarId
        ? this.engine.cars.find((item) => item.id === bay.lastCarId)
        : null;
      if (lastCar) drawCar(ctx, x + 86, y + 152, 82, lastCar.color, lastCar.body, -1);
      ctx.globalAlpha = 1;
      mono(ctx, "SAFE EXIT", x + width / 2, y + 187, 9, "#ffb54e", "center", 700);
    } else {
      ctx.strokeStyle = "rgba(149, 196, 178, 0.13)";
      ctx.setLineDash([7, 8]);
      roundedRect(ctx, x + 35, y + 161, 130, 51, 18);
      ctx.stroke();
      ctx.setLineDash([]);
      mono(ctx, "[ EMPTY ]", x + width / 2, y + 187, 10, "#40564e", "center");
    }

    if (showPulse) {
      const alpha = 1 - pulseAge / 0.75;
      ctx.strokeStyle = `rgba(206, 255, 86, ${alpha * 0.6})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - pulseAge * 6, y - pulseAge * 6, width + pulseAge * 12, height + pulseAge * 12);
    }

    ctx.fillStyle = "rgba(3, 10, 9, 0.9)";
    ctx.fillRect(x + 11, y + 299, width - 22, 3);
    if (active) {
      ctx.fillStyle = modeColor;
      ctx.fillRect(x + 11, y + 299, (width - 22) * clamp(bay.progress, 0, 1), 3);
    } else if (cooling) {
      ctx.fillStyle = "#ffb54e";
      ctx.fillRect(x + 11, y + 299, (width - 22) * clamp(bay.progress, 0, 1), 3);
    }

    if (active && battery) {
      mono(ctx, `${battery.id} / ${battery.temp.toFixed(1)}°C`, x + 12, y + 320, 8, "#728b81");
      mono(ctx, `${bay.remaining.toFixed(1)}s`, x + width - 12, y + 320, 9, modeColor, "right", 700);
      label(ctx, bay.mode === "swap" ? "机械臂拆装" : "恒流充电", x + 12, y + 341, 8, "#9ab0a7");
      label(ctx, car ? `需求 ${car.demand}%` : "", x + width - 12, y + 341, 8, "#728b81", "right");
      const heat = battery ? clamp((battery.temp - 55) / 29, 0, 1) : 0;
      mono(ctx, "THERMAL", x + 12, y + 362, 7, "#52685f");
      ctx.fillStyle = "rgba(149, 196, 178, 0.12)";
      ctx.fillRect(x + 66, y + 360, width - 78, 4);
      ctx.fillStyle = heat > 0.66 ? "#ff6259" : heat > 0.38 ? "#ffb54e" : "#5be7dc";
      ctx.fillRect(x + 66, y + 360, (width - 78) * heat, 4);
    } else if (cooling) {
      mono(ctx, "机械臂归位", x + 12, y + 321, 8, "#8b9e96");
      mono(ctx, `${bay.remaining.toFixed(1)}s`, x + width - 12, y + 321, 9, "#ffb54e", "right", 700);
      label(ctx, "下一单需等待工位切换", x + 12, y + 342, 8, "#6e847a");
    } else {
      label(ctx, "等待调度", x + 12, y + 321, 8, "#61776e");
      mono(ctx, "--", x + width - 12, y + 321, 9, "#50675e", "right");
      label(ctx, "快换 4.8s · 慢充 8.4s", x + 12, y + 341, 8, "#4e645b");
    }

    ctx.strokeStyle = "rgba(149, 196, 178, 0.1)";
    ctx.beginPath();
    ctx.moveTo(x + 12, y + 378);
    ctx.lineTo(x + width - 12, y + 378);
    ctx.stroke();
    for (let light = 0; light < 6; light += 1) {
      ctx.fillStyle = active
        ? light < Math.floor(bay.progress * 6)
          ? modeColor
          : "rgba(149, 196, 178, 0.1)"
        : "rgba(149, 196, 178, 0.08)";
      ctx.fillRect(x + 12 + light * 29, y + 393, 20, 3);
    }

    const heatValue = battery?.temp ?? CONFIG.ambientTemp;
    const gaugeY = y + 422;
    mono(ctx, "BAY TEMP", x + 12, gaugeY, 7, "#536a60");
    mono(ctx, `${heatValue.toFixed(1)}°C`, x + width - 12, gaugeY, 8, heatValue >= CONFIG.warningTemp ? "#ff6259" : "#819a90", "right");
    ctx.fillStyle = "rgba(149, 196, 178, 0.1)";
    ctx.fillRect(x + 12, gaugeY + 12, width - 24, 3);
    ctx.fillStyle = heatValue >= CONFIG.warningTemp ? "#ff6259" : heatValue >= 65 ? "#ffb54e" : "#5be7dc";
    ctx.fillRect(
      x + 12,
      gaugeY + 12,
      (width - 24) * clamp((heatValue - CONFIG.ambientTemp) / 58, 0.02, 1),
      3,
    );
  }

  drawRobotArm(ctx, centerX, topY, active, mode, bayId) {
    const phase = this.time * (mode === "charge" ? 1.4 : 2.7) + bayId;
    const sweep = active ? Math.sin(phase) * 22 : Math.sin(this.time * 0.7 + bayId) * 3;
    const reach = active ? 82 : 34;
    const elbowX = centerX + sweep;
    const elbowY = topY + 30;
    const handX = centerX + sweep * 0.48;
    const handY = topY + reach;

    ctx.fillStyle = "#172a26";
    roundedRect(ctx, centerX - 18, topY - 2, 36, 12, 2);
    ctx.fill();
    ctx.strokeStyle = active ? "rgba(255, 181, 78, 0.78)" : "rgba(124, 159, 145, 0.42)";
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(centerX, topY + 6);
    ctx.lineTo(elbowX, elbowY);
    ctx.lineTo(handX, handY);
    ctx.stroke();
    ctx.strokeStyle = "#06100e";
    ctx.lineWidth = 3;
    ctx.stroke();
    for (const [jointX, jointY] of [
      [centerX, topY + 6],
      [elbowX, elbowY],
      [handX, handY],
    ]) {
      ctx.fillStyle = "#0b1916";
      ctx.beginPath();
      ctx.arc(jointX, jointY, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = active ? "#ffb54e" : "#526a60";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.fillStyle = active ? "#ceff56" : "#496057";
    ctx.fillRect(handX - 8, handY - 1, 16, 3);
    ctx.fillRect(handX - 7, handY + 2, 2, 7);
    ctx.fillRect(handX + 5, handY + 2, 2, 7);
    ctx.lineCap = "butt";
  }

  drawBatteryRack(ctx) {
    const x = 756;
    const y = 82;
    const width = 220;
    const height = 488;
    this.batteryHitboxes = [];
    ctx.fillStyle = "rgba(4, 14, 13, 0.82)";
    ctx.strokeStyle = "rgba(149, 196, 178, 0.19)";
    roundedRect(ctx, x, y, width, height, 2);
    ctx.fill();
    ctx.stroke();

    mono(ctx, "PACK RACK", x + 13, y + 17, 9, "#7f9b90");
    mono(ctx, "4 / 4", x + width - 13, y + 17, 9, "#ceff56", "right");
    ctx.fillStyle = "rgba(149, 196, 178, 0.14)";
    ctx.fillRect(x + 12, y + 29, width - 24, 1);
    mono(ctx, "TEMPERATURE LIMIT", x + 13, y + 42, 7, "#51675e");
    mono(ctx, "84.0°C", x + width - 13, y + 42, 7, "#ff6259", "right");

    const selectedId = this.getSelectedBattery();
    for (let index = 0; index < this.engine.batteries.length; index += 1) {
      const battery = this.engine.batteries[index];
      const cardX = x + 10;
      const cardY = y + 54 + index * 100;
      const cardWidth = width - 20;
      const cardHeight = 92;
      const selected = battery.id === selectedId;
      const warning = battery.temp >= CONFIG.warningTemp;
      const occupied = battery.inUseBay !== null;

      ctx.fillStyle = selected ? "rgba(206, 255, 86, 0.065)" : "rgba(7, 19, 17, 0.9)";
      roundedRect(ctx, cardX, cardY, cardWidth, cardHeight, 2);
      ctx.fill();
      ctx.strokeStyle = warning
        ? `rgba(255, 98, 89, ${0.6 + Math.sin(this.time * 7) * 0.2})`
        : selected
          ? "rgba(206, 255, 86, 0.8)"
          : "rgba(149, 196, 178, 0.13)";
      ctx.lineWidth = selected ? 1.5 : 1;
      ctx.stroke();

      drawBatteryIcon(ctx, battery, cardX + 10, cardY + 18, 45, 60, selected);

      const infoX = cardX + 66;
      mono(ctx, battery.id, infoX, cardY + 16, 12, selected ? "#ceff56" : "#e4f3eb", "left", 700);
      const state = battery.cooling
        ? `液冷 ${battery.coolingRemaining.toFixed(1)}s`
        : occupied
          ? `工位 0${battery.inUseBay}`
          : warning
            ? "高温"
            : "待命";
      mono(
        ctx,
        state,
        cardX + cardWidth - 9,
        cardY + 16,
        7,
        battery.cooling ? "#85d9ff" : warning ? "#ff6259" : occupied ? "#ffb54e" : "#789087",
        "right",
      );

      mono(ctx, `${battery.charge.toFixed(0)}%`, infoX, cardY + 36, 11, "#dff3e8", "left", 700);
      ctx.fillStyle = "rgba(149, 196, 178, 0.12)";
      ctx.fillRect(infoX, cardY + 44, cardWidth - 76, 4);
      const chargeGradient = ctx.createLinearGradient(infoX, 0, cardWidth, 0);
      chargeGradient.addColorStop(0, "#2c9577");
      chargeGradient.addColorStop(1, battery.color);
      ctx.fillStyle = chargeGradient;
      ctx.fillRect(infoX, cardY + 44, (cardWidth - 76) * (battery.charge / 100), 4);

      mono(ctx, `${battery.temp.toFixed(1)}°C`, infoX, cardY + 63, 9, warning ? "#ff6259" : "#9cb1a8", "left", 700);
      mono(
        ctx,
        battery.cooling ? "COOLING" : warning ? "ALERT" : "CORE",
        cardX + cardWidth - 9,
        cardY + 63,
        7,
        battery.cooling ? "#85d9ff" : warning ? "#ff6259" : "#536a60",
        "right",
      );
      ctx.fillStyle = "rgba(149, 196, 178, 0.1)";
      ctx.fillRect(infoX, cardY + 72, cardWidth - 76, 3);
      const tempRatio = clamp(
        (battery.temp - CONFIG.ambientTemp) / (CONFIG.overheatTemp - CONFIG.ambientTemp),
        0,
        1,
      );
      ctx.fillStyle = warning ? "#ff6259" : battery.cooling ? "#85d9ff" : "#ffb54e";
      ctx.fillRect(infoX, cardY + 72, (cardWidth - 76) * tempRatio, 3);

      if (selected) {
        ctx.fillStyle = "#ceff56";
        ctx.fillRect(cardX, cardY, 3, cardHeight);
      }
      if (battery.cooling) {
        ctx.fillStyle = "rgba(133, 217, 255, 0.1)";
        ctx.fillRect(cardX, cardY, cardWidth * (1 - battery.coolingRemaining / CONFIG.coolingDuration), 2);
      }

      this.batteryHitboxes.push({
        id: battery.id,
        x: cardX,
        y: cardY,
        width: cardWidth,
        height: cardHeight,
      });
    }
  }

  drawFooter(ctx) {
    const y = 578;
    ctx.fillStyle = "rgba(4, 12, 11, 0.94)";
    ctx.fillRect(24, y, 952, 30);
    ctx.strokeStyle = "rgba(149, 196, 178, 0.15)";
    ctx.beginPath();
    ctx.moveTo(24, y);
    ctx.lineTo(976, y);
    ctx.stroke();

    mono(ctx, "SHIFT DELIVERIES", 38, y + 15, 7, "#5f776d");
    for (let index = 0; index < CONFIG.targetDeliveries; index += 1) {
      const filled = index < this.engine.served;
      ctx.fillStyle = filled ? "#ceff56" : "rgba(149, 196, 178, 0.13)";
      ctx.fillRect(142 + index * 24, y + 11, 17, 7);
      if (filled) {
        ctx.fillStyle = "rgba(206, 255, 86, 0.2)";
        ctx.fillRect(142 + index * 24, y + 8, 17, 2);
      }
    }

    const hottest = Math.max(...this.engine.batteries.map((battery) => battery.temp));
    mono(ctx, `MAX PACK TEMP  ${hottest.toFixed(1)}°C`, 306, y + 15, 8, hottest >= CONFIG.warningTemp ? "#ff6259" : "#829b92");
    const status = this.engine.paused
      ? "PAUSED"
      : this.engine.status === "won"
        ? "SHIFT COMPLETE"
        : this.engine.status === "lost"
          ? "SHIFT FAILED"
          : this.engine.status === "ready"
            ? "STANDBY"
            : "LIVE / RUSH";
    mono(ctx, status, 690, y + 15, 8, this.engine.status === "lost" ? "#ff6259" : "#ceff56");
    const minutes = Math.floor(this.engine.elapsed / 60);
    const seconds = Math.floor(this.engine.elapsed % 60);
    mono(
      ctx,
      `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${Math.floor((this.engine.elapsed % 1) * 10)}`,
      950,
      y + 15,
      9,
      "#b9cec5",
      "right",
      700,
    );
    if (this.engine.status === "running") {
      ctx.fillStyle = "rgba(206, 255, 86, 0.7)";
      ctx.beginPath();
      ctx.arc(665, y + 15, 2.5 + Math.sin(this.time * 5) * 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawOverlayEffects(ctx) {
    const warningBattery = this.engine.batteries.find(
      (battery) => battery.temp >= CONFIG.warningTemp,
    );
    if (warningBattery && this.engine.status === "running") {
      const alpha = 0.16 + Math.sin(this.time * 6) * 0.08;
      const gradient = ctx.createLinearGradient(0, 0, 0, WORLD_HEIGHT);
      gradient.addColorStop(0, `rgba(255, 98, 89, ${alpha})`);
      gradient.addColorStop(0.15, "rgba(255, 98, 89, 0)");
      gradient.addColorStop(0.85, "rgba(255, 98, 89, 0)");
      gradient.addColorStop(1, `rgba(255, 98, 89, ${alpha})`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      ctx.strokeStyle = `rgba(255, 98, 89, ${alpha + 0.2})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, WORLD_WIDTH - 2, WORLD_HEIGHT - 2);
      mono(ctx, `THERMAL ALERT / ${warningBattery.id}`, 500, 58, 9, "#ff6259", "center", 700);
    }

    if (this.engine.status === "paused") {
      ctx.fillStyle = "rgba(2, 7, 7, 0.5)";
      ctx.fillRect(0, 44, WORLD_WIDTH, WORLD_HEIGHT - 44);
      mono(ctx, "SHIFT PAUSED", WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 8, 25, "#ceff56", "center", 700);
      mono(ctx, "ALL TIMERS FROZEN", WORLD_WIDTH / 2, WORLD_HEIGHT / 2 + 20, 9, "#94aca2", "center");
    }

    const vignette = ctx.createRadialGradient(500, 300, 210, 500, 300, 710);
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.54)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  }
}
