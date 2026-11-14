(() => {
  "use strict";

  const W = 1280;
  const H = 720;
  const PRE_ROLL = 1.2;
  const POST_ROLL = 2.4;
  const TOUR_METHODS = ["push", "wipe", "dissolve", "light"];
  const STORAGE_KEY = "kinetic-transition-params-v1";

  const METHOD_INFO = {
    push: {
      label: "推移",
      en: "PUSH",
      description: "两个场景像胶片一样同向滑动，画面始终被内容完全覆盖。",
    },
    wipe: {
      label: "擦除",
      en: "WIPE",
      description: "一条清晰的边界扫过画面，以硬朗的几何切口完成场景切换。",
    },
    dissolve: {
      label: "溶解",
      en: "DISSOLVE",
      description: "颗粒按方向阈值逐点显现，让两种视觉质地自然渗透、重组。",
    },
    light: {
      label: "光带",
      en: "LIGHT SWEEP",
      description: "一束带羽化边缘的光扫亮下一幕，边界之后立即露出新场景。",
    },
  };

  const DIRECTION_INFO = {
    right: { label: "向右", degree: "000°", x: 1, y: 0 },
    down: { label: "向下", degree: "090°", x: 0, y: 1 },
    left: { label: "向左", degree: "180°", x: -1, y: 0 },
    up: { label: "向上", degree: "270°", x: 0, y: -1 },
  };

  const state = {
    method: "push",
    duration: 2,
    direction: "right",
    progress: 0.52,
    time: PRE_ROLL + 1.04,
    playing: false,
    tourActive: false,
    tourIndex: 0,
    tourMethod: "push",
    tourReturnMethod: "push",
    ambientTime: 0,
    sound: false,
    dirty: false,
    transitionCueFired: false,
  };

  const canvas = document.getElementById("previewCanvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const sceneA = document.createElement("canvas");
  const sceneB = document.createElement("canvas");
  const maskCanvas = document.createElement("canvas");
  const dissolveStage = document.createElement("canvas");
  const lightStage = document.createElement("canvas");
  const grainCanvas = document.createElement("canvas");

  [sceneA, sceneB, maskCanvas, dissolveStage, lightStage].forEach((buffer) => {
    buffer.width = W;
    buffer.height = H;
  });
  grainCanvas.width = W;
  grainCanvas.height = H;

  const actx = sceneA.getContext("2d", { alpha: false });
  const bctx = sceneB.getContext("2d", { alpha: false });
  const mctx = maskCanvas.getContext("2d");
  const dctx = dissolveStage.getContext("2d");
  const lctx = lightStage.getContext("2d");
  const gctx = grainCanvas.getContext("2d");

  const dom = {
    saveState: document.getElementById("saveState"),
    soundToggle: document.getElementById("soundToggle"),
    exportFrame: document.getElementById("exportFrame"),
    methodGrid: document.getElementById("methodGrid"),
    activeMethodLabel: document.getElementById("activeMethodLabel"),
    methodDescription: document.getElementById("methodDescription"),
    durationRange: document.getElementById("durationRange"),
    durationValue: document.getElementById("durationValue"),
    directionLabel: document.getElementById("directionLabel"),
    directionDegrees: document.getElementById("directionDegrees"),
    directionHint: document.getElementById("directionHint"),
    previewScrub: document.getElementById("previewScrub"),
    scrubValue: document.getElementById("scrubValue"),
    bTimeLabel: document.getElementById("bTimeLabel"),
    bridgeMethod: document.getElementById("bridgeMethod"),
    bridgeDuration: document.getElementById("bridgeDuration"),
    playButton: document.getElementById("playButton"),
    playAll: document.getElementById("playAll"),
    restartButton: document.getElementById("restartButton"),
    applyPreview: document.getElementById("applyPreview"),
    saveParams: document.getElementById("saveParams"),
    timeline: document.getElementById("timeline"),
    timelineActive: document.getElementById("timelineActive"),
    timelineTransition: document.getElementById("timelineTransition"),
    timelineHead: document.getElementById("timelineHead"),
    timelineTransitionLabel: document.getElementById("timelineTransitionLabel"),
    currentTime: document.getElementById("currentTime"),
    totalTime: document.getElementById("totalTime"),
    hudProgress: document.getElementById("hudProgress"),
    hudTimecode: document.getElementById("hudTimecode"),
    hudSceneState: document.getElementById("hudSceneState"),
    canvasBadge: document.getElementById("canvasBadge"),
    canvasShell: document.getElementById("canvasShell"),
    statusText: document.getElementById("statusText"),
    toast: document.getElementById("toast"),
  };

  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (t) => t * t * (3 - 2 * t);
  const easeInOutCubic = (t) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  function circle(c, x, y, radius) {
    c.beginPath();
    c.arc(x, y, radius, 0, Math.PI * 2);
  }

  function roundRect(c, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    c.beginPath();
    c.roundRect(x, y, width, height, r);
  }

  function seededRandom(seed) {
    let value = seed >>> 0;
    return () => {
      value = (value * 1664525 + 1013904223) >>> 0;
      return value / 4294967296;
    };
  }

  function buildGrain() {
    const random = seededRandom(9261);
    const image = gctx.createImageData(W, H);
    for (let i = 0; i < image.data.length; i += 4) {
      const shade = Math.floor(random() * 80 + 175);
      image.data[i] = shade;
      image.data[i + 1] = shade;
      image.data[i + 2] = shade;
      image.data[i + 3] = Math.floor(random() * 25);
    }
    gctx.putImageData(image, 0, 0);
  }

  const dissolveNoise = new Float32Array(160 * 90);
  const dissolveRandom = seededRandom(4417);
  for (let i = 0; i < dissolveNoise.length; i += 1) {
    dissolveNoise[i] = dissolveRandom();
  }
  const dissolveMask = mctx.createImageData(160, 90);
  buildGrain();

  function drawSceneA(c, t) {
    const bg = c.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#f8e7c8");
    bg.addColorStop(0.48, "#f2c09a");
    bg.addColorStop(1, "#df674f");
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);

    const sx = 873 + Math.sin(t * 0.34) * 16;
    const sy = 307 + Math.cos(t * 0.28) * 11;
    const halo = c.createRadialGradient(sx, sy, 40, sx, sy, 430);
    halo.addColorStop(0, "rgba(255, 236, 170, .7)");
    halo.addColorStop(0.3, "rgba(255, 205, 119, .2)");
    halo.addColorStop(1, "rgba(255, 181, 99, 0)");
    c.fillStyle = halo;
    c.fillRect(0, 0, W, H);

    c.save();
    c.translate(0, 38);
    c.strokeStyle = "rgba(49, 38, 32, .12)";
    c.lineWidth = 1;
    for (let i = -2; i < 10; i += 1) {
      c.beginPath();
      c.moveTo(i * 160 - 150, -40);
      c.lineTo(i * 160 + 290, H + 50);
      c.stroke();
    }
    c.restore();

    c.save();
    c.translate(sx, sy);
    c.rotate(-0.16 + Math.sin(t * 0.17) * 0.025);
    c.strokeStyle = "rgba(45, 37, 34, .45)";
    c.lineWidth = 1.4;
    c.beginPath();
    c.ellipse(0, 0, 344, 128, 0.14, 0.1, Math.PI * 1.4);
    c.stroke();
    c.strokeStyle = "rgba(255, 238, 190, .58)";
    c.beginPath();
    c.ellipse(0, 0, 307, 111, -0.2, Math.PI * 0.9, Math.PI * 1.85);
    c.stroke();

    const satelliteAngle = t * 0.42 + 0.3;
    const satelliteX = Math.cos(satelliteAngle) * 307;
    const satelliteY = Math.sin(satelliteAngle) * 111;
    c.save();
    c.translate(satelliteX, satelliteY);
    c.rotate(-0.2);
    circle(c, 0, 0, 11);
    c.fillStyle = "#2d2522";
    c.fill();
    c.fillStyle = "rgba(248, 231, 200, .7)";
    c.fillRect(-22, -1.5, 14, 3);
    c.restore();
    c.restore();

    c.save();
    c.translate(sx, sy);
    c.save();
    c.rotate(t * 0.035 - 0.12);
    c.setLineDash([2, 18]);
    c.lineWidth = 1.5;
    c.strokeStyle = "rgba(45, 37, 34, .5)";
    circle(c, 0, 0, 269);
    c.stroke();
    c.setLineDash([]);
    c.restore();

    c.lineWidth = 36;
    c.strokeStyle = "#302621";
    circle(c, 0, 0, 225);
    c.stroke();
    c.lineWidth = 8;
    c.strokeStyle = "#f7d28b";
    circle(c, 0, 0, 207);
    c.stroke();

    const orb = c.createRadialGradient(-42, -55, 10, 0, 0, 184);
    orb.addColorStop(0, "#fff0a9");
    orb.addColorStop(0.42, "#f8c768");
    orb.addColorStop(1, "#dd7252");
    circle(c, 0, 0, 185);
    c.fillStyle = orb;
    c.fill();

    c.save();
    circle(c, 0, 0, 185);
    c.clip();
    c.globalAlpha = 0.16;
    c.fillStyle = "#fff8dd";
    for (let i = -4; i < 5; i += 1) {
      c.save();
      c.rotate(-0.35);
      c.fillRect(i * 52 - 12, -240, 9, 480);
      c.restore();
    }
    c.restore();

    const eclipse = c.createRadialGradient(-38, -35, 2, 0, 0, 127);
    eclipse.addColorStop(0, "#43352c");
    eclipse.addColorStop(1, "#211c19");
    circle(c, 0, 0, 124);
    c.fillStyle = eclipse;
    c.fill();

    c.strokeStyle = "rgba(255, 228, 164, .68)";
    c.lineWidth = 1.2;
    circle(c, 0, 0, 139);
    c.stroke();

    c.save();
    c.rotate(-t * 0.025);
    for (let i = 0; i < 28; i += 1) {
      const angle = (i / 28) * Math.PI * 2;
      const inner = 247;
      const outer = i % 4 === 0 ? 270 : 258;
      c.beginPath();
      c.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      c.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      c.strokeStyle = "rgba(45, 37, 34, .5)";
      c.lineWidth = i % 4 === 0 ? 2 : 1;
      c.stroke();
    }
    c.restore();
    c.restore();

    c.save();
    c.strokeStyle = "#2d2522";
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(-30, 536);
    c.bezierCurveTo(150, 458, 294, 605, 468, 520);
    c.bezierCurveTo(606, 454, 728, 512, 826, 482);
    c.stroke();
    c.globalAlpha = 0.32;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(-20, 552);
    c.bezierCurveTo(164, 472, 306, 619, 480, 535);
    c.stroke();
    c.restore();

    c.fillStyle = "rgba(247, 232, 201, .22)";
    c.save();
    c.translate(649, 586);
    c.rotate(-0.24);
    c.fillRect(0, 0, 690, 96);
    c.restore();
    c.strokeStyle = "rgba(45, 37, 34, .17)";
    c.lineWidth = 1;
    c.save();
    c.translate(662, 606);
    c.rotate(-0.24);
    c.strokeRect(0, 0, 690, 96);
    c.restore();

    c.fillStyle = "#2d2522";
    c.font = '600 11px "Ubuntu Mono", monospace';
    c.fillText("A / 01", 68, 78);
    c.fillStyle = "rgba(45, 37, 34, .6)";
    c.font = '10px "Ubuntu Mono", monospace';
    c.fillText("PROCEDURAL FIELD — 1280 × 720", 68, 99);

    c.fillStyle = "#2d2522";
    c.font = '700 72px "Ubuntu Sans", sans-serif';
    c.fillText("SOLAR", 66, 600);
    c.fillText("CROWN", 66, 662);
    c.font = '10px "Ubuntu Mono", monospace';
    c.fillStyle = "rgba(45, 37, 34, .63)";
    c.fillText("LIGHT / ORBIT / MATTER", 70, 685);

    c.save();
    c.translate(1172, 90);
    c.rotate(Math.PI / 2);
    c.fillStyle = "rgba(45, 37, 34, .5)";
    c.font = '9px "Ubuntu Mono", monospace';
    c.fillText("FRAME 001 — SOLAR SYSTEM", 0, 0);
    c.restore();
  }

  function drawSceneB(c, t) {
    const bg = c.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#03151c");
    bg.addColorStop(0.52, "#0a343e");
    bg.addColorStop(1, "#0d5960");
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);

    const aura = c.createRadialGradient(365, 300, 20, 365, 300, 520);
    aura.addColorStop(0, "rgba(94, 234, 212, .26)");
    aura.addColorStop(0.38, "rgba(36, 160, 163, .12)");
    aura.addColorStop(1, "rgba(4, 30, 38, 0)");
    c.fillStyle = aura;
    c.fillRect(0, 0, W, H);

    c.strokeStyle = "rgba(153, 241, 226, .1)";
    c.lineWidth = 1;
    for (let x = 72; x < W; x += 72) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x - 120, H);
      c.stroke();
    }
    for (let y = 54; y < H; y += 54) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(W, y);
      c.stroke();
    }

    c.save();
    for (let i = 0; i < 8; i += 1) {
      const phase = t * (0.18 + i * 0.025) + i * 0.82;
      const baseY = 445 + i * 34;
      c.beginPath();
      c.moveTo(-80, baseY);
      c.bezierCurveTo(
        285,
        baseY + Math.sin(phase) * 74 - 50,
        620,
        baseY + Math.cos(phase * 0.8) * 55,
        1360,
        baseY - 56,
      );
      c.lineWidth = i === 2 ? 3 : 1;
      c.strokeStyle =
        i < 3 ? "rgba(117, 246, 226, .62)" : "rgba(94, 234, 212, .2)";
      c.stroke();
    }
    c.restore();

    c.save();
    c.globalCompositeOperation = "screen";
    const band = c.createLinearGradient(0, 530, W, 340);
    band.addColorStop(0, "rgba(47, 160, 155, 0)");
    band.addColorStop(0.45, "rgba(70, 221, 203, .09)");
    band.addColorStop(0.62, "rgba(190, 255, 243, .13)");
    band.addColorStop(1, "rgba(61, 183, 178, 0)");
    c.fillStyle = band;
    c.beginPath();
    c.moveTo(-40, 505);
    c.bezierCurveTo(290, 385, 556, 650, 1320, 350);
    c.lineTo(1320, 437);
    c.bezierCurveTo(540, 678, 300, 442, -40, 570);
    c.closePath();
    c.fill();
    c.restore();

    const moonX = 383 + Math.sin(t * 0.26) * 9;
    const moonY = 292 + Math.cos(t * 0.21) * 8;
    const glow = c.createRadialGradient(moonX, moonY, 80, moonX, moonY, 300);
    glow.addColorStop(0, "rgba(176, 255, 241, .22)");
    glow.addColorStop(0.55, "rgba(94, 234, 212, .08)");
    glow.addColorStop(1, "rgba(94, 234, 212, 0)");
    c.fillStyle = glow;
    c.fillRect(0, 0, W, H);

    c.save();
    c.translate(moonX, moonY);
    c.rotate(t * 0.018 - 0.04);
    c.setLineDash([4, 11]);
    c.strokeStyle = "rgba(151, 250, 232, .38)";
    c.lineWidth = 1;
    circle(c, 0, 0, 224);
    c.stroke();
    c.setLineDash([]);
    c.strokeStyle = "rgba(201, 255, 246, .22)";
    circle(c, 0, 0, 204);
    c.stroke();

    const moon = c.createRadialGradient(-46, -62, 4, 0, 0, 157);
    moon.addColorStop(0, "#f1fffb");
    moon.addColorStop(0.34, "#9aefe1");
    moon.addColorStop(0.72, "#27949a");
    moon.addColorStop(1, "#075661");
    circle(c, 0, 0, 156);
    c.fillStyle = moon;
    c.fill();

    c.save();
    circle(c, 0, 0, 156);
    c.clip();
    c.globalAlpha = 0.2;
    c.fillStyle = "#062d35";
    c.beginPath();
    c.ellipse(62, 52, 120, 55, -0.45, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.ellipse(-72, -78, 70, 27, 0.3, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "#e9fff9";
    c.globalAlpha = 0.2;
    for (let i = -2; i < 4; i += 1) {
      c.beginPath();
      c.arc(0, 0, 64 + i * 19, 0.1 + t * 0.02, Math.PI * 0.78 + t * 0.02);
      c.stroke();
    }
    c.restore();

    for (let i = 0; i < 6; i += 1) {
      const angle = t * 0.3 + (i / 6) * Math.PI * 2;
      const x = Math.cos(angle) * 227;
      const y = Math.sin(angle) * 227;
      circle(c, x, y, i === 0 ? 3 : 1.5);
      c.fillStyle = i === 0 ? "#d9ff57" : "rgba(166, 255, 240, .55)";
      c.fill();
    }
    c.restore();

    c.save();
    c.translate(975, 174);
    c.rotate(t * 0.04);
    c.strokeStyle = "rgba(199, 255, 246, .64)";
    c.lineWidth = 1;
    for (let i = 0; i < 12; i += 1) {
      c.rotate(Math.PI / 6);
      c.beginPath();
      c.moveTo(0, 17);
      c.lineTo(0, i % 2 === 0 ? 87 : 52);
      c.stroke();
    }
    c.strokeStyle = "rgba(217, 255, 87, .66)";
    circle(c, 0, 0, 20);
    c.stroke();
    circle(c, 0, 0, 4);
    c.fillStyle = "#d9ff57";
    c.fill();
    c.restore();

    c.fillStyle = "#b9fff4";
    c.font = '600 11px "Ubuntu Mono", monospace';
    c.fillText("B / 02", 68, 78);
    c.fillStyle = "rgba(185, 255, 244, .54)";
    c.font = '10px "Ubuntu Mono", monospace';
    c.fillText("TIDAL FIELD — 1280 × 720", 68, 99);

    c.fillStyle = "#d9fff8";
    c.font = '300 73px "Ubuntu Sans", sans-serif';
    c.fillText("TIDAL", 782, 595);
    c.fillText("SIGNAL", 782, 655);
    c.fillStyle = "rgba(217, 255, 248, .46)";
    c.font = '10px "Ubuntu Mono", monospace';
    c.fillText("WAVE / CURRENT / FREQUENCY", 786, 684);

    c.save();
    c.translate(1137, 558);
    for (let i = 0; i < 7; i += 1) {
      const level = 12 + Math.sin(t * 0.9 + i * 0.8) * 15 + i * 4;
      c.fillStyle = i === 6 ? "#d9ff57" : "rgba(179, 255, 242, .4)";
      c.fillRect(i * 17, -level, 5, level);
    }
    c.restore();

    c.strokeStyle = "rgba(218, 255, 249, .21)";
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(869, 119);
    c.lineTo(1213, 119);
    c.stroke();
    c.fillStyle = "rgba(185, 255, 244, .46)";
    c.font = '9px "Ubuntu Mono", monospace';
    c.fillText("SIGNAL LOCK / 02", 869, 106);

    c.save();
    c.translate(118, 236);
    c.rotate(-Math.PI / 2);
    c.fillStyle = "rgba(218, 255, 249, .42)";
    c.font = '9px "Ubuntu Mono", monospace';
    c.fillText("DEPTH 0480 — CURRENT 12.6", 0, 0);
    c.restore();
  }

  let frameCounter = 0;

  function drawPush(progress, direction) {
    const eased = easeInOutCubic(progress);
    const shiftX = direction.x * W * eased;
    const shiftY = direction.y * H * eased;
    ctx.drawImage(sceneA, shiftX, shiftY);
    ctx.drawImage(sceneB, shiftX - direction.x * W, shiftY - direction.y * H);
  }

  function drawWipe(progress, direction) {
    const eased = smoothstep(progress);
    ctx.drawImage(sceneA, 0, 0);

    ctx.save();
    ctx.beginPath();
    if (direction.x === 1) {
      ctx.rect(0, 0, W * eased, H);
    } else if (direction.x === -1) {
      ctx.rect(W - W * eased, 0, W * eased, H);
    } else if (direction.y === 1) {
      ctx.rect(0, 0, W, H * eased);
    } else {
      ctx.rect(0, H - H * eased, W, H * eased);
    }
    ctx.clip();
    ctx.drawImage(sceneB, 0, 0);
    ctx.restore();

    const x =
      direction.x === 1
        ? W * eased
        : direction.x === -1
          ? W - W * eased
          : W / 2;
    const y =
      direction.y === 1
        ? H * eased
        : direction.y === -1
          ? H - H * eased
          : H / 2;

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    if (direction.x !== 0) {
      const edgeGlow = ctx.createLinearGradient(x - 32, 0, x + 32, 0);
      edgeGlow.addColorStop(0, "rgba(217, 255, 87, 0)");
      edgeGlow.addColorStop(0.5, "rgba(217, 255, 87, .34)");
      edgeGlow.addColorStop(1, "rgba(217, 255, 87, 0)");
      ctx.fillStyle = edgeGlow;
      ctx.fillRect(x - 32, 0, 64, H);
    } else {
      const edgeGlow = ctx.createLinearGradient(0, y - 32, 0, y + 32);
      edgeGlow.addColorStop(0, "rgba(217, 255, 87, 0)");
      edgeGlow.addColorStop(0.5, "rgba(217, 255, 87, .34)");
      edgeGlow.addColorStop(1, "rgba(217, 255, 87, 0)");
      ctx.fillStyle = edgeGlow;
      ctx.fillRect(0, y - 32, W, 64);
    }
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "rgba(225, 255, 128, .82)";
    if (direction.x !== 0) {
      ctx.fillRect(x - 1, 0, 2, H);
    } else {
      ctx.fillRect(0, y - 1, W, 2);
    }
    ctx.restore();
  }

  function drawDissolve(progress, direction) {
    ctx.drawImage(sceneA, 0, 0);
    if (progress >= 1) {
      ctx.drawImage(sceneB, 0, 0);
      return;
    }
    if (progress <= 0) {
      return;
    }

    const threshold = progress * 1.18 - 0.09;
    const data = dissolveMask.data;
    for (let y = 0; y < 90; y += 1) {
      const v = y / 89;
      const factorY = direction.y === 1 ? v : direction.y === -1 ? 1 - v : -1;
      for (let x = 0; x < 160; x += 1) {
        const u = x / 159;
        const factorX = direction.x === 1 ? u : direction.x === -1 ? 1 - u : -1;
        const factor = factorX >= 0 ? factorX : factorY;
        const value = factor * 0.84 + dissolveNoise[y * 160 + x] * 0.16;
        const soft = clamp((threshold + 0.035 - value) / 0.07);
        const index = (y * 160 + x) * 4;
        data[index] = 255;
        data[index + 1] = 255;
        data[index + 2] = 255;
        data[index + 3] = Math.floor(soft * 255);
      }
    }

    mctx.clearRect(0, 0, W, H);
    mctx.putImageData(dissolveMask, 0, 0);
    dctx.globalCompositeOperation = "source-over";
    dctx.clearRect(0, 0, W, H);
    dctx.drawImage(sceneB, 0, 0);
    dctx.globalCompositeOperation = "destination-in";
    dctx.imageSmoothingEnabled = true;
    dctx.imageSmoothingQuality = "high";
    dctx.drawImage(maskCanvas, 0, 0, 160, 90, 0, 0, W, H);
    dctx.globalCompositeOperation = "source-over";
    ctx.drawImage(dissolveStage, 0, 0);

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const glowX = direction.x === 1 ? W * progress : direction.x === -1 ? W * (1 - progress) : W / 2;
    const glowY = direction.y === 1 ? H * progress : direction.y === -1 ? H * (1 - progress) : H / 2;
    const dissolveGlow = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, 180);
    dissolveGlow.addColorStop(0, "rgba(217, 255, 87, .06)");
    dissolveGlow.addColorStop(1, "rgba(217, 255, 87, 0)");
    ctx.fillStyle = dissolveGlow;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function drawLightSweep(progress, direction) {
    ctx.drawImage(sceneA, 0, 0);
    if (progress <= 0) {
      return;
    }
    if (progress >= 1) {
      ctx.drawImage(sceneB, 0, 0);
      return;
    }

    const reveal = lerp(-0.2, 1.2, smoothstep(progress));
    const feather = 0.105;
    const start = -0.2;
    const span = 1.4;
    const stopA = clamp((reveal - feather - start) / span);
    const stopB = clamp((reveal + feather - start) / span);

    mctx.clearRect(0, 0, W, H);
    if (stopB > 0) {
      let gradient;
      if (direction.x === 1) {
        gradient = mctx.createLinearGradient(-W * 0.2, 0, W * 1.2, 0);
      } else if (direction.x === -1) {
        gradient = mctx.createLinearGradient(W * 1.2, 0, -W * 0.2, 0);
      } else if (direction.y === 1) {
        gradient = mctx.createLinearGradient(0, -H * 0.2, 0, H * 1.2);
      } else {
        gradient = mctx.createLinearGradient(0, H * 1.2, 0, -H * 0.2);
      }
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(stopA, "rgba(255,255,255,1)");
      gradient.addColorStop(stopB, "rgba(255,255,255,0)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      mctx.fillStyle = gradient;
      mctx.fillRect(0, 0, W, H);

      lctx.globalCompositeOperation = "source-over";
      lctx.clearRect(0, 0, W, H);
      lctx.drawImage(sceneB, 0, 0);
      lctx.globalCompositeOperation = "destination-in";
      lctx.drawImage(maskCanvas, 0, 0);
      lctx.globalCompositeOperation = "source-over";
      ctx.drawImage(lightStage, 0, 0);
    }

    const edgeX = direction.x === 1 ? reveal * W : direction.x === -1 ? (1 - reveal) * W : W / 2;
    const edgeY = direction.y === 1 ? reveal * H : direction.y === -1 ? (1 - reveal) * H : H / 2;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    if (direction.x !== 0) {
      const sweep = ctx.createLinearGradient(edgeX - 88, 0, edgeX + 88, 0);
      sweep.addColorStop(0, "rgba(217, 255, 87, 0)");
      sweep.addColorStop(0.43, "rgba(229, 255, 171, .12)");
      sweep.addColorStop(0.5, "rgba(239, 255, 194, .46)");
      sweep.addColorStop(0.57, "rgba(229, 255, 171, .12)");
      sweep.addColorStop(1, "rgba(217, 255, 87, 0)");
      ctx.fillStyle = sweep;
      ctx.fillRect(edgeX - 88, 0, 176, H);
    } else {
      const sweep = ctx.createLinearGradient(0, edgeY - 88, 0, edgeY + 88);
      sweep.addColorStop(0, "rgba(217, 255, 87, 0)");
      sweep.addColorStop(0.43, "rgba(229, 255, 171, .12)");
      sweep.addColorStop(0.5, "rgba(239, 255, 194, .46)");
      sweep.addColorStop(0.57, "rgba(229, 255, 171, .12)");
      sweep.addColorStop(1, "rgba(217, 255, 87, 0)");
      ctx.fillStyle = sweep;
      ctx.fillRect(0, edgeY - 88, W, 176);
    }
    ctx.restore();

    ctx.save();
    for (let i = 0; i < 9; i += 1) {
      const offset = Math.sin(i * 2.7 + frameCounter * 0.03) * 24;
      const px = direction.x !== 0 ? edgeX + offset : 100 + i * 137;
      const py = direction.y !== 0 ? edgeY + offset : 70 + i * 76;
      const size = i % 3 === 0 ? 2.3 : 1.2;
      circle(ctx, px, py, size);
      ctx.fillStyle = i % 3 === 0 ? "rgba(239, 255, 194, .82)" : "rgba(217, 255, 87, .36)";
      ctx.fill();
    }
    ctx.restore();
  }

  function applyTexture() {
    ctx.save();
    ctx.globalAlpha = 0.58;
    ctx.drawImage(grainCanvas, 0, 0);
    ctx.restore();

    const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, W * 0.72);
    vignette.addColorStop(0, "rgba(4, 6, 8, 0)");
    vignette.addColorStop(0.74, "rgba(4, 6, 8, .035)");
    vignette.addColorStop(1, "rgba(4, 6, 8, .2)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }

  function renderFrame() {
    frameCounter += 1;
    const isTour = state.tourActive;
    const method = isTour ? state.tourMethod : state.method;
    const duration = state.duration;
    const time = state.time;
    const transitionProgress = clamp((time - PRE_ROLL) / duration);
    const sceneBTime = Math.max(0, time - PRE_ROLL - duration);
    const sceneATime = state.playing ? time + state.ambientTime * 0.04 : state.ambientTime + time * 0.08;
    const direction = DIRECTION_INFO[state.direction];

    drawSceneA(actx, sceneATime);
    drawSceneB(bctx, sceneBTime);

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#ead0ad";
    ctx.fillRect(0, 0, W, H);

    if (method === "push") {
      drawPush(transitionProgress, direction);
    } else if (method === "wipe") {
      drawWipe(transitionProgress, direction);
    } else if (method === "dissolve") {
      drawDissolve(transitionProgress, direction);
    } else {
      drawLightSweep(transitionProgress, direction);
    }

    applyTexture();
    updateHud(transitionProgress, sceneBTime);
  }

  function formatClock(seconds) {
    const safe = Math.max(0, seconds);
    const minutes = Math.floor(safe / 60);
    const rest = safe % 60;
    return `${String(minutes).padStart(2, "0")}:${rest.toFixed(1).padStart(4, "0")}`;
  }

  function formatTimecode(seconds) {
    const safe = Math.max(0, seconds);
    const minutes = Math.floor(safe / 60);
    const secs = Math.floor(safe % 60);
    const frames = Math.floor((safe % 1) * 60);
    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
  }

  function currentMethod() {
    return state.tourActive ? state.tourMethod : state.method;
  }

  function totalDuration() {
    return PRE_ROLL + state.duration + POST_ROLL;
  }

  function updateHud(progress, bTime) {
    const percent = Math.round(progress * 100);
    dom.hudProgress.textContent =
      progress >= 1 ? "SCENE B · 100%" : `TRANSITION ${percent}%`;
    dom.hudTimecode.textContent = formatTimecode(state.time);
    dom.hudSceneState.textContent =
      progress <= 0 ? "A ACTIVE" : progress >= 1 ? "B ACTIVE" : "A + B";
    dom.bTimeLabel.textContent = `B 时间轴 · ${bTime.toFixed(2)}s`;
    dom.scrubValue.textContent = `${percent}%`;

    if (state.tourActive) {
      const info = METHOD_INFO[state.tourMethod];
      dom.canvasBadge.innerHTML = `<i></i> 连播 ${state.tourIndex + 1}/4 · ${info.label}`;
    } else {
      dom.canvasBadge.innerHTML = state.playing
        ? "<i></i> 正在播放"
        : "<i></i> 实时预览";
    }
  }

  function updateTimeline() {
    const total = totalDuration();
    const ratio = clamp(state.time / total);
    const preRatio = PRE_ROLL / total;
    const transitionRatio = state.duration / total;
    dom.timelineActive.style.width = `${ratio * 100}%`;
    dom.timelineTransition.style.left = `${preRatio * 100}%`;
    dom.timelineTransition.style.width = `${transitionRatio * 100}%`;
    dom.timelineHead.style.left = `${ratio * 100}%`;
    dom.currentTime.textContent = formatClock(state.time);
    dom.totalTime.textContent = formatClock(total);
    dom.timelineTransitionLabel.textContent = `转场 · ${state.duration.toFixed(1)}s`;
    state.progress = clamp((state.time - PRE_ROLL) / state.duration);
    dom.previewScrub.value = String(state.progress * 100);
    dom.playButton.classList.toggle("is-playing", state.playing);
    dom.canvasShell.classList.toggle("is-playing", state.playing);
  }

  function updateMethodUI() {
    const method = currentMethod();
    const info = METHOD_INFO[method];
    const direction = DIRECTION_INFO[state.direction];
    dom.methodGrid.querySelectorAll(".method-card").forEach((card) => {
      card.classList.toggle("is-active", card.dataset.method === method);
    });
    dom.directionLabel.textContent = direction.label;
    dom.directionDegrees.textContent = direction.degree;
    dom.directionHint.textContent = `A → B · ${direction.label}`;
    dom.directionPadButtons =
      dom.directionPadButtons ||
      Array.from(document.querySelectorAll("[data-direction]"));
    dom.directionPadButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.direction === state.direction);
    });
    dom.activeMethodLabel.textContent = info.label;
    dom.methodDescription.textContent = info.description;
    dom.bridgeMethod.textContent = info.label;
    dom.bridgeDuration.textContent = `${state.duration.toFixed(1)}s`;
    dom.durationRange.value = String(state.duration);
    dom.durationValue.textContent = `${state.duration.toFixed(1)}s`;
    dom.soundToggle.setAttribute("aria-pressed", String(state.sound));
    dom.soundToggle.title = state.sound ? "关闭提示音" : "开启提示音";
    dom.previewScrub.value = String(state.progress * 100);
  }

  function markDirty() {
    state.dirty = true;
    dom.saveState.classList.add("is-saving");
    dom.saveState.innerHTML = "<i></i> 有未保存更改";
  }

  function markSaved() {
    state.dirty = false;
    dom.saveState.classList.add("is-saving");
    dom.saveState.innerHTML = "<i></i> 参数已保存";
    window.setTimeout(() => dom.saveState.classList.remove("is-saving"), 700);
  }

  function showToast(message) {
    dom.toast.querySelector("p").textContent = message;
    dom.toast.classList.add("show");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => dom.toast.classList.remove("show"), 1800);
  }

  function stopTour() {
    if (!state.tourActive) {
      return;
    }
    state.tourActive = false;
    state.playing = false;
  }

  function setPreviewProgress(value) {
    stopTour();
    state.playing = false;
    state.progress = clamp(value);
    state.time = PRE_ROLL + state.duration * state.progress;
    updateMethodUI();
    updateTimeline();
    renderFrame();
  }

  function seekToRatio(ratio) {
    stopTour();
    state.playing = false;
    state.time = clamp(ratio) * totalDuration();
    updateMethodUI();
    updateTimeline();
    renderFrame();
  }

  function beginSinglePlayback() {
    stopTour();
    state.time = 0;
    state.progress = 0;
    state.playing = true;
    state.transitionCueFired = false;
    updateMethodUI();
    updateTimeline();
    dom.statusText.textContent = "正在播放 A → B，转场结束后 B 场景从 0 秒开始。";
    playCue("start");
    renderFrame();
  }

  function beginTour() {
    resetAudioIfNeeded();
    state.tourReturnMethod = state.method;
    state.tourActive = true;
    state.tourIndex = 0;
    state.tourMethod = TOUR_METHODS[0];
    state.time = 0;
    state.progress = 0;
    state.playing = true;
    state.transitionCueFired = false;
    updateMethodUI();
    updateTimeline();
    dom.statusText.textContent = "四式连播开始 · 1/4 推移";
    playCue("start");
    renderFrame();
  }

  function completeSinglePlayback() {
    state.playing = false;
    state.time = totalDuration();
    updateTimeline();
    dom.statusText.textContent = "播放完成。B 场景从转场结束点开始计时。";
    playCue("complete");
  }

  function completeTour() {
    state.method = state.tourMethod;
    state.tourActive = false;
    state.playing = false;
    state.time = totalDuration();
    updateMethodUI();
    updateTimeline();
    markDirty();
    dom.statusText.textContent = "四种转场已完整播放，可继续调整参数或导出当前帧。";
    showToast("四式连播完成");
  }

  let audioContext = null;

  function ensureAudio() {
    if (!state.sound) {
      return null;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return null;
    }
    if (!audioContext) {
      audioContext = new AudioContextClass();
    }
    if (audioContext.state === "suspended") {
      audioContext.resume();
    }
    return audioContext;
  }

  function resetAudioIfNeeded() {
    if (state.sound) {
      ensureAudio();
    }
  }

  function playTone(frequency, duration, offset, volume, type) {
    const audio = ensureAudio();
    if (!audio) {
      return;
    }
    const start = audio.currentTime + offset;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = type || "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.08, start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  function playCue(kind) {
    if (!state.sound) {
      return;
    }
    if (kind === "start") {
      playTone(392, 0.11, 0, 0.035, "sine");
      playTone(587.33, 0.16, 0.07, 0.028, "sine");
    } else if (kind === "transition") {
      playTone(659.25, 0.12, 0, 0.024, "triangle");
      playTone(987.77, 0.18, 0.06, 0.018, "sine");
    } else if (kind === "complete") {
      playTone(523.25, 0.12, 0, 0.03, "sine");
      playTone(783.99, 0.2, 0.08, 0.024, "sine");
    } else {
      playTone(720, 0.07, 0, 0.022, "triangle");
    }
  }

  let lastFrameTime = performance.now();

  function animate(now) {
    const delta = Math.min((now - lastFrameTime) / 1000, 0.05);
    lastFrameTime = now;
    state.ambientTime += delta;

    if (state.playing) {
      state.time += delta;
      const transitionProgress = clamp((state.time - PRE_ROLL) / state.duration);
      if (transitionProgress >= 1 && !state.transitionCueFired) {
        state.transitionCueFired = true;
        playCue("transition");
      }

      if (state.time >= totalDuration()) {
        if (state.tourActive && state.tourIndex < TOUR_METHODS.length - 1) {
          state.tourIndex += 1;
          state.tourMethod = TOUR_METHODS[state.tourIndex];
          state.time = 0;
          state.transitionCueFired = false;
          updateMethodUI();
          dom.statusText.textContent = `四式连播 · ${state.tourIndex + 1}/4 ${METHOD_INFO[state.tourMethod].label}`;
          playCue("start");
        } else if (state.tourActive) {
          state.time = totalDuration();
          renderFrame();
          updateTimeline();
          completeTour();
        } else {
          state.time = totalDuration();
          renderFrame();
          updateTimeline();
          completeSinglePlayback();
        }
      }
    }

    renderFrame();
    updateTimeline();
    window.requestAnimationFrame(animate);
  }

  function saveParameters(withToast) {
    const payload = {
      version: 1,
      method: state.method,
      duration: state.duration,
      direction: state.direction,
      sound: state.sound,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      markSaved();
      if (withToast !== false) {
        showToast("转场参数已保存到本机");
      }
    } catch {
      showToast("浏览器未允许本地保存");
    }
  }

  function loadParameters() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }
      const saved = JSON.parse(raw);
      if (METHOD_INFO[saved.method]) {
        state.method = saved.method;
      }
      if (DIRECTION_INFO[saved.direction]) {
        state.direction = saved.direction;
      }
      if (Number.isFinite(saved.duration)) {
        state.duration = clamp(saved.duration, 0.8, 4);
      }
      state.sound = Boolean(saved.sound);
      state.time = PRE_ROLL + state.duration * state.progress;
      dom.saveState.innerHTML = "<i></i> 已载入上次参数";
    } catch {
      state.time = PRE_ROLL + state.duration * state.progress;
    }
  }

  dom.methodGrid.addEventListener("click", (event) => {
    const card = event.target.closest("[data-method]");
    if (!card) {
      return;
    }
    stopTour();
    state.method = card.dataset.method;
    state.time = PRE_ROLL + state.duration * state.progress;
    updateMethodUI();
    updateTimeline();
    markDirty();
    playCue("select");
    dom.statusText.textContent = `${METHOD_INFO[state.method].label}效果已应用，继续拖动参数可实时检视。`;
  });

  document.querySelectorAll("[data-direction]").forEach((button) => {
    button.addEventListener("click", () => {
      stopTour();
      state.direction = button.dataset.direction;
      state.time = PRE_ROLL + state.duration * state.progress;
      updateMethodUI();
      updateTimeline();
      markDirty();
      dom.statusText.textContent = `运动方向已调整为${DIRECTION_INFO[state.direction].label}。`;
    });
  });

  dom.durationRange.addEventListener("input", () => {
    stopTour();
    state.duration = Number(dom.durationRange.value);
    state.time = PRE_ROLL + state.duration * state.progress;
    updateMethodUI();
    updateTimeline();
    markDirty();
    dom.statusText.textContent = `转场时长 ${state.duration.toFixed(1)} 秒，B 场景仍从转场结束点归零。`;
  });

  dom.previewScrub.addEventListener("input", () => {
    setPreviewProgress(Number(dom.previewScrub.value) / 100);
    dom.statusText.textContent = `正在检视转场 ${Math.round(state.progress * 100)}% 位置。`;
  });

  let timelineDragging = false;

  function seekFromPointer(event) {
    const rect = dom.timeline.getBoundingClientRect();
    seekToRatio((event.clientX - rect.left) / rect.width);
    dom.statusText.textContent = state.progress <= 0
      ? "已定位到场景 A。"
      : state.progress >= 1
        ? "已定位到场景 B 的第 0 帧。"
        : `已定位到转场 ${Math.round(state.progress * 100)}%。`;
  }

  dom.timeline.addEventListener("pointerdown", (event) => {
    timelineDragging = true;
    dom.timeline.setPointerCapture(event.pointerId);
    seekFromPointer(event);
  });

  dom.timeline.addEventListener("pointermove", (event) => {
    if (timelineDragging) {
      seekFromPointer(event);
    }
  });

  dom.timeline.addEventListener("pointerup", (event) => {
    timelineDragging = false;
    if (dom.timeline.hasPointerCapture(event.pointerId)) {
      dom.timeline.releasePointerCapture(event.pointerId);
    }
  });

  dom.timeline.addEventListener("pointercancel", () => {
    timelineDragging = false;
  });

  function togglePlayback() {
    if (state.playing) {
      state.playing = false;
      updateTimeline();
      dom.statusText.textContent = "预览已暂停，拖动时间轴可逐帧检视。";
      return;
    }

    resetAudioIfNeeded();
    if (state.tourActive) {
      state.playing = true;
      playCue("start");
      dom.statusText.textContent = `继续四式连播 · ${state.tourIndex + 1}/4`;
      return;
    }

    if (state.time >= totalDuration() - 0.001) {
      beginSinglePlayback();
      return;
    }

    state.playing = true;
    state.transitionCueFired = state.progress >= 1;
    playCue("start");
    dom.statusText.textContent = "继续播放，B 场景时间轴保持连续。";
  }

  dom.playButton.addEventListener("click", togglePlayback);
  dom.restartButton.addEventListener("click", beginSinglePlayback);
  dom.applyPreview.addEventListener("click", beginSinglePlayback);
  dom.playAll.addEventListener("click", beginTour);

  dom.soundToggle.addEventListener("click", () => {
    state.sound = !state.sound;
    updateMethodUI();
    markDirty();
    if (state.sound) {
      ensureAudio();
      playCue("select");
      showToast("提示音已开启");
      dom.statusText.textContent = "Web Audio 提示音已开启。";
    } else {
      showToast("提示音已关闭");
      dom.statusText.textContent = "Web Audio 提示音已关闭。";
    }
  });

  dom.saveParams.addEventListener("click", () => saveParameters(true));

  dom.exportFrame.addEventListener("click", () => {
    renderFrame();
    const method = METHOD_INFO[currentMethod()].en.toLowerCase().replaceAll(" ", "-");
    const percent = Math.round(state.progress * 100);
    canvas.toBlob((blob) => {
      if (!blob) {
        showToast("当前帧导出失败");
        return;
      }
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = `kinetic-${method}-${percent}pct.png`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("当前帧已导出为 PNG");
    }, "image/png");
  });

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const isTyping =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLButtonElement;
    if (event.code === "Space" && !isTyping) {
      event.preventDefault();
      togglePlayback();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveParameters(true);
    }
  });

  loadParameters();
  updateMethodUI();
  updateTimeline();
  renderFrame();
  window.requestAnimationFrame(animate);
})();
