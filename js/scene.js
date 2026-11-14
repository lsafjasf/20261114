(function () {
  "use strict";

  const WORLD_W = 1600;
  const WORLD_H = 900;
  const TAU = Math.PI * 2;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const mix = (a, b, t) => a + (b - a) * t;

  function withAlpha(ctx, alpha, draw) {
    const previous = ctx.globalAlpha;
    ctx.globalAlpha *= alpha;
    draw();
    ctx.globalAlpha = previous;
  }

  const LAYOUT = {
    rescueCable: { x1: 178, y1: 98, x2: 1422, y2: 98, sag: 139 },
    mainCable: { x1: 164, y1: 175, x2: 1437, y2: 173, sag: 148 },
    cabins: [
      {
        cx: 520,
        top: 328,
        phase: 0.4,
        code: "A-07",
        units: "12.4 KN",
        points: [
          { id: 0, side: "left", y: 66 },
          { id: 1, side: "right", y: 122 }
        ]
      },
      {
        cx: 1080,
        top: 326,
        phase: 2.25,
        code: "B-12",
        units: "11.8 KN",
        points: [
          { id: 2, side: "left", y: 62 },
          { id: 3, side: "right", y: 120 }
        ]
      }
    ],
    transferPoints: [
      { id: 0, x: 402, y: 394, cabin: 0 },
      { id: 1, x: 638, y: 450, cabin: 0 },
      { id: 2, x: 962, y: 388, cabin: 1 },
      { id: 3, x: 1198, y: 446, cabin: 1 }
    ],
    basketStart: { x: 800, y: 286 },
    basketSeats: [-45, -15, 15, 45]
  };

  LAYOUT.transferPoints.forEach((point, index) => {
    point.number = String(index + 1).padStart(2, "0");
  });

  function seeded(seed) {
    let value = seed >>> 0;
    return function () {
      value += 0x6d2b79f5;
      let t = value;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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

  function cableY(x, startX, startY, endX, endY, sag) {
    const t = clamp((x - startX) / (endX - startX), 0, 1);
    return (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * (startY + sag) + t * t * endY;
  }

  function linePath(ctx, x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  class SceneRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.offsetX = 0;
      this.offsetY = 0;
      this.scale = 1;
      this.dpr = 1;
      this.viewWidth = 0;
      this.viewHeight = 0;
      this.portrait = false;
      this.cameraX = WORLD_W / 2;
      this.time = 0;
      this.lastTime = performance.now();
      this.streaks = [];
      this.snow = [];
      this.motes = [];
      this.backdrop = document.createElement("canvas");
      this.backdrop.width = WORLD_W;
      this.backdrop.height = WORLD_H;
      this.buildBackdrop();
      this.seedParticles();
      this.resize();
    }

    resize() {
      const width = window.innerWidth;
      const height = window.innerHeight;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(width * this.dpr);
      this.canvas.height = Math.round(height * this.dpr);
      this.canvas.style.width = width + "px";
      this.canvas.style.height = height + "px";
      this.viewWidth = width;
      this.viewHeight = height;
      this.portrait = width / height < 1.02;
      if (this.portrait) {
        this.scale = Math.min(height / WORLD_H, width / 660);
        this.cameraX = clamp(this.cameraX, width / this.scale / 2, WORLD_W - width / this.scale / 2);
        this.offsetX = width / 2 - this.cameraX * this.scale;
      } else {
        this.scale = Math.max(width / WORLD_W, height / WORLD_H);
        this.offsetX = (width - WORLD_W * this.scale) / 2;
      }
      this.offsetY = (height - WORLD_H * this.scale) / 2;
    }

    seedParticles() {
      const random = seeded(9137);
      for (let i = 0; i < 46; i++) {
        this.streaks.push({
          x: random() * WORLD_W,
          y: 80 + random() * 730,
          len: 28 + random() * 125,
          speed: 0.35 + random() * 1.7,
          lane: random(),
          alpha: 0.045 + random() * 0.16,
          phase: random() * TAU
        });
      }
      for (let i = 0; i < 76; i++) {
        this.snow.push({
          x: random() * WORLD_W,
          y: random() * WORLD_H,
          size: 0.5 + random() * 2.1,
          speed: 8 + random() * 24,
          drift: 7 + random() * 25,
          alpha: 0.15 + random() * 0.6,
          phase: random() * TAU
        });
      }
      for (let i = 0; i < 24; i++) {
        this.motes.push({
          x: random() * WORLD_W,
          y: 420 + random() * 360,
          size: 0.8 + random() * 2,
          speed: 4 + random() * 12,
          phase: random() * TAU
        });
      }
    }

    buildBackdrop() {
      const ctx = this.backdrop.getContext("2d");
      const random = seeded(28451);

      const sky = ctx.createLinearGradient(0, 0, 0, WORLD_H);
      sky.addColorStop(0, "#06131d");
      sky.addColorStop(0.25, "#0c2431");
      sky.addColorStop(0.5, "#234451");
      sky.addColorStop(0.68, "#756c67");
      sky.addColorStop(0.78, "#c88c6b");
      sky.addColorStop(1, "#27343b");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);

      const horizon = ctx.createRadialGradient(1160, 310, 5, 1160, 310, 520);
      horizon.addColorStop(0, "rgba(255,215,153,0.7)");
      horizon.addColorStop(0.1, "rgba(255,185,116,0.38)");
      horizon.addColorStop(0.45, "rgba(201,130,97,0.11)");
      horizon.addColorStop(1, "rgba(10,22,29,0)");
      ctx.fillStyle = horizon;
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);

      ctx.save();
      ctx.globalAlpha = 0.5;
      const sun = ctx.createRadialGradient(1170, 292, 5, 1170, 292, 125);
      sun.addColorStop(0, "rgba(255,238,199,0.88)");
      sun.addColorStop(0.18, "rgba(255,202,133,0.36)");
      sun.addColorStop(1, "rgba(255,169,102,0)");
      ctx.fillStyle = sun;
      ctx.fillRect(1000, 120, 350, 350);
      ctx.restore();

      for (let i = 0; i < 42; i++) {
        const x = random() * WORLD_W;
        const y = random() * 300;
        const alpha = 0.08 + random() * 0.26;
        ctx.fillStyle = "rgba(231,242,228," + alpha + ")";
        ctx.fillRect(x, y, 1 + random() * 1.4, 1 + random() * 1.4);
      }

      this.drawCloudBand(ctx, random, 210, 40, 0.12, "#d3c3b1");
      this.drawCloudBand(ctx, random, 300, 27, 0.085, "#e7cdb5");
      this.drawCloudBand(ctx, random, 370, 18, 0.06, "#efd3bb");

      this.drawMountainRange(ctx, random, 470, 190, "#3d5961", 0.8, 0);
      this.drawMountainRange(ctx, random, 565, 225, "#263f49", 1, 1);
      this.drawMountainRange(ctx, random, 670, 185, "#142c36", 1, 2);

      const valleyMist = ctx.createLinearGradient(0, 500, 0, 760);
      valleyMist.addColorStop(0, "rgba(231,194,164,0)");
      valleyMist.addColorStop(0.48, "rgba(216,180,153,0.16)");
      valleyMist.addColorStop(1, "rgba(16,31,37,0)");
      ctx.fillStyle = valleyMist;
      ctx.fillRect(0, 470, WORLD_W, 350);

      this.drawMountainRange(ctx, random, 795, 130, "#091b22", 1.25, 3);
      this.drawTreeLine(ctx, random, 770);

      const foreground = ctx.createLinearGradient(0, 760, 0, WORLD_H);
      foreground.addColorStop(0, "rgba(8,20,27,0)");
      foreground.addColorStop(0.5, "rgba(5,14,19,0.77)");
      foreground.addColorStop(1, "#030c12");
      ctx.fillStyle = foreground;
      ctx.fillRect(0, 735, WORLD_W, WORLD_H - 735);

      this.drawRidgeTexture(ctx, random);
    }

    drawCloudBand(ctx, random, baseY, thickness, alpha, color) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      for (let i = 0; i < 11; i++) {
        const x = random() * (WORLD_W + 240) - 120;
        const y = baseY + (random() - 0.5) * thickness * 2;
        const width = 130 + random() * 310;
        const height = 7 + random() * 19;
        ctx.beginPath();
        ctx.ellipse(x, y, width, height, (random() - 0.5) * 0.1, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    drawMountainRange(ctx, random, baseY, height, color, opacity, layer) {
      const points = [];
      const count = 16 + layer * 3;
      for (let i = 0; i <= count; i++) {
        const x = (i / count) * WORLD_W + (random() - 0.5) * 32;
        const ridge = Math.abs(Math.sin(i * 1.71 + layer * 0.8));
        const peak = height * (0.18 + ridge * 0.65 + random() * 0.27);
        points.push({ x, y: baseY - peak });
      }

      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.beginPath();
      ctx.moveTo(-30, WORLD_H);
      ctx.lineTo(-30, baseY);
      points.forEach((point) => ctx.lineTo(point.x, point.y));
      ctx.lineTo(WORLD_W + 30, baseY);
      ctx.lineTo(WORLD_W + 30, WORLD_H);
      ctx.closePath();
      const gradient = ctx.createLinearGradient(0, baseY - height, 0, baseY + 100);
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, layer === 3 ? "#07171e" : "#0b1f29");
      ctx.fillStyle = gradient;
      ctx.fill();

      if (layer < 3) {
        ctx.globalCompositeOperation = "screen";
        ctx.strokeStyle = "rgba(241,226,208,0.22)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        points.forEach((point, index) => {
          if (index === 0) ctx.moveTo(point.x, point.y + 1);
          else ctx.lineTo(point.x, point.y + 1);
        });
        ctx.stroke();

        for (let i = 1; i < points.length - 1; i += 2) {
          const point = points[i];
          if (point.y > baseY - height * 0.72) continue;
          ctx.fillStyle = "rgba(236,230,213,0.3)";
          ctx.beginPath();
          ctx.moveTo(point.x - 11, point.y + 24);
          ctx.lineTo(point.x, point.y - 1);
          ctx.lineTo(point.x + 14, point.y + 28);
          ctx.lineTo(point.x + 9, point.y + 14);
          ctx.lineTo(point.x + 4, point.y + 34);
          ctx.lineTo(point.x - 4, point.y + 19);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.restore();
    }

    drawTreeLine(ctx, random, baseY) {
      ctx.save();
      ctx.fillStyle = "#07171d";
      for (let i = 0; i < 125; i++) {
        const x = random() * WORLD_W;
        const height = 9 + random() * 36;
        const y = baseY + random() * 30;
        ctx.beginPath();
        ctx.moveTo(x, y - height);
        ctx.lineTo(x + height * 0.28, y);
        ctx.lineTo(x - height * 0.28, y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    drawRidgeTexture(ctx, random) {
      ctx.save();
      ctx.strokeStyle = "rgba(190,213,206,0.06)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 28; i++) {
        const x = random() * WORLD_W;
        const y = 620 + random() * 260;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(x + 50, y - 30, x + 110, y + 40, x + 190, y + 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    draw(dt, state) {
      const ctx = this.ctx;
      const now = performance.now();
      const frameDt = Math.min(0.05, Math.max(0, (now - this.lastTime) / 1000));
      this.lastTime = now;
      this.time += frameDt;

      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);
      const edgeFill = ctx.createLinearGradient(0, 0, 0, this.viewHeight);
      edgeFill.addColorStop(0, "#06121b");
      edgeFill.addColorStop(0.5, "#0a202a");
      edgeFill.addColorStop(1, "#030c12");
      ctx.fillStyle = edgeFill;
      ctx.fillRect(0, 0, this.viewWidth, this.viewHeight);
      ctx.save();

      const shake = state.shake || 0;
      const shakeX = shake ? (Math.random() - 0.5) * shake * 13 : 0;
      const shakeY = shake ? (Math.random() - 0.5) * shake * 8 : 0;
      this.updateCamera(frameDt, state);
      ctx.translate(this.offsetX + shakeX, this.offsetY + shakeY);
      ctx.scale(this.scale, this.scale);

      ctx.drawImage(this.backdrop, 0, 0, WORLD_W, WORLD_H);
      this.drawSunHaze(ctx, state);
      this.drawTowers(ctx, state);
      this.drawCables(ctx, state);
      this.drawCabins(ctx, state);
      this.updateWind(dt, state);
      this.drawWind(ctx, state);
      this.drawRescueRig(ctx, state);
      this.drawDockingGuide(ctx, state);
      this.drawBasket(ctx, state);
      this.drawForegroundWeather(ctx, state);
      this.drawScreenEffects(ctx, state);

      ctx.restore();
    }

    updateCamera(dt, state) {
      if (!this.portrait) return;
      const half = this.viewWidth / this.scale / 2;
      let target = WORLD_W / 2;
      if (state.started && state.activeIndex < 4) {
        const point = SceneRenderer.LAYOUT.transferPoints[state.activeIndex];
        target = (state.basket.x + point.x) * 0.5;
      } else if (state.started && state.basket) {
        target = state.basket.x;
      }
      target = clamp(target, half, WORLD_W - half);
      this.cameraX += (target - this.cameraX) * Math.min(1, dt * 2.1);
      this.cameraX = clamp(this.cameraX, half, WORLD_W - half);
      this.offsetX = this.viewWidth / 2 - this.cameraX * this.scale;
    }

    drawSunHaze(ctx, state) {
      const gust = state.wind && state.wind.gust;
      const pulse = 0.5 + Math.sin(this.time * 0.23) * 0.07;
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const haze = ctx.createRadialGradient(1170, 292, 10, 1170, 292, gust ? 400 : 290);
      haze.addColorStop(0, "rgba(255,225,180," + (pulse * 0.08).toFixed(3) + ")");
      haze.addColorStop(0.55, "rgba(255,177,112," + (pulse * 0.025).toFixed(3) + ")");
      haze.addColorStop(1, "rgba(255,158,91,0)");
      ctx.fillStyle = haze;
      ctx.fillRect(650, 0, 850, 700);
      ctx.restore();
    }

    drawTowers(ctx, state) {
      this.drawTower(ctx, 132, 54, 792, 1, state);
      this.drawTower(ctx, 1468, 58, 792, -1, state);

      ctx.save();
      ctx.strokeStyle = "rgba(255,189,100,0.25)";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 9]);
      ctx.beginPath();
      ctx.ellipse(1468, 112, 52, 18, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();

      this.drawRescuePlatform(ctx, state);
    }

    drawTower(ctx, x, topY, baseY, side, state) {
      const halfBase = 72;
      const halfTop = 20;
      const top = topY;
      const base = baseY;
      const leftAt = (yy) => x - mix(halfBase, halfTop, (yy - base) / (top - base));
      const rightAt = (yy) => x + mix(halfBase, halfTop, (yy - base) / (top - base));

      ctx.save();
      ctx.strokeStyle = "rgba(170,199,194,0.37)";
      ctx.lineWidth = 2;
      linePath(ctx, leftAt(top), top, leftAt(base), base);
      linePath(ctx, rightAt(top), top, rightAt(base), base);
      ctx.lineWidth = 1;
      linePath(ctx, leftAt(top) - halfBase * 0.4, base, rightAt(base) + halfBase * 0.4, base);

      const levels = 10;
      for (let i = 0; i <= levels; i++) {
        const t = i / levels;
        const y = mix(top, base, t);
        const left = leftAt(y);
        const right = rightAt(y);
        ctx.strokeStyle = "rgba(156,186,181,0.27)";
        linePath(ctx, left, y, right, y);
        if (i < levels) {
          const nextY = mix(top, base, (i + 1) / levels);
          ctx.strokeStyle = "rgba(156,186,181,0.16)";
          linePath(ctx, left, y, rightAt(nextY), nextY);
          linePath(ctx, right, y, leftAt(nextY), nextY);
        }
      }

      ctx.strokeStyle = "rgba(221,228,210,0.48)";
      ctx.lineWidth = 2;
      linePath(ctx, x - 78, 92, x + 78, 92);
      linePath(ctx, x - 62, 171, x + 62, 171);
      withAlpha(ctx, 0.6, () => {
        ctx.strokeStyle = "rgba(255,189,100,0.6)";
        ctx.lineWidth = 1;
        linePath(ctx, x - 76, 88, x - 56, 106);
        linePath(ctx, x + 76, 88, x + 56, 106);
      });

      const lampPulse = 0.5 + Math.sin(this.time * 2.2 + side) * 0.5;
      ctx.fillStyle = "rgba(240,105,88," + (0.28 + lampPulse * 0.55).toFixed(3) + ")";
      ctx.beginPath();
      ctx.arc(x, top + 3, 3.5, 0, TAU);
      ctx.fill();
      ctx.shadowColor = "#f06958";
      ctx.shadowBlur = 11 + lampPulse * 8;
      ctx.fillStyle = "rgba(255,130,105,0.6)";
      ctx.beginPath();
      ctx.arc(x, top + 3, 1.8, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.fillStyle = "rgba(9,22,28,0.88)";
      ctx.fillRect(x - 74, base - 6, 148, 33);
      ctx.strokeStyle = "rgba(119,151,149,0.25)";
      ctx.strokeRect(x - 74, base - 6, 148, 33);
      ctx.fillStyle = "rgba(170,198,191,0.4)";
      ctx.fillRect(x - 67, base - 2, 32, 2);
      ctx.fillRect(x + 2, base + 4, 55, 1);
      ctx.restore();
    }

    drawRescuePlatform(ctx, state) {
      const open = state.mode === "complete" || state.mode === "finale";
      const x = 1468;
      const y = 320;
      ctx.save();
      ctx.strokeStyle = open ? "rgba(114,216,196,0.7)" : "rgba(154,180,174,0.3)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 80, y);
      ctx.lineTo(x - 30, y);
      ctx.lineTo(x - 12, y + 8);
      ctx.lineTo(x + 90, y + 8);
      ctx.stroke();
      ctx.strokeStyle = "rgba(154,180,174,0.2)";
      ctx.lineWidth = 1;
      linePath(ctx, x - 30, y + 8, x + 18, y + 42);
      linePath(ctx, x + 70, y + 8, x + 18, y + 42);
      for (let i = 0; i < 7; i++) {
        ctx.fillStyle = "rgba(140,174,166,0.18)";
        ctx.fillRect(x - 70 + i * 22, y + 3, 12, 2);
      }
      if (!open) {
        ctx.fillStyle = "rgba(240,105,88,0.55)";
        ctx.fillRect(x - 12, y - 14, 2, 11);
        ctx.fillStyle = "rgba(240,105,88,0.7)";
        ctx.fillRect(x - 12, y - 14, 8, 2);
      }
      ctx.restore();
    }

    drawCables(ctx, state) {
      const lines = [
        { x1: 178, y1: 98, x2: 1422, y2: 98, sag: 139, color: "rgba(214,226,210,0.48)", width: 1.6 },
        { x1: 164, y1: 175, x2: 1437, y2: 173, sag: 148, color: "rgba(194,211,200,0.43)", width: 1.4 },
        { x1: 154, y1: 181, x2: 1447, y2: 179, sag: 154, color: "rgba(111,139,133,0.26)", width: 1 }
      ];
      ctx.save();
      for (const line of lines) {
        ctx.strokeStyle = line.color;
        ctx.lineWidth = line.width;
        ctx.beginPath();
        for (let i = 0; i <= 120; i++) {
          const x = mix(line.x1, line.x2, i / 120);
          const y = cableY(x, line.x1, line.y1, line.x2, line.y2, line.sag);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      ctx.strokeStyle = "rgba(255,222,170,0.18)";
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (let i = 0; i <= 90; i++) {
        const x = mix(180, 1420, i / 90);
        const y = cableY(x, 178, 98, 1422, 98, 139) - 1;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    drawCabins(ctx, state) {
      const cabins = SceneRenderer.LAYOUT.cabins;
      cabins.forEach((cabin) => this.drawCabin(ctx, cabin, state));
      this.drawPassengerMarkers(ctx, state);
    }

    drawCabin(ctx, cabin, state) {
      const cableAttachY = cableY(cabin.cx, 164, 175, 1437, 173, 148);
      const sway = Math.sin(this.time * 0.66 + cabin.phase) * 0.012;
      const snowShake = state.wind.gust ? Math.sin(this.time * 3.1 + cabin.phase) * 0.006 : 0;
      const bodyTop = cabin.top;

      ctx.save();
      ctx.strokeStyle = "rgba(189,208,198,0.42)";
      ctx.lineWidth = 2;
      linePath(ctx, cabin.cx, cableAttachY - 2, cabin.cx, bodyTop - 32);
      ctx.strokeStyle = "rgba(150,174,166,0.26)";
      ctx.lineWidth = 1;
      linePath(ctx, cabin.cx - 28, bodyTop - 24, cabin.cx, bodyTop - 52);
      linePath(ctx, cabin.cx + 28, bodyTop - 24, cabin.cx, bodyTop - 52);
      ctx.strokeStyle = "rgba(255,189,100,0.35)";
      linePath(ctx, cabin.cx - 16, bodyTop - 32, cabin.cx + 16, bodyTop - 32);
      ctx.restore();

      this.drawCableGrip(ctx, cabin.cx, cableAttachY, sway);

      ctx.save();
      ctx.translate(cabin.cx, bodyTop);
      ctx.rotate(sway + snowShake);

      ctx.fillStyle = "rgba(5,15,20,0.92)";
      roundedRect(ctx, -113, -5, 226, 179, 11);
      ctx.fill();

      const shell = ctx.createLinearGradient(-108, 0, 108, 0);
      shell.addColorStop(0, "#7e5338");
      shell.addColorStop(0.13, "#bd8751");
      shell.addColorStop(0.47, "#d2a467");
      shell.addColorStop(0.78, "#9d693f");
      shell.addColorStop(1, "#65442f");
      ctx.fillStyle = shell;
      roundedRect(ctx, -109, 0, 218, 169, 10);
      ctx.fill();

      ctx.save();
      roundedRect(ctx, -109, 0, 218, 169, 10);
      ctx.clip();
      ctx.fillStyle = "rgba(255,228,175,0.11)";
      ctx.fillRect(-96, -8, 42, 174);
      ctx.strokeStyle = "rgba(54,31,21,0.5)";
      ctx.lineWidth = 1;
      for (let y = 15; y < 166; y += 22) {
        linePath(ctx, -109, y, 109, y);
      }
      for (let x = -85; x < 105; x += 24) {
        linePath(ctx, x, 0, x, 169);
      }
      ctx.restore();

      const roof = ctx.createLinearGradient(0, -16, 0, 18);
      roof.addColorStop(0, "#ddd0ad");
      roof.addColorStop(0.3, "#8c7656");
      roof.addColorStop(1, "#544430");
      ctx.fillStyle = roof;
      ctx.beginPath();
      ctx.moveTo(-102, -14);
      ctx.lineTo(103, -15);
      ctx.lineTo(108, 5);
      ctx.lineTo(-111, 7);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(24,21,16,0.55)";
      ctx.lineWidth = 1;
      linePath(ctx, -110, 7, 109, 5);

      ctx.fillStyle = "#24363a";
      ctx.fillRect(-44, 12, 88, 18);
      ctx.strokeStyle = "rgba(223,230,216,0.28)";
      ctx.strokeRect(-44, 12, 88, 18);
      ctx.fillStyle = "rgba(255,207,128,0.8)";
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(cabin.code, 0, 25);

      const windows = [
        { x: -72, y: 48, w: 44, h: 31 },
        { x: -17, y: 48, w: 34, h: 31 },
        { x: 39, y: 48, w: 44, h: 31 },
        { x: -50, y: 106, w: 100, h: 23 }
      ];
      windows.forEach((win, index) => {
        const glow = 0.48 + Math.sin(this.time * 1.2 + cabin.phase + index * 0.7) * 0.12;
        ctx.fillStyle = "rgba(255,177,90," + glow.toFixed(3) + ")";
        roundedRect(ctx, win.x, win.y, win.w, win.h, 3);
        ctx.fill();
        ctx.strokeStyle = "rgba(31,29,22,0.8)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = "rgba(38,37,30,0.34)";
        ctx.fillRect(win.x + win.w * 0.54, win.y + 2, 2, win.h - 4);
      });

      ctx.fillStyle = "#1a2c2e";
      roundedRect(ctx, -91, 145, 182, 17, 2);
      ctx.fill();
      ctx.fillStyle = "rgba(242,231,202,0.32)";
      ctx.font = "8px monospace";
      ctx.textAlign = "left";
      ctx.fillText("CABLE CAR / 04", -84, 156);
      ctx.textAlign = "right";
      ctx.fillText(cabin.units, 85, 156);

      const active = state.activeIndex;
      cabin.points.forEach((point, index) => {
        const x = point.side === "left" ? -112 : 112;
        const y = point.y;
        const isActive = state.mode !== "complete" && index === active;
        const isNext = index === active;
        ctx.fillStyle = "rgba(12,20,20,0.72)";
        ctx.fillRect(x - 7, y - 34, 14, 68);
        ctx.strokeStyle = isActive ? "rgba(255,189,100,0.88)" : "rgba(156,177,169,0.23)";
        ctx.lineWidth = isActive ? 2 : 1;
        ctx.strokeRect(x - 7, y - 34, 14, 68);
        if (isActive || isNext) {
          ctx.fillStyle = "rgba(255,189,100," + (isActive ? 0.75 : 0.26) + ")";
          ctx.fillRect(x - 5, y - 31, 10, 62);
        }
        ctx.fillStyle = isActive ? "#ffd28c" : "rgba(201,211,199,0.36)";
        ctx.font = "bold 9px monospace";
        ctx.textAlign = "center";
        ctx.fillText(String(index + 1), x, y + 3);
      });
      ctx.restore();

      ctx.save();
      ctx.translate(cabin.cx, bodyTop);
      ctx.rotate(sway + snowShake);
      ctx.strokeStyle = "rgba(239,225,191,0.38)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-80, 175);
      ctx.quadraticCurveTo(0, 205, 82, 175);
      ctx.stroke();
      ctx.restore();
    }

    drawCableGrip(ctx, x, y, sway) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(sway * 0.18);
      ctx.fillStyle = "#26383a";
      roundedRect(ctx, -18, -6, 36, 14, 4);
      ctx.fill();
      ctx.strokeStyle = "rgba(223,229,207,0.38)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#8a6c43";
      ctx.beginPath();
      ctx.arc(-11, -5, 4, 0, TAU);
      ctx.arc(11, -5, 4, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    drawPassengerMarkers(ctx, state) {
      const points = SceneRenderer.LAYOUT.transferPoints;
      points.forEach((point, index) => {
        const passenger = state.passengers[index];
        if (!passenger) return;
        const active = state.mode !== "complete" && index === state.activeIndex;
        const boarding = passenger.status === "boarding";
        if (passenger.status === "waiting" && !boarding) {
          const side = index === 1 || index === 3 ? 1 : -1;
          const wave = active ? Math.sin(this.time * 4.1) * 0.45 : 0;
          withAlpha(ctx, active ? 1 : 0.48, () => {
            this.drawHuman(ctx, point.x + side * 19, point.y + 25, active ? 0.88 : 0.78, passenger, wave);
          });
        }

        if (!active) return;
        const aligned = state.dock && state.dock.aligned;
        const transferring = state.mode === "transfer";
        const pulse = 0.5 + Math.sin(this.time * 4.6) * 0.5;
        const color = transferring ? "#ffbd64" : aligned ? "#72d8c4" : "#ffbd64";

        ctx.save();
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.5 + pulse * 0.3;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 22 + pulse * 7, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 29, 0, TAU);
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.fillStyle = "rgba(5,16,21,0.86)";
        roundedRect(ctx, point.x - 25, point.y - 52, 50, 17, 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,189,100,0.5)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = "#ffd091";
        ctx.font = "bold 9px monospace";
        ctx.textAlign = "center";
        ctx.fillText("T-" + point.number, point.x, point.y - 41);
        ctx.restore();
      });

      points.forEach((point, index) => {
        if (index === state.activeIndex || state.mode === "complete") return;
        const direction = index === 1 || index === 3 ? 1 : -1;
        ctx.save();
        ctx.globalAlpha = 0.42;
        ctx.strokeStyle = "rgba(156,177,169,0.65)";
        ctx.fillStyle = "rgba(5,16,21,0.74)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 13, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(226,235,222,0.8)";
        ctx.font = "7px monospace";
        ctx.textAlign = "center";
        ctx.fillText("T-" + point.number, point.x + direction * 28, point.y + 2);
        ctx.restore();
      });
    }

    drawHuman(ctx, x, y, scale, passenger, wave = 0, seated = false) {
      const color = passenger.color || "#dfb36d";
      const bodyColor = passenger.jacket || "#446a6a";
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);

      ctx.strokeStyle = "rgba(6,14,18,0.68)";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      if (seated) {
        linePath(ctx, -3, -13, -13, 13);
        linePath(ctx, 4, -13, 17, 8);
        linePath(ctx, 17, 8, 20, 22);
      } else {
        linePath(ctx, -3, -14, -8, 16);
        linePath(ctx, 4, -14, 9, 16);
      }

      ctx.fillStyle = bodyColor;
      roundedRect(ctx, -9, -34, 18, 26, 5);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillRect(-9, -22, 18, 3);
      ctx.strokeStyle = "rgba(255,221,160,0.55)";
      ctx.lineWidth = 1;
      linePath(ctx, -6, -31, 6, -11);

      if (!seated) {
        ctx.strokeStyle = bodyColor;
        ctx.lineWidth = 4;
        linePath(ctx, -8, -28, -18, -18 + wave * 8);
        linePath(ctx, 8, -28, 17, -14 - wave * 21);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(17, -14 - wave * 21, 2.7, 0, TAU);
        ctx.fill();
      }

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, -41, 6.2, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#efe0bb";
      ctx.beginPath();
      ctx.arc(0, -43.5, 6.1, Math.PI, TAU);
      ctx.fill();
      ctx.fillStyle = "rgba(10,21,23,0.85)";
      ctx.fillRect(-5, -43, 10, 1.5);
      ctx.restore();
    }

    drawDockingGuide(ctx, state) {
      const point = SceneRenderer.LAYOUT.transferPoints[state.activeIndex];
      if (!point || state.mode === "complete") return;
      const dock = state.dock;
      if (!dock) return;
      const basket = state.basket;
      const dx = basket.x - point.x;
      const dy = basket.y - point.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 380) return;

      const color = dock.aligned ? "#72d8c4" : "#ffbd64";
      ctx.save();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 8]);
      linePath(ctx, point.x, point.y, basket.x, basket.y);
      ctx.setLineDash([]);

      ctx.globalAlpha = 0.46;
      roundedRect(ctx, point.x - dock.tolX, point.y - dock.tolY, dock.tolX * 2, dock.tolY * 2, 9);
      ctx.stroke();
      ctx.globalAlpha = 0.045;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 0.65;
      ctx.fillStyle = color;
      ctx.font = "8px monospace";
      ctx.textAlign = "left";
      ctx.fillText("DOCK " + Math.round(dock.tolX) + "m", point.x - dock.tolX, point.y - dock.tolY - 8);
      ctx.textAlign = "right";
      ctx.fillText(dock.gust ? "GUST TOL" : "NOMINAL", point.x + dock.tolX, point.y - dock.tolY - 8);
      ctx.restore();
    }

    drawRescueRig(ctx, state) {
      const basket = state.basket;
      if (!basket) return;
      const tx = clamp(basket.x, 225, 1375);
      const ty = cableY(tx, 178, 98, 1422, 98, 139);
      const angle = basket.angle;
      const suspension = {
        x: basket.x + Math.sin(angle) * 35,
        y: basket.y - Math.cos(angle) * 35
      };
      const rope = state.ropeInput || { left: 0, right: 0 };
      const gust = state.wind.gust;

      ctx.save();
      ctx.lineCap = "round";

      const drum = ctx.createLinearGradient(tx - 28, ty - 9, tx + 28, ty + 9);
      drum.addColorStop(0, "#879d90");
      drum.addColorStop(0.5, "#d9c08e");
      drum.addColorStop(1, "#5e6659");
      ctx.fillStyle = drum;
      roundedRect(ctx, tx - 29, ty - 9, 58, 18, 5);
      ctx.fill();
      ctx.strokeStyle = "rgba(7,17,19,0.7)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#1f3537";
      ctx.beginPath();
      ctx.arc(tx - 18, ty - 4, 4, 0, TAU);
      ctx.arc(tx + 18, ty - 4, 4, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "rgba(244,232,195,0.48)";
      for (let i = -2; i <= 2; i++) {
        linePath(ctx, tx + i * 5, ty - 1, tx + i * 5, ty + 6);
      }

      ctx.strokeStyle = "rgba(219,230,215,0.55)";
      ctx.lineWidth = 1.6;
      linePath(ctx, tx + 1.5, ty + 7, suspension.x + 1.5, suspension.y);
      ctx.strokeStyle = "rgba(133,157,149,0.33)";
      ctx.lineWidth = 0.7;
      linePath(ctx, tx - 2, ty + 7, suspension.x - 2, suspension.y + 1);

      const leftAnchor = { x: tx - 136 - Math.sin(angle) * 62, y: ty + 5 };
      const rightAnchor = { x: tx + 136 - Math.sin(angle) * 62, y: ty + 5 };
      const leftTop = this.basketPoint(basket, -67, -22);
      const rightTop = this.basketPoint(basket, 67, -22);
      ctx.strokeStyle = "rgba(255,189,100," + (0.2 + rope.left * 0.65).toFixed(3) + ")";
      ctx.lineWidth = 0.65 + rope.left * 1.4;
      linePath(ctx, leftAnchor.x, leftAnchor.y, leftTop.x, leftTop.y);
      ctx.strokeStyle = "rgba(255,189,100," + (0.2 + rope.right * 0.65).toFixed(3) + ")";
      ctx.lineWidth = 0.65 + rope.right * 1.4;
      linePath(ctx, rightAnchor.x, rightAnchor.y, rightTop.x, rightTop.y);

      if (gust && (rope.left > 0.18 || rope.right > 0.18)) {
        ctx.globalCompositeOperation = "screen";
        const glow = ctx.createRadialGradient(tx, ty, 3, tx, ty, 150);
        glow.addColorStop(0, "rgba(255,189,100,0.04)");
        glow.addColorStop(1, "rgba(255,189,100,0)");
        ctx.fillStyle = glow;
        ctx.fillRect(tx - 160, ty - 30, 320, 280);
      }
      ctx.restore();
    }

    basketPoint(basket, localX, localY) {
      const cos = Math.cos(basket.angle);
      const sin = Math.sin(basket.angle);
      return {
        x: basket.x + localX * cos - localY * sin,
        y: basket.y + localX * sin + localY * cos
      };
    }

    drawBasket(ctx, state) {
      const basket = state.basket;
      if (!basket) return;
      const aligned = state.dock && state.dock.aligned;
      const transferring = state.mode === "transfer";

      ctx.save();
      ctx.translate(basket.x, basket.y);
      ctx.rotate(basket.angle);

      if (aligned || transferring) {
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        const glow = ctx.createRadialGradient(0, 0, 12, 0, 0, 100);
        glow.addColorStop(0, transferring ? "rgba(255,189,100,0.16)" : "rgba(114,216,196,0.15)");
        glow.addColorStop(1, "rgba(114,216,196,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.ellipse(0, 7, 110, 77, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }

      ctx.fillStyle = "rgba(7,19,22,0.9)";
      ctx.beginPath();
      ctx.moveTo(-74, -17);
      ctx.lineTo(74, -17);
      ctx.lineTo(66, 31);
      ctx.quadraticCurveTo(0, 39, -66, 31);
      ctx.closePath();
      ctx.fill();

      const shell = ctx.createLinearGradient(0, -17, 0, 34);
      shell.addColorStop(0, "#476e68");
      shell.addColorStop(0.45, "#294d4d");
      shell.addColorStop(1, "#132e32");
      ctx.fillStyle = shell;
      ctx.beginPath();
      ctx.moveTo(-69, -14);
      ctx.lineTo(69, -14);
      ctx.lineTo(62, 26);
      ctx.quadraticCurveTo(0, 33, -62, 26);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = "rgba(170,207,190,0.28)";
      ctx.lineWidth = 1;
      for (let x = -57; x <= 57; x += 13) {
        linePath(ctx, x, -12, x * 0.9, 27);
      }
      for (let y = -7; y < 26; y += 8) {
        linePath(ctx, -65, y, 65, y);
      }

      const rim = ctx.createLinearGradient(-74, 0, 74, 0);
      rim.addColorStop(0, "#8b6941");
      rim.addColorStop(0.45, "#ffd08b");
      rim.addColorStop(1, "#795739");
      ctx.fillStyle = rim;
      roundedRect(ctx, -74, -20, 148, 8, 4);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,224,167,0.42)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.strokeStyle = "rgba(243,218,171,0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-66, -19);
      ctx.quadraticCurveTo(0, -53, 66, -19);
      ctx.stroke();
      for (let i = -2; i <= 2; i++) {
        linePath(ctx, i * 27, -21, i * 27, -39 + Math.abs(i) * 5);
      }

      ctx.fillStyle = "rgba(255,214,142,0.78)";
      ctx.font = "7px monospace";
      ctx.textAlign = "center";
      ctx.fillText("RESCUE 04", 0, 18);

      const seated = state.passengers.filter((passenger) => passenger.status === "aboard");
      seated.forEach((passenger) => {
        const seatX = passenger.seatX;
        ctx.save();
        ctx.translate(seatX, 3);
        this.drawHuman(ctx, 0, 11, 0.52, passenger, 0, true);
        ctx.restore();
      });

      if (state.mode === "transfer" && state.transfer) {
        const index = state.transfer.passengerIndex;
        const passenger = state.passengers[index];
        const point = SceneRenderer.LAYOUT.transferPoints[index];
        if (passenger && point) {
          const progress = state.transfer.progress;
          const ease = progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;
          const dest = this.basketPoint(basket, passenger.seatX, 2);
          const fromX = point.x + (index === 1 || index === 3 ? 1 : -1) * 17;
          const fromY = point.y + 25;
          const x = mix(fromX, dest.x, ease);
          const y = mix(fromY, dest.y, ease) - Math.sin(ease * Math.PI) * 43;
          ctx.save();
          ctx.translate(basket.x, basket.y);
          ctx.rotate(basket.angle);
          ctx.translate(-basket.x, -basket.y);
          this.drawHuman(ctx, x, y, 0.8, passenger, 0.1);
          ctx.restore();
          ctx.save();
          ctx.strokeStyle = "rgba(255,189,100,0.55)";
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 4]);
          linePath(ctx, point.x, point.y, x, y - 35);
          ctx.restore();
        }
      }
      ctx.restore();

      const cog = state.cog || 0;
      if (state.totalWeight > 0) {
        const offset = clamp(cog / 50, -1, 1) * 44;
        const marker = this.basketPoint(basket, offset, 40);
        const heavySide = offset < -3 ? "L" : offset > 3 ? "R" : "0";
        const color = Math.abs(offset) > 18 ? "#f06958" : "#72d8c4";
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.72;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(marker.x, marker.y - 7);
        ctx.lineTo(marker.x - 4, marker.y);
        ctx.lineTo(marker.x + 4, marker.y);
        ctx.closePath();
        ctx.fill();
        ctx.font = "7px monospace";
        ctx.textAlign = "center";
        ctx.fillText("CG " + heavySide, marker.x, marker.y + 9);
        ctx.restore();
      }
    }

    updateWind(dt, state) {
      const wind = state.wind || { speed: 4, dir: 1, gust: false };
      const drift = wind.dir * (12 + wind.speed * 8);
      for (const streak of this.streaks) {
        streak.x += drift * streak.speed * dt;
        streak.y += Math.sin(this.time * 0.7 + streak.phase) * 8 * dt;
        if (drift >= 0 && streak.x > WORLD_W + 170) streak.x = -170 + streak.lane * 68;
        if (drift < 0 && streak.x < -170) streak.x = WORLD_W + 170 - streak.lane * 68;
        if (streak.y < 40) streak.y = 810;
        if (streak.y > 830) streak.y = 50;
      }
      for (const flake of this.snow) {
        flake.x += (wind.dir * wind.speed * 1.2 + flake.drift) * dt;
        flake.y += flake.speed * dt;
        if (flake.y > WORLD_H + 12) {
          flake.y = -12;
          flake.x = Math.random() * WORLD_W;
        }
        if (flake.x < -20) flake.x = WORLD_W + 20;
        if (flake.x > WORLD_W + 20) flake.x = -20;
      }
      for (const mote of this.motes) {
        mote.x += wind.dir * (4 + wind.speed * 0.8) * dt;
        mote.y -= mote.speed * 0.14 * dt;
        if (mote.x < 0) mote.x = WORLD_W;
        if (mote.x > WORLD_W) mote.x = 0;
        if (mote.y < 405) mote.y = 780;
      }
    }

    drawWind(ctx, state) {
      const wind = state.wind;
      if (!wind) return;
      const gust = wind.gust;
      const strength = clamp(wind.speed / 18, 0.25, 1);
      ctx.save();
      ctx.lineCap = "round";
      const alpha = (!gust ? 0.35 : 0.62) * strength;
      for (const streak of this.streaks) {
        const wobble = Math.sin(this.time * 1.7 + streak.phase) * 6;
        const tailX = streak.x - wind.dir * streak.len;
        const tailY = streak.y - 4 + wobble * 0.18;
        ctx.strokeStyle = gust
          ? "rgba(246,212,190," + (streak.alpha * alpha * 1.7).toFixed(3) + ")"
          : "rgba(186,215,207," + (streak.alpha * alpha).toFixed(3) + ")";
        ctx.lineWidth = gust ? 1.1 : 0.7;
        ctx.beginPath();
        ctx.moveTo(streak.x, streak.y);
        ctx.bezierCurveTo(
          streak.x - wind.dir * streak.len * 0.34,
          streak.y + wobble * 0.5,
          streak.x - wind.dir * streak.len * 0.7,
          streak.y - wobble,
          tailX,
          tailY
        );
        ctx.stroke();
      }

      if (gust) {
        const sweep = (this.time * 70) % (WORLD_W + 400) - 200;
        const front = wind.dir > 0 ? sweep : WORLD_W - sweep;
        const gradient = ctx.createLinearGradient(front - wind.dir * 220, 0, front, 0);
        gradient.addColorStop(0, "rgba(240,190,150,0)");
        gradient.addColorStop(0.7, "rgba(240,190,150,0.05)");
        gradient.addColorStop(1, "rgba(246,212,190,0.11)");
        ctx.fillStyle = gradient;
        ctx.fillRect(front - wind.dir * 240, 70, 260, 680);
      }
      ctx.restore();
    }

    drawForegroundWeather(ctx, state) {
      const wind = state.wind || { speed: 3 };
      ctx.save();
      for (const flake of this.snow) {
        const flicker = 0.5 + Math.sin(this.time * 3 + flake.phase) * 0.5;
        ctx.fillStyle = "rgba(236,243,231," + (flake.alpha * (0.45 + flicker * 0.55)).toFixed(3) + ")";
        ctx.beginPath();
        ctx.ellipse(flake.x, flake.y, flake.size, flake.size * 0.75, 0, 0, TAU);
        ctx.fill();
      }
      for (const mote of this.motes) {
        ctx.fillStyle = "rgba(255,189,100,0.05)";
        ctx.beginPath();
        ctx.arc(mote.x, mote.y, mote.size, 0, TAU);
        ctx.fill();
      }

      const gust = state.wind && state.wind.gust;
      const count = gust ? 7 : 3;
      for (let i = 0; i < count; i++) {
        const phase = this.time * (0.8 + i * 0.1) + i * 1.7;
        const x = (i % 2 === 0 ? 20 : WORLD_W - 20) + Math.sin(phase) * 24;
        const y = 520 + i * 48;
        ctx.strokeStyle = "rgba(238,245,234," + (gust ? 0.18 : 0.07) + ")";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + (i % 2 ? -52 : 52), y - 22, x + (i % 2 ? -78 : 78), y + 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawScreenEffects(ctx, state) {
      if (state.flash && state.flash > 0) {
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.fillStyle = "rgba(240,88,67," + (state.flash * 0.16).toFixed(3) + ")";
        ctx.fillRect(0, 0, WORLD_W, WORLD_H);
        if (state.flash > 0.45) {
          ctx.fillStyle = "rgba(255,226,207," + ((state.flash - 0.45) * 0.4).toFixed(3) + ")";
          ctx.fillRect(0, 0, WORLD_W, WORLD_H);
        }
        ctx.restore();
      }
      if (state.paused) {
        ctx.save();
        ctx.fillStyle = "rgba(4,14,20,0.38)";
        ctx.fillRect(0, 0, WORLD_W, WORLD_H);
        ctx.restore();
      }
    }
  }

  SceneRenderer.LAYOUT = LAYOUT;
  SceneRenderer.cableY = cableY;
  SceneRenderer.WORLD_W = WORLD_W;
  SceneRenderer.WORLD_H = WORLD_H;
  window.SceneRenderer = SceneRenderer;
})();
