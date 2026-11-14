import {
  CATEGORY,
  DIRECTIONS,
  DIR_VECTORS,
  GRID_SIZE,
  MODULE_BY_ID,
} from "./data.js";
import { facesFor, placementAt } from "./logic.js";

const FACE_COLORS = {
  P: "#ffc95a",
  O: "#54dbe6",
};

const CATEGORY_COLORS = {
  habitat: "#f2a65a",
  command: "#f3d37a",
  battery: "#ffc95a",
  valve: "#54dbe6",
  utility: "#91a9bb",
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function seeded(seed) {
  let value = seed % 2147483647;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

export class CampRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.tileW = 104;
    this.tileH = 52;
    this.scale = 1;
    this.originX = 0;
    this.originY = 0;
    this.state = {
      placements: [],
      preview: null,
      hover: null,
      selectedId: null,
      report: null,
      showErrors: false,
      hint: null,
    };
    this.stars = [];
    this.dust = [];
    this.effects = [];
    this.lastFrame = performance.now();
    this.previousPlacementIds = new Set();
    this.frame = this.frame.bind(this);
  }

  start() {
    this.resize();
    requestAnimationFrame(this.frame);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.scale = clamp(Math.min(this.width / 790, this.height / 670), 0.68, 1.22);
    this.tileW = 104 * this.scale;
    this.tileH = 52 * this.scale;
    this.originX = this.width * 0.5;
    this.originY = this.height * 0.49 - (GRID_SIZE * this.tileH) / 2;
    this.buildBackdrop();
  }

  buildBackdrop() {
    const random = seeded(4517);
    const horizon = this.height * 0.63;
    this.stars = Array.from({ length: Math.round((this.width * this.height) / 17000) }, () => ({
      x: random() * this.width,
      y: random() * horizon * 1.05 - 10,
      radius: 0.3 + random() * 1.25,
      alpha: 0.18 + random() * 0.68,
      phase: random() * Math.PI * 2,
      speed: 0.15 + random() * 0.45,
    }));
    this.dust = Array.from({ length: 24 }, () => ({
      x: random() * this.width,
      y: horizon + random() * this.height * 0.3,
      radius: 0.6 + random() * 1.4,
      alpha: 0.06 + random() * 0.2,
      drift: 5 + random() * 24,
      phase: random() * Math.PI * 2,
    }));
  }

  update(partial) {
    this.state = { ...this.state, ...partial };
  }

  iso(x, y, lift = 0) {
    return {
      x: this.originX + (x - y) * this.tileW * 0.5,
      y: this.originY + (x + y) * this.tileH * 0.5 - lift,
    };
  }

  cellFromClient(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = clientX - rect.left - this.originX;
    const sy = clientY - rect.top - this.originY;
    const u = sx / (this.tileW * 0.5);
    const v = sy / (this.tileH * 0.5);
    const fx = (u + v) * 0.5;
    const fy = (v - u) * 0.5;
    const x = Math.round(fx);
    const y = Math.round(fy);
    if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) return null;
    const center = this.iso(x, y);
    const dx = Math.abs(clientX - rect.left - center.x) / (this.tileW * 0.5);
    const dy = Math.abs(clientY - rect.top - center.y) / (this.tileH * 0.5);
    return dx + dy <= 1.04 ? { x, y } : null;
  }

  burst(x, y, color = "#ffc95a") {
    const center = this.iso(x, y, 8 * this.scale);
    const random = seeded(840 + x * 17 + y * 31);
    for (let index = 0; index < 24; index += 1) {
      const angle = random() * Math.PI * 2;
      const speed = (8 + random() * 26) * this.scale;
      this.effects.push({
        type: index % 3 === 0 ? "spark" : "dust",
        x: center.x + (random() - 0.5) * this.tileW * 0.4,
        y: center.y + (random() - 0.5) * this.tileH * 0.25,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.42 - random() * 11 * this.scale,
        gravity: 9 * this.scale,
        life: 0.6 + random() * 0.55,
        maxLife: 1.15,
        size: (0.7 + random() * 2.2) * this.scale,
        color,
      });
    }
    this.effects.push({
      type: "ring",
      x: center.x,
      y: center.y + this.tileH * 0.48,
      life: 0.72,
      maxLife: 0.72,
      size: 1,
      color,
    });
  }

  frame(now) {
    const delta = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.updateEffects(delta);
    this.draw(now / 1000);
    requestAnimationFrame(this.frame);
  }

  updateEffects(delta) {
    for (const effect of this.effects) {
      effect.life -= delta;
      if (effect.type === "ring") continue;
      effect.x += effect.vx * delta;
      effect.y += effect.vy * delta;
      effect.vy += effect.gravity * delta;
      effect.vx *= 0.97;
    }
    this.effects = this.effects.filter((effect) => effect.life > 0);
  }

  draw(time) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawBackdrop(time);
    this.drawConstructionField(time);
    this.drawCoverage(time);
    this.drawModules(time);
    this.drawLinks(time);
    this.drawFailureMarks(time);
    this.drawHint(time);
    this.drawPreview(time);
    this.drawEffects();
    this.drawScanlines();
  }

  drawBackdrop(time) {
    const ctx = this.ctx;
    const { width: w, height: h } = this;
    const background = ctx.createLinearGradient(0, 0, 0, h);
    background.addColorStop(0, "#04070c");
    background.addColorStop(0.48, "#07101a");
    background.addColorStop(0.74, "#0b1118");
    background.addColorStop(1, "#05090e");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);

    const blueNebula = ctx.createRadialGradient(w * 0.72, h * 0.26, 0, w * 0.72, h * 0.26, w * 0.46);
    blueNebula.addColorStop(0, "rgba(34, 82, 105, 0.16)");
    blueNebula.addColorStop(0.55, "rgba(20, 51, 70, 0.05)");
    blueNebula.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = blueNebula;
    ctx.fillRect(0, 0, w, h);

    const warmNebula = ctx.createRadialGradient(w * 0.18, h * 0.45, 0, w * 0.18, h * 0.45, w * 0.35);
    warmNebula.addColorStop(0, "rgba(112, 66, 42, 0.075)");
    warmNebula.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = warmNebula;
    ctx.fillRect(0, 0, w, h);

    for (const star of this.stars) {
      const alpha = star.alpha * (0.65 + Math.sin(time * star.speed + star.phase) * 0.35);
      ctx.beginPath();
      ctx.fillStyle = `rgba(218, 236, 241, ${alpha})`;
      ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    this.drawEarth(time);
    this.drawLunarGround(time);
  }

  drawEarth(time) {
    const ctx = this.ctx;
    const radius = clamp(this.width * 0.045, 22, 46);
    const x = this.width * 0.82;
    const y = this.height * 0.19;
    const glow = ctx.createRadialGradient(x, y, radius * 0.2, x, y, radius * 2.4);
    glow.addColorStop(0, "rgba(97, 184, 211, 0.16)");
    glow.addColorStop(1, "rgba(60, 120, 150, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x - radius * 2.4, y - radius * 2.4, radius * 4.8, radius * 4.8);

    const planet = ctx.createRadialGradient(
      x - radius * 0.36,
      y - radius * 0.42,
      radius * 0.05,
      x,
      y,
      radius,
    );
    planet.addColorStop(0, "rgba(191, 231, 231, 0.84)");
    planet.addColorStop(0.32, "rgba(71, 159, 180, 0.7)");
    planet.addColorStop(0.66, "rgba(35, 94, 123, 0.6)");
    planet.addColorStop(1, "rgba(11, 32, 56, 0.2)");
    ctx.beginPath();
    ctx.fillStyle = planet;
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(166, 224, 231, 0.2)";
    ctx.lineWidth = 0.8;
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "rgba(220, 242, 239, 0.18)";
    ctx.beginPath();
    ctx.ellipse(x - radius * 0.16, y - radius * 0.15, radius * 0.35, radius * 0.13, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + radius * 0.32, y + radius * 0.1, radius * 0.25, radius * 0.09, 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawLunarGround(time) {
    const ctx = this.ctx;
    const { width: w, height: h } = this;
    const horizon = h * 0.65;
    const ground = ctx.createLinearGradient(0, horizon - 30, 0, h);
    ground.addColorStop(0, "rgba(16, 23, 30, 0)");
    ground.addColorStop(0.08, "rgba(21, 29, 36, 0.82)");
    ground.addColorStop(0.42, "rgba(12, 18, 24, 0.95)");
    ground.addColorStop(1, "#05080c");
    ctx.fillStyle = ground;
    ctx.beginPath();
    ctx.moveTo(0, horizon + 36);
    ctx.bezierCurveTo(w * 0.16, horizon - 18, w * 0.38, horizon + 12, w * 0.53, horizon - 5);
    ctx.bezierCurveTo(w * 0.72, horizon - 28, w * 0.87, horizon + 27, w, horizon + 3);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(165, 190, 201, 0.09)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, horizon + 36);
    ctx.bezierCurveTo(w * 0.16, horizon - 18, w * 0.38, horizon + 12, w * 0.53, horizon - 5);
    ctx.bezierCurveTo(w * 0.72, horizon - 28, w * 0.87, horizon + 27, w, horizon + 3);
    ctx.stroke();

    const craters = [
      [w * 0.16, h * 0.84, w * 0.16, h * 0.035],
      [w * 0.8, h * 0.88, w * 0.21, h * 0.045],
      [w * 0.49, h * 0.96, w * 0.27, h * 0.04],
    ];
    for (const [x, y, rx, ry] of craters) {
      ctx.beginPath();
      ctx.strokeStyle = "rgba(157, 178, 188, 0.045)";
      ctx.lineWidth = 1;
      ctx.ellipse(x, y, rx, ry, -0.02, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.12)";
      ctx.ellipse(x + 3, y + 2, rx * 0.96, ry * 0.9, -0.02, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const mote of this.dust) {
      const x = mote.x + Math.sin(time * 0.1 + mote.phase) * mote.drift;
      const y = mote.y + Math.cos(time * 0.08 + mote.phase) * 3;
      ctx.fillStyle = `rgba(183, 196, 197, ${mote.alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, mote.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  cellPath(x, y, lift = 0) {
    const center = this.iso(x, y, lift);
    const path = new Path2D();
    path.moveTo(center.x, center.y - this.tileH * 0.5);
    path.lineTo(center.x + this.tileW * 0.5, center.y);
    path.lineTo(center.x, center.y + this.tileH * 0.5);
    path.lineTo(center.x - this.tileW * 0.5, center.y);
    path.closePath();
    return { path, center };
  }

  drawConstructionField(time) {
    const ctx = this.ctx;
    const occupancy = new Map(
      this.state.placements.map((placement) => [`${placement.x},${placement.y}`, placement]),
    );
    const boardCenter = this.iso((GRID_SIZE - 1) / 2, (GRID_SIZE - 1) / 2);
    const fieldRadius = this.tileW * 3.8;

    const fieldGlow = ctx.createRadialGradient(
      boardCenter.x,
      boardCenter.y,
      fieldRadius * 0.15,
      boardCenter.x,
      boardCenter.y,
      fieldRadius,
    );
    fieldGlow.addColorStop(0, "rgba(87, 135, 145, 0.17)");
    fieldGlow.addColorStop(0.62, "rgba(36, 72, 84, 0.07)");
    fieldGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = fieldGlow;
    ctx.beginPath();
    ctx.ellipse(
      boardCenter.x,
      boardCenter.y + this.tileH * 2.2,
      fieldRadius,
      fieldRadius * 0.36,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    ctx.save();
    ctx.setLineDash([4 * this.scale, 9 * this.scale]);
    ctx.strokeStyle = "rgba(126, 184, 194, 0.11)";
    ctx.lineWidth = 1;
    for (let ring = 0; ring < 2; ring += 1) {
      ctx.beginPath();
      ctx.ellipse(
        boardCenter.x,
        boardCenter.y + this.tileH * 2.2,
        fieldRadius * (0.72 + ring * 0.24),
        fieldRadius * (0.27 + ring * 0.08),
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
    ctx.restore();

    for (let y = 0; y < GRID_SIZE; y += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        const occupied = occupancy.get(`${x},${y}`);
        const { path, center } = this.cellPath(x, y);
        const isHover = this.state.hover?.x === x && this.state.hover?.y === y;
        const isHint = this.state.hint?.x === x && this.state.hint?.y === y;
        const checker = (x + y) % 2 === 0;
        const fillAlpha = occupied ? 0.22 : checker ? 0.11 : 0.065;
        ctx.fillStyle = occupied
          ? `rgba(59, 87, 96, ${fillAlpha})`
          : `rgba(47, 70, 79, ${fillAlpha})`;
        ctx.fill(path);

        ctx.strokeStyle = isHover
          ? "rgba(129, 235, 239, 0.55)"
          : isHint
            ? "rgba(255, 201, 90, 0.5)"
            : "rgba(137, 184, 194, 0.19)";
        ctx.lineWidth = isHover || isHint ? 1.2 : 0.75;
        ctx.stroke(path);

        if (occupied) {
          const category = MODULE_BY_ID[occupied.moduleId].category;
          const color = CATEGORY_COLORS[category];
          ctx.save();
          ctx.globalAlpha = 0.12;
          ctx.fillStyle = color;
          ctx.fill(path);
          ctx.restore();
        }

        if (isHover) {
          ctx.save();
          ctx.strokeStyle = "rgba(150, 239, 242, 0.2)";
          ctx.lineWidth = 5 * this.scale;
          ctx.stroke(path);
          ctx.restore();
        }

        if ((x + y) % 3 === 0 && !occupied) {
          ctx.fillStyle = "rgba(157, 196, 205, 0.11)";
          ctx.beginPath();
          ctx.arc(center.x, center.y, 0.9, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    this.drawGridLabels();
    this.drawBoardCornerMarks(time);
  }

  drawGridLabels() {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `${Math.max(6, 7 * this.scale)}px "SFMono-Regular", Consolas, monospace`;
    ctx.fillStyle = "rgba(130, 161, 171, 0.38)";
    ctx.textAlign = "center";
    const letters = ["A", "B", "C", "D", "E"];
    for (let index = 0; index < GRID_SIZE; index += 1) {
      const east = this.iso(index, GRID_SIZE - 1);
      ctx.fillText(letters[index], east.x + this.tileW * 0.34, east.y + this.tileH * 0.56);
      const west = this.iso(GRID_SIZE - 1, index);
      ctx.fillText(`0${index + 1}`, west.x - this.tileW * 0.34, west.y + this.tileH * 0.56);
    }
    ctx.restore();
  }

  drawBoardCornerMarks(time) {
    const ctx = this.ctx;
    const corners = [
      this.iso(0, 0),
      this.iso(GRID_SIZE - 1, 0),
      this.iso(GRID_SIZE - 1, GRID_SIZE - 1),
      this.iso(0, GRID_SIZE - 1),
    ];
    ctx.save();
    ctx.strokeStyle = "rgba(136, 190, 199, 0.24)";
    ctx.lineWidth = 1;
    corners.forEach((corner, index) => {
      const angle = (Math.PI / 2) * index + Math.PI / 4;
      const size = 7 * this.scale;
      ctx.beginPath();
      ctx.moveTo(corner.x + Math.cos(angle - 0.7) * size, corner.y + Math.sin(angle - 0.7) * size);
      ctx.lineTo(corner.x + Math.cos(angle) * size, corner.y + Math.sin(angle) * size);
      ctx.lineTo(corner.x + Math.cos(angle + 0.7) * size, corner.y + Math.sin(angle + 0.7) * size);
      ctx.stroke();
    });
    ctx.restore();
  }

  drawCoverage(time) {
    const ctx = this.ctx;
    for (const placement of this.state.placements) {
      const module = MODULE_BY_ID[placement.moduleId];
      const center = this.iso(placement.x, placement.y);
      let color = null;
      let radius = 0;
      if (module.category === "battery") {
        color = "255, 201, 90";
        radius = this.tileW * 1.35;
      } else if (module.category === "valve") {
        color = "84, 219, 230";
        radius = this.tileW * 1.55;
      } else if (module.crew) {
        color = "236, 171, 109";
        radius = this.tileW * 0.9;
      }
      if (!color) continue;
      const gradient = ctx.createRadialGradient(
        center.x,
        center.y,
        0,
        center.x,
        center.y,
        radius,
      );
      gradient.addColorStop(0, `rgba(${color}, 0.075)`);
      gradient.addColorStop(0.55, `rgba(${color}, 0.025)`);
      gradient.addColorStop(1, `rgba(${color}, 0)`);
      ctx.save();
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(center.x, center.y, radius, radius * 0.48, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    for (const placement of this.state.placements) {
      const module = MODULE_BY_ID[placement.moduleId];
      if (module.category !== "valve" && module.category !== "battery") continue;
      const center = this.iso(placement.x, placement.y);
      const pulse = 0.5 + Math.sin(time * 1.2 + placement.x + placement.y) * 0.5;
      ctx.save();
      ctx.strokeStyle =
        module.category === "valve"
          ? `rgba(84, 219, 230, ${0.08 + pulse * 0.1})`
          : `rgba(255, 201, 90, ${0.07 + pulse * 0.08})`;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3 * this.scale, 7 * this.scale]);
      ctx.beginPath();
      ctx.ellipse(
        center.x,
        center.y,
        this.tileW * (0.65 + pulse * 0.16),
        this.tileH * (0.65 + pulse * 0.16),
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      ctx.restore();
    }
  }

  drawModules(time) {
    const sorted = [...this.state.placements].sort(
      (a, b) => a.x + a.y - (b.x + b.y) || a.x - b.x,
    );
    for (const placement of sorted) {
      this.drawModule(placement, {
        selected: placement.moduleId === this.state.selectedId,
        time,
      });
    }
  }

  moduleGeometry(placement) {
    const center = this.iso(placement.x, placement.y);
    const baseLift = 13 * this.scale;
    const rx = this.tileW * 0.255;
    const ry = this.tileH * 0.19;
    const bodyHeight = 47 * this.scale;
    return {
      center,
      baseLift,
      baseTop: center.y - baseLift,
      rx,
      ry,
      bodyHeight,
      topY: center.y - baseLift - bodyHeight,
    };
  }

  drawModule(placement, options = {}) {
    const ctx = this.ctx;
    const module = MODULE_BY_ID[placement.moduleId];
    const color = CATEGORY_COLORS[module.category];
    const geometry = this.moduleGeometry(placement);
    const { center, baseTop, baseLift, rx, ry, bodyHeight, topY } = geometry;
    const alpha = options.alpha ?? 1;

    ctx.save();
    ctx.globalAlpha = alpha;

    ctx.fillStyle = "rgba(0, 0, 0, 0.42)";
    ctx.beginPath();
    ctx.ellipse(
      center.x + this.tileW * 0.06,
      center.y + this.tileH * 0.18,
      this.tileW * 0.48,
      this.tileH * 0.34,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    const floor = this.cellPath(placement.x, placement.y, 0);
    const top = this.cellPath(placement.x, placement.y, baseLift);
    const topPoints = [
      { x: top.center.x, y: top.center.y - this.tileH * 0.5 },
      { x: top.center.x + this.tileW * 0.5, y: top.center.y },
      { x: top.center.x, y: top.center.y + this.tileH * 0.5 },
      { x: top.center.x - this.tileW * 0.5, y: top.center.y },
    ];
    const floorPoints = [
      { x: floor.center.x, y: floor.center.y - this.tileH * 0.5 },
      { x: floor.center.x + this.tileW * 0.5, y: floor.center.y },
      { x: floor.center.x, y: floor.center.y + this.tileH * 0.5 },
      { x: floor.center.x - this.tileW * 0.5, y: floor.center.y },
    ];

    ctx.fillStyle = "rgba(14, 21, 28, 0.98)";
    ctx.fill(floor.path);
    ctx.fillStyle = "#1b2831";
    ctx.fill(top.path);
    ctx.strokeStyle = "rgba(164, 194, 204, 0.22)";
    ctx.lineWidth = 0.8;
    ctx.stroke(top.path);

    ctx.fillStyle = "#101820";
    ctx.beginPath();
    ctx.moveTo(topPoints[3].x, topPoints[3].y);
    ctx.lineTo(floorPoints[3].x, floorPoints[3].y);
    ctx.lineTo(floorPoints[2].x, floorPoints[2].y);
    ctx.lineTo(topPoints[2].x, topPoints[2].y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#14202a";
    ctx.beginPath();
    ctx.moveTo(topPoints[2].x, topPoints[2].y);
    ctx.lineTo(floorPoints[2].x, floorPoints[2].y);
    ctx.lineTo(floorPoints[1].x, floorPoints[1].y);
    ctx.lineTo(topPoints[1].x, topPoints[1].y);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = `${color}70`;
    ctx.lineWidth = 0.8;
    for (let index = 0; index < 3; index += 1) {
      const t = 0.24 + index * 0.2;
      ctx.beginPath();
      ctx.moveTo(lerp(topPoints[3].x, topPoints[2].x, t), lerp(topPoints[3].y, topPoints[2].y, t));
      ctx.lineTo(lerp(floorPoints[3].x, floorPoints[2].x, t), lerp(floorPoints[3].y, floorPoints[2].y, t));
      ctx.stroke();
    }

    this.drawModuleBody(placement, module, geometry, color, alpha);
    this.drawModulePorts(placement, module, geometry, color);

    if (options.selected) {
      const pulse = 0.55 + Math.sin(options.time * 3.2) * 0.25;
      ctx.save();
      ctx.strokeStyle = `rgba(129, 235, 239, ${pulse})`;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3 * this.scale, 5 * this.scale]);
      ctx.stroke(top.path);
      ctx.restore();
    }

    ctx.restore();
  }

  drawModuleBody(placement, module, geometry, color, alpha) {
    const ctx = this.ctx;
    const { center, baseTop, rx, ry, bodyHeight, topY } = geometry;
    const bottomY = baseTop - 3 * this.scale;

    const bodyGradient = ctx.createLinearGradient(center.x - rx, 0, center.x + rx, 0);
    bodyGradient.addColorStop(0, "#101820");
    bodyGradient.addColorStop(0.34, "#24333c");
    bodyGradient.addColorStop(0.53, "#31444d");
    bodyGradient.addColorStop(0.76, "#1b2932");
    bodyGradient.addColorStop(1, "#0b1218");
    ctx.beginPath();
    ctx.moveTo(center.x - rx, topY);
    ctx.lineTo(center.x - rx, bottomY);
    ctx.bezierCurveTo(
      center.x - rx,
      bottomY + ry * 1.32,
      center.x + rx,
      bottomY + ry * 1.32,
      center.x + rx,
      bottomY,
    );
    ctx.lineTo(center.x + rx, topY);
    ctx.closePath();
    ctx.fillStyle = bodyGradient;
    ctx.fill();

    ctx.save();
    ctx.clip();
    ctx.globalAlpha = 0.2 * alpha;
    ctx.fillStyle = color;
    for (let index = 0; index < 5; index += 1) {
      ctx.fillRect(center.x - rx + index * rx * 0.46, topY, 1, bodyHeight);
    }
    ctx.restore();

    ctx.strokeStyle = "rgba(202, 222, 225, 0.12)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(center.x - rx, topY + bodyHeight * 0.22);
    ctx.lineTo(center.x + rx, topY + bodyHeight * 0.22);
    ctx.moveTo(center.x - rx, bottomY - bodyHeight * 0.11);
    ctx.lineTo(center.x + rx, bottomY - bodyHeight * 0.11);
    ctx.stroke();

    this.drawModuleFaceDetail(module, center, topY, bottomY, rx, ry, bodyHeight, color);

    const capGradient = ctx.createRadialGradient(
      center.x - rx * 0.35,
      topY - ry * 0.25,
      rx * 0.08,
      center.x,
      topY,
      rx,
    );
    capGradient.addColorStop(0, `${color}aa`);
    capGradient.addColorStop(0.42, "#34454d");
    capGradient.addColorStop(1, "#091117");
    ctx.beginPath();
    ctx.ellipse(center.x, topY, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = capGradient;
    ctx.fill();
    ctx.strokeStyle = `${color}bb`;
    ctx.lineWidth = 1.1;
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(center.x, topY - ry * 0.08, rx * 0.72, ry * 0.66, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(3, 10, 14, 0.72)";
    ctx.fill();
    ctx.strokeStyle = `${color}55`;
    ctx.lineWidth = 0.7;
    ctx.stroke();

    this.drawCapDetails(module, center.x, topY, rx, ry, color);
    this.drawModuleLabel(module, center.x, topY - ry - 9 * this.scale, color);
  }

  drawModuleFaceDetail(module, center, topY, bottomY, rx, ry, bodyHeight, color) {
    const ctx = this.ctx;
    const midY = topY + bodyHeight * 0.48;
    const accent = module.category === "battery" ? "255, 201, 90" : module.category === "valve" ? "84, 219, 230" : "245, 184, 119";

    if (module.category === "habitat" || module.category === "command") {
      for (let index = -1; index <= 1; index += 1) {
        const wx = center.x + index * rx * 0.42 - rx * 0.11;
        const wy = midY - ry * 0.15;
        const glow = ctx.createLinearGradient(0, wy, 0, wy + ry * 0.58);
        glow.addColorStop(0, `rgba(${accent}, 0.8)`);
        glow.addColorStop(1, `rgba(${accent}, 0.22)`);
        roundedRect(ctx, wx, wy, rx * 0.23, ry * 0.55, 1);
        ctx.fillStyle = glow;
        ctx.fill();
        ctx.strokeStyle = "rgba(5, 10, 14, 0.85)";
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    } else if (module.category === "battery") {
      for (let index = 0; index < 3; index += 1) {
        const bx = center.x - rx * 0.38 + index * rx * 0.3;
        roundedRect(ctx, bx, midY - ry * 0.25, rx * 0.15, ry * 0.8, 1);
        ctx.fillStyle = index < 2 ? "rgba(255, 201, 90, 0.72)" : "rgba(255, 201, 90, 0.18)";
        ctx.fill();
      }
    } else if (module.category === "valve") {
      ctx.beginPath();
      ctx.arc(center.x, midY + ry * 0.15, Math.max(5, rx * 0.27), 0, Math.PI * 2);
      ctx.fillStyle = "rgba(5, 14, 18, 0.86)";
      ctx.fill();
      ctx.strokeStyle = "rgba(84, 219, 230, 0.8)";
      ctx.lineWidth = 1.1;
      ctx.stroke();
      for (let index = 0; index < 3; index += 1) {
        const angle = (Math.PI * 2 * index) / 3 - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(center.x, midY + ry * 0.15);
        ctx.lineTo(
          center.x + Math.cos(angle) * rx * 0.23,
          midY + ry * 0.15 + Math.sin(angle) * rx * 0.23,
        );
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = "rgba(192, 213, 220, 0.38)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(center.x - rx * 0.32, midY);
      ctx.lineTo(center.x + rx * 0.32, midY);
      ctx.moveTo(center.x, midY - ry * 0.45);
      ctx.lineTo(center.x, midY + ry * 0.45);
      ctx.stroke();
    }

    if (module.category === "command") {
      ctx.strokeStyle = "rgba(243, 211, 122, 0.5)";
      ctx.beginPath();
      ctx.moveTo(center.x + rx * 0.65, topY);
      ctx.lineTo(center.x + rx * 0.65, topY - 18 * this.scale);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(center.x + rx * 0.65, topY - 18 * this.scale, 2 * this.scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawCapDetails(module, x, y, rx, ry, color) {
    const ctx = this.ctx;
    const glyph = CATEGORY[module.category].icon;
    ctx.save();
    ctx.font = `${Math.max(5, 6 * this.scale)}px "SFMono-Regular", Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = `${color}dd`;
    ctx.fillText(glyph, x, y + ry * 0.02);
    ctx.restore();

    const lights = module.beds || module.batteries || module.valves || (module.crew ? 1 : 0);
    for (let index = 0; index < Math.min(3, lights + 1); index += 1) {
      const angle = Math.PI * 0.2 + index * 0.3;
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.45;
      ctx.arc(x + Math.cos(angle) * rx * 0.92, y + Math.sin(angle) * ry * 1.5, 1.2 * this.scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  drawModuleLabel(module, x, y, color) {
    const ctx = this.ctx;
    const fontSize = Math.max(5, 5.9 * this.scale);
    ctx.save();
    ctx.font = `500 ${fontSize}px "SFMono-Regular", Consolas, monospace`;
    const width = ctx.measureText(module.code).width + 9 * this.scale;
    roundedRect(ctx, x - width / 2, y - fontSize * 0.8, width, fontSize * 1.7, 1);
    ctx.fillStyle = "rgba(4, 9, 13, 0.78)";
    ctx.fill();
    ctx.strokeStyle = `${color}45`;
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.fillStyle = `${color}dd`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(module.code, x, y + 0.5);
    ctx.restore();
  }

  drawModulePorts(placement, module, geometry, color) {
    const ctx = this.ctx;
    const { center, baseLift } = geometry;
    const faces = facesFor(module, placement.rotation);
    const edgeAngle = Math.atan2(this.tileH, this.tileW);
    const offsets = {
      N: { x: this.tileW * 0.25, y: -this.tileH * 0.25, angle: edgeAngle },
      E: { x: this.tileW * 0.25, y: this.tileH * 0.25, angle: -edgeAngle },
      S: { x: -this.tileW * 0.25, y: this.tileH * 0.25, angle: edgeAngle },
      W: { x: -this.tileW * 0.25, y: -this.tileH * 0.25, angle: -edgeAngle },
    };
    const exposed = this.exposedPortSet();

    for (let index = 0; index < DIRECTIONS.length; index += 1) {
      const direction = DIRECTIONS[index];
      const face = faces[index];
      if (face === "X") continue;
      const offset = offsets[direction];
      const portX = center.x + offset.x;
      const portY = center.y + offset.y - Math.max(2, baseLift * 0.18);
      const portColor = exposed.has(`${module.id}:${direction}`)
        ? "#ff6d5f"
        : FACE_COLORS[face];

      ctx.save();
      ctx.strokeStyle = face === "P" ? "rgba(255, 201, 90, 0.22)" : "rgba(84, 219, 230, 0.2)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(
        center.x + offset.x * 0.68,
        center.y - baseLift * 0.08 + offset.y * 0.68,
      );
      ctx.lineTo(portX, portY);
      ctx.stroke();

      ctx.translate(portX, portY);
      ctx.rotate(offset.angle);
      ctx.shadowColor = portColor;
      ctx.shadowBlur = 7 * this.scale;
      roundedRect(
        ctx,
        -7 * this.scale,
        -2.2 * this.scale,
        14 * this.scale,
        4.4 * this.scale,
        1.5 * this.scale,
      );
      ctx.fillStyle = portColor;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(2, 8, 11, 0.9)";
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
      ctx.fillRect(-3 * this.scale, -0.5 * this.scale, 6 * this.scale, 0.8 * this.scale);
      ctx.restore();

      ctx.save();
      ctx.translate(portX, portY + 5 * this.scale);
      ctx.rotate(Math.PI / 4);
      ctx.strokeStyle = "rgba(196, 244, 211, 0.35)";
      ctx.lineWidth = 0.6;
      ctx.strokeRect(-1.8 * this.scale, -1.8 * this.scale, 3.6 * this.scale, 3.6 * this.scale);
      ctx.restore();
    }
  }

  exposedPortSet() {
    if (!this.state.showErrors || !this.state.report) return new Set();
    return new Set(
      this.state.report.exposedPorts.map((port) => `${port.moduleId}:${port.direction}`),
    );
  }

  drawLinks(time) {
    const report = this.state.report;
    if (!report) return;
    const ctx = this.ctx;

    for (const link of report.links) {
      if (!link.service) continue;
      const pointA = this.iso(link.ax, link.ay, 3 * this.scale);
      const pointB = this.iso(link.bx, link.by, 3 * this.scale);
      const mx = (pointA.x + pointB.x) * 0.5;
      const my = (pointA.y + pointB.y) * 0.5;
      const eastward = link.bx > link.ax;
      const tx = -this.tileW * 0.235;
      const ty = (eastward ? 1 : -1) * this.tileH * 0.235;
      const color = FACE_COLORS[link.service];

      ctx.save();
      ctx.lineCap = "round";
      ctx.strokeStyle = link.service === "P" ? "rgba(255, 201, 90, 0.11)" : "rgba(84, 219, 230, 0.1)";
      ctx.lineWidth = 6.5 * this.scale;
      ctx.beginPath();
      ctx.moveTo(mx - tx, my - ty);
      ctx.lineTo(mx + tx, my + ty);
      ctx.stroke();

      ctx.strokeStyle = "#081015";
      ctx.lineWidth = 4.3 * this.scale;
      ctx.beginPath();
      ctx.moveTo(mx - tx, my - ty);
      ctx.lineTo(mx + tx, my + ty);
      ctx.stroke();

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.65 * this.scale;
      ctx.beginPath();
      ctx.moveTo(mx - tx, my - ty);
      ctx.lineTo(mx + tx, my + ty);
      ctx.stroke();

      ctx.setLineDash([2.2 * this.scale, 8 * this.scale]);
      ctx.lineDashOffset = -time * 22 * this.scale;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
      ctx.lineWidth = 0.55;
      ctx.beginPath();
      ctx.moveTo(mx - tx, my - ty);
      ctx.lineTo(mx + tx, my + ty);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(Math.PI / 4);
      const pulse = 1 + Math.sin(time * 3 + link.ax + link.ay) * 0.1;
      ctx.strokeStyle = "rgba(201, 248, 215, 0.58)";
      ctx.fillStyle = "rgba(5, 14, 15, 0.8)";
      ctx.lineWidth = 0.7;
      ctx.fillRect(-3.4 * this.scale * pulse, -3.4 * this.scale * pulse, 6.8 * this.scale * pulse, 6.8 * this.scale * pulse);
      ctx.strokeRect(-3.4 * this.scale * pulse, -3.4 * this.scale * pulse, 6.8 * this.scale * pulse, 6.8 * this.scale * pulse);
      ctx.restore();
    }

    for (const link of report.links) {
      if (!link.mismatch) continue;
      const pointA = this.iso(link.ax, link.ay);
      const pointB = this.iso(link.bx, link.by);
      const mx = (pointA.x + pointB.x) * 0.5;
      const my = (pointA.y + pointB.y) * 0.5;
      ctx.save();
      ctx.strokeStyle = "rgba(255, 109, 95, 0.48)";
      ctx.lineWidth = 2.2 * this.scale;
      ctx.beginPath();
      ctx.moveTo(mx - 4 * this.scale, my - 4 * this.scale);
      ctx.lineTo(mx + 4 * this.scale, my + 4 * this.scale);
      ctx.moveTo(mx + 4 * this.scale, my - 4 * this.scale);
      ctx.lineTo(mx - 4 * this.scale, my + 4 * this.scale);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawFailureMarks(time) {
    if (!this.state.showErrors || !this.state.report) return;
    const ctx = this.ctx;
    const report = this.state.report;
    if (report.ok) return;

    const problemCells = new Map();
    const markCells = (components, ids) => {
      if (!components?.length || components.length < 2) return;
      const largest = components.reduce(
        (best, current) => (current.length > best.length ? current : best),
        components[0],
      );
      const largestSet = new Set(largest);
      const idSet = ids ? new Set(ids) : null;
      for (const component of components) {
        if (component === largest) continue;
        for (const moduleId of component) {
          if (idSet && !idSet.has(moduleId)) continue;
          problemCells.set(moduleId, true);
        }
      }
      return largestSet;
    };

    markCells(report.seal.components);
    markCells(report.power.components);
    markCells(report.oxygen.components);

    for (const moduleId of problemCells.keys()) {
      const placement = this.state.placements.find((item) => item.moduleId === moduleId);
      if (!placement) continue;
      const { path, center } = this.cellPath(placement.x, placement.y);
      const pulse = 0.48 + Math.sin(time * 3.4 + placement.x) * 0.2;
      ctx.save();
      ctx.strokeStyle = `rgba(255, 109, 95, ${pulse})`;
      ctx.lineWidth = 1.3;
      ctx.stroke(path);
      ctx.fillStyle = "rgba(255, 109, 95, 0.22)";
      ctx.beginPath();
      ctx.arc(center.x, center.y - 5 * this.scale, 1.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const offsets = {
      N: { x: this.tileW * 0.25, y: -this.tileH * 0.25 },
      E: { x: this.tileW * 0.25, y: this.tileH * 0.25 },
      S: { x: -this.tileW * 0.25, y: this.tileH * 0.25 },
      W: { x: -this.tileW * 0.25, y: -this.tileH * 0.25 },
    };
    for (const port of report.exposedPorts) {
      const center = this.iso(port.x, port.y);
      const offset = offsets[port.direction];
      const px = center.x + offset.x;
      const py = center.y + offset.y;
      const color = FACE_COLORS[port.face];
      ctx.save();
      ctx.strokeStyle = "rgba(255, 109, 95, 0.7)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(px, py, (6 + Math.sin(time * 4 + port.x) * 1.5) * this.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, 1.5 * this.scale, 0, Math.PI * 2);
      ctx.fill();
      for (let index = 0; index < 3; index += 1) {
        const drift = ((time * 12 + index * 9) % 27) * this.scale;
        ctx.fillStyle = `rgba(255, 109, 95, ${0.32 - drift / (120 * this.scale)})`;
        ctx.beginPath();
        ctx.arc(
          px + Math.sin(time * 2 + index) * 3 * this.scale,
          py - drift,
          (1.8 - index * 0.3) * this.scale,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.restore();
    }

    for (const error of report.interfaceErrors.filter((item) => item.code === "mismatch")) {
      const a = this.iso(error.ax, error.ay);
      const b = this.iso(error.bx, error.by);
      const mx = (a.x + b.x) * 0.5;
      const my = (a.y + b.y) * 0.5;
      ctx.save();
      ctx.strokeStyle = "rgba(255, 109, 95, 0.8)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(mx, my, (7 + Math.sin(time * 4) * 1.5) * this.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawHint(time) {
    const hint = this.state.hint;
    if (!hint) return;
    const ctx = this.ctx;
    const { center } = this.cellPath(hint.x, hint.y);
    const module = MODULE_BY_ID[hint.moduleId];
    const pulse = 0.5 + Math.sin(time * 2.4) * 0.5;
    ctx.save();
    ctx.strokeStyle = `rgba(255, 201, 90, ${0.28 + pulse * 0.35})`;
    ctx.lineWidth = 1;
    ctx.setLineDash([4 * this.scale, 5 * this.scale]);
    ctx.lineDashOffset = -time * 12;
    ctx.beginPath();
    ctx.ellipse(
      center.x,
      center.y,
      this.tileW * (0.38 + pulse * 0.06),
      this.tileH * (0.38 + pulse * 0.06),
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
    ctx.restore();

    const text = `${module.code} · 建议落位 · R${hint.rotation * 90}°`;
    const fontSize = Math.max(6, 7 * this.scale);
    ctx.save();
    ctx.font = `500 ${fontSize}px "SFMono-Regular", Consolas, monospace`;
    const width = ctx.measureText(text).width + 14;
    const topY = center.y - this.tileH * 0.95;
    roundedRect(ctx, center.x - width / 2, topY, width, fontSize * 2.2, 1);
    ctx.fillStyle = "rgba(9, 15, 20, 0.9)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 201, 90, 0.4)";
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 212, 126, 0.92)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, center.x, topY + fontSize * 1.1);
    ctx.restore();
  }

  drawPreview(time) {
    const preview = this.state.preview;
    if (!preview) return;
    const ctx = this.ctx;
    const module = MODULE_BY_ID[preview.moduleId];
    if (!module) return;
    const { center, path } = this.cellPath(preview.x, preview.y);
    const color = CATEGORY_COLORS[module.category];
    const pulse = 0.55 + Math.sin(time * 3.2) * 0.2;

    ctx.save();
    ctx.fillStyle = `${color}18`;
    ctx.fill(path);
    ctx.strokeStyle = `rgba(129, 235, 239, ${pulse})`;
    ctx.lineWidth = 1.2;
    ctx.stroke(path);
    ctx.setLineDash([2 * this.scale, 4 * this.scale]);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
    ctx.beginPath();
    ctx.moveTo(center.x, center.y - this.tileH * 0.5);
    ctx.lineTo(center.x, center.y - this.tileH * 2.2);
    ctx.stroke();
    ctx.restore();

    this.drawModule(
      { moduleId: preview.moduleId, x: preview.x, y: preview.y, rotation: preview.rotation },
      { alpha: 0.66, time },
    );

    const fontSize = Math.max(6, 7 * this.scale);
    const text = `R${(preview.rotation * 90) % 360}° · 点击落位`;
    ctx.save();
    ctx.font = `500 ${fontSize}px "SFMono-Regular", Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(182, 243, 245, 0.82)";
    ctx.fillText(text, center.x, center.y + this.tileH * 1.18);
    ctx.restore();
  }

  drawEffects() {
    const ctx = this.ctx;
    for (const effect of this.effects) {
      const progress = 1 - effect.life / effect.maxLife;
      const alpha = clamp(effect.life / effect.maxLife, 0, 1);
      if (effect.type === "ring") {
        ctx.save();
        ctx.strokeStyle = effect.color;
        ctx.globalAlpha = alpha * 0.6;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(
          effect.x,
          effect.y,
          this.tileW * (0.18 + progress * 0.62),
          this.tileH * (0.18 + progress * 0.62),
          0,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.save();
        ctx.globalAlpha = alpha * 0.75;
        ctx.fillStyle = effect.color;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, effect.size * (1 - progress * 0.4), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  drawScanlines() {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = "#b8e4e4";
    for (let y = 0; y < this.height; y += 4) {
      ctx.fillRect(0, y, this.width, 0.4);
    }
    ctx.restore();
  }
}
