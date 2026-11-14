import { DOCK_RULES, WORLD } from "./world.js";

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function mulberry32(seed) {
  let value = seed;
  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, r);
}

function rotatePoint(x, y, angle) {
  return {
    x: x * Math.cos(angle) - y * Math.sin(angle),
    y: x * Math.sin(angle) + y * Math.cos(angle),
  };
}

export class SceneRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.skyStars = [];
    this.rainMotes = [];
    this.skyline = [];
    this.ambientMotes = [];
    this.resize = this.resize.bind(this);
    window.addEventListener("resize", this.resize);
    this.resize();
    this.buildEnvironment();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.scale = Math.min(this.width / WORLD.width, this.height / WORLD.height);
    this.offsetX = (this.width - WORLD.width * this.scale) / 2;
    this.offsetY = (this.height - WORLD.height * this.scale) / 2;
  }

  buildEnvironment() {
    const random = mulberry32(0x03a71f);
    for (let index = 0; index < 95; index += 1) {
      this.skyStars.push({
        x: random() * WORLD.width,
        y: random() * 420,
        size: 0.4 + random() * 1.6,
        alpha: 0.15 + random() * 0.6,
        pulse: random() * TAU,
      });
    }

    for (let index = 0; index < 46; index += 1) {
      this.rainMotes.push({
        x: random() * WORLD.width,
        y: 60 + random() * 720,
        length: 10 + random() * 38,
        alpha: 0.04 + random() * 0.14,
        phase: random(),
      });
    }

    for (let index = 0; index < 75; index += 1) {
      this.ambientMotes.push({
        x: random() * WORLD.width,
        y: 180 + random() * 650,
        size: 0.4 + random() * 1.4,
        alpha: 0.08 + random() * 0.2,
        drift: random() * TAU,
      });
    }

    let cursor = -35;
    while (cursor < WORLD.width) {
      const width = 38 + random() * 110;
      const height = 70 + random() * 260;
      this.skyline.push({
        x: cursor,
        width,
        height,
        top: 720 - height,
        lights: Math.floor(random() * 5),
      });
      cursor += width + 4 + random() * 18;
    }
  }

  render(world, input = {}, started = false, victory = false) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#030c10";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(
      this.dpr * this.scale,
      0,
      0,
      this.dpr * this.scale,
      this.dpr * this.offsetX,
      this.dpr * this.offsetY,
    );

    this.drawSky(world);
    this.drawSkyline(world);
    this.drawAtmosphere(world);
    this.drawCurtainWall(world);
    this.drawTargets(world);
    this.drawTowers(world);
    this.drawRail(world);
    this.drawWindStreaks(world);
    this.drawRig(world, input);
    this.drawTargetReticle(world);
    this.drawInstruments(world);
    this.drawForeground(world);

    if (!started) {
      this.drawStandbyOverlay(world);
    }
    if (victory) {
      this.drawVictoryLight(world);
    }
  }

  drawSky(world) {
    const ctx = this.ctx;
    const gradient = ctx.createLinearGradient(0, 0, 0, WORLD.height);
    gradient.addColorStop(0, "#050f15");
    gradient.addColorStop(0.28, "#0b2029");
    gradient.addColorStop(0.58, "#17333b");
    gradient.addColorStop(0.76, "#26454a");
    gradient.addColorStop(1, "#101d22");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    const horizonGlow = ctx.createRadialGradient(835, 525, 12, 835, 525, 470);
    horizonGlow.addColorStop(0, "rgba(218, 153, 92, 0.16)");
    horizonGlow.addColorStop(0.32, "rgba(111, 127, 114, 0.08)");
    horizonGlow.addColorStop(1, "rgba(4, 14, 18, 0)");
    ctx.fillStyle = horizonGlow;
    ctx.fillRect(250, 80, 1150, 720);

    const haze = ctx.createLinearGradient(0, 430, 0, 720);
    haze.addColorStop(0, "rgba(137, 163, 154, 0)");
    haze.addColorStop(0.6, "rgba(145, 161, 148, 0.1)");
    haze.addColorStop(1, "rgba(9, 24, 29, 0.42)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, 430, WORLD.width, 290);

    for (const star of this.skyStars) {
      const twinkle = 0.55 + Math.sin(world.windTime * 0.45 + star.pulse) * 0.3;
      ctx.globalAlpha = star.alpha * twinkle;
      ctx.fillStyle = "#d5ebe5";
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = "rgba(137, 172, 165, 0.09)";
    ctx.beginPath();
    ctx.arc(1015, 202, 84, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(205, 226, 213, 0.16)";
    ctx.beginPath();
    ctx.arc(1015, 202, 52, 0, TAU);
    ctx.fill();
  }

  drawSkyline(world) {
    const ctx = this.ctx;
    for (let index = 0; index < this.skyline.length; index += 1) {
      const building = this.skyline[index];
      ctx.fillStyle = index % 2 === 0 ? "rgba(8, 23, 29, 0.68)" : "rgba(10, 28, 34, 0.55)";
      ctx.fillRect(building.x, building.top, building.width, 760 - building.top);
      if (building.lights > 0) {
        ctx.fillStyle = "rgba(211, 170, 105, 0.12)";
        for (let light = 0; light < building.lights; light += 1) {
          const x = building.x + 9 + ((light * 23) % Math.max(10, building.width - 16));
          const y = building.top + 18 + ((light * 37) % 90);
          ctx.fillRect(x, y, 2, 2);
        }
      }
    }

    ctx.fillStyle = "rgba(16, 37, 42, 0.55)";
    ctx.fillRect(0, 714, WORLD.width, 186);
    ctx.strokeStyle = "rgba(179, 198, 190, 0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 714);
    ctx.lineTo(WORLD.width, 714);
    ctx.stroke();
  }

  drawAtmosphere(world) {
    const ctx = this.ctx;
    const drift = world.windTime * (2.5 + world.windSpeed * 0.2) * world.windDirection;
    for (let layer = 0; layer < 4; layer += 1) {
      const y = 360 + layer * 88;
      const x = ((layer * 390 + drift * (0.22 + layer * 0.06)) % 1780) - 220;
      ctx.fillStyle = `rgba(151, 175, 166, ${0.015 + layer * 0.007})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 250 + layer * 55, 19 + layer * 3, -0.03, 0, TAU);
      ctx.ellipse(x + 240, y + 4, 170 + layer * 42, 14 + layer * 2, 0.02, 0, TAU);
      ctx.fill();
    }

    for (const mote of this.ambientMotes) {
      const x = mote.x + Math.sin(world.windTime * 0.24 + mote.drift) * 18;
      const y = mote.y + Math.cos(world.windTime * 0.31 + mote.drift) * 9;
      ctx.globalAlpha = mote.alpha * (0.55 + Math.sin(world.windTime + mote.drift) * 0.3);
      ctx.fillStyle = "#c9ddd5";
      ctx.beginPath();
      ctx.arc(x, y, mote.size, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawCurtainWall(world) {
    const ctx = this.ctx;
    const x = 398;
    const y = 110;
    const width = 656;
    const height = 722;

    ctx.fillStyle = "rgba(2, 10, 13, 0.45)";
    ctx.fillRect(x - 16, y + 10, width + 32, height);

    const glass = ctx.createLinearGradient(x, y, x + width, y + height);
    glass.addColorStop(0, "#122b33");
    glass.addColorStop(0.35, "#18353b");
    glass.addColorStop(0.72, "#10252c");
    glass.addColorStop(1, "#0a181e");
    ctx.fillStyle = glass;
    ctx.fillRect(x, y, width, height);

    const columnWidth = 82;
    const rowHeight = 62;
    for (let row = 0; row < 12; row += 1) {
      for (let column = 0; column < 8; column += 1) {
        const px = x + column * columnWidth;
        const py = y + row * rowHeight;
        const lit = (row * 7 + column * 11) % 17 === 0 || (column === 6 && row === 2);
        ctx.fillStyle = lit ? "rgba(174, 150, 101, 0.075)" : "rgba(98, 146, 148, 0.022)";
        ctx.fillRect(px + 2, py + 2, columnWidth - 4, rowHeight - 4);
        if ((row + column) % 5 === 0) {
          ctx.strokeStyle = "rgba(174, 211, 203, 0.045)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(px + 7, py + rowHeight - 8);
          ctx.lineTo(px + columnWidth * 0.7, py + 5);
          ctx.stroke();
        }
      }
    }

    ctx.strokeStyle = "rgba(153, 190, 183, 0.11)";
    ctx.lineWidth = 1;
    for (let column = 0; column <= 8; column += 1) {
      const px = x + column * columnWidth;
      ctx.beginPath();
      ctx.moveTo(px, y);
      ctx.lineTo(px, y + height);
      ctx.stroke();
    }
    for (let row = 0; row <= 12; row += 1) {
      const py = y + row * rowHeight;
      ctx.beginPath();
      ctx.moveTo(x, py);
      ctx.lineTo(x + width, py);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(7, 23, 28, 0.72)";
    ctx.fillRect(x - 17, y, 17, height);
    ctx.fillStyle = "rgba(7, 23, 28, 0.8)";
    ctx.fillRect(x + width, y, 18, height);
    ctx.fillStyle = "rgba(167, 197, 188, 0.17)";
    ctx.fillRect(x - 17, y, 1, height);
    ctx.fillRect(x + width + 17, y, 1, height);

    ctx.fillStyle = "rgba(7, 22, 27, 0.9)";
    ctx.fillRect(x - 32, y - 29, width + 64, 30);
    ctx.fillStyle = "rgba(177, 205, 195, 0.2)";
    ctx.fillRect(x - 32, y - 29, width + 64, 1);
    for (let index = 0; index < 8; index += 1) {
      const lx = x - 20 + index * 88;
      ctx.fillStyle = "rgba(223, 177, 101, 0.23)";
      ctx.fillRect(lx, y - 24, 5, 2);
    }
  }

  drawTargets(world) {
    const ctx = this.ctx;
    const pulse = (Math.sin(world.windTime * 2.3) + 1) / 2;

    for (const target of world.targets) {
      const { x, y, width, height, complete } = target;
      const nearest = world.nearestTarget === target;
      const left = x - width / 2;
      const top = y - height / 2;
      const activeGlow = nearest && !complete ? 0.17 + pulse * 0.1 : 0;

      if (!complete) {
        const glow = ctx.createRadialGradient(x, y, 12, x, y, 118);
        glow.addColorStop(0, `rgba(225, 174, 100, ${activeGlow})`);
        glow.addColorStop(1, "rgba(225, 174, 100, 0)");
        ctx.fillStyle = glow;
        ctx.fillRect(x - 130, y - 130, 260, 260);
      }

      ctx.fillStyle = complete ? "rgba(101, 156, 127, 0.17)" : "rgba(28, 63, 68, 0.72)";
      ctx.fillRect(left + 7, top + 7, width - 14, height - 14);
      const glass = ctx.createLinearGradient(left, top, left + width, top + height);
      glass.addColorStop(0, complete ? "rgba(93, 135, 112, 0.18)" : "rgba(81, 122, 126, 0.12)");
      glass.addColorStop(0.55, complete ? "rgba(167, 202, 174, 0.08)" : "rgba(11, 31, 36, 0.1)");
      glass.addColorStop(1, "rgba(4, 17, 22, 0.45)");
      ctx.fillStyle = glass;
      ctx.fillRect(left + 9, top + 9, width - 18, height - 18);

      ctx.strokeStyle = complete
        ? "rgba(151, 211, 166, 0.74)"
        : nearest
          ? `rgba(231, 183, 111, ${0.64 + pulse * 0.28})`
          : "rgba(146, 179, 172, 0.38)";
      ctx.lineWidth = complete || nearest ? 2 : 1;
      ctx.strokeRect(left + 4, top + 4, width - 8, height - 8);
      ctx.lineWidth = 1;
      ctx.strokeStyle = complete ? "rgba(151, 211, 166, 0.24)" : "rgba(211, 232, 224, 0.14)";
      ctx.strokeRect(left + 10, top + 10, width - 20, height - 20);

      ctx.font = "500 10px 'SFMono-Regular', monospace";
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(8, 28, 33, 0.75)";
      ctx.fillRect(left + 2, top - 21, 73, 14);
      ctx.fillStyle = complete ? "#a9dcb5" : nearest ? "#e8c383" : "rgba(168, 194, 187, 0.65)";
      ctx.fillText(target.code, left + 10, top - 10);

      if (nearest && !complete) {
        const cx = target.x;
        const cy = target.y;
        const halfW = DOCK_RULES.captureX;
        const halfH = DOCK_RULES.captureY;
        ctx.setLineDash([5, 7]);
        ctx.strokeStyle = world.inCaptureZone
          ? "rgba(166, 221, 161, 0.72)"
          : "rgba(229, 188, 120, 0.38)";
        ctx.strokeRect(cx - halfW, cy - halfH, halfW * 2, halfH * 2);
        ctx.setLineDash([]);
        ctx.strokeStyle = world.inCaptureZone
          ? "rgba(173, 228, 168, 0.9)"
          : "rgba(229, 188, 120, 0.75)";
        const bracket = 13;
        const bx = cx - halfW;
        const by = cy - halfH;
        ctx.beginPath();
        ctx.moveTo(bx, by + bracket);
        ctx.lineTo(bx, by);
        ctx.lineTo(bx + bracket, by);
        ctx.moveTo(cx + halfW - bracket, by);
        ctx.lineTo(cx + halfW, by);
        ctx.lineTo(cx + halfW, by + bracket);
        ctx.moveTo(bx, cy + halfH - bracket);
        ctx.lineTo(bx, cy + halfH);
        ctx.lineTo(bx + bracket, cy + halfH);
        ctx.moveTo(cx + halfW - bracket, cy + halfH);
        ctx.lineTo(cx + halfW, cy + halfH);
        ctx.lineTo(cx + halfW, cy + halfH - bracket);
        ctx.stroke();
      }

      if (complete) {
        ctx.fillStyle = "rgba(5, 19, 23, 0.76)";
        roundRect(ctx, x - 45, y - 16, 90, 32, 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(154, 208, 167, 0.55)";
        ctx.stroke();
        ctx.fillStyle = "#a8dab2";
        ctx.font = "600 10px 'SFMono-Regular', monospace";
        ctx.textAlign = "center";
        ctx.fillText("✓  SEALED", x, y + 4);
      }
    }
  }

  drawTowers(world) {
    const ctx = this.ctx;
    this.drawTower(ctx, { x: -60, y: 58, width: 338, height: 880, side: "left" }, world);
    this.drawTower(ctx, { x: 1162, y: 92, width: 338, height: 850, side: "right" }, world);

    this.drawAnchor(ctx, WORLD.leftAnchor.x, WORLD.leftAnchor.y, 1);
    this.drawAnchor(ctx, WORLD.rightAnchor.x, WORLD.rightAnchor.y, -1);
  }

  drawTower(ctx, box, world) {
    const { x, y, width, height, side } = box;
    const edge = side === "left" ? x + width : x;
    const inward = side === "left" ? -1 : 1;

    const body = ctx.createLinearGradient(x, y, edge, y);
    if (side === "left") {
      body.addColorStop(0, "rgba(5, 16, 21, 0.98)");
      body.addColorStop(0.7, "rgba(11, 30, 35, 0.96)");
      body.addColorStop(1, "rgba(20, 42, 45, 0.95)");
    } else {
      body.addColorStop(0, "rgba(20, 42, 45, 0.95)");
      body.addColorStop(0.3, "rgba(11, 30, 35, 0.96)");
      body.addColorStop(1, "rgba(5, 16, 21, 0.98)");
    }
    ctx.fillStyle = body;
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = "rgba(156, 190, 182, 0.14)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, width, height);

    for (let row = 0; row < 17; row += 1) {
      const wy = y + 49 + row * 43;
      for (let column = 0; column < 5; column += 1) {
        const wx = x + 28 + column * 57;
        if ((row * 3 + column * 5) % 8 === 0) {
          ctx.fillStyle = "rgba(213, 167, 101, 0.1)";
          ctx.fillRect(wx, wy, 22, 17);
        } else {
          ctx.fillStyle = "rgba(108, 151, 150, 0.055)";
          ctx.fillRect(wx, wy, 22, 17);
        }
        ctx.strokeStyle = "rgba(157, 191, 182, 0.045)";
        ctx.strokeRect(wx, wy, 22, 17);
      }
      ctx.fillStyle = "rgba(150, 187, 179, 0.07)";
      ctx.fillRect(x + 16, wy + 27, width - 32, 1);
    }

    ctx.fillStyle = "rgba(139, 181, 173, 0.12)";
    ctx.fillRect(edge + inward * 14, y, 1, height);
    ctx.fillStyle = "rgba(5, 15, 19, 0.75)";
    ctx.fillRect(edge + inward * 2 - (side === "left" ? 17 : 0), y, 17, height);

    for (let index = 0; index < 3; index += 1) {
      const mastX = x + width * (0.25 + index * 0.28);
      const mastTop = y - 42 - index * 11;
      ctx.strokeStyle = "rgba(144, 179, 171, 0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(mastX, y + 6);
      ctx.lineTo(mastX, mastTop);
      ctx.stroke();
      if (index === 0) {
        ctx.fillStyle = "rgba(224, 93, 77, 0.75)";
        ctx.beginPath();
        ctx.arc(mastX, mastTop, 2.5, 0, TAU);
        ctx.fill();
      }
    }

    ctx.fillStyle = "rgba(164, 198, 189, 0.14)";
    ctx.fillRect(x + 16, y + 14, width - 32, 2);
    ctx.fillStyle = "rgba(225, 170, 96, 0.24)";
    ctx.fillRect(edge + inward * 25, y + 42, 7, 2);

    const beaconY = y + 20;
    const pulse = 0.55 + Math.sin(world.windTime * 2.8 + (side === "left" ? 0 : 1.6)) * 0.45;
    ctx.fillStyle = `rgba(224, 92, 75, ${0.4 + pulse * 0.4})`;
    ctx.beginPath();
    ctx.arc(edge + inward * 30, beaconY, 2.2, 0, TAU);
    ctx.fill();
  }

  drawAnchor(ctx, x, y, direction) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "#193139";
    ctx.strokeStyle = "rgba(191, 219, 210, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -15);
    ctx.lineTo(direction * 31, -9);
    ctx.lineTo(direction * 31, 11);
    ctx.lineTo(0, 17);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#69d8dc";
    ctx.fillRect(direction * 18 - 1, -3, 3, 7);
    ctx.fillStyle = "rgba(232, 168, 95, 0.55)";
    ctx.fillRect(direction * 25 - 1, 6, 2, 2);
    ctx.restore();
  }

  drawRail(world) {
    const ctx = this.ctx;
    const { leftAnchor, rightAnchor } = WORLD;
    const segments = 96;

    ctx.strokeStyle = "rgba(1, 7, 10, 0.52)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let index = 0; index <= segments; index += 1) {
      const x = leftAnchor.x + ((rightAnchor.x - leftAnchor.x) * index) / segments;
      const y = world.railHeightAt(x) + 3;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.strokeStyle = "rgba(174, 204, 195, 0.38)";
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    for (let index = 0; index <= segments; index += 1) {
      const x = leftAnchor.x + ((rightAnchor.x - leftAnchor.x) * index) / segments;
      const y = world.railHeightAt(x);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.strokeStyle = "rgba(105, 216, 220, 0.13)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let index = 0; index <= segments; index += 1) {
      const x = leftAnchor.x + ((rightAnchor.x - leftAnchor.x) * index) / segments;
      const y = world.railHeightAt(x) - 1;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    const trolleyY = world.railHeightAt(world.trolleyX);
    const twinkle = 0.55 + Math.sin(world.windTime * 3.1) * 0.25;
    ctx.save();
    ctx.translate(world.trolleyX, trolleyY);
    ctx.fillStyle = "rgba(3, 12, 16, 0.82)";
    roundRect(ctx, -30, -10, 60, 22, 3);
    ctx.fill();
    ctx.strokeStyle = "rgba(139, 182, 174, 0.44)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#122a31";
    ctx.fillRect(-23, -16, 8, 9);
    ctx.fillRect(15, -16, 8, 9);
    ctx.fillStyle = "#69d8dc";
    ctx.fillRect(-20, -5, 4, 8);
    ctx.fillStyle = `rgba(226, 94, 76, ${twinkle})`;
    ctx.beginPath();
    ctx.arc(22, 7, 2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(211, 231, 223, 0.22)";
    ctx.fillRect(-9, 10, 18, 2);
    ctx.restore();

    const lamp = ctx.createLinearGradient(0, trolleyY, 0, trolleyY + 250);
    lamp.addColorStop(0, "rgba(144, 205, 190, 0.075)");
    lamp.addColorStop(1, "rgba(144, 205, 190, 0)");
    ctx.fillStyle = lamp;
    ctx.beginPath();
    ctx.moveTo(world.trolleyX - 18, trolleyY + 8);
    ctx.lineTo(world.trolleyX + 18, trolleyY + 8);
    ctx.lineTo(world.trolleyX + 105, trolleyY + 245);
    ctx.lineTo(world.trolleyX - 105, trolleyY + 245);
    ctx.closePath();
    ctx.fill();
  }

  drawWindStreaks(world) {
    const ctx = this.ctx;
    const direction = world.windDirection;
    const speedFactor = 23 + world.windSpeed * 9.5;
    for (const mote of this.rainMotes) {
      let x = mote.x + world.windTime * speedFactor * direction;
      x = ((x + 180) % (WORLD.width + 360) + WORLD.width + 360) % (WORLD.width + 360) - 180;
      const y = mote.y + Math.sin(world.windTime * 0.35 + mote.phase * TAU) * 7;
      const length = mote.length * (0.45 + world.windSpeed / 17);
      ctx.strokeStyle = `rgba(187, 214, 205, ${mote.alpha * (0.45 + world.windSpeed / 16)})`;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - direction * length, y + length * 0.1);
      ctx.stroke();
    }
  }

  drawRig(world) {
    const ctx = this.ctx;
    const bodyTop = rotatePoint(0, -54, world.angle);
    const topX = world.gondolaX + bodyTop.x;
    const topY = world.gondolaY + bodyTop.y;
    const trolleyY = world.railHeightAt(world.trolleyX);

    ctx.strokeStyle = "rgba(3, 10, 13, 0.64)";
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(world.trolleyX, trolleyY + 7);
    ctx.lineTo(topX + 2, topY + 2);
    ctx.stroke();

    ctx.strokeStyle = world.anchored ? "#8ae5d4" : "rgba(181, 207, 198, 0.66)";
    ctx.lineWidth = world.anchored ? 2 : 1.4;
    ctx.beginPath();
    ctx.moveTo(world.trolleyX, trolleyY + 8);
    ctx.lineTo(topX, topY);
    ctx.stroke();

    ctx.strokeStyle = "rgba(105, 216, 220, 0.15)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(world.trolleyX, trolleyY + 8);
    ctx.lineTo(topX, topY);
    ctx.stroke();

    if (world.anchored) {
      ctx.setLineDash([2, 5]);
      ctx.strokeStyle = "rgba(138, 229, 212, 0.52)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(topX, topY + 12, 18 + Math.sin(world.windTime * 7) * 2, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.save();
    ctx.translate(world.gondolaX, world.gondolaY);
    ctx.rotate(world.angle);

    ctx.fillStyle = "rgba(1, 7, 9, 0.45)";
    ctx.beginPath();
    ctx.ellipse(3, 8, 99, 49, 0, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = "rgba(196, 151, 92, 0.7)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-68, 2);
    ctx.lineTo(-134, 4);
    ctx.stroke();
    ctx.strokeStyle = "rgba(32, 54, 55, 0.92)";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(-67, 0);
    ctx.lineTo(-134, 2);
    ctx.stroke();
    for (let index = 0; index < 3; index += 1) {
      ctx.strokeStyle = "rgba(204, 164, 107, 0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-82 - index * 16, -6);
      ctx.lineTo(-78 - index * 16, 11);
      ctx.stroke();
    }

    const bodyGradient = ctx.createLinearGradient(0, -48, 0, 50);
    bodyGradient.addColorStop(0, "#9c653b");
    bodyGradient.addColorStop(0.16, "#5e412e");
    bodyGradient.addColorStop(0.5, "#24363a");
    bodyGradient.addColorStop(1, "#142327");
    ctx.fillStyle = bodyGradient;
    roundRect(ctx, -94, -46, 188, 93, 7);
    ctx.fill();
    ctx.strokeStyle = "rgba(217, 178, 118, 0.72)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#ba7b3d";
    ctx.fillRect(-94, 25, 188, 7);
    ctx.fillStyle = "rgba(241, 195, 115, 0.58)";
    ctx.fillRect(-94, 25, 188, 1);
    for (let index = 0; index < 8; index += 1) {
      ctx.fillStyle = "rgba(20, 30, 28, 0.5)";
      ctx.fillRect(-88 + index * 24, 26, 12, 5);
    }

    const windowGradient = ctx.createLinearGradient(-75, -31, 72, 10);
    windowGradient.addColorStop(0, "rgba(134, 191, 185, 0.42)");
    windowGradient.addColorStop(0.4, "rgba(46, 82, 85, 0.6)");
    windowGradient.addColorStop(1, "rgba(18, 40, 45, 0.8)");
    ctx.fillStyle = windowGradient;
    roundRect(ctx, -74, -31, 151, 39, 3);
    ctx.fill();
    ctx.strokeStyle = "rgba(201, 223, 213, 0.18)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = "rgba(13, 35, 39, 0.7)";
    ctx.beginPath();
    ctx.moveTo(-24, -30);
    ctx.lineTo(-24, 7);
    ctx.moveTo(27, -30);
    ctx.lineTo(27, 7);
    ctx.stroke();
    ctx.fillStyle = "rgba(227, 239, 226, 0.09)";
    ctx.beginPath();
    ctx.moveTo(-70, -29);
    ctx.lineTo(-24, -29);
    ctx.lineTo(-58, 5);
    ctx.lineTo(-72, 5);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#d7b77f";
    ctx.font = "600 8px 'TetherCJK', 'SFMono-Regular', monospace";
    ctx.textAlign = "left";
    ctx.fillText("TETHER / 03", -74, 20);
    ctx.fillStyle = "rgba(222, 238, 230, 0.45)";
    ctx.font = "8px 'SFMono-Regular', monospace";
    ctx.fillText("CAP. 240 KG", 25, 20);

    ctx.fillStyle = "#273c3e";
    ctx.fillRect(-76, -52, 12, 8);
    ctx.fillRect(64, -52, 12, 8);
    ctx.fillStyle = "#d4a363";
    ctx.fillRect(-72, -55, 4, 9);
    ctx.fillRect(68, -55, 4, 9);

    const beacon = 0.4 + Math.max(0, Math.sin(world.windTime * 4.2)) * 0.6;
    ctx.fillStyle = `rgba(238, 93, 74, ${beacon})`;
    ctx.beginPath();
    ctx.arc(-78, -39, 2.2, 0, TAU);
    ctx.arc(78, -39, 2.2, 0, TAU);
    ctx.fill();

    const cupX = -138;
    const cupY = 4;
    const cupSafe = world.angleSafe;
    const cupColor = world.cupIntegrity <= 25 ? "#e1695f" : cupSafe ? "#9ad7a0" : "#e8a85f";
    const cupGlow = ctx.createRadialGradient(cupX, cupY, 4, cupX, cupY, 37);
    cupGlow.addColorStop(0, `${cupColor}66`);
    cupGlow.addColorStop(1, `${cupColor}00`);
    ctx.fillStyle = cupGlow;
    ctx.beginPath();
    ctx.arc(cupX, cupY, 38, 0, TAU);
    ctx.fill();

    ctx.fillStyle = "#172c30";
    ctx.beginPath();
    ctx.arc(cupX, cupY, 29, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(226, 202, 164, 0.52)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#0b1b1f";
    ctx.beginPath();
    ctx.arc(cupX, cupY, 19, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `${cupColor}aa`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = cupColor;
    ctx.beginPath();
    ctx.arc(cupX, cupY, 5, 0, TAU);
    ctx.fill();
    for (let index = 0; index < 4; index += 1) {
      const angle = index * (TAU / 4) + Math.PI / 4;
      const tx = cupX + Math.cos(angle) * 25;
      const ty = cupY + Math.sin(angle) * 25;
      ctx.fillStyle = "#c29158";
      ctx.fillRect(tx - 2, ty - 2, 4, 4);
    }

    if (world.dockProgress > 0) {
      ctx.strokeStyle = "#b3e1a8";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cupX, cupY, 34, -Math.PI / 2, -Math.PI / 2 + TAU * world.dockProgress);
      ctx.stroke();
    }

    if (world.anchored) {
      ctx.strokeStyle = "rgba(133, 229, 213, 0.45)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.strokeRect(-100, -51, 200, 102);
      ctx.setLineDash([]);
    }

    ctx.restore();

    this.drawRigCallout(world, topX, topY);
  }

  drawRigCallout(world, topX, topY) {
    const ctx = this.ctx;
    const x = clamp(world.gondolaX + 118, 426, 1060);
    const y = clamp(topY - 74, 165, 650);
    const safe = world.angleSafe;
    const color = safe ? "rgba(164, 218, 167, 0.82)" : "rgba(232, 168, 95, 0.9)";

    ctx.strokeStyle = "rgba(173, 204, 194, 0.24)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(world.gondolaX + 92, world.gondolaY - 39);
    ctx.lineTo(x, y + 18);
    ctx.stroke();
    ctx.fillStyle = "rgba(4, 17, 21, 0.75)";
    roundRect(ctx, x, y, 94, 39, 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(175, 207, 197, 0.2)";
    ctx.stroke();
    ctx.fillStyle = "rgba(142, 168, 167, 0.75)";
    ctx.font = "600 7px 'SFMono-Regular', monospace";
    ctx.textAlign = "left";
    ctx.fillText("CONTACT ∠", x + 9, y + 11);
    ctx.fillStyle = color;
    ctx.font = "600 14px 'SFMono-Regular', monospace";
    const sign = world.contactAngle >= 0 ? "+" : "";
    ctx.fillText(`${sign}${world.contactAngle.toFixed(1)}°`, x + 9, y + 29);
    ctx.fillStyle = "rgba(142, 168, 167, 0.62)";
    ctx.font = "500 7px 'SFMono-Regular', monospace";
    ctx.textAlign = "right";
    ctx.fillText(safe ? "STABLE" : "SWING", x + 85, y + 29);
  }

  drawTargetReticle(world) {
    const ctx = this.ctx;
    const target = world.nearestTarget;
    if (!target) return;

    const dx = target.x - world.cupX;
    const dy = target.y - world.cupY;
    const distance = Math.hypot(dx, dy);
    const inZone = world.inCaptureZone;
    const docking = world.docking && world.dockProgress > 0;
    const color = inZone ? "rgba(174, 224, 163, 0.85)" : "rgba(229, 187, 117, 0.68)";

    if (!inZone && distance < 260) {
      ctx.strokeStyle = "rgba(229, 187, 117, 0.28)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(world.cupX, world.cupY);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    const ringRadius = 55 + (inZone ? 3 : 0);
    const start = world.windTime * 0.22;
    for (let index = 0; index < 4; index += 1) {
      const angle = start + index * (TAU / 4);
      ctx.beginPath();
      ctx.arc(target.x, target.y, ringRadius, angle, angle + 0.52);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(target.x - 12, target.y);
    ctx.lineTo(target.x + 12, target.y);
    ctx.moveTo(target.x, target.y - 12);
    ctx.lineTo(target.x, target.y + 12);
    ctx.stroke();

    if (docking) {
      ctx.strokeStyle = "rgba(6, 23, 26, 0.3)";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(target.x, target.y, 72, -Math.PI / 2, Math.PI * 1.5);
      ctx.stroke();
      ctx.strokeStyle = "#b6e3a8";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(target.x, target.y, 72, -Math.PI / 2, -Math.PI / 2 + TAU * world.dockProgress);
      ctx.stroke();
    }

    if (inZone && !docking) {
      const label = world.angleSafe ? "READY · 按住 SPACE" : "接触角超限";
      ctx.font = "600 9px 'SFMono-Regular', monospace";
      ctx.textAlign = "center";
      const textWidth = ctx.measureText(label).width + 20;
      ctx.fillStyle = "rgba(5, 20, 24, 0.82)";
      roundRect(ctx, target.x - textWidth / 2, target.y + 84, textWidth, 23, 2);
      ctx.fill();
      ctx.strokeStyle = world.angleSafe
        ? "rgba(172, 222, 162, 0.5)"
        : "rgba(232, 168, 95, 0.45)";
      ctx.stroke();
      ctx.fillStyle = world.angleSafe ? "#b5e1aa" : "#e8a85f";
      ctx.fillText(label, target.x, target.y + 99);
    }
  }

  drawInstruments(world) {
    this.drawWindInstrument(world);
    this.drawAngleInstrument(world);
  }

  drawInstrumentFrame(x, y, width, height, label, code) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(4, 17, 22, 0.7)";
    roundRect(ctx, x, y, width, height, 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(174, 207, 197, 0.2)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = "rgba(174, 207, 197, 0.42)";
    const corner = 7;
    ctx.beginPath();
    ctx.moveTo(x, y + corner);
    ctx.lineTo(x, y);
    ctx.lineTo(x + corner, y);
    ctx.moveTo(x + width - corner, y);
    ctx.lineTo(x + width, y);
    ctx.lineTo(x + width, y + corner);
    ctx.moveTo(x + width, y + height - corner);
    ctx.lineTo(x + width, y + height);
    ctx.lineTo(x + width - corner, y + height);
    ctx.moveTo(x + corner, y + height);
    ctx.lineTo(x, y + height);
    ctx.lineTo(x, y + height - corner);
    ctx.stroke();

    ctx.fillStyle = "rgba(142, 168, 167, 0.78)";
    ctx.font = "600 8px 'TetherCJK', 'SFMono-Regular', monospace";
    ctx.textAlign = "left";
    ctx.fillText(label, x + 13, y + 19);
    ctx.fillStyle = "rgba(142, 168, 167, 0.36)";
    ctx.textAlign = "right";
    ctx.fillText(code, x + width - 13, y + 19);
  }

  drawWindInstrument(world) {
    const ctx = this.ctx;
    const x = 1161;
    const y = 98;
    const width = 240;
    const height = 121;
    this.drawInstrumentFrame(x, y, width, height, "WIND / 风速", "M/S");

    const dialX = x + 40;
    const dialY = y + 69;
    const dialRadius = 26;
    const magnitude = clamp(world.windSpeed / 20, 0, 1);
    const needleAngle = -Math.PI * 0.82 + magnitude * Math.PI * 1.64;
    ctx.strokeStyle = "rgba(151, 185, 176, 0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(dialX, dialY, dialRadius, Math.PI * 0.75, Math.PI * 2.25);
    ctx.stroke();
    for (let index = 0; index <= 8; index += 1) {
      const angle = Math.PI * 0.75 + (index / 8) * Math.PI * 1.5;
      const inner = index % 2 === 0 ? dialRadius - 5 : dialRadius - 2.5;
      ctx.strokeStyle = "rgba(151, 185, 176, 0.22)";
      ctx.beginPath();
      ctx.moveTo(
        dialX + Math.cos(angle) * dialRadius,
        dialY + Math.sin(angle) * dialRadius,
      );
      ctx.lineTo(dialX + Math.cos(angle) * inner, dialY + Math.sin(angle) * inner);
      ctx.stroke();
    }
    ctx.strokeStyle = world.windSpeed > 11 ? "#e8a85f" : "#69d8dc";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(dialX, dialY);
    ctx.lineTo(
      dialX + Math.cos(needleAngle) * (dialRadius - 4),
      dialY + Math.sin(needleAngle) * (dialRadius - 4),
    );
    ctx.stroke();
    ctx.fillStyle = "rgba(174, 207, 197, 0.56)";
    ctx.beginPath();
    ctx.arc(dialX, dialY, 2, 0, TAU);
    ctx.fill();

    ctx.fillStyle = "#d6e6df";
    ctx.font = "500 26px 'SFMono-Regular', monospace";
    ctx.textAlign = "left";
    ctx.fillText(world.windSpeed.toFixed(1).padStart(4, "0"), x + 77, y + 68);
    ctx.fillStyle = "rgba(142, 168, 167, 0.7)";
    ctx.font = "500 8px 'SFMono-Regular', monospace";
    ctx.fillText("M/S", x + 155, y + 65);

    ctx.strokeStyle = "rgba(142, 168, 167, 0.5)";
    ctx.lineWidth = 1;
    const arrowX = x + 91;
    const arrowY = y + 84;
    const dir = world.windDirection;
    ctx.beginPath();
    ctx.moveTo(arrowX - dir * 15, arrowY);
    ctx.lineTo(arrowX + dir * 16, arrowY);
    ctx.lineTo(arrowX + dir * 10, arrowY - 4);
    ctx.moveTo(arrowX + dir * 16, arrowY);
    ctx.lineTo(arrowX + dir * 10, arrowY + 4);
    ctx.stroke();

    ctx.fillStyle = "rgba(142, 168, 167, 0.15)";
    ctx.fillRect(x + 77, y + 94, 149, 3);
    ctx.fillStyle = world.gustDuration > 0 ? "#e8a85f" : "#69d8dc";
    ctx.fillRect(x + 77, y + 94, 149 * clamp(world.windSpeed / 20, 0, 1), 3);
    for (let index = 0; index <= 4; index += 1) {
      ctx.fillStyle = "rgba(198, 220, 212, 0.38)";
      ctx.fillRect(x + 77 + index * 37, y + 92, 1, 7);
    }

    const gusting = world.windSurge > 0.35;
    ctx.fillStyle = gusting ? "#e8a85f" : "rgba(142, 168, 167, 0.5)";
    ctx.font = "600 7px 'SFMono-Regular', monospace";
    ctx.textAlign = "right";
    ctx.fillText(gusting ? `GUST +${world.windSurge.toFixed(1)}` : "NOMINAL", x + 225, y + 116);
  }

  drawAngleInstrument(world) {
    const ctx = this.ctx;
    const x = 37;
    const y = 98;
    const width = 231;
    const height = 121;
    const safe = world.angleSafe;
    const color = world.contactAngle > DOCK_RULES.hardAngle || world.contactAngle < -DOCK_RULES.hardAngle
      ? "#e1695f"
      : safe
        ? "#a7d9a7"
        : "#e8a85f";
    this.drawInstrumentFrame(x, y, width, height, "CONTACT / 接触角", "±30°");

    const gaugeX = x + 183;
    const gaugeY = y + 70;
    const radius = 30;
    const angleToMap = (degrees) => (clamp(degrees, -30, 30) / 30) * (Math.PI * 0.62);
    ctx.strokeStyle = "rgba(168, 202, 191, 0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(gaugeX, gaugeY, radius, -Math.PI / 2 - Math.PI * 0.62, -Math.PI / 2 + Math.PI * 0.62);
    ctx.stroke();
    ctx.strokeStyle = "rgba(167, 217, 167, 0.46)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(
      gaugeX,
      gaugeY,
      radius,
      -Math.PI / 2 - angleToMap(10),
      -Math.PI / 2 + angleToMap(10),
    );
    ctx.stroke();
    for (let index = -3; index <= 3; index += 1) {
      const angle = -Math.PI / 2 + angleToMap(index * 10);
      ctx.strokeStyle = "rgba(201, 220, 212, 0.3)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gaugeX + Math.cos(angle) * (radius - 4), gaugeY + Math.sin(angle) * (radius - 4));
      ctx.lineTo(gaugeX + Math.cos(angle) * (radius + 3), gaugeY + Math.sin(angle) * (radius + 3));
      ctx.stroke();
    }
    const needleAngle = -Math.PI / 2 + angleToMap(world.contactAngle);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(gaugeX, gaugeY);
    ctx.lineTo(gaugeX + Math.cos(needleAngle) * (radius - 3), gaugeY + Math.sin(needleAngle) * (radius - 3));
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(gaugeX, gaugeY, 2.2, 0, TAU);
    ctx.fill();

    const sign = world.contactAngle >= 0 ? "+" : "";
    ctx.fillStyle = color;
    ctx.font = "500 25px 'SFMono-Regular', monospace";
    ctx.textAlign = "left";
    ctx.fillText(`${sign}${world.contactAngle.toFixed(1)}`, x + 14, y + 65);
    ctx.fillStyle = "rgba(142, 168, 167, 0.7)";
    ctx.font = "500 9px 'SFMono-Regular', monospace";
    ctx.fillText("°", x + 93, y + 65);
    ctx.fillStyle = "rgba(142, 168, 167, 0.55)";
    ctx.font = "600 7px 'SFMono-Regular', monospace";
    ctx.fillText(`SAFE  ±${DOCK_RULES.safeAngle}°`, x + 14, y + 83);

    ctx.fillStyle = "rgba(142, 168, 167, 0.15)";
    ctx.fillRect(x + 14, y + 96, 203, 3);
    ctx.fillStyle = "rgba(105, 216, 220, 0.65)";
    ctx.fillRect(x + 14, y + 96, 203 * world.tension, 3);
    ctx.fillStyle = "rgba(142, 168, 167, 0.5)";
    ctx.font = "600 7px 'SFMono-Regular', monospace";
    ctx.fillText(`CABLE TENSION  ${Math.round(world.tension * 100)}%`, x + 14, y + 113);
    ctx.textAlign = "right";
    ctx.fillStyle = safe ? "rgba(167, 217, 167, 0.75)" : "rgba(232, 168, 95, 0.8)";
    ctx.fillText(safe ? "WITHIN LIMIT" : "BRAKE / WAIT", x + 217, y + 20);
  }

  drawForeground(world) {
    const ctx = this.ctx;
    const lower = ctx.createLinearGradient(0, 700, 0, WORLD.height);
    lower.addColorStop(0, "rgba(2, 9, 12, 0)");
    lower.addColorStop(1, "rgba(2, 9, 12, 0.47)");
    ctx.fillStyle = lower;
    ctx.fillRect(0, 700, WORLD.width, WORLD.height - 700);

    ctx.strokeStyle = "rgba(193, 218, 209, 0.1)";
    ctx.lineWidth = 1;
    ctx.strokeRect(17, 17, WORLD.width - 34, WORLD.height - 34);
    const corner = 14;
    ctx.strokeStyle = "rgba(193, 218, 209, 0.22)";
    ctx.beginPath();
    ctx.moveTo(17, 17 + corner);
    ctx.lineTo(17, 17);
    ctx.lineTo(17 + corner, 17);
    ctx.moveTo(WORLD.width - 17 - corner, 17);
    ctx.lineTo(WORLD.width - 17, 17);
    ctx.lineTo(WORLD.width - 17, 17 + corner);
    ctx.moveTo(WORLD.width - 17, WORLD.height - 17 - corner);
    ctx.lineTo(WORLD.width - 17, WORLD.height - 17);
    ctx.lineTo(WORLD.width - 17 - corner, WORLD.height - 17);
    ctx.moveTo(17 + corner, WORLD.height - 17);
    ctx.lineTo(17, WORLD.height - 17);
    ctx.lineTo(17, WORLD.height - 17 - corner);
    ctx.stroke();

    ctx.fillStyle = "rgba(142, 168, 167, 0.45)";
    ctx.font = "600 7px 'SFMono-Regular', monospace";
    ctx.textAlign = "left";
    ctx.fillText("LAT 31.2304 N  ·  ALT 268 M", 31, WORLD.height - 31);
    ctx.textAlign = "right";
    ctx.fillText("TETHER SYSTEMS / WIND CORRECTION ACTIVE", WORLD.width - 31, WORLD.height - 31);

    if (world.cupIntegrity <= 40) {
      const warning = 0.25 + Math.sin(world.windTime * 5) * 0.18;
      const edge = ctx.createRadialGradient(
        WORLD.width / 2,
        WORLD.height / 2,
        260,
        WORLD.width / 2,
        WORLD.height / 2,
        720,
      );
      edge.addColorStop(0, "rgba(177, 69, 59, 0)");
      edge.addColorStop(1, `rgba(177, 69, 59, ${warning})`);
      ctx.fillStyle = edge;
      ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    }
  }

  drawStandbyOverlay(world) {
    const ctx = this.ctx;
    const gradient = ctx.createLinearGradient(0, 0, WORLD.width, 0);
    gradient.addColorStop(0, "rgba(2, 10, 14, 0.22)");
    gradient.addColorStop(0.55, "rgba(2, 10, 14, 0.04)");
    gradient.addColorStop(1, "rgba(2, 10, 14, 0.28)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    ctx.fillStyle = "rgba(193, 218, 209, 0.34)";
    ctx.font = "600 8px 'SFMono-Regular', monospace";
    ctx.textAlign = "right";
    ctx.fillText("SYSTEM STANDBY / AWAITING CREW", WORLD.width - 72, WORLD.height - 78);
    ctx.fillStyle = "rgba(105, 216, 220, 0.65)";
    ctx.textAlign = "left";
    ctx.fillText("●", WORLD.width - 226, WORLD.height - 78);
  }

  drawVictoryLight(world) {
    const ctx = this.ctx;
    const flash = clamp(1 - world.winTimer / 1.6, 0, 1);
    if (flash <= 0) return;
    ctx.fillStyle = `rgba(217, 239, 223, ${flash * 0.13})`;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    ctx.strokeStyle = `rgba(190, 230, 195, ${flash * 0.5})`;
    ctx.lineWidth = 1;
    const radius = 120 + (1 - flash) * 360;
    ctx.beginPath();
    ctx.arc(world.cupX, world.cupY, radius, 0, TAU);
    ctx.stroke();
  }
}
