import { WORLD, mulberry32, shoalScale } from "./world.js";

const TAU = Math.PI * 2;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function alpha(value) {
  return clamp(value, 0, 1);
}

export class SceneRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.wake = [];
    this.spray = [];
    this.wakeAccumulator = 0;
    this.sprayAccumulator = 0;
    this.shake = 0;
    this.lastImpact = 0;
    const random = mulberry32(90421);
    this.waveMarks = Array.from({ length: 104 }, () => ({
      x: random() * WORLD.width,
      y: random() * WORLD.height,
      length: 14 + random() * 54,
      phase: random() * TAU,
      speed: 0.15 + random() * 0.55,
      depth: random()
    }));
    this.tideLines = Array.from({ length: 8 }, (_, index) => ({
      y: 105 + index * 112 + random() * 20,
      phase: random() * TAU,
      breadth: 0.55 + random() * 0.6
    }));
  }

  resize() {
    const cssWidth = Math.max(320, window.innerWidth);
    const cssHeight = Math.max(320, window.innerHeight);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = cssWidth;
    this.height = cssHeight;
    this.canvas.width = Math.round(cssWidth * this.dpr);
    this.canvas.height = Math.round(cssHeight * this.dpr);
    const fit = Math.min(cssWidth / WORLD.width, cssHeight / WORLD.height);
    this.scale = fit;
    this.offsetX = (cssWidth - WORLD.width * fit) / 2;
    this.offsetY = (cssHeight - WORLD.height * fit) / 2;
  }

  applyView() {
    const ctx = this.ctx;
    ctx.setTransform(
      this.dpr * this.scale,
      0,
      0,
      this.dpr * this.scale,
      this.dpr * this.offsetX,
      this.dpr * this.offsetY
    );
  }

  render(game, ui, dt = 0) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#04151c";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.applyView();

    if (this.shake > 0) {
      ctx.translate(Math.sin(ui.time * 54) * this.shake, Math.cos(ui.time * 47) * this.shake);
    }
    this.drawOcean(game, ui.time);
    this.drawTideLines(game, ui.time);
    this.drawShoals(game, ui.time);
    this.drawLogs(game);
    this.drawDock(game);
    this.drawRoute(ui.route, game, ui.time);
    this.drawZones(game, ui);
    this.drawBuoys(game, ui.time);
    this.updateParticles(game, dt, ui.time);
    this.drawBoat(game, ui.time, ui);
    this.drawParticles(ui.time);
    this.shake = Math.max(0, this.shake - dt * 8);

    const impact = game.boat.impact || 0;
    if (impact > this.lastImpact) this.shake = Math.max(this.shake, 3 * impact);
    this.lastImpact = impact;
  }

  drawOcean(game, time) {
    const ctx = this.ctx;
    const gradient = ctx.createLinearGradient(0, 0, WORLD.width, WORLD.height);
    gradient.addColorStop(0, "#0b3944");
    gradient.addColorStop(0.42, "#0e4d58");
    gradient.addColorStop(1, "#082b35");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    const glow = ctx.createRadialGradient(1260, 500, 10, 1260, 500, 760);
    glow.addColorStop(0, "rgba(85, 175, 171, 0.13)");
    glow.addColorStop(1, "rgba(3, 28, 37, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    ctx.lineCap = "round";
    for (const mark of this.waveMarks) {
      const y = mark.y + Math.sin(time * mark.speed + mark.phase) * 4;
      const visibility = 0.08 + mark.depth * 0.13;
      ctx.strokeStyle = `rgba(164, 225, 214, ${visibility})`;
      ctx.lineWidth = 1.1 + mark.depth * 0.7;
      ctx.beginPath();
      const direction = mark.phase > Math.PI ? -1 : 1;
      ctx.moveTo(mark.x - mark.length * 0.5 * direction, y);
      ctx.quadraticCurveTo(
        mark.x,
        y - 4 - mark.depth * 4,
        mark.x + mark.length * 0.5 * direction,
        y
      );
      ctx.stroke();
    }
  }

  drawTideLines(game, time) {
    const ctx = this.ctx;
    const tide = game.tide;
    for (const line of this.tideLines) {
      const yBase = line.y + tide * 44;
      const drift = Math.sin(time * 0.16 + line.phase) * 16;
      ctx.beginPath();
      for (let x = -20; x <= WORLD.width + 20; x += 28) {
        const y = yBase + Math.sin(x * 0.011 + line.phase + time * 0.18) * (7 + line.breadth * 5) + drift;
        if (x === -20) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(190, 232, 215, ${0.026 + tide * 0.027})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  shoalPath(shoal, scale, expansion = 1) {
    const ctx = this.ctx;
    const count = shoal.wobble.length;
    ctx.beginPath();
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * TAU;
      const wobble = shoal.wobble[index];
      const x = Math.cos(angle) * shoal.rx * scale * wobble * expansion;
      const y = Math.sin(angle) * shoal.ry * scale * wobble * expansion;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  drawShoals(game, time) {
    const ctx = this.ctx;
    const palette = [
      ["#8e927a", "#c3b38d", "#716f5d"],
      ["#89927e", "#d0bd94", "#626d62"],
      ["#7e8e79", "#bbad87", "#626d5f"]
    ];

    for (const shoal of game.world.shoals) {
      const scale = shoalScale(shoal, game.tide);
      const colors = palette[shoal.tone % palette.length];
      ctx.save();
      ctx.translate(shoal.x, shoal.y);
      ctx.rotate(shoal.rot);

      ctx.save();
      ctx.translate(9, 11);
      this.shoalPath(shoal, scale, 1.005);
      ctx.fillStyle = "rgba(1, 20, 26, 0.32)";
      ctx.fill();
      ctx.restore();

      this.shoalPath(shoal, scale);
      const sand = ctx.createRadialGradient(-shoal.rx * 0.18, -shoal.ry * 0.2, 4, 0, 0, shoal.rx * scale);
      sand.addColorStop(0, colors[1]);
      sand.addColorStop(0.7, colors[0]);
      sand.addColorStop(1, colors[2]);
      ctx.fillStyle = sand;
      ctx.fill();

      this.shoalPath(shoal, scale, 0.88);
      ctx.strokeStyle = "rgba(238, 218, 174, 0.24)";
      ctx.lineWidth = 1.2;
      ctx.stroke();

      const random = mulberry32(shoal.seed);
      for (let index = 0; index < 19; index += 1) {
        const angle = random() * TAU;
        const radius = Math.sqrt(random()) * 0.8;
        const x = Math.cos(angle) * shoal.rx * scale * radius;
        const y = Math.sin(angle) * shoal.ry * scale * radius;
        const width = 3 + random() * 12;
        ctx.fillStyle = index % 4 === 0 ? "rgba(62, 79, 68, 0.34)" : "rgba(229, 213, 175, 0.16)";
        ctx.beginPath();
        ctx.ellipse(x, y, width, 1.6 + random() * 1.8, angle, 0, TAU);
        ctx.fill();
      }

      this.shoalPath(shoal, scale, 1.018);
      const pulse = 0.35 + Math.sin(time * 0.7 + shoal.seed) * 0.1;
      ctx.strokeStyle = `rgba(198, 241, 226, ${pulse})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([18, 13, 4, 11]);
      ctx.lineDashOffset = -time * 7;
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = "rgba(229, 252, 238, 0.5)";
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      for (let arc = 0; arc < 4; arc += 1) {
        const start = time * 0.12 + shoal.seed * 0.0001 + arc * 1.7;
        ctx.ellipse(0, 0, shoal.rx * scale * 1.024, shoal.ry * scale * 1.024, 0, start, start + 0.42);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  drawLogs(game) {
    const ctx = this.ctx;
    for (const log of game.world.logs) {
      ctx.save();
      ctx.translate(log.x + 5, log.y + 6);
      ctx.rotate(log.angle);
      ctx.strokeStyle = "rgba(0, 16, 21, 0.32)";
      ctx.lineCap = "round";
      ctx.lineWidth = log.radius * 0.82;
      ctx.beginPath();
      ctx.moveTo(-log.length * 0.5, 0);
      ctx.lineTo(log.length * 0.5, 0);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.translate(log.x, log.y);
      ctx.rotate(log.angle);
      ctx.lineCap = "round";
      ctx.strokeStyle = "#553f2b";
      ctx.lineWidth = log.radius * 0.74;
      ctx.beginPath();
      ctx.moveTo(-log.length * 0.5, 0);
      ctx.lineTo(log.length * 0.5, 0);
      ctx.stroke();
      ctx.strokeStyle = "rgba(192, 155, 99, 0.65)";
      ctx.lineWidth = log.radius * 0.2;
      ctx.beginPath();
      ctx.moveTo(-log.length * 0.35, -log.radius * 0.16);
      ctx.lineTo(log.length * 0.32, -log.radius * 0.12);
      ctx.stroke();
      const branchX = log.length * 0.15;
      ctx.strokeStyle = "#4c3829";
      ctx.lineWidth = Math.max(2, log.radius * 0.2);
      ctx.beginPath();
      ctx.moveTo(branchX, 0);
      ctx.lineTo(branchX + log.length * 0.2, log.branch * log.radius);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawDock(game) {
    const ctx = this.ctx;
    const start = game.world.start;
    ctx.save();
    ctx.translate(start.x - 82, start.y + 24);
    ctx.rotate(-0.34);
    ctx.fillStyle = "rgba(2, 20, 25, 0.32)";
    ctx.fillRect(4, 8, 128, 20);
    ctx.fillStyle = "#5b5140";
    ctx.fillRect(0, 0, 126, 18);
    ctx.strokeStyle = "#88765a";
    ctx.lineWidth = 2;
    for (let x = 8; x < 120; x += 17) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 2, 18);
      ctx.stroke();
    }
    ctx.fillStyle = "#bc673f";
    ctx.beginPath();
    ctx.arc(115, 9, 5.2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#f4d18d";
    ctx.beginPath();
    ctx.arc(115, 9, 2, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "rgba(235, 197, 123, 0.35)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(start.x - 47, start.y + 13);
    ctx.lineTo(start.x - 37, start.y + 16);
    ctx.stroke();
  }

  drawRoute(route, game, time) {
    if (!route) return;
    const ctx = this.ctx;
    const target = route.target;
    if (route.path && route.path.length > 1) {
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 7;
      ctx.strokeStyle = "rgba(95, 222, 199, 0.08)";
      ctx.beginPath();
      route.path.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
      ctx.strokeStyle = "rgba(127, 231, 207, 0.54)";
      ctx.lineWidth = 1.7;
      ctx.setLineDash([5, 13]);
      ctx.lineDashOffset = -time * 20;
      ctx.stroke();
      ctx.setLineDash([]);

      const tip = route.path[route.path.length - 1];
      ctx.fillStyle = "rgba(149, 244, 219, 0.9)";
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 3.2, 0, TAU);
      ctx.fill();
      ctx.restore();
    } else {
      const pulse = 0.32 + Math.sin(time * 4) * 0.12;
      ctx.save();
      ctx.strokeStyle = `rgba(255, 108, 75, ${pulse})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 12]);
      ctx.beginPath();
      ctx.moveTo(game.boat.x, game.boat.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(target.x, target.y, target.radius + 13, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawZones(game, ui) {
    const ctx = this.ctx;
    const targetId = ui.route?.target?.id;
    for (const zone of game.world.zones) {
      const deployed = zone.status === "deployed";
      const active = zone.id === targetId && !deployed;
      const pulse = 0.5 + Math.sin(ui.time * 2.2 + zone.index) * 0.5;
      ctx.save();
      ctx.translate(zone.x, zone.y);

      ctx.strokeStyle = deployed
        ? "rgba(144, 206, 174, 0.21)"
        : active
          ? `rgba(244, 193, 104, ${0.32 + pulse * 0.24})`
          : "rgba(195, 225, 210, 0.14)";
      ctx.lineWidth = active ? 2 : 1.2;
      ctx.setLineDash([12, 11]);
      ctx.lineDashOffset = -ui.time * 5;
      ctx.beginPath();
      ctx.arc(0, 0, zone.radius, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);

      if (active) {
        ctx.strokeStyle = `rgba(243, 192, 105, ${0.08 + pulse * 0.1})`;
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.arc(0, 0, zone.radius + 4, 0, TAU);
        ctx.stroke();
      }

      ctx.globalAlpha = deployed ? 0.38 : active ? 1 : 0.62;
      ctx.fillStyle = deployed ? "#b8d7c6" : active ? "#f3c66f" : "#bbd1c9";
      ctx.font = "600 14px 'IBM Plex Mono', 'Noto Sans SC', monospace";
      ctx.textAlign = "center";
      ctx.fillText(zone.id, 0, -5);
      ctx.font = "500 10px 'Noto Sans SC', sans-serif";
      ctx.fillStyle = "rgba(224, 240, 230, 0.74)";
      ctx.fillText(deployed ? "已上线" : zone.name, 0, 12);
      ctx.globalAlpha = 1;

      ctx.strokeStyle = "rgba(207, 234, 219, 0.28)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-7, 0);
      ctx.lineTo(-2, 0);
      ctx.moveTo(2, 0);
      ctx.lineTo(7, 0);
      ctx.moveTo(0, -7);
      ctx.lineTo(0, -2);
      ctx.moveTo(0, 2);
      ctx.lineTo(0, 7);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawBuoys(game, time) {
    const ctx = this.ctx;
    for (const zone of game.world.zones) {
      if (zone.status !== "deployed") continue;
      const bob = Math.sin(time * 1.8 + zone.buoyPhase) * 2.3;
      const x = zone.x;
      const y = zone.y + bob;
      const blink = Math.max(0, Math.sin(time * 2.35 + zone.buoyPhase)) ** 10;

      const glow = ctx.createRadialGradient(x, y - 8, 0, x, y - 8, 30);
      glow.addColorStop(0, `rgba(255, 199, 101, ${0.28 + blink * 0.58})`);
      glow.addColorStop(0.28, `rgba(255, 168, 73, ${0.14 + blink * 0.24})`);
      glow.addColorStop(1, "rgba(255, 155, 60, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y - 8, 30, 0, TAU);
      ctx.fill();

      ctx.strokeStyle = "rgba(237, 205, 149, 0.2)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(x, y + 4, 12, 4, 0, 0, TAU);
      ctx.stroke();

      ctx.fillStyle = "#d35d36";
      ctx.beginPath();
      ctx.ellipse(x, y + 2, 7.5, 4.5, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#e6b564";
      ctx.fillRect(x - 6, y - 5, 12, 4);
      ctx.strokeStyle = "#3a342b";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x, y - 13);
      ctx.stroke();
      ctx.fillStyle = blink > 0.16 ? "#ffe0a0" : "#a96f3d";
      ctx.beginPath();
      ctx.arc(x, y - 14, blink > 0.16 ? 3.2 : 2.2, 0, TAU);
      ctx.fill();
    }
  }

  updateParticles(game, dt, time) {
    const boat = game.boat;
    const delta = clamp(dt, 0, 0.05);
    const speed = Math.hypot(boat.vx, boat.vy);
    const sternX = boat.x - Math.cos(boat.heading) * 19;
    const sternY = boat.y - Math.sin(boat.heading) * 19;
    this.wakeAccumulator += delta * (0.4 + speed * 0.055);

    if (speed > 18 && this.wakeAccumulator > 0.12) {
      this.wakeAccumulator = 0;
      const side = Math.random() > 0.5 ? 1 : -1;
      const offset = side * (5 + Math.random() * 6);
      this.wake.push({
        x: sternX + Math.cos(boat.heading + Math.PI / 2) * offset,
        y: sternY + Math.sin(boat.heading + Math.PI / 2) * offset,
        vx: -boat.vx * 0.08 + Math.cos(boat.heading + side * 1.1) * (5 + speed * 0.08),
        vy: -boat.vy * 0.08 + Math.sin(boat.heading + side * 1.1) * (5 + speed * 0.08),
        life: 1,
        decay: 0.48 + Math.random() * 0.22,
        size: 2.5 + Math.random() * 5.5,
        side
      });
    }

    this.sprayAccumulator += delta * (speed > 55 ? speed * 0.16 : 1.3);
    if ((speed > 62 || boat.grounded) && this.sprayAccumulator > 0.2) {
      this.sprayAccumulator = 0;
      const side = Math.random() > 0.5 ? 1 : -1;
      const spread = 0.34 + Math.random() * 0.34;
      const burst = boat.grounded ? 1.5 : 0.55 + speed / 230;
      this.spray.push({
        x: boat.x + Math.cos(boat.heading) * 23 + Math.cos(boat.heading + Math.PI / 2) * side * 7,
        y: boat.y + Math.sin(boat.heading) * 23 + Math.sin(boat.heading + Math.PI / 2) * side * 7,
        vx: boat.vx * 0.22 + Math.cos(boat.heading + side * spread) * 36 * burst,
        vy: boat.vy * 0.22 + Math.sin(boat.heading + side * spread) * 36 * burst - 8,
        life: 1,
        decay: 1.15 + Math.random() * 0.8,
        size: 1.2 + Math.random() * 2.8
      });
    }

    for (const particle of this.wake) {
      particle.life -= delta * particle.decay;
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.vx *= Math.exp(-1.3 * delta);
      particle.vy *= Math.exp(-1.3 * delta);
      particle.size += delta * 4.2;
    }
    for (const particle of this.spray) {
      particle.life -= delta * particle.decay;
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.vx *= Math.exp(-1.1 * delta);
      particle.vy *= Math.exp(-1.1 * delta);
      particle.vy += 4 * delta;
    }
    this.wake = this.wake.filter((particle) => particle.life > 0);
    this.spray = this.spray.filter((particle) => particle.life > 0);
    if (this.wake.length > 230) this.wake.splice(0, this.wake.length - 230);
    if (this.spray.length > 150) this.spray.splice(0, this.spray.length - 150);
  }

  drawParticles(time) {
    const ctx = this.ctx;
    for (const particle of this.wake) {
      const opacity = alpha(particle.life) * 0.42;
      ctx.fillStyle = `rgba(211, 244, 233, ${opacity})`;
      ctx.beginPath();
      ctx.ellipse(particle.x, particle.y, particle.size * 1.7, particle.size * 0.62, 0.2, 0, TAU);
      ctx.fill();
    }
    for (const particle of this.spray) {
      const opacity = alpha(particle.life) * 0.85;
      ctx.fillStyle = `rgba(232, 252, 244, ${opacity})`;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size * (0.7 + particle.life * 0.5), 0, TAU);
      ctx.fill();
    }

    const mistShift = Math.sin(time * 0.23) * 30;
    const mist = ctx.createLinearGradient(0, 710, 0, 1010);
    mist.addColorStop(0, "rgba(189, 231, 220, 0)");
    mist.addColorStop(0.7, "rgba(189, 231, 220, 0.028)");
    mist.addColorStop(1, "rgba(189, 231, 220, 0.07)");
    ctx.fillStyle = mist;
    ctx.fillRect(mistShift, 710, WORLD.width, 300);
  }

  drawBoat(game, time, ui) {
    const ctx = this.ctx;
    const boat = game.boat;
    const speed = Math.hypot(boat.vx, boat.vy);
    ctx.save();
    ctx.translate(boat.x, boat.y);
    ctx.rotate(boat.heading);

    if (speed > 8) {
      ctx.strokeStyle = `rgba(220, 250, 240, ${0.14 + Math.min(0.22, speed / 900)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(-24, -8, 19 + speed * 0.045, 6 + speed * 0.018, -0.28, 0.1, Math.PI - 0.2);
      ctx.ellipse(-24, 8, 19 + speed * 0.045, 6 + speed * 0.018, 0.28, Math.PI + 0.2, TAU - 0.1);
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(4, 7);
    ctx.fillStyle = "rgba(0, 12, 17, 0.34)";
    ctx.beginPath();
    ctx.ellipse(0, 0, 29, 12, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    const hull = ctx.createLinearGradient(-24, 0, 25, 0);
    hull.addColorStop(0, "#b8462d");
    hull.addColorStop(0.52, "#e26a3e");
    hull.addColorStop(1, "#f08a55");
    ctx.fillStyle = hull;
    ctx.strokeStyle = "#522f29";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(29, 0);
    ctx.lineTo(14, -8);
    ctx.lineTo(-12, -10);
    ctx.lineTo(-24, -6);
    ctx.lineTo(-24, 6);
    ctx.lineTo(-12, 10);
    ctx.lineTo(14, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#e8d5b4";
    ctx.strokeStyle = "rgba(87, 61, 43, 0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(16, -5.1);
    ctx.lineTo(-3, -6.6);
    ctx.lineTo(-12, -4.4);
    ctx.lineTo(-12, 4.4);
    ctx.lineTo(-2, 6.5);
    ctx.lineTo(16, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#264e50";
    ctx.fillRect(-6, -4.2, 10, 8.4);
    ctx.fillStyle = "#98c0b5";
    ctx.fillRect(-4.4, -3.1, 6.8, 2.1);
    ctx.strokeStyle = "rgba(35, 50, 47, 0.65)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-12, 0);
    ctx.lineTo(18, 0);
    ctx.stroke();

    for (let index = 0; index < boat.cargo; index += 1) {
      ctx.fillStyle = index === 0 ? "#f2c66d" : "#d9a44f";
      ctx.fillRect(-20 + index * 5.4, -3, 3.8, 6);
      ctx.strokeStyle = "rgba(62, 52, 35, 0.45)";
      ctx.strokeRect(-20 + index * 5.4, -3, 3.8, 6);
    }

    ctx.fillStyle = "#f6dfac";
    ctx.beginPath();
    ctx.arc(18, 0, 1.7, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(239, 248, 226, 0.75)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(25, -5);
    ctx.lineTo(30, -8);
    ctx.moveTo(25, 5);
    ctx.lineTo(30, 8);
    ctx.stroke();
    ctx.restore();
  }
}
