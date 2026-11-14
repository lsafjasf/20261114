(function () {
  "use strict";

  const C = window.ARM_CONFIG;
  const { WORLD, ARM, COLORS, clamp, distance } = C;

  function roundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width * 0.5, height * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function capsule(ctx, a, b, radius) {
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.beginPath();
    ctx.arc(a.x, a.y, radius, angle + Math.PI * 0.5, angle + Math.PI * 1.5);
    ctx.arc(b.x, b.y, radius, angle - Math.PI * 0.5, angle + Math.PI * 0.5);
    ctx.closePath();
  }

  function angleDegrees(value) {
    const degrees = (value * 180) / Math.PI;
    return `${degrees >= 0 ? "+" : ""}${degrees.toFixed(1)}°`;
  }

  function hexToRgba(hex, alpha) {
    const clean = hex.replace("#", "");
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  class OrbitalRenderer {
    constructor(canvas, game) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d", { alpha: false });
      this.game = game;
      this.stars = C.makeStars();
      this.pixelRatio = 1;
      this.resize();
    }

    resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (this.canvas.width !== WORLD.width * dpr || this.canvas.height !== WORLD.height * dpr) {
        this.canvas.width = Math.round(WORLD.width * dpr);
        this.canvas.height = Math.round(WORLD.height * dpr);
      }
      this.pixelRatio = dpr;
    }

    render(timeMs) {
      this.resize();
      const ctx = this.ctx;
      const game = this.game;
      const time = timeMs / 1000;
      ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
      ctx.clearRect(0, 0, WORLD.width, WORLD.height);

      const shake = game.shake;
      const shakeX = shake > 0 ? Math.sin(time * 87) * shake : 0;
      const shakeY = shake > 0 ? Math.cos(time * 71) * shake * 0.6 : 0;
      ctx.save();
      ctx.translate(shakeX, shakeY);
      this.drawBackground(time);
      this.drawStation(time);
      this.drawSlots(time);
      this.drawArmBack();
      this.drawPods(time);
      this.drawGripper(time);
      this.drawParticles();
      if (game.flash > 0) {
        ctx.fillStyle = `rgba(255, 74, 56, ${game.flash * 0.28})`;
        ctx.fillRect(-20, -20, WORLD.width + 40, WORLD.height + 40);
      }
      ctx.restore();
      this.drawHud(time);
      this.drawOverlay(time);
    }

    drawBackground(time) {
      const ctx = this.ctx;
      const gradient = ctx.createRadialGradient(640, 380, 80, 640, 380, 780);
      gradient.addColorStop(0, "#0a1b2b");
      gradient.addColorStop(0.55, "#050e19");
      gradient.addColorStop(1, "#02060c");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, WORLD.width, WORLD.height);

      const nebula = ctx.createRadialGradient(1040, 170, 10, 1040, 170, 430);
      nebula.addColorStop(0, "rgba(26, 130, 146, 0.11)");
      nebula.addColorStop(0.5, "rgba(25, 65, 102, 0.06)");
      nebula.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = nebula;
      ctx.fillRect(0, 0, WORLD.width, 760);

      for (const star of this.stars) {
        const twinkle = 0.58 + Math.sin(time * 0.8 + star.phase) * 0.32;
        const y = (star.y + time * star.drift) % 720;
        ctx.globalAlpha = star.alpha * twinkle;
        ctx.fillStyle = star.size > 1.45 ? "#b7f8ff" : "#d5ecf2";
        ctx.fillRect(star.x, y, star.size, star.size);
      }
      ctx.globalAlpha = 1;

      const earth = ctx.createLinearGradient(0, 760, 0, 800);
      earth.addColorStop(0, "rgba(18, 75, 94, 0)");
      earth.addColorStop(1, "rgba(29, 108, 122, 0.18)");
      ctx.fillStyle = earth;
      ctx.fillRect(0, 690, WORLD.width, 110);
    }

    drawStation(time) {
      const ctx = this.ctx;
      ctx.save();
      ctx.shadowColor = "rgba(32, 178, 205, 0.35)";
      ctx.shadowBlur = 28;
      roundRect(ctx, 62, 96, 1156, 616, 18);
      ctx.fillStyle = "rgba(6, 17, 28, 0.96)";
      ctx.fill();
      ctx.restore();

      const floor = ctx.createLinearGradient(90, 150, 1160, 680);
      floor.addColorStop(0, "#0a1a26");
      floor.addColorStop(0.45, "#07131f");
      floor.addColorStop(1, "#0b1a23");
      roundRect(ctx, 86, 118, 1108, 572, 12);
      ctx.fillStyle = floor;
      ctx.fill();

      ctx.save();
      roundRect(ctx, 86, 118, 1108, 572, 12);
      ctx.clip();
      ctx.strokeStyle = "rgba(92, 180, 194, 0.075)";
      ctx.lineWidth = 1;
      for (let x = 104; x < 1190; x += 52) {
        ctx.beginPath();
        ctx.moveTo(x, 118);
        ctx.lineTo(x, 690);
        ctx.stroke();
      }
      for (let y = 138; y < 690; y += 52) {
        ctx.beginPath();
        ctx.moveTo(86, y);
        ctx.lineTo(1194, y);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(100, 226, 239, 0.11)";
      ctx.setLineDash([3, 9]);
      ctx.strokeRect(126, 158, 1018, 488);
      ctx.setLineDash([]);
      ctx.restore();

      this.drawRail(68, 102, 1144, 44, "top", time);
      this.drawRail(68, 658, 1144, 44, "bottom", time);
      this.drawSideRail(58, 146, 24, 512, "left");
      this.drawSideRail(1198, 146, 24, 512, "right");

      ctx.fillStyle = "rgba(3, 9, 14, 0.72)";
      roundRect(ctx, 92, 126, 188, 24, 3);
      ctx.fill();
      ctx.fillStyle = "rgba(126, 221, 233, 0.55)";
      ctx.font = "600 10px 'DIN Alternate', 'Segoe UI', sans-serif";
      ctx.letterSpacing = "1.8px";
      ctx.fillText("CARGO BAY 07  /  PRESSURIZED", 103, 142);

      const drift = C.DRIFT_AREA;
      ctx.strokeStyle = "rgba(83, 202, 218, 0.2)";
      ctx.lineWidth = 1;
      ctx.setLineDash([7, 8]);
      roundRect(ctx, drift.x, drift.y, drift.w, drift.h, 18);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(105, 212, 226, 0.38)";
      ctx.font = "600 9px 'DIN Alternate', 'Segoe UI', sans-serif";
      ctx.letterSpacing = "2.1px";
      ctx.fillText("FLOAT ZONE  /  吊舱漂浮区", drift.x + 18, drift.y + 22);

      for (const [x, y] of [
        [100, 130],
        [1180, 130],
        [100, 678],
        [1180, 678],
      ]) {
        ctx.fillStyle = "rgba(7, 17, 25, 0.95)";
        ctx.strokeStyle = "rgba(122, 221, 230, 0.34)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(159, 235, 242, 0.45)";
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    drawRail(x, y, width, height, side, time) {
      const ctx = this.ctx;
      const gradient = ctx.createLinearGradient(0, y, 0, y + height);
      gradient.addColorStop(0, "#172b37");
      gradient.addColorStop(0.36, "#0b1822");
      gradient.addColorStop(1, "#050d14");
      ctx.fillStyle = gradient;
      roundRect(ctx, x, y, width, height, 5);
      ctx.fill();
      ctx.strokeStyle = "rgba(101, 208, 224, 0.24)";
      ctx.lineWidth = 1;
      ctx.stroke();

      const pulse = 0.12 + Math.sin(time * 1.8) * 0.035;
      ctx.strokeStyle = `rgba(255, 170, 61, ${pulse + 0.11})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 10, side === "top" ? y + height - 3 : y + 3);
      ctx.lineTo(x + width - 10, side === "top" ? y + height - 3 : y + 3);
      ctx.stroke();

      ctx.strokeStyle = "rgba(255, 179, 69, 0.25)";
      ctx.lineWidth = 5;
      for (let stripe = x + 24; stripe < x + width - 20; stripe += 92) {
        ctx.beginPath();
        ctx.moveTo(stripe, y + height - 1);
        ctx.lineTo(stripe + 23, y + 2);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(157, 218, 224, 0.34)";
      ctx.font = "600 8px 'DIN Alternate', 'Segoe UI', sans-serif";
      ctx.letterSpacing = "1.6px";
      const label = side === "top" ? "DOCKING RAIL / 上部舱壁" : "DOCKING RAIL / 下部舱壁";
      ctx.fillText(label, x + width - 235, y + (side === "top" ? 26 : 28));
    }

    drawSideRail(x, y, width, height, side) {
      const ctx = this.ctx;
      ctx.fillStyle = "#08141e";
      roundRect(ctx, x, y, width, height, 4);
      ctx.fill();
      ctx.strokeStyle = "rgba(102, 207, 220, 0.18)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = side === "left" ? "rgba(255, 177, 62, 0.22)" : "rgba(80, 225, 235, 0.15)";
      for (let stripe = y + 22; stripe < y + height - 22; stripe += 68) {
        ctx.fillRect(x + 8, stripe, 8, 22);
      }
    }

    drawSlots(time) {
      const ctx = this.ctx;
      for (const pod of this.game.pods) {
        const x = pod.slotX;
        const y = pod.slotY;
        const color = pod.color;
        const filled = pod.state === "docked";
        const active = !filled && !this.game.arm.holding;

        ctx.save();
        ctx.translate(x, y);
        ctx.globalAlpha = filled ? 0.88 : 0.52;
        ctx.strokeStyle = color;
        ctx.lineWidth = filled ? 2 : 1;
        ctx.setLineDash(filled ? [] : [5, 7]);
        ctx.beginPath();
        ctx.arc(0, 0, 50, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.rotate(time * 0.12 + pod.index);
        ctx.strokeStyle = filled ? color : "rgba(154, 221, 230, 0.3)";
        ctx.lineWidth = 2;
        for (let i = 0; i < 4; i += 1) {
          ctx.beginPath();
          ctx.arc(0, 0, 57, i * Math.PI * 0.5, i * Math.PI * 0.5 + 0.34);
          ctx.stroke();
        }
        ctx.rotate(-(time * 0.12 + pod.index));

        ctx.fillStyle = filled ? "rgba(11, 35, 38, 0.8)" : "rgba(5, 17, 24, 0.72)";
        ctx.beginPath();
        ctx.arc(0, 0, 37, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = filled ? color : "rgba(152, 223, 230, 0.18)";
        ctx.stroke();

        if (active) {
          const pulse = 0.45 + Math.sin(time * 3 + pod.index) * 0.2;
          ctx.strokeStyle = color;
          ctx.globalAlpha = pulse;
          ctx.setLineDash([3, 9]);
          ctx.beginPath();
          ctx.arc(0, 0, 44 + Math.sin(time * 2.2 + pod.index) * 2, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.globalAlpha = 1;
        ctx.rotate(-Math.PI * 0.5);
        ctx.fillStyle = color;
        ctx.font = "700 10px 'DIN Alternate', 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.letterSpacing = "1.2px";
        ctx.fillText(filled ? "LOCKED" : `SLOT 0${pod.index + 1}`, 0, 18);
        ctx.rotate(Math.PI * 0.5);
        ctx.fillStyle = "rgba(215, 248, 251, 0.58)";
        ctx.font = "600 8px 'DIN Alternate', 'Segoe UI', sans-serif";
        ctx.fillText(pod.id, 0, -9);
        ctx.textAlign = "left";
        ctx.restore();
      }
    }

    drawArmBack() {
      const game = this.game;
      const geom = game.geometry();
      const ctx = this.ctx;
      game.arm.lastGeometry = geom;

      ctx.save();
      ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
      ctx.beginPath();
      ctx.ellipse(ARM.baseX + 7, ARM.baseY + 12, 76, 38, -0.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      this.drawMotorGlow(geom.base);
      this.drawBaseMount();
      this.drawLink(geom.base, geom.elbow, 14, 0.02);
      this.drawLink(geom.elbow, geom.wrist, 13, 0.12);
      this.drawTelescope(geom);
      this.drawJointBadges(geom);
    }

    drawMotorGlow(point) {
      const level = this.game.motorLevel;
      if (level < 0.03) return;
      const ctx = this.ctx;
      const glow = ctx.createRadialGradient(point.x, point.y, 2, point.x, point.y, 88);
      glow.addColorStop(0, `rgba(255, 171, 60, ${level * 0.2})`);
      glow.addColorStop(0.4, `rgba(64, 222, 236, ${level * 0.1})`);
      glow.addColorStop(1, "rgba(50, 190, 220, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 88, 0, Math.PI * 2);
      ctx.fill();
    }

    drawBaseMount() {
      const ctx = this.ctx;
      const x = ARM.baseX;
      const y = ARM.baseY;
      ctx.save();
      const ring = ctx.createRadialGradient(x - 10, y - 12, 4, x, y, 52);
      ring.addColorStop(0, "#304a55");
      ring.addColorStop(0.62, "#162832");
      ring.addColorStop(1, "#08131c");
      ctx.fillStyle = ring;
      ctx.beginPath();
      ctx.arc(x, y, 50, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(113, 220, 232, 0.38)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.strokeStyle = "rgba(89, 208, 223, 0.24)";
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.arc(x, y, 61, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      for (let i = 0; i < 8; i += 1) {
        const angle = (i / 8) * Math.PI * 2;
        ctx.fillStyle = i % 2 ? "rgba(226, 171, 83, 0.54)" : "rgba(110, 192, 201, 0.46)";
        ctx.beginPath();
        ctx.arc(x + Math.cos(angle) * 42, y + Math.sin(angle) * 42, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#08131b";
      ctx.beginPath();
      ctx.arc(x, y, 31, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(165, 231, 239, 0.32)";
      ctx.stroke();
      ctx.fillStyle = "rgba(255, 176, 72, 0.75)";
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    drawLink(a, b, width, accentOffset) {
      const ctx = this.ctx;
      ctx.save();
      capsule(ctx, a, b, width + 8);
      ctx.fillStyle = "rgba(0, 0, 0, 0.52)";
      ctx.fill();

      capsule(ctx, a, b, width + 3);
      const gradient = ctx.createLinearGradient(a.x, a.y + width, b.x, b.y - width);
      gradient.addColorStop(0, "#101e27");
      gradient.addColorStop(0.45, "#344b55");
      gradient.addColorStop(0.55, "#6c8790");
      gradient.addColorStop(0.7, "#243943");
      gradient.addColorStop(1, "#0c1820");
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.strokeStyle = "rgba(159, 220, 226, 0.29)";
      ctx.lineWidth = 1;
      ctx.stroke();

      capsule(ctx, a, b, width * 0.38);
      ctx.fillStyle = "rgba(5, 15, 21, 0.58)";
      ctx.fill();
      ctx.strokeStyle = "rgba(109, 216, 227, 0.2)";
      ctx.stroke();

      const length = distance(a.x, a.y, b.x, b.y);
      const normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
      const start = accentOffset * length + 20;
      for (let along = start; along < length - 14; along += 34) {
        const t = along / length;
        const px = a.x + (b.x - a.x) * t;
        const py = a.y + (b.y - a.y) * t;
        ctx.strokeStyle = "rgba(255, 175, 68, 0.28)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px - normal.x * 8, py - normal.y * 8);
        ctx.lineTo(px + normal.x * 8, py + normal.y * 8);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawTelescope(geom) {
      const ctx = this.ctx;
      const a = geom.elbow;
      const b = geom.wrist;
      const length = this.game.arm.extension;
      const dir = geom.forearmDir;
      const normal = { x: -dir.y, y: dir.x };
      const sleeve = Math.min(155, length);
      ctx.save();

      ctx.strokeStyle = "rgba(166, 221, 226, 0.52)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(a.x + normal.x * 12, a.y + normal.y * 12);
      ctx.lineTo(a.x + dir.x * sleeve + normal.x * 12, a.y + dir.y * sleeve + normal.y * 12);
      ctx.moveTo(a.x - normal.x * 12, a.y - normal.y * 12);
      ctx.lineTo(a.x + dir.x * sleeve - normal.x * 12, a.y + dir.y * sleeve - normal.y * 12);
      ctx.stroke();

      const railStart = a.x + dir.x * 70;
      const railStartY = a.y + dir.y * 70;
      ctx.strokeStyle = "rgba(86, 217, 230, 0.58)";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(railStart, railStartY);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      ctx.strokeStyle = "rgba(4, 12, 18, 0.8)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(railStart, railStartY);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      ctx.fillStyle = "rgba(255, 176, 69, 0.62)";
      const markerTravel = length - sleeve;
      for (let offset = 0; offset <= markerTravel; offset += 22) {
        const px = a.x + dir.x * (sleeve + offset);
        const py = a.y + dir.y * (sleeve + offset);
        ctx.beginPath();
        ctx.arc(px, py, offset % 44 === 0 ? 2.2 : 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    drawJointBadges(geom) {
      const ctx = this.ctx;
      const game = this.game;
      ctx.save();
      ctx.strokeStyle = "rgba(88, 225, 238, 0.42)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ARM.baseX, ARM.baseY, 72, 0, game.arm.angle, game.arm.angle < 0);
      ctx.stroke();
      for (let i = 0; i <= 4; i += 1) {
        const a = (game.arm.angle * i) / 4;
        ctx.strokeStyle = "rgba(119, 234, 244, 0.33)";
        ctx.beginPath();
        ctx.moveTo(
          ARM.baseX + Math.cos(a) * 65,
          ARM.baseY + Math.sin(a) * 65
        );
        ctx.lineTo(
          ARM.baseX + Math.cos(a) * 78,
          ARM.baseY + Math.sin(a) * 78
        );
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(4, 16, 24, 0.82)";
      roundRect(ctx, ARM.baseX + 62, ARM.baseY - 63, 122, 23, 3);
      ctx.fill();
      ctx.strokeStyle = "rgba(83, 211, 226, 0.24)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "rgba(179, 241, 247, 0.78)";
      ctx.font = "600 9px 'DIN Alternate', 'Segoe UI', sans-serif";
      ctx.fillText(`SHOULDER θ ${angleDegrees(game.arm.angle)}`, ARM.baseX + 70, ARM.baseY - 48);

      ctx.strokeStyle = "rgba(255, 176, 69, 0.46)";
      ctx.beginPath();
      ctx.arc(geom.wrist.x, geom.wrist.y, 19, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#07141d";
      ctx.beginPath();
      ctx.arc(geom.wrist.x, geom.wrist.y, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(234, 176, 89, 0.56)";
      ctx.beginPath();
      ctx.arc(geom.wrist.x, geom.wrist.y, 11, 0, Math.PI * 2);
      ctx.stroke();

      const badgeX = geom.wrist.x - 48;
      const badgeY = geom.wrist.y + 35;
      ctx.fillStyle = "rgba(4, 14, 22, 0.78)";
      roundRect(ctx, badgeX, badgeY, 135, 21, 3);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 197, 122, 0.8)";
      ctx.font = "600 8px 'DIN Alternate', 'Segoe UI', sans-serif";
      ctx.fillText(`WRIST ψ ${angleDegrees(ARM.elbowBend)}`, badgeX + 9, badgeY + 14);
      ctx.restore();
    }

    drawPods(time) {
      const ctx = this.ctx;
      const game = this.game;
      for (const pod of game.pods) {
        if (pod.state === "free") {
          const targetAlpha = pod.index === 0 ? 0.16 : 0.08;
          ctx.save();
          ctx.globalAlpha = targetAlpha;
          ctx.strokeStyle = pod.color;
          ctx.lineWidth = 1;
          ctx.setLineDash([5, 12]);
          ctx.lineDashOffset = -time * 16;
          ctx.beginPath();
          ctx.moveTo(pod.x, pod.y);
          ctx.lineTo(pod.slotX, pod.slotY);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }

        if (pod.state !== "docked") {
          this.drawVelocityLine(pod, time);
        }
        this.drawPodBody(pod, time);
      }
    }

    drawVelocityLine(pod, time) {
      const ctx = this.ctx;
      let vx = pod.vx;
      let vy = pod.vy;
      if (pod.state === "held") {
        const velocity = this.game.gripVelocity(this.game.geometry());
        vx = velocity.x;
        vy = velocity.y;
      }
      const speed = Math.hypot(vx, vy);
      if (speed < 0.4) return;
      const nx = vx / speed;
      const ny = vy / speed;
      const length = clamp(14 + speed * 2.1, 20, 92);
      const startX = pod.x + nx * (pod.radius + 8);
      const startY = pod.y + ny * (pod.radius + 8);
      const endX = startX + nx * length;
      const endY = startY + ny * length;

      ctx.save();
      ctx.globalAlpha = pod.state === "held" ? 0.3 : 0.58;
      ctx.strokeStyle = pod.color;
      ctx.lineWidth = 1.3;
      ctx.setLineDash([4, 5]);
      ctx.lineDashOffset = -time * 20;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      ctx.setLineDash([]);
      const arrowSize = 7;
      ctx.beginPath();
      ctx.moveTo(endX, endY);
      ctx.lineTo(
        endX - nx * arrowSize - ny * arrowSize * 0.55,
        endY - ny * arrowSize + nx * arrowSize * 0.55
      );
      ctx.moveTo(endX, endY);
      ctx.lineTo(
        endX - nx * arrowSize + ny * arrowSize * 0.55,
        endY - ny * arrowSize - nx * arrowSize * 0.55
      );
      ctx.stroke();
      ctx.font = "600 8px 'DIN Alternate', 'Segoe UI', sans-serif";
      ctx.fillStyle = "rgba(207, 244, 248, 0.64)";
      ctx.fillText(`v ${speed.toFixed(1)}`, endX + 5, endY - 6);
      ctx.restore();
    }

    drawPodBody(pod, time) {
      const ctx = this.ctx;
      const radius = pod.radius;
      const docked = pod.state === "docked";
      const held = pod.state === "held";
      ctx.save();
      ctx.translate(pod.x, pod.y);
      ctx.rotate(pod.angle);

      const halo = ctx.createRadialGradient(0, 0, radius * 0.4, 0, 0, radius * 2.2);
      halo.addColorStop(0, hexToRgba(pod.color, 0.12));
      halo.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.globalAlpha = held ? 0.78 : 0.4;
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, radius * 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      const points = 8;
      ctx.beginPath();
      for (let i = 0; i < points; i += 1) {
        const a = (i / points) * Math.PI * 2 + 0.18;
        const px = Math.cos(a) * radius * 1.08;
        const py = Math.sin(a) * radius * 0.84;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      const body = ctx.createLinearGradient(-radius, -radius, radius, radius);
      body.addColorStop(0, "#22333b");
      body.addColorStop(0.45, "#101b23");
      body.addColorStop(1, "#050d13");
      ctx.fillStyle = body;
      ctx.fill();
      ctx.strokeStyle = pod.color;
      ctx.globalAlpha = docked ? 0.8 : 0.58;
      ctx.lineWidth = docked ? 2.2 : 1.4;
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.strokeStyle = "rgba(170, 224, 230, 0.2)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(0, 0, radius * 0.82, radius * 0.59, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = pod.color;
      ctx.globalAlpha = 0.75;
      roundRect(ctx, -radius * 0.68, -radius * 0.64, radius * 1.36, 6, 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.fillStyle = "rgba(4, 12, 17, 0.86)";
      roundRect(ctx, -radius * 0.32, -radius * 0.34, radius * 0.64, radius * 0.42, 4);
      ctx.fill();
      ctx.strokeStyle = "rgba(137, 216, 224, 0.22)";
      ctx.stroke();
      ctx.fillStyle = pod.color;
      ctx.font = `700 ${pod.index === 1 ? 10 : 9}px 'DIN Alternate', 'Segoe UI', sans-serif`;
      ctx.textAlign = "center";
      ctx.letterSpacing = "0.8px";
      ctx.fillText(pod.id.replace("C-", ""), 0, -radius * 0.06);
      ctx.fillStyle = "rgba(210, 244, 248, 0.54)";
      ctx.font = "600 7px 'DIN Alternate', 'Segoe UI', sans-serif";
      ctx.fillText(`${pod.mass.toFixed(1)} T`, 0, radius * 0.36);
      ctx.textAlign = "left";

      ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      roundRect(ctx, -radius * 0.72, radius * 0.52, radius * 1.44, 3, 1);
      ctx.fill();

      for (const side of [-1, 1]) {
        ctx.fillStyle = "#0a171f";
        roundRect(ctx, side * radius * 1.02 - 3, -10, 6, 20, 2);
        ctx.fill();
        ctx.fillStyle = pod.color;
        ctx.globalAlpha = 0.6;
        ctx.fillRect(side * radius * 1.02 - 1.2, -6, 2.4, 12);
        ctx.globalAlpha = 1;
      }

      if (docked) {
        const pulse = 0.55 + Math.sin(time * 3.8) * 0.3;
        ctx.strokeStyle = `rgba(111, 245, 190, ${pulse})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, radius + 8, -0.55, 0.55);
        ctx.arc(0, 0, radius + 8, Math.PI - 0.55, Math.PI + 0.55);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawGripper() {
      const ctx = this.ctx;
      const game = this.game;
      const geom = game.geometry();
      const dir = geom.forearmDir;
      const normal = { x: -dir.y, y: dir.x };
      const holding = game.arm.holding;
      const open = holding ? 14 + holding.radius * 0.32 : 17 + game.arm.clampAnim * 12;

      ctx.save();
      ctx.strokeStyle = "rgba(188, 237, 241, 0.2)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(geom.wrist.x - normal.x * 22, geom.wrist.y - normal.y * 22);
      ctx.lineTo(geom.wrist.x + normal.x * 22, geom.wrist.y + normal.y * 22);
      ctx.stroke();

      const jawBaseX = geom.wrist.x + dir.x * 12;
      const jawBaseY = geom.wrist.y + dir.y * 12;
      ctx.fillStyle = "#182b35";
      ctx.strokeStyle = "rgba(195, 236, 240, 0.56)";
      ctx.lineWidth = 1.2;
      roundRect(ctx, jawBaseX - 15, jawBaseY - 9, 30, 18, 3);
      ctx.fill();
      ctx.stroke();

      for (const side of [-1, 1]) {
        const shoulderX = jawBaseX + normal.x * side * open * 0.34;
        const shoulderY = jawBaseY + normal.y * side * open * 0.34;
        const tipX = geom.grip.x + normal.x * side * open;
        const tipY = geom.grip.y + normal.y * side * open;
        ctx.strokeStyle = "#07131b";
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(shoulderX, shoulderY);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();
        ctx.strokeStyle = holding ? "#d7a75e" : "#8aa2aa";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(shoulderX, shoulderY);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();
        ctx.fillStyle = "#ffbd64";
        ctx.beginPath();
        ctx.arc(tipX, tipY, 3.2, 0, Math.PI * 2);
        ctx.fill();

        const padX = tipX - dir.x * 7;
        const padY = tipY - dir.y * 7;
        ctx.fillStyle = holding ? "rgba(255, 184, 78, 0.68)" : "rgba(105, 196, 207, 0.36)";
        ctx.beginPath();
        ctx.arc(padX, padY, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!holding) {
        const scan = 0.35 + Math.sin(this.game.elapsed * 5) * 0.15;
        ctx.strokeStyle = `rgba(86, 226, 239, ${scan})`;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.arc(geom.grip.x, geom.grip.y, 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.fillStyle = game.arm.clampClosed ? "#ffb65b" : "rgba(128, 207, 216, 0.6)";
      ctx.font = "700 8px 'DIN Alternate', 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(game.arm.clampClosed ? "CLAMPED" : "OPEN", jawBaseX, jawBaseY + 26);
      ctx.textAlign = "left";
      ctx.restore();
    }

    drawParticles() {
      const ctx = this.ctx;
      for (const particle of this.game.particles) {
        const alpha = clamp(particle.life / particle.maxLife, 0, 1);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = particle.color;
        if (particle.type === "spark") {
          ctx.shadowColor = particle.color;
          ctx.shadowBlur = 8;
          ctx.fillRect(
            particle.x - particle.size * 0.5,
            particle.y - particle.size * 0.5,
            particle.size * 2.6,
            particle.size
          );
        } else {
          ctx.globalAlpha = alpha * 0.32;
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, particle.size * 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }

    hudPanel(x, y, width, height, accent) {
      const ctx = this.ctx;
      ctx.fillStyle = "rgba(4, 13, 21, 0.8)";
      roundRect(ctx, x, y, width, height, 4);
      ctx.fill();
      ctx.strokeStyle = accent || "rgba(98, 207, 222, 0.24)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "rgba(112, 220, 232, 0.09)";
      ctx.fillRect(x + 1, y + 1, width - 2, 1);
    }

    drawHud(time) {
      this.drawTitle();
      this.drawQueue(time);
      this.drawTimer(time);
      this.drawBottomConsole();
      this.drawSafetyOverlay(time);
    }

    drawTitle() {
      const ctx = this.ctx;
      const game = this.game;
      ctx.fillStyle = "rgba(106, 205, 219, 0.58)";
      ctx.font = "600 9px 'DIN Alternate', 'Segoe UI', sans-serif";
      ctx.letterSpacing = "2px";
      ctx.fillText("KX-7  //  ORBITAL TRANSFER SYSTEM", 45, 29);
      ctx.fillStyle = "#dffbff";
      ctx.font = "700 24px 'Bahnschrift', 'DIN Alternate', 'Segoe UI', sans-serif";
      ctx.letterSpacing = "0.6px";
      ctx.fillText("BAY 07  /  载荷转运", 43, 61);
      ctx.strokeStyle = "rgba(94, 221, 235, 0.28)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(44, 73);
      ctx.lineTo(394, 73);
      ctx.stroke();

      const active = game.phase === "running";
      const color =
        game.phase === "failed"
          ? COLORS.coral
          : game.phase === "success"
            ? COLORS.mint
            : active
              ? COLORS.cyan
              : COLORS.amber;
      const label =
        game.phase === "failed"
          ? "LOCKOUT"
          : game.phase === "success"
            ? "COMPLETE"
            : active
              ? "ARM ACTIVE"
              : "STANDBY";
      ctx.fillStyle = hexToRgba(color, 0.12);
      roundRect(ctx, 44, 82, 91, 18, 2);
      ctx.fill();
      ctx.strokeStyle = hexToRgba(color, 0.42);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = "700 8px 'DIN Alternate', 'Segoe UI', sans-serif";
      ctx.letterSpacing = "1.5px";
      ctx.fillText(label, 53, 94);

      ctx.fillStyle = "rgba(172, 230, 236, 0.52)";
      ctx.font = "500 9px 'DIN Alternate', 'Segoe UI', sans-serif";
      ctx.letterSpacing = "0.5px";
      ctx.fillText(
        `EMPTY ${game.metrics.emptyClamps}  ·  IMPACTS ${game.metrics.collisions}  ·  DOCKED ${game.metrics.docked}/3`,
        151,
        94
      );
    }

    drawQueue(time) {
      const ctx = this.ctx;
      const game = this.game;
      const x = 456;
      const y = 20;
      const width = 380;
      const height = 67;
      this.hudPanel(x, y, width, height, "rgba(104, 218, 232, 0.25)");
      ctx.fillStyle = "rgba(125, 221, 232, 0.62)";
      ctx.font = "600 8px 'DIN Alternate', 'Segoe UI', sans-serif";
      ctx.letterSpacing = "1.7px";
      ctx.fillText("TRANSFER QUEUE / 转运队列", x + 14, y + 17);

      for (let index = 0; index < game.pods.length; index += 1) {
        const pod = game.pods[index];
        const nodeX = x + 64 + index * 110;
        const nodeY = y + 41;
        const filled = pod.state === "docked";
        const held = pod.state === "held";
        if (index < game.pods.length - 1) {
          ctx.strokeStyle = "rgba(112, 205, 217, 0.22)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(nodeX + 15, nodeY);
          ctx.lineTo(nodeX + 91, nodeY);
          ctx.stroke();
        }
        ctx.fillStyle = filled ? hexToRgba(pod.color, 0.2) : "rgba(5, 15, 22, 0.72)";
        ctx.beginPath();
        ctx.arc(nodeX, nodeY, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = filled || held ? pod.color : "rgba(136, 211, 221, 0.35)";
        ctx.lineWidth = filled ? 2 : 1;
        ctx.stroke();
        if (filled) {
          ctx.fillStyle = pod.color;
          ctx.beginPath();
          ctx.moveTo(nodeX - 5, nodeY);
          ctx.lineTo(nodeX - 1, nodeY + 4);
          ctx.lineTo(nodeX + 6, nodeY - 5);
          ctx.lineTo(nodeX + 3, nodeY - 5);
          ctx.lineTo(nodeX - 1, nodeY + 1);
          ctx.lineTo(nodeX - 4, nodeY - 2);
          ctx.fill();
        } else {
          ctx.fillStyle = held ? pod.color : "rgba(182, 233, 238, 0.75)";
          ctx.font = "700 8px 'DIN Alternate', 'Segoe UI', sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(`0${index + 1}`, nodeX, nodeY + 3);
          ctx.textAlign = "left";
        }
        ctx.fillStyle = filled ? hexToRgba(pod.color, 0.88) : "rgba(182, 231, 236, 0.5)";
        ctx.font = "600 8px 'DIN Alternate', 'Segoe UI', sans-serif";
        ctx.fillText(filled ? "LOCKED" : `${pod.id}  ${pod.mass.toFixed(1)}T`, nodeX + 18, nodeY - 1);
        ctx.fillStyle = "rgba(144, 204, 211, 0.35)";
        ctx.font = "500 7px 'DIN Alternate', 'Segoe UI', sans-serif";
        ctx.fillText(filled ? "SLOT VERIFIED" : `→ SLOT 0${index + 1}`, nodeX + 18, nodeY + 10);
      }

      const scanX = x + 16 + ((time * 22) % (width - 32));
      ctx.strokeStyle = "rgba(86, 224, 238, 0.16)";
      ctx.beginPath();
      ctx.moveTo(scanX, y + height - 1);
      ctx.lineTo(x + width, y + height - 1);
      ctx.stroke();
    }

    drawTimer(time) {
      const ctx = this.ctx;
      const game = this.game;
      const x = 882;
      const y = 20;
      const width = 174;
      const height = 67;
      const low = game.time <= 30 && game.phase === "running";
      const pulse = low ? 0.65 + Math.sin(time * 5.2) * 0.25 : 1;
      this.hudPanel(x, y, width, height, low ? "rgba(255, 103, 82, 0.5)" : undefined);
      ctx.fillStyle = low ? "rgba(255, 129, 105, 0.9)" : "rgba(125, 221, 232, 0.62)";
      ctx.font = "600 8px 'DIN Alternate', 'Segoe UI', sans-serif";
      ctx.letterSpacing = "1.6px";
      ctx.globalAlpha = pulse;
      ctx.fillText("MISSION CLOCK / 任务时限", x + 13, y + 17);

      const minutes = Math.floor(game.time / 60);
      const seconds = Math.floor(game.time % 60);
      ctx.fillStyle = low ? "#ff8a78" : "#dffbff";
      ctx.font = "700 27px 'DIN Alternate', 'Cascadia Mono', monospace";
      ctx.letterSpacing = "1.5px";
      ctx.fillText(`${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`, x + 13, y + 53);
      ctx.globalAlpha = 1;

      ctx.fillStyle = "rgba(156, 219, 226, 0.58)";
      ctx.font = "600 9px 'DIN Alternate', 'Segoe UI', sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(`${game.metrics.docked} / 3`, x + width - 13, y + 53);
      ctx.fillStyle = "rgba(137, 202, 210, 0.34)";
      ctx.font = "500 7px 'DIN Alternate', 'Segoe UI', sans-serif";
      ctx.fillText(game.phase === "standby" ? "AWAIT INPUT" : "DOCKS VERIFIED", x + width - 13, y + 38);
      ctx.textAlign = "left";
    }

    keycap(label, x, y, width) {
      const ctx = this.ctx;
      const w = width || 22;
      ctx.fillStyle = "rgba(15, 34, 45, 0.92)";
      roundRect(ctx, x, y, w, 18, 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(112, 216, 229, 0.38)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "rgba(213, 249, 251, 0.82)";
      ctx.font = "700 9px 'DIN Alternate', 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label, x + w * 0.5, y + 12.5);
      ctx.textAlign = "left";
    }

    drawBottomConsole() {
      const ctx = this.ctx;
      const game = this.game;
      const x = 38;
      const y = 714;
      const width = 1204;
      const height = 61;
      this.hudPanel(x, y, width, height, "rgba(103, 214, 228, 0.21)");
      ctx.fillStyle = "rgba(98, 214, 228, 0.13)";
      ctx.fillRect(x + 527, y + 9, 1, height - 18);
      ctx.fillRect(x + 890, y + 9, 1, height - 18);

      ctx.fillStyle = "rgba(110, 211, 224, 0.52)";
      ctx.font = "600 8px 'DIN Alternate', 'Segoe UI', sans-serif";
      ctx.letterSpacing = "1.5px";
      ctx.fillText("CONTROL INPUT", 52, y + 16);
      this.keycap("A", 52, y + 26);
      ctx.fillStyle = "rgba(157, 214, 220, 0.34)";
      ctx.fillText("/", 77, y + 39);
      this.keycap("D", 86, y + 26);
      ctx.fillStyle = "rgba(190, 235, 239, 0.66)";
      ctx.font = "500 9px 'Microsoft YaHei', sans-serif";
      ctx.fillText("旋转", 116, y + 39);

      this.keycap("W", 173, y + 26);
      ctx.fillStyle = "rgba(157, 214, 220, 0.34)";
      ctx.fillText("/", 198, y + 39);
      this.keycap("S", 207, y + 26);
      ctx.fillStyle = "rgba(190, 235, 239, 0.66)";
      ctx.fillText("伸缩", 237, y + 39);

      this.keycap("SPACE", 294, y + 26, 52);
      ctx.fillStyle = "rgba(190, 235, 239, 0.66)";
      ctx.fillText("夹紧 / 释放", 354, y + 39);

      this.keycap("R", 440, y + 26);
      ctx.fillStyle = "rgba(190, 235, 239, 0.66)";
      ctx.fillText("重启", 469, y + 39);

      ctx.fillStyle = "rgba(110, 211, 224, 0.52)";
      ctx.font = "600 8px 'DIN Alternate', 'Segoe UI', sans-serif";
      ctx.fillText("JOINT INTEGRITY / 关节耐久", 545, y + 16);
      this.drawIntegrityBar("SHOULDER 肩", game.durability.shoulder, 545, y + 26, 142);
      this.drawIntegrityBar("WRIST 腕", game.durability.wrist, 700, y + 26, 142);

      const payload = game.arm.holding;
      ctx.fillStyle = "rgba(110, 211, 224, 0.52)";
      ctx.font = "600 8px 'DIN Alternate', 'Segoe UI', sans-serif";
      ctx.fillText("PAYLOAD / 惯性负载", 916, y + 16);
      ctx.fillStyle = payload ? payload.color : "rgba(175, 228, 234, 0.55)";
      ctx.font = "700 10px 'DIN Alternate', 'Segoe UI', sans-serif";
      ctx.fillText(
        payload ? `${payload.id}  ${payload.mass.toFixed(1)} T` : "NO LOAD / 空载",
        916,
        y + 35
      );
      const inertia = game.inertia();
      ctx.fillStyle = "rgba(179, 229, 234, 0.45)";
      ctx.font = "500 8px 'DIN Alternate', 'Segoe UI', sans-serif";
      ctx.fillText(`I ${inertia.toFixed(2)}`, 916, y + 49);
      const barX = 958;
      const barW = 160;
      ctx.fillStyle = "rgba(89, 134, 143, 0.22)";
      roundRect(ctx, barX, y + 41, barW, 6, 2);
      ctx.fill();
      const loadRatio = clamp((inertia - 1.35) / 4.3, 0, 1);
      const loadGradient = ctx.createLinearGradient(barX, 0, barX + barW, 0);
      loadGradient.addColorStop(0, "#55dfe9");
      loadGradient.addColorStop(0.65, "#ffbc58");
      loadGradient.addColorStop(1, "#ff7467");
      ctx.fillStyle = loadGradient;
      roundRect(ctx, barX, y + 41, Math.max(3, barW * loadRatio), 6, 2);
      ctx.fill();
      ctx.fillStyle = "rgba(166, 220, 226, 0.48)";
      ctx.font = "500 7px 'DIN Alternate', 'Segoe UI', sans-serif";
      ctx.fillText(`ω ${game.arm.angularVel >= 0 ? "+" : ""}${game.arm.angularVel.toFixed(2)} rad/s`, 1124, y + 22);
      ctx.fillText(`EXT ${Math.round(game.arm.extension)} / ${ARM.maxReach}`, 1124, y + 35);
      ctx.fillText(`EMPTY ${game.metrics.emptyClamps}  ·  HIT ${game.metrics.collisions}`, 1124, y + 48);
    }

    drawIntegrityBar(label, value, x, y, width) {
      const ctx = this.ctx;
      const ratio = clamp(value / 100, 0, 1);
      const color = ratio > 0.6 ? COLORS.cyan : ratio > 0.28 ? COLORS.amber : COLORS.coral;
      ctx.fillStyle = "rgba(166, 220, 226, 0.52)";
      ctx.font = "500 8px 'DIN Alternate', 'Segoe UI', sans-serif";
      ctx.fillText(label, x, y + 8);
      ctx.fillStyle = "rgba(80, 122, 130, 0.24)";
      roundRect(ctx, x, y + 13, width, 6, 2);
      ctx.fill();
      ctx.fillStyle = color;
      roundRect(ctx, x, y + 13, Math.max(2, width * ratio), 6, 2);
      ctx.fill();
      ctx.fillStyle = "rgba(206, 243, 246, 0.56)";
      ctx.textAlign = "right";
      ctx.fillText(`${Math.ceil(value)}%`, x + width, y + 8);
      ctx.textAlign = "left";
    }

    drawSafetyOverlay(time) {
      const ctx = this.ctx;
      const game = this.game;
      const critical = Math.min(game.durability.shoulder, game.durability.wrist) < 30;
      if (game.phase === "failed" || (critical && game.phase === "running")) {
        const pulse = 0.22 + Math.sin(time * 4) * 0.1;
        const gradient = ctx.createLinearGradient(0, 0, 0, 110);
        gradient.addColorStop(0, `rgba(255, 62, 48, ${pulse})`);
        gradient.addColorStop(1, "rgba(255, 62, 48, 0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, WORLD.width, 110);
        ctx.fillStyle = "rgba(255, 98, 80, 0.75)";
        ctx.font = "700 9px 'DIN Alternate', 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.letterSpacing = "2px";
        ctx.fillText("CAUTION  //  JOINT LOAD CRITICAL", WORLD.width * 0.5, 108);
        ctx.textAlign = "left";
      }

      if (game.phase === "standby") {
        const pulse = 0.68 + Math.sin(time * 2.4) * 0.16;
        ctx.save();
        ctx.globalAlpha = pulse;
        ctx.fillStyle = "rgba(5, 16, 24, 0.86)";
        roundRect(ctx, 302, 242, 172, 52, 4);
        ctx.fill();
        ctx.strokeStyle = "rgba(90, 223, 236, 0.38)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = COLORS.cyan;
        ctx.font = "700 9px 'DIN Alternate', 'Segoe UI', sans-serif";
        ctx.letterSpacing = "1.4px";
        ctx.fillText("SYSTEM READY", 318, 260);
        ctx.fillStyle = "rgba(201, 241, 244, 0.72)";
        ctx.font = "500 9px 'Microsoft YaHei', sans-serif";
        ctx.fillText("按 A / D 或 W / S 接管", 318, 277);
        ctx.restore();
      }
    }

    drawOverlay(time) {
      const game = this.game;
      if (game.phase !== "success" && game.phase !== "failed") return;
      const ctx = this.ctx;
      const success = game.phase === "success";
      const accent = success ? COLORS.mint : COLORS.coral;
      const appear = clamp((game.elapsed - game.endTime) * 3, 0, 1);
      ctx.save();
      ctx.fillStyle = "rgba(1, 6, 11, 0.72)";
      ctx.fillRect(0, 0, WORLD.width, WORLD.height);
      ctx.globalAlpha = appear;

      const x = 390;
      const y = 286;
      const width = 500;
      const height = 252;
      ctx.shadowColor = hexToRgba(accent, 0.22);
      ctx.shadowBlur = 50;
      ctx.fillStyle = "rgba(5, 15, 23, 0.97)";
      roundRect(ctx, x, y, width, height, 5);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = hexToRgba(accent, 0.58);
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = hexToRgba(accent, 0.1);
      ctx.fillRect(x + 1, y + 1, width - 2, 46);
      ctx.fillStyle = accent;
      ctx.font = "700 10px 'DIN Alternate', 'Segoe UI', sans-serif";
      ctx.letterSpacing = "3.1px";
      ctx.fillText(success ? "MISSION COMPLETE  /  任务完成" : "MISSION FAILED  /  任务失败", x + 28, y + 29);

      ctx.fillStyle = "#e4fbff";
      ctx.font = "700 31px 'Bahnschrift', 'DIN Alternate', 'Segoe UI', sans-serif";
      ctx.fillText(success ? "三条吊舱全部锁定" : "转运链路中断", x + 28, y + 90);
      ctx.fillStyle = "rgba(190, 231, 236, 0.66)";
      ctx.font = "500 11px 'Microsoft YaHei', sans-serif";
      const message = success
        ? "所有插槽完成机械锁定，货舱配电已恢复。"
        : game.failureReason || "任务终止";
      ctx.fillText(message, x + 29, y + 116);

      ctx.strokeStyle = "rgba(126, 211, 222, 0.16)";
      ctx.beginPath();
      ctx.moveTo(x + 28, y + 137);
      ctx.lineTo(x + width - 28, y + 137);
      ctx.stroke();

      const stats = success
        ? [
            ["TOTAL TIME", `${(game.completionTime || 0).toFixed(1)} s`],
            ["IMPACTS", `${game.metrics.collisions}`],
            ["EMPTY CLAMPS", `${game.metrics.emptyClamps}`],
            ["JOINT HEALTH", `${Math.min(game.durability.shoulder, game.durability.wrist).toFixed(0)}%`],
          ]
        : [
            ["ELAPSED", `${(C.MISSION_TIME - game.time).toFixed(1)} s`],
            ["DOCKED", `${game.metrics.docked} / 3`],
            ["IMPACTS", `${game.metrics.collisions}`],
            ["INTEGRITY", `${Math.min(game.durability.shoulder, game.durability.wrist).toFixed(0)}%`],
          ];
      stats.forEach((stat, index) => {
        const column = index % 2;
        const row = Math.floor(index / 2);
        const statX = x + 29 + column * 226;
        const statY = y + 161 + row * 31;
        ctx.fillStyle = "rgba(126, 203, 212, 0.44)";
        ctx.font = "600 7px 'DIN Alternate', 'Segoe UI', sans-serif";
        ctx.letterSpacing = "1.1px";
        ctx.fillText(stat[0], statX, statY);
        ctx.fillStyle = "#dffbff";
        ctx.font = "600 13px 'DIN Alternate', 'Segoe UI', sans-serif";
        ctx.fillText(stat[1], statX, statY + 15);
      });

      ctx.fillStyle = hexToRgba(accent, 0.88);
      ctx.font = "600 9px 'Microsoft YaHei', sans-serif";
      ctx.fillText("按 R 重新部署任务", x + 29, y + height - 17);
      ctx.strokeStyle = hexToRgba(accent, 0.35);
      ctx.beginPath();
      ctx.moveTo(x + width - 104, y + height - 24);
      ctx.lineTo(x + width - 28, y + height - 24);
      ctx.stroke();
      ctx.restore();
    }
  }

  window.OrbitalRenderer = OrbitalRenderer;
})();





