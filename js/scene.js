(() => {
  "use strict";

  const E = window.NeonEngine;
  const { SCENE, SIGN, clamp, hash, positiveMod } = E;
  const LAYER_SCALE = 2;

  const roundRect = (ctx, x, y, w, h, radius) => {
    const r = Math.min(radius, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  function fitWorld(ctx, width, height) {
    const scale = Math.min(width / SCENE.width, height / SCENE.height);
    const offsetX = (width - SCENE.width * scale) / 2;
    const offsetY = (height - SCENE.height * scale) / 2;
    ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
    return { scale, offsetX, offsetY };
  }

  function letterSpacedText(ctx, text, x, y, spacing) {
    const chars = Array.from(text);
    const widths = chars.map((char) => ctx.measureText(char).width);
    const total = widths.reduce((sum, width) => sum + width, 0) + spacing * (chars.length - 1);
    let cursor = x - total / 2;
    chars.forEach((char, index) => {
      ctx.fillText(char, cursor, y);
      cursor += widths[index] + spacing;
    });
  }

  function createRenderer(canvas) {
    const ctx = canvas.getContext("2d", { alpha: false });
    const background = document.createElement("canvas");
    const bgCtx = background.getContext("2d", { alpha: false });
    const signLayer = document.createElement("canvas");
    const signCtx = signLayer.getContext("2d");
    signLayer.width = SIGN.w * LAYER_SCALE;
    signLayer.height = SIGN.h * LAYER_SCALE;
    let viewport = { width: 1, height: 1, dpr: 1, ready: false };

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (
        viewport.ready &&
        viewport.width === width &&
        viewport.height === height
      ) {
        return;
      }

      canvas.width = width;
      canvas.height = height;
      background.width = width;
      background.height = height;
      viewport = { width, height, dpr, ready: true };
      bgCtx.setTransform(1, 0, 0, 1, 0, 0);
      bgCtx.clearRect(0, 0, width, height);
      fitWorld(bgCtx, width, height);
      drawBackdrop(bgCtx);
      bgCtx.setTransform(1, 0, 0, 1, 0, 0);
    }

    function updateSignLayer(text, letters, time) {
      signCtx.setTransform(1, 0, 0, 1, 0, 0);
      signCtx.clearRect(0, 0, signLayer.width, signLayer.height);
      signCtx.setTransform(LAYER_SCALE, 0, 0, LAYER_SCALE, 0, 0);
      signCtx.save();
      signCtx.beginPath();
      signCtx.rect(0, 0, SIGN.w, SIGN.h);
      signCtx.clip();
      E.drawTubeSign(signCtx, text, letters, time);
      signCtx.restore();
    }

    function render(state) {
      if (!viewport.ready) {
        resize();
      }

      updateSignLayer(state.text, state.letters, state.time);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(background, 0, 0);
      fitWorld(ctx, viewport.width, viewport.height);
      drawAtmosphere(ctx, state.time);
      drawRain(ctx, state.time);
      drawBounceLight(ctx, state.text, state.letters, state.time);
      drawReflection(ctx, signLayer);
      ctx.drawImage(
        signLayer,
        0, 0, signLayer.width, signLayer.height,
        SIGN.x, SIGN.y, SIGN.w, SIGN.h
      );
      drawWallBounce(ctx, state.text, state.letters, state.time);
      drawSelection(ctx, state.text, state.time, state.selectedIndex);
      drawForeground(ctx, state.time, state.text, state.letters);
      drawVignette(ctx);
      drawScanTexture(ctx, state.time);
    }

    function renderScene(targetCtx, width, height, state) {
      targetCtx.setTransform(1, 0, 0, 1, 0, 0);
      targetCtx.clearRect(0, 0, width, height);
      fitWorld(targetCtx, width, height);
      drawBackdrop(targetCtx);
      updateSignLayer(state.text, state.letters, state.time);
      drawAtmosphere(targetCtx, state.time);
      drawRain(targetCtx, state.time);
      drawBounceLight(targetCtx, state.text, state.letters, state.time);
      drawReflection(targetCtx, signLayer);
      targetCtx.drawImage(
        signLayer,
        0, 0, signLayer.width, signLayer.height,
        SIGN.x, SIGN.y, SIGN.w, SIGN.h
      );
      drawWallBounce(targetCtx, state.text, state.letters, state.time);
      drawSelection(targetCtx, state.text, state.time, state.selectedIndex);
      drawForeground(targetCtx, state.time, state.text, state.letters);
      drawVignette(targetCtx);
      drawScanTexture(targetCtx, state.time);
    }

    return {
      resize,
      render,
      renderScene,
      getViewport: () => ({ ...viewport })
    };
  }

  E.LAYER_SCALE = LAYER_SCALE;
  E.createRenderer = createRenderer;

  function drawReflection(ctx, signLayer) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(22, SCENE.streetY + 1, SCENE.width - 44, SCENE.height - SCENE.streetY);
    ctx.clip();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.28;
    ctx.filter = "blur(3px) saturate(1.25)";
    ctx.translate(SIGN.x + SIGN.w * 0.018, 650);
    ctx.scale(0.965, -0.64);
    ctx.drawImage(
      signLayer,
      0, 0, signLayer.width, signLayer.height,
      0, 0, SIGN.w, SIGN.h
    );
    ctx.restore();
  }

  function drawSelection(ctx, text, time, selectedIndex) {
    if (selectedIndex < 0) {
      return;
    }
    const layouts = E.getSignLayouts(text);
    const layout = layouts[selectedIndex];
    if (!layout) {
      return;
    }
    const pulse = 0.72 + Math.sin(time * 4.2) * 0.2;
    const x = SIGN.x + layout.x;
    const y = SIGN.y + layout.y;
    const w = layout.glyphWidth;
    const h = layout.scale;
    const tick = 7;

    ctx.save();
    ctx.strokeStyle = `rgba(255, 188, 91, ${pulse * 0.48})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 9, y + tick);
    ctx.lineTo(x - 9, y);
    ctx.lineTo(x - 9 + tick, y);
    ctx.moveTo(x + w + 9 - tick, y);
    ctx.lineTo(x + w + 9, y);
    ctx.lineTo(x + w + 9, y + tick);
    ctx.moveTo(x - 9, y + h - tick);
    ctx.lineTo(x - 9, y + h);
    ctx.lineTo(x - 9 + tick, y + h);
    ctx.moveTo(x + w + 9 - tick, y + h);
    ctx.lineTo(x + w + 9, y + h);
    ctx.lineTo(x + w + 9, y + h - tick);
    ctx.stroke();
    ctx.fillStyle = `rgba(255, 190, 101, ${pulse * 0.34})`;
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h + 11, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBackdrop(ctx) {
    const sky = ctx.createLinearGradient(0, 0, 0, SCENE.height);
    sky.addColorStop(0, "#05080d");
    sky.addColorStop(0.48, "#090d13");
    sky.addColorStop(0.7, "#080b0f");
    sky.addColorStop(1, "#030506");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, SCENE.width, SCENE.height);

    const ambient = ctx.createRadialGradient(655, 196, 20, 655, 196, 590);
    ambient.addColorStop(0, "rgba(126, 54, 112, 0.16)");
    ambient.addColorStop(0.35, "rgba(70, 45, 90, 0.08)");
    ambient.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = ambient;
    ctx.fillRect(0, 0, SCENE.width, 580);

    const cyanHaze = ctx.createRadialGradient(1090, 285, 10, 1090, 285, 320);
    cyanHaze.addColorStop(0, "rgba(45, 150, 180, 0.08)");
    cyanHaze.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = cyanHaze;
    ctx.fillRect(650, 0, 630, 560);

    drawWall(ctx);
    drawSignBoard(ctx);
    drawStorefront(ctx);
    drawStreetBase(ctx);
  }

  function drawWall(ctx) {
    const wall = ctx.createLinearGradient(0, 0, 0, 520);
    wall.addColorStop(0, "#11161d");
    wall.addColorStop(0.55, "#10141a");
    wall.addColorStop(1, "#0a0e13");
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, SCENE.width, 520);

    ctx.save();
    ctx.globalAlpha = 0.54;
    ctx.strokeStyle = "rgba(130, 143, 159, 0.085)";
    ctx.lineWidth = 0.65;
    const brickH = 18;
    const brickW = 62;
    for (let row = 0; row < 29; row += 1) {
      const y = 4 + row * brickH;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(SCENE.width, y);
      ctx.stroke();
      const offset = row % 2 === 0 ? 0 : brickW / 2;
      for (let x = offset; x < SCENE.width; x += brickW) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + brickH);
        ctx.stroke();
      }
    }
    ctx.restore();

    const damp = ctx.createLinearGradient(0, 240, 0, 520);
    damp.addColorStop(0, "rgba(6, 10, 14, 0)");
    damp.addColorStop(1, "rgba(3, 6, 9, 0.72)");
    ctx.fillStyle = damp;
    ctx.fillRect(0, 240, SCENE.width, 280);

    ctx.strokeStyle = "rgba(145, 151, 160, 0.11)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(34, 0);
    ctx.lineTo(34, 505);
    ctx.moveTo(1246, 0);
    ctx.lineTo(1246, 505);
    ctx.stroke();

    ctx.strokeStyle = "rgba(5, 8, 11, 0.9)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(34, 0);
    ctx.lineTo(34, 505);
    ctx.moveTo(1246, 0);
    ctx.lineTo(1246, 505);
    ctx.stroke();

    for (const x of [34, 1246]) {
      for (let y = 34; y < 490; y += 78) {
        ctx.fillStyle = "#1a2028";
        roundRect(ctx, x - 7, y, 14, 8, 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
        ctx.fillRect(x - 4, y + 2, 8, 1);
      }
    }

    ctx.strokeStyle = "rgba(3, 5, 8, 0.9)";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(0, 27);
    ctx.bezierCurveTo(330, 48, 890, 14, 1280, 39);
    ctx.moveTo(0, 45);
    ctx.bezierCurveTo(420, 31, 780, 52, 1280, 24);
    ctx.stroke();

    ctx.fillStyle = "rgba(4, 7, 10, 0.86)";
    ctx.fillRect(0, 0, SCENE.width, 15);
    ctx.fillStyle = "rgba(210, 220, 235, 0.045)";
    ctx.fillRect(0, 14, SCENE.width, 1);
  }

  function drawSignBoard(ctx) {
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    roundRect(ctx, SIGN.x - 18, SIGN.y - 15, SIGN.w + 36, SIGN.h + 32, 12);
    ctx.fill();

    const frame = ctx.createLinearGradient(SIGN.x, SIGN.y, SIGN.x, SIGN.y + SIGN.h);
    frame.addColorStop(0, "#24252a");
    frame.addColorStop(0.04, "#0b0d12");
    frame.addColorStop(0.92, "#090b0f");
    frame.addColorStop(1, "#22242a");
    ctx.fillStyle = frame;
    roundRect(ctx, SIGN.x - 12, SIGN.y - 12, SIGN.w + 24, SIGN.h + 24, 9);
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 208, 139, 0.2)";
    ctx.lineWidth = 1;
    roundRect(ctx, SIGN.x - 9, SIGN.y - 9, SIGN.w + 18, SIGN.h + 18, 7);
    ctx.stroke();

    const panel = ctx.createLinearGradient(SIGN.x, SIGN.y, SIGN.x + SIGN.w, SIGN.y + SIGN.h);
    panel.addColorStop(0, "#101319");
    panel.addColorStop(0.3, "#17151a");
    panel.addColorStop(0.62, "#12151b");
    panel.addColorStop(1, "#0b0e13");
    ctx.fillStyle = panel;
    roundRect(ctx, SIGN.x, SIGN.y, SIGN.w, SIGN.h, 5);
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.055)";
    ctx.lineWidth = 1;
    roundRect(ctx, SIGN.x + 5, SIGN.y + 5, SIGN.w - 10, SIGN.h - 10, 3);
    ctx.stroke();

    const topSheen = ctx.createLinearGradient(0, SIGN.y, 0, SIGN.y + 62);
    topSheen.addColorStop(0, "rgba(255, 255, 255, 0.055)");
    topSheen.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = topSheen;
    ctx.fillRect(SIGN.x + 6, SIGN.y + 6, SIGN.w - 12, 56);

    for (const [x, y] of [
      [SIGN.x + 16, SIGN.y + 16],
      [SIGN.x + SIGN.w - 16, SIGN.y + 16],
      [SIGN.x + 16, SIGN.y + SIGN.h - 16],
      [SIGN.x + SIGN.w - 16, SIGN.y + SIGN.h - 16]
    ]) {
      ctx.fillStyle = "#06080b";
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
      ctx.fillRect(x - 2.5, y - 2.5, 2, 2);
    }

    ctx.font = "600 8px ui-monospace, monospace";
    ctx.fillStyle = "rgba(221, 217, 203, 0.31)";
    ctx.textAlign = "left";
    ctx.fillText("SUNDOWN MOTOR INN", SIGN.x + 26, SIGN.y + 22);
    ctx.textAlign = "right";
    ctx.fillText("EST. 1987  /  UNIT 03", SIGN.x + SIGN.w - 26, SIGN.y + 22);
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(229, 205, 166, 0.36)";
    letterSpacedText(ctx, "ALL NIGHT SERVICE", SIGN.x + SIGN.w / 2, SIGN.y + SIGN.h - 15, 2.6);
    ctx.textAlign = "left";

    ctx.strokeStyle = "rgba(255, 183, 77, 0.13)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(SIGN.x + 150, SIGN.y + SIGN.h - 19);
    ctx.lineTo(SIGN.x + 250, SIGN.y + SIGN.h - 19);
    ctx.moveTo(SIGN.x + SIGN.w - 250, SIGN.y + SIGN.h - 19);
    ctx.lineTo(SIGN.x + SIGN.w - 150, SIGN.y + SIGN.h - 19);
    ctx.stroke();
    ctx.restore();
  }

  function drawStorefront(ctx) {
    ctx.fillStyle = "#090c10";
    ctx.fillRect(0, 340, SCENE.width, 164);

    const canopy = ctx.createLinearGradient(0, 338, 0, 358);
    canopy.addColorStop(0, "#1b2027");
    canopy.addColorStop(0.22, "#0a0d12");
    canopy.addColorStop(1, "#05070a");
    ctx.fillStyle = canopy;
    ctx.fillRect(64, 338, 1152, 20);
    ctx.fillStyle = "rgba(255, 187, 92, 0.14)";
    ctx.fillRect(86, 357, 1108, 1);

    const bays = [
      { x: 92, w: 280, warm: true, label: "LOBBY" },
      { x: 391, w: 228, warm: false, label: "NIGHT DESK" },
      { x: 638, w: 298, warm: true, label: "ROOMS 01—12" },
      { x: 955, w: 233, warm: false, label: "EXIT" }
    ];

    bays.forEach((bay, index) => {
      const glass = ctx.createLinearGradient(bay.x, 372, bay.x + bay.w, 470);
      if (bay.warm) {
        glass.addColorStop(0, "rgba(60, 43, 27, 0.78)");
        glass.addColorStop(0.48, "rgba(94, 61, 30, 0.5)");
        glass.addColorStop(1, "rgba(16, 19, 21, 0.94)");
      } else {
        glass.addColorStop(0, "rgba(21, 38, 43, 0.82)");
        glass.addColorStop(0.55, "rgba(22, 29, 33, 0.74)");
        glass.addColorStop(1, "rgba(9, 12, 15, 0.96)");
      }
      ctx.fillStyle = "#05070a";
      ctx.fillRect(bay.x - 5, 366, bay.w + 10, 116);
      ctx.fillStyle = glass;
      ctx.fillRect(bay.x, 371, bay.w, 105);

      const interior = ctx.createRadialGradient(
        bay.x + bay.w * (0.4 + index * 0.03),
        402,
        4,
        bay.x + bay.w * 0.5,
        430,
        bay.w * 0.62
      );
      interior.addColorStop(0, bay.warm ? "rgba(255, 173, 80, 0.22)" : "rgba(91, 201, 219, 0.11)");
      interior.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = interior;
      ctx.fillRect(bay.x, 371, bay.w, 105);

      ctx.strokeStyle = "rgba(4, 7, 9, 0.92)";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(bay.x + bay.w / 2, 371);
      ctx.lineTo(bay.x + bay.w / 2, 476);
      ctx.moveTo(bay.x, 425);
      ctx.lineTo(bay.x + bay.w, 425);
      ctx.stroke();

      ctx.strokeStyle = "rgba(207, 224, 232, 0.16)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bay.x + 10, 374);
      ctx.lineTo(bay.x + 10, 472);
      ctx.moveTo(bay.x + bay.w - 10, 374);
      ctx.lineTo(bay.x + bay.w - 10, 472);
      ctx.stroke();

      ctx.font = "600 7px ui-monospace, monospace";
      ctx.fillStyle = "rgba(230, 216, 190, 0.28)";
      ctx.textAlign = "left";
      ctx.fillText(bay.label, bay.x + 12, 464);
    });

    ctx.fillStyle = "#070a0e";
    ctx.fillRect(58, 479, 1164, 17);
    ctx.fillStyle = "rgba(210, 219, 226, 0.08)";
    ctx.fillRect(58, 479, 1164, 1);

    const exitGlow = ctx.createRadialGradient(1071, 416, 2, 1071, 416, 80);
    exitGlow.addColorStop(0, "rgba(61, 182, 195, 0.23)");
    exitGlow.addColorStop(1, "rgba(61, 182, 195, 0)");
    ctx.fillStyle = exitGlow;
    ctx.fillRect(990, 340, 170, 150);
    ctx.font = "600 9px ui-monospace, monospace";
    ctx.fillStyle = "rgba(126, 239, 230, 0.55)";
    ctx.textAlign = "center";
    ctx.fillText("EXIT", 1071, 392);
    ctx.textAlign = "left";
  }

  function drawStreetBase(ctx) {
    const sidewalk = ctx.createLinearGradient(0, 486, 0, 550);
    sidewalk.addColorStop(0, "#13181d");
    sidewalk.addColorStop(0.45, "#0d1115");
    sidewalk.addColorStop(1, "#090c10");
    ctx.fillStyle = sidewalk;
    ctx.fillRect(0, 486, SCENE.width, 68);

    ctx.strokeStyle = "rgba(194, 213, 224, 0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 489);
    ctx.lineTo(SCENE.width, 489);
    ctx.stroke();

    ctx.strokeStyle = "rgba(119, 135, 149, 0.09)";
    for (let x = -120; x < SCENE.width + 160; x += 118) {
      ctx.beginPath();
      ctx.moveTo(x, 490);
      ctx.lineTo(x + 75, 552);
      ctx.stroke();
    }
    for (let y = 507; y < 551; y += 15) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(SCENE.width, y);
      ctx.stroke();
    }

    const curb = ctx.createLinearGradient(0, 550, 0, 573);
    curb.addColorStop(0, "#222930");
    curb.addColorStop(0.28, "#10151a");
    curb.addColorStop(1, "#06090c");
    ctx.fillStyle = curb;
    ctx.fillRect(0, 551, SCENE.width, 23);
    ctx.fillStyle = "rgba(218, 225, 230, 0.13)";
    ctx.fillRect(0, 551, SCENE.width, 1);

    const road = ctx.createLinearGradient(0, 570, 0, SCENE.height);
    road.addColorStop(0, "#11151a");
    road.addColorStop(0.35, "#0b0e12");
    road.addColorStop(1, "#030506");
    ctx.fillStyle = road;
    ctx.fillRect(0, 570, SCENE.width, 150);

    ctx.strokeStyle = "rgba(5, 8, 11, 0.7)";
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 12; i += 1) {
      const x = 30 + i * 116;
      ctx.beginPath();
      ctx.moveTo(x, 574);
      ctx.lineTo(x - 22, 720);
      ctx.stroke();
    }

    ctx.save();
    ctx.filter = "blur(8px)";
    const wetPatches = [
      [195, 635, 250, 45, "rgba(109, 30, 103, 0.13)"],
      [930, 606, 280, 42, "rgba(26, 109, 122, 0.12)"],
      [640, 688, 410, 52, "rgba(160, 104, 33, 0.08)"]
    ];
    for (const [x, y, w, h, color] of wetPatches) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(x, y, w / 2, h / 2, -0.03, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.fillStyle = "rgba(220, 226, 230, 0.08)";
    for (let i = 0; i < 42; i += 1) {
      const x = hash(i * 2.3) * SCENE.width;
      const y = 580 + hash(i * 5.7) * 128;
      ctx.fillRect(x, y, 1 + hash(i) * 2, 0.6);
    }

    ctx.fillStyle = "rgba(255, 220, 160, 0.12)";
    ctx.fillRect(40, 620, 100, 2);
    ctx.fillRect(79, 676, 58, 2);
    ctx.fillRect(1120, 650, 118, 2);
  }

  function drawAtmosphere(ctx, time) {
    const drift = Math.sin(time * 0.33) * 28;
    const fog = ctx.createLinearGradient(0, 405, 0, 665);
    fog.addColorStop(0, "rgba(107, 124, 139, 0)");
    fog.addColorStop(0.45, "rgba(108, 124, 137, 0.035)");
    fog.addColorStop(0.72, "rgba(118, 130, 140, 0.048)");
    fog.addColorStop(1, "rgba(82, 93, 105, 0)");
    ctx.fillStyle = fog;
    ctx.beginPath();
    ctx.ellipse(640 + drift, 566, 760, 122, 0, 0, Math.PI * 2);
    ctx.fill();

    const lowMist = ctx.createRadialGradient(1080 - drift, 570, 20, 1080 - drift, 570, 290);
    lowMist.addColorStop(0, "rgba(78, 104, 116, 0.06)");
    lowMist.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = lowMist;
    ctx.fillRect(700, 450, 580, 270);
  }

  function drawRain(ctx, time) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.lineCap = "round";
    for (let i = 0; i < 74; i += 1) {
      const speed = 92 + hash(i + 3) * 92;
      const x = positiveMod(hash(i * 1.71) * 1450 + time * 23, 1460) - 90;
      const y = positiveMod(hash(i * 3.17 + 9) * 820 + time * speed, 860) - 80;
      const length = 5 + hash(i * 7.3) * 15;
      ctx.strokeStyle = `rgba(180, 202, 220, ${0.035 + hash(i + 22) * 0.075})`;
      ctx.lineWidth = 0.55 + hash(i + 12) * 0.45;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - length * 0.24, y + length);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBounceLight(ctx, text, letters, time) {
    const layouts = E.getSignLayouts(text);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    layouts.forEach((layout, index) => {
      const state = E.sampleLetter(letters[index] || E.DEFAULTS[index], time, index);
      const x = SIGN.x + layout.x + layout.glyphWidth / 2;
      const y = SIGN.y + layout.y + layout.scale / 2;
      const radius = layout.glyphWidth * 1.25;
      const glow = ctx.createRadialGradient(x, y, 1, x, y, radius);
      glow.addColorStop(0, `hsla(${state.hue}, 100%, 66%, ${0.035 + state.energy * 0.04})`);
      glow.addColorStop(0.55, `hsla(${state.hue}, 100%, 58%, ${0.012 + state.energy * 0.018})`);
      glow.addColorStop(1, "hsla(0, 0%, 0%, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    });
    ctx.restore();
  }

  function drawWallBounce(ctx, text, letters, time) {
    const layouts = E.getSignLayouts(text);
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    layouts.forEach((layout, index) => {
      const state = E.sampleLetter(letters[index] || E.DEFAULTS[index], time, index);
      const x = SIGN.x + layout.x + layout.glyphWidth / 2;
      const y = SIGN.y + layout.scale + 54;
      const radius = 84 + state.energy * 46;
      const glow = ctx.createRadialGradient(x, y, 1, x, y, radius);
      glow.addColorStop(0, `hsla(${state.hue}, 95%, 61%, ${0.025 + state.energy * 0.028})`);
      glow.addColorStop(1, "hsla(0, 0%, 0%, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    });
    ctx.restore();
  }

  function drawForeground(ctx, time, text, letters) {
    const layouts = E.getSignLayouts(text);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, SCENE.streetY, SCENE.width, SCENE.height - SCENE.streetY);
    ctx.clip();
    ctx.globalCompositeOperation = "screen";

    layouts.forEach((layout, index) => {
      const state = E.sampleLetter(letters[index] || E.DEFAULTS[index], time, index);
      const baseX = SIGN.x + layout.x + layout.glyphWidth / 2;
      for (let band = 0; band < 3; band += 1) {
        const y = 500 + band * 17 + hash(index * 9 + band) * 9;
        const width = 28 + hash(index * 5 + band) * 58;
        const offset = Math.sin(time * 0.75 + index * 0.8 + band) * 10;
        const alpha = state.energy * (0.035 - band * 0.006);
        ctx.fillStyle = `hsla(${state.hue}, 90%, 64%, ${alpha})`;
        ctx.fillRect(baseX - width / 2 + offset, y, width, 1.2);
      }
    });

    for (let i = 0; i < 18; i += 1) {
      const x = hash(i * 4.1) * SCENE.width;
      const y = 575 + hash(i * 6.9) * 125;
      const width = 12 + hash(i * 8.3) * 84;
      const shimmer = 0.6 + 0.4 * Math.sin(time * 2.4 + i);
      ctx.fillStyle = `rgba(186, 210, 220, ${0.012 + shimmer * 0.018})`;
      ctx.fillRect(x, y, width, 0.8);
    }
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 20; i += 1) {
      const phase = positiveMod(time * 0.7 + hash(i * 4.7), 1);
      const x = 40 + hash(i * 2.11) * 1200;
      const y = 560 + hash(i * 7.13) * 145;
      const alpha = Math.sin(phase * Math.PI) * 0.12;
      ctx.strokeStyle = `rgba(197, 218, 226, ${alpha})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.ellipse(x, y, 2 + phase * 8, 0.6 + phase * 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawVignette(ctx) {
    const vignette = ctx.createRadialGradient(640, 350, 220, 640, 350, 780);
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(0.62, "rgba(0, 0, 0, 0.08)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.58)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, SCENE.width, SCENE.height);

    const floorShade = ctx.createLinearGradient(0, 660, 0, 720);
    floorShade.addColorStop(0, "rgba(0, 0, 0, 0)");
    floorShade.addColorStop(1, "rgba(0, 0, 0, 0.44)");
    ctx.fillStyle = floorShade;
    ctx.fillRect(0, 660, SCENE.width, 60);
  }

  function drawScanTexture(ctx, time) {
    ctx.save();
    ctx.globalAlpha = 0.11;
    ctx.fillStyle = "rgba(180, 200, 215, 0.09)";
    for (let y = 0; y < SCENE.height; y += 4) {
      ctx.fillRect(0, y, SCENE.width, 0.55);
    }
    const scanY = positiveMod(time * 58, SCENE.height + 80) - 40;
    const scan = ctx.createLinearGradient(0, scanY - 20, 0, scanY + 20);
    scan.addColorStop(0, "rgba(190, 225, 225, 0)");
    scan.addColorStop(0.5, "rgba(190, 225, 225, 0.045)");
    scan.addColorStop(1, "rgba(190, 225, 225, 0)");
    ctx.fillStyle = scan;
    ctx.fillRect(0, scanY - 20, SCENE.width, 40);
    ctx.restore();
  }
})();
