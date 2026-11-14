(() => {
  "use strict";

  const W = 1280;
  const H = 720;
  const WORLD_END = 4200;
  const START_X = 120;
  const FINISH_X = 4080;
  const CARGO_LIMIT = 65;
  const HULL_HALF = 21;
  const HULL_LENGTH = 136;

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const shell = document.getElementById("gameShell");
  const ui = {
    state: document.getElementById("runState"),
    progress: document.getElementById("progressFill"),
    distance: document.getElementById("distanceLabel"),
    speed: document.getElementById("speedValue"),
    cargo: document.getElementById("cargoValue"),
    hull: document.getElementById("hullValue"),
    frontAngle: document.getElementById("frontAngle"),
    rearAngle: document.getElementById("rearAngle"),
    bendValue: document.getElementById("bendValue"),
    bendNeedle: document.getElementById("bendNeedle"),
    cargoTilt: document.getElementById("cargoTiltFill"),
    cargoTiltValue: document.getElementById("cargoTiltValue"),
    hullFill: document.getElementById("hullFill"),
    hullFillValue: document.getElementById("hullFillValue"),
    toast: document.getElementById("toast"),
    startPanel: document.getElementById("startPanel"),
    endPanel: document.getElementById("endPanel"),
    endKicker: document.getElementById("endKicker"),
    endTitle: document.getElementById("endTitle"),
    endReason: document.getElementById("endReason"),
    endDistance: document.getElementById("endDistance"),
    endCargo: document.getElementById("endCargo"),
    endHull: document.getElementById("endHull"),
    endTime: document.getElementById("endTime"),
    stages: [
      document.getElementById("stageOne"),
      document.getElementById("stageTwo"),
      document.getElementById("stageThree"),
    ],
    frontPanel: document.querySelector(".helm-front"),
    rearPanel: document.querySelector(".helm-rear"),
  };

  const controls = { front: 0, rear: 0, throttle: 0 };
  const heldKeys = new Set();
  let mode = "ready";
  let outcome = "";
  let lastFrame = performance.now();
  let uiClock = 0;
  let gameTime = 0;
  let toastTimer = null;
  let collisionLock = 0;
  let wakeCounter = 0;
  let damageTier = 0;
  let viewScale = 1;
  let viewX = 0;
  let viewY = 0;
  let dpr = 1;

  const RIVER_POINTS = [
    [-280, 380], [-120, 361], [90, 350], [310, 326],
    [530, 250], [790, 265], [1010, 402], [1250, 471],
    [1470, 433], [1650, 301], [1870, 264], [2070, 377],
    [2260, 498], [2460, 481], [2680, 346], [2890, 294],
    [3110, 340], [3340, 427], [3560, 453], [3790, 414],
    [4020, 429], [4310, 432],
  ];
  const riverSamples = buildRiverSamples();

  function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (
      2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    );
  }

  function buildRiverSamples() {
    const samples = [];
    for (let i = 0; i < RIVER_POINTS.length - 1; i += 1) {
      const p0 = RIVER_POINTS[Math.max(0, i - 1)];
      const p1 = RIVER_POINTS[i];
      const p2 = RIVER_POINTS[i + 1];
      const p3 = RIVER_POINTS[Math.min(RIVER_POINTS.length - 1, i + 2)];
      const span = p2[0] - p1[0];
      const steps = Math.max(4, Math.ceil(span / 3));
      for (let j = 0; j < steps; j += 1) {
        const t = j / steps;
        samples.push({
          x: p1[0] + span * t,
          y: catmull(p0[1], p1[1], p2[1], p3[1], t),
        });
      }
    }
    const last = RIVER_POINTS[RIVER_POINTS.length - 1];
    samples.push({ x: last[0], y: last[1] });
    return samples;
  }

  function riverAt(x) {
    if (x <= riverSamples[0].x) return riverSamples[0].y;
    if (x >= riverSamples[riverSamples.length - 1].x) {
      return riverSamples[riverSamples.length - 1].y;
    }
    let lo = 0;
    let hi = riverSamples.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (riverSamples[mid].x <= x) lo = mid;
      else hi = mid;
    }
    const a = riverSamples[lo];
    const b = riverSamples[hi];
    const t = (x - a.x) / Math.max(0.001, b.x - a.x);
    return a.y + (b.y - a.y) * t;
  }

  function halfWidthAt(x) {
    const p = Math.max(0, Math.min(1, x / WORLD_END));
    return 120 - p * 27 + Math.sin(x * 0.0031 + 2.1) * 5;
  }

  function tangentAt(x) {
    return Math.atan2(riverAt(x + 2) - riverAt(x - 2), 4);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function damp(current, target, speed, dt) {
    return lerp(current, target, 1 - Math.exp(-speed * dt));
  }

  function createBarge() {
    const y = riverAt(START_X);
    return {
      x: START_X,
      y,
      heading: tangentAt(START_X),
      speed: 0,
      front: 0,
      rear: 0,
      bend: 0,
      sideVelocity: 0,
      hull: 100,
      cargoDamage: 0,
      cargoLat: 0,
      cargoLatVelocity: 0,
      cargoLong: 0,
      cargoLongVelocity: 0,
      lastTurn: 0,
      scrape: 0,
    };
  }

  let barge = createBarge();
  let cameraX = START_X - 430;
  const wake = [];
  const sparks = [];
  const ripples = [];

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    viewScale = Math.min(canvas.width / W, canvas.height / H);
    viewX = (canvas.width - W * viewScale) * 0.5;
    viewY = (canvas.height - H * viewScale) * 0.5;
  }

  function beginGame() {
    if (mode === "running") return;
    if (mode === "ready" && !sound.ready) sound.init();
    if (mode !== "ready") resetGame(false);
    mode = "running";
    outcome = "";
    gameTime = 0;
    barge.speed = 112;
    shell.dataset.mode = mode;
    shell.dataset.outcome = "";
    ui.startPanel.hidden = true;
    ui.endPanel.hidden = true;
    ui.state.textContent = "正在通过";
    sound.setActive(true);
  }

  function resetGame(autoStart) {
    mode = "ready";
    outcome = "";
    barge = createBarge();
    cameraX = START_X - 430;
    gameTime = 0;
    collisionLock = 0;
    wake.length = 0;
    sparks.length = 0;
    ripples.length = 0;
    controls.front = 0;
    controls.rear = 0;
    controls.throttle = 0;
    heldKeys.clear();
    shell.dataset.mode = mode;
    shell.dataset.outcome = "";
    ui.startPanel.hidden = false;
    ui.endPanel.hidden = true;
    ui.state.textContent = "等待解缆";
    ui.frontPanel.classList.remove("engaged");
    ui.rearPanel.classList.remove("engaged");
    sound.setActive(false);
    if (autoStart) beginGame();
    else render();
  }

  const frontKeys = new Set(["a", "d"]);
  const rearKeys = new Set(["arrowleft", "arrowright", "j", "l"]);
  const throttleKeys = new Set(["w", "s"]);

  function updateControlsFromKeys() {
    const frontLeft = heldKeys.has("a");
    const frontRight = heldKeys.has("d");
    const rearLeft = heldKeys.has("arrowleft") || heldKeys.has("j");
    const rearRight = heldKeys.has("arrowright") || heldKeys.has("l");
    controls.front = (frontRight ? 1 : 0) - (frontLeft ? 1 : 0);
    controls.rear = (rearRight ? 1 : 0) - (rearLeft ? 1 : 0);
    controls.throttle = (heldKeys.has("w") ? 1 : 0) - (heldKeys.has("s") ? 1 : 0);
  }

  function spinePoints() {
    const points = [];
    const cos = Math.cos(barge.heading);
    const sin = Math.sin(barge.heading);
    for (let i = 0; i <= 6; i += 1) {
      const t = i / 6;
      const along = (t - 0.5) * HULL_LENGTH;
      const bendOffset = barge.bend * 21 * Math.sin(Math.PI * t);
      points.push({
        x: barge.x + cos * along - sin * bendOffset,
        y: barge.y + sin * along + cos * bendOffset,
        t,
      });
    }
    return points;
  }

  function showToast(message, danger = false, duration = 1800) {
    ui.toast.textContent = message;
    ui.toast.classList.toggle("danger", danger);
    ui.toast.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => ui.toast.classList.remove("show"), duration);
  }

  function endGame(won, title, reason) {
    if (mode !== "running") return;
    mode = won ? "won" : "lost";
    outcome = won ? "won" : "lost";
    shell.dataset.mode = mode;
    shell.dataset.outcome = outcome;
    ui.endPanel.hidden = false;
    ui.endKicker.textContent = won ? "抵 达 终 点" : "航 行 终 止";
    ui.endTitle.textContent = title;
    ui.endReason.textContent = reason;
    ui.endDistance.textContent = `${Math.round(progress() * 4200).toLocaleString("zh-CN")} m`;
    ui.endCargo.textContent = `${Math.round(barge.cargoDamage)}%`;
    ui.endHull.textContent = `${Math.max(0, Math.round(barge.hull))}%`;
    ui.endTime.textContent = formatTime(gameTime);
    ui.state.textContent = won ? "平安抵港" : "航行终止";
    sound.end(won);
    window.dispatchEvent(new CustomEvent("bargegameend", {
      detail: { outcome, title, reason, cargoDamage: barge.cargoDamage, hull: barge.hull },
    }));
  }

  function formatTime(seconds) {
    const whole = Math.max(0, Math.floor(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
  }

  function progress() {
    return clamp((barge.x - START_X) / (FINISH_X - START_X), 0, 1);
  }

  function spawnSparks(x, y, side) {
    for (let i = 0; i < 3; i += 1) {
      sparks.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 100 - side * 35,
        vy: (Math.random() - 0.5) * 90,
        age: 0,
        life: 0.35 + Math.random() * 0.35,
      });
    }
  }

  function checkBanks(dt) {
    const points = spinePoints();
    let deepest = 0;
    let contactX = barge.x;
    let contactY = barge.y;
    let contactSide = 1;

    for (const point of points) {
      const centerY = riverAt(point.x);
      const limit = halfWidthAt(point.x) - HULL_HALF;
      const offset = point.y - centerY;
      const penetration = Math.abs(offset) - limit;
      if (penetration > deepest) {
        deepest = penetration;
        contactX = point.x;
        contactY = point.y;
        contactSide = Math.sign(offset) || 1;
      }
    }

    if (deepest <= 0) {
      barge.scrape = Math.max(0, barge.scrape - dt * 3.5);
      return;
    }

    barge.scrape = clamp(deepest / 18, 0, 1);
    barge.hull = Math.max(0, barge.hull - (2.4 + barge.speed * 0.018) * dt);
    barge.cargoDamage += (1.05 + barge.speed * 0.008) * dt;
    barge.sideVelocity -= contactSide * Math.min(180, 40 + deepest * 5) * dt;
    collisionLock -= dt;
    if (collisionLock <= 0) {
      spawnSparks(contactX, contactY, contactSide);
      collisionLock = 0.09;
    }
    if (deepest > 6 && gameTime % 0.45 < dt) {
      showToast("船帮擦岸 · 货箱正在移位", true, 900);
    }

    const hardImpact = (deepest > 7 && barge.speed > 152) || deepest > 25;
    if (hardImpact) {
      barge.hull = 0;
      sound.impact();
      endGame(false, "船体撞裂", "速度过快，船帮硬撞河岸，驳船当场断成两截。");
    } else if (barge.hull <= 0) {
      sound.impact();
      endGame(false, "船体解体", "持续的贴岸磨损耗尽了船帮，河水灌入货舱。");
    }
  }

  function updateGame(dt) {
    gameTime += dt;
    const previousSpeed = barge.speed;
    const targetSpeed = 142 + controls.throttle * 57;
    barge.speed = damp(barge.speed, targetSpeed, 1.15, dt);
    barge.front = damp(barge.front, controls.front, 5.4, dt);
    barge.rear = damp(barge.rear, controls.rear, 5.4, dt);
    barge.bend = damp(barge.bend, (barge.front - barge.rear) * 0.92, 3.3, dt);

    const difference = barge.front - barge.rear;
    const turnDemand = barge.front * 0.58 + barge.rear * 0.42;
    const turnRate = turnDemand * (0.38 + barge.speed / 320) * 1.28;
    barge.heading += turnRate * dt;
    barge.lastTurn = turnRate;

    const sidePush = difference * barge.speed * barge.speed * 0.00055;
    barge.sideVelocity = damp(barge.sideVelocity, 0, 2.15, dt) + sidePush * dt;
    const cos = Math.cos(barge.heading);
    const sin = Math.sin(barge.heading);
    barge.x += cos * barge.speed * dt;
    barge.y += sin * barge.speed * dt + barge.sideVelocity * dt;

    const acceleration = (barge.speed - previousSpeed) / Math.max(dt, 0.001);
    const cargoForce = turnRate * (0.72 + barge.speed / 260) + barge.bend * 0.72;
    barge.cargoLatVelocity += (cargoForce * 3.8 - barge.cargoLat * 7.2) * dt;
    barge.cargoLatVelocity *= Math.exp(-0.55 * dt);
    barge.cargoLat = clamp(barge.cargoLat + barge.cargoLatVelocity * dt, -1.28, 1.28);
    barge.cargoLongVelocity += (-acceleration * 0.085 - barge.cargoLong * 6.4) * dt;
    barge.cargoLong = clamp(barge.cargoLong + barge.cargoLongVelocity * dt, -0.75, 0.75);

    const tiltStress = Math.max(0, Math.abs(barge.cargoLat) - 0.76) * 3.2;
    const joltStress = Math.max(0, Math.abs(barge.cargoLatVelocity) - 0.7) * 0.7;
    barge.cargoDamage += (tiltStress + joltStress) * dt;
    barge.cargoDamage = Math.min(100, barge.cargoDamage);
    barge.hull = Math.max(0, barge.hull);

    checkBanks(dt);

    const tier = barge.cargoDamage >= 85 ? 4 : barge.cargoDamage >= CARGO_LIMIT ? 3 :
      barge.cargoDamage >= 45 ? 2 : barge.cargoDamage >= 25 ? 1 : 0;
    if (tier > damageTier && mode === "running") {
      if (tier === 3) showToast("货损已越过胜利上限", true, 2200);
      else if (tier < 3) showToast("货箱滑向船舷，留意倾斜", false, 1600);
      damageTier = tier;
    }

    if (barge.cargoDamage >= 100) {
      endGame(false, "货物倾覆", "货箱全部滑出甲板，这趟运输已经无法交付。");
    } else if (barge.x >= FINISH_X) {
      if (barge.cargoDamage < CARGO_LIMIT) {
        endGame(true, "平安抵港", "船身完整，货损在交付上限以内。两副舵都找到了同一个节奏。");
      } else {
        endGame(false, "交付失败", `抵达了终点，但货损 ${Math.round(barge.cargoDamage)}% 已越过 ${CARGO_LIMIT}% 上限。`);
      }
    }

    updateEffects(dt);
    cameraX = damp(cameraX, barge.x - 430, 4.5, dt);
  }

  function updateEffects(dt) {
    wakeCounter += dt;
    if (wakeCounter > 0.045 && mode === "running") {
      wakeCounter = 0;
      const cos = Math.cos(barge.heading);
      const sin = Math.sin(barge.heading);
      const sternX = barge.x - cos * HULL_LENGTH * 0.49;
      const sternY = barge.y - sin * HULL_LENGTH * 0.49;
      wake.push({
        x: sternX - sin * 9,
        y: sternY + cos * 9,
        vx: -cos * 18 + barge.sideVelocity * 0.18,
        vy: -sin * 18,
        age: 0,
        life: 1.5,
        color: "teal",
        angle: barge.heading + barge.front * 0.24,
      });
      wake.push({
        x: sternX + sin * 9,
        y: sternY - cos * 9,
        vx: -cos * 18,
        vy: -sin * 18,
        age: 0,
        life: 1.35,
        color: "amber",
        angle: barge.heading + barge.rear * 0.24,
      });
    }

    for (let i = wake.length - 1; i >= 0; i -= 1) {
      const item = wake[i];
      item.age += dt;
      item.x += item.vx * dt;
      item.y += item.vy * dt;
      if (item.age > item.life) wake.splice(i, 1);
    }
    for (let i = sparks.length - 1; i >= 0; i -= 1) {
      const item = sparks[i];
      item.age += dt;
      item.vy += 90 * dt;
      item.x += item.vx * dt;
      item.y += item.vy * dt;
      if (item.age > item.life) sparks.splice(i, 1);
    }
    for (let i = ripples.length - 1; i >= 0; i -= 1) {
      const item = ripples[i];
      item.age += dt;
      if (item.age > item.life) ripples.splice(i, 1);
    }
  }

  function seededRandom(seed) {
    let value = seed >>> 0;
    return () => {
      value = (value * 1664525 + 1013904223) >>> 0;
      return value / 4294967296;
    };
  }

  const scenery = buildScenery();

  function buildScenery() {
    const random = seededRandom(46821);
    const items = [];
    for (let x = -260; x < WORLD_END + 240; x += 31) {
      const center = riverAt(x);
      const half = halfWidthAt(x);
      for (const side of [-1, 1]) {
        if (random() < 0.82) {
          const distance = half + 22 + Math.pow(random(), 1.7) * 180;
          items.push({
            x: x + (random() - 0.5) * 22,
            y: center + side * distance,
            size: 2 + random() * 8,
            kind: random() > 0.74 ? "tree" : "grass",
            shade: random(),
            side,
          });
        }
      }
    }
    return items;
  }

  function traceRiverEdge(side, inset, step) {
    const left = cameraX - 100;
    const right = cameraX + W + 100;
    ctx.beginPath();
    let first = true;
    for (let x = left; x <= right; x += step) {
      const rough = Math.sin(x * 0.041) * 2.2 + Math.sin(x * 0.113 + 1.8) * 1.3;
      const y = riverAt(x) + side * (halfWidthAt(x) + rough - inset);
      if (first) {
        ctx.moveTo(x, y);
        first = false;
      } else {
        ctx.lineTo(x, y);
      }
    }
  }

  function drawLand(time) {
    const topGradient = ctx.createLinearGradient(0, 0, 0, H);
    topGradient.addColorStop(0, "#173a31");
    topGradient.addColorStop(0.45, "#102d28");
    topGradient.addColorStop(1, "#071a1b");
    ctx.fillStyle = topGradient;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(-cameraX, 0);
    const wash = ctx.createLinearGradient(0, 0, W + cameraX, 0);
    wash.addColorStop(0, "rgba(109, 142, 101, 0.05)");
    wash.addColorStop(0.5, "rgba(172, 174, 113, 0.1)");
    wash.addColorStop(1, "rgba(30, 79, 66, 0.04)");
    ctx.fillStyle = wash;
    ctx.fillRect(cameraX - 100, 0, W + 200, H);

    ctx.globalAlpha = 0.42;
    for (let x = cameraX - 150; x < cameraX + W + 150; x += 68) {
      const y = riverAt(x);
      const half = halfWidthAt(x);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.strokeStyle = side < 0 ? "rgba(111, 140, 100, 0.18)" : "rgba(3, 14, 16, 0.2)";
        ctx.lineWidth = 1;
        ctx.moveTo(x - 30, y + side * (half + 22));
        ctx.quadraticCurveTo(x + 5, y + side * (half + 80), x + 65, y + side * (half + 155));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    for (const item of scenery) {
      if (item.x < cameraX - 60 || item.x > cameraX + W + 60) continue;
      if (item.y < -20 || item.y > H + 20) continue;
      const glow = item.kind === "tree" ? 0.5 : 0.24;
      ctx.globalAlpha = glow * (0.5 + item.shade * 0.45);
      ctx.fillStyle = item.side < 0 ? "#254b3d" : "#1b4037";
      const size = item.kind === "tree" ? item.size * 1.8 : item.size * 0.65;
      ctx.beginPath();
      ctx.ellipse(item.x, item.y, size * 0.8, size, item.shade * 2, 0, Math.PI * 2);
      ctx.fill();
      if (item.kind === "tree") {
        ctx.globalAlpha = 0.34;
        ctx.fillStyle = "#7a9369";
        ctx.beginPath();
        ctx.ellipse(item.x - size * 0.22, item.y - size * 0.3, size * 0.33, size * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    const haze = ctx.createRadialGradient(W * 0.5, H * 0.48, 50, W * 0.5, H * 0.48, W * 0.7);
    haze.addColorStop(0, "rgba(57, 115, 99, 0.015)");
    haze.addColorStop(1, "rgba(1, 11, 13, 0.52)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, W, H);

    ctx.globalAlpha = 0.1 + Math.sin(time * 0.13) * 0.025;
    ctx.fillStyle = "#b8d2b5";
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  function traceRiverPolygon() {
    const left = cameraX - 100;
    const right = cameraX + W + 100;
    const step = 12;
    traceRiverEdge(-1, 0, step);
    for (let x = right; x >= left; x -= step) {
      const rough = Math.sin(x * 0.041) * 2.2 + Math.sin(x * 0.113 + 1.8) * 1.3;
      ctx.lineTo(x, riverAt(x) + halfWidthAt(x) + rough);
    }
    ctx.closePath();
  }

  function drawWater(time) {
    ctx.save();
    ctx.translate(-cameraX, 0);
    traceRiverPolygon();
    const water = ctx.createLinearGradient(0, 120, 0, 590);
    water.addColorStop(0, "#154752");
    water.addColorStop(0.46, "#0b3843");
    water.addColorStop(1, "#082832");
    ctx.fillStyle = water;
    ctx.fill();

    ctx.save();
    traceRiverPolygon();
    ctx.clip();

    const left = cameraX - 80;
    const right = cameraX + W + 80;
    for (let x = left - (left % 34); x < right; x += 34) {
      const center = riverAt(x);
      const half = halfWidthAt(x);
      const drift = Math.sin(time * 0.45 + x * 0.014) * 9;
      for (let row = -2; row <= 2; row += 1) {
        const y = center + row * half * 0.31 + drift + Math.sin(x * 0.27 + row) * 4;
        const length = 14 + (Math.abs(row) === 1 ? 17 : 7);
        ctx.strokeStyle = row === 0 ? "rgba(129, 191, 190, 0.12)" : "rgba(113, 178, 177, 0.055)";
        ctx.lineWidth = row === 0 ? 1.1 : 0.7;
        ctx.beginPath();
        ctx.moveTo(x - length * 0.5, y);
        ctx.quadraticCurveTo(x, y - 1.5, x + length * 0.5, y);
        ctx.stroke();
      }
    }

    const glint = ctx.createRadialGradient(
      cameraX + W * 0.47, riverAt(cameraX + W * 0.47), 5,
      cameraX + W * 0.47, riverAt(cameraX + W * 0.47), 310
    );
    glint.addColorStop(0, "rgba(115, 194, 176, 0.12)");
    glint.addColorStop(0.45, "rgba(79, 147, 137, 0.06)");
    glint.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glint;
    ctx.fillRect(cameraX, 0, W, H);

    for (let i = 0; i < 46; i += 1) {
      const baseX = (i * 97.3 + 43) % WORLD_END;
      const x = baseX + ((time * (5 + (i % 4)) + i * 7) % 50) - 25;
      if (x < cameraX - 20 || x > cameraX + W + 20) continue;
      const y = riverAt(baseX) + ((i * 43) % 160) - 80;
      ctx.fillStyle = `rgba(164, 212, 198, ${0.025 + (i % 3) * 0.012})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 5 + (i % 4) * 2, 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.lineWidth = 9;
    ctx.strokeStyle = "rgba(78, 120, 103, 0.18)";
    traceRiverEdge(-1, 4, 14);
    ctx.stroke();
    traceRiverEdge(1, 4, 14);
    ctx.stroke();

    ctx.lineWidth = 1.4;
    ctx.strokeStyle = "rgba(157, 192, 165, 0.3)";
    traceRiverEdge(-1, 0.5, 14);
    ctx.stroke();
    traceRiverEdge(1, 0.5, 14);
    ctx.stroke();

    ctx.restore();
  }

  function drawBuoy(x, side, color, label) {
    const y = riverAt(x) + side * (halfWidthAt(x) - 10);
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = "rgba(213, 225, 204, 0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.lineTo(0, 16);
    ctx.stroke();
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    if (label) {
      ctx.fillStyle = "rgba(226, 230, 211, 0.68)";
      ctx.font = '8px "Noto Serif SC", serif';
      ctx.textAlign = "center";
      ctx.fillText(label, 0, side < 0 ? -11 : 25);
    }
    ctx.restore();
  }

  function drawGate(x, label, color) {
    const center = riverAt(x);
    const half = halfWidthAt(x);
    ctx.save();
    ctx.translate(x, 0);
    ctx.setLineDash([3, 8]);
    ctx.strokeStyle = "rgba(219, 228, 207, 0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, center - half);
    ctx.lineTo(0, center + half);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = color;
    ctx.font = '9px "Noto Serif SC", serif';
    ctx.textAlign = "center";
    ctx.letterSpacing = "3px";
    ctx.fillText(label, -center, 3);
    ctx.restore();
    drawBuoy(x, -1, color, "");
    drawBuoy(x, 1, color, "");
  }

  function drawFinish(time) {
    const x = FINISH_X;
    const center = riverAt(x);
    const half = halfWidthAt(x);
    const top = center - half - 24;
    const bottom = center + half + 24;
    ctx.save();
    ctx.translate(x, 0);
    const glow = 0.55 + Math.sin(time * 2.1) * 0.12;
    for (const y of [top, bottom]) {
      ctx.fillStyle = "#d4c38d";
      ctx.fillRect(-2, y - 17, 4, 34);
      ctx.shadowColor = "rgba(240, 189, 104, 0.8)";
      ctx.shadowBlur = 18;
      ctx.fillStyle = `rgba(240, 189, 104, ${glow})`;
      ctx.beginPath();
      ctx.arc(0, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.strokeStyle = "rgba(231, 216, 171, 0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, top);
    ctx.lineTo(0, bottom);
    ctx.stroke();
    for (let y = top + 8; y < bottom; y += 16) {
      ctx.fillStyle = (Math.floor((y - top) / 16) % 2) ? "#e2d6ae" : "#6f9b8d";
      ctx.fillRect(-4, y, 8, 4);
    }
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = "rgba(240, 223, 179, 0.9)";
    ctx.font = '11px "Noto Serif SC", serif';
    ctx.textAlign = "center";
    ctx.fillText("终 · 交 付 口", -center + 55, 4);
    ctx.restore();
  }

  function drawRouteMarkers(time) {
    ctx.save();
    ctx.translate(-cameraX, 0);
    drawGate(1480, "壹 · 回澜", "rgba(240, 189, 104, 0.8)");
    drawGate(2800, "贰 · 窄门", "rgba(240, 189, 104, 0.8)");
    drawFinish(time);
    if (cameraX < 280) {
      ctx.save();
      ctx.translate(START_X, riverAt(START_X));
      ctx.strokeStyle = "rgba(94, 211, 180, 0.35)";
      ctx.setLineDash([5, 7]);
      ctx.beginPath();
      ctx.moveTo(0, -halfWidthAt(START_X));
      ctx.lineTo(0, halfWidthAt(START_X));
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawWake() {
    ctx.save();
    ctx.translate(-cameraX, 0);
    ctx.lineCap = "round";
    for (const item of wake) {
      const fade = 1 - item.age / item.life;
      const color = item.color === "teal" ? "94, 211, 180" : "240, 189, 104";
      const length = 14 + item.age * 19;
      const dx = Math.cos(item.angle) * length;
      const dy = Math.sin(item.angle) * length;
      ctx.strokeStyle = `rgba(${color}, ${fade * 0.34})`;
      ctx.lineWidth = 0.8 + fade * 1.2;
      ctx.beginPath();
      ctx.moveTo(item.x, item.y);
      ctx.lineTo(item.x - dx, item.y - dy);
      ctx.stroke();
      ctx.fillStyle = `rgba(${color}, ${fade * 0.18})`;
      ctx.beginPath();
      ctx.arc(item.x - dx * 0.72, item.y - dy * 0.72, 1.1 + fade * 2.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawSparks() {
    ctx.save();
    ctx.translate(-cameraX, 0);
    for (const item of sparks) {
      const fade = 1 - item.age / item.life;
      ctx.fillStyle = `rgba(245, 195, 102, ${fade})`;
      ctx.beginPath();
      ctx.arc(item.x, item.y, 1.2 + fade * 1.7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawHullPath(points, inset) {
    const normalX = -Math.sin(barge.heading);
    const normalY = Math.cos(barge.heading);
    const widths = points.map((point) => {
      const t = point.t;
      return Math.max(4, 16 + Math.sin(Math.PI * t) * 6 + (1 - t) * 3 - inset);
    });
    ctx.beginPath();
    points.forEach((point, index) => {
      const x = point.x + normalX * widths[index];
      const y = point.y + normalY * widths[index];
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    for (let i = points.length - 1; i >= 0; i -= 1) {
      ctx.lineTo(
        points[i].x - normalX * widths[i],
        points[i].y - normalY * widths[i]
      );
    }
    ctx.closePath();
    return widths;
  }

  function drawCargo(cos, sin) {
    ctx.save();
    ctx.translate(barge.x, barge.y);
    ctx.rotate(barge.heading);
    const slideX = barge.cargoLong * 8;
    const slideY = barge.cargoLat * 14;

    ctx.strokeStyle = "rgba(226, 193, 134, 0.25)";
    ctx.lineWidth = 0.8;
    for (const railY of [-16, 16]) {
      ctx.beginPath();
      ctx.moveTo(-53, railY);
      ctx.lineTo(53, railY + slideY * 0.12);
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(slideX, slideY);
    ctx.rotate(barge.cargoLatVelocity * 0.045);
    const crates = [
      { x: -28, y: -10, size: 19, tone: "#9c6c3f" },
      { x: -7, y: 7, size: 22, tone: "#b17d48" },
      { x: 20, y: -5, size: 24, tone: "#8f5c32" },
      { x: 40, y: 11, size: 16, tone: "#a97142" },
    ];
    for (const crate of crates) {
      ctx.save();
      ctx.translate(crate.x, crate.y);
      ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
      ctx.fillRect(-crate.size / 2 + 2, -crate.size / 2 + 2, crate.size, crate.size);
      ctx.fillStyle = crate.tone;
      ctx.fillRect(-crate.size / 2, -crate.size / 2, crate.size, crate.size);
      ctx.strokeStyle = "rgba(237, 199, 136, 0.72)";
      ctx.lineWidth = 0.8;
      ctx.strokeRect(-crate.size / 2, -crate.size / 2, crate.size, crate.size);
      ctx.strokeStyle = "rgba(62, 38, 23, 0.58)";
      ctx.beginPath();
      ctx.moveTo(-crate.size / 2, -crate.size * 0.22);
      ctx.lineTo(crate.size / 2, -crate.size * 0.22);
      ctx.moveTo(-crate.size / 2, crate.size * 0.24);
      ctx.lineTo(crate.size / 2, crate.size * 0.24);
      ctx.moveTo(0, -crate.size / 2);
      ctx.lineTo(0, crate.size / 2);
      ctx.stroke();
      ctx.restore();
    }
    if (Math.abs(barge.cargoLat) > 0.78) {
      ctx.strokeStyle = `rgba(241, 124, 103, ${0.35 + Math.sin(performance.now() * 0.02) * 0.2})`;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(-48, 16, 96, 4);
    }
    ctx.restore();
    ctx.restore();
  }

  function drawBarge(time) {
    const points = spinePoints();
    const difference = Math.abs(barge.front - barge.rear);
    ctx.save();
    ctx.translate(-cameraX, 0);

    ctx.save();
    ctx.translate(8, 11);
    drawHullPath(points, 0);
    ctx.fillStyle = "rgba(0, 9, 10, 0.46)";
    ctx.filter = "blur(2px)";
    ctx.fill();
    ctx.restore();

    drawHullPath(points, 0);
    ctx.fillStyle = barge.scrape > 0.05 ? "#9f8667" : "#bcae8c";
    ctx.strokeStyle = difference > 1.25 ? "rgba(241, 124, 103, 0.88)" : "rgba(225, 213, 177, 0.64)";
    ctx.lineWidth = 1.4;
    ctx.shadowColor = difference > 1.25 ? "rgba(241, 124, 103, 0.35)" : "transparent";
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    drawHullPath(points, 5);
    ctx.fillStyle = "#574631";
    ctx.fill();

    const normalX = -Math.sin(barge.heading);
    const normalY = Math.cos(barge.heading);
    ctx.strokeStyle = "rgba(218, 194, 144, 0.21)";
    ctx.lineWidth = 0.7;
    for (let i = 1; i < points.length - 1; i += 1) {
      const width = 16 + Math.sin(Math.PI * points[i].t) * 5;
      ctx.beginPath();
      ctx.moveTo(points[i].x + normalX * width, points[i].y + normalY * width);
      ctx.lineTo(points[i].x - normalX * width, points[i].y - normalY * width);
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(barge.x, barge.y);
    ctx.rotate(barge.heading);
    ctx.strokeStyle = "rgba(220, 191, 139, 0.12)";
    for (let y = -14; y <= 14; y += 7) {
      ctx.beginPath();
      ctx.moveTo(-64, y);
      ctx.lineTo(64, y);
      ctx.stroke();
    }
    ctx.restore();

    drawCargo();

    const drawRudder = (localX, angle, color, label) => {
      const px = barge.x + Math.cos(barge.heading) * localX;
      const py = barge.y + Math.sin(barge.heading) * localX;
      const finAngle = barge.heading + angle * 0.52;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(finAngle);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(0, -2);
      ctx.lineTo(18, -4);
      ctx.lineTo(20, 0);
      ctx.lineTo(18, 4);
      ctx.lineTo(0, 2);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(barge.heading);
      ctx.fillStyle = "rgba(4, 19, 20, 0.9)";
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.font = '7px "Noto Serif SC", serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, 0, 0.5);
      ctx.restore();
    };

    drawRudder(HULL_LENGTH * 0.49, barge.front, "#5ed3b4", "前");
    drawRudder(-HULL_LENGTH * 0.49, -barge.rear, "#f0bd68", "后");

    const lanternX = barge.x + Math.cos(barge.heading) * 37;
    const lanternY = barge.y + Math.sin(barge.heading) * 37;
    const pulse = 0.74 + Math.sin(time * 3.1) * 0.14;
    ctx.save();
    ctx.translate(lanternX, lanternY);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 24);
    glow.addColorStop(0, `rgba(244, 195, 105, ${pulse * 0.34})`);
    glow.addColorStop(1, "rgba(244, 195, 105, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(-24, -24, 48, 48);
    ctx.fillStyle = `rgba(247, 204, 122, ${pulse})`;
    ctx.beginPath();
    ctx.arc(0, 0, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (difference > 1.15) {
      const bow = points[6];
      ctx.strokeStyle = `rgba(241, 124, 103, ${0.08 + difference * 0.04})`;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(bow.x, bow.y, 20 + Math.sin(time * 7) * 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function render(now) {
    const time = now / 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#020d0f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(viewScale, 0, 0, viewScale, viewX, viewY);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();

    const shake = barge.scrape > 0.04 ? barge.scrape * 2.6 : 0;
    const shakeX = Math.sin(time * 61) * shake;
    const shakeY = Math.cos(time * 47) * shake;
    ctx.translate(shakeX, shakeY);

    drawLand(time);
    drawWater(time);
    drawRouteMarkers(time);
    drawWake();
    drawBarge(time);
    drawSparks();

    if (barge.scrape > 0.04) {
      ctx.fillStyle = `rgba(174, 64, 44, ${barge.scrape * 0.075})`;
      ctx.fillRect(0, 0, W, H);
    }

    const topShade = ctx.createLinearGradient(0, 0, 0, 145);
    topShade.addColorStop(0, "rgba(1, 8, 10, 0.52)");
    topShade.addColorStop(1, "rgba(1, 8, 10, 0)");
    ctx.fillStyle = topShade;
    ctx.fillRect(0, 0, W, 145);
    ctx.restore();
  }

  function updateHud() {
    const p = progress();
    const diff = Math.abs(barge.front - barge.rear);
    const cargo = clamp(Math.abs(barge.cargoLat) / 1.18, 0, 1);
    ui.speed.textContent = (barge.speed / 17.2).toFixed(1);
    ui.cargo.textContent = String(Math.round(barge.cargoDamage));
    ui.hull.textContent = String(Math.max(0, Math.round(barge.hull)));
    ui.frontAngle.textContent = `${Math.round(barge.front * 32)}°`;
    ui.rearAngle.textContent = `${Math.round(barge.rear * 32)}°`;
    ui.bendValue.textContent = `${Math.round(diff * 32)}°`;
    ui.bendNeedle.style.left = `${50 + (barge.front - barge.rear) * 21}%`;
    ui.bendNeedle.style.background = diff > 1.25 ? "#f17c67" : diff > 0.7 ? "#f0bd68" : "#5ed3b4";
    ui.cargoTilt.style.width = `${Math.round(cargo * 100)}%`;
    ui.cargoTilt.style.background = cargo > 0.72 ? "#f17c67" : "#f0bd68";
    ui.cargoTiltValue.textContent = `${Math.round(cargo * 100)}%`;
    ui.hullFill.style.width = `${Math.max(0, barge.hull)}%`;
    ui.hullFill.style.background = barge.hull < 35 ? "#f17c67" : "#5ed3b4";
    ui.hullFillValue.textContent = `${Math.max(0, Math.round(barge.hull))}%`;
    ui.progress.style.width = `${Math.round(p * 1000) / 10}%`;
    ui.distance.textContent = `${Math.round(p * 4200).toLocaleString("zh-CN")} / 4,200 m`;

    const stageIndex = barge.x < 1480 ? 0 : barge.x < 2800 ? 1 : 2;
    ui.stages.forEach((stage, index) => {
      stage.classList.toggle("active", mode === "running" && index === stageIndex);
      stage.classList.toggle("done", index < stageIndex || (mode === "won" && index <= 2));
    });

    ui.frontPanel.classList.toggle("engaged", Math.abs(controls.front) > 0);
    ui.rearPanel.classList.toggle("engaged", Math.abs(controls.rear) > 0);
    ui.cargo.parentElement.classList.toggle("critical", barge.cargoDamage >= CARGO_LIMIT);
    ui.hull.parentElement.classList.toggle("critical", barge.hull < 30);
    sound.update(diff, barge.speed);
  }

  const sound = {
    context: null,
    master: null,
    tension: null,
    tensionGain: null,
    filter: null,
    ready: false,
    muted: false,
    currentFrequency: 145,
    currentGain: 0,

    init() {
      if (this.ready) {
        if (this.context && this.context.state === "suspended") this.context.resume();
        return;
      }
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.context.destination);

      this.filter = this.context.createBiquadFilter();
      this.filter.type = "lowpass";
      this.filter.frequency.value = 880;
      this.filter.Q.value = 0.7;
      this.filter.connect(this.master);

      this.tensionGain = this.context.createGain();
      this.tensionGain.gain.value = 0;
      this.tensionGain.connect(this.filter);
      this.tension = this.context.createOscillator();
      this.tension.type = "triangle";
      this.tension.frequency.value = 165;
      this.tension.connect(this.tensionGain);
      this.tension.start();

      const harmonic = this.context.createOscillator();
      harmonic.type = "sine";
      harmonic.frequency.value = 310;
      const harmonicGain = this.context.createGain();
      harmonicGain.gain.value = 0.18;
      harmonic.connect(harmonicGain);
      harmonicGain.connect(this.tensionGain);
      harmonic.start();
      this.harmonic = harmonic;
      this.ready = true;
    },

    setActive(active) {
      if (!this.ready) return;
      if (active && this.context.state === "suspended") this.context.resume();
      const target = active && !this.muted ? 0.032 : 0;
      this.master.gain.setTargetAtTime(active ? 0.35 : 0, this.context.currentTime, 0.12);
      this.tensionGain.gain.setTargetAtTime(target, this.context.currentTime, 0.18);
    },

    update(difference, speed) {
      if (!this.ready) return;
      const now = this.context.currentTime;
      const activeGain = mode === "running" && !this.muted ? 0.012 + difference * 0.014 : 0;
      const base = 145 + difference * 168 + Math.max(0, speed - 150) * 0.26;
      this.currentFrequency = base;
      this.currentGain = activeGain;
      this.tension.frequency.setTargetAtTime(base, now, 0.055);
      this.harmonic.frequency.setTargetAtTime(base * 1.86, now, 0.055);
      this.filter.frequency.setTargetAtTime(650 + difference * 330, now, 0.08);
      this.tensionGain.gain.setTargetAtTime(activeGain, now, 0.1);
    },

    toggleMute() {
      this.muted = !this.muted;
      if (this.ready) this.setActive(mode === "running");
      return this.muted;
    },

    impact() {
      if (!this.ready) return;
      const ctxAudio = this.context;
      const duration = 0.4;
      const buffer = ctxAudio.createBuffer(1, Math.floor(ctxAudio.sampleRate * duration), ctxAudio.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2.4);
      }
      const noise = ctxAudio.createBufferSource();
      const gain = ctxAudio.createGain();
      gain.gain.value = 0.7;
      noise.buffer = buffer;
      noise.connect(gain);
      gain.connect(ctxAudio.destination);
      noise.start();
    },

    end(won) {
      if (!this.ready) return;
      this.setActive(false);
      const ctxAudio = this.context;
      const notes = won ? [294, 392, 523] : [220, 174, 116];
      notes.forEach((frequency, index) => {
        const osc = ctxAudio.createOscillator();
        const gain = ctxAudio.createGain();
        const start = ctxAudio.currentTime + 0.16 + index * 0.18;
        osc.type = won ? "sine" : "triangle";
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(won ? 0.14 : 0.09, start + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.45);
        osc.connect(gain);
        gain.connect(ctxAudio.destination);
        osc.start(start);
        osc.stop(start + 0.5);
      });
    },
  };

  function handleKeyDown(event) {
    const key = event.key.toLowerCase();
    if (key === "m") {
      const muted = sound.toggleMute();
      showToast(muted ? "声音已静音" : "声音已开启", false, 900);
      return;
    }
    if (mode === "ready" && (key === "enter" || key === " ")) {
      event.preventDefault();
      beginGame();
      return;
    }
    if (!["a", "d", "w", "s", "arrowleft", "arrowright", "j", "l"].includes(key)) return;
    event.preventDefault();
    heldKeys.add(key);
    updateControlsFromKeys();
  }

  function handleKeyUp(event) {
    const key = event.key.toLowerCase();
    heldKeys.delete(key);
    updateControlsFromKeys();
  }

  document.getElementById("startButton").addEventListener("click", beginGame);
  document.getElementById("restartButton").addEventListener("click", () => resetGame(true));
  window.addEventListener("keydown", handleKeyDown, { passive: false });
  window.addEventListener("keyup", handleKeyUp);
  window.addEventListener("blur", () => {
    heldKeys.clear();
    updateControlsFromKeys();
  });
  window.addEventListener("resize", resizeCanvas);

  function animate(now) {
    const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    if (mode === "running") updateGame(dt);
    updateHud();
    render(now);
    requestAnimationFrame(animate);
  }

  window.__bargeGame = {
    start: beginGame,
    reset: () => resetGame(false),
    getSnapshot() {
      return {
        mode,
        outcome,
        x: barge.x,
        y: barge.y,
        heading: barge.heading,
        speed: barge.speed,
        front: barge.front,
        rear: barge.rear,
        bend: barge.bend,
        bendDegrees: Math.abs(barge.front - barge.rear) * 32,
        cargoDamage: barge.cargoDamage,
        cargoLat: barge.cargoLat,
        hull: barge.hull,
        riverCenter: riverAt(barge.x),
        riverTangent: tangentAt(barge.x),
        riverHalfWidth: halfWidthAt(barge.x),
        progress: progress(),
        gameTime,
        controls: { ...controls },
        audioReady: sound.ready,
        audioContextState: sound.context ? sound.context.state : "uninitialized",
        audioFrequency: sound.currentFrequency,
        audioTensionGain: sound.currentGain,
        collisionLimit: 65,
      };
    },
  };

  resizeCanvas();
  updateHud();
  render(performance.now());
  requestAnimationFrame(animate);
})();
