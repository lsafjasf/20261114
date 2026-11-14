(function (root) {
  "use strict";

  const COLORS = {
    bg: "#08110c",
    wall: "#26382a",
    wallLight: "#607457",
    grain: "#8e6d35",
    grainLight: "#c59d55",
    grainDark: "#4f3b1c",
    air: "#82d8cb",
    wet: "#6c9fc8",
    hot: "#f27b4d",
    mold: "#536e43",
    text: "#dce5d3",
    muted: "#869480"
  };

  const BIN_SEED = [
    {
      peak: 0.54,
      hotX: 0.57,
      hotY: 0.37,
      wetX: 0.35,
      wetY: 0.76,
      marks: [
        [0.21, 0.54, 1.3], [0.42, 0.68, 0.8], [0.66, 0.49, 1.0], [0.8, 0.73, 0.7],
        [0.33, 0.83, 0.9], [0.58, 0.82, 1.2], [0.73, 0.61, 0.65], [0.14, 0.72, 0.7]
      ],
      cracks: [[0.37, 0.42, 0.62, 0.33], [0.6, 0.39, 0.7, 0.29], [0.52, 0.46, 0.47, 0.36]]
    },
    {
      peak: 0.6,
      hotX: 0.62,
      hotY: 0.43,
      wetX: 0.47,
      wetY: 0.8,
      marks: [
        [0.18, 0.62, 0.75], [0.31, 0.49, 1.0], [0.47, 0.72, 0.9], [0.68, 0.55, 1.1],
        [0.8, 0.78, 0.8], [0.57, 0.84, 0.7], [0.72, 0.68, 1.2], [0.24, 0.8, 0.65]
      ],
      cracks: [[0.31, 0.44, 0.54, 0.33], [0.56, 0.4, 0.67, 0.31], [0.44, 0.49, 0.37, 0.35]]
    },
    {
      peak: 0.48,
      hotX: 0.46,
      hotY: 0.5,
      wetX: 0.63,
      wetY: 0.74,
      marks: [
        [0.24, 0.56, 0.8], [0.39, 0.77, 1.1], [0.57, 0.62, 0.9], [0.74, 0.5, 0.7],
        [0.84, 0.74, 1.0], [0.16, 0.8, 0.9], [0.61, 0.84, 1.2], [0.48, 0.45, 0.7]
      ],
      cracks: [[0.4, 0.39, 0.51, 0.29], [0.65, 0.45, 0.73, 0.35], [0.32, 0.48, 0.26, 0.37]]
    }
  ];

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  class GrainScene {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.w = 0;
      this.h = 0;
      this.dpr = 1;
      this.lastTime = 0;
      this.particles = [];
      this.spawnCarry = [0, 0, 0];
      this.resize();
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.dpr = Math.min(2, root.devicePixelRatio || 1);
      this.w = Math.max(320, rect.width);
      this.h = Math.max(240, rect.height);
      this.canvas.width = Math.round(this.w * this.dpr);
      this.canvas.height = Math.round(this.h * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    draw(state, time) {
      if (!this.ctx || !state) return;
      const rect = this.canvas.getBoundingClientRect();
      if (Math.abs(rect.width - this.w) > 1 || Math.abs(rect.height - this.h) > 1) this.resize();
      const dt = this.lastTime ? clamp((time - this.lastTime) / 1000, 0, 0.1) : 0.016;
      this.lastTime = time;
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.w, this.h);
      this.drawBackdrop(ctx);
      const layout = this.getLayout();
      this.drawStructure(ctx, layout, state);
      for (let i = 0; i < 3; i += 1) {
        this.drawBin(ctx, state.bins[i], i, layout.bins[i], state, time);
      }
      this.drawAirSystem(ctx, layout, state, dt, time);
      this.drawAmbient(ctx, layout, state);
    }

    getLayout() {
      const pad = Math.max(13, this.w * 0.014);
      const top = 32;
      const bottom = this.h - 23;
      const roomW = this.w - pad * 2;
      const gap = Math.max(5, roomW * 0.008);
      const binW = (roomW - gap * 2) / 3;
      const bins = [];
      for (let i = 0; i < 3; i += 1) {
        bins.push({
          x: pad + i * (binW + gap),
          y: top,
          w: binW,
          h: bottom - top,
          floor: bottom - 17,
          grainTop: top + Math.max(64, (bottom - top) * 0.22)
        });
      }
      return { pad, top, bottom, bins };
    }

    drawBackdrop(ctx) {
      const gradient = ctx.createLinearGradient(0, 0, 0, this.h);
      gradient.addColorStop(0, "#0a1510");
      gradient.addColorStop(0.7, "#08120c");
      gradient.addColorStop(1, "#060e09");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.strokeStyle = "rgba(172, 199, 158, 0.045)";
      ctx.lineWidth = 1;
      for (let x = 16; x < this.w; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, this.h);
        ctx.stroke();
      }
      for (let y = 18; y < this.h; y += 32) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(this.w, y);
        ctx.stroke();
      }
    }

    drawStructure(ctx, layout, state) {
      const { pad, top, bottom } = layout;
      ctx.fillStyle = "rgba(9, 20, 13, 0.62)";
      ctx.fillRect(pad, top, this.w - pad * 2, bottom - top);
      ctx.strokeStyle = "rgba(154, 181, 141, 0.18)";
      ctx.lineWidth = 1;
      ctx.strokeRect(pad + 0.5, top + 0.5, this.w - pad * 2 - 1, bottom - top - 1);
      ctx.fillStyle = "rgba(78, 99, 69, 0.34)";
      ctx.fillRect(pad, top, this.w - pad * 2, 4);
      ctx.fillStyle = "rgba(160, 187, 145, 0.08)";
      ctx.fillRect(pad, top + 4, this.w - pad * 2, 1);
      ctx.strokeStyle = "rgba(173, 198, 158, 0.12)";
      for (let i = 1; i < 3; i += 1) {
        const x = layout.bins[i].x - 3;
        ctx.beginPath();
        ctx.moveTo(x, top + 8);
        ctx.lineTo(x, bottom);
        ctx.stroke();
      }
      if (state.controls.fan > 70) {
        ctx.strokeStyle = "rgba(231, 181, 111, 0.17)";
        ctx.setLineDash([2, 5]);
        ctx.strokeRect(pad + 2.5, top + 2.5, this.w - pad * 2 - 5, bottom - top - 5);
        ctx.setLineDash([]);
      }
    }

    drawAmbient(ctx, layout, state) {
      ctx.fillStyle = "rgba(146, 163, 135, 0.46)";
      ctx.font = "8px monospace";
      ctx.textAlign = "left";
      ctx.fillText("AMBIENT 20.4°C / RH 73%", layout.pad + 3, layout.bottom + 14);
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(130, 216, 203, 0.62)";
      ctx.fillText("FAN " + String(state.controls.fan).padStart(2, "0") + "%", this.w - layout.pad - 3, layout.bottom + 14);
    }

    grainPath(ctx, box, seed) {
      const left = box.x + 3;
      const right = box.x + box.w - 3;
      const floor = box.floor;
      const shoulder = box.grainTop + 8 + (1 - seed.peak) * 12;
      const peak = box.grainTop - seed.peak * 4;
      ctx.beginPath();
      ctx.moveTo(left, floor);
      ctx.lineTo(left, shoulder + 3);
      ctx.bezierCurveTo(left + box.w * 0.16, shoulder, left + box.w * 0.29, peak, left + box.w * 0.47, peak);
      ctx.bezierCurveTo(left + box.w * 0.66, peak, left + box.w * 0.78, shoulder - 2, right, shoulder + 7);
      ctx.lineTo(right, floor);
      ctx.closePath();
    }

    drawBin(ctx, bin, index, box, state, time) {
      const seed = BIN_SEED[index];
      const severity = root.GrainSim.severityFor(bin);
      const isFailed = bin.spoiled;
      this.drawBinHeader(ctx, bin, index, box, state);
      this.drawVent(ctx, bin, index, box, state, time);

      ctx.save();
      this.grainPath(ctx, box, seed);
      ctx.clip();
      this.drawGrainBase(ctx, box, seed, index);
      this.drawWetZone(ctx, bin, box, seed, time);
      this.drawHotspot(ctx, bin, box, seed, time);
      this.drawMold(ctx, bin, box, seed);
      this.drawCracks(ctx, bin, box, seed);
      ctx.restore();

      ctx.save();
      this.grainPath(ctx, box, seed);
      if (isFailed) {
        ctx.fillStyle = "rgba(50, 17, 11, 0.58)";
        ctx.fill();
      } else if (severity === "critical") {
        ctx.fillStyle = "rgba(105, 39, 16, 0.12)";
        ctx.fill();
      }
      ctx.strokeStyle = severity === "critical" || isFailed ? "rgba(255, 109, 74, 0.66)" : "rgba(217, 186, 125, 0.34)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      this.drawSensor(ctx, bin, box, seed, time);
      if (isFailed) this.drawFailed(ctx, bin, box);
      this.drawFloor(ctx, bin, index, box, state);
    }

    drawBinHeader(ctx, bin, index, box, state) {
      const severity = root.GrainSim.severityFor(bin);
      const color =
        bin.spoiled || severity === "critical"
          ? COLORS.hot
          : severity === "warning"
            ? "#e7b56f"
            : "#d4eb92";
      ctx.fillStyle = "rgba(214, 232, 194, 0.06)";
      ctx.fillRect(box.x + 5, box.y + 6, 18, 18);
      ctx.strokeStyle = "rgba(202, 222, 180, 0.18)";
      ctx.strokeRect(box.x + 5.5, box.y + 6.5, 17, 17);
      ctx.fillStyle = color;
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(bin.id, box.x + 14, box.y + 18);

      ctx.textAlign = "left";
      ctx.font = '11px "Noto Sans SC", sans-serif';
      ctx.fillStyle = COLORS.text;
      ctx.fillText(bin.name, box.x + 30, box.y + 18);
      ctx.font = '8px "Noto Sans SC", monospace';
      ctx.fillStyle = "rgba(142, 155, 136, 0.7)";
      ctx.fillText(bin.crop, box.x + 30, box.y + 28);

      ctx.textAlign = "right";
      ctx.fillStyle = color;
      ctx.font = "11px monospace";
      ctx.fillText(bin.temp.toFixed(1) + "°", box.x + box.w - 8, box.y + 17);
      ctx.fillStyle = "rgba(163, 178, 151, 0.7)";
      ctx.font = "8px monospace";
      ctx.fillText(bin.moisture.toFixed(1) + "% MC", box.x + box.w - 8, box.y + 28);
    }

    drawVent(ctx, bin, index, box, state, time) {
      const open = state.controls.vents[index];
      const x = box.x + box.w / 2 - 15;
      const y = box.y + 7;
      ctx.fillStyle = "rgba(5, 11, 7, 0.78)";
      ctx.fillRect(x - 1, y - 1, 32, 15);
      ctx.strokeStyle = open ? "rgba(130, 216, 203, 0.42)" : "rgba(231, 181, 111, 0.28)";
      ctx.strokeRect(x - 0.5, y - 0.5, 31, 14);
      for (let i = 0; i < 4; i += 1) {
        ctx.strokeStyle = open ? "rgba(130, 216, 203, 0.64)" : "rgba(231, 181, 111, 0.22)";
        ctx.beginPath();
        ctx.moveTo(x + 3, y + 3 + i * 3);
        ctx.lineTo(x + 27, y + 3 + i * 3);
        ctx.stroke();
      }
      if (!open) {
        ctx.strokeStyle = "rgba(231, 181, 111, 0.62)";
        ctx.beginPath();
        ctx.moveTo(x + 2, y + 2);
        ctx.lineTo(x + 28, y + 12);
        ctx.stroke();
      } else {
        const alpha = 0.22 + Math.sin(time / 430 + index) * 0.08;
        ctx.fillStyle = "rgba(130, 216, 203, " + alpha + ")";
        ctx.beginPath();
        ctx.moveTo(x + 13, y + 15);
        ctx.lineTo(x + 2, y + 24);
        ctx.lineTo(x + 28, y + 24);
        ctx.closePath();
        ctx.fill();
      }
    }

    drawGrainBase(ctx, box, seed, index) {
      const gradient = ctx.createLinearGradient(0, box.grainTop, 0, box.floor);
      gradient.addColorStop(0, index === 2 ? "#a27a3b" : "#927138");
      gradient.addColorStop(0.5, COLORS.grain);
      gradient.addColorStop(1, COLORS.grainDark);
      ctx.fillStyle = gradient;
      ctx.fillRect(box.x, box.grainTop - 8, box.w, box.floor - box.grainTop + 10);

      ctx.strokeStyle = "rgba(65, 45, 20, 0.18)";
      ctx.lineWidth = 1;
      const step = Math.max(7, box.w / 13);
      for (let x = box.x - box.h; x < box.x + box.w; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, box.floor);
        ctx.lineTo(x + box.h * 0.52, box.grainTop);
        ctx.stroke();
      }
      for (let i = 0; i < seed.marks.length; i += 1) {
        const mark = seed.marks[i];
        const x = box.x + mark[0] * box.w;
        const y = box.grainTop + mark[1] * (box.floor - box.grainTop);
        ctx.fillStyle = "rgba(224, 188, 111, 0.24)";
        ctx.beginPath();
        ctx.ellipse(x, y, 1.3 * mark[2], 0.8 * mark[2], -0.55, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "rgba(239, 216, 161, 0.16)";
      ctx.fillRect(box.x, box.grainTop - 2, box.w, 1);
    }

    drawWetZone(ctx, bin, box, seed, time) {
      if (bin.wetZone < 0.05) return;
      const x = box.x + seed.wetX * box.w;
      const y = box.grainTop + seed.wetY * (box.floor - box.grainTop);
      const radius = box.w * (0.22 + bin.wetZone * 0.64);
      const gradient = ctx.createRadialGradient(x, y, 2, x, y, radius);
      const strength = 0.13 + bin.wetZone * 0.27;
      gradient.addColorStop(0, "rgba(87, 137, 177, " + strength + ")");
      gradient.addColorStop(0.58, "rgba(65, 104, 139, " + strength * 0.57 + ")");
      gradient.addColorStop(1, "rgba(44, 71, 91, 0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(box.x, box.grainTop - 5, box.w, box.floor - box.grainTop + 8);
      if (bin.wetZone > 0.5) {
        ctx.strokeStyle = "rgba(114, 174, 205, " + (0.08 + bin.wetZone * 0.18) + ")";
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.ellipse(x, y, radius * 0.68, radius * 0.31, 0.08, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (bin.wetZone > 0.42) {
        const label = "WET " + Math.round(bin.wetZone * 100) + "%";
        ctx.font = "7px monospace";
        const width = ctx.measureText(label).width + 9;
        ctx.fillStyle = "rgba(6, 17, 24, 0.72)";
        ctx.fillRect(x - width / 2, y + radius * 0.24, width, 11);
        ctx.strokeStyle = "rgba(114, 174, 205, 0.32)";
        ctx.strokeRect(x - width / 2, y + radius * 0.24, width, 11);
        ctx.fillStyle = "rgba(141, 195, 224, 0.88)";
        ctx.textAlign = "center";
        ctx.fillText(label, x, y + radius * 0.24 + 8);
      }
    }

    drawHotspot(ctx, bin, box, seed, time) {
      if (bin.hotspot < 0.05) return;
      const x = box.x + seed.hotX * box.w;
      const y = box.grainTop + seed.hotY * (box.floor - box.grainTop);
      const pulse = 0.82 + Math.sin(time / 320) * 0.18;
      const radius = (15 + bin.hotspot * 31) * pulse;
      const gradient = ctx.createRadialGradient(x, y, 1, x, y, radius * 1.8);
      gradient.addColorStop(0, "rgba(255, 209, 111, " + (0.52 + bin.hotspot * 0.24) + ")");
      gradient.addColorStop(0.25, "rgba(237, 109, 66, " + (0.42 + bin.hotspot * 0.25) + ")");
      gradient.addColorStop(0.6, "rgba(184, 60, 37, 0.25)");
      gradient.addColorStop(1, "rgba(117, 33, 23, 0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius * 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 154, 94, " + (0.35 + bin.hotspot * 0.3) + ")";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.arc(x, y, radius * 0.72, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      if (bin.hotspot > 0.22) {
        const label = "HOT " + (36.8 + bin.hotspot * 2.4).toFixed(1) + "°";
        ctx.font = "7px monospace";
        const width = ctx.measureText(label).width + 9;
        ctx.fillStyle = "rgba(30, 10, 7, 0.78)";
        ctx.fillRect(x - width / 2, y - radius - 14, width, 11);
        ctx.strokeStyle = "rgba(255, 139, 92, 0.5)";
        ctx.strokeRect(x - width / 2, y - radius - 14, width, 11);
        ctx.fillStyle = "#ffb091";
        ctx.textAlign = "center";
        ctx.fillText(label, x, y - radius - 6);
      }
    }

    drawMold(ctx, bin, box, seed) {
      if (bin.mold < 0.015) return;
      const alpha = clamp(bin.mold * 1.8, 0.1, 0.72);
      const cx = box.x + seed.wetX * box.w;
      const cy = box.grainTop + seed.wetY * (box.floor - box.grainTop);
      for (let i = 0; i < 17; i += 1) {
        const angle = i * 2.39 + seed.peak * 9;
        const distance = 5 + ((i * 13) % 31);
        const x = cx + Math.cos(angle) * distance * 1.4;
        const y = cy + Math.sin(angle) * distance * 0.62;
        ctx.fillStyle = "rgba(31, 54, 31, " + alpha + ")";
        ctx.beginPath();
        ctx.arc(x, y, 1.2 + (i % 3) * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = "rgba(93, 121, 78, " + alpha * 0.5 + ")";
      ctx.setLineDash([1, 2]);
      ctx.beginPath();
      ctx.ellipse(cx, cy, 23 + bin.mold * 30, 9 + bin.mold * 15, 0.1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    drawCracks(ctx, bin, box, seed) {
      if (bin.cracks < 0.05) return;
      const alpha = clamp(bin.cracks * 1.25, 0.08, 0.8);
      ctx.strokeStyle = "rgba(239, 222, 179, " + alpha + ")";
      ctx.lineWidth = 0.8;
      for (let i = 0; i < seed.cracks.length; i += 1) {
        const crack = seed.cracks[i];
        const x1 = box.x + crack[0] * box.w;
        const y1 = box.grainTop + crack[1] * (box.floor - box.grainTop) * 0.5;
        const x2 = box.x + crack[2] * box.w;
        const y2 = box.grainTop + crack[3] * (box.floor - box.grainTop) * 0.5;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo((x1 + x2) / 2 + (i - 1) * 3, (y1 + y2) / 2);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }

    drawSensor(ctx, bin, box, seed, time) {
      const x = box.x + seed.hotX * box.w;
      const surfaceY = box.grainTop + 4;
      const severity = bin.spoiled ? "critical" : bin.temp > 28.7 || bin.hotspot > 0.2 ? "warning" : "safe";
      ctx.strokeStyle = "rgba(207, 225, 188, 0.26)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, box.y + 34);
      ctx.lineTo(x, surfaceY);
      ctx.stroke();
      ctx.fillStyle = severity === "warning" ? COLORS.hot : "rgba(212, 235, 146, 0.8)";
      ctx.beginPath();
      ctx.arc(x, surfaceY, 2.2 + Math.sin(time / 550) * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(199, 214, 183, 0.46)";
      ctx.font = "7px monospace";
      ctx.textAlign = "left";
      ctx.fillText("S-0" + (box.x > this.w / 2 ? "3" : "2"), x + 5, surfaceY + 2);
    }

    drawFailed(ctx, bin, box) {
      ctx.save();
      ctx.strokeStyle = "rgba(255, 109, 74, 0.5)";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(box.x + 6.5, box.y + 37.5, box.w - 13, box.floor - box.y - 44);
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(6, 13, 8, 0.78)";
      const label = "失守 / MOLD";
      ctx.font = '8px "Noto Sans SC", monospace';
      const width = ctx.measureText(label).width + 14;
      ctx.fillRect(box.x + box.w / 2 - width / 2, box.y + 52, width, 17);
      ctx.strokeStyle = "rgba(255, 109, 74, 0.38)";
      ctx.strokeRect(box.x + box.w / 2 - width / 2, box.y + 52, width, 17);
      ctx.fillStyle = COLORS.hot;
      ctx.textAlign = "center";
      ctx.fillText(label, box.x + box.w / 2, box.y + 63);
      ctx.restore();
    }

    drawFloor(ctx, bin, index, box, state) {
      const y = box.floor;
      ctx.fillStyle = "rgba(24, 37, 26, 0.7)";
      ctx.fillRect(box.x + 3, y, box.w - 6, 5);
      ctx.strokeStyle = "rgba(176, 199, 160, 0.18)";
      ctx.beginPath();
      ctx.moveTo(box.x + 3, y);
      ctx.lineTo(box.x + box.w - 3, y);
      ctx.stroke();
      const open = state.controls.vents[index];
      for (let i = 0; i < 16; i += 1) {
        const x = box.x + 8 + i * ((box.w - 16) / 15);
        ctx.fillStyle = open ? "rgba(130, 216, 203, 0.32)" : "rgba(188, 167, 111, 0.16)";
        ctx.fillRect(x, y + 1.5, 2, 2);
      }
      ctx.fillStyle = "rgba(161, 179, 146, 0.35)";
      ctx.font = "7px monospace";
      ctx.textAlign = "left";
      ctx.fillText(open ? "AIR IN" : "SEALED", box.x + 7, y + 14);
    }

    drawAirSystem(ctx, layout, state, dt, time) {
      const load = state.controls.fan / 100;
      const ductY = layout.bottom - 8;
      const ductStart = layout.pad + 7;
      const ductEnd = this.w - layout.pad - 7;
      ctx.strokeStyle = "rgba(130, 216, 203, " + (0.12 + load * 0.38) + ")";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ductStart, ductY);
      ctx.lineTo(ductEnd, ductY);
      ctx.stroke();
      ctx.setLineDash([3, 8]);
      ctx.lineDashOffset = -time / (38 - load * 28);
      ctx.strokeStyle = "rgba(130, 216, 203, " + (0.16 + load * 0.58) + ")";
      ctx.beginPath();
      ctx.moveTo(ductStart, ductY);
      ctx.lineTo(ductEnd, ductY);
      ctx.stroke();
      ctx.setLineDash([]);
      this.drawFan(ctx, layout.pad + 20, ductY, load, time);

      for (let i = 0; i < 3; i += 1) {
        const box = layout.bins[i];
        const open = state.controls.vents[i];
        if (open && load > 0.04) {
          const top = box.y + 30;
          const airGradient = ctx.createLinearGradient(0, box.floor, 0, top);
          airGradient.addColorStop(0, "rgba(130, 216, 203, " + (0.02 + load * 0.035) + ")");
          airGradient.addColorStop(0.72, "rgba(130, 216, 203, " + (0.018 + load * 0.026) + ")");
          airGradient.addColorStop(1, "rgba(130, 216, 203, 0)");
          ctx.fillStyle = airGradient;
          ctx.fillRect(box.x + box.w * 0.18, top, box.w * 0.64, box.floor - top);
          ctx.strokeStyle = "rgba(130, 216, 203, " + (0.09 + load * 0.18) + ")";
          ctx.lineWidth = 1;
          for (let arrow = 0; arrow < 3; arrow += 1) {
            const phase = ((time / (680 - load * 390) + arrow / 3 + i * 0.13) % 1);
            const y = box.floor - 7 - phase * (box.floor - top - 20);
            const x = box.x + box.w * (0.31 + arrow * 0.19);
            ctx.beginPath();
            ctx.moveTo(x - 3, y + 3);
            ctx.lineTo(x, y);
            ctx.lineTo(x + 3, y + 3);
            ctx.stroke();
          }
        }
        this.spawnCarry[i] += dt * (open ? 10 + load * 42 : 0);
        const count = Math.floor(this.spawnCarry[i]);
        this.spawnCarry[i] -= count;
        for (let n = 0; n < count; n += 1) {
          this.particles.push({
            bin: i,
            phase: 0,
            speed: 0.18 + load * 0.49,
            jitter: Math.random() * 2 - 1,
            length: 0.6 + Math.random() * 0.85
          });
        }
      }
      for (let p = this.particles.length - 1; p >= 0; p -= 1) {
        const particle = this.particles[p];
        particle.phase += dt * particle.speed;
        if (particle.phase > 1.08) {
          this.particles.splice(p, 1);
          continue;
        }
        if (p > 70) continue;
        const box = layout.bins[particle.bin];
        const x = box.x + 12 + (box.w - 24) * ((particle.phase * 0.8 + 0.1 + particle.jitter * 0.045) % 1);
        const start = box.floor - 3;
        const end = box.y + 23;
        const y = start + (end - start) * clamp(particle.phase, 0, 1);
        const opacity = Math.sin(clamp(particle.phase, 0, 1) * Math.PI) * (0.3 + load * 0.54);
        ctx.strokeStyle = "rgba(130, 216, 203, " + opacity + ")";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.sin(particle.phase * 5 + time / 600) * 1.8, y - Math.max(2, particle.length * 4));
        ctx.stroke();
      }
    }

    drawFan(ctx, x, y, load, time) {
      const rotation = time * (0.25 + load * 5.5);
      ctx.strokeStyle = "rgba(183, 207, 170, 0.28)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = load > 0.01 ? "rgba(130, 216, 203, " + (0.2 + load * 0.45) + ")" : "rgba(140, 154, 133, 0.2)";
      ctx.beginPath();
      ctx.arc(x, y, 1.8, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 4; i += 1) {
        const angle = rotation + (Math.PI / 2) * i;
        ctx.strokeStyle = "rgba(130, 216, 203, " + (0.13 + load * 0.3) + ")";
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(angle) * 6, y + Math.sin(angle) * 6);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(139, 157, 135, 0.62)";
      ctx.font = "7px monospace";
      ctx.textAlign = "left";
      ctx.fillText("FAN", x + 11, y + 2.5);
    }
  }

  root.GrainScene = GrainScene;
})(typeof globalThis !== "undefined" ? globalThis : this);
