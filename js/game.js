(function () {
  "use strict";

  const LAYOUT = window.SceneRenderer.LAYOUT;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const mix = (a, b, t) => a + (b - a) * t;
  const ease = (t) => {
    const p = clamp(t, 0, 1);
    return p * p * (3 - 2 * p);
  };

  const PASSENGERS = [
    {
      name: "林岚",
      weight: 58,
      seatX: -45,
      color: "#efc883",
      jacket: "#3d6567",
      meta: "58 kg · 西侧车厢 / 左门"
    },
    {
      name: "周野",
      weight: 82,
      seatX: 44,
      color: "#e2a271",
      jacket: "#704b3c",
      meta: "82 kg · 西侧车厢 / 右门"
    },
    {
      name: "苏禾",
      weight: 65,
      seatX: -34,
      color: "#d8cc91",
      jacket: "#365d62",
      meta: "65 kg · 东侧车厢 / 左门"
    },
    {
      name: "陈渡",
      weight: 74,
      seatX: 38,
      color: "#baa083",
      jacket: "#56493c",
      meta: "74 kg · 东侧车厢 / 右门"
    }
  ];

  const DOCKING = {
    calm: { x: 52, y: 42, angle: 0.158 },
    gust: { x: 30, y: 26, angle: 0.086 }
  };

  const el = {
    canvas: document.getElementById("scene"),
    startScreen: document.getElementById("start-screen"),
    startButton: document.getElementById("start-button"),
    pauseScreen: document.getElementById("pause-screen"),
    resumeButton: document.getElementById("resume-button"),
    resultScreen: document.getElementById("result-screen"),
    resultKicker: document.getElementById("result-kicker"),
    resultTitle: document.getElementById("result-title"),
    resultCopy: document.getElementById("result-copy"),
    resultTime: document.getElementById("result-time"),
    resultScore: document.getElementById("result-score"),
    resultGusts: document.getElementById("result-gusts"),
    resultRule: document.getElementById("result-rule"),
    retryButton: document.getElementById("retry-button"),
    muteButton: document.getElementById("mute-button"),
    pauseButton: document.getElementById("pause-button"),
    rescueCount: document.getElementById("rescue-count"),
    progressPips: document.getElementById("progress-pips"),
    missionLabel: document.getElementById("mission-label"),
    windSpeed: document.getElementById("wind-speed"),
    windArrow: document.getElementById("wind-arrow"),
    windFill: document.getElementById("wind-fill"),
    windState: document.getElementById("wind-state"),
    windForecast: document.getElementById("wind-forecast"),
    gustBadge: document.getElementById("gust-badge"),
    dockState: document.getElementById("dock-state"),
    meterX: document.getElementById("meter-x"),
    meterY: document.getElementById("meter-y"),
    meterTilt: document.getElementById("meter-tilt"),
    errorX: document.getElementById("error-x"),
    errorY: document.getElementById("error-y"),
    errorTilt: document.getElementById("error-tilt"),
    toleranceReadout: document.getElementById("tolerance-readout"),
    cogReadout: document.getElementById("cog-readout"),
    passengerNumber: document.getElementById("passenger-number"),
    passengerName: document.getElementById("passenger-name"),
    passengerMeta: document.getElementById("passenger-meta"),
    alignmentLamp: document.getElementById("alignment-lamp"),
    actionHint: document.getElementById("action-hint"),
    toast: document.getElementById("toast")
  };

  const audio = new window.RescueAudio();
  const renderer = new window.SceneRenderer(el.canvas);
  const keys = new Set();
  let state = createState();
  let lastFrame = performance.now();
  let toastTimer = 0;
  let resultTimer = 0;
  let lastHudFrame = 0;
  let snapshot = null;

  function createState() {
    return {
      mode: "title",
      started: false,
      paused: false,
      missionTime: 0,
      activeIndex: 0,
      passengers: PASSENGERS.map((passenger, index) => ({
        ...passenger,
        id: index,
        status: "waiting"
      })),
      basket: {
        x: LAYOUT.basketStart.x,
        y: LAYOUT.basketStart.y,
        targetX: LAYOUT.basketStart.x,
        targetY: LAYOUT.basketStart.y,
        vx: 0,
        vy: 0,
        angle: 0,
        angVel: 0
      },
      wind: {
        speed: 5.8,
        dir: 1,
        gust: false,
        gustIndex: 0,
        warned: false,
        nextGust: 12.5,
        endGust: 0,
        gustCount: 0
      },
      dock: {
        aligned: false,
        tolX: DOCKING.calm.x,
        tolY: DOCKING.calm.y,
        tolAngle: DOCKING.calm.angle,
        gust: false
      },
      transfer: null,
      finale: null,
      ropeInput: { left: 0, right: 0 },
      totalWeight: 0,
      cog: 0,
      boundaryTime: 0,
      boundaryWarning: false,
      shake: 0,
      flash: 0,
      tiltPenalty: 0,
      transferCount: 0,
      abortReason: "",
      gustSnapshot: 0,
      lastWinch: 0
    };
  }

  function update(dt) {
    if (state.started && state.mode !== "aborted" && state.mode !== "complete") {
      state.missionTime += dt;
    }

    updateWind(dt);
    if (state.mode === "finale") updateFinale(dt);
    updateBasket(dt);
    checkDock();

    if (state.mode === "transfer") updateTransfer(dt);
    state.shake = Math.max(0, state.shake - dt * 2.2);
    state.flash = Math.max(0, state.flash - dt * 1.8);

    const winchActive =
      state.mode === "finale" ||
      (state.mode !== "aborted" &&
        (keys.has("KeyW") || keys.has("KeyS") || keys.has("KeyA") || keys.has("KeyD")));
    const intensity = state.mode === "finale"
      ? 0.72
      : clamp(Math.abs(state.basket.vx) / 220 + Math.abs(state.basket.vy) / 180, 0.2, 1);
    audio.setWinch(winchActive, intensity);
    audio.setWind(state.wind.speed, state.wind.gust);
  }

  function updateWind(dt) {
    const wind = state.wind;
    const missionT = state.missionTime;

    if (state.mode !== "aborted" && state.mode !== "complete" && state.started) {
      if (wind.gust && missionT >= wind.endGust) {
        wind.gust = false;
        wind.nextGust = missionT + 21;
        wind.warned = false;
        showToast("阵风过境 · 对接窗口恢复");
      }

      if (!wind.gust && missionT >= wind.nextGust) {
        wind.gust = true;
        wind.gustIndex += 1;
        wind.gustCount += 1;
        wind.dir *= -1;
        wind.endGust = missionT + 5.4;
        wind.warned = true;
        if (state.mode === "transfer" && state.transfer) {
          state.transfer.grace = Math.max(state.transfer.grace, 0.72);
        }
        audio.gustWarning();
        showToast("阵风突袭 · 对接容差收窄", true);
      } else if (!wind.gust && !wind.warned && missionT >= wind.nextGust - 3.4) {
        wind.warned = true;
        audio.gustWarning();
        showToast("预警：阵风将在 3 秒后抵达");
      }
    }

    let targetSpeed;
    if (wind.gust) {
      targetSpeed = 14.2 + Math.sin(missionT * 2.8) * 1.5 + (wind.gustIndex % 2) * 0.8;
    } else {
      targetSpeed = 5.4 + Math.sin(missionT * 0.34 + 0.7) * 1.3;
    }
    const response = wind.gust ? 1.3 : 0.38;
    wind.speed += (targetSpeed - wind.speed) * Math.min(1, dt * response);

    if (state.mode === "playing" || state.mode === "transfer") {
      const docking = wind.gust ? DOCKING.gust : DOCKING.calm;
      state.dock.tolX = docking.x;
      state.dock.tolY = docking.y;
      state.dock.tolAngle = docking.angle;
      state.dock.gust = wind.gust;
    }
  }

  function updateBasket(dt) {
    const basket = state.basket;
    const canControl = state.mode === "playing" || state.mode === "transfer";

    if (canControl) {
      const xInput = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
      const yInput = (keys.has("KeyS") ? 1 : 0) - (keys.has("KeyW") ? 1 : 0);
      const fine = state.mode === "transfer" ? 0.62 : 1;
      basket.targetX += xInput * 162 * fine * dt;
      basket.targetY += yInput * 126 * fine * dt;
      basket.targetX = clamp(basket.targetX, 272, 1332);
      basket.targetY = clamp(basket.targetY, 242, 594);
    }

    const leftTarget = canControl && keys.has("KeyQ") ? 1 : 0;
    const rightTarget = canControl && keys.has("KeyE") ? 1 : 0;
    const ropeRate = dt * (leftTarget || rightTarget ? 5.8 : 3.4);
    state.ropeInput.left += clamp(leftTarget - state.ropeInput.left, -ropeRate, ropeRate);
    state.ropeInput.right += clamp(rightTarget - state.ropeInput.right, -ropeRate, ropeRate);

    const wind = state.wind;
    const windX = wind.dir * wind.speed * (wind.gust ? 2.1 : 1.3);
    const ropeX = (state.ropeInput.right - state.ropeInput.left) * 3.6;
    const steering = canControl && (keys.has("KeyA") || keys.has("KeyD") || keys.has("KeyW") || keys.has("KeyS"));
    const ax = (basket.targetX - basket.x) * 8.8 - basket.vx * (steering ? 4.1 : 6.1) + windX + ropeX;
    const ay = (basket.targetY - basket.y) * 9.8 - basket.vy * (steering ? 4.7 : 6.4);
    basket.vx += ax * dt;
    basket.vy += ay * dt;
    basket.x += basket.vx * dt;
    basket.y += basket.vy * dt;

    const weightTerm = state.totalWeight > 0 ? state.cog / 292 : 0;
    const windTerm = wind.dir * wind.speed * (wind.gust ? 1.62 : 1) / 126;
    const ropeTerm = (state.ropeInput.right - state.ropeInput.left) * 0.265;
    const gustWobble = wind.gust ? Math.sin(state.missionTime * 2.55) * 0.024 : 0;
    let targetAngle = weightTerm + windTerm + ropeTerm + gustWobble;

    if (state.mode === "finale" && state.finale) {
      const autoLevel = clamp((state.finale.timer - 0.5) / 2.2, 0, 1);
      targetAngle *= 1 - autoLevel * 0.82;
      state.ropeInput.left += clamp(0 - state.ropeInput.left, -dt * 2, dt * 2);
      state.ropeInput.right += clamp(0 - state.ropeInput.right, -dt * 2, dt * 2);
    }

    targetAngle = clamp(targetAngle, -0.56, 0.56);
    const damping = state.mode === "finale" ? 2.85 : 2.15;
    const acceleration = (targetAngle - basket.angle) * 3.25 - basket.angVel * damping - basket.vx * 0.00045;
    basket.angVel += acceleration * dt;
    basket.angle += basket.angVel * dt;
    if (Math.abs(basket.angle) > 0.72) {
      basket.angle = clamp(basket.angle, -0.72, 0.72);
      basket.angVel *= -0.22;
    }
  }

  function checkDock() {
    const point = LAYOUT.transferPoints[state.activeIndex];
    if (!point || state.activeIndex >= 4 || state.mode === "complete" || state.mode === "aborted") {
      state.dock.aligned = false;
      return;
    }
    const basket = state.basket;
    const dock = state.dock;
    dock.dx = basket.x - point.x;
    dock.dy = basket.y - point.y;
    dock.tilt = basket.angle;
    dock.aligned =
      Math.abs(dock.dx) <= dock.tolX &&
      Math.abs(dock.dy) <= dock.tolY &&
      Math.abs(dock.tilt) <= dock.tolAngle;
  }

  function startTransfer() {
    if (!state.started || state.paused || state.mode !== "playing") return;
    const index = state.activeIndex;
    if (index >= 4) return;
    const passenger = state.passengers[index];
    if (!passenger || passenger.status !== "waiting") return;

    if (!state.dock.aligned) {
      const dock = state.dock;
      if (Math.abs(dock.dx) > dock.tolX) {
        showToast("横向偏离 · 用 A / D 对准舱门");
      } else if (Math.abs(dock.dy) > dock.tolY) {
        showToast("高度偏离 · 用 W / S 调整卷扬");
      } else {
        showToast("吊篮倾斜越限 · 用 Q / E 防风绳配平", true);
      }
      audio.gate();
      return;
    }

    passenger.status = "boarding";
    state.transfer = {
      passengerIndex: index,
      progress: 0,
      duration: 1.72,
      grace: 0.34
    };
    state.mode = "transfer";
    state.boundaryTime = 0;
    state.boundaryWarning = false;
    state.tiltPenalty += Math.abs(state.basket.angle);
    audio.gate();
    showToast(passenger.name + " 正在跨越吊篮 · 保持锁定");
  }

  function updateTransfer(dt) {
    const transfer = state.transfer;
    if (!transfer) return;
    transfer.progress = clamp(transfer.progress + dt / transfer.duration, 0, 1);

    const dock = state.dock;
    const outsideBoundary =
      Math.abs(dock.dx) > dock.tolX ||
      Math.abs(dock.dy) > dock.tolY;
    const outsideTilt = Math.abs(dock.tilt) > dock.tolAngle + 0.008;
    const outside = outsideBoundary || outsideTilt;

    if (transfer.grace > 0) {
      transfer.grace -= dt;
    } else if (outside) {
      state.boundaryTime += dt;
      state.boundaryWarning = true;
      if (state.boundaryTime > 0.48) {
        abortMission(outsideTilt ? "吊篮倾角越出锁定边界" : "吊篮越出对接锁定边界");
        return;
      }
    } else {
      state.boundaryTime = Math.max(0, state.boundaryTime - dt * 2.6);
      state.boundaryWarning = false;
    }

    if (transfer.progress >= 1 && !outside) {
      finishTransfer();
    }
  }

  function finishTransfer() {
    const index = state.transfer.passengerIndex;
    const passenger = state.passengers[index];
    if (!passenger) return;
    passenger.status = "aboard";
    state.transferCount += 1;
    state.activeIndex += 1;
    state.transfer = null;
    state.mode = "playing";
    state.boundaryTime = 0;
    state.boundaryWarning = false;
    refreshLoad();
    state.basket.angVel += (passenger.seatX > 0 ? 1 : -1) * 0.11;
    audio.board();

    if (state.activeIndex >= 4) {
      beginFinale();
      return;
    }

    const next = LAYOUT.transferPoints[state.activeIndex];
    showToast(passenger.name + " 已登篮 · 前往 T-" + next.number);
  }

  function refreshLoad() {
    let weight = 0;
    let moment = 0;
    state.passengers.forEach((passenger) => {
      if (passenger.status === "aboard") {
        weight += passenger.weight;
        moment += passenger.weight * passenger.seatX;
      }
    });
    state.totalWeight = weight;
    state.cog = weight > 0 ? moment / weight : 0;
  }

  function beginFinale() {
    state.mode = "finale";
    state.activeIndex = 4;
    state.transfer = null;
    state.dock.aligned = false;
    state.finale = {
      timer: 0,
      startX: state.basket.x,
      startY: state.basket.y,
      done: false
    };
    audio.gate();
    showToast("四人已登篮 · 自动回收至东塔平台");
  }

  function updateFinale(dt) {
    const finale = state.finale;
    if (!finale) return;
    finale.timer += dt;
    const basket = state.basket;
    const t = finale.timer;

    if (t < 2.05) {
      const p = ease(t / 2.05);
      basket.targetY = mix(finale.startY, 238, p);
      basket.targetX = finale.startX;
    } else if (t < 5.05) {
      const p = ease((t - 2.05) / 3);
      basket.targetX = mix(finale.startX, 1358, p);
      basket.targetY = 238;
    } else if (t < 6.35) {
      const p = ease((t - 5.05) / 1.3);
      basket.targetX = 1358;
      basket.targetY = mix(238, 302, p);
    } else {
      basket.targetX = 1358;
      basket.targetY = 302;
      if (t >= 7.25 && !finale.done) {
        finale.done = true;
        completeMission();
      }
    }
  }

  function completeMission() {
    if (state.mode === "complete") return;
    state.mode = "complete";
    state.dock.aligned = false;
    state.flash = 0.35;
    audio.setWinch(false);
    audio.complete();
    showToast("吊篮抵达东塔 · 全员撤离完成");
    clearTimeout(resultTimer);
    resultTimer = setTimeout(() => showResult(true), 850);
  }

  function abortMission(reason) {
    if (state.mode === "aborted" || state.mode === "complete") return;
    const boardingIndex = state.transfer ? state.transfer.passengerIndex : state.activeIndex;
    if (state.passengers[boardingIndex]) state.passengers[boardingIndex].status = "waiting";
    state.transfer = null;
    state.mode = "aborted";
    state.abortReason = reason;
    state.boundaryWarning = false;
    state.shake = 1;
    state.flash = 1;
    state.basket.angVel += 0.48;
    state.basket.vx += state.wind.dir * 42;
    state.basket.vy += 26;
    audio.setWinch(false);
    audio.collision();
    keys.clear();
    updateKeyVisuals();
    showToast("锁定边界破裂 · 救援中止", true);
    clearTimeout(resultTimer);
    resultTimer = setTimeout(() => showResult(false), 780);
  }

  function showResult(success) {
    if (success) {
      const seconds = Math.round(state.missionTime);
      const avgTilt = state.transferCount > 0 ? state.tiltPenalty / state.transferCount : 0;
      const score = Math.round(clamp(100 - avgTilt * 57.3 * 1.5 - state.wind.gustCount * 1.7, 58, 100));
      const grade = score >= 92 ? "A" : score >= 80 ? "B" : "C";
      el.resultKicker.textContent = "04 / 04 · 全员撤离";
      el.resultTitle.innerHTML = "山谷重新<br><em>安静下来。</em>";
      el.resultCopy.textContent = "四名乘客已转移至东塔平台。卷扬停止，救援索正在卸载。";
      el.resultTime.textContent = formatTime(seconds);
      el.resultScore.textContent = grade + " · " + score;
      el.resultGusts.textContent = String(state.wind.gustCount);
      el.resultRule.textContent = "";
      el.resultRule.hidden = true;
    } else {
      el.resultKicker.textContent = "行动中止 / LOCK FAILURE";
      el.resultTitle.innerHTML = "救援中止，<br><em>风仍在等。</em>";
      el.resultCopy.textContent = "吊篮离开了交接安全区。卷扬与防风绳已锁定，等待重新部署。";
      el.resultTime.textContent = formatTime(Math.round(state.missionTime));
      el.resultScore.textContent = "--";
      el.resultGusts.textContent = String(state.wind.gustCount);
      const pointNumber = String(state.activeIndex + 1).padStart(2, "0");
      const dx = state.dock.dx ? (state.dock.dx * 0.1).toFixed(1) : "0.0";
      const tilt = state.dock.tilt ? (state.dock.tilt * 57.3).toFixed(1) : "0.0";
      el.resultRule.textContent =
        state.abortReason +
        "（T-" + pointNumber + " · 横向偏差 " + dx + " m · 倾角 " + tilt + "°）。";
      el.resultRule.hidden = false;
    }
    el.resultScreen.hidden = false;
    el.pauseScreen.hidden = true;
    state.paused = true;
  }

  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.max(0, seconds % 60);
    return String(mins).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
  }

  function startGame() {
    el.startScreen.hidden = true;
    el.resultScreen.hidden = true;
    el.pauseScreen.hidden = true;
    state.started = true;
    state.mode = "playing";
    state.paused = false;
    state.missionTime = 0;
    audio.start();
    audio.gate();
    keys.clear();
    updateKeyVisuals();
    lastFrame = performance.now();
    showToast("救援吊篮已释放 · 先到 01 号转移点");
  }

  function restartGame() {
    clearTimeout(resultTimer);
    state = createState();
    state.started = true;
    state.mode = "playing";
    state.paused = false;
    el.resultScreen.hidden = true;
    el.pauseScreen.hidden = true;
    el.startScreen.hidden = true;
    keys.clear();
    updateKeyVisuals();
    audio.start();
    audio.gate();
    lastFrame = performance.now();
    showToast("吊篮重新释放 · 前往 01 号转移点");
  }

  function togglePause(force) {
    if (!state.started || state.mode === "aborted" || state.mode === "complete" || state.mode === "title") return;
    const next = typeof force === "boolean" ? force : !state.paused;
    if (next === state.paused) return;
    state.paused = next;
    el.pauseScreen.hidden = !next;
    if (next) {
      keys.clear();
      updateKeyVisuals();
      audio.setWinch(false);
    }
    lastFrame = performance.now();
  }

  function buildProgressPips() {
    el.progressPips.innerHTML = "";
    for (let i = 0; i < 4; i++) {
      const pip = document.createElement("i");
      pip.setAttribute("aria-hidden", "true");
      el.progressPips.appendChild(pip);
    }
  }

  function updateHud(now) {
    const dock = state.dock;
    const wind = state.wind;
    const done = state.passengers.filter((passenger) => passenger.status === "aboard").length;
    el.rescueCount.innerHTML = String(done).padStart(2, "0") + "<span>/04</span>";
    Array.from(el.progressPips.children).forEach((pip, index) => {
      pip.classList.toggle("done", index < done);
      pip.classList.toggle("active", index === state.activeIndex && state.mode !== "complete");
    });

    let mission = "等待救援指令";
    if (state.mode === "playing") {
      const point = LAYOUT.transferPoints[state.activeIndex];
      mission = point ? "吊篮就绪 · 对准 T-" + point.number : "吊篮就绪";
    } else if (state.mode === "transfer" && state.transfer) {
      const passenger = state.passengers[state.transfer.passengerIndex];
      mission = passenger.name + " 转移中 · " + Math.round(state.transfer.progress * 100) + "%";
    } else if (state.mode === "finale") {
      mission = "全员登篮 · 回收至东塔平台";
    } else if (state.mode === "complete") {
      mission = "撤离完成 · 吊篮已泊靠";
    } else if (state.mode === "aborted") {
      mission = "锁定边界破裂 · 救援中止";
    } else if (state.mode === "title") {
      mission = "吊篮待命 · 等待释放指令";
    }
    el.missionLabel.textContent = mission;

    el.windSpeed.textContent = wind.speed.toFixed(1);
    el.windArrow.style.transform = wind.dir < 0 ? "scaleX(-1)" : "scaleX(1)";
    el.windFill.style.width = clamp(wind.speed / 20, 0.02, 1) * 100 + "%";
    el.windFill.style.background = wind.gust ? "var(--red)" : "var(--teal)";
    el.windState.textContent = wind.gust ? "阵风过境" : wind.speed > 9 ? "强侧风" : "侧风稳定";
    if (wind.gust) {
      el.windForecast.textContent = "剩余 " + Math.max(0, Math.ceil(wind.endGust - state.missionTime)) + "s";
    } else if (state.mode === "complete" || state.mode === "aborted") {
      el.windForecast.textContent = "阵风 --";
    } else if (state.mode === "title") {
      el.windForecast.textContent = "阵风 --";
    } else {
      el.windForecast.textContent = "阵风 " + Math.max(0, Math.ceil(wind.nextGust - state.missionTime)) + "s";
    }
    el.gustBadge.hidden = !wind.gust;

    const tolText = "±" + (dock.tolX * 0.1).toFixed(1) + "m / " + (dock.tolAngle * 57.3).toFixed(0) + "°";
    el.toleranceReadout.textContent = tolText;

    setMeter(el.meterX, dock.dx || 0, dock.tolX);
    setMeter(el.meterY, dock.dy || 0, dock.tolY);
    setMeter(el.meterTilt, dock.tilt || 0, dock.tolAngle);
    el.errorX.textContent = formatSigned(dock.dx, 0.1, 1) + "m";
    el.errorY.textContent = formatSigned(dock.dy, 0.1, 1) + "m";
    el.errorTilt.textContent = formatSigned(dock.tilt, 57.3, 1) + "°";

    if (state.totalWeight <= 0) {
      el.cogReadout.textContent = "平衡";
    } else {
      const side = state.cog < -1.5 ? "左 " : state.cog > 1.5 ? "右 " : "";
      el.cogReadout.textContent = side + (Math.abs(state.cog) * 0.1).toFixed(1) + "m";
    }

    const transferActive = state.mode === "transfer";
    const ready = dock.aligned && state.mode === "playing";
    const finished = state.mode === "complete" || state.mode === "finale";
    el.alignmentLamp.classList.toggle("ready", ready || finished);
    el.alignmentLamp.classList.toggle("docked", transferActive);
    el.alignmentLamp.querySelector("b").textContent =
      state.mode === "complete" ? "撤离完成"
        : state.mode === "finale" ? "回收中"
          : transferActive ? "锁定中" : ready ? "可交接" : "待对准";

    const hintSpan = el.actionHint.querySelector("span");
    const hintKbd = el.actionHint.querySelector("kbd");
    if (transferActive && state.transfer) {
      el.actionHint.classList.add("visible");
      hintKbd.textContent = "LOCK";
      hintSpan.textContent =
        state.boundaryWarning
          ? "即将越界 · 立即修正姿态"
          : "保持容差 · " + Math.round(state.transfer.progress * 100) + "%";
    } else if (ready) {
      el.actionHint.classList.add("visible");
      hintKbd.textContent = "SPACE";
      hintSpan.textContent = "开始交接 · 1.7 秒";
    } else {
      el.actionHint.classList.remove("visible");
    }

    el.dockState.textContent =
      state.mode === "aborted" ? "已中止"
        : state.mode === "complete" ? "撤离完成"
          : state.mode === "finale" ? "自动回收"
            : transferActive ? "锁定中" : ready ? "可对接" : "巡航";
    el.dockState.style.color =
      state.mode === "aborted" ? "var(--red)"
        : state.boundaryWarning ? "var(--red)"
          : ready || transferActive ? "var(--teal)" : "var(--muted)";

    updatePassengerPanel();
  }

  function setMeter(bar, value, tolerance) {
    const ratio = clamp(value / tolerance, -1, 1);
    bar.style.left = 50 + ratio * 45 + "%";
    const row = bar.closest(".meter-row");
    row.classList.toggle("near", Math.abs(value) <= tolerance);
    row.classList.toggle("danger", Math.abs(value) > tolerance);
  }

  function formatSigned(value, scale, digits) {
    const result = (value || 0) * scale;
    return (result >= 0 ? "+" : "") + result.toFixed(digits);
  }

  function updatePassengerPanel() {
    if (state.activeIndex < 4) {
      const passenger = state.passengers[state.activeIndex];
      el.passengerNumber.textContent = String(state.activeIndex + 1).padStart(2, "0");
      el.passengerName.textContent = passenger.name;
      el.passengerMeta.textContent = passenger.meta;
    } else {
      el.passengerNumber.textContent = "04";
      el.passengerName.textContent = "全员已登篮";
      el.passengerMeta.textContent = "卷扬回收 · 东塔平台";
    }
  }

  function showToast(message, danger = false) {
    el.toast.textContent = message;
    el.toast.classList.toggle("danger", danger);
    el.toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.classList.remove("visible");
    }, danger ? 3200 : 2100);
  }

  function updateKeyVisuals() {
    document.querySelectorAll("kbd[data-key]").forEach((key) => {
      const code = key.dataset.key;
      key.classList.toggle("pressed", keys.has(code));
    });
  }

  function normalizeCode(code) {
    const map = {
      ArrowLeft: "KeyA",
      ArrowRight: "KeyD",
      ArrowUp: "KeyW",
      ArrowDown: "KeyS",
      KeyL: "KeyE",
      KeyJ: "KeyQ"
    };
    return map[code] || code;
  }

  function onKeyDown(event) {
    const code = normalizeCode(event.code);
    const handled = ["KeyA", "KeyD", "KeyW", "KeyS", "KeyQ", "KeyE", "Space", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
    if (handled.includes(event.code) || handled.includes(code)) event.preventDefault();

    if (event.repeat) return;

    if (code === "Space") {
      startTransfer();
      return;
    }
    if (event.code === "KeyR") {
      restartGame();
      return;
    }
    if (event.code === "KeyM") {
      toggleMute();
      return;
    }
    if (event.code === "KeyP" || event.code === "Escape") {
      togglePause();
      return;
    }
    if (["KeyA", "KeyD", "KeyW", "KeyS", "KeyQ", "KeyE"].includes(code)) {
      keys.add(code);
      updateKeyVisuals();
    }
  }

  function onKeyUp(event) {
    const code = normalizeCode(event.code);
    if (["KeyA", "KeyD", "KeyW", "KeyS", "KeyQ", "KeyE"].includes(code)) {
      keys.delete(code);
      updateKeyVisuals();
    }
  }

  function toggleMute() {
    const muted = audio.toggleMute();
    el.muteButton.classList.toggle("muted", muted);
    el.muteButton.textContent = muted ? "静" : "声";
    el.muteButton.setAttribute("aria-label", muted ? "开启声音" : "关闭声音");
  }

  function bindTouchControls() {
    document.querySelectorAll("[data-control]").forEach((button) => {
      const code = button.dataset.control;
      const release = (event) => {
        if (event) event.preventDefault();
        if (code !== "Space") keys.delete(code);
        button.classList.remove("pressed");
        updateKeyVisuals();
      };
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        button.classList.add("pressed");
        if (code === "Space") {
          startTransfer();
          setTimeout(() => button.classList.remove("pressed"), 160);
          return;
        }
        keys.add(code);
        updateKeyVisuals();
        if (button.setPointerCapture) {
          try { button.setPointerCapture(event.pointerId); } catch (error) { /* ignored */ }
        }
      });
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("pointerleave", (event) => {
        if (event.buttons === 0) release(event);
      });
    });
  }

  function bindEvents() {
    el.startButton.addEventListener("click", startGame);
    el.retryButton.addEventListener("click", restartGame);
    el.resumeButton.addEventListener("click", () => togglePause(false));
    el.pauseButton.addEventListener("click", () => togglePause());
    el.muteButton.addEventListener("click", toggleMute);
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("resize", () => renderer.resize());
    window.addEventListener("blur", () => {
      keys.clear();
      updateKeyVisuals();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && state.started && !state.paused && state.mode !== "complete" && state.mode !== "aborted") {
        togglePause(true);
      }
    });
    bindTouchControls();
  }

  function makeSnapshot() {
    return {
      mode: state.mode,
      started: state.started,
      paused: state.paused,
      missionTime: state.missionTime,
      activeIndex: state.activeIndex,
      passengers: state.passengers.map((passenger) => ({
        name: passenger.name,
        weight: passenger.weight,
        status: passenger.status,
        seatX: passenger.seatX
      })),
      basket: {
        x: state.basket.x,
        y: state.basket.y,
        targetX: state.basket.targetX,
        targetY: state.basket.targetY,
        angle: state.basket.angle,
        angVel: state.basket.angVel
      },
      dock: {
        aligned: state.dock.aligned,
        dx: state.dock.dx,
        dy: state.dock.dy,
        tilt: state.dock.tilt,
        tolX: state.dock.tolX,
        tolY: state.dock.tolY,
        tolAngle: state.dock.tolAngle,
        gust: state.dock.gust
      },
      wind: { ...state.wind },
      transfer: state.transfer ? { ...state.transfer } : null,
      finale: state.finale ? { ...state.finale } : null,
      totalWeight: state.totalWeight,
      cog: state.cog,
      boundaryTime: state.boundaryTime,
      abortReason: state.abortReason
    };
  }

  function frame(now) {
    const dt = clamp((now - lastFrame) / 1000, 0, 0.05);
    lastFrame = now;
    if (state.started && !state.paused && state.mode !== "title") {
      update(dt);
    }
    renderer.draw(dt, state);
    if (now - lastHudFrame > 30) {
      updateHud(now);
      lastHudFrame = now;
    }
    snapshot = makeSnapshot();
    requestAnimationFrame(frame);
  }

  buildProgressPips();
  bindEvents();
  updateHud(performance.now());
  refreshLoad();
  requestAnimationFrame(frame);

  window.__rescueGame = {
    getState: () => snapshot || makeSnapshot(),
    start: startGame,
    restart: restartGame,
    transfer: startTransfer,
    press: (code) => {
      const normalized = normalizeCode(code);
      if (normalized === "Space") startTransfer();
      else keys.add(normalized);
      updateKeyVisuals();
    },
    release: (code) => {
      keys.delete(normalizeCode(code));
      updateKeyVisuals();
    }
  };
})();
