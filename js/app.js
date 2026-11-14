(function () {
  "use strict";

  const simCore = window.GrainSim;
  const $ = function (selector) {
    return document.querySelector(selector);
  };

  const els = {
    clock: $("#clock"),
    statusPill: $("#statusPill"),
    statusText: $("#statusText"),
    fanRange: $("#fanRange"),
    fanValue: $("#fanValue"),
    airflowValue: $("#airflowValue"),
    pressureValue: $("#pressureValue"),
    fanState: $("#fanState"),
    openVentCount: $("#openVentCount"),
    ventList: $("#ventList"),
    turnerState: $("#turnerState"),
    turnerClock: $("#turnerClock"),
    turnerHint: $("#turnerHint"),
    turnerCharge: $("#turnerCharge"),
    turnerCoil: $("#turnerCoil"),
    turnerTargets: $("#turnerTargets"),
    binStrip: $("#binStrip"),
    eventLog: $("#eventLog"),
    safeBinsText: $("#safeBinsText"),
    safeBinsCount: $("#safeBinsCount"),
    hotspotText: $("#hotspotText"),
    hotspotCount: $("#hotspotCount"),
    missionBins: $("#missionBins"),
    missionHotspot: $("#missionHotspot"),
    missionState: $("#missionState"),
    fanEnergy: $("#fanEnergy"),
    turnerEnergy: $("#turnerEnergy"),
    moldRisk: $("#moldRisk"),
    crackRisk: $("#crackRisk"),
    heatRisk: $("#heatRisk"),
    moldRiskText: $("#moldRiskText"),
    crackRiskText: $("#crackRiskText"),
    heatRiskText: $("#heatRiskText"),
    riskScore: $("#riskScore"),
    pauseButton: $("#pauseButton"),
    canvasHint: $("#canvasHint"),
    modelClock: $("#modelClock"),
    soundButton: $("#soundButton"),
    validateButton: $("#validateButton"),
    toastStack: $("#toastStack")
  };

  const scene = new window.GrainScene($("#sceneCanvas"));
  const audio = new window.FanAudio();
  let sim = createRun();
  let lastFrame = performance.now();
  let lastUiPaint = 0;
  let lastEventKey = "";
  let sawResult = false;
  let hintTimer = 0;
  let audioUnlocked = false;

  function createRun() {
    const state = simCore.createSim();
    state.events = [
      { t: 0, type: "system", message: "值班接管：三仓新粮入仓，呼吸热开始累积。", binId: "" },
      { t: 0, type: "warn", message: "西仓湿区 58%，风窗当前关闭，需优先排湿。", binId: "C" },
      { t: 0, type: "system", message: "主风机 34% 运行，等待调度。", binId: "" }
    ];
    state.bins.forEach(function (bin) {
      bin.lastSeverity = simCore.severityFor(bin);
    });
    return state;
  }

  function buildStaticUI() {
    els.binStrip.innerHTML = sim.bins
      .map(function (bin, index) {
        return (
          '<article class="bin-card" id="binCard-' + bin.id + '">' +
            '<div class="bin-card-head">' +
              '<div class="bin-name"><b>' + bin.code + '</b><strong>' + bin.name + '</strong></div>' +
              '<span class="bin-crop">' + bin.crop + '</span>' +
              '<span class="bin-state" id="binState-' + bin.id + '">安全</span>' +
            '</div>' +
            '<div class="bin-metrics">' +
              '<div class="metric"><span>粮温</span><b id="binTemp-' + bin.id + '">--<small>°C</small></b></div>' +
              '<div class="metric"><span>含水</span><b id="binMoist-' + bin.id + '">--<small>%</small></b></div>' +
            '</div>' +
            '<div class="bin-bars">' +
              '<div class="micro-bar"><span>湿区</span><i id="binWet-' + bin.id + '"></i></div>' +
              '<div class="micro-bar"><span>干裂</span><i id="binCrack-' + bin.id + '"></i></div>' +
              '<div class="micro-bar"><span>霉变</span><i id="binMold-' + bin.id + '"></i></div>' +
            '</div>' +
          '</article>'
        );
      })
      .join("");

    els.ventList.innerHTML = sim.bins
      .map(function (bin, index) {
        return (
          '<button class="vent-toggle" type="button" data-vent="' + index + '" aria-pressed="false">' +
            '<span class="vent-name">' + bin.id + " · " + bin.name + '</span>' +
            '<span class="vent-state"><i></i><span id="ventState-' + index + '">关闭</span></span>' +
          '</button>'
        );
      })
      .join("");

    els.turnerTargets.innerHTML = sim.bins
      .map(function (bin, index) {
        return '<button type="button" data-turner="' + index + '">翻 ' + bin.name + '</button>';
      })
      .join("");
  }

  function formatTime(seconds) {
    const safe = Math.max(0, Math.ceil(seconds));
    const minutes = Math.floor(safe / 60);
    const rest = safe % 60;
    return String(minutes).padStart(2, "0") + ":" + String(rest).padStart(2, "0");
  }

  function clockStamp(seconds) {
    const base = 6 * 3600 + seconds;
    const hours = Math.floor(base / 3600) % 24;
    const minutes = Math.floor((base % 3600) / 60);
    return String(hours).padStart(2, "0") + ":" + String(minutes).padStart(2, "0");
  }

  function typeLabel(type) {
    return {
      alert: "告警",
      warn: "注意",
      success: "完成",
      fail: "失守",
      turner: "翻谷",
      vent: "风窗",
      system: "系统"
    }[type] || "记录";
  }

  function maxOf(values) {
    return values.reduce(function (max, value) {
      return Math.max(max, value);
    }, 0);
  }

  function riskText(value) {
    if (value >= 0.72) return "高";
    if (value >= 0.38) return "中";
    return "低";
  }

  function setRisk(row, bar, label, value) {
    const safeValue = Math.max(0, Math.min(1, value));
    bar.style.width = Math.round(8 + safeValue * 92) + "%";
    row.classList.toggle("is-warning", safeValue >= 0.38 && safeValue < 0.72);
    row.classList.toggle("is-critical", safeValue >= 0.72);
    label.textContent = riskText(safeValue);
  }

  function showToast(message, type) {
    const toast = document.createElement("div");
    toast.className = "toast" + (type ? " is-" + type : "");
    toast.textContent = message;
    els.toastStack.appendChild(toast);
    while (els.toastStack.children.length > 3) {
      els.toastStack.firstElementChild.remove();
    }
    window.setTimeout(function () {
      toast.remove();
    }, 4400);
  }

  function showHint(text) {
    els.canvasHint.textContent = text;
    els.canvasHint.classList.add("is-visible");
    window.clearTimeout(hintTimer);
    hintTimer = window.setTimeout(function () {
      els.canvasHint.classList.remove("is-visible");
    }, 3000);
  }

  window.GrainApp = {
    getSim: function () {
      return sim;
    },
    scene: scene,
    audio: audio
  };

  let seenEventKeys = new Set(
    sim.events.map(function (event) {
      return event.t + "|" + event.type + "|" + event.message;
    })
  );

  function updateUI(force) {
    const remaining = sim.duration - sim.elapsed;
    els.clock.textContent = formatTime(remaining);
    els.modelClock.textContent = "SIM " + formatTime(sim.elapsed) + " / WINDOW 10:00";

    const critical = sim.bins.some(function (bin) {
      return simCore.severityFor(bin) === "critical" || bin.spoiled;
    });
    const warning = sim.bins.some(function (bin) {
      return simCore.severityFor(bin) === "warning";
    });
    const hotOpen = sim.bins.some(function (bin) {
      return bin.hotspot > 0.16 && !bin.handled;
    });
    let status = "升温中";
    let statusClass = "is-warning";
    if (sim.status === "won") {
      status = "窗口守住";
      statusClass = "is-safe";
    } else if (sim.status === "lost") {
      status = "仓储失守";
      statusClass = "is-danger";
    } else if (hotOpen) {
      status = "热点告警";
      statusClass = "is-danger";
    } else if (critical) {
      status = "临界告警";
      statusClass = "is-danger";
    } else if (!warning) {
      status = "状态稳定";
      statusClass = "is-safe";
    }
    els.statusText.textContent = status;
    els.statusPill.className = "status-pill " + statusClass;

    els.pauseButton.classList.toggle("is-paused", sim.paused);
    els.pauseButton.querySelector("span").textContent = sim.paused ? "继续" : "暂停";
    els.pauseButton.querySelector("svg").innerHTML = sim.paused
      ? '<path d="m7 4 9 6-9 6V4Z" />'
      : '<path d="M6 4v12M14 4v12" />';
    document.querySelectorAll("[data-speed]").forEach(function (button) {
      button.classList.toggle("is-active", Number(button.dataset.speed) === sim.speed);
    });

    els.fanRange.value = sim.controls.fan;
    els.fanRange.style.setProperty("--fan-progress", sim.controls.fan + "%");
    els.fanValue.innerHTML = sim.controls.fan + "<small>%</small>";
    els.airflowValue.textContent = Math.round(sim.controls.fan * 19) + " m³/h";
    els.pressureValue.textContent = (0.12 + sim.controls.fan * 0.0093).toFixed(2) + " kPa";
    els.fanState.textContent = sim.controls.fan > 78 ? "强风" : sim.controls.fan < 20 ? "低风" : "平稳";
    els.fanState.className = sim.controls.fan > 78 ? "tone-warn" : sim.controls.fan > 0 ? "tone-good" : "tone-bad";

    let openCount = 0;
    sim.controls.vents.forEach(function (open, index) {
      const button = document.querySelector('[data-vent="' + index + '"]');
      const label = document.querySelector("#ventState-" + index);
      if (open) openCount += 1;
      button.classList.toggle("is-open", open);
      button.setAttribute("aria-pressed", String(open));
      label.textContent = open ? "开启" : "关闭";
    });
    els.openVentCount.textContent = openCount;

    updateBinCards();
    updateTurner();
    updateMissions();
    updateRisks();
    processNewEvents();

    els.fanEnergy.textContent = sim.fanEnergy.toFixed(1) + " kWh";
    els.turnerEnergy.textContent = (sim.turner.energy + sim.turner.uses * 1.8).toFixed(1) + " kWh";

    const signature = sim.events
      .slice(0, 6)
      .map(function (event) {
        return event.t + event.type + event.message;
      })
      .join("~");
    if (force || signature !== lastEventKey) {
      lastEventKey = signature;
      renderEventLog();
    }

    if ((sim.status === "won" || sim.status === "lost") && !sawResult) {
      sawResult = true;
      showResult();
    }
  }

  function updateBinCards() {
    const colors = {
      safe: "#82d8cb",
      warning: "#e7b56f",
      critical: "#ff6d4a"
    };
    sim.bins.forEach(function (bin) {
      const severity = simCore.severityFor(bin);
      const card = document.querySelector("#binCard-" + bin.id);
      const stateLabel = document.querySelector("#binState-" + bin.id);
      card.className = "bin-card is-" + severity;
      stateLabel.textContent = bin.spoiled ? "失守" : severity === "critical" ? "临界" : severity === "warning" ? "注意" : "安全";
      document.querySelector("#binTemp-" + bin.id).innerHTML = bin.temp.toFixed(1) + "<small>°C</small>";
      document.querySelector("#binMoist-" + bin.id).innerHTML = bin.moisture.toFixed(1) + "<small>%</small>";
      setBar("#binWet-" + bin.id, bin.wetZone * 100, bin.wetZone > 0.82 ? colors.critical : bin.wetZone > 0.65 ? colors.warning : colors.safe);
      setBar("#binCrack-" + bin.id, (bin.cracks / simCore.SAFE.crackFail) * 100, bin.cracks > 0.55 ? colors.critical : bin.cracks > 0.3 ? colors.warning : colors.safe);
      setBar("#binMold-" + bin.id, (bin.mold / simCore.SAFE.moldFail) * 100, bin.mold > 0.36 ? colors.critical : bin.mold > 0.12 ? colors.warning : colors.safe);
    });
  }

  function setBar(selector, width, color) {
    const bar = document.querySelector(selector);
    bar.style.setProperty("--fill", Math.max(1, Math.min(100, width)) + "%");
    bar.style.setProperty("--bar-color", color);
  }

  function updateTurner() {
    const turner = sim.turner;
    const isRunning = turner.activeBin !== -1;
    const isCooling = !isRunning && turner.cooldown > 0;
    els.turnerCoil.className = "coil" + (isRunning ? " is-running" : isCooling ? " is-cooling" : "");
    if (isRunning) {
      els.turnerState.textContent = "运行中";
      els.turnerState.style.color = "var(--amber)";
      els.turnerClock.textContent = "RUN " + Math.ceil(turner.remaining) + "s";
      els.turnerHint.textContent = "正在翻动 " + sim.bins[turner.activeBin].name + " · 热点剥离中";
      els.turnerCharge.style.width = Math.round((turner.remaining / 30) * 100) + "%";
      els.turnerCharge.style.background = "var(--amber)";
    } else if (isCooling) {
      els.turnerState.textContent = "冷却中";
      els.turnerState.style.color = "var(--blue)";
      els.turnerClock.textContent = "COOL " + Math.ceil(turner.cooldown) + "s";
      els.turnerHint.textContent = "轴承冷却中，暂不可再次启动";
      els.turnerCharge.style.width = Math.round((1 - turner.cooldown / 45) * 100) + "%";
      els.turnerCharge.style.background = "var(--blue)";
    } else {
      els.turnerState.textContent = "待机";
      els.turnerState.style.color = "var(--lime)";
      els.turnerClock.textContent = "READY";
      els.turnerHint.textContent = "单次翻谷 30 秒 · 冷却 45 秒";
      els.turnerCharge.style.width = "100%";
      els.turnerCharge.style.background = "var(--lime-dim)";
    }
    document.querySelectorAll("[data-turner]").forEach(function (button) {
      const index = Number(button.dataset.turner);
      button.disabled = isRunning || isCooling || sim.status !== "running" || sim.bins[index].spoiled;
      button.classList.toggle("is-active", turner.activeBin === index);
      button.textContent = turner.activeBin === index ? "运行 " + Math.ceil(turner.remaining) + "s" : "翻 " + sim.bins[index].name;
    });
  }

  function updateMissions() {
    const liveSafe = sim.bins.filter(simCore.isPreserved).length;
    const handled = sim.objective.hotspotHandled;
    els.safeBinsCount.textContent = Math.min(liveSafe, 2) + "/2";
    els.safeBinsText.textContent = "当前 " + liveSafe + " 格处于安全范围";
    els.missionBins.classList.toggle("is-done", liveSafe >= 2);
    els.hotspotCount.textContent = Math.min(handled, 1) + "/1";
    els.missionHotspot.classList.toggle("is-done", handled >= 1);
    if (handled >= 1) {
      els.hotspotText.textContent = "热点已打散，呼吸热恢复受控";
    } else if (sim.hotspotTriggered) {
      const hotBin = sim.bins.find(function (bin) {
        return bin.hotspotSeen && !bin.handled;
      });
      els.hotspotText.textContent = hotBin ? hotBin.name + "热点 " + (36.8 + hotBin.hotspot * 2.4).toFixed(1) + "°C" : "热点待处理";
    } else {
      els.hotspotText.textContent = "扫描中 · 未发现异常";
    }
    els.missionState.textContent =
      sim.status === "won" ? "已完成" : sim.status === "lost" ? "未达成" : handled >= 1 && liveSafe >= 2 ? "目标达成" : "进行中";
  }

  function updateRisks() {
    const mold = maxOf(
      sim.bins.map(function (bin) {
        return Math.max(bin.mold / simCore.SAFE.moldFail, (bin.wetZone - 0.58) / 0.34);
      })
    );
    const crack = maxOf(
      sim.bins.map(function (bin) {
        return bin.cracks / simCore.SAFE.crackFail;
      })
    );
    const heat = maxOf(
      sim.bins.map(function (bin) {
        return Math.max(bin.hotspot / 1.25, (bin.temp - 26) / 6);
      })
    );
    setRisk($("#moldRisk").closest(".risk-row"), els.moldRisk, els.moldRiskText, mold);
    setRisk($("#crackRisk").closest(".risk-row"), els.crackRisk, els.crackRiskText, crack);
    setRisk($("#heatRisk").closest(".risk-row"), els.heatRisk, els.heatRiskText, heat);
    const overall = Math.max(mold, crack, heat);
    els.riskScore.textContent = riskText(overall);
    els.riskScore.style.color = overall >= 0.72 ? "var(--red)" : overall >= 0.38 ? "var(--amber)" : "var(--lime)";
  }

  function renderEventLog() {
    const rows = sim.events.slice(0, 6);
    els.eventLog.innerHTML = rows
      .map(function (event) {
        return (
          '<div class="log-line is-' + event.type + '">' +
            '<time>' + clockStamp(event.t) + '</time>' +
            '<span class="log-tag">' + typeLabel(event.type) + '</span>' +
            '<span>' + event.message + '</span>' +
          '</div>'
        );
      })
      .join("");
  }

  function processNewEvents() {
    let newestCue = "";
    sim.events.forEach(function (event) {
      const key = event.t + "|" + event.type + "|" + event.message;
      if (seenEventKeys.has(key)) return;
      seenEventKeys.add(key);
      if (event.type === "alert" || event.type === "fail" || event.type === "success" || event.type === "warn") {
        showToast(event.message, event.type === "fail" ? "alert" : event.type);
        newestCue = event.type;
      }
    });
    if (newestCue) audio.cue(newestCue === "success" ? "success" : "alert");
  }

  function showResult() {
    const preserved = sim.bins.filter(simCore.isPreserved).length;
    const handled = sim.objective.hotspotHandled;
    const won = sim.status === "won";
    $("#resultEyebrow").textContent = won ? "SHIFT COMPLETE / WINDOW SECURED" : "SHIFT COMPLETE / STORAGE LOST";
    $("#resultTitle").textContent = won ? "十分钟窗口守住" : "仓储窗口失守";
    $("#resultSummary").textContent = won
      ? "通风与翻谷节奏有效，至少两格谷物保持安全，内部热点已打散。"
      : "至少两格谷物已越过安全边界。复盘湿区、风路与翻谷时机后重新值班。";
    $("#resultGrid").innerHTML =
      sim.bins
        .map(function (bin) {
          const ok = simCore.isPreserved(bin);
          return (
            '<div class="result-tile ' + (ok ? "is-good" : "is-bad") + '">' +
              '<span>' + bin.name + " / " + bin.id + '</span>' +
              '<b>' + (ok ? "保住" : "失守") + '</b>' +
              '<span>' + (bin.spoiled ? bin.failReason : bin.temp.toFixed(1) + "°C · " + bin.moisture.toFixed(1) + "%") + '</span>' +
            '</div>'
          );
        })
        .join("") +
      '<div class="result-tile ' + (handled >= 1 ? "is-good" : "is-bad") + '">' +
        '<span>热点处置</span><b>' + handled + " / 1</b>" +
        '<span>' + (handled >= 1 ? "热团已打散" : "仍有热团残留") + '</span>' +
      '</div>' +
      '<div class="result-tile ' + (preserved >= 2 ? "is-good" : "is-bad") + '">' +
        '<span>保留仓格</span><b>' + preserved + " / 3</b><span>目标 ≥ 2</span>" +
      '</div>';
    $("#resultModal").hidden = false;
  }

  function restartRun() {
    sim = createRun();
    scene.particles.length = 0;
    scene.spawnCarry = [0, 0, 0];
    lastFrame = performance.now();
    lastUiPaint = 0;
    lastEventKey = "";
    sawResult = false;
    seenEventKeys = new Set(
      sim.events.map(function (event) {
        return event.t + "|" + event.type + "|" + event.message;
      })
    );
    $("#resultModal").hidden = true;
    updateUI(true);
    showHint("值班重启：先检查西仓湿区和中仓热点");
  }

  function togglePause() {
    if (sim.status !== "running") {
      if (sim.status === "won" || sim.status === "lost") showResult();
      return;
    }
    sim.paused = !sim.paused;
    audio.update(sim.paused ? 0 : sim.controls.fan / 100);
    updateUI(true);
  }

  function setSpeed(speed) {
    sim.speed = speed;
    updateUI(true);
  }

  function runValidationNow() {
    const results = simCore.validateScenarios();
    const rows = [
      {
        data: results.rescue,
        outcome: results.rescue.status === "won" ? "任务成功" : "未达成",
        description:
          results.rescue.detail + " 结局：保住 " + results.rescue.safeBins + " 格，处置 " + results.rescue.handled + " 处热点。"
      },
      {
        data: results.mold,
        outcome: "预期失败已复现",
        description: results.mold.detail + " 结局：仅保住 " + results.mold.safeBins + " 格，仓储失败。"
      }
    ];
    $("#validationResults").innerHTML = rows
      .map(function (row) {
        const pass = row.data.passed;
        return (
          '<div class="validation-row ' + (pass ? "is-pass" : "is-fail") + '">' +
            '<span class="validation-icon">' + (pass ? "✓" : "!") + '</span>' +
            '<div class="validation-copy"><b>' + row.data.name + ' · ' + row.outcome + '</b>' +
              '<p>' + row.description + '</p></div>' +
            '<em>' + (pass ? "PASS" : "FAIL") + '</em>' +
          '</div>'
        );
      })
      .join("");
    const passed = rows.filter(function (row) {
      return row.data.passed;
    }).length;
    $("#validationTitle").textContent = "两套剧本自检 · " + passed + "/2 通过";
  }

  function openValidation() {
    $("#resultModal").hidden = true;
    $("#validationModal").hidden = false;
    runValidationNow();
  }

  function openHelp() {
    $("#helpModal").hidden = false;
  }

  function closeModals() {
    $("#helpModal").hidden = true;
    $("#validationModal").hidden = true;
  }

  els.fanRange.addEventListener("input", function (event) {
    simCore.setFan(sim, Number(event.target.value));
    audio.update(sim.controls.fan / 100);
    updateUI(true);
  });

  els.ventList.addEventListener("click", function (event) {
    const button = event.target.closest("[data-vent]");
    if (!button) return;
    simCore.toggleVent(sim, Number(button.dataset.vent));
    showHint(button.getAttribute("aria-pressed") === "true" ? "风窗关闭：阻断该仓气流" : "风窗开启：建立冷却风路");
    updateUI(true);
  });

  els.turnerTargets.addEventListener("click", function (event) {
    const button = event.target.closest("[data-turner]");
    if (!button) return;
    const index = Number(button.dataset.turner);
    if (simCore.activateTurner(sim, index)) {
      showHint("翻谷机启动：30 秒后进入冷却");
      updateUI(true);
    }
  });

  document.querySelectorAll("[data-speed]").forEach(function (button) {
    button.addEventListener("click", function () {
      setSpeed(Number(button.dataset.speed));
    });
  });

  els.pauseButton.addEventListener("click", togglePause);

  els.soundButton.addEventListener("click", function () {
    const enabled = els.soundButton.getAttribute("aria-pressed") !== "true";
    audio.setEnabled(enabled);
    els.soundButton.setAttribute("aria-pressed", String(enabled));
    els.soundButton.querySelector("span").textContent = enabled ? "声音开" : "静音";
    if (enabled) {
      audioUnlocked = true;
      audio.update(sim.controls.fan / 100);
      showToast("风机声已开启，音高随负载变化。", "success");
    }
    updateUI(true);
  });

  els.validateButton.addEventListener("click", openValidation);
  $("#helpButton").addEventListener("click", openHelp);
  $("#closeHelpButton").addEventListener("click", closeModals);
  $("#startShiftButton").addEventListener("click", function () {
    closeModals();
    showHint("按住风窗，再拉高风机；热点出现后翻中仓");
  });
  $("#closeValidationButton").addEventListener("click", closeModals);
  $("#dismissValidationButton").addEventListener("click", closeModals);
  $("#runValidationButton").addEventListener("click", runValidationNow);
  $("#restartButton").addEventListener("click", restartRun);
  $("#closeResultButton").addEventListener("click", function () {
    $("#resultModal").hidden = true;
  });

  document.addEventListener(
    "pointerdown",
    function () {
      if (audioUnlocked || !audio.enabled) return;
      audioUnlocked = true;
      audio.unlock();
      audio.update(sim.controls.fan / 100);
    },
    { passive: true }
  );

  document.addEventListener("keydown", function (event) {
    if (event.target.matches("input, button")) return;
    if (event.code === "Space") {
      event.preventDefault();
      togglePause();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const delta = event.key === "ArrowRight" ? 4 : -4;
      simCore.setFan(sim, sim.controls.fan + delta);
      updateUI(true);
    } else if (event.key === "1" || event.key === "2" || event.key === "3") {
      simCore.toggleVent(sim, Number(event.key) - 1);
      updateUI(true);
    }
  });

  document.querySelectorAll(".modal-backdrop").forEach(function (backdrop) {
    backdrop.addEventListener("click", function (event) {
      if (event.target === backdrop && backdrop.id !== "resultModal") closeModals();
    });
  });

  function frame(now) {
    const dt = Math.min(0.12, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    if (sim.status === "running" && !sim.paused) {
      simCore.step(sim, dt * sim.speed);
      audio.update(sim.controls.fan / 100);
    } else if (sim.status !== "running") {
      audio.update(0);
    }
    scene.draw(sim, now);
    if (now - lastUiPaint > 90) {
      lastUiPaint = now;
      updateUI(false);
    }
    requestAnimationFrame(frame);
  }

  buildStaticUI();
  updateUI(true);
  window.setTimeout(function () {
    showHint("西仓湿区 58%，先开西仓风窗再提高负载");
  }, 900);
  requestAnimationFrame(frame);
})();
