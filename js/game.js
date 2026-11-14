(function () {
  "use strict";

  const { Simulation, constants, utilities } = window.IceSim;
  const { clamp, lerp, distance, normalizeAngle, mulberry32 } = utilities;
  const canvas = document.getElementById("world");
  const context = canvas.getContext("2d", { alpha: false });
  const miniCanvas = document.getElementById("minimap");
  const miniContext = miniCanvas.getContext("2d");
  const worldLayer = document.createElement("canvas");
  const trackLayer = document.createElement("canvas");
  const SEED = 20261114;
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  const elements = {
    startOverlay: document.getElementById("start-overlay"),
    endOverlay: document.getElementById("end-overlay"),
    startButton: document.getElementById("start-button"),
    restartButton: document.getElementById("restart-button"),
    reviewButton: document.getElementById("review-button"),
    audioToggle: document.getElementById("audio-toggle"),
    audioLabel: document.getElementById("audio-label"),
    seedLabel: document.getElementById("seed-label"),
    clock: document.getElementById("clock"),
    oxygenValue: document.getElementById("oxygen-value"),
    oxygenFill: document.getElementById("oxygen-fill"),
    hullValue: document.getElementById("hull-value"),
    hullFill: document.getElementById("hull-fill"),
    loadValue: document.getElementById("load-value"),
    loadPips: Array.from(document.querySelectorAll("#load-pips i")),
    speedValue: document.getElementById("speed-value"),
    massValue: document.getElementById("mass-value"),
    iceValue: document.getElementById("ice-value"),
    headingValue: document.getElementById("heading-value"),
    riskReadout: document.getElementById("risk-readout"),
    riskLabel: document.getElementById("risk-label"),
    missionCopy: document.getElementById("mission-copy"),
    coreList: Array.from(document.querySelectorAll("#core-list li")),
    contextPrompt: document.getElementById("context-prompt"),
    promptTitle: document.getElementById("prompt-title"),
    promptSub: document.getElementById("prompt-sub"),
    sampleProgress: document.getElementById("sample-progress"),
    toastStack: document.getElementById("toast-stack"),
    endEyebrow: document.getElementById("end-eyebrow"),
    endTitle: document.getElementById("end-title"),
    endCopy: document.getElementById("end-copy"),
    endStats: document.getElementById("end-stats"),
    sectorLabel: document.getElementById("sector-label"),
  };

  let sim = new Simulation({ seed: SEED });
  let sound = new window.IceAudio();
  let camera = { x: sim.vehicle.x, y: sim.vehicle.y, zoom: 1 };
  let viewport = { width: window.innerWidth, height: window.innerHeight };
  let started = false;
  let paused = false;
  let finaleShown = false;
  let trackCursor = 0;
  let lastHud = 0;
  let lastFrame = performance.now();
  let shake = 0;
  let flash = 0;
  let warningCooldown = 0;
  let ambientTime = 0;
  let sceneRandom = mulberry32(SEED ^ 0xc0ffee);
  let snow = [];
  let windStreaks = [];

  const input = {
    up: false,
    down: false,
    left: false,
    right: false,
    sample: false,
    discard: false,
  };

  const keyMap = {
    KeyW: "up",
    ArrowUp: "up",
    KeyS: "down",
    ArrowDown: "down",
    KeyA: "left",
    ArrowLeft: "left",
    KeyD: "right",
    ArrowRight: "right",
    KeyE: "sample",
    KeyQ: "discard",
  };

  function resize() {
    viewport.width = window.innerWidth;
    viewport.height = window.innerHeight;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    camera.zoom = clamp(Math.min(viewport.width / 1180, viewport.height / 720), 0.78, 1.28);
    seedSnow();
  }

  function seedSnow() {
    const random = mulberry32(SEED ^ 0x51a);
    const count = clamp(Math.round((viewport.width * viewport.height) / 15000), 45, 135);
    snow = Array.from({ length: count }, () => ({
      x: random() * viewport.width,
      y: random() * viewport.height,
      size: 0.6 + random() * 2.1,
      speed: 10 + random() * 28,
      drift: -12 + random() * 24,
      alpha: 0.12 + random() * 0.38,
      phase: random() * Math.PI * 2,
    }));
    windStreaks = Array.from({ length: 16 }, () => ({
      x: random() * viewport.width,
      y: random() * viewport.height,
      length: 35 + random() * 120,
      speed: 18 + random() * 35,
      alpha: 0.025 + random() * 0.055,
    }));
  }

  function thicknessColor(value, variation = 0) {
    if (value < constants.FALL_THICKNESS) {
      return [8 + variation * 4, 42 + variation * 8, 55 + variation * 10];
    }
    if (value < 0.3) {
      const t = clamp((value - 0.1) / 0.2, 0, 1);
      return [68 + 46 * t + variation, 121 + 44 * t, 137 + 38 * t];
    }
    const t = clamp((value - 0.3) / 0.68, 0, 1);
    return [128 + 88 * t + variation, 179 + 64 * t, 188 + 50 * t];
  }

  function renderWorldLayer() {
    const world = sim.world;
    worldLayer.width = world.width;
    worldLayer.height = world.height;
    const layer = worldLayer.getContext("2d");
    const random = mulberry32(SEED ^ 0x1cef1e1d);
    const tiny = document.createElement("canvas");
    tiny.width = world.cols;
    tiny.height = world.rows;
    const tinyContext = tiny.getContext("2d");
    const image = tinyContext.createImageData(world.cols, world.rows);
    for (let index = 0; index < world.thickness.length; index += 1) {
      const variation = (random() - 0.5) * 14;
      const color = thicknessColor(world.thickness[index], variation);
      image.data[index * 4] = color[0];
      image.data[index * 4 + 1] = color[1];
      image.data[index * 4 + 2] = color[2];
      image.data[index * 4 + 3] = 255;
    }
    tinyContext.putImageData(image, 0, 0);
    layer.imageSmoothingEnabled = true;
    layer.drawImage(tiny, 0, 0, world.width, world.height);

    const wash = layer.createLinearGradient(0, 0, world.width, world.height);
    wash.addColorStop(0, "rgba(241,251,249,0.18)");
    wash.addColorStop(0.45, "rgba(123,190,199,0.04)");
    wash.addColorStop(1, "rgba(30,94,111,0.18)");
    layer.fillStyle = wash;
    layer.fillRect(0, 0, world.width, world.height);

    for (let index = 0; index < 4300; index += 1) {
      const x = random() * world.width;
      const y = random() * world.height;
      const length = 8 + random() * 74;
      const bend = (random() - 0.5) * 9;
      layer.beginPath();
      layer.moveTo(x, y);
      layer.quadraticCurveTo(x + length * 0.52, y + bend, x + length, y + bend * 0.25);
      layer.strokeStyle = random() > 0.46
        ? `rgba(240,255,252,${0.025 + random() * 0.075})`
        : `rgba(21,72,86,${0.018 + random() * 0.052})`;
      layer.lineWidth = 0.45 + random() * 1.4;
      layer.stroke();
    }

    for (let index = 0; index < 360; index += 1) {
      const x = random() * world.width;
      const y = random() * world.height;
      const radius = 18 + random() * 72;
      const snowPatch = layer.createRadialGradient(x, y, 0, x, y, radius);
      snowPatch.addColorStop(0, `rgba(246,255,251,${0.018 + random() * 0.07})`);
      snowPatch.addColorStop(1, "rgba(246,255,251,0)");
      layer.fillStyle = snowPatch;
      layer.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }

    for (let row = 0; row < world.rows; row += 1) {
      for (let col = 0; col < world.cols; col += 1) {
        const index = row * world.cols + col;
        if (!world.water[index]) continue;
        const x = (col + 0.5) * world.tile;
        const y = (row + 0.5) * world.tile;
        const radius = 18 + random() * 22;
        const water = layer.createRadialGradient(x, y, 2, x, y, radius);
        water.addColorStop(0, "rgba(2,24,35,0.74)");
        water.addColorStop(0.66, "rgba(4,35,48,0.54)");
        water.addColorStop(1, "rgba(7,42,54,0)");
        layer.fillStyle = water;
        layer.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        if (random() > 0.76) {
          layer.beginPath();
          layer.moveTo(x - 10, y - 2);
          layer.quadraticCurveTo(x, y - 5, x + 12, y - 1);
          layer.strokeStyle = "rgba(183,235,238,0.2)";
          layer.lineWidth = 0.8;
          layer.stroke();
        }
      }
    }

    for (let index = 0; index < 160; index += 1) {
      const x = random() * world.width;
      const y = random() * world.height;
      const radius = 90 + random() * 220;
      const pressure = layer.createRadialGradient(x, y, radius * 0.25, x, y, radius);
      pressure.addColorStop(0, "rgba(255,255,255,0.026)");
      pressure.addColorStop(1, "rgba(255,255,255,0)");
      layer.fillStyle = pressure;
      layer.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
  }

  function resetTrackLayer() {
    trackLayer.width = sim.world.width;
    trackLayer.height = sim.world.height;
    trackLayer.getContext("2d").clearRect(0, 0, trackLayer.width, trackLayer.height);
    trackCursor = 0;
  }

  function drawNewTracks() {
    if (trackCursor >= sim.tracks.length) return;
    const layer = trackLayer.getContext("2d");
    layer.lineCap = "round";
    layer.lineJoin = "round";
    for (let index = trackCursor; index < sim.tracks.length; index += 1) {
      const track = sim.tracks[index];
      layer.beginPath();
      layer.moveTo(track.x1, track.y1);
      layer.lineTo(track.x2, track.y2);
      layer.strokeStyle = `rgba(8,39,48,${track.strength * 0.72})`;
      layer.lineWidth = 7.4;
      layer.stroke();
      layer.beginPath();
      layer.moveTo(track.x1, track.y1);
      layer.lineTo(track.x2, track.y2);
      layer.strokeStyle = `rgba(173,215,216,${track.strength * 0.34})`;
      layer.lineWidth = 2.2;
      layer.setLineDash([4, 5]);
      layer.stroke();
      layer.setLineDash([]);
    }
    trackCursor = sim.tracks.length;
  }

  function updateCamera(dt) {
    const targetX = sim.vehicle.x;
    const targetY = sim.vehicle.y;
    const follow = 1 - Math.exp(-dt * 3.4);
    camera.x = lerp(camera.x, targetX, follow);
    camera.y = lerp(camera.y, targetY, follow);
    const halfWidth = viewport.width / camera.zoom / 2;
    const halfHeight = viewport.height / camera.zoom / 2;
    camera.x = halfWidth * 2 >= sim.world.width
      ? sim.world.width / 2
      : clamp(camera.x, halfWidth, sim.world.width - halfWidth);
    camera.y = halfHeight * 2 >= sim.world.height
      ? sim.world.height / 2
      : clamp(camera.y, halfHeight, sim.world.height - halfHeight);
  }

  function beginWorldTransform(ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(viewport.width / 2, viewport.height / 2);
    const shakeX = shake > 0 ? (sceneRandom() - 0.5) * shake : 0;
    const shakeY = shake > 0 ? (sceneRandom() - 0.5) * shake : 0;
    ctx.translate(shakeX, shakeY);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);
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

  function drawCamp(ctx) {
    const camp = sim.world.camp;
    const pulse = 0.5 + Math.sin(ambientTime * 2.2) * 0.5;
    ctx.save();
    ctx.translate(camp.x, camp.y);
    const safe = ctx.createRadialGradient(0, 0, 18, 0, 0, 116);
    safe.addColorStop(0, "rgba(140,227,179,0.09)");
    safe.addColorStop(0.72, "rgba(140,227,179,0.025)");
    safe.addColorStop(1, "rgba(140,227,179,0)");
    ctx.fillStyle = safe;
    ctx.beginPath();
    ctx.arc(0, 0, 116, 0, Math.PI * 2);
    ctx.fill();
    ctx.setLineDash([4, 9]);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = `rgba(140,227,179,${0.18 + pulse * 0.12})`;
    ctx.beginPath();
    ctx.arc(0, 0, 101, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(4,24,31,0.24)";
    ctx.beginPath();
    ctx.ellipse(7, 9, 65, 44, -0.15, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.rotate(-0.16);
    ctx.fillStyle = "#785441";
    roundedRect(ctx, -50, -25, 65, 48, 3);
    ctx.fill();
    ctx.fillStyle = "#b27854";
    roundedRect(ctx, -52, -28, 64, 42, 3);
    ctx.fill();
    ctx.fillStyle = "#ddd6bd";
    roundedRect(ctx, -50, -31, 59, 8, 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(70,45,34,0.55)";
    ctx.lineWidth = 1;
    for (let line = -18; line < 15; line += 7) {
      ctx.beginPath();
      ctx.moveTo(line, -23);
      ctx.lineTo(line, 10);
      ctx.stroke();
    }
    ctx.fillStyle = "#19323a";
    roundedRect(ctx, -17, 5, 18, 8, 1);
    ctx.fill();

    ctx.fillStyle = "#5d8d83";
    ctx.beginPath();
    ctx.moveTo(19, 18);
    ctx.lineTo(53, -3);
    ctx.lineTo(64, 20);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(233,249,241,0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(53, -3);
    ctx.lineTo(52, 21);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "#6f512f";
    ctx.fillRect(27, -43, 15, 19);
    ctx.fillStyle = "rgba(255,182,84,0.25)";
    ctx.fillRect(28, -41, 13, 11);
    ctx.strokeStyle = "#92a9a1";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(58, -37);
    ctx.lineTo(58, -85);
    ctx.moveTo(51, -76);
    ctx.lineTo(65, -76);
    ctx.stroke();
    ctx.fillStyle = `rgba(255,91,57,${0.5 + pulse * 0.5})`;
    ctx.beginPath();
    ctx.arc(58, -85, 2.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 13;
    ctx.shadowColor = "rgba(255,93,55,0.8)";
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = "rgba(218,247,239,0.74)";
    ctx.font = "600 9px monospace";
    ctx.textAlign = "center";
    ctx.fillText("CAMP / 07", -20, 56);
    ctx.fillStyle = "rgba(140,227,179,0.68)";
    ctx.font = "8px monospace";
    ctx.fillText("SAFE ICE", -20, 68);
    ctx.restore();
  }

  function drawCoreSite(ctx, core) {
    const pulse = 0.5 + Math.sin(ambientTime * 2.1 + core.id * 2.2) * 0.5;
    ctx.save();
    ctx.translate(core.x, core.y);
    ctx.fillStyle = "rgba(3,27,34,0.26)";
    ctx.beginPath();
    ctx.ellipse(7, 8, 39, 27, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.setLineDash([3, 7]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = core.collected ? "rgba(128,153,150,0.25)" : `rgba(255,142,78,${0.35 + pulse * 0.28})`;
    ctx.beginPath();
    ctx.arc(0, 0, 55 + pulse * 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    if (!core.collected) {
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 53);
      glow.addColorStop(0, "rgba(255,123,53,0.1)");
      glow.addColorStop(1, "rgba(255,123,53,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, 53, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = core.collected ? "#637d7d" : "#d8dfd5";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(-20, -19);
    ctx.lineTo(-7, 18);
    ctx.moveTo(20, -19);
    ctx.lineTo(7, 18);
    ctx.moveTo(0, -24);
    ctx.lineTo(0, 18);
    ctx.stroke();
    ctx.strokeStyle = "rgba(243,252,245,0.36)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-20, -19);
    ctx.lineTo(20, -19);
    ctx.stroke();
    ctx.fillStyle = core.collected ? "#506968" : "#ff7b35";
    ctx.beginPath();
    ctx.arc(0, 25, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = core.collected ? "#a4b4b0" : "#17252a";
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(core.collected ? "✓" : String(core.id + 1).padStart(2, "0"), 0, 25.5);
    if (core.collected) {
      ctx.strokeStyle = "#263f43";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#0a252d";
      ctx.beginPath();
      ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = core.collected ? "rgba(177,200,194,0.55)" : "rgba(236,249,243,0.78)";
    ctx.font = "600 8px \"Noto Sans SC Local\", monospace";
    ctx.fillText(core.name, 0, 45);
    ctx.restore();
  }

  function drawVehicle(ctx) {
    const vehicle = sim.vehicle;
    ctx.save();
    ctx.translate(vehicle.x, vehicle.y);
    ctx.rotate(vehicle.angle);
    const accent = sim.status === "lost" ? "#7a8290" : "#f07833";
    const headlight = 0.6 + Math.sin(ambientTime * 19) * 0.06;
    const light = ctx.createLinearGradient(22, 0, 148, 0);
    light.addColorStop(0, `rgba(255,224,166,${0.14 * headlight})`);
    light.addColorStop(1, "rgba(255,224,166,0)");
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.moveTo(25, -11);
    ctx.lineTo(153, -48);
    ctx.lineTo(153, 48);
    ctx.lineTo(25, 11);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(3,23,29,0.28)";
    ctx.beginPath();
    ctx.ellipse(2, 7, 36, 25, 0, 0, Math.PI * 2);
    ctx.fill();

    for (const side of [-1, 1]) {
      ctx.fillStyle = "#172c31";
      roundedRect(ctx, -26, side * 18 - 7.5, 55, 15, 4);
      ctx.fill();
      ctx.fillStyle = "#31474b";
      roundedRect(ctx, -23, side * 18 - 5.5, 47, 11, 3);
      ctx.fill();
      ctx.strokeStyle = "rgba(185,218,212,0.18)";
      ctx.lineWidth = 1;
      for (let tread = -17; tread <= 17; tread += 5) {
        ctx.beginPath();
        ctx.moveTo(tread, side * 18 - 5.5);
        ctx.lineTo(tread, side * 18 + 5.5);
        ctx.stroke();
      }
    }

    roundedRect(ctx, -21, -14, 45, 28, 4);
    ctx.fillStyle = "#253d42";
    ctx.fill();
    roundedRect(ctx, -20, -12, 40, 24, 4);
    ctx.fillStyle = accent;
    ctx.fill();
    const bodyGradient = ctx.createLinearGradient(-18, -10, 18, 12);
    bodyGradient.addColorStop(0, "rgba(255,224,195,0.3)");
    bodyGradient.addColorStop(0.5, "rgba(255,255,255,0)");
    bodyGradient.addColorStop(1, "rgba(91,29,13,0.2)");
    ctx.fillStyle = bodyGradient;
    roundedRect(ctx, -20, -12, 40, 24, 4);
    ctx.fill();

    ctx.fillStyle = "#16343b";
    roundedRect(ctx, -4, -10, 17, 20, 3);
    ctx.fill();
    const glass = ctx.createLinearGradient(-2, -9, 12, 9);
    glass.addColorStop(0, "rgba(89,156,164,0.66)");
    glass.addColorStop(0.45, "rgba(23,62,72,0.75)");
    glass.addColorStop(1, "rgba(144,204,201,0.34)");
    ctx.fillStyle = glass;
    roundedRect(ctx, -2, -8, 13, 16, 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(232,252,245,0.28)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(1, -6);
    ctx.lineTo(8, 10);
    ctx.stroke();

    ctx.fillStyle = "#182c30";
    roundedRect(ctx, -18, -22, 12, 44, 2);
    ctx.fill();
    ctx.fillStyle = "#7c9795";
    for (let line = -17; line <= 17; line += 7) {
      ctx.fillRect(-17, line, 10, 1);
    }

    ctx.fillStyle = "rgba(255,228,169,0.82)";
    ctx.fillRect(20, -9, 3, 5);
    ctx.fillRect(20, 4, 3, 5);
    ctx.fillStyle = "rgba(255,91,57,0.75)";
    ctx.fillRect(-21, -6, 2, 4);
    ctx.fillRect(-21, 2, 2, 4);

    ctx.strokeStyle = "#9cb5ab";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-8, -12);
    ctx.lineTo(-8, -37);
    ctx.moveTo(-3, -32);
    ctx.lineTo(-13, -32);
    ctx.stroke();
    ctx.fillStyle = "#ff7b35";
    ctx.beginPath();
    ctx.arc(-8, -37, 2.2, 0, Math.PI * 2);
    ctx.fill();

    const load = vehicle.load;
    ctx.fillStyle = "rgba(13,34,39,0.86)";
    roundedRect(ctx, -14, -28, 25, 8, 1.5);
    ctx.fill();
    for (let index = 0; index < 3; index += 1) {
      ctx.fillStyle = index < load ? "#bff0d9" : "rgba(130,168,166,0.24)";
      ctx.fillRect(-12 + index * 7.3, -26.3, 5, 4.6);
    }
    ctx.restore();
  }

  function drawCracks(ctx) {
    if (!sim.cracks.length) return;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const crack of sim.cracks) {
      const points = crack.points;
      if (points.length < 2) continue;
      const fade = clamp((ambientTime - crack.age) / 140, 0, 0.5);
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index += 1) {
        ctx.lineTo(points[index].x, points[index].y);
      }
      ctx.strokeStyle = `rgba(7,37,46,${crack.alpha * (1 - fade)})`;
      ctx.lineWidth = crack.width * 2.6;
      ctx.stroke();
      ctx.strokeStyle = `rgba(196,239,240,${crack.alpha * 0.82 * (1 - fade)})`;
      ctx.lineWidth = Math.max(0.55, crack.width * 0.52);
      ctx.stroke();
      if (crack.intensity > 0.72) {
        ctx.strokeStyle = `rgba(230,255,251,${0.18 * (1 - fade)})`;
        ctx.lineWidth = crack.width * 4.3;
        ctx.globalAlpha = 0.24;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  function drawFrostMist(ctx) {
    const thinPoints = [];
    for (let index = 0; index < 36; index += 1) {
      const angle = index * 2.39996 + ambientTime * 0.02;
      const radius = 160 + (index % 5) * 44;
      const x = sim.vehicle.x + Math.cos(angle) * radius;
      const y = sim.vehicle.y + Math.sin(angle) * radius;
      const value = sim.world.thicknessAt(x, y);
      if (value < 0.29) thinPoints.push({ x, y, value });
    }
    for (const point of thinPoints) {
      const radius = 42 + (0.3 - point.value) * 120;
      const mist = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
      mist.addColorStop(0, "rgba(194,236,235,0.018)");
      mist.addColorStop(1, "rgba(194,236,235,0)");
      ctx.fillStyle = mist;
      ctx.fillRect(point.x - radius, point.y - radius, radius * 2, radius * 2);
    }
  }

  function drawScene(dt) {
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = "#0a2832";
    context.fillRect(0, 0, viewport.width, viewport.height);
    drawNewTracks();
    beginWorldTransform(context);
    context.drawImage(worldLayer, 0, 0);
    context.drawImage(trackLayer, 0, 0);
    drawFrostMist(context);
    drawCracks(context);
    drawCamp(context);
    for (const core of sim.world.cores) drawCoreSite(context, core);
    drawVehicle(context);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    for (const streak of windStreaks) {
      streak.x -= streak.speed * dt;
      if (streak.x < -streak.length) {
        streak.x = viewport.width + streak.length;
        streak.y = sceneRandom() * viewport.height;
      }
      context.beginPath();
      context.moveTo(streak.x, streak.y);
      context.lineTo(streak.x + streak.length, streak.y + streak.length * 0.025);
      context.strokeStyle = `rgba(225,248,248,${streak.alpha})`;
      context.lineWidth = 0.7;
      context.stroke();
    }

    for (const flake of snow) {
      flake.y += flake.speed * dt;
      flake.x += (flake.drift + Math.sin(ambientTime * 1.3 + flake.phase) * 7) * dt;
      if (flake.y > viewport.height + 8) {
        flake.y = -8;
        flake.x = sceneRandom() * viewport.width;
      }
      if (flake.x < -8) flake.x = viewport.width + 8;
      context.fillStyle = `rgba(235,253,251,${flake.alpha})`;
      context.fillRect(flake.x, flake.y, flake.size, flake.size);
    }

    if (paused) {
      context.fillStyle = "rgba(3,14,18,0.5)";
      context.fillRect(0, 0, viewport.width, viewport.height);
      context.fillStyle = "#d9efed";
      context.font = "600 18px monospace";
      context.textAlign = "center";
      context.fillText("勘测暂停 / PAUSED", viewport.width / 2, viewport.height / 2);
    }
    if (flash > 0) {
      context.fillStyle = `rgba(255,240,217,${flash})`;
      context.fillRect(0, 0, viewport.width, viewport.height);
    }
  }

  function drawMinimap() {
    const ctx = miniContext;
    const width = miniCanvas.width;
    const height = miniCanvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(worldLayer, 0, 0, width, height);
    ctx.fillStyle = "rgba(4,24,33,0.26)";
    ctx.fillRect(0, 0, width, height);
    const sx = width / sim.world.width;
    const sy = height / sim.world.height;
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 0.8;
    for (const route of sim.world.routes) {
      ctx.beginPath();
      route.forEach((point, index) => {
        const x = point.x * sx;
        const y = point.y * sy;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = "rgba(255,170,117,0.24)";
      ctx.stroke();
    }
    ctx.restore();

    for (const core of sim.world.cores) {
      ctx.beginPath();
      ctx.arc(core.x * sx, core.y * sy, core.collected ? 2.5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = core.collected ? "rgba(119,145,143,0.5)" : "#f4fbf5";
      ctx.fill();
      if (!core.collected) {
        ctx.strokeStyle = "rgba(255,123,53,0.8)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(core.x * sx, core.y * sy, 7, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    const campX = sim.world.camp.x * sx;
    const campY = sim.world.camp.y * sy;
    ctx.fillStyle = "#8ce3b3";
    ctx.fillRect(campX - 3, campY - 3, 6, 6);
    ctx.strokeStyle = "rgba(140,227,179,0.45)";
    ctx.beginPath();
    ctx.arc(campX, campY, 9, 0, Math.PI * 2);
    ctx.stroke();

    const x = sim.vehicle.x * sx;
    const y = sim.vehicle.y * sy;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(sim.vehicle.angle);
    ctx.fillStyle = "#ff7b35";
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(-4, -4);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-4, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "rgba(224,250,248,0.18)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  }

  function formatClock(seconds) {
    const whole = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
  }

  function addToast(text, tone = "info", duration = 2500) {
    const toast = document.createElement("div");
    toast.className = `toast ${tone}`;
    toast.textContent = text;
    elements.toastStack.appendChild(toast);
    window.setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(-5px)";
      toast.style.transition = "opacity 220ms, transform 220ms";
      window.setTimeout(() => toast.remove(), 240);
    }, duration);
  }

  function updateHUD(force = false) {
    const now = performance.now();
    if (!force && now - lastHud < 75) return;
    lastHud = now;
    const vehicle = sim.vehicle;
    const risk = sim.getRisk();
    const oxygen = Math.round(vehicle.oxygen);
    const hull = Math.round(vehicle.hull);
    elements.clock.textContent = formatClock(sim.time);
    elements.oxygenValue.textContent = String(oxygen);
    elements.hullValue.textContent = String(hull);
    elements.oxygenFill.style.transform = `scaleX(${clamp(vehicle.oxygen / 100, 0, 1)})`;
    elements.hullFill.style.transform = `scaleX(${clamp(vehicle.hull / 100, 0, 1)})`;
    elements.oxygenFill.parentElement.parentElement.classList.toggle("danger", oxygen <= 22);
    elements.hullFill.parentElement.parentElement.classList.toggle("danger", hull <= 26);
    elements.loadValue.textContent = `${vehicle.load} / 3`;
    elements.loadPips.forEach((pip, index) => pip.classList.toggle("filled", index < vehicle.load));
    elements.speedValue.textContent = String(sim.speedKmh).padStart(3, "0");
    elements.massValue.textContent = `${Math.round(sim.mass)} KG`;
    elements.iceValue.textContent = `${Math.round(risk.thickness * 170)} CM`;
    const heading = Math.round(((vehicle.angle * 180) / Math.PI + 90 + 360) % 360);
    elements.headingValue.textContent = `${String(heading).padStart(3, "0")}°`;
    elements.riskReadout.className = `risk-readout ${risk.level === "stable" ? "" : risk.level}`;
    elements.riskLabel.textContent = risk.label;

    elements.coreList.forEach((item, index) => {
      const core = sim.world.cores[index];
      item.classList.toggle("done", core.collected);
      item.classList.toggle("active", !core.collected && sim.nearbyCore === core);
      item.querySelector("em").textContent = core.collected ? "已封存" : "未采集";
    });
    if (sim.coresCollected === 0) {
      elements.missionCopy.textContent = "驶向三处采样点，停车钻取冰芯，然后返回营地。";
    } else if (sim.coresCollected < 3) {
      elements.missionCopy.textContent = `已封存 ${sim.coresCollected} 份。重载会加快薄冰开裂。`;
    } else {
      elements.missionCopy.textContent = "三份冰芯已封装。降低速度，沿厚冰返回营地。";
    }

    const near = sim.nearbyCore;
    const canSample = sim.status === "playing" && near && Math.abs(vehicle.speed) < 18;
    elements.contextPrompt.classList.toggle("visible", Boolean(canSample));
    if (near) {
      elements.promptTitle.textContent = canSample ? "按住 E 钻取冰芯" : "先停车稳定车体";
      elements.promptSub.textContent = canSample ? `${near.name} · 需 1.2 秒` : "速度低于 7 km/h 后可采样";
      elements.sampleProgress.style.width = `${clamp(sim.sampleProgress / constants.SAMPLE_TIME, 0, 1) * 100}%`;
    }

    if (risk.level === "danger" && warningCooldown <= 0 && sim.status === "playing") {
      addToast("警告：冰层正在失效，立即减速", "danger", 1900);
      sound.warn();
      warningCooldown = 3.2;
    }
    warningCooldown = Math.max(0, warningCooldown - 0.075);
    drawMinimap();
  }

  function handleEvents() {
    for (const event of sim.drainEvents()) {
      if (event.type === "crack") {
        sound.crack(event.intensity);
        shake = Math.max(shake, 2 + event.intensity * 4);
        flash = Math.max(flash, 0.018 + event.intensity * 0.012);
      } else if (event.type === "sample") {
        sound.sample();
        addToast(`${event.name}已封存 · 载荷 ${event.load}/3`, "success", 2600);
        flash = 0.12;
        shake = Math.max(shake, 3);
      } else if (event.type === "discard") {
        sound.discard();
        addToast(`弃样完成 · 减重 46 KG · 当前载荷 ${event.load}/3`, "info", 2800);
        shake = Math.max(shake, 4);
      } else if (event.type === "all-samples") {
        addToast("三份冰芯采集完成 · 返回营地", "success", 3200);
      } else if (event.type === "win") {
        sound.win(event.ending === "complete");
        showEnding(event);
      } else if (event.type === "fail") {
        sound.fail(event.reason);
        shake = 12;
        showEnding(event);
      }
    }
  }

  function showEnding(event) {
    if (finaleShown) return;
    finaleShown = true;
    const complete = event.type === "win" && event.ending === "complete";
    const evacuated = event.type === "win" && event.ending === "evacuated";
    elements.endOverlay.classList.remove("hidden");
    if (complete) {
      elements.endEyebrow.textContent = "MISSION COMPLETE / 三芯归营";
      elements.endTitle.textContent = "完整冰层记录";
      elements.endCopy.textContent = "三份冰芯安全入库。冰面留下了你的路线，但这次没有人掉下去。";
    } else if (evacuated) {
      elements.endEyebrow.textContent = "RETURNED / 弃样返航";
      elements.endTitle.textContent = "轻装抵达";
      elements.endCopy.textContent = `你主动丢弃了 ${sim.coresDiscarded} 份样本，以减重换回一条生路。带回 ${sim.coresDelivered} 份冰芯。`;
    } else {
      const reasons = {
        oxygen: ["OXYGEN DEPLETED / 氧气耗尽", "氧气归零", "低温与重载耗尽了最后一口氧气。营地只能回收遥测数据。"],
        hull: ["HULL FAILURE / 车体失效", "车体解体", "反复的高速冲击让底盘失去结构完整性。勘测车停在了冰原上。"],
        fell: ["BREACH / 落水", "冰面破裂", "履带压穿了最薄的一层冰。勘测车和样本一起沉入黑水。"],
        empty: ["NO SAMPLE / 空载返航", "没有样本", "你回到了营地，却没能带回任何可用的冰芯记录。"],
      };
      const copy = reasons[event.reason] || reasons.hull;
      elements.endEyebrow.textContent = copy[0];
      elements.endTitle.textContent = copy[1];
      elements.endCopy.textContent = copy[2];
    }
    const summary = sim.getSummary();
    elements.endStats.innerHTML = [
      ["用时", formatClock(summary.time)],
      ["带回样本", `${summary.delivered} / 3`],
      ["氧气余量", `${Math.round(summary.oxygen)}%`],
      ["车体耐久", `${Math.round(summary.hull)}%`],
    ].map(([label, value]) => `<div><span>${label}</span><b>${value}</b></div>`).join("");
    elements.sectorLabel.textContent = "白鼬冰原 / MISSION LOG SAVED";
  }

  function startMission() {
    if (started && sim.status !== "ready") return;
    sound.enable();
    sim.start();
    started = true;
    paused = false;
    elements.startOverlay.classList.add("hidden");
    addToast("任务开始 · 氧气与车体状态已接管", "info", 2400);
  }

  function restartMission() {
    sim = new Simulation({ seed: SEED });
    camera.x = sim.vehicle.x;
    camera.y = sim.vehicle.y;
    started = true;
    paused = false;
    finaleShown = false;
    shake = 0;
    flash = 0;
    warningCooldown = 0;
    renderWorldLayer();
    resetTrackLayer();
    sim.start();
    elements.endOverlay.classList.add("hidden");
    elements.startOverlay.classList.add("hidden");
    elements.sectorLabel.textContent = "白鼬冰原 / SECTOR N-41";
    addToast("新一轮勘测 · 地图种子保持不变", "info", 2400);
  }

  function togglePause() {
    if (!started || sim.status !== "playing") return;
    paused = !paused;
    if (!paused) lastFrame = performance.now();
    sound.updateMotor(sim.vehicle.speed, sim.vehicle.load, !paused);
  }

  function updateAudioToggle() {
    elements.audioToggle.classList.toggle("muted", sound.muted);
    elements.audioToggle.setAttribute("aria-pressed", String(!sound.muted));
    elements.audioLabel.textContent = sound.muted ? "声音关闭" : "声音开启";
  }

  async function toggleAudio() {
    if (!sound.ready) await sound.enable();
    sound.toggle();
    updateAudioToggle();
  }

  function handleKey(event, down) {
    if (event.code === "KeyM" && down && !event.repeat) {
      toggleAudio();
      event.preventDefault();
      return;
    }
    if (event.code === "KeyP" && down && !event.repeat) {
      togglePause();
      event.preventDefault();
      return;
    }
    if (event.code === "KeyR" && down && !event.repeat && started) {
      restartMission();
      event.preventDefault();
      return;
    }
    if (event.code === "Enter" && down && !event.repeat) {
      if (!started) startMission();
      else if (finaleShown) restartMission();
      event.preventDefault();
      return;
    }
    const control = keyMap[event.code];
    if (!control) return;
    if (down) sound.enable();
    input[control] = down;
    event.preventDefault();
  }

  function setupInput() {
    window.addEventListener("keydown", (event) => handleKey(event, true));
    window.addEventListener("keyup", (event) => handleKey(event, false));
    window.addEventListener("blur", () => {
      for (const key of Object.keys(input)) input[key] = false;
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && started && sim.status === "playing") paused = true;
    });

    elements.startButton.addEventListener("click", startMission);
    elements.restartButton.addEventListener("click", restartMission);
    elements.reviewButton.addEventListener("click", () => {
      elements.endOverlay.classList.add("hidden");
      addToast("遥测已保存 · 按 R 或回车重新勘测", "info", 3600);
    });
    elements.audioToggle.addEventListener("click", toggleAudio);

    for (const button of document.querySelectorAll(".touch-controls button")) {
      const control = button.dataset.control;
      const setActive = (active) => {
        input[control] = active;
        button.classList.toggle("pressed", active);
        if (active) sound.enable();
      };
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        setActive(true);
      });
      button.addEventListener("pointerup", () => setActive(false));
      button.addEventListener("pointercancel", () => setActive(false));
      button.addEventListener("pointerleave", (event) => {
        if (event.buttons === 0) setActive(false);
      });
    }
  }

  function frame(timestamp) {
    const dt = clamp((timestamp - lastFrame) / 1000, 0, 0.06);
    lastFrame = timestamp;
    ambientTime += dt;
    if (started && !paused && sim.status === "playing") {
      sim.update(dt, input);
      handleEvents();
    }
    updateCamera(dt);
    updateHUD();
    drawScene(dt);
    sound.updateMotor(
      sim.vehicle.speed,
      sim.vehicle.load,
      started && !paused && sim.status === "playing",
    );
    shake = Math.max(0, shake - dt * 18);
    flash = Math.max(0, flash - dt * 1.9);
    window.requestAnimationFrame(frame);
  }

  elements.seedLabel.textContent = String(SEED);
  resize();
  renderWorldLayer();
  resetTrackLayer();
  setupInput();
  updateAudioToggle();
  updateHUD(true);
  window.requestAnimationFrame(frame);

  window.iceGame = {
    get simulation() {
      return sim;
    },
    startMission,
    restartMission,
    togglePause,
    get started() {
      return started;
    },
    get paused() {
      return paused;
    },
    get sound() {
      return sound;
    },
  };
})();
