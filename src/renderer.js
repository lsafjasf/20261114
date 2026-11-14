import { BOAT, WORLD, makeRng } from "./model.js";

const TAU = Math.PI * 2;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function easeInOut(value) {
  return value * value * (3 - 2 * value);
}

function rgba(hex, alpha) {
  const value = hex.replace("#", "");
  const number = Number.parseInt(value, 16);
  return `rgba(${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}, ${alpha})`;
}

export class RiverRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = WORLD.width;
    this.height = WORLD.height;
    this.fogCanvas = document.createElement("canvas");
    this.fogCanvas.width = this.width;
    this.fogCanvas.height = this.height;
    this.fogCtx = this.fogCanvas.getContext("2d");
    this.fogTexture = document.createElement("canvas");
    this.fogTexture.width = this.width + 240;
    this.fogTexture.height = this.height + 180;
    this.fogPuffs = [];
    this.waveLines = [];
    this.shoreLights = [];
    this.trees = [];
    this.rain = [];
    this.world = null;
  }

  setWorld(world) {
    this.world = world;
    const rng = makeRng(`${world.seed}:scenery`);
    this.waveLines = Array.from({ length: 74 }, () => ({
      x: rng.range(-100, this.width + 100),
      y: rng.range(WORLD.waterTop + 18, WORLD.waterBottom - 12),
      length: rng.range(10, 82),
      bend: rng.range(-3, 3),
      alpha: rng.range(0.025, 0.1),
      speed: rng.range(0.55, 1.4),
    }));
    this.shoreLights = Array.from({ length: 18 }, (_, index) => ({
      x: rng.range(40, this.width - 40),
      y: index < 9 ? rng.range(18, 85) : rng.range(628, 690),
      north: index < 9,
      radius: rng.range(1.1, 3.4),
      color: rng.pick(["#ffbd68", "#ffd99a", "#84d5d0", "#e9a35d"]),
      phase: rng.range(0, TAU),
    }));
    this.trees = Array.from({ length: 58 }, () => {
      const north = rng.next() < 0.5;
      return {
        x: rng.range(0, this.width),
        y: north ? rng.range(28, 99) : rng.range(633, 715),
        height: rng.range(17, 48),
        width: rng.range(8, 24),
        north,
      };
    }).sort((left, right) => left.north - right.north || left.y - right.y);
    this.rain = Array.from({ length: 70 }, () => ({
      x: rng.range(0, this.width),
      y: rng.range(0, this.height),
      length: rng.range(4, 13),
      speed: rng.range(28, 72),
      alpha: rng.range(0.02, 0.09),
    }));
    this.#buildFogTexture(rng);
  }

  #buildFogTexture(rng) {
    const ctx = this.fogTexture.getContext("2d");
    ctx.clearRect(0, 0, this.fogTexture.width, this.fogTexture.height);
    this.fogPuffs = Array.from({ length: 48 }, () => ({
      x: rng.range(0, this.fogTexture.width),
      y: rng.range(0, this.fogTexture.height),
      radius: rng.range(105, 280),
      alpha: rng.range(0.045, 0.13),
      drift: rng.range(0.5, 1.5),
      phase: rng.range(0, TAU),
    }));
    for (const puff of this.fogPuffs) {
      const gradient = ctx.createRadialGradient(puff.x, puff.y, 0, puff.x, puff.y, puff.radius);
      gradient.addColorStop(0, `rgba(217, 230, 225, ${puff.alpha})`);
      gradient.addColorStop(0.42, `rgba(197, 215, 210, ${puff.alpha * 0.66})`);
      gradient.addColorStop(1, "rgba(185, 207, 202, 0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(puff.x, puff.y, puff.radius, 0, TAU);
      ctx.fill();
    }
  }

  render(game) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    this.#drawLand(game);
    this.#drawWater(game);
    this.#drawReflections(game);
    this.#drawDocks(game);
    this.#drawDriftwood(game);
    this.#drawWake(game);
    this.#drawBoat(game);
    this.#drawBeacons(game, false);
    this.#drawFog(game);
    this.#drawBeaconGlow(game);
    this.#drawRain(game);
    this.#drawRadar(game);
    this.#drawEcho(game);
  }

  #drawLand(game) {
    const ctx = this.ctx;
    const land = ctx.createLinearGradient(0, 0, 0, this.height);
    land.addColorStop(0, "#071316");
    land.addColorStop(0.12, "#0b1c1d");
    land.addColorStop(0.5, "#0a2528");
    land.addColorStop(0.86, "#0c1d1d");
    land.addColorStop(1, "#061012");
    ctx.fillStyle = land;
    ctx.fillRect(0, 0, this.width, this.height);

    const northGlow = ctx.createLinearGradient(0, 0, 0, WORLD.waterTop + 25);
    northGlow.addColorStop(0, "rgba(12, 34, 34, 0.1)");
    northGlow.addColorStop(1, "rgba(1, 8, 10, 0.78)");
    ctx.fillStyle = northGlow;
    ctx.fillRect(0, 0, this.width, WORLD.waterTop + 25);

    for (const tree of this.trees) {
      ctx.fillStyle = tree.north ? "rgba(2, 10, 11, 0.88)" : "rgba(1, 8, 9, 0.88)";
      ctx.beginPath();
      ctx.moveTo(tree.x, tree.y - tree.height);
      ctx.lineTo(tree.x - tree.width, tree.y + 13);
      ctx.lineTo(tree.x + tree.width, tree.y + 13);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(96, 119, 110, 0.05)";
      ctx.beginPath();
      ctx.moveTo(tree.x, tree.y - tree.height * 0.86);
      ctx.lineTo(tree.x - 2, tree.y + 6);
      ctx.lineTo(tree.x + tree.width * 0.25, tree.y + 6);
      ctx.closePath();
      ctx.fill();
    }

    for (const light of this.shoreLights) {
      const pulse = 0.55 + Math.sin(game.time * 1.3 + light.phase) * 0.16;
      const glow = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, 18);
      glow.addColorStop(0, rgba(light.color, 0.3 * pulse));
      glow.addColorStop(1, rgba(light.color, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(light.x, light.y, 18, 0, TAU);
      ctx.fill();
      ctx.fillStyle = rgba(light.color, 0.7);
      ctx.beginPath();
      ctx.arc(light.x, light.y, light.radius, 0, TAU);
      ctx.fill();
    }

    this.#drawShoreline(WORLD.waterTop, 1);
    this.#drawShoreline(WORLD.waterBottom, -1);
    this.#drawShoreLabel("北岸 · 青芦渡", 38, WORLD.waterTop - 27, "left");
    this.#drawShoreLabel("南岸 · 旧灯湾", this.width - 38, WORLD.waterBottom + 42, "right");
  }

  #drawShoreline(y, direction) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = "rgba(142, 184, 173, 0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -20; x <= this.width + 20; x += 12) {
      const wave = Math.sin(x * 0.018) * 3 + Math.sin(x * 0.041) * 1.4;
      if (x === -20) ctx.moveTo(x, y + wave * direction);
      else ctx.lineTo(x, y + wave * direction);
    }
    ctx.stroke();
    ctx.strokeStyle = "rgba(2, 9, 10, 0.7)";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(0, y - direction * 5);
    ctx.lineTo(this.width, y - direction * 5);
    ctx.stroke();
    ctx.restore();
  }

  #drawShoreLabel(text, x, y, align) {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = align;
    ctx.fillStyle = "rgba(168, 190, 181, 0.38)";
    ctx.font = '12px "Noto Serif SC", "Songti SC", serif';
    ctx.letterSpacing = "4px";
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  #drawWater(game) {
    const ctx = this.ctx;
    const gradient = ctx.createLinearGradient(0, WORLD.waterTop, 0, WORLD.waterBottom);
    gradient.addColorStop(0, "#0b2529");
    gradient.addColorStop(0.34, "#0c3237");
    gradient.addColorStop(0.72, "#09282d");
    gradient.addColorStop(1, "#071b20");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, WORLD.waterTop, this.width, WORLD.waterBottom - WORLD.waterTop);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, WORLD.waterTop, this.width, WORLD.waterBottom - WORLD.waterTop);
    ctx.clip();

    const channelGlow = ctx.createLinearGradient(
      WORLD.channel.left,
      0,
      WORLD.channel.right,
      0,
    );
    channelGlow.addColorStop(0, "rgba(87, 168, 173, 0)");
    channelGlow.addColorStop(0.5, "rgba(87, 168, 173, 0.045)");
    channelGlow.addColorStop(1, "rgba(87, 168, 173, 0)");
    ctx.fillStyle = channelGlow;
    ctx.fillRect(WORLD.channel.left, WORLD.waterTop, WORLD.channel.right - WORLD.channel.left, 504);

    const current = game.world.current.x * 0.8;
    for (const line of this.waveLines) {
      const x = ((line.x + game.time * current * line.speed + 160) % (this.width + 240)) - 120;
      ctx.strokeStyle = `rgba(172, 218, 210, ${line.alpha})`;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(x, line.y);
      ctx.bezierCurveTo(
        x + line.length * 0.35,
        line.y + line.bend,
        x + line.length * 0.68,
        line.y - line.bend,
        x + line.length,
        line.y,
      );
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(116, 179, 172, 0.1)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 17]);
    for (let x = WORLD.channel.left + 18; x <= WORLD.channel.right - 10; x += 55) {
      const drift = Math.sin(game.time * 0.2 + x) * 4;
      ctx.beginPath();
      ctx.moveTo(x + drift, WORLD.waterTop + 12);
      ctx.lineTo(x + drift, WORLD.waterBottom - 12);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  #drawReflections(game) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const dock of [WORLD.northDock, WORLD.southDock]) {
      const towardWater = dock.y < this.height / 2 ? 1 : -1;
      const flicker = 0.75 + Math.sin(game.time * 1.7 + dock.y) * 0.12;
      const gradient = ctx.createLinearGradient(0, dock.y + towardWater * 19, 0, dock.y + towardWater * 112);
      gradient.addColorStop(0, `rgba(255, 187, 93, ${0.1 * flicker})`);
      gradient.addColorStop(1, "rgba(255, 187, 93, 0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(dock.x - 18, dock.y + towardWater * 19);
      ctx.lineTo(dock.x + 18, dock.y + towardWater * 19);
      ctx.lineTo(dock.x + 52, dock.y + towardWater * 112);
      ctx.lineTo(dock.x - 52, dock.y + towardWater * 112);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  #drawDocks(game) {
    const ctx = this.ctx;
    for (const dock of [
      { ...WORLD.northDock, north: true, label: "北岸浮桥" },
      { ...WORLD.southDock, north: false, label: "南岸浮桥" },
    ]) {
      const direction = dock.north ? 1 : -1;
      const innerY = dock.y - direction * 62;
      const outerY = dock.y + direction * 54;
      const half = dock.width / 2;

      ctx.save();
      ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
      ctx.shadowBlur = 22;
      ctx.shadowOffsetY = 8;
      ctx.fillStyle = "rgba(3, 10, 11, 0.75)";
      ctx.fillRect(dock.x - half, innerY, dock.width, outerY - innerY);
      ctx.restore();

      const planks = ctx.createLinearGradient(dock.x - half, 0, dock.x + half, 0);
      planks.addColorStop(0, "#182525");
      planks.addColorStop(0.12, "#3d4036");
      planks.addColorStop(0.5, "#4b4637");
      planks.addColorStop(0.88, "#31372f");
      planks.addColorStop(1, "#162222");
      ctx.fillStyle = planks;
      ctx.fillRect(dock.x - half, innerY, dock.width, outerY - innerY);

      ctx.strokeStyle = "rgba(9, 14, 14, 0.75)";
      ctx.lineWidth = 1;
      for (let y = innerY + 9; y < outerY; y += 11) {
        ctx.beginPath();
        ctx.moveTo(dock.x - half, y);
        ctx.lineTo(dock.x + half, y);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(184, 169, 124, 0.16)";
      ctx.strokeRect(dock.x - half, innerY, dock.width, outerY - innerY);

      for (const postX of [dock.x - half + 10, dock.x + half - 10]) {
        for (const postY of [innerY + 8, outerY - 8]) {
          ctx.fillStyle = "#171d1b";
          ctx.beginPath();
          ctx.arc(postX, postY, 4.5, 0, TAU);
          ctx.fill();
          ctx.strokeStyle = "rgba(196, 178, 125, 0.24)";
          ctx.stroke();
        }
      }

      for (const lampX of [dock.x - 48, dock.x + 48]) {
        const lampY = dock.north ? innerY + 10 : innerY - 10;
        const flicker = 0.88 + Math.sin(game.time * 2.1 + lampX) * 0.08;
        const glow = ctx.createRadialGradient(lampX, lampY, 0, lampX, lampY, 44);
        glow.addColorStop(0, `rgba(255, 190, 97, ${0.22 * flicker})`);
        glow.addColorStop(0.25, `rgba(255, 178, 76, ${0.1 * flicker})`);
        glow.addColorStop(1, "rgba(255, 178, 76, 0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(lampX, lampY, 44, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "#ffcf84";
        ctx.beginPath();
        ctx.arc(lampX, lampY, 2.2, 0, TAU);
        ctx.fill();
      }

      ctx.save();
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(197, 207, 193, 0.36)";
      ctx.font = '10px "Noto Serif SC", "Songti SC", serif';
      ctx.fillText(dock.label, dock.x, dock.north ? outerY + 25 : innerY - 20);
      ctx.restore();

      if (game.nearDock === (dock.north ? "north" : "south") && game.started) {
        const pulse = 0.42 + Math.sin(game.time * 3.4) * 0.18;
        ctx.save();
        ctx.strokeStyle = `rgba(145, 229, 255, ${pulse})`;
        ctx.setLineDash([6, 8]);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(dock.x, dock.y, 88, 35, 0, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(145, 229, 255, 0.72)";
        ctx.textAlign = "center";
        ctx.font = '9px "Noto Sans SC", sans-serif';
        ctx.fillText("减速靠岸", dock.x, dock.north ? dock.y + 50 : dock.y - 44);
        ctx.restore();
      }
    }
  }

  #drawDriftwood(game) {
    const ctx = this.ctx;
    for (const item of game.world.driftwood) {
      const sway = Math.sin(game.time * 0.55 + item.angle) * item.drift * 4;
      const x = item.x + sway;
      const y = item.y + Math.sin(game.time * 0.8 + item.angle * 2) * 1.5;
      const palette = ["#332e25", "#292821", "#3b3327"];
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(item.angle);

      const foam = ctx.createRadialGradient(0, 0, 2, 0, 0, item.radius + 12);
      foam.addColorStop(0, "rgba(147, 190, 184, 0.02)");
      foam.addColorStop(0.72, "rgba(147, 190, 184, 0.06)");
      foam.addColorStop(1, "rgba(147, 190, 184, 0)");
      ctx.fillStyle = foam;
      ctx.beginPath();
      ctx.ellipse(0, 3, item.radius + 16, item.radius * 0.66, 0, 0, TAU);
      ctx.fill();

      ctx.fillStyle = "rgba(0, 5, 6, 0.48)";
      ctx.beginPath();
      ctx.ellipse(4, 5, item.length * 0.55, item.radius * 0.72, 0, 0, TAU);
      ctx.fill();

      ctx.strokeStyle = palette[item.tone];
      ctx.lineCap = "round";
      ctx.lineWidth = item.radius * 0.92;
      ctx.beginPath();
      ctx.moveTo(-item.length * 0.46, 0);
      ctx.quadraticCurveTo(0, -item.radius * 0.42, item.length * 0.46, 1);
      ctx.stroke();
      ctx.strokeStyle = "rgba(139, 126, 93, 0.25)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-item.length * 0.27, -item.radius * 0.22);
      ctx.lineTo(item.length * 0.31, -item.radius * 0.13);
      ctx.stroke();
      ctx.restore();

      if (game.echo > 0.02) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = `rgba(255, 151, 93, ${game.echo * 0.32})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, item.radius + 5 + Math.sin(game.time * 5 + item.x) * 2, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  #drawWake(game) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const particle of game.wake) {
      const life = clamp(1 - particle.age / particle.life, 0, 1);
      ctx.fillStyle = `rgba(169, 215, 207, ${life * life * 0.14})`;
      ctx.beginPath();
      ctx.ellipse(
        particle.x,
        particle.y,
        particle.size * (1.35 - life * 0.35),
        particle.size * 0.42,
        particle.angle,
        0,
        TAU,
      );
      ctx.fill();
    }
    ctx.restore();
  }

  #drawBoat(game) {
    const ctx = this.ctx;
    const boat = game.boat;
    const bob = Math.sin(game.time * 1.8) * 1.3;
    const speed = Math.hypot(boat.vx, boat.vy);
    const speedRatio = clamp(speed / BOAT.baseMaxSpeed, 0, 1);
    const load = game.load;

    ctx.save();
    ctx.translate(boat.x, boat.y + bob);
    ctx.rotate(boat.angle);

    const foam = ctx.createRadialGradient(0, 7, 4, 0, 7, 61);
    foam.addColorStop(0, `rgba(122, 181, 174, ${0.06 + speedRatio * 0.05})`);
    foam.addColorStop(1, "rgba(122, 181, 174, 0)");
    ctx.fillStyle = foam;
    ctx.beginPath();
    ctx.ellipse(0, 7, 38 + speedRatio * 20, 57 + speedRatio * 14, 0, 0, TAU);
    ctx.fill();

    ctx.fillStyle = "rgba(0, 5, 6, 0.56)";
    ctx.beginPath();
    ctx.ellipse(4, 7, 24, 43, 0, 0, TAU);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, -45);
    ctx.bezierCurveTo(16, -32, 20, -8, 17, 20);
    ctx.bezierCurveTo(15, 34, 9, 40, 0, 40);
    ctx.bezierCurveTo(-9, 40, -15, 34, -17, 20);
    ctx.bezierCurveTo(-20, -8, -16, -32, 0, -45);
    ctx.closePath();
    const hull = ctx.createLinearGradient(-18, 0, 18, 0);
    hull.addColorStop(0, "#13282a");
    hull.addColorStop(0.32, "#29494a");
    hull.addColorStop(0.53, "#496c67");
    hull.addColorStop(0.75, "#203c3e");
    hull.addColorStop(1, "#0b1b1e");
    ctx.fillStyle = hull;
    ctx.fill();
    ctx.strokeStyle = "rgba(140, 203, 190, 0.32)";
    ctx.lineWidth = 1.1;
    ctx.stroke();

    ctx.strokeStyle = "rgba(210, 191, 139, 0.26)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-15, 15);
    ctx.lineTo(15, 15);
    ctx.stroke();

    const deck = ctx.createLinearGradient(0, -22, 0, 23);
    deck.addColorStop(0, "#5d5944");
    deck.addColorStop(0.52, "#393b30");
    deck.addColorStop(1, "#232923");
    ctx.fillStyle = deck;
    ctx.beginPath();
    ctx.roundRect(-14, -20, 28, 46, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(208, 184, 126, 0.22)";
    ctx.stroke();

    ctx.fillStyle = load > 2 ? "#a97a39" : "#534d38";
    ctx.beginPath();
    ctx.roundRect(-12, -19, 24, 20, 5);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 204, 128, 0.28)";
    ctx.stroke();

    const windowGlow = ctx.createRadialGradient(0, -10, 1, 0, -10, 25);
    windowGlow.addColorStop(0, `rgba(255, 206, 124, ${0.24 + load * 0.035})`);
    windowGlow.addColorStop(1, "rgba(255, 206, 124, 0)");
    ctx.fillStyle = windowGlow;
    ctx.beginPath();
    ctx.arc(0, -10, 25, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#ffd18a";
    ctx.beginPath();
    ctx.roundRect(-7, -16, 14, 10, 2);
    ctx.fill();

    for (let index = 0; index < load; index += 1) {
      const passengerX = -6 + index * 6;
      ctx.fillStyle = "rgba(27, 29, 25, 0.88)";
      ctx.beginPath();
      ctx.arc(passengerX, -6, 1.9, 0, TAU);
      ctx.fill();
    }

    const mastBlink = Math.sin(game.time * 3.1) > 0.45;
    ctx.fillStyle = mastBlink ? "#ffd18a" : "rgba(255, 209, 138, 0.2)";
    ctx.beginPath();
    ctx.arc(0, -31, 1.5, 0, TAU);
    ctx.fill();

    ctx.fillStyle = "rgba(239, 80, 63, 0.82)";
    ctx.beginPath();
    ctx.arc(-14, -3, 1.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(88, 235, 181, 0.82)";
    ctx.beginPath();
    ctx.arc(14, -3, 1.5, 0, TAU);
    ctx.fill();

    if (boat.damage > 20) {
      ctx.strokeStyle = `rgba(220, 126, 88, ${clamp(boat.damage / 130, 0.25, 0.7)})`;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(8, 19);
      ctx.lineTo(13, 25);
      ctx.lineTo(9, 31);
      ctx.stroke();
    }
    ctx.restore();

    if (game.started && speed < 32) {
      const alpha = 0.3 + Math.sin(game.time * 4) * 0.1;
      ctx.save();
      ctx.textAlign = "center";
      ctx.fillStyle = `rgba(145, 229, 255, ${alpha})`;
      ctx.font = '8px "Noto Sans SC", sans-serif';
      ctx.fillText("渡 01", boat.x, boat.y + 61);
      ctx.restore();
    }
  }

  #beaconStrength(beacon, game) {
    const cycle = (game.time + beacon.phase) % beacon.period;
    let scheduled = 0;
    if (cycle < beacon.onDuration) {
      const progress = cycle / beacon.onDuration;
      scheduled = Math.min(1, progress / 0.13, (1 - progress) / 0.2);
    }
    scheduled = easeInOut(clamp(scheduled, 0, 1));
    const echo = game.echo > 0 ? clamp(game.echo * 1.15, 0, 1) : 0;
    return Math.max(scheduled, echo * 0.72);
  }

  #drawBeacons(game, afterFog) {
    const ctx = this.ctx;
    for (const beacon of game.world.beacons) {
      const intensity = this.#beaconStrength(beacon, game);
      const north = beacon.side === "north";
      const lightY = north ? beacon.y - 11 : beacon.y + 11;
      const towerTop = north ? beacon.y - 25 : beacon.y + 25;
      const direction = north ? 1 : -1;

      ctx.save();
      ctx.strokeStyle = afterFog
        ? `rgba(200, 214, 202, ${0.14 + intensity * 0.45})`
        : "rgba(119, 142, 133, 0.2)";
      ctx.lineWidth = afterFog ? 1.5 : 2.4;
      ctx.beginPath();
      ctx.moveTo(beacon.x, beacon.y);
      ctx.lineTo(beacon.x, towerTop);
      ctx.stroke();

      ctx.fillStyle = afterFog
        ? `rgba(236, 224, 184, ${0.25 + intensity * 0.5})`
        : "rgba(80, 88, 76, 0.45)";
      ctx.beginPath();
      ctx.moveTo(beacon.x, towerTop - direction * 7);
      ctx.lineTo(beacon.x - 6, beacon.y);
      ctx.lineTo(beacon.x + 6, beacon.y);
      ctx.closePath();
      ctx.fill();

      if (intensity > 0.02) {
        const glowRadius = 22 + intensity * 82;
        const glow = ctx.createRadialGradient(beacon.x, lightY, 0, beacon.x, lightY, glowRadius);
        glow.addColorStop(0, rgba(beacon.color, 0.4 + intensity * 0.48));
        glow.addColorStop(0.15, rgba(beacon.color, 0.2 + intensity * 0.24));
        glow.addColorStop(0.58, rgba(beacon.color, 0.04 + intensity * 0.08));
        glow.addColorStop(1, rgba(beacon.color, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(beacon.x, lightY, glowRadius, 0, TAU);
        ctx.fill();

        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = rgba(beacon.color, 0.75 + intensity * 0.25);
        ctx.beginPath();
        ctx.arc(beacon.x, lightY, 2.2 + intensity * 1.1, 0, TAU);
        ctx.fill();
        ctx.restore();
      }

      if (afterFog && intensity > 0.22) {
        const beam = ctx.createLinearGradient(beacon.x, lightY, beacon.x, lightY + direction * 260);
        beam.addColorStop(0, rgba(beacon.color, intensity * 0.14));
        beam.addColorStop(1, rgba(beacon.color, 0));
        ctx.fillStyle = beam;
        ctx.beginPath();
        ctx.moveTo(beacon.x - 3, lightY);
        ctx.lineTo(beacon.x - 54 * intensity, lightY + direction * 260);
        ctx.lineTo(beacon.x + 54 * intensity, lightY + direction * 260);
        ctx.lineTo(beacon.x + 3, lightY);
        ctx.closePath();
        ctx.fill();
      }

      if (afterFog && game.echo > 0.05) {
        const alpha = game.echo * 0.7;
        ctx.save();
        ctx.textAlign = "center";
        ctx.fillStyle = `rgba(220, 235, 226, ${alpha})`;
        ctx.font = '8px "Noto Sans SC", sans-serif';
        ctx.fillText(beacon.label, beacon.x, north ? lightY - 22 : lightY + 32);
        ctx.restore();
      }
      ctx.restore();
    }
  }

  #drawFog(game) {
    const ctx = this.fogCtx;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = "rgba(151, 173, 168, 0.47)";
    ctx.fillRect(0, 0, this.width, this.height);

    const offsetX = Math.sin(game.time * 0.018) * 42;
    const offsetY = Math.cos(game.time * 0.012) * 24;
    ctx.save();
    ctx.globalAlpha = 0.88;
    ctx.drawImage(this.fogTexture, -120 + offsetX, -90 + offsetY);
    ctx.globalAlpha = 0.46;
    ctx.drawImage(this.fogTexture, -120 - offsetX * 0.7, -90 + offsetY * 0.5);
    ctx.restore();

    const density = ctx.createLinearGradient(0, WORLD.waterTop, 0, WORLD.waterBottom);
    density.addColorStop(0, "rgba(190, 204, 198, 0.23)");
    density.addColorStop(0.45, "rgba(180, 198, 192, 0.04)");
    density.addColorStop(1, "rgba(196, 210, 203, 0.21)");
    ctx.fillStyle = density;
    ctx.fillRect(0, WORLD.waterTop, this.width, WORLD.waterBottom - WORLD.waterTop);

    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    const boatHalo = ctx.createRadialGradient(game.boat.x, game.boat.y, 12, game.boat.x, game.boat.y, 166);
    boatHalo.addColorStop(0, "rgba(0, 0, 0, 0.96)");
    boatHalo.addColorStop(0.38, "rgba(0, 0, 0, 0.8)");
    boatHalo.addColorStop(0.72, "rgba(0, 0, 0, 0.34)");
    boatHalo.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = boatHalo;
    ctx.beginPath();
    ctx.arc(game.boat.x, game.boat.y, 166, 0, TAU);
    ctx.fill();

    for (const beacon of game.world.beacons) {
      const intensity = this.#beaconStrength(beacon, game);
      if (intensity < 0.05) continue;
      const north = beacon.side === "north";
      const lightY = north ? beacon.y - 11 : beacon.y + 11;
      const radius = 56 + intensity * 58;
      const cut = ctx.createRadialGradient(beacon.x, lightY, 0, beacon.x, lightY, radius);
      cut.addColorStop(0, `rgba(0, 0, 0, ${0.9 * intensity})`);
      cut.addColorStop(0.45, `rgba(0, 0, 0, ${0.48 * intensity})`);
      cut.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = cut;
      ctx.beginPath();
      ctx.arc(beacon.x, lightY, radius, 0, TAU);
      ctx.fill();
    }

    for (const dock of [WORLD.northDock, WORLD.southDock]) {
      const lampY = dock.y < this.height / 2 ? dock.y - 44 : dock.y + 44;
      const dockCut = ctx.createRadialGradient(dock.x, lampY, 2, dock.x, lampY, 92);
      dockCut.addColorStop(0, "rgba(0, 0, 0, 0.5)");
      dockCut.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = dockCut;
      ctx.beginPath();
      ctx.arc(dock.x, lampY, 92, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    this.ctx.drawImage(this.fogCanvas, 0, 0);
  }

  #drawBeaconGlow(game) {
    const ctx = this.ctx;
    this.#drawBeacons(game, true);

    ctx.save();
    ctx.translate(game.boat.x, game.boat.y);
    ctx.rotate(game.boat.angle);
    ctx.globalCompositeOperation = "lighter";
    const beam = ctx.createLinearGradient(0, -35, 0, -330);
    beam.addColorStop(0, "rgba(255, 218, 154, 0.18)");
    beam.addColorStop(0.2, "rgba(255, 206, 134, 0.075)");
    beam.addColorStop(1, "rgba(255, 196, 111, 0)");
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(-4, -31);
    ctx.lineTo(-47, -326);
    ctx.lineTo(47, -326);
    ctx.lineTo(4, -31);
    ctx.closePath();
    ctx.fill();
    const lantern = ctx.createRadialGradient(0, -20, 0, 0, -20, 92);
    lantern.addColorStop(0, "rgba(255, 223, 165, 0.16)");
    lantern.addColorStop(1, "rgba(255, 213, 142, 0)");
    ctx.fillStyle = lantern;
    ctx.beginPath();
    ctx.arc(0, -20, 92, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  #drawRain(game) {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineWidth = 0.7;
    for (const drop of this.rain) {
      const x = (drop.x + game.time * 16) % (this.width + 20);
      const y = (drop.y + game.time * drop.speed) % (this.height + 20);
      ctx.strokeStyle = `rgba(207, 228, 222, ${drop.alpha})`;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - drop.length * 0.22, y + drop.length);
      ctx.stroke();
    }
    ctx.restore();
  }

  #drawRadar(game) {
    const ctx = this.ctx;
    const boat = game.boat;
    const sweep = game.time * 0.72;
    ctx.save();
    ctx.translate(boat.x, boat.y);
    ctx.globalCompositeOperation = "lighter";

    for (const [radius, alpha] of [
      [92, 0.14],
      [168, 0.1],
      [252, 0.07],
    ]) {
      ctx.strokeStyle = `rgba(137, 224, 238, ${alpha})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, TAU);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(139, 226, 239, 0.08)";
    ctx.lineWidth = 0.7;
    for (let angle = 0; angle < TAU; angle += Math.PI / 4) {
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * 28, Math.sin(angle) * 28);
      ctx.lineTo(Math.cos(angle) * 252, Math.sin(angle) * 252);
      ctx.stroke();
    }

    const sweepGradient = ctx.createLinearGradient(0, 0, Math.cos(sweep) * 252, Math.sin(sweep) * 252);
    sweepGradient.addColorStop(0, "rgba(128, 235, 246, 0.1)");
    sweepGradient.addColorStop(1, "rgba(128, 235, 246, 0)");
    ctx.fillStyle = sweepGradient;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 252, sweep, sweep + 0.38);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(144, 236, 243, 0.2)";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(sweep) * 252, Math.sin(sweep) * 252);
    ctx.stroke();

    for (const item of game.world.driftwood) {
      const dx = item.x - boat.x;
      const dy = item.y - boat.y;
      if (Math.hypot(dx, dy) > 310) continue;
      const blipAlpha = 0.28 + Math.max(0, Math.cos(Math.atan2(dy, dx) - sweep)) * 0.45;
      ctx.fillStyle = `rgba(255, 158, 103, ${blipAlpha})`;
      ctx.beginPath();
      ctx.arc(dx, dy, 2.3 + item.radius * 0.035, 0, TAU);
      ctx.fill();
    }

    for (const dock of [WORLD.northDock, WORLD.southDock]) {
      const dx = dock.x - boat.x;
      const dy = dock.y - boat.y;
      if (Math.hypot(dx, dy) > 270) continue;
      ctx.strokeStyle = "rgba(255, 202, 113, 0.38)";
      ctx.lineWidth = 1;
      ctx.strokeRect(dx - 9, dy - 4, 18, 8);
      ctx.beginPath();
      ctx.moveTo(dx - 13, dy);
      ctx.lineTo(dx + 13, dy);
      ctx.stroke();
    }

    if (game.echo > 0.02) {
      for (const beacon of game.world.beacons) {
        const dx = beacon.x - boat.x;
        const dy = beacon.y - boat.y;
        const distance = Math.hypot(dx, dy);
        if (distance > 560) continue;
        const px = (dx / distance) * Math.min(248, distance * 0.58);
        const py = (dy / distance) * Math.min(248, distance * 0.58);
        ctx.fillStyle = rgba(beacon.color, 0.32 + game.echo * 0.62);
        ctx.beginPath();
        ctx.moveTo(px, py - 3.5);
        ctx.lineTo(px + 3.5, py + 2.8);
        ctx.lineTo(px - 3.5, py + 2.8);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  #drawEcho(game) {
    if (game.echo <= 0.001) return;
    const ctx = this.ctx;
    const boat = game.boat;
    const rings = 2;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let index = 0; index < rings; index += 1) {
      const progress = (1 - game.echo + index * 0.3) % 1;
      const radius = 70 + progress * 260;
      const alpha = (1 - progress) * game.echo * 0.18;
      ctx.strokeStyle = `rgba(213, 240, 230, ${alpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(boat.x, boat.y, radius, radius * 0.82, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.textAlign = "center";
    const alpha = Math.min(1, game.echo * 1.7);
    ctx.fillStyle = `rgba(213, 235, 225, ${alpha * 0.66})`;
    ctx.font = '10px "Noto Serif SC", "Songti SC", serif';
    ctx.fillText("汽笛回响 · 岸标方位", boat.x, Math.max(154, boat.y - 178));
    ctx.restore();
  }
}
