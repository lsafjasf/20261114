(() => {
  "use strict";

  const STAGE_WIDTH = 960;
  const STAGE_HEIGHT = 540;
  const DURATION = 12;
  const PROJECT_FPS = 30;
  const JITTER_FPS = 12;
  const JITTER_FRAMES = DURATION * JITTER_FPS;
  const PADDLE_EVENTS = [0.92, 2.48, 4.06, 5.63, 7.21, 8.78, 10.36];
  const TAU = Math.PI * 2;

  const LAYER_META = {
    moon: { name: "月亮", glyph: "月", color: "#c7a85c", seed: 17 },
    tree: { name: "老树", glyph: "树", color: "#315048", seed: 43 },
    boat: { name: "纸船", glyph: "船", color: "#c8b384", seed: 71 },
    person: { name: "小人", glyph: "人", color: "#a44c37", seed: 89 },
  };

  const DEFAULT_PROJECT = {
    schema: "paper-cut-studio",
    version: 1,
    title: "折月 · 十二秒剪纸",
    scene: "「月落之后，纸船仍向岸边漂。」",
    duration: DURATION,
    fps: PROJECT_FPS,
    currentTime: 4.2,
    selectedLayer: "boat",
    audioOn: true,
    layers: [
      {
        id: "person",
        name: "小人",
        glyph: "人",
        color: "#a44c37",
        jitter: 1.8,
        entrance: { x: 74, y: 32, delay: 0.85, duration: 1.15 },
        visible: true,
      },
      {
        id: "boat",
        name: "纸船",
        glyph: "船",
        color: "#c8b384",
        jitter: 3.2,
        entrance: { x: 120, y: -30, delay: 0.45, duration: 1.35 },
        visible: true,
      },
      {
        id: "tree",
        name: "老树",
        glyph: "树",
        color: "#315048",
        jitter: 2.4,
        entrance: { x: -110, y: 18, delay: 0.2, duration: 1.65 },
        visible: true,
      },
      {
        id: "moon",
        name: "月亮",
        glyph: "月",
        color: "#c7a85c",
        jitter: 1.4,
        entrance: { x: 150, y: -55, delay: 0, duration: 1.8 },
        visible: true,
      },
    ],
  };

  const state = clone(DEFAULT_PROJECT);
  let selectedLayerId = state.selectedLayer;
  let currentTime = state.currentTime;
  let isPlaying = false;
  let isDirty = false;
  let toastTimer = 0;
  let playbackRaf = 0;
  let playbackStart = 0;
  let playbackOrigin = 0;
  let lastAudioTime = currentTime;
  let scrubPointerId = null;
  let dragState = null;
  let audio = null;

  const canvas = document.querySelector("#stage");
  const ctx = canvas.getContext("2d");
  const ui = {
    projectState: document.querySelector("#projectState"),
    projectStateText: document.querySelector("#projectStateText"),
    soundButton: document.querySelector("#soundButton"),
    saveButton: document.querySelector("#saveButton"),
    loadButton: document.querySelector("#loadButton"),
    sampleButton: document.querySelector("#sampleButton"),
    fileInput: document.querySelector("#fileInput"),
    frameReadout: document.querySelector("#frameReadout"),
    layerIndex: document.querySelector("#layerIndex"),
    layerEmblem: document.querySelector("#layerEmblem"),
    selectedLayerName: document.querySelector("#selectedLayerName"),
    layerChip: document.querySelector("#layerChip"),
    jitterRange: document.querySelector("#jitterRange"),
    jitterValue: document.querySelector("#jitterValue"),
    offsetXRange: document.querySelector("#offsetXRange"),
    offsetXValue: document.querySelector("#offsetXValue"),
    offsetYRange: document.querySelector("#offsetYRange"),
    offsetYValue: document.querySelector("#offsetYValue"),
    resetOffsetButton: document.querySelector("#resetOffsetButton"),
    delayRange: document.querySelector("#delayRange"),
    delayValue: document.querySelector("#delayValue"),
    entranceRange: document.querySelector("#entranceRange"),
    entranceValue: document.querySelector("#entranceValue"),
    playButton: document.querySelector("#playButton"),
    playLabel: document.querySelector("#playLabel"),
    startButton: document.querySelector("#startButton"),
    timecode: document.querySelector("#timecode"),
    ruler: document.querySelector("#ruler"),
    tracksLabelColumn: document.querySelector("#tracksLabelColumn"),
    timelineSurface: document.querySelector("#timelineSurface"),
    timelineGrid: document.querySelector("#timelineGrid"),
    playhead: document.querySelector("#playhead"),
    toast: document.querySelector("#toast"),
    toastText: document.querySelector("#toastText"),
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(a, b, amount) {
    return a + (b - a) * amount;
  }

  function smoothstep(value) {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  }

  function easeOutCubic(value) {
    const t = clamp(value, 0, 1);
    return 1 - Math.pow(1 - t, 3);
  }

  function wrapTime(time) {
    return ((time % DURATION) + DURATION) % DURATION;
  }

  function mulberry32(seed) {
    return function random() {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashUnit(seed, index) {
    let value = Math.sin(seed * 127.1 + index * 311.7) * 43758.5453123;
    return value - Math.floor(value);
  }

  function loopNoise(seed, frame, period = JITTER_FRAMES) {
    const safePeriod = Math.max(2, Math.round(period));
    const base = ((frame % safePeriod) + safePeriod) % safePeriod;
    const next = (base + 1) % safePeriod;
    const blend = smoothstep(frame - Math.floor(frame));
    return lerp(hashUnit(seed, base), hashUnit(seed, next), blend) * 2 - 1;
  }

  function layerSeed(layer) {
    return (LAYER_META[layer.id]?.seed || 1) + layer.jitter * 0.13;
  }

  function getLayerFrame(time) {
    return Math.floor(wrapTime(time) * JITTER_FPS);
  }

  function formatTimecode(time) {
    const safe = clamp(time, 0, DURATION - 1 / PROJECT_FPS);
    const seconds = Math.floor(safe);
    const frames = Math.floor((safe - seconds) * PROJECT_FPS);
    return `00:${String(seconds).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
  }

  function formatSigned(value, digits = 0) {
    if (value < 0) return `−${Math.abs(value).toFixed(digits)}`;
    return `+${value.toFixed(digits)}`;
  }

  function setRangeProgress(input) {
    const min = Number(input.min);
    const max = Number(input.max);
    const progress = ((Number(input.value) - min) / (max - min)) * 100;
    input.style.setProperty("--range-progress", `${progress}%`);
  }

  function setDirty(dirty, message = "") {
    isDirty = dirty;
    ui.projectState.classList.toggle("is-dirty", dirty);
    ui.projectStateText.textContent = message || (dirty ? "有未保存的改动" : "工程已同步");
  }

  function showToast(message, icon = "✓") {
    window.clearTimeout(toastTimer);
    document.querySelector(".toast-icon").textContent = icon;
    ui.toastText.textContent = message;
    ui.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => {
      ui.toast.classList.remove("is-visible");
    }, 2600);
  }

  function getSelectedLayer() {
    return state.layers.find((layer) => layer.id === selectedLayerId) || state.layers[0];
  }

  let pixelRatio = 1;
  let grainPattern = null;

  function configureCanvas() {
    pixelRatio = clamp(window.devicePixelRatio || 1, 1, 2);
    const width = Math.round(STAGE_WIDTH * pixelRatio);
    const height = Math.round(STAGE_HEIGHT * pixelRatio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    grainPattern = createGrainPattern();
  }

  function createGrainPattern() {
    const grain = document.createElement("canvas");
    grain.width = 180;
    grain.height = 120;
    const grainContext = grain.getContext("2d");
    const image = grainContext.createImageData(grain.width, grain.height);
    const random = mulberry32(20261114);
    for (let index = 0; index < image.data.length; index += 4) {
      const shade = Math.floor(random() * 255);
      image.data[index] = shade;
      image.data[index + 1] = shade;
      image.data[index + 2] = shade;
      image.data[index + 3] = Math.floor(random() * 47);
    }
    grainContext.putImageData(image, 0, 0);
    grainContext.globalAlpha = 0.2;
    grainContext.strokeStyle = "#f5ead2";
    for (let index = 0; index < 44; index += 1) {
      const x = random() * grain.width;
      const y = random() * grain.height;
      grainContext.beginPath();
      grainContext.moveTo(x, y);
      grainContext.lineTo(x + 2 + random() * 8, y + random() * 1.3);
      grainContext.stroke();
    }
    return ctx.createPattern(grain, "repeat");
  }

  function roughOffset(seed, index, frame, amount) {
    const noise = hashUnit(seed + index * 0.73, frame % JITTER_FRAMES) * 2 - 1;
    return noise * amount;
  }

  function roughness(seed, x, y, frame, amount) {
    return {
      x: x + roughOffset(seed, x * 0.21 + y * 0.37, frame, amount),
      y: y + roughOffset(seed + 5.7, x * 0.29 - y * 0.19, frame, amount),
    };
  }

  function tracePoints(context, points, seed, frame, amount, close = true) {
    if (!points.length) return;
    points.forEach((point, index) => {
      const paperPoint = roughness(seed, point[0], point[1], frame, amount);
      if (index === 0) context.moveTo(paperPoint.x, paperPoint.y);
      else context.lineTo(paperPoint.x, paperPoint.y);
    });
    if (close) context.closePath();
  }

  function fillPolygon(context, points, fill, seed, frame, amount = 0.65, stroke = null) {
    context.beginPath();
    tracePoints(context, points, seed, frame, amount);
    context.fillStyle = fill;
    context.fill();
    if (stroke) {
      context.strokeStyle = stroke;
      context.lineWidth = 1.2;
      context.stroke();
    }
  }

  function traceBlob(context, cx, cy, radiusX, radiusY, seed, frame, amount, segments = 26) {
    context.beginPath();
    for (let index = 0; index < segments; index += 1) {
      const angle = (index / segments) * TAU;
      const edgeNoise = roughOffset(seed + 12.4, index, frame, amount);
      const ruff = 1 + roughOffset(seed, index + 31, frame, amount / Math.max(radiusX, radiusY));
      const x = cx + Math.cos(angle) * (radiusX + edgeNoise) * ruff;
      const y = cy + Math.sin(angle) * (radiusY + edgeNoise) * ruff;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
  }

  function fillBlob(context, cx, cy, radiusX, radiusY, fill, seed, frame, amount = 1.2, segments = 26) {
    traceBlob(context, cx, cy, radiusX, radiusY, seed, frame, amount, segments);
    context.fillStyle = fill;
    context.fill();
  }

  function drawBackground(time) {
    const frame = getLayerFrame(time);
    const sky = ctx.createLinearGradient(0, 0, 0, 420);
    sky.addColorStop(0, "#0b262c");
    sky.addColorStop(0.56, "#173b3d");
    sky.addColorStop(1, "#294840");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

    const moonGlow = ctx.createRadialGradient(764, 126, 10, 764, 126, 265);
    moonGlow.addColorStop(0, "rgba(224, 197, 122, 0.14)");
    moonGlow.addColorStop(0.38, "rgba(205, 181, 118, 0.07)");
    moonGlow.addColorStop(1, "rgba(205, 181, 118, 0)");
    ctx.fillStyle = moonGlow;
    ctx.fillRect(470, 0, 488, 400);

    drawStars(time);
    drawCloudBands(time);
    drawDistantHills(time);
    drawWater(time, frame);
    drawBanks(time, frame);
  }

  function drawStars(time) {
    const random = mulberry32(418);
    ctx.save();
    for (let index = 0; index < 34; index += 1) {
      const x = 32 + random() * 895;
      const y = 30 + random() * 268;
      if (x > 594 && y < 244) continue;
      const size = 0.55 + random() * 1.45;
      const pulse = 0.4 + (Math.sin(TAU * time * 0.5 + index * 1.7) + 1) * 0.24;
      ctx.globalAlpha = pulse;
      ctx.fillStyle = index % 6 === 0 ? "#e7c87e" : "#d9ddc8";
      ctx.beginPath();
      ctx.arc(x, y, size, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawCloudBands(time) {
    const drift = Math.sin((time / DURATION) * TAU) * 9;
    ctx.save();
    ctx.globalAlpha = 0.19;
    fillPolygon(
      ctx,
      [
        [-40 + drift, 184],
        [72 + drift, 168],
        [156 + drift, 178],
        [232 + drift, 164],
        [325 + drift, 178],
        [309 + drift, 197],
        [192 + drift, 194],
        [103 + drift, 206],
        [-40 + drift, 202],
      ],
      "#d7cba7",
      7,
      3,
      1.4,
    );
    ctx.globalAlpha = 0.12;
    fillPolygon(
      ctx,
      [
        [548 - drift, 265],
        [654 - drift, 250],
        [741 - drift, 258],
        [843 - drift, 244],
        [966 - drift, 260],
        [962 - drift, 282],
        [829 - drift, 279],
        [718 - drift, 289],
        [591 - drift, 283],
      ],
      "#e3d5ac",
      13,
      5,
      1.7,
    );
    ctx.restore();
  }

  function drawDistantHills(time) {
    const sway = Math.sin((time / DURATION) * TAU) * 1.8;
    fillPolygon(
      ctx,
      [
        [0, 322],
        [74, 292],
        [134, 301],
        [209, 270],
        [281, 287],
        [348, 252],
        [415, 296],
        [488, 267],
        [551, 291],
        [627, 258],
        [710, 282],
        [782, 246],
        [857, 275],
        [960, 238],
        [960, 401],
        [0, 401],
      ],
      "#173736",
      29,
      8,
      1.9,
    );
    fillPolygon(
      ctx,
      [
        [0, 350 + sway],
        [96, 322],
        [175, 330],
        [257, 312],
        [335, 334],
        [416, 318 + sway],
        [500, 343],
        [604, 320],
        [691, 338],
        [790, 316],
        [872, 331 + sway],
        [960, 312],
        [960, 429],
        [0, 432],
      ],
      "#12302f",
      37,
      11,
      1.4,
    );
  }

  function drawWater(time, frame) {
    const water = ctx.createLinearGradient(0, 336, 0, STAGE_HEIGHT);
    water.addColorStop(0, "#173c3b");
    water.addColorStop(0.35, "#0c2a2d");
    water.addColorStop(1, "#071f24");
    ctx.fillStyle = water;
    ctx.beginPath();
    ctx.moveTo(0, 362);
    for (let x = 0; x <= STAGE_WIDTH; x += 48) {
      const y = 360 + Math.sin(x * 0.021 + time * 0.7) * 4;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(STAGE_WIDTH, STAGE_HEIGHT);
    ctx.lineTo(0, STAGE_HEIGHT);
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.lineCap = "round";
    for (let band = 0; band < 7; band += 1) {
      const baseY = 378 + band * 23;
      const drift = (time * (7 + band * 0.9)) % 76;
      ctx.globalAlpha = 0.12 + band * 0.012;
      ctx.strokeStyle = band % 3 === 0 ? "#e5d2a0" : "#9ab4a4";
      ctx.lineWidth = band % 3 === 0 ? 1.2 : 0.8;
      ctx.beginPath();
      for (let x = -80; x < STAGE_WIDTH + 80; x += 22) {
        const y = baseY + Math.sin((x + drift) * 0.048 + band * 1.4) * 3.2;
        if (x === -80) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    const random = mulberry32(93);
    for (let index = 0; index < 24; index += 1) {
      const x = 46 + random() * 872;
      const y = 390 + random() * 134;
      const length = 2 + random() * 12;
      const wiggle = Math.sin(time * 0.54 + index) * 2;
      ctx.globalAlpha = 0.14 + (index % 4) * 0.025;
      ctx.strokeStyle = "#ead9ae";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x + wiggle, y);
      ctx.quadraticCurveTo(x + length * 0.5, y - 1.4, x + length, y);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = "#e6d39f";
    ctx.lineWidth = 1;
    for (let ring = 0; ring < 3; ring += 1) {
      const radius = 86 + ring * 25;
      ctx.beginPath();
      ctx.ellipse(482, 413, radius, radius * 0.14, 0, 0.2, Math.PI - 0.2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBanks(time, frame) {
    fillPolygon(
      ctx,
      [
        [-12, 369],
        [44, 361],
        [101, 372],
        [156, 363],
        [213, 381],
        [263, 371],
        [318, 398],
        [350, 432],
        [354, 548],
        [-12, 548],
      ],
      "#0b2326",
      53,
      frame,
      1.8,
    );
    fillPolygon(
      ctx,
      [
        [644, 397],
        [686, 379],
        [737, 384],
        [783, 372],
        [831, 382],
        [882, 370],
        [930, 379],
        [972, 365],
        [972, 548],
        [618, 548],
        [618, 429],
      ],
      "#0b2326",
      59,
      frame,
      1.7,
    );

    ctx.save();
    ctx.strokeStyle = "rgba(210, 193, 151, 0.24)";
    ctx.lineWidth = 1;
    const grass = mulberry32(177);
    for (let index = 0; index < 42; index += 1) {
      const leftSide = index < 23;
      const x = leftSide ? 10 + grass() * 322 : 650 + grass() * 300;
      const y = 383 + grass() * 63;
      const height = 7 + grass() * 22;
      const lean = Math.sin(TAU * time / DURATION + index) * 2.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + lean * 0.3, y - height * 0.55, x + lean, y - height);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPaperOverlay() {
    ctx.save();
    if (grainPattern) {
      ctx.globalAlpha = 0.17;
      ctx.globalCompositeOperation = "soft-light";
      ctx.fillStyle = grainPattern;
      ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
    }
    const vignette = ctx.createRadialGradient(
      STAGE_WIDTH / 2,
      STAGE_HEIGHT / 2,
      STAGE_HEIGHT * 0.25,
      STAGE_WIDTH / 2,
      STAGE_HEIGHT / 2,
      STAGE_WIDTH * 0.62,
    );
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, "rgba(2, 12, 14, 0.42)");
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
    ctx.restore();
  }

  function getLayerPose(layer, time) {
    const local = wrapTime(time);
    const frame = getLayerFrame(local);
    const seed = layerSeed(layer);
    const entrance = layer.entrance;
    const entranceProgress =
      local < entrance.delay ? 0 : easeOutCubic((local - entrance.delay) / Math.max(0.01, entrance.duration));
    const fadeProgress =
      local < entrance.delay
        ? 0
        : smoothstep((local - entrance.delay) / Math.min(0.6, Math.max(0.2, entrance.duration * 0.5)));
    const jitterX =
      loopNoise(seed, frame) * layer.jitter +
      loopNoise(seed + 9.1, frame, JITTER_FRAMES / 2) * layer.jitter * 0.34;
    const jitterY =
      loopNoise(seed + 3.7, frame) * layer.jitter +
      loopNoise(seed + 12.8, frame, JITTER_FRAMES / 3) * layer.jitter * 0.28;
    const phase = (local / DURATION) * TAU;
    const pose = {
      x: 0,
      y: 0,
      rotation: 0,
      scale: 1,
      alpha: fadeProgress,
      frame,
      seed,
      local,
    };

    if (layer.id === "moon") {
      pose.x = 765 + Math.sin(phase) * 2 + jitterX;
      pose.y = 128 + Math.cos(phase * 2) * 2.4 + jitterY;
      pose.rotation = Math.sin(phase) * 0.016;
      pose.scale = 0.94 + entranceProgress * 0.06;
    } else if (layer.id === "tree") {
      pose.x = 178 + jitterX;
      pose.y = 452 + jitterY;
      pose.rotation = Math.sin(phase) * 0.006;
      pose.scale = 1.08 + (1 - entranceProgress) * 0.035;
    } else if (layer.id === "boat") {
      pose.x = 493 + Math.sin(phase * 2) * 9 + jitterX;
      pose.y = 414 + Math.sin(phase * 4) * 1.7 + jitterY;
      pose.rotation = Math.sin(phase * 2) * 0.025;
      pose.scale = 0.94 + (1 - entranceProgress) * 0.04;
    } else if (layer.id === "person") {
      pose.x = 714 + Math.sin(phase) * 1.4 + jitterX;
      pose.y = 437 + Math.sin(phase * 2) * 0.6 + jitterY;
      pose.rotation = Math.sin(phase) * 0.006;
      pose.scale = 0.98;
    }

    pose.x += (1 - entranceProgress) * entrance.x;
    pose.y += (1 - entranceProgress) * entrance.y;
    return pose;
  }

  function drawLayer(layer, time) {
    if (!layer.visible) return;
    const pose = getLayerPose(layer, time);
    if (pose.alpha <= 0.002) return;

    ctx.save();
    ctx.globalAlpha = pose.alpha;
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.rotation);
    ctx.scale(pose.scale, pose.scale);
    if (layer.id === "moon") drawMoon(layer, pose);
    else if (layer.id === "tree") drawTree(layer, pose);
    else if (layer.id === "boat") drawBoat(layer, pose);
    else if (layer.id === "person") drawPerson(layer, pose);
    ctx.restore();
  }

  function drawMoon(layer, pose) {
    const { frame, seed } = pose;
    ctx.save();
    ctx.globalAlpha *= 0.28;
    fillBlob(ctx, 9, 11, 89, 89, "#031012", seed + 3, frame, 1.5, 32);
    ctx.restore();

    fillBlob(ctx, 0, 0, 88, 88, layer.color, seed, frame, 1.7, 34);
    fillBlob(ctx, -4, -4, 81, 81, "#e7d49e", seed + 1, frame, 1.1, 33);
    fillBlob(ctx, -8, -8, 73, 73, "#eddaa7", seed + 2, frame, 0.8, 32);

    const craters = [
      [-32, -20, 13, 10, 0.16],
      [24, -39, 8, 7, 0.1],
      [36, 23, 17, 13, 0.13],
      [-22, 36, 10, 8, 0.11],
      [3, 4, 5, 4, 0.08],
    ];
    craters.forEach((crater, index) => {
      fillBlob(
        ctx,
        crater[0],
        crater[1],
        crater[2],
        crater[3],
        `rgba(117, 89, 43, ${crater[4]})`,
        seed + index * 2.7,
        frame,
        1.1,
        15,
      );
    });

    ctx.save();
    ctx.globalAlpha *= 0.42;
    ctx.strokeStyle = "#bfa262";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(-3, -3, 79, -2.55, -0.65);
    ctx.stroke();
    ctx.restore();

    fillPolygon(
      ctx,
      [
        [-47, -61],
        [-36, -65],
        [-39, -56],
        [-31, -54],
        [-38, -48],
        [-48, -51],
      ],
      "rgba(197, 156, 70, 0.28)",
      seed + 19,
      frame,
      0.7,
    );
  }

  function drawTree(layer, pose) {
    const { frame, seed } = pose;

    ctx.save();
    ctx.globalAlpha *= 0.4;
    ctx.translate(12, 7);
    drawTreeSilhouette(seed + 20, frame, "#061718");
    ctx.restore();
    drawTreeSilhouette(seed, frame, "#142822");

    const clusters = [
      [-131, -217, 57, 45, "#1b342b"],
      [-96, -266, 62, 53, "#1d392e"],
      [-45, -302, 67, 52, "#203c30"],
      [13, -322, 65, 51, "#183329"],
      [68, -288, 57, 48, "#1d392d"],
      [108, -248, 46, 41, "#203d30"],
      [-142, -170, 43, 34, "#193529"],
      [-49, -227, 65, 48, "#234033"],
      [44, -228, 58, 45, "#1a352a"],
      [7, -268, 52, 42, "#284536"],
      [-106, -313, 38, 32, "#294737"],
      [91, -311, 39, 30, "#214032"],
    ];
    clusters.forEach((cluster, index) => {
      fillBlob(
        ctx,
        cluster[0],
        cluster[1],
        cluster[2],
        cluster[3],
        cluster[4],
        seed + index * 4.2,
        frame,
        1.4,
        20,
      );
    });

    const cuts = [
      [-111, -259, 15, 7, -0.25],
      [-54, -288, 18, 7, -0.1],
      [27, -303, 13, 6, -0.15],
      [75, -265, 12, 6, -0.3],
      [-24, -212, 17, 7, -0.2],
      [-126, -185, 11, 5, -0.2],
    ];
    cuts.forEach((cut, index) => {
      ctx.save();
      ctx.translate(cut[0], cut[1]);
      ctx.rotate(cut[4]);
      fillBlob(
        ctx,
        0,
        0,
        cut[2],
        cut[3],
        index % 2 === 0 ? "#365440" : "#31503c",
        seed + 31 + index,
        frame,
        0.7,
        12,
      );
      ctx.restore();
    });
  }

  function drawTreeSilhouette(seed, frame, fill) {
    const trunk = [
      [-46, 22],
      [-38, -34],
      [-51, -72],
      [-89, -121],
      [-137, -162],
      [-166, -188],
      [-159, -207],
      [-135, -195],
      [-94, -156],
      [-53, -110],
      [-36, -73],
      [-25, -129],
      [-31, -181],
      [-20, -241],
      [-8, -295],
      [0, -325],
      [17, -321],
      [12, -269],
      [10, -219],
      [19, -172],
      [35, -126],
      [58, -158],
      [88, -194],
      [119, -226],
      [145, -249],
      [158, -244],
      [143, -218],
      [111, -180],
      [73, -137],
      [53, -95],
      [48, -51],
      [58, 22],
    ];
    fillPolygon(ctx, trunk, fill, seed, frame, 1.15);
    ctx.save();
    ctx.strokeStyle = fill;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(-30, -196);
    ctx.quadraticCurveTo(-66, -231, -105, -267);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(24, -213);
    ctx.quadraticCurveTo(61, -249, 92, -285);
    ctx.stroke();
    ctx.restore();
  }

  function drawBoat(layer, pose) {
    const { frame, seed, local } = pose;
    const ripple = Math.sin((local / DURATION) * TAU * 2) * 2;

    ctx.save();
    ctx.globalAlpha *= 0.24;
    ctx.strokeStyle = "#e7d3a4";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(2 + ripple, 14, 112, 13, 0, 0.15, Math.PI - 0.14);
    ctx.stroke();
    ctx.globalAlpha *= 0.6;
    ctx.beginPath();
    ctx.ellipse(-10 - ripple, 19, 88, 9, 0, 0.25, Math.PI - 0.2);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha *= 0.35;
    ctx.translate(9, 9);
    fillPolygon(
      ctx,
      [
        [-91, -2],
        [91, -2],
        [61, 38],
        [-58, 41],
      ],
      "#03171a",
      seed + 2,
      frame,
      1,
    );
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "#28352d";
    ctx.lineWidth = 2.3;
    ctx.beginPath();
    ctx.moveTo(2, -93);
    ctx.lineTo(2, 12);
    ctx.stroke();
    ctx.restore();

    fillPolygon(
      ctx,
      [
        [-3, -94],
        [-66, -4],
        [-7, 5],
      ],
      "#e9dab7",
      seed + 4,
      frame,
      0.6,
      "rgba(82, 72, 51, 0.4)",
    );
    fillPolygon(
      ctx,
      [
        [3, -93],
        [62, -6],
        [8, 5],
      ],
      "#ccb98f",
      seed + 5,
      frame,
      0.6,
      "rgba(82, 72, 51, 0.35)",
    );
    fillPolygon(
      ctx,
      [
        [2, -87],
        [-51, -4],
        [2, 1],
      ],
      "rgba(248, 238, 210, 0.46)",
      seed + 7,
      frame,
      0.4,
    );

    fillPolygon(
      ctx,
      [
        [-93, -5],
        [93, -5],
        [58, 40],
        [-58, 41],
      ],
      "#dfceaa",
      seed + 9,
      frame,
      1.15,
      "#394236",
    );
    fillPolygon(
      ctx,
      [
        [-84, -1],
        [0, -1],
        [-19, 35],
        [-56, 36],
      ],
      "#cdbb96",
      seed + 11,
      frame,
      0.7,
    );
    fillPolygon(
      ctx,
      [
        [0, -1],
        [84, -1],
        [55, 36],
        [19, 35],
      ],
      "rgba(250, 241, 217, 0.4)",
      seed + 13,
      frame,
      0.5,
    );
    fillPolygon(
      ctx,
      [
        [-92, -5],
        [92, -5],
        [88, 2],
        [-88, 2],
      ],
      "#f1e3c1",
      seed + 15,
      frame,
      0.35,
    );

    ctx.save();
    ctx.globalAlpha *= 0.64;
    ctx.strokeStyle = "#594f3e";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-2, 3);
    ctx.lineTo(-23, 33);
    ctx.moveTo(-14, 0);
    ctx.lineTo(-55, 35);
    ctx.moveTo(12, 0);
    ctx.lineTo(52, 34);
    ctx.stroke();
    ctx.restore();

    fillPolygon(
      ctx,
      [
        [2, -92],
        [23, -84],
        [5, -78],
      ],
      "#a8422d",
      seed + 18,
      frame,
      0.5,
    );

    ctx.save();
    ctx.globalAlpha *= 0.32;
    ctx.strokeStyle = "#f4e8cf";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-70, 8);
    ctx.quadraticCurveTo(-35, 11, -4, 9);
    ctx.stroke();
    ctx.restore();
  }

  function drawPerson(layer, pose) {
    const { frame, seed, local } = pose;
    const silhouette = "#192522";
    const edge = "#557065";
    const wave = Math.sin((local / DURATION) * TAU * 3);

    ctx.save();
    ctx.globalAlpha *= 0.3;
    fillBlob(ctx, 12, 7, 48, 9, "#031719", seed + 3, frame, 1, 18);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "#343b31";
    ctx.lineCap = "round";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(34, 10);
    ctx.lineTo(58, -94);
    ctx.stroke();
    fillPolygon(
      ctx,
      [
        [43, 18],
        [58, 5],
        [82, 22],
        [65, 42],
      ],
      "#8c774d",
      seed + 5,
      frame,
      0.8,
      "#2b332b",
    );
    ctx.restore();

    fillPolygon(
      ctx,
      [
        [-3, -16],
        [0, -68],
        [8, -69],
        [8, -15],
        [3, -4],
        [6, 0],
        [13, -3],
        [14, -17],
      ],
      silhouette,
      seed + 8,
      frame,
      0.7,
      edge,
    );
    fillPolygon(
      ctx,
      [
        [-20, -66],
        [-16, -18],
        [-10, -15],
        [-8, 1],
        [-1, -3],
        [-3, -40],
      ],
      silhouette,
      seed + 9,
      frame,
      0.6,
      edge,
    );

    fillPolygon(
      ctx,
      [
        [-24, -116],
        [-14, -122],
        [15, -120],
        [27, -105],
        [19, -76],
        [13, -46],
        [9, -22],
        [-11, -21],
        [-19, -56],
        [-30, -89],
      ],
      silhouette,
      seed + 12,
      frame,
      1,
      edge,
    );
    fillPolygon(
      ctx,
      [
        [-22, -113],
        [-14, -119],
        [10, -117],
        [21, -102],
        [14, -84],
        [-22, -88],
      ],
      "rgba(49, 73, 62, 0.55)",
      seed + 14,
      frame,
      0.7,
    );

    fillPolygon(
      ctx,
      [
        [-14, -119],
        [-9, -126],
        [26, -123],
        [33, -113],
        [12, -108],
        [-17, -111],
      ],
      "#a64431",
      seed + 17,
      frame,
      0.5,
    );
    fillPolygon(
      ctx,
      [
        [26, -114],
        [43, -102],
        [38, -94],
        [23, -104],
      ],
      "#8e3828",
      seed + 19,
      frame,
      0.45,
    );

    fillBlob(ctx, 0, -139, 13, 15, silhouette, seed + 21, frame, 0.6, 14);
    fillPolygon(
      ctx,
      [
        [-19, -153],
        [17, -154],
        [22, -148],
        [4, -144],
        [-17, -146],
      ],
      silhouette,
      seed + 23,
      frame,
      0.45,
      edge,
    );
    fillPolygon(
      ctx,
      [
        [-7, -154],
        [7, -167],
        [15, -154],
      ],
      silhouette,
      seed + 24,
      frame,
      0.5,
    );

    ctx.save();
    ctx.translate(10, -108);
    ctx.rotate(-0.22 + wave * 0.12);
    ctx.strokeStyle = silhouette;
    ctx.lineWidth = 9;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-2, 0);
    ctx.quadraticCurveTo(-23, -31, -28, -53);
    ctx.stroke();
    ctx.fillStyle = silhouette;
    ctx.beginPath();
    ctx.arc(-29, -57, 6.5, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha *= 0.75;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-17, -74);
    ctx.lineTo(14, -74);
    ctx.moveTo(-14, -53);
    ctx.lineTo(11, -52);
    ctx.stroke();
    ctx.restore();
  }

  function renderFrame(time) {
    const safeTime = clamp(wrapTime(time), 0, DURATION - 1 / PROJECT_FPS);
    currentTime = safeTime;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
    drawBackground(safeTime);
    for (let index = state.layers.length - 1; index >= 0; index -= 1) {
      drawLayer(state.layers[index], safeTime);
    }
    drawPaperOverlay();
    syncTimeUI();
  }

  function syncTimeUI() {
    ui.timecode.textContent = formatTimecode(currentTime);
    ui.frameReadout.textContent = `FRAME ${String(Math.floor(currentTime * PROJECT_FPS)).padStart(3, "0")} / ${DURATION * PROJECT_FPS}`;
    ui.playhead.style.left = `${(currentTime / DURATION) * 100}%`;
  }

  function buildRuler() {
    const fragment = document.createDocumentFragment();
    for (let halfSecond = 0; halfSecond <= DURATION * 2; halfSecond += 1) {
      const seconds = halfSecond / 2;
      const tick = document.createElement("span");
      tick.className = `ruler-tick${Number.isInteger(seconds) ? " major" : ""}`;
      tick.style.left = `${(seconds / DURATION) * 100}%`;
      if (Number.isInteger(seconds)) {
        const label = document.createElement("span");
        label.textContent = `${seconds}s`;
        tick.append(label);
      }
      fragment.append(tick);
    }
    ui.ruler.replaceChildren(fragment);
  }

  function layerPositionLabel(index) {
    if (index === 0) return "最上层";
    if (index === state.layers.length - 1) return "最下层";
    return `第 ${index + 1} 层`;
  }

  function createTrackLabel(layer, index) {
    const label = document.createElement("div");
    label.className = "track-label";
    label.dataset.layerId = layer.id;
    label.style.setProperty("--layer-color", layer.color);
    if (layer.id === selectedLayerId) label.classList.add("is-selected");

    const grip = document.createElement("button");
    grip.className = "track-grip";
    grip.type = "button";
    grip.title = "拖动调整图层顺序";
    grip.setAttribute("aria-label", `拖动调整${layer.name}的图层顺序`);
    grip.addEventListener("pointerdown", (event) => beginLayerDrag(event, layer.id));
    grip.addEventListener("keydown", (event) => {
      if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
      event.preventDefault();
      moveLayerByKeyboard(layer.id, event.key === "ArrowUp" ? -1 : 1);
      const nextGrip = ui.tracksLabelColumn.querySelector(`[data-layer-id="${layer.id}"] .track-grip`);
      nextGrip?.focus();
    });

    const thumb = document.createElement("span");
    thumb.className = "track-thumb";
    thumb.textContent = layer.glyph;

    const copy = document.createElement("span");
    copy.className = "track-copy";
    const name = document.createElement("strong");
    name.textContent = layer.name;
    const position = document.createElement("span");
    position.textContent = layerPositionLabel(index);
    copy.append(name, position);

    const order = document.createElement("span");
    order.className = "track-order";
    order.textContent = String(index + 1).padStart(2, "0");
    label.append(grip, thumb, copy, order);
    label.addEventListener("pointerdown", (event) => {
      if (event.target.closest(".track-grip")) return;
      selectLayer(layer.id);
    });
    return label;
  }

  function createTrackRow(layer, index) {
    const row = document.createElement("div");
    row.className = "track-row";
    row.dataset.layerId = layer.id;
    row.style.setProperty("--layer-color", layer.color);
    if (layer.id === selectedLayerId) row.classList.add("is-selected");

    const bar = document.createElement("div");
    bar.className = "track-bar";
    bar.style.setProperty("--layer-color", layer.color);
    const endTime = clamp(layer.entrance.delay + layer.entrance.duration, 0.2, DURATION);
    bar.style.setProperty("--entry-width", `${(endTime / DURATION) * 100}%`);

    const entry = document.createElement("span");
    entry.className = "bar-entry";
    const barLabel = document.createElement("span");
    barLabel.className = "bar-label";
    barLabel.textContent = `IN ${layer.entrance.delay.toFixed(2)}s · HOLD`;
    bar.append(entry, barLabel);

    if (layer.id === "boat") {
      PADDLE_EVENTS.forEach((eventTime) => {
        const tick = document.createElement("span");
        tick.className = "sound-tick";
        tick.style.left = `${(eventTime / DURATION) * 100}%`;
        bar.append(tick);
      });
    }
    row.append(bar);
    return row;
  }

  function renderTimeline() {
    const labelFragment = document.createDocumentFragment();
    const rowFragment = document.createDocumentFragment();
    state.layers.forEach((layer, index) => {
      labelFragment.append(createTrackLabel(layer, index));
      rowFragment.append(createTrackRow(layer, index));
    });
    ui.tracksLabelColumn.replaceChildren(labelFragment);
    ui.timelineGrid.replaceChildren(rowFragment);
  }

  function selectLayer(layerId) {
    if (!LAYER_META[layerId] || selectedLayerId === layerId) return;
    selectedLayerId = layerId;
    state.selectedLayer = layerId;
    syncInspector();
    renderTimeline();
  }

  function syncInspector() {
    const layer = getSelectedLayer();
    const index = state.layers.findIndex((item) => item.id === layer.id);
    ui.layerIndex.textContent = `${String(index + 1).padStart(2, "0")} / ${String(state.layers.length).padStart(2, "0")}`;
    ui.layerEmblem.textContent = layer.glyph;
    ui.layerEmblem.style.backgroundColor = layer.color;
    ui.layerEmblem.style.color = layer.id === "boat" || layer.id === "moon" || layer.id === "tree" ? "#17231f" : "#f8f3e8";
    ui.selectedLayerName.textContent = layer.name;
    ui.layerChip.textContent = layerPositionLabel(index);

    ui.jitterRange.value = layer.jitter;
    ui.jitterValue.textContent = `${layer.jitter.toFixed(1)} px`;
    setRangeProgress(ui.jitterRange);
    ui.offsetXRange.value = layer.entrance.x;
    ui.offsetXValue.textContent = formatSigned(layer.entrance.x);
    setRangeProgress(ui.offsetXRange);
    ui.offsetYRange.value = layer.entrance.y;
    ui.offsetYValue.textContent = formatSigned(layer.entrance.y);
    setRangeProgress(ui.offsetYRange);
    ui.delayRange.value = layer.entrance.delay;
    ui.delayValue.textContent = `${layer.entrance.delay.toFixed(2)} s`;
    setRangeProgress(ui.delayRange);
    ui.entranceRange.value = layer.entrance.duration;
    ui.entranceValue.textContent = `${layer.entrance.duration.toFixed(2)} s`;
    setRangeProgress(ui.entranceRange);
  }

  function setPlaybackUI() {
    ui.playButton.classList.toggle("is-playing", isPlaying);
    ui.playLabel.textContent = isPlaying ? "暂停" : "播放";
    ui.playButton.setAttribute("aria-pressed", String(isPlaying));
    ui.soundButton.setAttribute("aria-pressed", String(state.audioOn));
  }

  function setTime(time) {
    const snapped = Math.round(clamp(time, 0, DURATION - 1 / PROJECT_FPS) * PROJECT_FPS) / PROJECT_FPS;
    currentTime = snapped;
    renderFrame(currentTime);
  }

  function startPlayback() {
    if (isPlaying) return;
    if (currentTime >= DURATION - 1 / PROJECT_FPS) currentTime = 0;
    isPlaying = true;
    playbackOrigin = currentTime;
    playbackStart = performance.now();
    lastAudioTime = currentTime;
    if (state.audioOn) {
      ensureAudio();
      audio?.startWind();
    }
    setPlaybackUI();
    playbackRaf = requestAnimationFrame(playbackTick);
  }

  function playbackTick(now) {
    if (!isPlaying) return;
    const rawTime = playbackOrigin + (now - playbackStart) / 1000;
    const nextTime = rawTime % DURATION;
    if (state.audioOn) {
      PADDLE_EVENTS.forEach((eventTime) => {
        if (crossedTime(lastAudioTime, nextTime, eventTime)) audio?.paddle(eventTime);
      });
    }
    lastAudioTime = nextTime;
    renderFrame(nextTime);
    playbackRaf = requestAnimationFrame(playbackTick);
  }

  function pausePlayback() {
    if (!isPlaying) {
      audio?.stopWind();
      return;
    }
    isPlaying = false;
    cancelAnimationFrame(playbackRaf);
    playbackRaf = 0;
    currentTime = Math.round(currentTime * PROJECT_FPS) / PROJECT_FPS;
    lastAudioTime = currentTime;
    audio?.stopWind();
    setPlaybackUI();
    renderFrame(currentTime);
  }

  function togglePlayback() {
    if (isPlaying) pausePlayback();
    else startPlayback();
  }

  function crossedTime(previous, current, marker) {
    if (current >= previous) return marker > previous && marker <= current;
    return marker > previous || marker <= current;
  }

  function goToStart() {
    if (isPlaying) {
      playbackOrigin = 0;
      playbackStart = performance.now();
      lastAudioTime = 0;
    }
    setTime(0);
    renderFrame(0);
  }

  class PaperAudio {
    constructor() {
      this.context = null;
      this.master = null;
      this.noiseBuffer = null;
      this.wind = null;
    }

    ensure() {
      if (this.context) {
        if (this.context.state === "suspended") this.context.resume().catch(() => {});
        return true;
      }
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return false;
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.context.destination);
      this.noiseBuffer = this.createNoiseBuffer(3);
      return true;
    }

    createNoiseBuffer(seconds) {
      const length = Math.floor(this.context.sampleRate * seconds);
      const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
      const channel = buffer.getChannelData(0);
      let previous = 0;
      const random = mulberry32(801);
      for (let index = 0; index < length; index += 1) {
        const white = random() * 2 - 1;
        previous = previous * 0.84 + white * 0.16;
        channel[index] = previous * 1.6;
      }
      return buffer;
    }

    startWind() {
      if (!this.ensure() || this.wind) return;
      const now = this.context.currentTime;
      const source = this.context.createBufferSource();
      source.buffer = this.noiseBuffer;
      source.loop = true;

      const highPass = this.context.createBiquadFilter();
      highPass.type = "highpass";
      highPass.frequency.value = 90;
      highPass.Q.value = 0.25;

      const band = this.context.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 480;
      band.Q.value = 0.46;

      const lowPass = this.context.createBiquadFilter();
      lowPass.type = "lowpass";
      lowPass.frequency.value = 1550;
      lowPass.Q.value = 0.3;

      const gain = this.context.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.07, now + 0.65);

      const breeze = this.context.createOscillator();
      breeze.type = "sine";
      breeze.frequency.value = 0.115;
      const breezeDepth = this.context.createGain();
      breezeDepth.gain.value = 0.026;
      breeze.connect(breezeDepth).connect(gain.gain);

      const filterDrift = this.context.createOscillator();
      filterDrift.type = "sine";
      filterDrift.frequency.value = 0.067;
      const filterDepth = this.context.createGain();
      filterDepth.gain.value = 170;
      filterDrift.connect(filterDepth).connect(band.frequency);

      source.connect(highPass).connect(band).connect(lowPass).connect(gain).connect(this.master);
      source.start(now);
      breeze.start(now);
      filterDrift.start(now);
      this.wind = { source, gain, breeze, filterDrift, band };
    }

    stopWind() {
      if (!this.wind || !this.context) return;
      const wind = this.wind;
      const now = this.context.currentTime;
      this.wind = null;
      wind.gain.gain.cancelScheduledValues(now);
      wind.gain.gain.setValueAtTime(Math.max(0.0001, wind.gain.gain.value), now);
      wind.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      try {
        wind.source.stop(now + 0.32);
        wind.breeze.stop(now + 0.32);
        wind.filterDrift.stop(now + 0.32);
      } catch (error) {
        // A stopped Web Audio source cannot be stopped twice.
      }
    }

    paddle(eventTime) {
      if (!this.ensure()) return;
      const now = this.context.currentTime;
      const variation = hashUnit(eventTime + 1.7, Math.floor(eventTime * 10));

      const splash = this.context.createBufferSource();
      splash.buffer = this.noiseBuffer;
      splash.playbackRate.value = 0.82 + variation * 0.22;
      const band = this.context.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 520 + variation * 160;
      band.Q.value = 0.95;
      const splashGain = this.context.createGain();
      splashGain.gain.setValueAtTime(0.0001, now);
      splashGain.gain.exponentialRampToValueAtTime(0.13, now + 0.025);
      splashGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.33);
      splash.connect(band).connect(splashGain).connect(this.master);
      splash.start(now);
      splash.stop(now + 0.36);

      const knock = this.context.createOscillator();
      knock.type = "sine";
      knock.frequency.setValueAtTime(118 + variation * 18, now);
      knock.frequency.exponentialRampToValueAtTime(47, now + 0.2);
      const knockGain = this.context.createGain();
      knockGain.gain.setValueAtTime(0.0001, now);
      knockGain.gain.exponentialRampToValueAtTime(0.09, now + 0.012);
      knockGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
      knock.connect(knockGain).connect(this.master);
      knock.start(now);
      knock.stop(now + 0.27);
    }
  }

  function updateSelectedLayer(mutator, { rebuildTimeline = true } = {}) {
    const layer = getSelectedLayer();
    mutator(layer);
    setDirty(true);
    renderFrame(currentTime);
    if (rebuildTimeline) renderTimeline();
  }

  function bindInspectorControls() {
    ui.jitterRange.addEventListener("input", () => {
      const value = Number(ui.jitterRange.value);
      ui.jitterValue.textContent = `${value.toFixed(1)} px`;
      setRangeProgress(ui.jitterRange);
      updateSelectedLayer((layer) => {
        layer.jitter = value;
      });
    });

    ui.offsetXRange.addEventListener("input", () => {
      const value = Number(ui.offsetXRange.value);
      ui.offsetXValue.textContent = formatSigned(value);
      setRangeProgress(ui.offsetXRange);
      updateSelectedLayer((layer) => {
        layer.entrance.x = value;
      });
    });

    ui.offsetYRange.addEventListener("input", () => {
      const value = Number(ui.offsetYRange.value);
      ui.offsetYValue.textContent = formatSigned(value);
      setRangeProgress(ui.offsetYRange);
      updateSelectedLayer((layer) => {
        layer.entrance.y = value;
      });
    });

    ui.delayRange.addEventListener("input", () => {
      const value = Number(ui.delayRange.value);
      ui.delayValue.textContent = `${value.toFixed(2)} s`;
      setRangeProgress(ui.delayRange);
      updateSelectedLayer((layer) => {
        layer.entrance.delay = value;
      });
    });

    ui.entranceRange.addEventListener("input", () => {
      const value = Number(ui.entranceRange.value);
      ui.entranceValue.textContent = `${value.toFixed(2)} s`;
      setRangeProgress(ui.entranceRange);
      updateSelectedLayer((layer) => {
        layer.entrance.duration = value;
      });
    });

    ui.resetOffsetButton.addEventListener("click", () => {
      updateSelectedLayer((layer) => {
        layer.entrance.x = 0;
        layer.entrance.y = 0;
      });
      syncInspector();
      showToast("入场偏移已归零");
    });
  }

  function timeFromPointer(event) {
    const rect = ui.timelineSurface.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    return ratio * DURATION;
  }

  function selectedRowAtPointer(event) {
    const rect = ui.timelineSurface.getBoundingClientRect();
    const rowHeight = rect.height / Math.max(1, state.layers.length);
    const index = clamp(Math.floor((event.clientY - rect.top) / rowHeight), 0, state.layers.length - 1);
    return state.layers[index];
  }

  function beginScrub(event) {
    if (event.button !== 0 || event.target.closest(".track-grip")) return;
    pausePlayback();
    scrubPointerId = event.pointerId;
    ui.timelineSurface.setPointerCapture(event.pointerId);
    ui.timelineSurface.classList.add("is-scrubbing");
    const rowLayer = selectedRowAtPointer(event);
    if (rowLayer) selectLayer(rowLayer.id);
    setTime(timeFromPointer(event));
    event.preventDefault();
  }

  function moveScrub(event) {
    if (scrubPointerId !== event.pointerId) return;
    setTime(timeFromPointer(event));
  }

  function endScrub(event) {
    if (scrubPointerId !== event.pointerId) return;
    scrubPointerId = null;
    ui.timelineSurface.classList.remove("is-scrubbing");
    if (ui.timelineSurface.hasPointerCapture(event.pointerId)) {
      ui.timelineSurface.releasePointerCapture(event.pointerId);
    }
  }

  function beginLayerDrag(event, layerId) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const sourceIndex = state.layers.findIndex((layer) => layer.id === layerId);
    dragState = {
      layerId,
      sourceIndex,
      targetIndex: sourceIndex,
      pointerId: event.pointerId,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    updateDropIndicator();
    const source = ui.tracksLabelColumn.querySelector(`[data-layer-id="${layerId}"]`);
    source?.classList.add("is-dragging");
    window.addEventListener("pointermove", moveLayerDrag);
    window.addEventListener("pointerup", endLayerDrag);
    window.addEventListener("pointercancel", endLayerDrag);
  }

  function moveLayerDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const labels = Array.from(ui.tracksLabelColumn.querySelectorAll(".track-label"));
    let insertion = labels.length;
    for (let index = 0; index < labels.length; index += 1) {
      const rect = labels[index].getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        insertion = index;
        break;
      }
    }
    dragState.targetIndex = insertion;
    updateDropIndicator();
  }

  function updateDropIndicator() {
    ui.tracksLabelColumn.querySelectorAll(".track-label").forEach((label) => {
      label.classList.remove("is-drop-target", "is-drop-after");
    });
    if (!dragState) return;
    const labels = Array.from(ui.tracksLabelColumn.querySelectorAll(".track-label"));
    if (!labels.length) return;
    if (dragState.targetIndex >= labels.length) {
      labels[labels.length - 1].classList.add("is-drop-after");
    } else {
      labels[dragState.targetIndex].classList.add("is-drop-target");
    }
  }

  function endLayerDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const drag = dragState;
    dragState = null;
    window.removeEventListener("pointermove", moveLayerDrag);
    window.removeEventListener("pointerup", endLayerDrag);
    window.removeEventListener("pointercancel", endLayerDrag);

    const [movedLayer] = state.layers.splice(drag.sourceIndex, 1);
    let insertion = drag.targetIndex;
    if (drag.sourceIndex < insertion) insertion -= 1;
    insertion = clamp(insertion, 0, state.layers.length);
    state.layers.splice(insertion, 0, movedLayer);

    if (drag.sourceIndex !== insertion) {
      setDirty(true);
      showToast(`${movedLayer.name}已移至${layerPositionLabel(insertion)}`);
    }
    renderTimeline();
    syncInspector();
    renderFrame(currentTime);
  }

  function moveLayerByKeyboard(layerId, direction) {
    const sourceIndex = state.layers.findIndex((layer) => layer.id === layerId);
    const destination = clamp(sourceIndex + direction, 0, state.layers.length - 1);
    if (sourceIndex === destination) return;
    const [layer] = state.layers.splice(sourceIndex, 1);
    state.layers.splice(destination, 0, layer);
    setDirty(true);
    renderTimeline();
    syncInspector();
    renderFrame(currentTime);
  }

  function normalizeProject(rawProject) {
    let raw = rawProject;
    if (typeof raw === "string") raw = JSON.parse(raw);
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.layers)) {
      throw new Error("不是有效的剪纸工程文件");
    }
    if (raw.layers.length !== 4) throw new Error("工程必须包含四个图层");

    const seen = new Set();
    const layers = raw.layers.map((candidate) => {
      if (!candidate || !LAYER_META[candidate.id]) throw new Error("工程包含未知图层");
      if (seen.has(candidate.id)) throw new Error("工程图层重复");
      seen.add(candidate.id);
      const meta = LAYER_META[candidate.id];
      const entrance = candidate.entrance || {};
      const finite = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
      return {
        id: candidate.id,
        name: typeof candidate.name === "string" ? candidate.name.slice(0, 20) : meta.name,
        glyph: typeof candidate.glyph === "string" ? candidate.glyph.slice(0, 2) : meta.glyph,
        color: typeof candidate.color === "string" && /^#[0-9a-f]{6}$/i.test(candidate.color)
          ? candidate.color
          : meta.color,
        jitter: clamp(finite(candidate.jitter, 2), 0, 14),
        entrance: {
          x: clamp(finite(entrance.x, 0), -180, 180),
          y: clamp(finite(entrance.y, 0), -160, 160),
          delay: clamp(finite(entrance.delay, 0), 0, 6),
          duration: clamp(finite(entrance.duration, 1.2), 0.3, 3),
        },
        visible: candidate.visible !== false,
      };
    });
    if (seen.size !== 4) throw new Error("工程缺少图层");

    const fallbackTime = Number.isFinite(Number(raw.currentTime))
      ? Number(raw.currentTime)
      : DEFAULT_PROJECT.currentTime;
    return {
      schema: "paper-cut-studio",
      version: 1,
      title: typeof raw.title === "string" ? raw.title.slice(0, 60) : DEFAULT_PROJECT.title,
      scene: typeof raw.scene === "string" ? raw.scene.slice(0, 100) : DEFAULT_PROJECT.scene,
      duration: DURATION,
      fps: PROJECT_FPS,
      currentTime: clamp(fallbackTime, 0, DURATION - 1 / PROJECT_FPS),
      selectedLayer: seen.has(raw.selectedLayer) ? raw.selectedLayer : layers[0].id,
      audioOn: raw.audioOn !== false,
      layers,
    };
  }

  function applyProject(rawProject, statusText = "工程已载入") {
    const project = normalizeProject(rawProject);
    pausePlayback();
    state.schema = project.schema;
    state.version = project.version;
    state.title = project.title;
    state.scene = project.scene;
    state.duration = project.duration;
    state.fps = project.fps;
    state.currentTime = project.currentTime;
    state.selectedLayer = project.selectedLayer;
    state.audioOn = project.audioOn;
    state.layers = project.layers;
    selectedLayerId = project.selectedLayer;
    currentTime = project.currentTime;
    setDirty(false, statusText);
    syncInspector();
    renderTimeline();
    setPlaybackUI();
    renderFrame(currentTime);
  }

  function createProjectSnapshot() {
    return {
      schema: "paper-cut-studio",
      version: 1,
      title: state.title,
      scene: state.scene,
      duration: DURATION,
      fps: PROJECT_FPS,
      currentTime: Math.round(currentTime * PROJECT_FPS) / PROJECT_FPS,
      selectedLayer: selectedLayerId,
      audioOn: state.audioOn,
      layers: clone(state.layers),
    };
  }

  function saveProject() {
    pausePlayback();
    const project = createProjectSnapshot();
    const json = `${JSON.stringify(project, null, 2)}\n`;
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "zheyue-paper-loop.json";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 800);
    setDirty(false, "工程 JSON 已保存");
    showToast(`已保存 4 个图层 · ${formatTimecode(currentTime)}`, "✓");
  }

  async function loadProjectFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const project = normalizeProject(text);
      applyProject(project, `已载入 ${file.name}`);
      showToast(`工程已载入 · ${project.layers.length} 个图层`, "✓");
    } catch (error) {
      showToast(error.message || "工程文件读取失败", "!");
    } finally {
      ui.fileInput.value = "";
    }
  }

  function restoreSample() {
    applyProject(clone(DEFAULT_PROJECT), "示例工程已就绪");
    showToast("十二秒示例循环已恢复", "↺");
  }

  function toggleSound() {
    state.audioOn = !state.audioOn;
    if (state.audioOn && isPlaying) {
      ensureAudio();
      audio?.startWind();
    } else if (!state.audioOn) {
      audio?.stopWind();
    }
    setDirty(true);
    setPlaybackUI();
    showToast(state.audioOn ? "声音已开启 · 风声与桨声" : "声音已关闭");
  }

  function ensureAudio() {
    if (!audio) audio = new PaperAudio();
    return audio.ensure();
  }

  function bindTransportAndProjectControls() {
    ui.playButton.addEventListener("click", togglePlayback);
    ui.startButton.addEventListener("click", goToStart);
    ui.soundButton.addEventListener("click", toggleSound);
    ui.saveButton.addEventListener("click", saveProject);
    ui.loadButton.addEventListener("click", () => ui.fileInput.click());
    ui.fileInput.addEventListener("change", loadProjectFile);
    ui.sampleButton.addEventListener("click", restoreSample);
    ui.timelineSurface.addEventListener("pointerdown", beginScrub);
    ui.timelineSurface.addEventListener("pointermove", moveScrub);
    ui.timelineSurface.addEventListener("pointerup", endScrub);
    ui.timelineSurface.addEventListener("pointercancel", endScrub);

    window.addEventListener("keydown", (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.matches("input, textarea, select, [contenteditable='true']")) return;
      if (target instanceof HTMLElement && target.closest("button")) {
        if (event.key === "ArrowUp" || event.key === "ArrowDown") return;
        if (event.key === " ") return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        togglePlayback();
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        goToStart();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        pausePlayback();
        setTime(currentTime - 1 / PROJECT_FPS);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        pausePlayback();
        setTime(currentTime + 1 / PROJECT_FPS);
      }
    });
  }

  function initialize() {
    audio = new PaperAudio();
    configureCanvas();
    buildRuler();
    bindInspectorControls();
    bindTransportAndProjectControls();
    syncInspector();
    renderTimeline();
    setPlaybackUI();
    renderFrame(currentTime);

    let resizeTimer = 0;
    window.addEventListener("resize", () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        configureCanvas();
        renderFrame(currentTime);
      }, 80);
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && isPlaying) pausePlayback();
    });
  }

  initialize();
})();
