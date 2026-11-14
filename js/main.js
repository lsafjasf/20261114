(function () {
  "use strict";

  const app = document.getElementById("app");
  const canvas = document.getElementById("scene");
  const startScreen = document.getElementById("start-screen");
  const resultScreen = document.getElementById("result-screen");
  const startButton = document.getElementById("start-button");
  const restartButton = document.getElementById("restart-button");
  const soundButton = document.getElementById("sound-button");
  const soundLabel = document.getElementById("sound-label");
  const missionState = document.getElementById("mission-state");
  const missionPill = document.querySelector(".mission-state");
  const objectiveIndex = document.querySelector(".objective-index");
  const objectiveCopy = document.getElementById("objective-copy");
  const alertBanner = document.getElementById("alert-banner");
  const lineReadout = document.getElementById("line-readout");
  const damageReadout = document.getElementById("damage-readout");
  const sampleRows = Array.from(document.querySelectorAll(".sample-row"));
  const resultKicker = document.getElementById("result-kicker");
  const resultTitle = document.getElementById("result-title");
  const resultCopy = document.getElementById("result-copy");
  const resultCard = document.querySelector(".result-card");
  const resultSamples = document.getElementById("result-samples");
  const resultDamage = document.getElementById("result-damage");
  const resultTime = document.getElementById("result-time");

  const input = new Set();
  const renderer = new window.WindRenderer(canvas);
  const audio = new window.WindAudio();
  const keysPrevented = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);

  let hasStarted = false;
  let audioReady = false;
  let audioEnabled = true;
  let lastFrame = performance.now();
  let uiFrame = 0;
  let lastWarning = "";
  let lastObjective = "";

  const uiCache = {
    mission: "",
    line: "",
    damage: "",
    rowStates: ["", "", ""],
    rowTimes: ["", "", ""]
  };

  const game = new window.WindKiteGame({
    onEvent(event) {
      if (event.type === "sample") {
        if (audioEnabled) {
          audio.chime("sample");
        }
      }

      if (event.type === "break") {
        showResult({
          success: false,
          broken: true,
          sampleCount: game.samples.filter(Boolean).length,
          damage: 100,
          elapsed: game.elapsed
        });
      }

      if (event.type === "finish") {
        showResult(event.result);
      }
    }
  });

  function formatTime(seconds) {
    const whole = Math.max(0, Math.floor(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
  }

  function setText(element, value, cacheKey) {
    if (cacheKey && uiCache[cacheKey] === value) {
      return;
    }
    element.textContent = value;
    if (cacheKey) {
      uiCache[cacheKey] = value;
    }
  }

  async function beginSurvey() {
    if (!hasStarted && audioEnabled) {
      audioReady = await audio.unlock();
      if (audioReady) {
        audio.setMuted(false);
      }
    }

    hasStarted = true;
    startButton.blur();
    restartButton.blur();
    audio.setActive(true);
    game.start();
    startScreen.classList.add("is-hidden");
    resultScreen.classList.remove("is-visible");
    resultScreen.setAttribute("aria-hidden", "true");
    app.classList.add("is-playing");
    missionPill.classList.add("is-live");
    lastWarning = "";
    lastObjective = "";
    input.clear();
  }

  function showResult(result) {
    const allSampled = result.allSampled ?? result.sampleCount === 3;
    const success = Boolean(result.success && !result.broken);
    audio.setActive(false);
    clearInput();

    resultCard.classList.toggle("is-failure", !success);
    resultKicker.textContent = success
      ? "OBSERVATION COMPLETE / 观测归档"
      : result.broken
        ? "LINE BREAK / 绳索断裂"
        : "OBSERVATION INCOMPLETE / 观测中止";
    resultTitle.textContent = success
      ? "观测完成"
      : result.broken
        ? "绳索断裂"
        : allSampled
          ? "读数归档，绳伤超限"
          : "观测中止";
    resultCopy.textContent = success
      ? "三组风层读数已归档。风筝以低损伤状态穿过切变层并安全返回地面。"
      : result.broken
        ? "持续过载使主绳失效。下次收线时请短按 S，并在张力恢复后再继续。"
        : allSampled
          ? "三组读数已经完成，但收线时张力长时间超过安全范围，绳索未能安全回收。"
          : `风筝已经落地，但仍有 ${3 - (result.sampleCount || 0)} 个采样窗未完成，记录不完整。`;

    resultSamples.textContent = `${result.sampleCount || 0} / 3`;
    resultDamage.textContent = `${Math.round(result.damage || 0)}%`;
    resultTime.textContent = formatTime(result.elapsed || 0);
    resultScreen.classList.add("is-visible");
    resultScreen.setAttribute("aria-hidden", "false");
    app.classList.remove("is-playing");
    missionPill.classList.remove("is-live");
    setText(missionState, success ? "观测归档" : "观测结束");
  }

  function updateHud(state) {
    const sampleCount = state.samples.filter(Boolean).length;
    let mission = "待命";
    if (state.phase === "playing") {
      mission = sampleCount === 3 ? "返航 · 安全收线" : `观测中 · ${sampleCount}/3`;
    } else if (state.phase === "landed") {
      mission = "落地缓冲";
    } else if (state.phase === "finished") {
      mission = "观测归档";
    }
    setText(missionState, mission, "mission");
    setText(lineReadout, `${state.lineLength.toFixed(0).padStart(2, "0")} m`, "line");
    setText(damageReadout, `${state.damage.toFixed(0)}%`, "damage");

    sampleRows.forEach((row, index) => {
      const active = state.activeSample === index;
      const complete = state.samples[index];
      const rowState = complete ? "is-complete" : active ? "is-active" : "";
      if (uiCache.rowStates[index] !== rowState) {
        row.classList.toggle("is-active", active);
        row.classList.toggle("is-complete", complete);
        uiCache.rowStates[index] = rowState;
      }

      const timeNode = row.querySelector(".sample-time");
      const timeText = complete
        ? "REC"
        : active
          ? `${Math.max(0, 3 - state.sampleProgress * 3).toFixed(1)}s`
          : "3.0s";
      if (uiCache.rowTimes[index] !== timeText) {
        timeNode.textContent = timeText;
        uiCache.rowTimes[index] = timeText;
      }
    });

    let objective = "";
    let indexLabel = "01";
    if (state.phase === "playing") {
      if (sampleCount === 3) {
        objective = "观测完成 · 短线收卷，缓降至地面";
        indexLabel = "✓";
      } else if (state.activeSample >= 0) {
        objective = `目标区 ${"ABC"[state.activeSample]} 采样中 · 保持位置`;
        indexLabel = String(state.activeSample + 1).padStart(2, "0");
      } else {
        const next = state.samples.findIndex((value) => !value);
        objective = `前往目标区 ${"ABC"[next]} · 停留 3 秒采集读数`;
        indexLabel = String(next + 1).padStart(2, "0");
      }
    } else if (state.phase === "landed") {
      objective = "已触地 · 正在完成安全收线";
      indexLabel = "✓";
    }

    if (objective && lastObjective !== objective) {
      setText(objectiveCopy, objective);
      objectiveIndex.textContent = indexLabel;
      lastObjective = objective;
    }
  }

  function updateWarning(state) {
    let warning = "";
    let calm = false;

    if (state.phase === "playing" || state.phase === "landed") {
      if (state.damage >= 70) {
        warning = `绳索损伤 ${Math.round(state.damage)}% · 停止过载收线`;
      } else if (state.tension > 78) {
        warning = "张力过高 · 绳索正在受损";
      } else if (state.tension < 26) {
        warning = "线组松弛 · 风筝横向控制减弱";
        calm = true;
      } else if (state.activeSample >= 0) {
        warning = `采样 ${Math.floor(state.sampleProgress * 100)}% · 保持稳定`;
        calm = true;
      } else if (state.samples.filter(Boolean).length === 3 && state.phase === "playing") {
        warning = "三组读数已完成 · 安全收线返回";
        calm = true;
      }
    }

    if (warning !== lastWarning) {
      alertBanner.textContent = warning;
      alertBanner.classList.toggle("is-visible", Boolean(warning));
      alertBanner.classList.toggle("is-calm", calm);
      lastWarning = warning;
    }
  }

  function loop(timestamp) {
    const delta = Math.min((timestamp - lastFrame) / 1000, 0.05);
    lastFrame = timestamp;

    if (game.phase === "playing" || game.phase === "landed") {
      game.update(delta, input);
    }

    const state = game.getSnapshot();
    renderer.draw(state, delta);

    uiFrame += 1;
    if (uiFrame % 2 === 0 && hasStarted) {
      updateHud(state);
      updateWarning(state);
      if (game.phase === "playing" || game.phase === "landed") {
        audio.update(state);
      }
    }

    requestAnimationFrame(loop);
  }

  function clearInput() {
    input.clear();
  }

  document.addEventListener("keydown", (event) => {
    if (keysPrevented.has(event.code)) {
      event.preventDefault();
    }
    if (event.repeat) {
      return;
    }
    if (game.phase === "playing") {
      input.add(event.code);
    }
  });

  document.addEventListener("keyup", (event) => {
    if (keysPrevented.has(event.code)) {
      event.preventDefault();
    }
    input.delete(event.code);
  });

  window.addEventListener("blur", clearInput);
  window.addEventListener("resize", () => renderer.resize());
  document.addEventListener("visibilitychange", () => {
    lastFrame = performance.now();
    if (document.hidden) {
      clearInput();
    }
  });

  document.querySelectorAll(".touch-controls button").forEach((button) => {
    const code = button.dataset.key;
    const press = (event) => {
      event.preventDefault();
      if (game.phase === "playing") {
        input.add(code);
      }
    };
    const release = (event) => {
      event.preventDefault();
      input.delete(code);
    };
    button.addEventListener("pointerdown", press);
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("pointerleave", release);
  });

  startButton.addEventListener("click", beginSurvey);
  restartButton.addEventListener("click", beginSurvey);

  soundButton.addEventListener("click", async () => {
    audioEnabled = !audioEnabled;
    soundButton.setAttribute("aria-pressed", String(audioEnabled));
    setText(soundLabel, audioEnabled ? "风噪开启" : "风噪关闭");

    if (audioEnabled) {
      if (!audioReady) {
        audioReady = await audio.unlock();
      }
      audio.setMuted(false);
    } else {
      audio.setMuted(true);
    }
  });

  window.__windKite = {
    game,
    renderer,
    audio,
    input
  };

  requestAnimationFrame((timestamp) => {
    lastFrame = timestamp;
    loop(timestamp);
  });
  updateHud(game.getSnapshot());
})();
