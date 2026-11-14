(function () {
  "use strict";

  const SCENE = { width: 1440, height: 900 };
  const ANCHOR = { x: 720, y: 786 };
  const KITE_BASE_Y = 735;
  const ALTITUDE_SCALE = 5.42;
  const GROUND_ALTITUDE = 2;

  const PALETTE = {
    ink: "#eef5ef",
    muted: "rgba(220, 238, 231, 0.58)",
    faint: "rgba(220, 238, 231, 0.25)",
    mint: "#8fe6c2",
    amber: "#ffc66f",
    coral: "#ff896f",
    cyan: "#83d9e8",
    panel: "rgba(7, 28, 39, 0.64)"
  };

  const LAYERS = [
    {
      name: "贴地层",
      code: "SURFACE",
      direction: 1,
      wind: 8.4,
      top: 34,
      color: "#83d9e8",
      tint: "rgba(61, 146, 158, 0.14)"
    },
    {
      name: "切变层",
      code: "SHEAR",
      direction: -1,
      wind: 11.6,
      top: 68,
      color: "#ffc66f",
      tint: "rgba(202, 150, 83, 0.13)"
    },
    {
      name: "急流层",
      code: "JET STREAM",
      direction: 1,
      wind: 14.2,
      top: 100,
      color: "#ff896f",
      tint: "rgba(198, 96, 77, 0.12)"
    }
  ];

  const TARGETS = [
    { x: 985, altitude: 17.5, label: "A", index: "01", color: "#83d9e8" },
    { x: 466, altitude: 52, label: "B", index: "02", color: "#ffc66f" },
    { x: 855, altitude: 86, label: "C", index: "03", color: "#ff896f" }
  ];

  function lerp(a, b, amount) {
    return a + (b - a) * amount;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function seededRandom(seed) {
    let value = seed >>> 0;
    return function random() {
      value += 0x6D2B79F5;
      let output = value;
      output = Math.imul(output ^ (output >>> 15), output | 1);
      output ^= output + Math.imul(output ^ (output >>> 7), output | 61);
      return ((output ^ (output >>> 14)) >>> 0) / 4294967296;
    };
  }

  function altitudeToY(altitude) {
    return KITE_BASE_Y - altitude * ALTITUDE_SCALE;
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.context = canvas.getContext("2d");
      this.width = SCENE.width;
      this.height = SCENE.height;
      this.dpr = 1;
      this.time = 0;
      this.lastTimestamp = performance.now();
      this.stars = this.makeStars();
      this.clouds = this.makeClouds();
      this.windStreaks = this.makeWindStreaks();
      this.grass = this.makeGrass();
      this.resize();
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.max(1, Math.floor(rect.width * this.dpr));
      this.canvas.height = Math.max(1, Math.floor(rect.height * this.dpr));
      this.scaleX = this.canvas.width / SCENE.width;
      this.scaleY = this.canvas.height / SCENE.height;
    }

    makeStars() {
      const random = seededRandom(47);
      return Array.from({ length: 56 }, () => ({
        x: random() * SCENE.width,
        y: random() * 330,
        radius: 0.4 + random() * 1.1,
        phase: random() * Math.PI * 2
      }));
    }

    makeClouds() {
      const random = seededRandom(823);
      const bands = [
        { y: [135, 245], scale: [0.48, 1.02], speed: 2.4, alpha: 0.14, count: 9 },
        { y: [350, 480], scale: [0.7, 1.62], speed: -3.8, alpha: 0.16, count: 7 },
        { y: [565, 690], scale: [0.85, 1.88], speed: 4.5, alpha: 0.18, count: 6 }
      ];

      return bands.flatMap((band, bandIndex) =>
        Array.from({ length: band.count }, () => ({
          band: bandIndex,
          x: random() * (SCENE.width + 300) - 150,
          y: lerp(band.y[0], band.y[1], random()),
          scale: lerp(band.scale[0], band.scale[1], random()),
          speed: band.speed * (0.7 + random() * 0.6),
          alpha: band.alpha * (0.65 + random() * 0.5),
          puffs: 4 + Math.floor(random() * 4),
          seed: random() * 100
        }))
      );
    }

    makeWindStreaks() {
      const random = seededRandom(176);
      const streaks = [];

      LAYERS.forEach((layer, layerIndex) => {
        const bottom = layerIndex === 0 ? 3 : LAYERS[layerIndex - 1].top;
        for (let index = 0; index < 20; index += 1) {
          const altitude = lerp(bottom + 2, layer.top - 1, random());
          streaks.push({
            layer: layerIndex,
            x: random() * (SCENE.width + 220) - 110,
            altitude,
            length: 35 + random() * 145,
            speed: layer.wind * (1.4 + random() * 1.7),
            alpha: 0.11 + random() * 0.17,
            wave: random() * Math.PI * 2,
            width: 0.5 + random() * 0.8
          });
        }
      });

      return streaks;
    }

    makeGrass() {
      const random = seededRandom(930);
      return Array.from({ length: 92 }, () => ({
        x: random() * SCENE.width,
        y: 790 + random() * 105,
        height: 8 + random() * 31,
        lean: (random() - 0.5) * 13,
        alpha: 0.12 + random() * 0.28
      }));
    }

    draw(state, delta) {
      this.time += delta;
      const context = this.context;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      context.setTransform(this.scaleX, 0, 0, this.scaleY, 0, 0);
      context.save();
      context.lineCap = "round";
      context.lineJoin = "round";

      this.drawSky(state);
      this.drawSun(state);
      this.drawClouds(state);
      this.drawLayerBands(state);
      this.drawWind(state);
      this.drawTargetZones(state);
      this.drawGround(state);
      this.drawString(state);
      this.drawKite(state);
      this.drawInstruments(state);

      context.restore();
    }

    drawSky(state) {
      const context = this.context;
      const gradient = context.createLinearGradient(0, 0, 0, SCENE.height);
      gradient.addColorStop(0, "#061b30");
      gradient.addColorStop(0.24, "#0d3448");
      gradient.addColorStop(0.52, "#326a76");
      gradient.addColorStop(0.74, "#759b91");
      gradient.addColorStop(0.88, "#c3ae83");
      gradient.addColorStop(1, "#6a7058");
      context.fillStyle = gradient;
      context.fillRect(0, 0, SCENE.width, SCENE.height);

      const glow = context.createRadialGradient(1010, 640, 20, 1010, 640, 520);
      glow.addColorStop(0, "rgba(255, 212, 145, 0.23)");
      glow.addColorStop(0.42, "rgba(234, 179, 117, 0.08)");
      glow.addColorStop(1, "rgba(234, 179, 117, 0)");
      context.fillStyle = glow;
      context.fillRect(0, 180, SCENE.width, 660);

      for (const star of this.stars) {
        const twinkle = 0.35 + Math.sin(this.time * 0.7 + star.phase) * 0.2;
        context.globalAlpha = twinkle;
        context.fillStyle = "#dff5ec";
        context.beginPath();
        context.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;
    }

    drawSun() {
      const context = this.context;
      const x = 1075;
      const y = 610;
      const glow = context.createRadialGradient(x, y, 8, x, y, 145);
      glow.addColorStop(0, "rgba(255, 232, 188, 0.72)");
      glow.addColorStop(0.24, "rgba(255, 215, 158, 0.28)");
      glow.addColorStop(1, "rgba(255, 205, 136, 0)");
      context.fillStyle = glow;
      context.beginPath();
      context.arc(x, y, 145, 0, Math.PI * 2);
      context.fill();

      context.fillStyle = "rgba(255, 226, 171, 0.58)";
      context.beginPath();
      context.arc(x, y, 24, 0, Math.PI * 2);
      context.fill();
    }

    drawClouds(state) {
      const context = this.context;
      const wrapWidth = SCENE.width + 360;

      for (const cloud of this.clouds) {
        const drift = cloud.speed * this.time;
        let x = (cloud.x + drift + 180) % wrapWidth;
        if (x < 0) {
          x += wrapWidth;
        }
        x -= 180;
        const fade = clamp(Math.min(x / 150, (SCENE.width - x) / 150), 0, 1);
        context.save();
        context.globalAlpha = cloud.alpha * fade;

        const shade = context.createLinearGradient(
          0,
          cloud.y - 48 * cloud.scale,
          0,
          cloud.y + 35 * cloud.scale
        );
        shade.addColorStop(0, cloud.band === 2 ? "#83a2a0" : "#a6beb8");
        shade.addColorStop(0.64, "#b8cabf");
        shade.addColorStop(1, "#5f7f7c");
        context.fillStyle = shade;

        for (let puff = 0; puff < cloud.puffs; puff += 1) {
          const spread = (puff / Math.max(1, cloud.puffs - 1) - 0.5) * 135;
          const lift = Math.sin((puff + cloud.seed) * 1.4) * 13;
          const radius = (20 + (puff % 3) * 7) * cloud.scale;
          context.beginPath();
          context.ellipse(
            x + spread * cloud.scale,
            cloud.y - lift * cloud.scale,
            radius * 1.5,
            radius,
            0,
            0,
            Math.PI * 2
          );
          context.fill();
        }

        context.globalAlpha *= 0.58;
        context.fillStyle = "#e4d8b9";
        context.beginPath();
        context.ellipse(
          x - 18 * cloud.scale,
          cloud.y - 19 * cloud.scale,
          54 * cloud.scale,
          12 * cloud.scale,
          -0.08,
          Math.PI,
          Math.PI * 2
        );
        context.fill();
        context.restore();
      }

      context.globalAlpha = 1;
    }

    drawLayerBands(state) {
      const context = this.context;

      for (let index = 0; index < LAYERS.length; index += 1) {
        const layer = LAYERS[index];
        const bottomAltitude = index === 0 ? 1 : LAYERS[index - 1].top;
        const topY = altitudeToY(layer.top);
        const bottomY = altitudeToY(bottomAltitude);

        const wash = context.createLinearGradient(0, topY, 0, bottomY);
        wash.addColorStop(0, layer.tint);
        wash.addColorStop(0.55, "rgba(230, 244, 232, 0.015)");
        wash.addColorStop(1, "rgba(4, 28, 37, 0.08)");
        context.fillStyle = wash;
        context.fillRect(0, topY, SCENE.width, bottomY - topY);
      }

      context.save();
      context.setLineDash([12, 13]);
      context.lineWidth = 1;

      [34, 68].forEach((altitude) => {
        const y = altitudeToY(altitude);
        context.strokeStyle = "rgba(231, 244, 237, 0.14)";
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(SCENE.width, y);
        context.stroke();
      });
      context.restore();

      const labels = [
        { altitude: 67.2, layer: LAYERS[2] },
        { altitude: 33.2, layer: LAYERS[1] },
        { altitude: 1.2, layer: LAYERS[0] }
      ];

      context.font = '650 9px "Avenir Next", "Segoe UI", "Survey Sans", sans-serif';
      context.textAlign = "left";
      for (const item of labels) {
        const y = altitudeToY(item.altitude);
        context.fillStyle = item.layer.color;
        context.globalAlpha = state.phase === "playing" ? 0.78 : 0.48;
        context.beginPath();
        context.arc(1048, y - 8, 2.5, 0, Math.PI * 2);
        context.fill();
        context.fillText(item.layer.name, 1057, y - 5);
        context.fillStyle = "rgba(220, 237, 230, 0.36)";
        context.font = '500 7px "SFMono-Regular", Consolas, "Survey Sans", monospace';
        context.fillText(item.layer.code, 1057, y + 6);
      }
      context.globalAlpha = 1;
      context.font = '500 7px "SFMono-Regular", Consolas, "Survey Sans", monospace';
      context.fillStyle = "rgba(219, 237, 230, 0.22)";
      for (let altitude = 0; altitude <= 100; altitude += 10) {
        const y = altitudeToY(altitude);
        context.beginPath();
        context.moveTo(1120, y);
        context.lineTo(1125, y);
        context.strokeStyle = "rgba(219, 237, 230, 0.18)";
        context.stroke();
        if (altitude > 0) {
          context.fillText(String(altitude).padStart(2, "0"), 1131, y + 3);
        }
      }
    }

    drawWind(state) {
      const context = this.context;
      const wrapWidth = SCENE.width + 300;
      const streaks = this.windStreaks;

      context.save();
      context.globalCompositeOperation = "screen";

      for (const streak of streaks) {
        const layer = LAYERS[streak.layer];
        const direction = layer.direction;
        let x = (streak.x + direction * streak.speed * this.time + 150) % wrapWidth;
        if (x < 0) {
          x += wrapWidth;
        }
        x -= 150;
        const y = altitudeToY(streak.altitude);
        const wave = Math.sin(this.time * 0.8 + streak.wave + x * 0.01) * 3;
        const length = streak.length;
        const startX = direction > 0 ? x - length : x;
        const endX = direction > 0 ? x : x + length;
        const gradient = context.createLinearGradient(startX, y, endX, y + wave);
        gradient.addColorStop(0, "rgba(210, 240, 232, 0)");
        gradient.addColorStop(0.35, layer.color.replace(")", ", 0.01)"));
        gradient.addColorStop(1, layer.color);
        context.strokeStyle = gradient;
        context.globalAlpha = streak.alpha * (0.72 + Math.sin(this.time + streak.wave) * 0.2);
        context.lineWidth = streak.width;
        context.beginPath();
        context.moveTo(startX, y + wave);
        context.bezierCurveTo(
          lerp(startX, endX, 0.33),
          y + Math.sin(this.time + streak.wave) * 5,
          lerp(startX, endX, 0.66),
          y - wave * 0.8,
          endX,
          y
        );
        context.stroke();

        if (Math.round(streak.wave * 10) % 3 === 0) {
          const tipY = y;
          const tipX = direction > 0 ? endX : startX;
          context.globalAlpha = streak.alpha * 2.5;
          context.strokeStyle = layer.color;
          context.lineWidth = 0.8;
          context.beginPath();
          context.moveTo(tipX - direction * 8, tipY - 3.5);
          context.lineTo(tipX, tipY);
          context.lineTo(tipX - direction * 8, tipY + 3.5);
          context.stroke();
        }
      }

      context.globalAlpha = 1;
      context.globalCompositeOperation = "source-over";
      context.restore();
    }

    drawTargetZones(state) {
      const context = this.context;
      const playing = state.phase === "playing" || state.phase === "landed";

      TARGETS.forEach((target, index) => {
        const centerX = target.x;
        const centerY = altitudeToY(target.altitude);
        const completed = Boolean(state.samples && state.samples[index]);
        const active = state.activeSample === index;
        const progress = active ? clamp(state.sampleProgress || 0, 0, 1) : 0;
        const color = completed ? PALETTE.mint : target.color;
        const pulse = 0.5 + Math.sin(this.time * 2.4 + index) * 0.5;
        const baseAlpha = playing ? 1 : 0.5;

        context.save();
        context.globalAlpha = baseAlpha;

        if (active) {
          const glow = context.createRadialGradient(
            centerX,
            centerY,
            10,
            centerX,
            centerY,
            112
          );
          glow.addColorStop(0, "rgba(226, 250, 240, 0.13)");
          glow.addColorStop(0.58, `${target.color}22`);
          glow.addColorStop(1, `${target.color}00`);
          context.fillStyle = glow;
          context.beginPath();
          context.ellipse(centerX, centerY, 118, 78, 0, 0, Math.PI * 2);
          context.fill();
        }

        const scrim = context.createRadialGradient(
          centerX,
          centerY,
          5,
          centerX,
          centerY,
          86
        );
        scrim.addColorStop(0, active ? "rgba(4, 25, 34, 0.26)" : "rgba(4, 25, 34, 0.15)");
        scrim.addColorStop(0.72, "rgba(4, 25, 34, 0.11)");
        scrim.addColorStop(1, "rgba(4, 25, 34, 0)");
        context.fillStyle = scrim;
        context.beginPath();
        context.ellipse(centerX, centerY, 88, 56, 0, 0, Math.PI * 2);
        context.fill();

        context.setLineDash([5, 8]);
        context.strokeStyle = active ? color : `${color}b5`;
        context.lineWidth = active ? 1.6 : 1.1;
        context.beginPath();
        context.ellipse(centerX, centerY, 77, 48, 0, 0, Math.PI * 2);
        context.stroke();

        context.setLineDash([]);
        context.strokeStyle = completed ? `${PALETTE.mint}99` : `${color}66`;
        context.lineWidth = 0.8;
        context.beginPath();
        context.ellipse(centerX, centerY, 65, 39, 0, 0, Math.PI * 2);
        context.stroke();

        const bracketSize = 10;
        const bracketX = 91;
        const bracketY = 57;
        context.strokeStyle = active ? color : `${color}66`;
        context.lineWidth = active ? 1.5 : 1;
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
          const x = centerX + sx * bracketX;
          const y = centerY + sy * bracketY;
          context.beginPath();
          context.moveTo(x, y - sy * bracketSize);
          context.lineTo(x, y);
          context.lineTo(x - sx * bracketSize, y);
          context.stroke();
        });

        context.strokeStyle = active ? color : `${color}66`;
        context.lineWidth = 0.8;
        context.beginPath();
        context.moveTo(centerX - 15, centerY);
        context.lineTo(centerX + 15, centerY);
        context.moveTo(centerX, centerY - 15);
        context.lineTo(centerX, centerY + 15);
        context.stroke();
        context.fillStyle = color;
        context.beginPath();
        context.arc(centerX, centerY, 2.5 + pulse * 1.5, 0, Math.PI * 2);
        context.fill();

        if (progress > 0) {
          context.save();
          context.translate(centerX, centerY);
          context.scale(1, 0.623);
          context.strokeStyle = PALETTE.mint;
          context.lineWidth = active ? 3.1 : 2.2;
          context.setLineDash([]);
          context.beginPath();
          context.arc(0, 0, 71, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
          context.stroke();
          context.restore();
        }

        context.fillStyle = active ? color : `${color}a8`;
        context.font = '650 8px "SFMono-Regular", Consolas, "Survey Sans", monospace';
        context.textAlign = "left";
        context.fillText(`${target.index} / ${target.label}`, centerX - 76, centerY - 61);
        context.fillStyle = "rgba(229, 243, 236, 0.55)";
        context.font = '500 7px "Avenir Next", "Segoe UI", "Survey Sans", sans-serif';
        context.fillText(
          completed ? "SIGNAL RECORDED" : active ? "SAMPLING WINDOW" : "TARGET WINDOW",
          centerX - 76,
          centerY - 50
        );

        if (completed) {
          context.strokeStyle = PALETTE.mint;
          context.lineWidth = 2;
          context.beginPath();
          context.moveTo(centerX - 5, centerY);
          context.lineTo(centerX - 1, centerY + 5);
          context.lineTo(centerX + 8, centerY - 7);
          context.stroke();
        }

        context.fillStyle = active ? color : "rgba(222, 239, 232, 0.36)";
        context.font = '500 7px "SFMono-Regular", Consolas, "Survey Sans", monospace';
        context.textAlign = "right";
        context.fillText(
          `${String(target.altitude.toFixed(0)).padStart(2, "0")} M`,
          centerX + 78,
          centerY + 59
        );
        context.restore();
      });
    }

    drawGround(state) {
      const context = this.context;

      context.save();
      context.fillStyle = "rgba(19, 54, 61, 0.58)";
      context.beginPath();
      context.moveTo(0, 714);
      context.bezierCurveTo(120, 681, 205, 700, 316, 660);
      context.bezierCurveTo(402, 631, 455, 681, 530, 694);
      context.bezierCurveTo(600, 705, 678, 657, 753, 675);
      context.bezierCurveTo(843, 698, 916, 642, 1009, 667);
      context.bezierCurveTo(1113, 694, 1217, 673, 1303, 648);
      context.bezierCurveTo(1365, 630, 1414, 657, 1440, 665);
      context.lineTo(1440, 900);
      context.lineTo(0, 900);
      context.closePath();
      context.fill();

      context.fillStyle = "rgba(12, 47, 52, 0.88)";
      context.beginPath();
      context.moveTo(0, 737);
      context.bezierCurveTo(143, 716, 244, 729, 364, 711);
      context.bezierCurveTo(510, 688, 603, 724, 742, 718);
      context.bezierCurveTo(897, 711, 1032, 684, 1182, 706);
      context.bezierCurveTo(1291, 722, 1372, 708, 1440, 695);
      context.lineTo(1440, 900);
      context.lineTo(0, 900);
      context.closePath();
      context.fill();

      const groundGradient = context.createLinearGradient(0, 714, 0, 900);
      groundGradient.addColorStop(0, "#1e4949");
      groundGradient.addColorStop(0.33, "#113b3c");
      groundGradient.addColorStop(1, "#082a2d");
      context.fillStyle = groundGradient;
      context.beginPath();
      context.moveTo(0, 750);
      context.bezierCurveTo(162, 727, 256, 748, 392, 734);
      context.bezierCurveTo(544, 717, 630, 753, 748, 742);
      context.bezierCurveTo(892, 728, 1037, 748, 1185, 733);
      context.bezierCurveTo(1291, 723, 1375, 739, 1440, 724);
      context.lineTo(1440, 900);
      context.lineTo(0, 900);
      context.closePath();
      context.fill();

      context.fillStyle = "rgba(211, 227, 210, 0.08)";
      context.beginPath();
      context.moveTo(0, 750);
      context.bezierCurveTo(174, 728, 299, 751, 456, 738);
      context.bezierCurveTo(610, 725, 756, 748, 904, 738);
      context.bezierCurveTo(1098, 725, 1278, 740, 1440, 724);
      context.lineTo(1440, 730);
      context.bezierCurveTo(1261, 748, 1090, 733, 902, 745);
      context.bezierCurveTo(743, 756, 601, 732, 456, 746);
      context.bezierCurveTo(298, 760, 161, 736, 0, 758);
      context.closePath();
      context.fill();

      context.strokeStyle = "rgba(197, 221, 208, 0.25)";
      context.lineWidth = 1.1;
      for (const blade of this.grass) {
        const sway = Math.sin(this.time * 1.3 + blade.x * 0.05) * 3;
        context.globalAlpha = blade.alpha;
        context.beginPath();
        context.moveTo(blade.x, blade.y);
        context.quadraticCurveTo(
          blade.x + blade.lean * 0.35,
          blade.y - blade.height * 0.55,
          blade.x + blade.lean + sway,
          blade.y - blade.height
        );
        context.stroke();
      }
      context.globalAlpha = 1;

      this.drawStation(state);
      this.drawWindsock();
      context.restore();
    }

    drawStation(state) {
      const context = this.context;
      const x = ANCHOR.x;
      const y = 763;

      context.save();
      context.translate(x, y);

      context.strokeStyle = "rgba(230, 241, 230, 0.6)";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(-19, 42);
      context.lineTo(0, 2);
      context.lineTo(20, 42);
      context.stroke();

      context.strokeStyle = "rgba(219, 236, 224, 0.3)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(-25, 20);
      context.lineTo(25, 20);
      context.stroke();

      context.fillStyle = "#0a2e35";
      context.strokeStyle = PALETTE.mint;
      context.lineWidth = 2.2;
      context.beginPath();
      context.arc(0, 3, 14, 0, Math.PI * 2);
      context.fill();
      context.stroke();

      context.strokeStyle = "rgba(143, 230, 194, 0.45)";
      context.lineWidth = 1;
      for (let spoke = 0; spoke < 6; spoke += 1) {
        const angle = spoke / 6 * Math.PI * 2 + this.time * 0.14;
        context.beginPath();
        context.moveTo(Math.cos(angle) * 4, 3 + Math.sin(angle) * 4);
        context.lineTo(Math.cos(angle) * 11, 3 + Math.sin(angle) * 11);
        context.stroke();
      }

      context.fillStyle = PALETTE.mint;
      context.beginPath();
      context.arc(0, 3, 2.4, 0, Math.PI * 2);
      context.fill();

      context.fillStyle = "#092b32";
      context.strokeStyle = "rgba(219, 237, 227, 0.4)";
      context.lineWidth = 1;
      context.beginPath();
      context.roundRect(-46, 34, 34, 20, 2);
      context.fill();
      context.stroke();
      context.fillStyle = state.phase === "playing" ? PALETTE.mint : "rgba(222, 240, 230, 0.4)";
      context.font = '600 7px "SFMono-Regular", Consolas, "Survey Sans", monospace';
      context.textAlign = "center";
      context.fillText(state.phase === "playing" ? "REC ●" : "STANDBY", -29, 47);

      context.fillStyle = "rgba(5, 25, 31, 0.86)";
      context.beginPath();
      context.arc(36, 32, 8, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "rgba(230, 242, 232, 0.62)";
      context.beginPath();
      context.arc(36, 26, 4.3, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "rgba(230, 242, 232, 0.62)";
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(36, 30);
      context.lineTo(36, 40);
      context.stroke();

      context.restore();
    }

    drawWindsock() {
      const context = this.context;
      const x = 1130;
      const y = 735;
      context.save();
      context.strokeStyle = "rgba(217, 235, 224, 0.33)";
      context.lineWidth = 1.2;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x, y - 58);
      context.stroke();

      const wave = Math.sin(this.time * 1.8) * 4;
      context.fillStyle = "rgba(255, 152, 113, 0.6)";
      context.beginPath();
      context.moveTo(x, y - 56);
      context.quadraticCurveTo(x + 22, y - 64 + wave, x + 43, y - 53);
      context.lineTo(x + 39, y - 42);
      context.quadraticCurveTo(x + 20, y - 51 - wave, x, y - 47);
      context.closePath();
      context.fill();
      context.restore();
    }

    drawString(state) {
      const context = this.context;
      const altitude = clamp(state.altitude || 0, 0, 100);
      const x = clamp(state.x || ANCHOR.x, 254, 1186);
      const kiteY = altitudeToY(altitude);
      const start = { x: ANCHOR.x + 1, y: 758 };
      const end = { x, y: kiteY + 31 };
      const tension = clamp(state.tension || 0, 0, 100);
      const slack = clamp((52 - tension) / 34, 0, 1);
      const strain = clamp((tension - 76) / 24, 0, 1);
      const layer = state.layer || 0;
      const windDirection = LAYERS[layer] ? LAYERS[layer].direction : 1;
      const signedBend = windDirection * (0.8 + slack * 2.2) * 17;
      const sag = slack * 68 + Math.max(0, (state.lineLength || 0) - altitude) * 1.2;

      const points = [];
      const segments = 42;
      for (let index = 0; index <= segments; index += 1) {
        const t = index / segments;
        const arc = Math.sin(Math.PI * t);
        const wobble = Math.sin(t * 11 + this.time * 2.2) * arc * slack * 10;
        points.push({
          x: lerp(start.x, end.x, t) + arc * signedBend + wobble,
          y: lerp(start.y, end.y, t) + arc * sag
        });
      }

      context.save();
      context.lineCap = "round";
      context.strokeStyle = "rgba(3, 17, 23, 0.3)";
      context.lineWidth = 3.4;
      context.beginPath();
      context.moveTo(points[0].x + 1, points[0].y + 2);
      for (let index = 1; index < points.length; index += 1) {
        context.lineTo(points[index].x + 1, points[index].y + 2);
      }
      context.stroke();

      const ropeColor = strain > 0.45 ? "#ffb089" : tension < 26 ? "rgba(222, 239, 225, 0.45)" : "#d7eadb";
      context.strokeStyle = ropeColor;
      context.lineWidth = 0.85 + (1 - strain) * 0.55;
      context.globalAlpha = 0.82;
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index += 1) {
        context.lineTo(points[index].x, points[index].y);
      }
      context.stroke();

      if (strain > 0.15) {
        context.globalAlpha = strain * 0.65;
        context.strokeStyle = PALETTE.coral;
        context.lineWidth = 0.65;
        const vibration = Math.sin(this.time * 28) * strain * 1.5;
        context.beginPath();
        context.moveTo(points[0].x + vibration, points[0].y);
        for (let index = 1; index < points.length; index += 1) {
          context.lineTo(
            points[index].x + Math.sin(index * 1.7 + this.time * 24) * strain * 1.3,
            points[index].y
          );
        }
        context.stroke();
      }

      context.globalAlpha = 1;
      context.restore();
    }

    drawKite(state) {
      const context = this.context;
      const altitude = clamp(state.altitude || 0, 0, 100);
      const tension = clamp(state.tension || 0, 0, 100);
      const slackWobble = tension < 26
        ? Math.sin(this.time * 3.4) * (1 - tension / 26) * 6
        : 0;
      const x = clamp(state.x || ANCHOR.x, 254, 1186);
      const y = altitudeToY(altitude) + Math.sin(this.time * 1.7 + altitude) * 1.8 + slackWobble;
      const angle = clamp(state.kiteAngle || 0, -0.36, 0.36);
      const layer = state.layer || 0;
      const windDirection = LAYERS[layer] ? LAYERS[layer].direction : 1;
      const damage = clamp(state.damage || 0, 0, 100);

      context.save();
      context.translate(x, y);
      context.rotate(angle);

      this.drawKiteTails(context, windDirection, tension, state);

      const bodyGradient = context.createLinearGradient(-47, -38, 50, 38);
      bodyGradient.addColorStop(0, "#ff8d70");
      bodyGradient.addColorStop(0.48, "#ffb474");
      bodyGradient.addColorStop(1, "#f0d797");
      context.fillStyle = bodyGradient;
      context.strokeStyle = "rgba(37, 56, 57, 0.8)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(-51, -14);
      context.quadraticCurveTo(-24, -28, 0, -43);
      context.quadraticCurveTo(27, -27, 53, -12);
      context.quadraticCurveTo(26, 9, 8, 34);
      context.lineTo(0, 40);
      context.lineTo(-7, 33);
      context.quadraticCurveTo(-27, 8, -51, -14);
      context.closePath();
      context.fill();
      context.stroke();

      context.fillStyle = "rgba(247, 232, 191, 0.72)";
      context.beginPath();
      context.moveTo(0, -39);
      context.lineTo(10, 31);
      context.lineTo(0, 38);
      context.lineTo(-10, 31);
      context.closePath();
      context.fill();

      context.strokeStyle = "rgba(75, 70, 56, 0.42)";
      context.lineWidth = 0.8;
      context.beginPath();
      context.moveTo(-49, -14);
      context.lineTo(0, 4);
      context.lineTo(51, -12);
      context.moveTo(-28, 7);
      context.lineTo(0, -39);
      context.lineTo(28, 8);
      context.stroke();

      context.fillStyle = "rgba(29, 74, 76, 0.86)";
      context.beginPath();
      context.moveTo(-5, -22);
      context.lineTo(5, -22);
      context.lineTo(8, 2);
      context.lineTo(0, 11);
      context.lineTo(-8, 2);
      context.closePath();
      context.fill();

      context.fillStyle = damage > 55 ? PALETTE.coral : PALETTE.mint;
      context.beginPath();
      context.arc(0, -27, 2.5, 0, Math.PI * 2);
      context.fill();
      context.restore();

      this.drawAnemometer(x, y + 78, state);
    }

    drawKiteTails(context, windDirection, tension, state) {
      const flutter = tension < 26 ? 1.5 : 1;
      const colors = ["#f4765f", "#ffd395", "#6cc5be"];

      for (let tail = 0; tail < 3; tail += 1) {
        const offset = (tail - 1) * 7;
        context.strokeStyle = colors[tail];
        context.globalAlpha = 0.78;
        context.lineWidth = tail === 1 ? 3.2 : 2.2;
        context.beginPath();
        context.moveTo(offset, 37);
        const direction = windDirection * (tail + 1) * 6;
        context.bezierCurveTo(
          offset + direction,
          58,
          offset - direction + Math.sin(this.time * 2.2 + tail) * 9 * flutter,
          76,
          offset + windDirection * (28 + tail * 10),
          101 + tail * 5
        );
        context.stroke();
      }

      context.globalAlpha = 1;
      context.fillStyle = "rgba(255, 224, 165, 0.72)";
      for (let marker = 0; marker < 4; marker += 1) {
        const t = 0.24 + marker * 0.19;
        const x = windDirection * (22 + marker * 9);
        const y = 45 + t * 55;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + windDirection * 5, y + 5);
        context.lineTo(x, y + 10);
        context.closePath();
        context.fill();
      }

      if ((state.damage || 0) > 70) {
        context.strokeStyle = `rgba(255, 116, 94, ${0.2 + (state.damage - 70) / 100})`;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(-29, 62);
        context.lineTo(-22, 69);
        context.lineTo(-29, 76);
        context.stroke();
      }
    }

    drawAnemometer(x, y, state) {
      const context = this.context;
      const windSpeed = state.windSpeed || 8;
      const rotation = this.time * (1.1 + windSpeed * 0.24);

      context.save();
      context.strokeStyle = "rgba(222, 239, 228, 0.55)";
      context.lineWidth = 0.8;
      context.beginPath();
      context.moveTo(x, y - 31);
      context.quadraticCurveTo(x + Math.sin(this.time * 1.6) * 3, y - 17, x, y - 5);
      context.stroke();

      context.translate(x, y);
      context.fillStyle = "rgba(7, 29, 36, 0.9)";
      context.strokeStyle = "rgba(173, 229, 208, 0.72)";
      context.lineWidth = 0.9;
      context.beginPath();
      context.roundRect(-13, -7, 26, 19, 2);
      context.fill();
      context.stroke();

      context.fillStyle = PALETTE.mint;
      context.font = '600 6.5px "SFMono-Regular", Consolas, "Survey Sans", monospace';
      context.textAlign = "center";
      context.fillText(windSpeed.toFixed(1), 0, 4);

      context.strokeStyle = "rgba(223, 240, 229, 0.58)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, -8);
      context.lineTo(0, -16);
      context.stroke();

      for (let cup = 0; cup < 3; cup += 1) {
        const angle = rotation + cup / 3 * Math.PI * 2;
        const armX = Math.cos(angle) * 8;
        const armY = Math.sin(angle) * 8;
        context.beginPath();
        context.moveTo(0, -16);
        context.lineTo(armX, -16 + armY);
        context.stroke();
        context.fillStyle = "rgba(211, 240, 228, 0.76)";
        context.beginPath();
        context.arc(armX, -16 + armY, 2.2, 0, Math.PI * 2);
        context.fill();
      }

      context.fillStyle = "rgba(255, 169, 123, 0.95)";
      context.beginPath();
      context.arc(0, -16, 1.6, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }

    drawInstruments(state) {
      const context = this.context;
      const altitude = clamp(state.altitude || 0, 0, 100);
      const tension = clamp(state.tension || 0, 0, 100);
      const damage = clamp(state.damage || 0, 0, 100);
      const layer = LAYERS[clamp(state.layer || 0, 0, 2)];
      const windSpeed = state.windSpeed || layer.wind;

      this.drawInstrumentPanel(1192, 164, 202, 252);
      context.textAlign = "left";
      context.fillStyle = "rgba(224, 239, 232, 0.48)";
      context.font = '650 7px "SFMono-Regular", Consolas, "Survey Sans", monospace';
      context.fillText("METEOROGRAPH / 测风仪", 1208, 184);
      context.fillStyle = PALETTE.mint;
      context.beginPath();
      context.arc(1374, 181, 2.2, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "rgba(143, 230, 194, 0.76)";
      context.font = '600 6px "SFMono-Regular", Consolas, "Survey Sans", monospace';
      context.fillText("LIVE", 1351, 184);

      context.fillStyle = "rgba(221, 238, 230, 0.47)";
      context.font = '600 7px "SFMono-Regular", Consolas, "Survey Sans", monospace';
      context.fillText("ALTITUDE", 1209, 209);
      context.fillStyle = PALETTE.ink;
      context.font = '400 38px "Avenir Next", "Segoe UI", "Survey Sans", sans-serif';
      context.fillText(altitude.toFixed(1), 1207, 245);
      context.fillStyle = "rgba(225, 240, 233, 0.44)";
      context.font = '500 10px "SFMono-Regular", Consolas, "Survey Sans", monospace';
      context.fillText("m", 1293, 242);

      context.fillStyle = `${layer.color}22`;
      context.beginPath();
      context.roundRect(1208, 258, 169, 22, 2);
      context.fill();
      context.fillStyle = layer.color;
      context.beginPath();
      context.arc(1219, 269, 2.4, 0, Math.PI * 2);
      context.fill();
      context.font = '600 8px "Avenir Next", "Segoe UI", "Survey Sans", sans-serif';
      context.fillText(layer.name, 1228, 272);
      context.textAlign = "right";
      context.fillStyle = "rgba(225, 240, 233, 0.48)";
      context.font = '500 6.5px "SFMono-Regular", Consolas, "Survey Sans", monospace';
      context.fillText(layer.code, 1369, 271);

      const compassX = 1293;
      const compassY = 326;
      const radius = 47;
      context.strokeStyle = "rgba(219, 237, 229, 0.17)";
      context.lineWidth = 0.8;
      context.beginPath();
      context.arc(compassX, compassY, radius, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.arc(compassX, compassY, radius - 8, 0, Math.PI * 2);
      context.strokeStyle = "rgba(219, 237, 229, 0.08)";
      context.stroke();

      context.textAlign = "center";
      context.font = '500 6px "SFMono-Regular", Consolas, "Survey Sans", monospace';
      context.fillStyle = "rgba(222, 238, 230, 0.34)";
      [["N", 0, -1], ["E", 1, 0], ["S", 0, 1], ["W", -1, 0]].forEach(([label, dx, dy]) => {
        context.fillText(label, compassX + dx * (radius - 12), compassY + dy * (radius - 12) + 2);
      });

      for (let tick = 0; tick < 24; tick += 1) {
        const angle = tick / 24 * Math.PI * 2;
        const inner = radius - (tick % 6 === 0 ? 13 : 10);
        context.strokeStyle = tick % 6 === 0
          ? "rgba(220, 238, 230, 0.3)"
          : "rgba(220, 238, 230, 0.12)";
        context.beginPath();
        context.moveTo(
          compassX + Math.cos(angle) * inner,
          compassY + Math.sin(angle) * inner
        );
        context.lineTo(
          compassX + Math.cos(angle) * radius,
          compassY + Math.sin(angle) * radius
        );
        context.stroke();
      }

      const windAngle = layer.direction > 0 ? 0 : Math.PI;
      context.save();
      context.translate(compassX, compassY);
      context.rotate(windAngle + Math.sin(this.time * 0.7) * 0.035);
      context.fillStyle = layer.color;
      context.beginPath();
      context.moveTo(27, 0);
      context.lineTo(9, -5);
      context.lineTo(12, 0);
      context.lineTo(9, 5);
      context.closePath();
      context.fill();
      context.strokeStyle = `${layer.color}66`;
      context.lineWidth = 0.8;
      context.beginPath();
      context.moveTo(-22, 0);
      context.lineTo(10, 0);
      context.stroke();
      context.restore();

      context.fillStyle = PALETTE.ink;
      context.font = '500 13px "SFMono-Regular", Consolas, "Survey Sans", monospace';
      context.fillText(windSpeed.toFixed(1), compassX, compassY + 2);
      context.fillStyle = "rgba(222, 239, 230, 0.4)";
      context.font = '500 6px "SFMono-Regular", Consolas, "Survey Sans", monospace';
      context.fillText("M/S", compassX, compassY + 12);
      context.fillStyle = "rgba(222, 239, 230, 0.38)";
      context.font = '500 6.5px "Avenir Next", "Segoe UI", "Survey Sans", sans-serif';
      context.fillText(layer.direction > 0 ? "向东流动" : "向西流动", compassX, 396);

      this.drawInstrumentPanel(1192, 430, 202, 226);
      context.textAlign = "left";
      context.fillStyle = "rgba(224, 239, 232, 0.48)";
      context.font = '650 7px "SFMono-Regular", Consolas, "Survey Sans", monospace';
      context.fillText("LINE LOAD / 绳索张力", 1208, 451);

      const gaugeX = 1293;
      const gaugeY = 521;
      const gaugeRadius = 55;
      const startAngle = Math.PI * 0.75;
      const sweep = Math.PI * 1.5;
      context.strokeStyle = "rgba(224, 240, 232, 0.12)";
      context.lineWidth = 5;
      context.beginPath();
      context.arc(gaugeX, gaugeY, gaugeRadius, startAngle, startAngle + sweep);
      context.stroke();

      const safeStart = startAngle + 0.25 * sweep;
      const safeEnd = startAngle + 0.78 * sweep;
      context.strokeStyle = "rgba(143, 230, 194, 0.62)";
      context.lineWidth = 3;
      context.beginPath();
      context.arc(gaugeX, gaugeY, gaugeRadius, safeStart, safeEnd);
      context.stroke();

      context.strokeStyle = "rgba(255, 137, 111, 0.64)";
      context.beginPath();
      context.arc(gaugeX, gaugeY, gaugeRadius, startAngle + 0.81 * sweep, startAngle + sweep);
      context.stroke();

      for (let index = 0; index <= 10; index += 1) {
        const angle = startAngle + sweep * index / 10;
        const inner = gaugeRadius - 9;
        context.strokeStyle = "rgba(220, 237, 229, 0.28)";
        context.lineWidth = 0.8;
        context.beginPath();
        context.moveTo(
          gaugeX + Math.cos(angle) * inner,
          gaugeY + Math.sin(angle) * inner
        );
        context.lineTo(
          gaugeX + Math.cos(angle) * (gaugeRadius - 3),
          gaugeY + Math.sin(angle) * (gaugeRadius - 3)
        );
        context.stroke();
      }

      const needleAngle = startAngle + sweep * tension / 100;
      context.save();
      context.translate(gaugeX, gaugeY);
      context.rotate(needleAngle);
      context.strokeStyle = tension < 26 || tension > 78 ? PALETTE.coral : PALETTE.ink;
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(-9, 0);
      context.lineTo(gaugeRadius - 5, 0);
      context.stroke();
      context.fillStyle = tension < 26 || tension > 78 ? PALETTE.coral : PALETTE.mint;
      context.beginPath();
      context.arc(0, 0, 3.5, 0, Math.PI * 2);
      context.fill();
      context.restore();

      context.textAlign = "center";
      context.fillStyle = tension < 26 ? PALETTE.cyan : tension > 78 ? PALETTE.coral : PALETTE.ink;
      context.font = '500 18px "SFMono-Regular", Consolas, "Survey Sans", monospace';
      context.fillText(Math.round(tension), gaugeX, gaugeY + 28);
      context.fillStyle = "rgba(222, 239, 230, 0.37)";
      context.font = '500 6px "SFMono-Regular", Consolas, "Survey Sans", monospace';
      context.fillText("TENSION", gaugeX, gaugeY + 38);
      context.textAlign = "left";
      context.fillStyle = "rgba(222, 239, 230, 0.33)";
      context.font = '500 6px "SFMono-Regular", Consolas, "Survey Sans", monospace';
      context.fillText("SLACK", 1211, 594);
      context.textAlign = "right";
      context.fillText("STRAIN", 1376, 594);

      context.textAlign = "left";
      context.fillStyle = "rgba(224, 239, 232, 0.44)";
      context.font = '600 6.5px "SFMono-Regular", Consolas, "Survey Sans", monospace';
      context.fillText("ROPE DAMAGE", 1209, 618);
      context.textAlign = "right";
      context.fillStyle = damage > 30 ? PALETTE.coral : "rgba(224, 239, 232, 0.58)";
      context.fillText(`${damage.toFixed(0)}%`, 1376, 618);
      context.textAlign = "left";
      context.fillStyle = "rgba(223, 239, 231, 0.1)";
      context.beginPath();
      context.roundRect(1209, 626, 167, 4, 2);
      context.fill();
      if (damage > 0.5) {
        context.fillStyle = damage > 30 ? PALETTE.coral : PALETTE.amber;
        context.beginPath();
        context.roundRect(1209, 626, 167 * damage / 100, 4, 2);
        context.fill();
      }

      context.fillStyle = "rgba(224, 239, 232, 0.25)";
      context.font = '500 6px "SFMono-Regular", Consolas, "Survey Sans", monospace';
      context.fillText(
        tension < 26 ? "LOW TENSION · CONTROL LOST" :
          tension > 78 ? "OVERLOAD · MATERIAL STRAIN" : "LINE NOMINAL",
        1209,
        645
      );
    }

    drawInstrumentPanel(x, y, width, height) {
      const context = this.context;
      context.save();
      context.fillStyle = "rgba(6, 27, 38, 0.64)";
      context.strokeStyle = "rgba(216, 237, 228, 0.15)";
      context.lineWidth = 1;
      context.beginPath();
      context.roundRect(x, y, width, height, 3);
      context.fill();
      context.stroke();

      context.strokeStyle = "rgba(216, 237, 228, 0.055)";
      context.beginPath();
      context.moveTo(x + 1, y + 30);
      context.lineTo(x + width - 1, y + 30);
      context.stroke();
      context.restore();
    }
  }

  Renderer.SCENE = SCENE;
  Renderer.ANCHOR = ANCHOR;
  Renderer.LAYERS = LAYERS;
  Renderer.TARGETS = TARGETS;
  Renderer.altitudeToY = altitudeToY;
  Renderer.GROUND_ALTITUDE = GROUND_ALTITUDE;
  window.WindRenderer = Renderer;
})();
