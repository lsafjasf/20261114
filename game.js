(() => {
  "use strict";

  const STRATA = [
    {
      name: "新雪层",
      code: "SNOW / FIRN",
      thickness: 55,
      hardness: 0.84,
      top: "#bfeaf5",
      bottom: "#80c6dc",
      accent: "#e8fbff"
    },
    {
      name: "蓝冰层",
      code: "BLUE ICE",
      thickness: 105,
      hardness: 1.04,
      top: "#4a99b8",
      bottom: "#23617e",
      accent: "#8be5ff"
    },
    {
      name: "远古黑冰",
      code: "BLACK ICE",
      thickness: 170,
      hardness: 1.28,
      top: "#1c4155",
      bottom: "#0a1e2c",
      accent: "#b5f4ff"
    }
  ];

  const TOTAL_DEPTH = STRATA.reduce((sum, layer) => sum + layer.thickness, 0);
  const JAM_LIMIT = 5;
  const TEMP_LIMIT = 100;
  const AMBIENT_TEMP = 18;
  const BASE_RATE = 19.5;
  const VIEW_W = 900;
  const VIEW_H = 720;
  const SURFACE_Y = 176;
  const BOTTOM_Y = 679;
  const DRILL_X = 438;
  const CANVAS_MONO = "'Noto Sans SC Local', 'SFMono-Regular', Consolas, monospace";
  const CANVAS_DISPLAY = "'Noto Sans SC Local', 'Arial Narrow', sans-serif";

  const dom = {
    canvas: document.querySelector("#drillCanvas"),
    startButton: document.querySelector("#startButton"),
    retryButton: document.querySelector("#retryButton"),
    introCard: document.querySelector("#introCard"),
    resultCard: document.querySelector("#resultCard"),
    resultKicker: document.querySelector("#resultKicker"),
    resultTitle: document.querySelector("#resultTitle"),
    resultCopy: document.querySelector("#resultCopy"),
    resultDepth: document.querySelector("#resultDepth"),
    resultTime: document.querySelector("#resultTime"),
    resultTemp: document.querySelector("#resultTemp"),
    modeButton: document.querySelector("#modeButton"),
    modeLabel: document.querySelector("#modeLabel"),
    audioButton: document.querySelector("#audioButton"),
    audioText: document.querySelector("#audioText"),
    pressureValue: document.querySelector("#pressureValue"),
    pressureBar: document.querySelector("#pressureBar"),
    rpmValue: document.querySelector("#rpmValue"),
    chipBar: document.querySelector("#chipBar"),
    chipLabel: document.querySelector("#chipLabel"),
    elapsedValue: document.querySelector("#elapsedValue"),
    statusSignal: document.querySelector("#statusSignal"),
    statusText: document.querySelector("#statusText"),
    statusHint: document.querySelector("#statusHint"),
    fpsValue: document.querySelector("#fpsValue"),
    footerHint: document.querySelector("#footerHint"),
    debugPanel: document.querySelector("#debugPanel"),
    debugPhase: document.querySelector("#debugPhase"),
    debugDepth: document.querySelector("#debugDepth"),
    debugForce: document.querySelector("#debugForce"),
    debugRpm: document.querySelector("#debugRpm"),
    debugLoad: document.querySelector("#debugLoad"),
    debugAudio: document.querySelector("#debugAudio"),
    debugKeys: document.querySelector("#debugKeys")
  };

  const state = {
    phase: "ready",
    mode: "duo",
    elapsed: 0,
    depth: 0,
    pressure: 0.18,
    rpm: 0.12,
    chips: 0.05,
    temperature: 24,
    maxTemperature: 24,
    jammed: false,
    jamTimer: 0,
    clearing: false,
    load: 0,
    penetrationRate: 0,
    layerIndex: 0,
    failReason: null,
    runId: 0
  };

  const inputSources = new Map();
  const activeInputs = new Set();
  const particles = [];
  const surfaceSnow = [];
  let lastTime = performance.now();
  let fpsAccumulator = 0;
  let fpsFrames = 0;
  let visualTime = 0;
  let drillAngle = 0;
  let statusFlash = 0;

  const KEYMAP = {
    duo: {
      KeyA: "pressureUp",
      KeyZ: "pressureDown",
      ArrowUp: "rpmUp",
      ArrowDown: "rpmDown",
      Space: "clear"
    },
    solo: {
      KeyW: "pressureUp",
      KeyS: "pressureDown",
      ArrowUp: "rpmUp",
      ArrowDown: "rpmDown",
      Space: "clear"
    }
  };

  const ACTION_LABELS = {
    pressureUp: "P1↑",
    pressureDown: "P1↓",
    rpmUp: "P2↑",
    rpmDown: "P2↓",
    clear: "P2排屑"
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(a, b, amount) {
    return a + (b - a) * amount;
  }

  function formatTime(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(total / 60);
    return `${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }

  function layerBounds(index) {
    let start = 0;
    for (let i = 0; i < index; i += 1) start += STRATA[i].thickness;
    return { start, end: start + STRATA[index].thickness };
  }

  function getLayerAtDepth(depth) {
    let start = 0;
    for (let i = 0; i < STRATA.length; i += 1) {
      const end = start + STRATA[i].thickness;
      if (depth < end || i === STRATA.length - 1) {
        return { index: i, layer: STRATA[i], start, end };
      }
      start = end;
    }
    return { index: STRATA.length - 1, layer: STRATA.at(-1), start: TOTAL_DEPTH - STRATA.at(-1).thickness, end: TOTAL_DEPTH };
  }

  function isHeld(action) {
    return activeInputs.has(action);
  }

  function setInput(action, source, pressed) {
    if (!inputSources.has(action)) inputSources.set(action, new Set());
    const sources = inputSources.get(action);
    if (pressed) {
      sources.add(source);
    } else {
      sources.delete(source);
    }
    if (sources.size > 0) {
      activeInputs.add(action);
    } else {
      activeInputs.delete(action);
    }
    document.querySelectorAll(`[data-hold="${action}"]`).forEach((button) => {
      button.classList.toggle("is-held", sources.size > 0);
    });
  }

  function clearInputs() {
    inputSources.forEach((sources, action) => {
      sources.clear();
      activeInputs.delete(action);
      document.querySelectorAll(`[data-hold="${action}"]`).forEach((button) => {
        button.classList.remove("is-held");
      });
    });
  }

  function resetState() {
    state.phase = "ready";
    state.elapsed = 0;
    state.depth = 0;
    state.pressure = 0.18;
    state.rpm = 0.12;
    state.chips = 0.05;
    state.temperature = 24;
    state.maxTemperature = 24;
    state.jammed = false;
    state.jamTimer = 0;
    state.clearing = false;
    state.load = 0;
    state.penetrationRate = 0;
    state.layerIndex = 0;
    state.failReason = null;
    state.runId += 1;
    particles.length = 0;
    clearInputs();
  }

  function finishRun(kind, reason = null) {
    if (state.phase === "complete" || state.phase === "failed") return;
    state.phase = kind;
    state.failReason = reason;
    state.penetrationRate = 0;
    state.jammed = false;
    state.clearing = false;
    clearInputs();
    dom.resultCard.hidden = false;
    dom.resultCard.classList.toggle("failed", kind === "failed");
    dom.resultDepth.textContent = `${state.depth.toFixed(1)} m`;
    dom.resultTime.textContent = formatTime(state.elapsed);
    dom.resultTemp.textContent = `${Math.round(state.maxTemperature)} °C`;

    if (kind === "complete") {
      dom.resultKicker.textContent = "BOREHOLE COMPLETE / 330 M";
      dom.resultTitle.textContent = "冰层贯穿";
      dom.resultCopy.textContent = `三层冰芯全部通过。核心样本已封存，钻头最高温度 ${Math.round(state.maxTemperature)} °C。`;
    } else if (reason === "jam") {
      dom.resultKicker.textContent = "ROTATION STALL / LOCK 05.0S";
      dom.resultTitle.textContent = "钻头卡死";
      dom.resultCopy.textContent = "下压力过高而转速不足，钻具在冰层中锁死超过五秒。泄压并重新升速后再试。";
    } else {
      dom.resultKicker.textContent = "THERMAL ABORT / 100 °C";
      dom.resultTitle.textContent = "热失控停机";
      dom.resultCopy.textContent = "冰屑堆积阻断了散热通路，钻头达到 100 °C。保持排屑泵运转，并降低下压力。";
    }

    if (window.__iceRig) {
      window.__iceRig.lastResult = {
        kind,
        reason,
        depth: state.depth,
        elapsed: state.elapsed,
        maxTemperature: state.maxTemperature,
        pressure: state.pressure,
        rpm: state.rpm,
        at: new Date().toISOString()
      };
    }
    emitAudioCue(kind);
  }

  function updateSimulation(dt) {
    if (state.phase !== "running") return;

    state.elapsed += dt;
    const forceDirection = (isHeld("pressureUp") ? 1 : 0) - (isHeld("pressureDown") ? 1 : 0);
    const rpmDirection = (isHeld("rpmUp") ? 1 : 0) - (isHeld("rpmDown") ? 1 : 0);
    state.pressure = clamp(state.pressure + forceDirection * 0.54 * dt, 0, 1);
    state.rpm = clamp(state.rpm + rpmDirection * 0.72 * dt, 0, 1);
    state.clearing = isHeld("clear");

    const current = getLayerAtDepth(state.depth);
    state.layerIndex = current.index;
    const hardness = current.layer.hardness;
    const jamPressure = 0.705 - (hardness - 0.84) * 0.08;
    const jamRpm = 0.22 + (hardness - 0.84) * 0.04;
    const hasContact = state.pressure > 0.09 && state.rpm > 0.07;

    state.jammed = state.phase === "running" && hasContact &&
      state.pressure > jamPressure && state.rpm < jamRpm;

    if (state.jammed) {
      state.jamTimer = Math.min(JAM_LIMIT, state.jamTimer + dt);
      if (state.jamTimer >= JAM_LIMIT) {
        finishRun("failed", "jam");
        return;
      }
    } else {
      state.jamTimer = Math.max(0, state.jamTimer - dt * 2.4);
    }

    const safePressure = 0.59 - (hardness - 1) * 0.055;
    const pressureEfficiency = clamp(1 - Math.abs(state.pressure - safePressure) * 0.52, 0.1, 1);
    const contact = Math.sqrt(Math.max(0, state.pressure * state.rpm));
    const chipBrake = 1 - Math.max(0, state.chips - 0.3) * 1.12;
    const heatBrake = 1 - Math.max(0, state.temperature - 68) * 0.008;
    let rate = 0;

    if (hasContact && !state.jammed) {
      rate = BASE_RATE * contact * pressureEfficiency * Math.max(0.18, chipBrake) *
        Math.max(0.35, heatBrake) / hardness;
    }

    state.penetrationRate = rate;
    state.load = clamp(contact * (0.72 + hardness * 0.35), 0, 1.35);

    if (rate > 0) {
      state.depth = Math.min(TOTAL_DEPTH, state.depth + rate * dt);
      if (Math.random() < rate * dt * 5.5) spawnChip();
      if (Math.random() < rate * dt * 3) spawnDust();
    }

    const friction = Math.pow(state.pressure, 1.2) * state.rpm * (0.72 + hardness * 0.48);
    const chipCreated = friction * 0.43 * (state.jammed ? 0.28 : 1);
    const chipDrain = (state.clearing ? 0.5 : 0.035) + state.rpm * 0.018;
    state.chips = clamp(state.chips + (chipCreated - chipDrain) * dt, 0, 1);

    const heating = friction * 37 + state.chips * state.chips * 23 + (state.jammed ? 5 : 0);
    const coolingBase = 4.5 + state.rpm * 8.5 + (state.clearing ? 8 : 0) +
      (1 - state.chips) * 1.8;
    const cooling = state.temperature > AMBIENT_TEMP ? coolingBase * (1 - state.chips * 0.45) : 0;
    state.temperature = clamp(state.temperature + (heating - cooling) * dt, AMBIENT_TEMP, 112);
    state.maxTemperature = Math.max(state.maxTemperature, state.temperature);

    if (state.temperature >= TEMP_LIMIT) {
      finishRun("failed", "heat");
      return;
    }

    if (state.depth >= TOTAL_DEPTH) {
      state.depth = TOTAL_DEPTH;
      finishRun("complete");
    }
  }

  function updateInterface() {
    const pressurePercent = Math.round(state.pressure * 100);
    const rpm = Math.round(state.rpm * 1600);
    dom.pressureValue.textContent = String(pressurePercent);
    dom.pressureBar.style.transform = `scaleX(${state.pressure})`;
    dom.rpmValue.textContent = String(rpm);
    dom.chipBar.style.transform = `scaleX(${state.chips})`;
    dom.elapsedValue.textContent = formatTime(state.elapsed);

    if (state.chips < 0.42) {
      dom.chipLabel.textContent = "稳定";
      dom.chipLabel.className = "";
    } else if (state.chips < 0.72) {
      dom.chipLabel.textContent = "积屑";
      dom.chipLabel.className = "warning";
    } else {
      dom.chipLabel.textContent = "堵塞";
      dom.chipLabel.className = "danger";
    }

    let status = "系统待命";
    let hint = state.mode === "solo" ? "调试：W/S + ↑/↓ + 空格" : "等待双人操作";
    let signal = "";

    if (state.phase === "running") {
      signal = "running";
      if (state.jammed) {
        signal = "danger";
        status = `卡钻 ${state.jamTimer.toFixed(1)} / 5.0s`;
        hint = "泄压、升速以解除卡钻";
      } else if (state.temperature > 78) {
        signal = "danger";
        status = `钻头过热 ${Math.round(state.temperature)}°C`;
        hint = state.clearing ? "降低下压力" : "立即启动排屑泵";
      } else if (state.chips > 0.72) {
        signal = "danger";
        status = "排屑通路堵塞";
        hint = "按住空格清屑";
      } else if (state.chips > 0.42 || state.temperature > 62) {
        signal = "warning";
        status = state.chips > 0.42 ? "冰屑正在堆积" : "温度持续上升";
        hint = state.chips > 0.42 ? "保持排屑" : "可适当泄压";
      } else if (state.penetrationRate < 0.2) {
        status = "钻头空转";
        hint = "增加下压力或转速";
      } else {
        status = `切削中 · ${getLayerAtDepth(state.depth).layer.name}`;
        hint = `${state.penetrationRate.toFixed(1)} m/s · ${rpm} rpm`;
      }
    } else if (state.phase === "complete") {
      signal = "running";
      status = "钻孔完成";
      hint = "三百三十米岩芯已贯通";
    } else if (state.phase === "failed") {
      signal = "danger";
      status = state.failReason === "jam" ? "卡钻超过五秒 · 任务中止" : "热失控 · 任务中止";
      hint = "检查操作序列后再次钻探";
    }

    const signalClass = signal ? `status-signal ${signal}` : "status-signal";
    dom.statusSignal.className = signalClass;
    dom.statusText.textContent = status;
    dom.statusHint.textContent = hint;

    if (state.mode === "solo") {
      dom.debugPhase.textContent = state.phase;
      dom.debugDepth.textContent = `${state.depth.toFixed(1)} m`;
      dom.debugForce.textContent = `${pressurePercent}%`;
      dom.debugRpm.textContent = `${Math.round(state.rpm * 100)}%`;
      dom.debugLoad.textContent = state.load.toFixed(2);
      dom.debugAudio.textContent = getAudioDebugText();
      dom.debugKeys.textContent = activeInputs.size
        ? [...activeInputs].map((action) => ACTION_LABELS[action]).join(" + ")
        : "none";
    }
  }

  function mulberry32(seed) {
    return function random() {
      let t = seed += 0x6d2b79f5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  const layerDetails = STRATA.map((layer, index) => {
    const random = mulberry32(701 + index * 97);
    const cracks = Array.from({ length: 13 }, () => ({
      x: 91 + random() * 695,
      y: random(),
      length: 24 + random() * 92,
      angle: -0.6 + random() * 1.2,
      branch: random() > 0.6
    }));
    const bubbles = Array.from({ length: 30 }, () => ({
      x: 30 + random() * 760,
      y: random(),
      radius: 0.7 + random() * 2.8,
      opacity: 0.08 + random() * 0.2
    }));
    return { cracks, bubbles };
  });

  for (let i = 0; i < 46; i += 1) {
    surfaceSnow.push({
      x: Math.random() * VIEW_W,
      y: Math.random() * SURFACE_Y,
      size: 0.5 + Math.random() * 1.4,
      speed: 5 + Math.random() * 11,
      drift: Math.random() * Math.PI * 2
    });
  }

  const canvas = dom.canvas;
  const ctx = canvas.getContext("2d");
  let canvasMetrics = { width: VIEW_W, height: VIEW_H, dpr: 1 };

  function depthToY(depth) {
    return SURFACE_Y + (depth / TOTAL_DEPTH) * (BOTTOM_Y - SURFACE_Y);
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvasMetrics = { width: rect.width, height: rect.height, dpr };
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function roundedRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.roundRect(x, y, width, height, r);
  }

  function drawSky(time) {
    const sky = ctx.createLinearGradient(0, 0, 0, SURFACE_Y + 30);
    sky.addColorStop(0, "#06101c");
    sky.addColorStop(0.58, "#0a1a29");
    sky.addColorStop(1, "#102b3a");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, VIEW_W, SURFACE_Y + 30);

    const aurora = ctx.createLinearGradient(0, 35, VIEW_W, 172);
    aurora.addColorStop(0, "rgba(61, 184, 162, 0)");
    aurora.addColorStop(0.4, "rgba(74, 206, 186, 0.08)");
    aurora.addColorStop(0.72, "rgba(90, 177, 210, 0.12)");
    aurora.addColorStop(1, "rgba(43, 101, 143, 0)");
    ctx.fillStyle = aurora;
    ctx.beginPath();
    ctx.moveTo(0, 92);
    ctx.bezierCurveTo(210, 32, 360, 166, 570, 84);
    ctx.bezierCurveTo(730, 25, 812, 55, 900, 41);
    ctx.lineTo(900, 166);
    ctx.bezierCurveTo(650, 123, 440, 181, 0, 151);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(210, 244, 255, 0.4)";
    for (const flake of surfaceSnow) {
      const x = (flake.x + time * flake.speed + Math.sin(time + flake.drift) * 4) % VIEW_W;
      const y = (flake.y + time * 3 + flake.size * 8) % (SURFACE_Y - 12);
      ctx.globalAlpha = 0.28 + flake.size * 0.22;
      ctx.fillRect(x, y, flake.size, flake.size);
    }
    ctx.globalAlpha = 1;
  }

  function drawIceLayers() {
    let depthStart = 0;
    for (let index = 0; index < STRATA.length; index += 1) {
      const layer = STRATA[index];
      const y0 = depthToY(depthStart);
      const y1 = depthToY(depthStart + layer.thickness);
      const gradient = ctx.createLinearGradient(0, y0, 0, y1);
      gradient.addColorStop(0, layer.top);
      gradient.addColorStop(1, layer.bottom);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, y0, VIEW_W, y1 - y0 + 1);

      const shade = ctx.createLinearGradient(0, y0, VIEW_W, y1);
      shade.addColorStop(0, "rgba(235, 252, 255, 0.14)");
      shade.addColorStop(0.45, "rgba(255, 255, 255, 0)");
      shade.addColorStop(1, "rgba(0, 12, 23, 0.24)");
      ctx.fillStyle = shade;
      ctx.fillRect(0, y0, VIEW_W, y1 - y0);

      const detail = layerDetails[index];
      for (const bubble of detail.bubbles) {
        ctx.beginPath();
        ctx.arc(bubble.x, y0 + bubble.y * (y1 - y0), bubble.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(218, 249, 255, ${bubble.opacity})`;
        ctx.fill();
      }

      ctx.lineCap = "round";
      for (const crack of detail.cracks) {
        const crackY = y0 + crack.y * (y1 - y0);
        const dx = Math.cos(crack.angle) * crack.length;
        const dy = Math.sin(crack.angle) * crack.length;
        ctx.beginPath();
        ctx.moveTo(crack.x, crackY);
        ctx.lineTo(crack.x + dx * 0.55, crackY + dy * 0.55);
        ctx.lineTo(crack.x + dx, crackY + dy);
        ctx.strokeStyle = "rgba(213, 247, 255, 0.2)";
        ctx.lineWidth = 0.8;
        ctx.stroke();
        if (crack.branch) {
          ctx.beginPath();
          ctx.moveTo(crack.x + dx * 0.52, crackY + dy * 0.52);
          ctx.lineTo(crack.x + dx * 0.3 - 13, crackY + dy * 0.3 + 9);
          ctx.strokeStyle = "rgba(213, 247, 255, 0.12)";
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }

      ctx.fillStyle = "rgba(0, 14, 23, 0.16)";
      for (let stripe = 0; stripe < 8; stripe += 1) {
        const stripeY = y0 + ((stripe + 0.35) / 8) * (y1 - y0);
        ctx.fillRect(0, stripeY, VIEW_W, 0.6);
      }

      ctx.strokeStyle = "rgba(213, 249, 255, 0.32)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y0);
      ctx.lineTo(VIEW_W, y0);
      ctx.stroke();

      ctx.fillStyle = "rgba(228, 252, 255, 0.46)";
      ctx.font = `8px ${CANVAS_MONO}`;
      ctx.letterSpacing = "1px";
      ctx.fillText(`${String(index + 1).padStart(2, "0")} / ${layer.code}`, 27, y0 + 18);
      ctx.fillStyle = "rgba(228, 252, 255, 0.24)";
      ctx.fillText(`${layer.thickness} M · H ${layer.hardness.toFixed(2)}`, 27, y0 + 31);
      depthStart += layer.thickness;
    }

    const vignette = ctx.createLinearGradient(0, 0, VIEW_W, 0);
    vignette.addColorStop(0, "rgba(0, 7, 14, 0.36)");
    vignette.addColorStop(0.16, "rgba(0, 7, 14, 0)");
    vignette.addColorStop(0.82, "rgba(0, 7, 14, 0)");
    vignette.addColorStop(1, "rgba(0, 7, 14, 0.46)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, SURFACE_Y, VIEW_W, BOTTOM_Y - SURFACE_Y);
  }

  function drawDepthRuler() {
    const x = 850;
    ctx.strokeStyle = "rgba(196, 241, 255, 0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, SURFACE_Y + 16);
    ctx.lineTo(x, BOTTOM_Y - 12);
    ctx.stroke();

    for (let depth = 0; depth <= TOTAL_DEPTH; depth += 10) {
      const major = depth % 50 === 0;
      const y = depthToY(depth);
      ctx.strokeStyle = major ? "rgba(216, 249, 255, 0.56)" : "rgba(216, 249, 255, 0.2)";
      ctx.beginPath();
      ctx.moveTo(x - (major ? 9 : 4), y);
      ctx.lineTo(x, y);
      ctx.stroke();
      if (major && depth < TOTAL_DEPTH) {
        ctx.fillStyle = "rgba(226, 251, 255, 0.42)";
        ctx.font = `7px ${CANVAS_MONO}`;
        ctx.textAlign = "right";
        ctx.fillText(String(depth), x - 13, y + 2.5);
        ctx.textAlign = "left";
      }
    }

    const markerY = depthToY(state.depth);
    ctx.fillStyle = "#bdf5ff";
    ctx.beginPath();
    ctx.moveTo(x + 7, markerY);
    ctx.lineTo(x + 13, markerY - 4);
    ctx.lineTo(x + 13, markerY + 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(x + 11, markerY - 0.5, 16, 1);
  }

  function drawLayerBoundaryLabels() {
    let cumulative = 0;
    STRATA.slice(0, -1).forEach((layer) => {
      cumulative += layer.thickness;
      const y = depthToY(cumulative);
      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = "rgba(205, 247, 255, 0.26)";
      ctx.beginPath();
      ctx.moveTo(69, y);
      ctx.lineTo(830, y);
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }

  function drawSurfaceAndRig(time) {
    const snowGradient = ctx.createLinearGradient(0, SURFACE_Y - 8, 0, SURFACE_Y + 27);
    snowGradient.addColorStop(0, "#e6fbff");
    snowGradient.addColorStop(1, "#82c4d8");
    ctx.fillStyle = snowGradient;
    ctx.beginPath();
    ctx.moveTo(0, SURFACE_Y + 12);
    ctx.lineTo(78, SURFACE_Y + 3);
    ctx.lineTo(153, SURFACE_Y + 15);
    ctx.lineTo(244, SURFACE_Y + 4);
    ctx.lineTo(334, SURFACE_Y + 10);
    ctx.lineTo(411, SURFACE_Y - 2);
    ctx.lineTo(508, SURFACE_Y + 7);
    ctx.lineTo(604, SURFACE_Y + 2);
    ctx.lineTo(692, SURFACE_Y + 14);
    ctx.lineTo(787, SURFACE_Y + 5);
    ctx.lineTo(900, SURFACE_Y + 11);
    ctx.lineTo(900, SURFACE_Y + 31);
    ctx.lineTo(0, SURFACE_Y + 31);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(235, 253, 255, 0.7)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, SURFACE_Y + 12);
    ctx.bezierCurveTo(180, SURFACE_Y - 2, 294, SURFACE_Y + 14, 438, SURFACE_Y + 1);
    ctx.bezierCurveTo(590, SURFACE_Y - 7, 770, SURFACE_Y + 18, 900, SURFACE_Y + 11);
    ctx.stroke();

    ctx.strokeStyle = "rgba(12, 37, 50, 0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(355, SURFACE_Y + 1);
    ctx.lineTo(384, 108);
    ctx.lineTo(492, 108);
    ctx.lineTo(522, SURFACE_Y + 1);
    ctx.stroke();

    ctx.strokeStyle = "rgba(175, 224, 238, 0.42)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(368, SURFACE_Y - 1);
    ctx.lineTo(438, 58);
    ctx.lineTo(510, SURFACE_Y - 1);
    ctx.moveTo(384, 108);
    ctx.lineTo(438, 58);
    ctx.lineTo(492, 108);
    ctx.moveTo(397, 146);
    ctx.lineTo(480, 146);
    ctx.moveTo(407, 121);
    ctx.lineTo(470, 121);
    ctx.stroke();

    ctx.fillStyle = "#081720";
    ctx.fillRect(333, 115, 84, 59);
    ctx.fillStyle = "#0d2734";
    ctx.fillRect(342, 121, 65, 45);
    ctx.fillStyle = "rgba(136, 229, 255, 0.65)";
    ctx.fillRect(350, 128, 18, 7);
    ctx.fillRect(378, 128, 21, 7);
    ctx.fillStyle = "#ffbd61";
    ctx.fillRect(343, 168, 64, 3);
    ctx.fillStyle = "rgba(4, 14, 21, 0.92)";
    ctx.fillRect(427, 98, 23, 20);

    ctx.fillStyle = "rgba(220, 251, 255, 0.75)";
    ctx.font = `7px ${CANVAS_MONO}`;
    ctx.fillText("RIG 07", 441, 110);
    ctx.fillStyle = "rgba(132, 219, 240, 0.5)";
    ctx.fillText("RIG 07", 400, 139);

    const sheaveX = 438;
    const sheaveY = 91;
    ctx.save();
    ctx.translate(sheaveX, sheaveY);
    ctx.rotate(time * (0.4 + state.rpm * 4));
    ctx.strokeStyle = "rgba(195, 237, 248, 0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.moveTo(-9, 0);
    ctx.lineTo(9, 0);
    ctx.moveTo(0, -9);
    ctx.lineTo(0, 9);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = state.phase === "running" ? "#ffb94f" : "#725b38";
    ctx.shadowColor = state.phase === "running" ? "#ffb94f" : "transparent";
    ctx.shadowBlur = 9;
    ctx.beginPath();
    ctx.arc(544, 54, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = "rgba(7, 21, 30, 0.7)";
    ctx.fillRect(596, 83, 73, 88);
    ctx.strokeStyle = "rgba(158, 222, 238, 0.22)";
    ctx.strokeRect(596, 83, 73, 88);
    ctx.fillStyle = "rgba(136, 229, 255, 0.52)";
    ctx.fillRect(606, 94, 52, 1);
    ctx.fillStyle = "rgba(194, 241, 252, 0.4)";
    ctx.font = `7px ${CANVAS_MONO}`;
    ctx.fillText("CORE LAB", 607, 107);
    ctx.fillText("−38.4°", 607, 119);
    ctx.fillStyle = "rgba(103, 243, 196, 0.6)";
    ctx.fillRect(607, 129, 24, 2);

    ctx.strokeStyle = "rgba(210, 244, 254, 0.36)";
    ctx.beginPath();
    ctx.moveTo(700, 169);
    ctx.lineTo(700, 122);
    ctx.moveTo(688, 139);
    ctx.lineTo(712, 139);
    ctx.stroke();
  }

  function drawBorehole(bitY) {
    const hole = ctx.createLinearGradient(DRILL_X - 17, 0, DRILL_X + 17, 0);
    hole.addColorStop(0, "rgba(3, 14, 21, 0.12)");
    hole.addColorStop(0.33, "rgba(1, 10, 17, 0.96)");
    hole.addColorStop(0.72, "rgba(5, 20, 29, 0.92)");
    hole.addColorStop(1, "rgba(4, 15, 23, 0.13)");
    ctx.fillStyle = hole;
    ctx.beginPath();
    ctx.moveTo(DRILL_X - 16, SURFACE_Y);
    ctx.lineTo(DRILL_X - 13, bitY);
    ctx.lineTo(DRILL_X + 13, bitY);
    ctx.lineTo(DRILL_X + 16, SURFACE_Y);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(190, 244, 255, 0.32)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(DRILL_X - 13, SURFACE_Y + 11);
    ctx.lineTo(DRILL_X - 10, bitY - 14);
    ctx.moveTo(DRILL_X + 13, SURFACE_Y + 11);
    ctx.lineTo(DRILL_X + 10, bitY - 14);
    ctx.stroke();

    ctx.fillStyle = "rgba(2, 10, 16, 0.78)";
    ctx.beginPath();
    ctx.ellipse(DRILL_X, SURFACE_Y + 3, 22, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawDrillString(bitY) {
    ctx.strokeStyle = "rgba(0, 9, 15, 0.4)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(DRILL_X - 15, 100);
    ctx.lineTo(DRILL_X - 8, bitY - 42);
    ctx.stroke();

    const shaftGradient = ctx.createLinearGradient(DRILL_X - 8, 0, DRILL_X + 8, 0);
    shaftGradient.addColorStop(0, "#152b35");
    shaftGradient.addColorStop(0.35, "#98afb7");
    shaftGradient.addColorStop(0.62, "#425d66");
    shaftGradient.addColorStop(1, "#0b1d27");
    ctx.strokeStyle = shaftGradient;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(DRILL_X, 104);
    ctx.lineTo(DRILL_X, bitY - 44);
    ctx.stroke();

    ctx.strokeStyle = "rgba(214, 249, 255, 0.34)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(DRILL_X - 2, 106);
    ctx.lineTo(DRILL_X - 2, bitY - 45);
    ctx.stroke();

    for (let y = 114; y < bitY - 48; y += 27) {
      ctx.strokeStyle = "rgba(3, 15, 22, 0.7)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(DRILL_X - 5, y);
      ctx.lineTo(DRILL_X + 5, y);
      ctx.stroke();
    }
  }

  function temperatureColor() {
    const ratio = clamp((state.temperature - 35) / 65, 0, 1);
    if (ratio < 0.5) return `rgba(118, 231, 255, ${0.18 + ratio * 0.35})`;
    return `rgba(255, ${Math.round(152 - ratio * 90)}, 73, ${0.3 + ratio * 0.45})`;
  }

  function drawDrillBit(bitY) {
    const vibration = state.jammed ? Math.sin(visualTime * 47) * 1.8 : Math.sin(visualTime * 18) * state.load * 0.5;
    ctx.save();
    ctx.translate(DRILL_X + vibration, bitY);

    const glowRadius = 46 + clamp(state.temperature, 20, 100) * 0.62;
    const glow = ctx.createRadialGradient(0, -10, 2, 0, -10, glowRadius);
    glow.addColorStop(0, temperatureColor());
    glow.addColorStop(1, "rgba(255, 93, 55, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, -10, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#071419";
    ctx.beginPath();
    ctx.moveTo(-18, -48);
    ctx.lineTo(18, -48);
    ctx.lineTo(15, -16);
    ctx.lineTo(-15, -16);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(177, 225, 236, 0.48)";
    ctx.lineWidth = 1;
    ctx.stroke();

    const metal = ctx.createLinearGradient(-15, 0, 15, 0);
    metal.addColorStop(0, "#203844");
    metal.addColorStop(0.36, "#b5d1d9");
    metal.addColorStop(0.55, "#526f7b");
    metal.addColorStop(1, "#10242d");
    ctx.fillStyle = metal;
    ctx.beginPath();
    ctx.moveTo(-14, -16);
    ctx.lineTo(14, -16);
    ctx.lineTo(9, 15);
    ctx.lineTo(0, 29);
    ctx.lineTo(-9, 15);
    ctx.closePath();
    ctx.fill();

    const spinOffset = (drillAngle * 16) % 9;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-14, -16);
    ctx.lineTo(14, -16);
    ctx.lineTo(9, 15);
    ctx.lineTo(0, 29);
    ctx.lineTo(-9, 15);
    ctx.closePath();
    ctx.clip();
    for (let y = -20; y < 32; y += 8) {
      ctx.strokeStyle = "rgba(7, 24, 31, 0.62)";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(-18, y + spinOffset);
      ctx.lineTo(18, y - 7 + spinOffset);
      ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = "rgba(232, 252, 255, 0.82)";
    ctx.beginPath();
    ctx.moveTo(-6, -2);
    ctx.lineTo(0, 30);
    ctx.lineTo(6, -2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#8cdff3";
    ctx.beginPath();
    ctx.arc(0, -43, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#07141b";
    ctx.beginPath();
    ctx.arc(0, -43, 2.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(176, 240, 255, 0.68)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, -16, 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function spawnChip() {
    const bitY = depthToY(state.depth) - 15;
    const angle = -Math.PI * 0.15 + (Math.random() - 0.5) * Math.PI * 1.3;
    const speed = 18 + Math.random() * 46;
    particles.push({
      type: "chip",
      x: DRILL_X + (Math.random() - 0.5) * 14,
      y: bitY + (Math.random() - 0.5) * 11,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 8,
      size: 1.3 + Math.random() * 4.2,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 7,
      life: 0.8 + Math.random() * 1.2,
      maxLife: 2,
      color: Math.random() > 0.35 ? "200, 248, 255" : "96, 198, 224"
    });
    if (particles.length > 170) particles.shift();
  }

  function spawnDust() {
    const bitY = depthToY(state.depth) - 8;
    particles.push({
      type: "dust",
      x: DRILL_X + (Math.random() - 0.5) * 29,
      y: bitY + (Math.random() - 0.5) * 22,
      vx: (Math.random() - 0.5) * 24,
      vy: -9 - Math.random() * 19,
      size: 0.6 + Math.random() * 1.5,
      rotation: 0,
      spin: 0,
      life: 0.45 + Math.random() * 0.5,
      maxLife: 0.95,
      color: state.temperature > 68 ? "255, 143, 82" : "158, 230, 246"
    });
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const particle = particles[i];
      particle.life -= dt;
      if (particle.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += (particle.type === "chip" ? 16 : -5) * dt;
      particle.vx *= 0.988;
      particle.rotation += particle.spin * dt;
    }
  }

  function drawParticles() {
    for (const particle of particles) {
      const alpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.save();
      ctx.translate(particle.x, particle.y);
      ctx.rotate(particle.rotation);
      if (particle.type === "chip") {
        ctx.fillStyle = `rgba(${particle.color}, ${alpha * 0.9})`;
        ctx.beginPath();
        ctx.moveTo(-particle.size, 0);
        ctx.lineTo(0, -particle.size * 0.7);
        ctx.lineTo(particle.size * 0.8, particle.size * 0.35);
        ctx.lineTo(-particle.size * 0.15, particle.size * 0.85);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = `rgba(236, 254, 255, ${alpha * 0.45})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      } else {
        ctx.fillStyle = `rgba(${particle.color}, ${alpha * 0.28})`;
        ctx.beginPath();
        ctx.arc(0, 0, particle.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawHudCards() {
    const current = getLayerAtDepth(state.depth);

    ctx.fillStyle = "rgba(3, 14, 23, 0.8)";
    roundedRect(ctx, 19, 17, 190, 91, 1);
    ctx.fill();
    ctx.strokeStyle = "rgba(158, 230, 250, 0.21)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "rgba(176, 235, 249, 0.56)";
    ctx.font = `7px ${CANVAS_MONO}`;
    ctx.fillText("DRILL DEPTH", 31, 32);
    ctx.fillStyle = "#d9f9ff";
    ctx.font = `600 32px ${CANVAS_DISPLAY}`;
    ctx.fillText(state.depth.toFixed(1), 30, 63);
    const depthWidth = ctx.measureText(state.depth.toFixed(1)).width;
    ctx.fillStyle = "rgba(158, 230, 250, 0.48)";
    ctx.font = `8px ${CANVAS_MONO}`;
    ctx.fillText("M", 35 + depthWidth, 63);
    ctx.fillStyle = "rgba(167, 238, 254, 0.54)";
    ctx.font = `7px ${CANVAS_MONO}`;
    ctx.fillText(`${current.layer.name} / ${(state.depth - current.start).toFixed(1)} M`, 31, 79);
    ctx.fillStyle = "rgba(177, 234, 248, 0.12)";
    ctx.fillRect(31, 88, 162, 2);
    ctx.fillStyle = "#78ddf7";
    ctx.fillRect(31, 88, (162 * (state.depth / TOTAL_DEPTH)), 2);

    ctx.fillStyle = "rgba(3, 14, 23, 0.8)";
    roundedRect(ctx, 708, 17, 168, 91, 1);
    ctx.fill();
    ctx.strokeStyle = "rgba(158, 230, 250, 0.21)";
    ctx.stroke();
    ctx.fillStyle = "rgba(176, 235, 249, 0.56)";
    ctx.font = `7px ${CANVAS_MONO}`;
    ctx.fillText("BIT TEMPERATURE", 720, 32);
    const tempHot = state.temperature >= 78;
    ctx.fillStyle = tempHot ? "#ff8b67" : "#d9f9ff";
    ctx.font = `600 28px ${CANVAS_DISPLAY}`;
    ctx.fillText(String(Math.round(state.temperature)), 720, 60);
    ctx.fillStyle = "rgba(158, 230, 250, 0.48)";
    ctx.font = `8px ${CANVAS_MONO}`;
    ctx.fillText("°C", 762, 60);
    ctx.fillStyle = "rgba(255, 120, 74, 0.18)";
    ctx.fillRect(720, 74, 141, 4);
    ctx.fillStyle = tempHot ? "#ff6857" : "#7bdcf3";
    ctx.fillRect(720, 74, 141 * clamp((state.temperature - AMBIENT_TEMP) / 82, 0, 1), 4);
    ctx.fillStyle = "rgba(218, 247, 255, 0.42)";
    ctx.font = `7px ${CANVAS_MONO}`;
    ctx.fillText("LIMIT 100", 720, 91);
    ctx.textAlign = "right";
    ctx.fillText(`LOAD ${(state.load * 100).toFixed(0)}`, 861, 91);
    ctx.textAlign = "left";
  }

  function drawChipTank() {
    const x = 738;
    const y = 205;
    const width = 88;
    const height = 192;
    ctx.fillStyle = "rgba(3, 14, 23, 0.68)";
    roundedRect(ctx, x, y, width, height, 1);
    ctx.fill();
    ctx.strokeStyle = "rgba(158, 230, 250, 0.16)";
    ctx.stroke();

    ctx.fillStyle = "rgba(168, 235, 249, 0.5)";
    ctx.font = `7px ${CANVAS_MONO}`;
    ctx.fillText("CHIP LOAD", x + 10, y + 16);

    const tankX = x + 23;
    const tankY = y + 29;
    const tankW = 42;
    const tankH = 132;
    ctx.strokeStyle = "rgba(186, 240, 252, 0.25)";
    ctx.strokeRect(tankX, tankY, tankW, tankH);
    const fillH = tankH * state.chips;
    const chipGradient = ctx.createLinearGradient(0, tankY + tankH, 0, tankY);
    chipGradient.addColorStop(0, "rgba(255, 104, 82, 0.76)");
    chipGradient.addColorStop(0.42, "rgba(255, 183, 95, 0.75)");
    chipGradient.addColorStop(1, "rgba(135, 235, 255, 0.75)");
    ctx.fillStyle = chipGradient;
    ctx.fillRect(tankX + 1, tankY + tankH - fillH, tankW - 2, fillH);

    const random = mulberry32(42);
    for (let i = 0; i < 19; i += 1) {
      const shardX = tankX + 4 + random() * (tankW - 8);
      const shardY = tankY + tankH - 5 - random() * fillH;
      ctx.fillStyle = `rgba(232, 253, 255, ${0.2 + random() * 0.38})`;
      ctx.beginPath();
      ctx.moveTo(shardX, shardY);
      ctx.lineTo(shardX + 2 + random() * 4, shardY - 1);
      ctx.lineTo(shardX + 1, shardY + 2);
      ctx.closePath();
      ctx.fill();
    }

    ctx.strokeStyle = "rgba(210, 248, 255, 0.3)";
    for (let i = 1; i < 4; i += 1) {
      const tickY = tankY + (tankH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(tankX + tankW, tickY);
      ctx.lineTo(tankX + tankW + 4, tickY);
      ctx.stroke();
    }

    const chipColor = state.chips > 0.72 ? "#ff6d68" : state.chips > 0.42 ? "#ffc663" : "#77ecc7";
    ctx.fillStyle = chipColor;
    ctx.font = `600 15px ${CANVAS_DISPLAY}`;
    ctx.fillText(`${Math.round(state.chips * 100)}%`, x + 11, y + 181);
  }

  function drawJamOverlay(bitY) {
    if (!state.jammed && state.jamTimer <= 0.02) return;
    const pulse = 0.5 + Math.sin(visualTime * 14) * 0.5;
    ctx.strokeStyle = `rgba(255, 73, 86, ${0.4 + pulse * 0.45})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.arc(DRILL_X, bitY - 8, 31 + pulse * 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(36, 5, 10, 0.84)";
    roundedRect(ctx, DRILL_X + 40, bitY - 52, 130, 48, 1);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 82, 96, 0.5)";
    ctx.stroke();
    ctx.fillStyle = "#ff6d78";
    ctx.font = `7px ${CANVAS_MONO}`;
    ctx.fillText("ROTATION STALL", DRILL_X + 52, bitY - 37);
    ctx.font = `600 18px ${CANVAS_DISPLAY}`;
    ctx.fillText(`${state.jamTimer.toFixed(1)}s`, DRILL_X + 52, bitY - 17);
    ctx.fillStyle = "rgba(255, 213, 217, 0.55)";
    ctx.font = `7px ${CANVAS_MONO}`;
    ctx.fillText("/ 5.0 FAIL", DRILL_X + 105, bitY - 18);
  }

  function drawEdgeFrame() {
    const vignette = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.25, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.72);
    vignette.addColorStop(0, "rgba(0, 4, 8, 0)");
    vignette.addColorStop(1, "rgba(0, 4, 8, 0.58)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.strokeStyle = "rgba(177, 235, 249, 0.15)";
    ctx.lineWidth = 1;
    ctx.strokeRect(10.5, 10.5, VIEW_W - 21, VIEW_H - 21);

    ctx.fillStyle = "rgba(204, 245, 255, 0.48)";
    ctx.font = `7px ${CANVAS_MONO}`;
    ctx.fillText(state.mode === "solo" ? "SOLO DEBUG FEED" : "LIVE TEAM FEED", 21, VIEW_H - 22);
    ctx.textAlign = "right";
    ctx.fillText(`PNG//${String(Math.floor(visualTime * 6) % 1000).padStart(3, "0")}`, VIEW_W - 22, VIEW_H - 22);
    ctx.textAlign = "left";
  }

  function render() {
    const scaleX = canvas.width / VIEW_W;
    const scaleY = canvas.height / VIEW_H;
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    drawSky(visualTime);
    drawIceLayers();
    drawLayerBoundaryLabels();
    const bitY = depthToY(state.depth);
    drawBorehole(bitY);
    drawSurfaceAndRig(visualTime);
    drawDrillString(bitY);
    drawDrillBit(bitY);
    drawParticles();
    drawDepthRuler();
    drawHudCards();
    drawChipTank();
    drawJamOverlay(bitY);
    drawEdgeFrame();
  }

  const drillAudio = {
    context: null,
    master: null,
    carrier: null,
    harmonic: null,
    filter: null,
    motorGain: null,
    enabled: true,
    frequency: 55,
    lastUpdate: 0
  };

  function ensureAudio() {
    if (drillAudio.context) {
      if (drillAudio.context.state === "suspended") drillAudio.context.resume();
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    const audioContext = new AudioContextClass();
    const master = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();
    const motorGain = audioContext.createGain();
    const carrier = audioContext.createOscillator();
    const harmonic = audioContext.createOscillator();

    master.gain.value = drillAudio.enabled ? 0.72 : 0;
    motorGain.gain.value = 0.0001;
    filter.type = "lowpass";
    filter.frequency.value = 560;
    filter.Q.value = 2.2;
    carrier.type = "sawtooth";
    carrier.frequency.value = 55;
    harmonic.type = "triangle";
    harmonic.frequency.value = 82.5;

    const harmonicGain = audioContext.createGain();
    harmonicGain.gain.value = 0.22;
    carrier.connect(filter);
    harmonic.connect(harmonicGain);
    harmonicGain.connect(filter);
    filter.connect(motorGain);
    motorGain.connect(master);
    master.connect(audioContext.destination);
    carrier.start();
    harmonic.start();

    drillAudio.context = audioContext;
    drillAudio.master = master;
    drillAudio.carrier = carrier;
    drillAudio.harmonic = harmonic;
    drillAudio.filter = filter;
    drillAudio.motorGain = motorGain;
  }

  function updateAudio(now) {
    if (!drillAudio.context || now - drillAudio.lastUpdate < 55) return;
    drillAudio.lastUpdate = now;
    const active = state.phase === "running" || state.phase === "complete";
    const vibration = state.jammed ? Math.sin(now * 0.032) * 12 : 0;
    const targetFrequency = active
      ? 48 + state.load * 214 + state.rpm * 94 + vibration
      : 42;
    const harmonicTarget = targetFrequency * 1.503;
    const volume = state.phase === "running"
      ? 0.018 + state.load * 0.052 + state.rpm * 0.022
      : state.phase === "complete" ? 0.012 : 0.0001;
    const filterFrequency = 260 + state.load * 1180 + state.rpm * 390;
    const glide = state.jammed ? 0.025 : 0.09;

    drillAudio.frequency = targetFrequency;
    drillAudio.carrier.frequency.setTargetAtTime(targetFrequency, drillAudio.context.currentTime, glide);
    drillAudio.harmonic.frequency.setTargetAtTime(harmonicTarget, drillAudio.context.currentTime, glide);
    drillAudio.filter.frequency.setTargetAtTime(filterFrequency, drillAudio.context.currentTime, 0.08);
    drillAudio.motorGain.gain.setTargetAtTime(volume, drillAudio.context.currentTime, 0.055);
  }

  function emitAudioCue(kind) {
    if (!drillAudio.context || !drillAudio.enabled) return;
    const context = drillAudio.context;
    const now = context.currentTime;
    const gain = context.createGain();
    const oscillator = context.createOscillator();
    oscillator.type = kind === "complete" ? "sine" : "square";
    oscillator.frequency.setValueAtTime(kind === "complete" ? 440 : 138, now);
    oscillator.frequency.exponentialRampToValueAtTime(kind === "complete" ? 880 : 74, now + 0.38);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.11, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    oscillator.connect(gain);
    gain.connect(drillAudio.master);
    oscillator.start(now);
    oscillator.stop(now + 0.53);
  }

  function getAudioDebugText() {
    if (!drillAudio.context) return "off";
    if (!drillAudio.enabled) return "muted";
    return `${drillAudio.context.state} ${Math.round(drillAudio.frequency)}hz`;
  }

  function updateAudioButton() {
    dom.audioText.textContent = drillAudio.enabled ? "声音开" : "已静音";
    dom.audioButton.setAttribute("aria-label", drillAudio.enabled ? "静音" : "开启声音");
    dom.audioButton.classList.toggle("active", !drillAudio.enabled);
    if (drillAudio.master && drillAudio.context) {
      drillAudio.master.gain.setTargetAtTime(drillAudio.enabled ? 0.72 : 0, drillAudio.context.currentTime, 0.03);
    }
  }

  function toggleAudio() {
    ensureAudio();
    drillAudio.enabled = !drillAudio.enabled;
    updateAudioButton();
  }

  function startRun() {
    ensureAudio();
    resetState();
    state.phase = "running";
    dom.introCard.hidden = true;
    dom.resultCard.hidden = true;
    dom.resultCard.classList.remove("failed");
    lastTime = performance.now();
    updateInterface();
  }

  function toggleMode(force) {
    const nextMode = force || (state.mode === "duo" ? "solo" : "duo");
    state.mode = nextMode;
    clearInputs();
    const solo = state.mode === "solo";
    document.body.classList.toggle("solo", solo);
    dom.debugPanel.hidden = !solo;
    dom.modeLabel.textContent = solo ? "单人调试" : "双人协作";
    dom.modeButton.innerHTML = solo ? '返回双人 <kbd>P</kbd>' : '单人调试 <kbd>P</kbd>';
    dom.modeButton.classList.toggle("active", solo);
    dom.footerHint.textContent = solo
      ? "调试映射：W/S 下压 · ↑/↓ 转速 · 空格排屑"
      : "左位 A/Z 下压 · 右位 ↑/↓ 转速 · 空格排屑";
    const roleBrief = document.querySelector(".role-brief");
    if (roleBrief) {
      roleBrief.innerHTML = solo
        ? "<span><b>压力</b> W / S</span><span><b>转速</b> ↑ / ↓</span><span><b>排屑</b> 空格</span>"
        : "<span><b>左位</b> 下压力 A / Z</span><span><b>右位</b> 转速 ↑ / ↓</span><span><b>右位</b> 排屑 空格</span>";
    }
    updateInterface();
  }

  function handleKeyDown(event) {
    if (event.code === "KeyP" && !event.repeat) {
      event.preventDefault();
      toggleMode();
      return;
    }

    const mapping = KEYMAP[state.mode];
    const action = mapping[event.code];
    if (!action) return;
    event.preventDefault();
    setInput(action, `key:${event.code}`, true);
  }

  function handleKeyUp(event) {
    const mapping = KEYMAP[state.mode];
    const action = mapping[event.code];
    if (!action) return;
    event.preventDefault();
    setInput(action, `key:${event.code}`, false);
  }

  function bindPointerControls() {
    document.querySelectorAll("[data-hold]").forEach((button) => {
      const action = button.dataset.hold;
      let pointerSource = null;
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        ensureAudio();
        pointerSource = `pointer:${action}:${event.pointerId}`;
        button.setPointerCapture(event.pointerId);
        setInput(action, pointerSource, true);
      });
      const release = (event) => {
        if (!pointerSource) return;
        setInput(action, pointerSource, false);
        pointerSource = null;
        if (event && button.hasPointerCapture?.(event.pointerId)) {
          button.releasePointerCapture(event.pointerId);
        }
      };
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("lostpointercapture", release);
    });
  }

  function exposeDebugApi() {
    window.__iceRig = {
      version: "1.0.0",
      snapshot() {
        return {
          phase: state.phase,
          mode: state.mode,
          failReason: state.failReason,
          depth: Number(state.depth.toFixed(3)),
          elapsed: Number(state.elapsed.toFixed(3)),
          pressure: Number(state.pressure.toFixed(4)),
          rpmNormalized: Number(state.rpm.toFixed(4)),
          rpm: Math.round(state.rpm * 1600),
          chips: Number(state.chips.toFixed(4)),
          temperature: Number(state.temperature.toFixed(2)),
          maxTemperature: Number(state.maxTemperature.toFixed(2)),
          jammed: state.jammed,
          jamTimer: Number(state.jamTimer.toFixed(3)),
          load: Number(state.load.toFixed(4)),
          penetrationRate: Number(state.penetrationRate.toFixed(3)),
          layerIndex: state.layerIndex,
          activeInputs: [...activeInputs],
          clearing: state.clearing,
          audio: {
            enabled: drillAudio.enabled,
            state: drillAudio.context?.state || "uninitialized",
            frequency: Number(drillAudio.frequency.toFixed(1))
          },
          totalDepth: TOTAL_DEPTH
        };
      },
      start: startRun,
      toggleMode,
      setMode(mode) {
        if (mode === "duo" || mode === "solo") toggleMode(mode);
      },
      lastResult: null
    };
  }

  function updateFps(dt) {
    fpsAccumulator += dt;
    fpsFrames += 1;
    if (fpsAccumulator >= 0.75) {
      dom.fpsValue.textContent = `${Math.round(fpsFrames / fpsAccumulator)} FPS`;
      fpsAccumulator = 0;
      fpsFrames = 0;
    }
  }

  let uiAccumulator = 0;

  function gameLoop(now) {
    const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    visualTime += dt;
    updateSimulation(dt);
    updateParticles(dt);
    updateAudio(now);

    if (!state.jammed) {
      drillAngle += dt * (0.35 + state.rpm * 31);
    }

    uiAccumulator += dt;
    if (uiAccumulator > 0.055) {
      updateInterface();
      uiAccumulator = 0;
    }
    updateFps(dt);
    render();
    requestAnimationFrame(gameLoop);
  }

  dom.startButton.addEventListener("click", startRun);
  dom.retryButton.addEventListener("click", startRun);
  dom.modeButton.addEventListener("click", () => {
    ensureAudio();
    toggleMode();
  });
  dom.audioButton.addEventListener("click", toggleAudio);
  window.addEventListener("keydown", handleKeyDown, { passive: false });
  window.addEventListener("keyup", handleKeyUp, { passive: false });
  window.addEventListener("blur", clearInputs);
  window.addEventListener("resize", resizeCanvas);

  bindPointerControls();
  updateAudioButton();
  resizeCanvas();
  exposeDebugApi();
  updateInterface();
  render();
  requestAnimationFrame(gameLoop);
})();






