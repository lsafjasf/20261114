(function () {
  "use strict";

  const W = 1120;
  const H = 700;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(from, to, amount) {
    return from + (to - from) * amount;
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

  function seededRandom(seed) {
    let state = seed >>> 0;
    return function random() {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  class BakeryRenderer {
    constructor(canvas, config) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.config = config;
      this.scale = 1;
      this.offsetX = 0;
      this.offsetY = 0;
      this.width = W;
      this.height = H;
      this.staticLayer = document.createElement("canvas");
      this.staticLayer.width = W;
      this.staticLayer.height = H;
      this.buildStaticScene();
      this.shelfRegions = [];
      this.ovenRegion = { x: 758, y: 145, width: 310, height: 472 };
      this.hovered = null;
      this.resize();
      window.addEventListener("resize", () => this.resize());
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.width = Math.max(1, rect.width);
      this.height = Math.max(1, rect.height);
      this.canvas.width = Math.round(this.width * dpr);
      this.canvas.height = Math.round(this.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.scale = Math.min(this.width / W, this.height / H);
      this.offsetX = (this.width - W * this.scale) / 2;
      this.offsetY = (this.height - H * this.scale) / 2;
    }

    screenToVirtual(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: (clientX - rect.left - this.offsetX) / this.scale,
        y: (clientY - rect.top - this.offsetY) / this.scale,
      };
    }

    hitTest(clientX, clientY) {
      const point = this.screenToVirtual(clientX, clientY);
      const shelf = this.shelfRegions.find((region) => (
        point.x >= region.x && point.x <= region.x + region.width &&
        point.y >= region.y && point.y <= region.y + region.height
      ));
      if (shelf) return { type: "batch", id: shelf.id };
      const oven = this.ovenRegion;
      if (point.x >= oven.x && point.x <= oven.x + oven.width &&
          point.y >= oven.y && point.y <= oven.y + oven.height) {
        return { type: "oven" };
      }
      return null;
    }

    buildStaticScene() {
      const ctx = this.staticLayer.getContext("2d");
      ctx.clearRect(0, 0, W, H);
      this.drawWall(ctx);
      this.drawHangingLight(ctx);
      this.drawCabinetShell(ctx);
      this.drawOvenShell(ctx);
      this.drawForeground(ctx);
    }

    drawWall(ctx) {
      const wall = ctx.createLinearGradient(0, 0, W, H);
      wall.addColorStop(0, "#b66f4f");
      wall.addColorStop(0.46, "#a55f45");
      wall.addColorStop(1, "#744637");
      ctx.fillStyle = wall;
      ctx.fillRect(0, 0, W, H);

      const glow = ctx.createRadialGradient(505, 85, 10, 505, 180, 530);
      glow.addColorStop(0, "rgba(255, 208, 124, 0.35)");
      glow.addColorStop(0.5, "rgba(230, 151, 79, 0.09)");
      glow.addColorStop(1, "rgba(91, 46, 34, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      ctx.save();
      ctx.globalAlpha = 0.14;
      ctx.strokeStyle = "#4d2b23";
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 54) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + 32, H);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.13;
      const random = seededRandom(72);
      for (let index = 0; index < 130; index += 1) {
        const x = random() * W;
        const y = random() * 560;
        const radius = random() * 2.2 + 0.4;
        ctx.fillStyle = random() > 0.5 ? "#3d241e" : "#f1ac73";
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      this.drawWindow(ctx, 830, 25);
      this.drawWallShelf(ctx);

      const wainscot = ctx.createLinearGradient(0, 555, 0, H);
      wainscot.addColorStop(0, "#80513c");
      wainscot.addColorStop(1, "#55352c");
      ctx.fillStyle = wainscot;
      ctx.fillRect(0, 560, W, H - 560);

      ctx.strokeStyle = "rgba(244, 211, 166, 0.17)";
      ctx.lineWidth = 2;
      for (let x = -40; x < W + 80; x += 105) {
        ctx.beginPath();
        ctx.moveTo(x, 560);
        ctx.lineTo(x + 25, H);
        ctx.stroke();
      }
    }

    drawWindow(ctx, x, y) {
      ctx.save();
      roundedRect(ctx, x, y, 178, 238, 88);
      ctx.fillStyle = "#56352e";
      ctx.fill();
      roundedRect(ctx, x + 13, y + 13, 152, 212, 76);
      ctx.clip();
      const sky = ctx.createLinearGradient(x, y, x, y + 220);
      sky.addColorStop(0, "#38606c");
      sky.addColorStop(0.54, "#d08a68");
      sky.addColorStop(1, "#f0bf78");
      ctx.fillStyle = sky;
      ctx.fillRect(x + 10, y + 10, 158, 220);
      ctx.fillStyle = "rgba(59, 86, 81, 0.72)";
      ctx.beginPath();
      ctx.moveTo(x + 5, y + 153);
      ctx.bezierCurveTo(x + 50, y + 126, x + 108, y + 146, x + 172, y + 119);
      ctx.lineTo(x + 180, y + 240);
      ctx.lineTo(x + 3, y + 240);
      ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#ffe8bd";
      ctx.beginPath();
      ctx.arc(x + 105, y + 82, 23, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = "rgba(61, 38, 32, 0.8)";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(x + 89, y + 10);
      ctx.lineTo(x + 89, y + 224);
      ctx.moveTo(x + 14, y + 113);
      ctx.lineTo(x + 164, y + 113);
      ctx.stroke();
      roundedRect(ctx, x, y, 178, 238, 88);
      ctx.strokeStyle = "#5a382e";
      ctx.lineWidth = 12;
      ctx.stroke();
      ctx.restore();
    }

    drawWallShelf(ctx) {
      ctx.save();
      ctx.fillStyle = "#6b4032";
      ctx.fillRect(696, 304, 224, 9);
      ctx.fillStyle = "rgba(255, 209, 143, 0.58)";
      ctx.font = "600 12px Warm Oven Serif, Georgia, serif";
      ctx.fillText("BAKED DAILY", 738, 293);
      ctx.fillStyle = "#e8c99a";
      ctx.beginPath();
      ctx.arc(718, 287, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#8c5b3d";
      ctx.fillRect(908, 272, 8, 31);
      ctx.restore();
    }

    drawHangingLight(ctx) {
      ctx.save();
      ctx.strokeStyle = "#3d261f";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(296, 0);
      ctx.lineTo(296, 62);
      ctx.stroke();
      const shade = ctx.createLinearGradient(250, 0, 340, 0);
      shade.addColorStop(0, "#563429");
      shade.addColorStop(0.48, "#a6593d");
      shade.addColorStop(1, "#4b2e27");
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.moveTo(257, 62);
      ctx.lineTo(335, 62);
      ctx.lineTo(315, 96);
      ctx.quadraticCurveTo(296, 106, 277, 96);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(255, 221, 153, 0.75)";
      ctx.beginPath();
      ctx.ellipse(296, 94, 15, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    drawCabinetShell(ctx) {
      ctx.save();
      ctx.shadowColor = "rgba(31, 19, 13, 0.45)";
      ctx.shadowBlur = 28;
      ctx.shadowOffsetY = 16;
      roundedRect(ctx, 54, 91, 650, 535, 22);
      ctx.fillStyle = "#4c3028";
      ctx.fill();
      ctx.restore();

      const wood = ctx.createLinearGradient(55, 90, 700, 620);
      wood.addColorStop(0, "#c68b59");
      wood.addColorStop(0.5, "#9b603f");
      wood.addColorStop(1, "#70412f");
      roundedRect(ctx, 54, 91, 650, 535, 22);
      ctx.fillStyle = wood;
      ctx.fill();

      roundedRect(ctx, 74, 113, 610, 490, 15);
      const cavity = ctx.createLinearGradient(0, 113, 0, 603);
      cavity.addColorStop(0, "#2a2420");
      cavity.addColorStop(0.4, "#3b3028");
      cavity.addColorStop(1, "#221d1a");
      ctx.fillStyle = cavity;
      ctx.fill();

      ctx.strokeStyle = "rgba(255, 220, 170, 0.14)";
      ctx.lineWidth = 1;
      for (let row = 0; row < 3; row += 1) {
        const y = 155 + row * 151;
        const shelfLight = ctx.createLinearGradient(0, y, 0, y + 138);
        shelfLight.addColorStop(0, "rgba(255, 213, 147, 0.055)");
        shelfLight.addColorStop(1, "rgba(255, 213, 147, 0)");
        ctx.fillStyle = shelfLight;
        ctx.fillRect(88, y - 20, 582, 140);
        ctx.fillStyle = "#bf8b58";
        ctx.fillRect(91, y + 113, 576, 8);
        ctx.fillStyle = "#6b432f";
        ctx.fillRect(91, y + 121, 576, 12);
        ctx.beginPath();
        ctx.moveTo(94, y + 112);
        ctx.lineTo(126, y + 112);
        ctx.stroke();
      }

      ctx.fillStyle = "#34241f";
      roundedRect(ctx, 638, 310, 8, 66, 4);
      ctx.fill();
      ctx.fillStyle = "#c59461";
      roundedRect(ctx, 640, 318, 4, 50, 2);
      ctx.fill();
      ctx.restore();
    }

    drawOvenShell(ctx) {
      ctx.save();
      ctx.shadowColor = "rgba(33, 18, 12, 0.5)";
      ctx.shadowBlur = 26;
      ctx.shadowOffsetY = 14;
      roundedRect(ctx, 752, 149, 324, 477, 25);
      ctx.fillStyle = "#49352e";
      ctx.fill();
      ctx.restore();

      const body = ctx.createLinearGradient(760, 150, 1055, 600);
      body.addColorStop(0, "#67534a");
      body.addColorStop(0.42, "#443831");
      body.addColorStop(1, "#2e2825");
      roundedRect(ctx, 752, 149, 324, 477, 25);
      ctx.fillStyle = body;
      ctx.fill();
      ctx.strokeStyle = "rgba(238, 195, 139, 0.16)";
      ctx.lineWidth = 2;
      roundedRect(ctx, 760, 157, 308, 461, 20);
      ctx.stroke();

      ctx.fillStyle = "#302721";
      roundedRect(ctx, 780, 176, 268, 265, 17);
      ctx.fill();
      ctx.strokeStyle = "#8f6b52";
      ctx.lineWidth = 5;
      roundedRect(ctx, 785, 181, 258, 255, 14);
      ctx.stroke();

      const ovenInterior = ctx.createRadialGradient(917, 308, 10, 917, 308, 150);
      ovenInterior.addColorStop(0, "#6c3926");
      ovenInterior.addColorStop(0.58, "#38251f");
      ovenInterior.addColorStop(1, "#1d1917");
      ctx.fillStyle = ovenInterior;
      roundedRect(ctx, 795, 191, 238, 235, 11);
      ctx.fill();

      ctx.fillStyle = "#2b2622";
      ctx.fillRect(786, 445, 256, 11);
      ctx.fillStyle = "#8c694e";
      ctx.fillRect(798, 456, 8, 24);
      ctx.fillRect(1022, 456, 8, 24);

      ctx.fillStyle = "#1d1a18";
      roundedRect(ctx, 807, 492, 206, 79, 14);
      ctx.fill();
      ctx.strokeStyle = "#80644f";
      ctx.lineWidth = 2;
      roundedRect(ctx, 811, 496, 198, 71, 11);
      ctx.stroke();

      this.drawOvenDial(ctx, 833, 529);
      this.drawOvenDial(ctx, 891, 529);
      ctx.fillStyle = "#d7b98d";
      ctx.font = "700 8px Warm Oven Sans, sans-serif";
      ctx.letterSpacing = "1px";
      ctx.fillText("STEAM", 929, 518);
      ctx.fillText("STONE", 929, 544);
      ctx.fillStyle = "rgba(223, 187, 130, 0.48)";
      ctx.fillRect(929, 523, 59, 1);
      ctx.fillRect(929, 549, 59, 1);

      ctx.fillStyle = "#c99f6c";
      roundedRect(ctx, 801, 163, 79, 6, 3);
      ctx.fill();
      roundedRect(ctx, 890, 163, 79, 6, 3);
      ctx.fill();
      roundedRect(ctx, 979, 163, 70, 6, 3);
      ctx.fill();
    }

    drawOvenDial(ctx, x, y) {
      ctx.save();
      ctx.fillStyle = "#d1b388";
      ctx.beginPath();
      ctx.arc(x, y, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#3e342b";
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#e3c99c";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 6, y - 7);
      ctx.stroke();
      ctx.restore();
    }

    drawForeground(ctx) {
      const counter = ctx.createLinearGradient(0, 621, 0, H);
      counter.addColorStop(0, "#c68c58");
      counter.addColorStop(0.1, "#9d6442");
      counter.addColorStop(1, "#573526");
      ctx.fillStyle = counter;
      ctx.fillRect(0, 621, W, H - 621);
      ctx.fillStyle = "rgba(255, 218, 164, 0.34)";
      ctx.fillRect(0, 621, W, 2);

      ctx.save();
      ctx.globalAlpha = 0.32;
      ctx.strokeStyle = "#3d251e";
      ctx.lineWidth = 1;
      for (let y = 638; y < H; y += 18) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(330, y + 3, 730, y - 4, W, y + 2);
        ctx.stroke();
      }
      ctx.restore();

      const basket = ctx.createLinearGradient(64, 640, 195, 706);
      basket.addColorStop(0, "#c58954");
      basket.addColorStop(1, "#855334");
      roundedRect(ctx, 58, 636, 153, 77, 12);
      ctx.fillStyle = basket;
      ctx.fill();
      ctx.strokeStyle = "rgba(65, 39, 26, 0.36)";
      ctx.lineWidth = 2;
      for (let x = 68; x < 200; x += 15) {
        ctx.beginPath();
        ctx.moveTo(x, 642);
        ctx.lineTo(x + 6, 706);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(255, 238, 206, 0.75)";
      ctx.font = "italic 12px Warm Oven Serif, Georgia, serif";
      ctx.fillText("flour", 84, 669);
    }

    draw(state, now) {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.width, this.height);
      ctx.fillStyle = "#704433";
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.save();
      ctx.translate(this.offsetX, this.offsetY);
      ctx.scale(this.scale, this.scale);

      ctx.drawImage(this.staticLayer, 0, 0);
      this.drawLightBeam(ctx, now);
      this.drawMotes(ctx, now);
      this.shelfRegions = [];

      state.batches.forEach((batch, index) => {
        const x = 89;
        const y = 128 + index * 151;
        const region = { x, y, width: 582, height: 146, id: batch.id };
        this.shelfRegions.push(region);
        this.drawBatchRow(ctx, state, batch, index, region, now);
      });

      this.drawCabinetGlass(ctx, state, now);
      this.drawOvenDynamic(ctx, state, now);
      this.drawCounterGlow(ctx, now);
      ctx.restore();
    }

    drawLightBeam(ctx, now) {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const pulse = 0.94 + Math.sin(now * 0.0012) * 0.035;
      const beam = ctx.createLinearGradient(296, 88, 430, 610);
      beam.addColorStop(0, `rgba(255, 214, 136, ${0.13 * pulse})`);
      beam.addColorStop(0.62, "rgba(255, 213, 138, 0.035)");
      beam.addColorStop(1, "rgba(255, 215, 150, 0)");
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(276, 94);
      ctx.lineTo(316, 94);
      ctx.lineTo(505, 640);
      ctx.lineTo(158, 640);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    drawMotes(ctx, now) {
      ctx.save();
      ctx.fillStyle = "rgba(255, 226, 176, 0.5)";
      for (let index = 0; index < 26; index += 1) {
        const drift = (now * (0.0025 + index * 0.00004) + index * 2.4) % 640;
        const x = 180 + ((index * 71) % 500) + Math.sin(now * 0.0004 + index) * 13;
        const y = 100 + ((index * 107 + drift) % 510);
        const radius = 0.55 + (index % 4) * 0.35;
        ctx.globalAlpha = 0.08 + (index % 3) * 0.04;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    drawBatchRow(ctx, state, batch, index, region, now) {
      const baseY = 268 + index * 151;
      const isHovered = this.hoveredBatch === batch.id;
      const isSelected = state.selectedId === batch.id;
      const isReady = batch.status === "ready";
      const isOver = batch.status === "overproof";
      const isBaking = batch.status === "baking";
      const isBaked = batch.status === "baked";

      ctx.save();
      if (isHovered && !isBaking && !isBaked) {
        const hover = ctx.createLinearGradient(region.x, 0, region.x + region.width, 0);
        hover.addColorStop(0, "rgba(255, 228, 174, 0.08)");
        hover.addColorStop(1, "rgba(255, 228, 174, 0.02)");
        ctx.fillStyle = hover;
        roundedRect(ctx, region.x + 2, region.y + 2, region.width - 4, region.height - 4, 13);
        ctx.fill();
      }

      if (isSelected) {
        ctx.strokeStyle = isOver ? "rgba(234, 116, 94, 0.8)" : "rgba(244, 199, 121, 0.72)";
        ctx.lineWidth = 1.4;
        roundedRect(ctx, region.x + 2, region.y + 2, region.width - 4, region.height - 4, 13);
        ctx.stroke();
        ctx.fillStyle = isOver ? "#e5755e" : "#efc477";
        ctx.beginPath();
        ctx.moveTo(region.x + 2, region.y + 22);
        ctx.lineTo(region.x + 2, region.y + 2);
        ctx.lineTo(region.x + 22, region.y + 2);
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      this.drawWoodBoard(ctx, 130, baseY + 1, 250);

      if (isBaking || isBaked) {
        this.drawEmptyShelf(ctx, baseY, isBaking);
      } else {
        const pulse = isReady ? Math.sin(now * 0.005) * 0.5 + 0.5 : 0;
        if (isReady) {
          const halo = ctx.createRadialGradient(236, baseY - 36, 10, 236, baseY - 36, 112);
          halo.addColorStop(0, `rgba(170, 202, 139, ${0.13 + pulse * 0.05})`);
          halo.addColorStop(1, "rgba(170, 202, 139, 0)");
          ctx.fillStyle = halo;
          ctx.fillRect(115, baseY - 148, 250, 155);
        }
        if (isOver) {
          const halo = ctx.createRadialGradient(236, baseY - 30, 10, 236, baseY - 30, 115);
          halo.addColorStop(0, "rgba(201, 99, 74, 0.2)");
          halo.addColorStop(1, "rgba(201, 99, 74, 0)");
          ctx.fillStyle = halo;
          ctx.fillRect(115, baseY - 148, 250, 155);
        }
        this.drawDough(ctx, batch, 236, baseY, index, now);
      }

      this.drawBatchLabel(ctx, batch, index, region, baseY, now);
      ctx.restore();
    }

    drawWoodBoard(ctx, x, y, width) {
      ctx.save();
      ctx.fillStyle = "rgba(34, 22, 17, 0.3)";
      ctx.beginPath();
      ctx.ellipse(x + width / 2, y + 10, width / 2, 15, 0, 0, Math.PI * 2);
      ctx.fill();
      const board = ctx.createLinearGradient(0, y - 3, 0, y + 11);
      board.addColorStop(0, "#d9aa72");
      board.addColorStop(1, "#895734");
      roundedRect(ctx, x, y - 3, width, 13, 5);
      ctx.fillStyle = board;
      ctx.fill();
      ctx.strokeStyle = "rgba(69, 39, 23, 0.25)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 23, y + 1);
      ctx.bezierCurveTo(x + 80, y + 4, x + 173, y - 1, x + width - 28, y + 3);
      ctx.stroke();
      ctx.restore();
    }

    drawEmptyShelf(ctx, baseY, isBaking) {
      ctx.save();
      ctx.strokeStyle = "rgba(230, 196, 148, 0.18)";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.ellipse(236, baseY - 8, 82, 25, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(232, 204, 162, 0.55)";
      ctx.font = "italic 12px Warm Oven Serif, Georgia, serif";
      ctx.textAlign = "center";
      ctx.fillText(isBaking ? "in the oven" : "baked with care", 236, baseY - 37);
      ctx.textAlign = "left";
      ctx.restore();
    }

    drawDough(ctx, batch, cx, baseY, index, now) {
      const maturity = clamp(batch.maturity, 0, 118);
      const over = batch.status === "overproof";
      const ready = batch.status === "ready";
      const volume = 0.68 + Math.min(maturity, 108) / 100 * 0.56 + (over ? 0.09 : 0);
      const width = 128 * volume * (over ? 1.09 : 1);
      const height = 67 * volume * (over ? 0.88 : 1);
      const bottom = baseY - 7;
      const wobble = Math.sin(now * 0.0017 + index * 1.8) * (ready ? 1.6 : 0.7);

      ctx.save();
      ctx.fillStyle = "rgba(25, 16, 12, 0.34)";
      ctx.beginPath();
      ctx.ellipse(cx + 4, bottom + 6, width * 0.58, 13, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#75533b";
      ctx.beginPath();
      ctx.ellipse(cx, bottom + 1, width * 0.54, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(226, 188, 137, 0.25)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(cx, bottom, width * 0.5, 8, 0, 0, Math.PI * 2);
      ctx.stroke();

      const dome = new Path2D();
      const left = cx - width / 2;
      const right = cx + width / 2;
      const top = bottom - height + wobble;
      dome.moveTo(left, bottom);
      dome.bezierCurveTo(left - 2, bottom - height * 0.4, cx - width * 0.4, top, cx, top);
      dome.bezierCurveTo(cx + width * 0.4, top, right + 2, bottom - height * 0.4, right, bottom);
      dome.quadraticCurveTo(cx, bottom + 6, left, bottom);

      const doughFill = ctx.createRadialGradient(
        cx - width * 0.2, top + height * 0.24, 4,
        cx, bottom - height * 0.5, width * 0.67
      );
      doughFill.addColorStop(0, batch.config.highlight);
      doughFill.addColorStop(0.56, batch.config.color);
      doughFill.addColorStop(1, batch.config.shadow);
      ctx.fillStyle = doughFill;
      ctx.fill(dome);

      ctx.save();
      ctx.clip(dome);
      const random = seededRandom(batch.config.seed);
      const visibleBubbles = Math.floor(3 + maturity * 0.1);
      for (let bubble = 0; bubble < visibleBubbles; bubble += 1) {
        const bx = cx + (random() - 0.5) * width * 0.74;
        const by = bottom - 10 - random() * (height - 22);
        const pulse = 1 + Math.sin(now * 0.003 + bubble * 1.7 + index) * 0.11;
        const radius = (1.5 + random() * 4.4) * pulse * (over ? 1.28 : 1);
        const bubbleGradient = ctx.createRadialGradient(
          bx - radius * 0.25, by - radius * 0.25, 0,
          bx, by, radius
        );
        bubbleGradient.addColorStop(0, "rgba(255, 247, 213, 0.78)");
        bubbleGradient.addColorStop(0.54, "rgba(235, 208, 151, 0.34)");
        bubbleGradient.addColorStop(1, "rgba(126, 76, 36, 0.23)");
        ctx.fillStyle = bubbleGradient;
        ctx.beginPath();
        ctx.arc(bx, by, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(100, 57, 24, 0.18)";
        ctx.lineWidth = 0.65;
        ctx.stroke();
      }

      ctx.globalAlpha = 0.4;
      for (let fleck = 0; fleck < 20; fleck += 1) {
        const fx = cx + (random() - 0.5) * width * 0.82;
        const fy = bottom - 8 - random() * height * 0.82;
        ctx.fillStyle = fleck % 3 === 0 ? batch.config.flour : "rgba(102, 60, 29, 0.46)";
        ctx.beginPath();
        ctx.arc(fx, fy, random() * 1.2 + 0.25, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      const scoreY = top + height * 0.28;
      ctx.strokeStyle = over ? "rgba(112, 53, 29, 0.7)" : "rgba(189, 129, 62, 0.7)";
      ctx.lineWidth = over ? 2.5 : 1.8;
      ctx.lineCap = "round";
      if (over) {
        ctx.beginPath();
        ctx.moveTo(cx - 32, scoreY);
        ctx.quadraticCurveTo(cx - 5, scoreY + 8, cx + 15, scoreY - 2);
        ctx.quadraticCurveTo(cx + 29, scoreY - 9, cx + 42, scoreY + 4);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - 22, scoreY + 28);
        ctx.quadraticCurveTo(cx + 5, scoreY + 33, cx + 38, scoreY + 24);
        ctx.stroke();
      } else {
        [-1, 0, 1].forEach((score) => {
          const sx = cx + score * width * 0.2;
          ctx.beginPath();
          ctx.moveTo(sx - width * 0.08, scoreY + 7);
          ctx.quadraticCurveTo(sx, scoreY - 2, sx + width * 0.08, scoreY + 7);
          ctx.stroke();
        });
      }

      ctx.strokeStyle = ready ? "rgba(220, 241, 185, 0.4)" : "rgba(255, 234, 190, 0.26)";
      ctx.lineWidth = ready ? 2.2 : 1;
      ctx.beginPath();
      ctx.moveTo(left + 14, bottom - height * 0.35);
      ctx.bezierCurveTo(cx - width * 0.22, top + 6, cx + width * 0.22, top + 4, right - 12, bottom - height * 0.38);
      ctx.stroke();
      ctx.restore();
    }

    drawBatchLabel(ctx, batch, index, region, baseY, now) {
      const cardX = 351;
      const cardY = baseY - 108;
      const cardW = 302;
      const cardH = 91;
      const ready = batch.status === "ready";
      const over = batch.status === "overproof";
      const baking = batch.status === "baking";
      const baked = batch.status === "baked";
      let statusText = "醒发中";
      let stateColor = "#e0b875";
      if (ready) {
        statusText = now % 1400 < 700 ? "正好 · 可入炉" : "正  好 · 可入炉";
        stateColor = "#c8e0a2";
      } else if (over) {
        statusText = "已过发";
        stateColor = "#f08a6e";
      } else if (baking) {
        statusText = "烘烤中";
        stateColor = "#f0b36e";
      } else if (baked) {
        statusText = "已出炉 · 合格";
        stateColor = "#c8dfad";
      }

      ctx.save();
      roundedRect(ctx, cardX, cardY, cardW, cardH, 9);
      ctx.fillStyle = "rgba(30, 25, 21, 0.76)";
      ctx.fill();
      ctx.strokeStyle = ready
        ? "rgba(181, 211, 142, 0.42)"
        : over
          ? "rgba(220, 105, 81, 0.46)"
          : "rgba(246, 223, 187, 0.13)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = stateColor;
      ctx.font = "700 8px Warm Oven Sans, sans-serif";
      ctx.fillText(`BATCH 0${index + 1}  /  ${batch.config.cue}`, cardX + 14, cardY + 20);

      ctx.fillStyle = "#fff4df";
      ctx.font = "600 16px Warm Oven Serif, Songti SC, serif";
      ctx.fillText(batch.config.name, cardX + 14, cardY + 42);
      ctx.fillStyle = stateColor;
      ctx.font = "700 10px Warm Oven Sans, PingFang SC, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(statusText, cardX + cardW - 13, cardY + 41);
      ctx.textAlign = "left";

      const barX = cardX + 14;
      const barY = cardY + 55;
      const barW = cardW - 62;
      const barH = 5;
      roundedRect(ctx, barX, barY, barW, barH, 3);
      ctx.fillStyle = "rgba(255, 248, 231, 0.13)";
      ctx.fill();
      const zoneX = barX + barW * 0.76;
      ctx.fillStyle = "rgba(152, 184, 120, 0.28)";
      ctx.fillRect(zoneX, barY, barW * 0.24, barH);
      const fillWidth = clamp(batch.maturity / 112, 0, 1) * barW;
      roundedRect(ctx, barX, barY, fillWidth, barH, 3);
      ctx.fillStyle = over ? "#d66c54" : ready ? "#a6c27e" : "#d5a45d";
      ctx.fill();
      ctx.fillStyle = "rgba(255, 241, 213, 0.66)";
      ctx.font = "700 9px Warm Oven Sans, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(`${Math.round(batch.maturity)}%`, cardX + cardW - 13, barY + 7);
      ctx.textAlign = "left";

      ctx.fillStyle = "rgba(235, 214, 183, 0.48)";
      ctx.font = "8.5px Warm Oven Sans, PingFang SC, sans-serif";
      let footer = "观察气泡与体积，等它刚好鼓起。";
      if (ready) footer = "轻点这一排，或按下方按钮送入烤炉。";
      if (over) footer = "发酵过度，面筋已失去支撑。";
      if (baking) footer = "炉门已关，等待表皮上色。";
      if (baked) footer = "这一批已经合格出炉。";
      ctx.fillText(footer, cardX + 14, cardY + 78);
      ctx.restore();
    }

    drawCabinetGlass(ctx, state, now) {
      ctx.save();
      roundedRect(ctx, 75, 114, 608, 488, 14);
      ctx.clip();
      const glass = ctx.createLinearGradient(80, 110, 580, 600);
      glass.addColorStop(0, "rgba(255, 247, 224, 0.045)");
      glass.addColorStop(0.4, "rgba(255, 255, 255, 0.008)");
      glass.addColorStop(1, "rgba(129, 183, 188, 0.025)");
      ctx.fillStyle = glass;
      ctx.fillRect(75, 114, 608, 488);
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = "#fff7e6";
      ctx.beginPath();
      ctx.moveTo(235, 110);
      ctx.lineTo(278, 110);
      ctx.lineTo(125, 608);
      ctx.lineTo(84, 608);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(458, 110);
      ctx.lineTo(463, 110);
      ctx.lineTo(311, 608);
      ctx.lineTo(306, 608);
      ctx.closePath();
      ctx.fill();
      if (state.climateHighlight) {
        const pulse = 0.02 + Math.sin(now * 0.0017) * 0.005;
        ctx.globalAlpha = pulse;
        ctx.fillStyle = state.climateHighlight;
        ctx.fillRect(75, 114, 608, 488);
      }
      ctx.restore();
    }

    drawOvenDynamic(ctx, state, now) {
      const oven = state.oven;
      const isBaking = oven.phase === "baking";
      const isRecovering = oven.phase === "recovering";
      const batch = state.batches.find((item) => item.id === oven.batchId);
      const progress = clamp(oven.progress || 0, 0, 1);
      const flicker = 0.86 + Math.sin(now * 0.013) * 0.07 + Math.sin(now * 0.027) * 0.04;

      ctx.save();
      roundedRect(ctx, 795, 191, 238, 235, 11);
      ctx.clip();

      const baseGlow = ctx.createRadialGradient(914, 385, 8, 914, 350, 148);
      if (isRecovering) {
        baseGlow.addColorStop(0, "rgba(114, 166, 174, 0.27)");
        baseGlow.addColorStop(0.55, "rgba(69, 94, 98, 0.12)");
        baseGlow.addColorStop(1, "rgba(20, 20, 20, 0)");
      } else if (isBaking) {
        baseGlow.addColorStop(0, `rgba(255, 148, 59, ${0.58 * flicker})`);
        baseGlow.addColorStop(0.44, "rgba(207, 81, 34, 0.27)");
        baseGlow.addColorStop(1, "rgba(28, 18, 14, 0)");
      } else {
        baseGlow.addColorStop(0, "rgba(183, 88, 41, 0.19)");
        baseGlow.addColorStop(0.6, "rgba(87, 48, 32, 0.08)");
        baseGlow.addColorStop(1, "rgba(23, 18, 16, 0)");
      }
      ctx.fillStyle = baseGlow;
      ctx.fillRect(795, 191, 238, 235);

      this.drawOvenStones(ctx);

      if (isBaking) {
        this.drawOvenFire(ctx, now, 0.7 + progress * 0.3);
        this.drawOvenLoaf(ctx, batch, 914, 405, progress, now);
        for (let steam = 0; steam < 4; steam += 1) {
          const phase = (now * 0.00018 + steam * 0.23) % 1;
          this.drawSteam(ctx, 878 + steam * 23, 351 - phase * 66, 2 + steam, phase);
        }
      } else if (isRecovering) {
        ctx.globalAlpha = 0.52;
        for (let line = 0; line < 4; line += 1) {
          const phase = (now * 0.00032 + line * 0.2) % 1;
          ctx.strokeStyle = "rgba(149, 200, 204, 0.5)";
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(917, 365, 40 + line * 21 + phase * 8, Math.PI * 1.1, Math.PI * 1.9);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = "rgba(177, 215, 215, 0.72)";
        ctx.font = "700 9px Warm Oven Sans, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("炉温恢复中", 914, 344);
        ctx.textAlign = "left";
      } else {
        this.drawOvenFire(ctx, now, 0.2);
        ctx.strokeStyle = "rgba(236, 192, 128, 0.28)";
        ctx.lineWidth = 1.4;
        ctx.setLineDash([4, 5]);
        ctx.beginPath();
        ctx.ellipse(914, 405, 74, 19, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(235, 203, 155, 0.58)";
        ctx.font = "italic 11px Warm Oven Serif, Georgia, serif";
        ctx.textAlign = "center";
        ctx.fillText("stone ready", 914, 385);
        ctx.textAlign = "left";
      }

      const glassSheen = ctx.createLinearGradient(800, 190, 1028, 423);
      glassSheen.addColorStop(0, "rgba(255, 255, 255, 0.16)");
      glassSheen.addColorStop(0.25, "rgba(255, 255, 255, 0.015)");
      glassSheen.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = glassSheen;
      ctx.fillRect(795, 191, 238, 235);
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = "rgba(235, 201, 152, 0.18)";
      ctx.lineWidth = 1;
      roundedRect(ctx, 803, 199, 222, 219, 7);
      ctx.stroke();
      ctx.restore();

      if (isBaking || isRecovering) {
        const lineY = 442;
        ctx.fillStyle = "rgba(255, 246, 225, 0.1)";
        roundedRect(ctx, 817, lineY, 196, 4, 2);
        ctx.fill();
        roundedRect(ctx, 817, lineY, 196 * progress, 4, 2);
        ctx.fillStyle = isRecovering ? "#82aeb5" : "#e0944e";
        ctx.fill();
        ctx.fillStyle = "rgba(255, 237, 204, 0.7)";
        ctx.font = "700 10px Warm Oven Sans, monospace";
        ctx.textAlign = "center";
        ctx.fillText(
          isRecovering ? `回温 ${Math.max(0, oven.remaining).toFixed(1)}s` : `烘烤 ${Math.max(0, oven.remaining).toFixed(1)}s`,
          914,
          441
        );
        ctx.textAlign = "left";
      }

      ctx.save();
      ctx.fillStyle = "rgba(238, 202, 144, 0.58)";
      ctx.font = "700 8px Warm Oven Sans, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("STONE DECK  ·  240°C", 914, 141);
      ctx.textAlign = "left";
      ctx.restore();

      if (isBaking) {
        for (let puff = 0; puff < 3; puff += 1) {
          const phase = (now * 0.0002 + puff * 0.3) % 1;
          this.drawSteam(ctx, 891 + puff * 23, 165 - phase * 25, 2, phase);
        }
      }
    }

    drawOvenStones(ctx) {
      ctx.save();
      ctx.fillStyle = "rgba(63, 48, 39, 0.52)";
      ctx.fillRect(795, 399, 238, 27);
      ctx.strokeStyle = "rgba(202, 164, 116, 0.15)";
      ctx.lineWidth = 1;
      for (let x = 813; x < 1030; x += 27) {
        ctx.beginPath();
        ctx.moveTo(x, 400);
        ctx.lineTo(x + 9, 426);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawOvenFire(ctx, now, strength) {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      for (let flame = 0; flame < 8; flame += 1) {
        const x = 842 + flame * 20;
        const wave = Math.sin(now * 0.009 + flame * 1.7) * 5;
        const height = (18 + (flame % 4) * 8) * strength;
        const gradient = ctx.createLinearGradient(x, 401, x, 401 - height);
        gradient.addColorStop(0, "rgba(255, 212, 106, 0.1)");
        gradient.addColorStop(0.48, "rgba(255, 142, 57, 0.32)");
        gradient.addColorStop(1, "rgba(255, 90, 31, 0)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(x - 8, 400);
        ctx.quadraticCurveTo(x - 4 + wave, 382, x + wave, 401 - height);
        ctx.quadraticCurveTo(x + 10 + wave, 385, x + 8, 400);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    drawOvenLoaf(ctx, batch, cx, baseY, progress, now) {
      const config = batch ? batch.config : { color: "#cf9557", highlight: "#eec27f", shadow: "#9c6235" };
      const lift = Math.sin(now * 0.005) * 1.2;
      const width = 121 + progress * 5;
      const height = 43 + progress * 12;
      const bottom = baseY - 2 + lift;
      const left = cx - width / 2;
      const right = cx + width / 2;
      const top = bottom - height;

      ctx.save();
      ctx.fillStyle = "rgba(19, 13, 10, 0.35)";
      ctx.beginPath();
      ctx.ellipse(cx, bottom + 3, width * 0.48, 8, 0, 0, Math.PI * 2);
      ctx.fill();

      const loaf = ctx.createLinearGradient(left, top, right, bottom);
      loaf.addColorStop(0, config.highlight);
      loaf.addColorStop(0.35, config.color);
      loaf.addColorStop(0.86, config.shadow);
      loaf.addColorStop(1, "#714129");
      ctx.fillStyle = loaf;
      ctx.beginPath();
      ctx.moveTo(left, bottom - 6);
      ctx.bezierCurveTo(left + 3, bottom - height * 0.7, cx - width * 0.35, top, cx, top);
      ctx.bezierCurveTo(cx + width * 0.35, top, right - 3, bottom - height * 0.7, right, bottom - 6);
      ctx.quadraticCurveTo(cx, bottom + 8, left, bottom - 6);
      ctx.fill();

      ctx.strokeStyle = "rgba(94, 48, 23, 0.64)";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      [-1, 0, 1].forEach((score) => {
        const sx = cx + score * 25;
        ctx.beginPath();
        ctx.moveTo(sx - 15, top + height * 0.42);
        ctx.quadraticCurveTo(sx, top + height * 0.28, sx + 15, top + height * 0.42);
        ctx.stroke();
      });

      ctx.globalAlpha = 0.26;
      ctx.fillStyle = "#fff0c5";
      ctx.beginPath();
      ctx.ellipse(cx - width * 0.18, top + height * 0.24, width * 0.2, 5, -0.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    drawSteam(ctx, x, y, size, phase) {
      ctx.save();
      ctx.globalAlpha = (1 - phase) * 0.26;
      ctx.strokeStyle = "rgba(255, 239, 210, 0.8)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y + 15);
      ctx.bezierCurveTo(x - 7 * size, y + 8, x + 8 * size, y + 2, x - 2, y - 5);
      ctx.stroke();
      ctx.restore();
    }

    drawCounterGlow(ctx, now) {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const glow = ctx.createRadialGradient(914, 530, 10, 914, 560, 205);
      glow.addColorStop(0, `rgba(229, 137, 62, ${0.055 + Math.sin(now * 0.002) * 0.01})`);
      glow.addColorStop(1, "rgba(229, 137, 62, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(680, 360, 440, 340);
      ctx.restore();
    }

    setHovered(id) {
      this.hoveredBatch = id;
      this.canvas.style.cursor = id ? "pointer" : "default";
    }
  }

  window.Bakery = window.Bakery || {};
  window.Bakery.Renderer = BakeryRenderer;
})();
