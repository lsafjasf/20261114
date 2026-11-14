(function initSkyMedGame() {
  "use strict";

  const Core = window.SkyMedCore;
  const World = { width: 1000, height: 640 };
  const canvas = document.getElementById("mapCanvas");
  const ctx = canvas.getContext("2d");
  const $ = (id) => document.getElementById(id);

  const ui = {
    clock: $("clockValue"),
    clockBar: $("clockBar"),
    phase: $("phaseBadge"),
    delivered: $("deliveredValue"),
    usable: $("usableValue"),
    load: $("loadValue"),
    mapPhase: $("mapPhase"),
    mapNode: $("mapNode"),
    packages: $("packageList"),
    batteries: $("batteryList"),
    swapNote: $("swapStationNote"),
    cool: $("coolButton"),
    routeTitle: $("routeTitle"),
    routeRisk: $("routeRisk"),
    routeMetrics: $("routeMetrics"),
    routeHint: $("routeHint"),
    launch: $("launchButton"),
    launchSub: $("launchSub"),
    log: $("logMessage"),
    toast: $("toast"),
    modal: $("missionModal"),
    modalCard: $("missionModal").querySelector(".modal-card"),
    modalEyebrow: $("modalEyebrow"),
    modalTitle: $("modalTitle"),
    modalBody: $("modalBody"),
    modalRules: $("modalRules"),
    modalPrimary: $("modalPrimary"),
    modalSecondary: $("modalSecondary"),
    sound: $("soundButton"),
    soundIcon: $("soundIcon"),
    soundLabel: $("soundLabel"),
    restart: $("restartButton")
  };

  let game = Core.createGame(performance.now());
  let canvasFit = { scale: 1, offsetX: 0, offsetY: 0, dpr: 1 };
  let lastFrame = 0;
  let lastEventKey = "";
  let lastCountdownSecond = -1;
  let audioEnabled = true;
  let audioContext = null;
  let packagesKey = "";
  let batteriesKey = "";
  let routeKey = "";
  let toastTimeout = 0;
  let modalOpen = true;
  let resultModalEvent = "";
  const effects = [];

  function formatClock(seconds) {
    const tenths = Math.max(0, Math.ceil(seconds * 10));
    const minutes = Math.floor(tenths / 600);
    const secs = Math.floor((tenths % 600) / 10);
    const remainder = tenths % 10;
    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${remainder}`;
  }

  function round(value, digits) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function platform(id) {
    return Core.platformById(id);
  }

  function installedBattery() {
    return Core.installedBattery(game);
  }

  function loadedCount() {
    return Core.loadedPackages(game).length;
  }

  function phaseLabel() {
    const map = {
      briefing: "待命",
      ready: "地面待命",
      flying: "飞行中",
      cooling: "冷却中",
      won: "任务成功",
      lost: "任务失败"
    };
    return map[game.status] || "待命";
  }

  function mapPhaseLabel() {
    const map = {
      briefing: "等待任务",
      ready: "盘旋待命",
      flying: "航线执行",
      cooling: "电池冷却",
      won: "投送完成",
      lost: "任务中止"
    };
    return map[game.status] || "等待任务";
  }

  function heatClass(heat) {
    if (heat >= 85) return "danger";
    if (heat >= 60) return "warning";
    return "";
  }

  const Sound = {
    ensure() {
      if (!audioEnabled) return null;
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return null;
      if (!audioContext) {
        audioContext = new AudioCtor();
      }
      if (audioContext.state === "suspended") {
        audioContext.resume().catch(() => {});
      }
      return audioContext;
    },

    tone(frequency, duration, options) {
      const audio = this.ensure();
      if (!audio) return;
      const opts = options || {};
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const start = audio.currentTime + (opts.delay || 0);
      const end = start + duration;

      oscillator.type = opts.type || "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      if (opts.endFrequency) {
        oscillator.frequency.exponentialRampToValueAtTime(
          Math.max(20, opts.endFrequency),
          end
        );
      }
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(opts.volume || 0.05, start + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);

      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start(start);
      oscillator.stop(end + 0.01);
    },

    countdown(second) {
      const critical = second <= 10;
      this.tone(critical ? 880 : 660, 0.07, {
        type: "square",
        volume: critical ? 0.045 : 0.03
      });
      if (second <= 5) {
        this.tone(440, 0.055, {
          type: "triangle",
          volume: 0.025,
          delay: 0.09
        });
      }
    },

    takeoff() {
      this.tone(180, 0.5, {
        type: "sawtooth",
        endFrequency: 620,
        volume: 0.032
      });
      this.tone(95, 0.35, {
        type: "triangle",
        endFrequency: 250,
        volume: 0.022,
        delay: 0.05
      });
    },

    click() {
      this.tone(520, 0.035, { type: "sine", volume: 0.025 });
    },

    delivery() {
      this.tone(660, 0.15, { type: "sine", volume: 0.055 });
      this.tone(990, 0.2, { type: "sine", volume: 0.045, delay: 0.12 });
    },

    win() {
      [523, 659, 784, 1046].forEach((frequency, index) => {
        this.tone(frequency, 0.28, {
          type: "triangle",
          volume: 0.05,
          delay: index * 0.11
        });
      });
    },

    alarm() {
      [0, 0.28, 0.56].forEach((delay) => {
        this.tone(300, 0.19, {
          type: "sawtooth",
          endFrequency: 190,
          volume: 0.075,
          delay
        });
        this.tone(155, 0.2, {
          type: "square",
          volume: 0.04,
          delay: delay + 0.025
        });
      });
    }
  };

  function packageState(item) {
    if (item.delivered) return "已送达";
    if (item.loaded) return "已装载";
    if (item.originId !== game.currentPlatformId) return "待取回";
    if (game.status === "flying") return "飞行中";
    return "点击装载";
  }

  function renderPackages() {
    const key = [
      game.currentPlatformId,
      game.status,
      ...game.packages.map((item) => `${item.id}:${item.loaded}:${item.delivered}`)
    ].join("|");
    if (key === packagesKey) return;
    packagesKey = key;

    ui.packages.innerHTML = game.packages
      .map((item) => {
        const target = platform(item.targetId);
        const canToggle =
          !item.delivered &&
          item.originId === game.currentPlatformId &&
          (game.status === "briefing" || game.status === "ready");
        const classes = [
          "package-card",
          item.loaded ? "is-loaded" : "",
          item.delivered ? "is-delivered" : ""
        ]
          .filter(Boolean)
          .join(" ");
        return `
          <button
            class="${classes}"
            type="button"
            data-package-id="${item.id}"
            ${canToggle ? "" : "disabled"}
            aria-label="${item.name}，送往${target.name}，${packageState(item)}"
          >
            <span class="package-top">
              <span class="package-icon">${item.delivered ? "✓" : "+"}</span>
              <span class="package-state">${packageState(item)}</span>
            </span>
            <strong>${item.name}</strong>
            <small>${item.code} → ${target.short} ${target.name}</small>
          </button>
        `;
      })
      .join("");
  }

  function renderBatteries() {
    const currentPlatform = platform(game.currentPlatformId);
    const key = [
      game.currentPlatformId,
      game.status,
      game.installedBatteryId,
      ...game.batteries.map(
        (battery) =>
          `${battery.id}:${Math.round(battery.charge)}:${Math.round(battery.heat)}`
      )
    ].join("|");
    if (key === batteriesKey) return;
    batteriesKey = key;

    ui.swapNote.textContent = currentPlatform.swap
      ? `${currentPlatform.short} 可换电 · ${game.batteries.length} 块`
      : `${currentPlatform.short} 仅冷却 · ${game.batteries.length} 块`;

    ui.batteries.innerHTML = game.batteries
      .map((battery) => {
        const installed = battery.id === game.installedBatteryId;
        const locked = battery.heat >= Core.CONFIG.takeoffHeatLimit;
        const empty = battery.charge <= 0;
        const usable = Core.isBatteryUsable(battery);
        const rowClasses = [
          "battery-row",
          installed ? "is-installed" : "",
          locked ? "is-locked" : "",
          empty ? "is-empty" : ""
        ]
          .filter(Boolean)
          .join(" ");
        const canSwap =
          currentPlatform.swap &&
          !installed &&
          !empty &&
          (game.status === "briefing" || game.status === "ready");
        const heatColor = locked
          ? "#ff5269"
          : battery.heat >= 55
            ? "#ffc05c"
            : "#ff9a66";
        const statusText = installed
          ? "装机中"
          : locked
            ? "热锁"
            : empty
              ? "耗尽"
              : usable
                ? "可用"
                : "不可用";

        return `
          <div class="${rowClasses}">
            <i class="battery-dot" aria-hidden="true"></i>
            <div class="battery-name">
              ${battery.name}
              <small>${battery.id} · ${statusText}</small>
            </div>
            <div class="battery-bars">
              <div class="battery-metric">
                <span>E</span>
                <i style="--value:${Math.max(0, battery.charge)}%;--bar-color:#64e8c1"></i>
                <em>${Math.round(battery.charge)}%</em>
              </div>
              <div class="battery-metric">
                <span>H</span>
                <i style="--value:${Math.max(0, battery.heat)}%;--bar-color:${heatColor}"></i>
                <em>${Math.round(battery.heat)}°</em>
              </div>
            </div>
            <button
              class="battery-action"
              type="button"
              data-battery-id="${battery.id}"
              ${canSwap ? "" : "disabled"}
              aria-label="${installed ? `${battery.name}已装机` : `换装${battery.name}`}"
            >${installed ? "装机" : "换装"}</button>
          </div>
        `;
      })
      .join("");
  }

  function renderRoute() {
    const target = game.selectedDestinationId
      ? platform(game.selectedDestinationId)
      : null;
    const quote = target ? Core.getRouteQuote(game, target.id) : null;
    const battery = installedBattery();
    const key = [
      game.status,
      game.currentPlatformId,
      game.selectedDestinationId,
      game.installedBatteryId,
      loadedCount(),
      battery ? Math.round(battery.charge / 3) : 0,
      battery ? Math.round(battery.heat / 3) : 0,
      game.deliveredCount
    ].join("|");
    if (key === routeKey) return;
    routeKey = key;

    if (!target || !quote || !battery) {
      ui.routeTitle.textContent = "选择目的地";
      ui.routeRisk.textContent = "无航线";
      ui.routeRisk.className = "risk-tag neutral";
      ui.routeMetrics.innerHTML = `
        <div><span>航程</span><b>—</b></div>
        <div><span>耗电</span><b>—</b></div>
        <div><span>升温</span><b>—</b></div>
        <div><span>预计</span><b>—</b></div>
      `;
      ui.routeHint.className = "route-hint";
      ui.routeHint.textContent =
        "点击地图上的屋顶平台规划下一段航线。重载会放大耗电与热区升温。";
      ui.launch.disabled = true;
      ui.launchSub.textContent = "等待目的地";
      return;
    }

    const from = platform(game.currentPlatformId);
    const routeName = `${from.short} → ${target.short}`;
    ui.routeTitle.textContent = `${routeName} · ${target.name}`;
    ui.routeMetrics.innerHTML = `
      <div><span>航程</span><b>${quote.routeLength}m</b></div>
      <div><span>耗电</span><b>${quote.energy}%</b></div>
      <div><span>升温</span><b>+${quote.heatGain}°</b></div>
      <div><span>预计</span><b>${(quote.durationMs / 1000).toFixed(1)}s</b></div>
    `;

    if (quote.risk === "danger") {
      ui.routeRisk.textContent = "高风险";
      ui.routeRisk.className = "risk-tag danger";
    } else if (quote.risk === "warning") {
      ui.routeRisk.textContent = "需谨慎";
      ui.routeRisk.className = "risk-tag warning";
    } else {
      ui.routeRisk.textContent = "可执行";
      ui.routeRisk.className = "risk-tag";
    }

    const heatLocked = battery.heat >= Core.CONFIG.takeoffHeatLimit;
    let hint = `载重系数 ×${quote.factor}，热区额外 +${quote.zoneHeat}°。`;
    if (heatLocked) {
      hint = `<strong>地面热锁：</strong>当前电池 ${Math.round(
        battery.heat
      )}°，必须先冷却或换电。`;
    } else if (quote.heatAfter >= Core.CONFIG.failureHeat) {
      hint = `<strong>预测空中热锁：</strong>电池将升至 ${Math.round(
        quote.heatAfter
      )}°，途中会强制迫降。`;
    } else if (quote.chargeAfter < 0) {
      hint = `<strong>预测断电：</strong>本段需要 ${quote.energy}%，电池仅剩 ${Math.round(
        battery.charge
      )}%。`;
    } else if (quote.risk === "warning") {
      hint = `落地后仅剩 ${Math.max(0, quote.chargeAfter).toFixed(
        1
      )}% 电量，尽快在南塔换电。`;
    }
    ui.routeHint.className = `route-hint ${quote.risk === "danger" ? "danger" : ""}`;
    ui.routeHint.innerHTML = hint;

    const busy = game.status !== "briefing" && game.status !== "ready";
    const noPower = battery.charge <= 0;
    ui.launch.disabled = busy || heatLocked || noPower;
    if (game.status === "flying") {
      ui.launchSub.textContent = "航线执行中";
    } else if (game.status === "cooling") {
      ui.launchSub.textContent = "冷却完成后方可起飞";
    } else if (heatLocked) {
      ui.launchSub.textContent = "热锁未解除";
    } else if (noPower) {
      ui.launchSub.textContent = "电池耗尽";
    } else if (!game.started) {
      ui.launchSub.textContent = "起飞即开始倒计时";
    } else {
      ui.launchSub.textContent =
        quote.risk === "danger" ? "仍可强制起飞" : "确认换电与载重";
    }
  }

  function updateDynamicUI(now) {
    ui.delivered.textContent = String(game.deliveredCount);
    ui.usable.textContent = String(Core.usableBatteryCount(game));
    ui.load.textContent = `${loadedCount()} / 2`;
    ui.clock.textContent = formatClock(game.timeLeft);
    ui.clock.classList.toggle("is-warning", game.timeLeft <= 20 && game.timeLeft > 10);
    ui.clock.classList.toggle("is-critical", game.timeLeft <= 10);
    ui.clockBar.style.transform = `scaleX(${clamp(
      game.timeLeft / Core.CONFIG.missionSeconds,
      0,
      1
    )})`;
    ui.clockBar.style.background =
      game.timeLeft <= 10
        ? "linear-gradient(90deg, #ff5269, #ff9a66)"
        : game.timeLeft <= 20
          ? "linear-gradient(90deg, #ffc05c, #ff9a66)"
          : "linear-gradient(90deg, #64e8c1, #6ecdf3)";
    ui.phase.textContent = phaseLabel();
    ui.phase.classList.toggle(
      "is-danger",
      game.status === "lost" || (game.status === "flying" && game.flight && game.flight.quote.risk === "danger")
    );
    ui.mapPhase.textContent = mapPhaseLabel();
    const current = platform(game.currentPlatformId);
    ui.mapNode.textContent = `${current.short} ${current.name}`;

    if (game.status === "cooling" && game.cooling) {
      const left = Math.max(0, (game.cooling.endsAt - now) / 1000);
      ui.cool.disabled = true;
      ui.cool.innerHTML = `<span>冷却中 ${left.toFixed(1)}s</span><small>热锁解除倒计时</small>`;
    } else {
      const battery = installedBattery();
      const canCool =
        battery &&
        battery.heat > 0.5 &&
        (game.status === "briefing" || game.status === "ready");
      ui.cool.disabled = !canCool;
      ui.cool.innerHTML = battery
        ? `<span>冷却当前电池</span><small>${Math.round(
            battery.heat
          )}° → ${Math.max(0, Math.round(battery.heat - Core.CONFIG.coolingAmount))}° / 耗时 4 秒</small>`
        : "<span>冷却当前电池</span><small>未装机</small>";
    }

    ui.log.textContent =
      game.log[0]?.message ||
      "塔台：检查载重与电池热状态，75 秒内完成两次投送。";
  }

  function updateUI(now, force) {
    if (force) {
      packagesKey = "";
      batteriesKey = "";
      routeKey = "";
    }
    updateDynamicUI(now);
    renderPackages();
    renderBatteries();
    renderRoute();
  }

  function showToast(message, danger) {
    window.clearTimeout(toastTimeout);
    ui.toast.textContent = message;
    ui.toast.classList.toggle("is-danger", Boolean(danger));
    ui.toast.classList.add("is-visible");
    toastTimeout = window.setTimeout(() => {
      ui.toast.classList.remove("is-visible");
    }, 3300);
  }

  function setModalOpen(open) {
    modalOpen = open;
    ui.modal.classList.toggle("is-open", open);
  }

  function modalBaseClasses() {
    ui.modalCard.classList.remove("is-loss", "is-win");
  }

  function showBriefingModal() {
    modalBaseClasses();
    ui.modalEyebrow.textContent = "URGENT MEDICAL RUN";
    ui.modalTitle.textContent = "S-17 屋顶急救投送";
    ui.modalBody.textContent =
      "两箱医疗物资必须送往东塔急诊与北塔儿科。无人机只能携带电池架中的电池；重载会放大耗电、升温。规划换电、冷却与起降顺序，在 75 秒内完成投送。";
    ui.modalRules.innerHTML = `
      <span><b>75s</b> 完成全部投送</span>
      <span><b>85°</b> 地面热锁</span>
      <span><b>100°</b> 空中迫降</span>
    `;
    ui.modalPrimary.textContent = "开始任务";
    ui.modalSecondary.textContent = "稍后规划";
    ui.modalPrimary.dataset.intent = "start";
    ui.modalSecondary.dataset.intent = "close";
    resultModalEvent = "";
    setModalOpen(true);
  }

  function failureCopy(reason) {
    const copies = {
      "thermal-lock": {
        code: "THERMAL LOCK / 热失控",
        title: "电池热锁 · 空中迫降",
        body:
          "电池热量升至 100°，安全联锁切断动力，无人机在航线上强制迫降。下一次飞行前，先换低温电池或在平台完成 4 秒冷却。"
      },
      "battery-empty": {
        code: "POWER DEPLETION / 电量耗尽",
        title: "航程中断 · 电池耗尽",
        body:
          "重载航线提前抽空电池。用换电站上的高电量电池，或在返航前缩短单段航程。"
      },
      timeout: {
        code: "WINDOW CLOSED / 时限耗尽",
        title: "投送窗口关闭",
        body:
          "75 秒时限已到，仍有医疗包未送达。下一轮优先选择东塔航线并直接前往南塔中继换电。"
      },
      "no-usable-battery": {
        code: "NO RESERVE / 无可用电池",
        title: "医疗包送达，但电池全数失效",
        body:
          "两次投送已完成，但至少保留一块可用电池的条件未满足。降低重载并预留冷备电池。"
      },
      default: {
        code: "MISSION ABORT / 任务中止",
        title: "任务中止",
        body: "无人机安全联锁触发，任务未能完成。"
      }
    };
    return copies[reason] || copies.default;
  }

  function showResultModal(event) {
    if (!event || event.type === "failure") {
      modalBaseClasses();
      ui.modalCard.classList.add("is-loss");
      const copy = failureCopy(game.lossReason);
      ui.modalEyebrow.textContent = copy.code;
      ui.modalTitle.textContent = copy.title;
      ui.modalBody.textContent = copy.body;
      ui.modalRules.innerHTML = `
        <span><b>${game.deliveredCount}/2</b> 已送达</span>
        <span><b>${Core.usableBatteryCount(game)}</b> 可用电池</span>
        <span><b>${game.swapCount}</b> 次换电</span>
      `;
    } else {
      modalBaseClasses();
      ui.modalCard.classList.add("is-win");
      ui.modalEyebrow.textContent = "MISSION COMPLETE / 全部送达";
      ui.modalTitle.textContent = "双点投送完成";
      ui.modalBody.textContent =
        "两箱医疗物资均已送达，任务在时限内完成，电池架仍保留可用冷备。塔台确认本轮调度成功。";
      ui.modalRules.innerHTML = `
        <span><b>${formatClock(game.timeLeft)}</b> 剩余时限</span>
        <span><b>${Core.usableBatteryCount(game)}</b> 可用电池</span>
        <span><b>${game.swapCount}</b> 次换电</span>
      `;
    }
    ui.modalPrimary.textContent = "重新部署";
    ui.modalSecondary.textContent = "查看现场";
    ui.modalPrimary.dataset.intent = "restart";
    ui.modalSecondary.dataset.intent = "close";
    ui.modalCard.classList.add(game.status === "won" ? "is-win" : "is-loss");
    resultModalEvent = `${event.type}:${event.at}:${game.lossReason || "win"}`;
    setModalOpen(true);
  }

  function restartGame() {
    Sound.ensure();
    game = Core.createGame(performance.now());
    effects.length = 0;
    lastEventKey = "";
    lastCountdownSecond = -1;
    resultModalEvent = "";
    packagesKey = "";
    batteriesKey = "";
    routeKey = "";
    showBriefingModal();
    updateUI(performance.now(), true);
    Sound.click();
  }

  function handleAction(result) {
    if (!result) return;
    if (!result.ok) {
      showToast(result.message, true);
      Sound.tone(230, 0.08, { type: "square", volume: 0.028 });
      return;
    }
    if (result.code === "loaded" || result.code === "unloaded") {
      showToast(result.message, false);
      Sound.click();
    }
  }

  function addPulse(platformId, color, size) {
    const item = platform(platformId);
    if (!item) return;
    effects.push({
      type: "pulse",
      x: item.x,
      y: item.y,
      color,
      size: size || 90,
      startedAt: performance.now(),
      duration: 900
    });
  }

  function addConfetti() {
    const colors = ["#64e8c1", "#ffc05c", "#6ecdf3", "#ff8a65"];
    for (let index = 0; index < 34; index += 1) {
      effects.push({
        type: "particle",
        x: 500 + (Math.random() - 0.5) * 430,
        y: 250 + Math.random() * 90,
        vx: (Math.random() - 0.5) * 120,
        vy: -30 - Math.random() * 90,
        color: colors[index % colors.length],
        startedAt: performance.now(),
        duration: 1500 + Math.random() * 900
      });
    }
  }

  function handleGameEvent(event, now) {
    if (!event) return;
    const key = [
      event.type,
      event.at,
      event.reason || "",
      event.platformId || "",
      (event.packageIds || []).join(",")
    ].join(":");
    if (key === lastEventKey) return;
    lastEventKey = key;

    if (event.type === "mission-start") {
      Sound.tone(740, 0.11, { type: "sine", volume: 0.035 });
    } else if (event.type === "takeoff") {
      Sound.takeoff();
      showToast("无人机已起飞，留意电量与热区。", false);
    } else if (event.type === "arrival") {
      showToast(`已抵达 ${platform(event.platformId).name}。`, false);
    } else if (event.type === "delivery") {
      Sound.delivery();
      addPulse(event.platformId, "#ffc05c", 120);
      showToast(
        `医疗包已送达 ${platform(event.platformId).name}，${game.deliveredCount}/2。`,
        false
      );
    } else if (event.type === "battery-swap") {
      Sound.click();
      const battery = Core.batteryById(game, event.batteryId);
      showToast(`${battery.name} 装机完成。`, false);
    } else if (event.type === "cooling-complete") {
      Sound.tone(540, 0.16, { type: "sine", volume: 0.04 });
      Sound.tone(760, 0.14, { type: "sine", volume: 0.03, delay: 0.12 });
      showToast("电池冷却完成，热锁解除。", false);
    } else if (event.type === "failure") {
      Sound.alarm();
      addPulse(game.currentPlatformId, "#ff5269", 150);
      if (game.flight) {
        const to = platform(game.flight.toId);
        effects.push({
          type: "pulse",
          x: to.x,
          y: to.y,
          color: "#ff5269",
          size: 160,
          startedAt: now,
          duration: 1100
        });
      }
      window.setTimeout(() => {
        if (game.status === "lost") showResultModal(event);
      }, 650);
    } else if (event.type === "win") {
      Sound.win();
      addConfetti();
      window.setTimeout(() => {
        if (game.status === "won") showResultModal(event);
      }, 720);
    }
  }

  function checkCountdownSound() {
    if (!game.started || game.status === "won" || game.status === "lost") {
      return;
    }
    if (game.timeLeft <= 20 && game.timeLeft > 0) {
      const second = Math.ceil(game.timeLeft);
      if (second !== lastCountdownSecond) {
        lastCountdownSecond = second;
        Sound.countdown(second);
      }
    }
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const scale = Math.min(width / World.width, height / World.height);
    canvasFit = {
      scale,
      offsetX: (width - World.width * scale) * 0.5,
      offsetY: (height - World.height * scale) * 0.5,
      dpr
    };
  }

  function pointerToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const pixelX = (clientX - rect.left) * (canvas.width / rect.width);
    const pixelY = (clientY - rect.top) * (canvas.height / rect.height);
    return {
      x: (pixelX - canvasFit.offsetX) / canvasFit.scale,
      y: (pixelY - canvasFit.offsetY) / canvasFit.scale
    };
  }

  function curveControl(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const parity = (from.id.charCodeAt(0) + to.id.charCodeAt(1)) % 2;
    const bend = Math.min(68, length * 0.12) * (parity ? 1 : -1);
    return {
      x: (from.x + to.x) * 0.5 + (-dy / length) * bend,
      y: (from.y + to.y) * 0.5 + (dx / length) * bend
    };
  }

  function quadPoint(from, control, to, t) {
    const inverse = 1 - t;
    return {
      x: inverse * inverse * from.x + 2 * inverse * t * control.x + t * t * to.x,
      y: inverse * inverse * from.y + 2 * inverse * t * control.y + t * t * to.y
    };
  }

  function traceQuadratic(context, from, control, to) {
    context.moveTo(from.x, from.y);
    context.quadraticCurveTo(control.x, control.y, to.x, to.y);
  }

  function drawBackground(time) {
    const width = canvas.width;
    const height = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#071b21");
    gradient.addColorStop(0.48, "#0a2329");
    gradient.addColorStop(1, "#061319");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const glow = ctx.createRadialGradient(
      width * 0.52,
      height * 0.45,
      0,
      width * 0.52,
      height * 0.45,
      Math.max(width, height) * 0.68
    );
    glow.addColorStop(0, "rgba(62, 148, 142, 0.13)");
    glow.addColorStop(0.55, "rgba(32, 100, 109, 0.045)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    ctx.setTransform(
      canvasFit.scale,
      0,
      0,
      canvasFit.scale,
      canvasFit.offsetX,
      canvasFit.offsetY
    );

    ctx.save();
    ctx.strokeStyle = "rgba(110, 205, 243, 0.045)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= World.width; x += 50) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, World.height);
      ctx.stroke();
    }
    for (let y = 0; y <= World.height; y += 50) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(World.width, y);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.4;
    for (let index = 0; index < 16; index += 1) {
      const buildingWidth = 58 + ((index * 37) % 60);
      const buildingHeight = 70 + ((index * 53) % 160);
      const x = index * 67 - 30;
      const y = World.height - buildingHeight;
      ctx.fillStyle = index % 3 === 0 ? "#0a1b22" : "#08181e";
      ctx.fillRect(x, y, buildingWidth, buildingHeight);
      ctx.fillStyle = "rgba(110, 205, 243, 0.12)";
      for (let wy = y + 12; wy < World.height - 8; wy += 18) {
        for (let wx = x + 8; wx < x + buildingWidth - 6; wx += 17) {
          if ((wx + wy + index) % 5 !== 0) {
            ctx.fillRect(wx, wy, 2, 1);
          }
        }
      }
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(100, 232, 193, 0.06)";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 11]);
    ctx.beginPath();
    ctx.ellipse(505, 345, 370, 222, -0.1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(505, 345, 285, 170, -0.1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    const scan = (time * 0.018) % 680;
    ctx.save();
    const scanGradient = ctx.createLinearGradient(0, scan - 28, 0, scan + 28);
    scanGradient.addColorStop(0, "rgba(100, 232, 193, 0)");
    scanGradient.addColorStop(0.5, "rgba(100, 232, 193, 0.024)");
    scanGradient.addColorStop(1, "rgba(100, 232, 193, 0)");
    ctx.fillStyle = scanGradient;
    ctx.fillRect(0, scan - 28, World.width, 56);
    ctx.restore();
  }

  function drawHeatZones(time) {
    Core.getHeatZones().forEach((zone, index) => {
      const pulse = 0.92 + Math.sin(time * 0.0018 + index * 1.7) * 0.08;
      ctx.save();
      const glow = ctx.createRadialGradient(
        zone.x,
        zone.y,
        zone.radius * 0.08,
        zone.x,
        zone.y,
        zone.radius * 1.12
      );
      glow.addColorStop(0, "rgba(255, 112, 72, 0.145)");
      glow.addColorStop(0.48, "rgba(255, 105, 66, 0.07)");
      glow.addColorStop(0.82, "rgba(255, 107, 68, 0.025)");
      glow.addColorStop(1, "rgba(255, 107, 68, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(zone.x, zone.y, zone.radius * 1.12, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(255, 137, 88, 0.35)";
      ctx.lineWidth = 1.1;
      ctx.setLineDash([4, 8]);
      ctx.lineDashOffset = -time * 0.012;
      ctx.beginPath();
      ctx.arc(zone.x, zone.y, zone.radius * pulse, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = "rgba(255, 175, 94, 0.13)";
      ctx.setLineDash([2, 14]);
      ctx.beginPath();
      ctx.arc(zone.x, zone.y, zone.radius * 0.72, 0, Math.PI * 2);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255, 171, 103, 0.7)";
      ctx.font = "600 9px 'SFMono-Regular', 'SkyMed CJK', monospace";
      ctx.textAlign = "center";
      ctx.fillText(
        `${zone.name} / +${zone.heat}°`,
        zone.x,
        zone.y - zone.radius * 0.75
      );
      ctx.restore();
    });
  }

  function drawRoutes(time) {
    game.routeHistory.forEach((entry) => {
      const from = platform(entry.fromId);
      const to = platform(entry.toId);
      const control = curveControl(from, to);
      ctx.save();
      ctx.strokeStyle = "rgba(100, 232, 193, 0.16)";
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 7]);
      ctx.beginPath();
      traceQuadratic(ctx, from, control, to);
      ctx.stroke();
      ctx.restore();
    });

    const from = platform(game.currentPlatformId);
    Core.getPlatforms().forEach((to) => {
      if (to.id === from.id) return;
      const control = curveControl(from, to);
      const selected = game.selectedDestinationId === to.id;
      ctx.save();
      ctx.lineCap = "round";
      ctx.strokeStyle = selected
        ? "rgba(100, 232, 193, 0.72)"
        : "rgba(110, 205, 243, 0.13)";
      ctx.lineWidth = selected ? 1.8 : 1;
      ctx.setLineDash(selected ? [6, 6] : [2, 10]);
      ctx.lineDashOffset = selected ? -time * 0.018 : 0;
      ctx.beginPath();
      traceQuadratic(ctx, from, control, to);
      ctx.stroke();
      ctx.restore();

      if (selected) {
        ctx.save();
        for (let index = 0; index < 4; index += 1) {
          const t = ((time * 0.00025 + index * 0.24) % 1);
          const point = quadPoint(from, control, to, t);
          ctx.fillStyle = `rgba(100, 232, 193, ${0.34 + t * 0.38})`;
          ctx.beginPath();
          ctx.arc(point.x, point.y, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    });

    if (game.flight) {
      const flightFrom = platform(game.flight.fromId);
      const flightTo = platform(game.flight.toId);
      const control = curveControl(flightFrom, flightTo);
      ctx.save();
      ctx.strokeStyle = "rgba(100, 232, 193, 0.19)";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      traceQuadratic(ctx, flightFrom, control, flightTo);
      ctx.stroke();

      ctx.strokeStyle = "#64e8c1";
      ctx.shadowColor = "rgba(100, 232, 193, 0.55)";
      ctx.shadowBlur = 10;
      ctx.lineWidth = 2.1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(flightFrom.x, flightFrom.y);
      const steps = Math.max(2, Math.ceil(game.flight.progress * 34));
      for (let index = 1; index <= steps; index += 1) {
        const point = quadPoint(
          flightFrom,
          control,
          flightTo,
          (game.flight.progress * index) / steps
        );
        ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  function roundedPath(context, x, y, width, height, radius) {
    const r = Math.min(radius, width * 0.5, height * 0.5);
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + width - r, y);
    context.quadraticCurveTo(x + width, y, x + width, y + r);
    context.lineTo(x + width, y + height - r);
    context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    context.lineTo(x + r, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - r);
    context.lineTo(x, y + r);
    context.quadraticCurveTo(x, y, x + r, y);
    context.closePath();
  }

  function drawPlatform(item, time, index) {
    const isCurrent = game.currentPlatformId === item.id;
    const isSelected = game.selectedDestinationId === item.id;
    const targetPackages = game.packages.filter(
      (pack) => pack.targetId === item.id
    );
    const delivered = targetPackages.some((pack) => pack.delivered);
    const battery = installedBattery();
    const heatLocked =
      isCurrent && battery && battery.heat >= Core.CONFIG.takeoffHeatLimit;
    const pulse = 0.5 + Math.sin(time * 0.002 + index * 1.2) * 0.5;

    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.26)";
    ctx.beginPath();
    ctx.ellipse(item.x + 8, item.y + 15, 72, 28, 0, 0, Math.PI * 2);
    ctx.fill();

    const bodyGradient = ctx.createLinearGradient(
      item.x - 55,
      item.y,
      item.x + 55,
      World.height
    );
    bodyGradient.addColorStop(0, "rgba(13, 39, 46, 0.97)");
    bodyGradient.addColorStop(0.6, "rgba(8, 27, 33, 0.94)");
    bodyGradient.addColorStop(1, "rgba(4, 15, 19, 0.82)");
    ctx.fillStyle = bodyGradient;
    ctx.beginPath();
    ctx.moveTo(item.x - 49, item.y + 12);
    ctx.lineTo(item.x + 49, item.y + 12);
    ctx.lineTo(item.x + 63, World.height + 2);
    ctx.lineTo(item.x - 66, World.height + 2);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(139, 168, 168, 0.09)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(item.x - 35, item.y + 31);
    ctx.lineTo(item.x - 43, World.height);
    ctx.moveTo(item.x + 35, item.y + 31);
    ctx.lineTo(item.x + 44, World.height);
    ctx.stroke();
    ctx.fillStyle = "rgba(110, 205, 243, 0.16)";
    for (let row = 0; row < 8; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        const wx = item.x - 27 + column * 18;
        const wy = item.y + 39 + row * 17;
        if (wy < World.height - 7) {
          ctx.fillRect(wx, wy, 3, 1.5);
        }
      }
    }

    ctx.fillStyle = "#091b21";
    ctx.strokeStyle = "rgba(139, 168, 168, 0.22)";
    roundedPath(ctx, item.x - 65, item.y - 22, 130, 48, 9);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 255, 255, 0.035)";
    roundedPath(ctx, item.x - 61, item.y - 18, 122, 8, 4);
    ctx.fill();

    ctx.save();
    ctx.strokeStyle = isCurrent
      ? `rgba(100, 232, 193, ${0.48 + pulse * 0.34})`
      : "rgba(139, 168, 168, 0.23)";
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 5]);
    ctx.lineDashOffset = -time * 0.012;
    ctx.beginPath();
    ctx.ellipse(item.x, item.y + 3, 46, 18, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    const padGlow = ctx.createRadialGradient(
      item.x,
      item.y + 2,
      0,
      item.x,
      item.y + 2,
      48
    );
    padGlow.addColorStop(0, isCurrent ? "rgba(100, 232, 193, 0.15)" : "rgba(110, 205, 243, 0.06)");
    padGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = padGlow;
    ctx.beginPath();
    ctx.ellipse(item.x, item.y + 2, 48, 19, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = item.color;
    ctx.font = "700 10px 'SFMono-Regular', 'SkyMed CJK', monospace";
    ctx.textAlign = "center";
    ctx.fillText(item.short, item.x, item.y + 7);

    if (targetPackages.length) {
      const iconX = item.x + 47;
      const iconY = item.y - 27;
      ctx.save();
      ctx.fillStyle = delivered ? "#64e8c1" : "#ffc05c";
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(iconX, iconY, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#082019";
      ctx.font = "800 10px sans-serif";
      ctx.fillText(delivered ? "✓" : "+", iconX, iconY + 3.5);
      ctx.restore();
    }

    if (isSelected) {
      ctx.save();
      ctx.strokeStyle = `rgba(255, 192, 92, ${0.62 + pulse * 0.3})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      ctx.lineDashOffset = time * 0.02;
      ctx.beginPath();
      ctx.ellipse(item.x, item.y + 2, 59, 27, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const labelY = item.y > 500 ? item.y - 45 : item.y + 49;
    ctx.fillStyle = "rgba(5, 18, 22, 0.78)";
    roundedPath(ctx, item.x - 46, labelY - 11, 92, 22, 6);
    ctx.fill();
    ctx.fillStyle = isCurrent ? "#e9f7f4" : "#a3bdbd";
    ctx.font =
      "600 10px 'Avenir Next', 'PingFang SC', 'SkyMed CJK', sans-serif";
    ctx.fillText(item.name, item.x, labelY + 3);

    if (isCurrent) {
      ctx.fillStyle = "#64e8c1";
      ctx.font = "600 8px 'SFMono-Regular', 'SkyMed CJK', monospace";
      ctx.fillText("CURRENT PAD", item.x, labelY - 18);
    }

    if (heatLocked) {
      ctx.save();
      ctx.fillStyle = "rgba(255, 82, 105, 0.92)";
      roundedPath(ctx, item.x - 36, item.y - 58, 72, 19, 5);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "700 8px 'SFMono-Regular', 'SkyMed CJK', monospace";
      ctx.fillText("THERMAL LOCK", item.x, item.y - 45);
      ctx.restore();
    }
    ctx.restore();
  }

  function droneTransform(time) {
    if (game.flight) {
      const from = platform(game.flight.fromId);
      const to = platform(game.flight.toId);
      const control = curveControl(from, to);
      const progress = game.flight.progress;
      const point = quadPoint(from, control, to, progress);
      const ahead = quadPoint(from, control, to, Math.min(1, progress + 0.008));
      const behind = quadPoint(from, control, to, Math.max(0, progress - 0.008));
      const angle = Math.atan2(ahead.y - behind.y, ahead.x - behind.x);
      return { x: point.x, y: point.y - 7, angle, flying: true };
    }

    const current = platform(game.currentPlatformId);
    const hover = Math.sin(time * 0.004) * 2.4;
    return {
      x: current.x,
      y: current.y - 36 + hover,
      angle: 0,
      flying: false
    };
  }

  function drawDrone(time) {
    const position = droneTransform(time);
    const battery = installedBattery();
    const rotorSpin = time * 0.018;
    const lostThermal =
      game.status === "lost" && game.lossReason === "thermal-lock";
    const shake = lostThermal ? Math.sin(time * 0.04) * 2.8 : 0;
    const loaded = Core.loadedPackages(game);

    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(
      position.x + (position.flying ? 5 : 2),
      position.y + 28,
      position.flying ? 16 : 19,
      position.flying ? 7 : 9,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.restore();

    if (position.flying) {
      const from = platform(game.flight.fromId);
      const to = platform(game.flight.toId);
      const control = curveControl(from, to);
      ctx.save();
      for (let index = 0; index < 4; index += 1) {
        const t = Math.max(0, game.flight.progress - index * 0.032);
        const point = quadPoint(from, control, to, t);
        ctx.fillStyle = `rgba(100, 232, 193, ${0.28 - index * 0.055})`;
        ctx.beginPath();
        ctx.arc(
          point.x,
          point.y + 1,
          Math.max(1, 3.2 - index * 0.45),
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
      ctx.restore();
    }

    if (battery && battery.heat >= 80) {
      ctx.save();
      const critical = battery.heat >= Core.CONFIG.takeoffHeatLimit;
      const glow = ctx.createRadialGradient(
        position.x,
        position.y,
        7,
        position.x,
        position.y,
        36
      );
      glow.addColorStop(
        0,
        critical ? "rgba(255, 82, 105, 0.28)" : "rgba(255, 192, 92, 0.2)"
      );
      glow.addColorStop(1, "rgba(255, 82, 105, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(position.x, position.y, 36, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(position.x + shake, position.y + shake * 0.3);
    ctx.rotate(position.angle);
    if (lostThermal) ctx.rotate(0.22);

    ctx.strokeStyle = "rgba(196, 229, 224, 0.6)";
    ctx.lineWidth = 1.5;
    const rotorPositions = [
      [-15, -9],
      [15, -9],
      [-15, 9],
      [15, 9]
    ];
    rotorPositions.forEach(([x, y], index) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = "rgba(182, 225, 220, 0.48)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, 7, rotorSpin + index, rotorSpin + index + Math.PI * 1.35);
      ctx.stroke();
      ctx.fillStyle = "rgba(100, 232, 193, 0.18)";
      ctx.beginPath();
      ctx.arc(0, 0, 6.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    ctx.fillStyle = "#12333a";
    ctx.strokeStyle = "rgba(126, 218, 202, 0.7)";
    ctx.lineWidth = 1.2;
    roundedPath(ctx, -17, -7, 34, 15, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#0a2027";
    ctx.beginPath();
    ctx.moveTo(8, -5);
    ctx.lineTo(21, 0);
    ctx.lineTo(8, 5);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#64e8c1";
    ctx.fillRect(-6, -1.5, 12, 2.3);
    ctx.fillRect(-1.1, -5, 2.3, 9);
    ctx.fillStyle = lostThermal ? "#ff5269" : "#ffc05c";
    ctx.beginPath();
    ctx.arc(-12, 0, 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (loaded.length) {
      ctx.save();
      ctx.translate(position.x, position.y + 14);
      loaded.forEach((item, index) => {
        const offset = (index - (loaded.length - 1) * 0.5) * 10;
        ctx.fillStyle = item.color;
        roundedPath(ctx, offset - 4, 0, 8, 7, 2);
        ctx.fill();
        ctx.fillStyle = "#0b2424";
        ctx.fillRect(offset - 0.8, 1, 1.6, 5);
        ctx.fillRect(offset - 2.6, 2.8, 5.2, 1.4);
      });
      ctx.restore();
    }
  }

  function drawCoolingEffect(time) {
    if (!game.cooling) return;
    const item = platform(game.currentPlatformId);
    const progress = clamp(
      (time - game.cooling.startedAt) /
        (game.cooling.endsAt - game.cooling.startedAt),
      0,
      1
    );
    ctx.save();
    ctx.strokeStyle = `rgba(110, 205, 243, ${0.3 + progress * 0.3})`;
    ctx.lineWidth = 1.2;
    for (let ring = 0; ring < 3; ring += 1) {
      const radius = 18 + ((time * 0.018 + ring * 26) % 60);
      ctx.beginPath();
      ctx.ellipse(item.x, item.y + 2, radius, radius * 0.38, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(110, 205, 243, 0.82)";
    ctx.font = "600 9px 'SFMono-Regular', 'SkyMed CJK', monospace";
    ctx.textAlign = "center";
    ctx.fillText(
      `COOLING ${Math.round((1 - progress) * 4)}s`,
      item.x,
      item.y - 62
    );
    ctx.restore();
  }

  function drawCanvasHud(time) {
    const battery = installedBattery();
    const x = 688;
    const y = 18;
    const width = 290;
    const height = 104;
    const heat = battery ? battery.heat : 0;
    const charge = battery ? battery.charge : 0;
    const heatColor =
      heat >= Core.CONFIG.takeoffHeatLimit
        ? "#ff5269"
        : heat >= 60
          ? "#ffc05c"
          : "#ff9361";
    const flight = game.flight;
    const routeText = flight
      ? `${platform(flight.fromId).short} → ${platform(flight.toId).short} / ${Math.round(
          flight.progress * 100
        )}%`
      : game.status === "lost"
        ? "SIGNAL LOST"
        : `GROUND / ${platform(game.currentPlatformId).short}`;

    ctx.save();
    ctx.fillStyle = "rgba(4, 16, 20, 0.78)";
    ctx.strokeStyle = "rgba(139, 168, 168, 0.16)";
    ctx.lineWidth = 1;
    roundedPath(ctx, x, y, width, height, 11);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(139, 168, 168, 0.9)";
    ctx.font = "600 9px 'SFMono-Regular', 'SkyMed CJK', monospace";
    ctx.fillText("POWER TELEMETRY", x + 14, y + 17);
    ctx.textAlign = "right";
    ctx.fillStyle = "#e9f7f4";
    ctx.font = "600 10px 'SFMono-Regular', 'SkyMed CJK', monospace";
    ctx.fillText(battery ? battery.id : "NO CELL", x + width - 14, y + 17);

    ctx.textAlign = "left";
    ctx.fillStyle = "#8ba8a8";
    ctx.font = "500 9px 'SFMono-Regular', 'SkyMed CJK', monospace";
    ctx.fillText(routeText, x + 14, y + 34);
    ctx.textAlign = "right";
    ctx.fillStyle = flight ? "#64e8c1" : "#8ba8a8";
    ctx.fillText(
      `LOAD ×${Core.weightFactor(game).toFixed(2)}`,
      x + width - 14,
      y + 34
    );

    ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
    roundedPath(ctx, x + 14, y + 45, width - 88, 8, 4);
    ctx.fill();
    ctx.fillStyle = "#64e8c1";
    roundedPath(
      ctx,
      x + 14,
      y + 45,
      Math.max(2, (width - 88) * clamp(charge / 100, 0, 1)),
      8,
      4
    );
    ctx.fill();
    ctx.textAlign = "right";
    ctx.fillStyle = "#e9f7f4";
    ctx.font = "600 10px 'SFMono-Regular', 'SkyMed CJK', monospace";
    ctx.fillText(`${Math.round(charge)}%`, x + width - 14, y + 53);

    ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
    roundedPath(ctx, x + 14, y + 62, width - 88, 8, 4);
    ctx.fill();
    ctx.fillStyle = heatColor;
    roundedPath(
      ctx,
      x + 14,
      y + 62,
      Math.max(2, (width - 88) * clamp(heat / 100, 0, 1)),
      8,
      4
    );
    ctx.fill();
    ctx.fillStyle = heatColor;
    ctx.fillText(`${Math.round(heat)}°`, x + width - 14, y + 70);

    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(139, 168, 168, 0.65)";
    ctx.font = "500 8px 'SFMono-Regular', 'SkyMed CJK', monospace";
    ctx.fillText("ENERGY", x + 14, y + 86);
    ctx.fillText("THERMAL", x + 86, y + 86);
    ctx.fillText("LIMIT 85° / FAIL 100°", x + 160, y + 86);

    const pulse = 0.6 + Math.sin(time * 0.006) * 0.4;
    ctx.fillStyle = `rgba(100, 232, 193, ${0.55 + pulse * 0.35})`;
    ctx.beginPath();
    ctx.arc(x + width - 15, y + 87, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawEffects(time) {
    ctx.save();
    effects.forEach((effect) => {
      const progress = clamp((time - effect.startedAt) / effect.duration, 0, 1);
      if (progress >= 1) return;
      if (effect.type === "pulse") {
        ctx.strokeStyle = effect.color;
        ctx.globalAlpha = (1 - progress) * 0.8;
        ctx.lineWidth = 2.5 * (1 - progress) + 0.5;
        ctx.beginPath();
        ctx.arc(
          effect.x,
          effect.y,
          12 + effect.size * progress,
          0,
          Math.PI * 2
        );
        ctx.stroke();
      } else if (effect.type === "particle") {
        const dt = (time - effect.startedAt) / 1000;
        const px = effect.x + effect.vx * dt;
        const py = effect.y + effect.vy * dt + 110 * dt * dt;
        ctx.globalAlpha = 1 - progress;
        ctx.fillStyle = effect.color;
        ctx.fillRect(px, py, 3, 5);
      }
    });
    ctx.restore();
    for (let index = effects.length - 1; index >= 0; index -= 1) {
      if (time - effects[index].startedAt > effects[index].duration) {
        effects.splice(index, 1);
      }
    }
  }

  function drawFailureOverlay(time) {
    if (game.status !== "lost") {
      const battery = installedBattery();
      if (battery && battery.heat >= Core.CONFIG.takeoffHeatLimit) {
        ctx.save();
        ctx.strokeStyle = "rgba(255, 82, 105, 0.45)";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.lineDashOffset = -time * 0.03;
        roundedPath(ctx, 10, 10, World.width - 20, World.height - 20, 18);
        ctx.stroke();
        ctx.restore();
      }
      return;
    }

    ctx.save();
    const gradient = ctx.createRadialGradient(
      World.width * 0.5,
      World.height * 0.46,
      80,
      World.width * 0.5,
      World.height * 0.46,
      World.width * 0.68
    );
    gradient.addColorStop(0, "rgba(255, 82, 105, 0)");
    gradient.addColorStop(0.62, "rgba(255, 82, 105, 0.035)");
    gradient.addColorStop(1, "rgba(255, 60, 83, 0.25)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, World.width, World.height);

    const position = droneTransform(time);
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255, 82, 105, 0.92)";
    ctx.font = "700 10px 'SFMono-Regular', 'SkyMed CJK', monospace";
    ctx.fillText(
      game.lossReason === "thermal-lock"
        ? "THERMAL LOCK / 100°"
        : "SIGNAL LOST",
      position.x,
      position.y - 42
    );
    ctx.restore();
  }

  function drawScene(time) {
    drawBackground(time);
    drawHeatZones(time);
    drawRoutes(time);
    const platformOrder = [...Core.getPlatforms()].sort((a, b) => a.y - b.y);
    platformOrder.forEach((item, index) => drawPlatform(item, time, index));
    drawCoolingEffect(time);
    drawDrone(time);
    drawEffects(time);
    drawCanvasHud(time);
    drawFailureOverlay(time);
  }

  function platformAtPoint(point) {
    return Core.getPlatforms().find(
      (item) =>
        Math.abs(point.x - item.x) <= 68 &&
        Math.abs(point.y - item.y) <= 42
    );
  }

  function selectPlatform(platformId) {
    if (modalOpen) return;
    if (game.status !== "briefing" && game.status !== "ready") {
      showToast("飞行或冷却中不能切换目的地。", true);
      return;
    }
    const selected = Core.selectDestination(game, platformId, performance.now());
    if (!selected.ok) {
      showToast(selected.message, selected.code === "same-platform");
      return;
    }
    Sound.ensure();
    Sound.click();
    updateUI(performance.now(), true);
  }

  function launchFlight() {
    if (modalOpen) return;
    if (!game.selectedDestinationId) {
      showToast("先在地图上选择一个屋顶平台。", true);
      return;
    }
    const started = Core.beginFlight(
      game,
      game.selectedDestinationId,
      performance.now()
    );
    if (!started.ok) {
      showToast(started.message, true);
      Sound.tone(210, 0.13, { type: "square", volume: 0.035 });
      updateUI(performance.now(), true);
      return;
    }
    updateUI(performance.now(), true);
  }

  function coolInstalledBattery() {
    if (modalOpen) return;
    const cooled = Core.startCooling(game, performance.now());
    if (!cooled.ok) {
      showToast(cooled.message, true);
      return;
    }
    Sound.ensure();
    Sound.tone(720, 0.2, {
      type: "sine",
      endFrequency: 380,
      volume: 0.035
    });
    showToast("冷却循环启动，无人机暂不可起飞。", false);
    updateUI(performance.now(), true);
  }

  ui.packages.addEventListener("click", (event) => {
    const button = event.target.closest("[data-package-id]");
    if (!button) return;
    Sound.ensure();
    const action = Core.togglePackage(
      game,
      button.dataset.packageId,
      performance.now()
    );
    handleAction(action);
    updateUI(performance.now(), true);
  });

  ui.batteries.addEventListener("click", (event) => {
    const button = event.target.closest("[data-battery-id]");
    if (!button) return;
    Sound.ensure();
    const action = Core.installBattery(
      game,
      button.dataset.batteryId,
      performance.now()
    );
    handleAction(action);
    updateUI(performance.now(), true);
  });

  ui.cool.addEventListener("click", coolInstalledBattery);
  ui.launch.addEventListener("click", launchFlight);
  ui.restart.addEventListener("click", restartGame);

  canvas.addEventListener("click", (event) => {
    const point = pointerToWorld(event.clientX, event.clientY);
    const selected = platformAtPoint(point);
    if (selected) {
      selectPlatform(selected.id);
    }
  });

  canvas.addEventListener("mousemove", (event) => {
    const point = pointerToWorld(event.clientX, event.clientY);
    canvas.style.cursor = platformAtPoint(point) ? "pointer" : "crosshair";
  });

  ui.modalPrimary.addEventListener("click", () => {
    Sound.ensure();
    const intent = ui.modalPrimary.dataset.intent;
    if (intent === "restart") {
      restartGame();
      return;
    }
    if (intent === "start" && !game.started) {
      const started = Core.startMission(game, performance.now());
      if (!started.ok) {
        showToast(started.message, true);
        return;
      }
      setModalOpen(false);
      showToast("任务计时已启动：75 秒内完成两次投送。", false);
      updateUI(performance.now(), true);
      return;
    }
    setModalOpen(false);
  });

  ui.modalSecondary.addEventListener("click", () => {
    Sound.ensure();
    Sound.click();
    setModalOpen(false);
  });

  ui.modal.addEventListener("click", (event) => {
    if (
      event.target === ui.modal &&
      game.status !== "won" &&
      game.status !== "lost"
    ) {
      setModalOpen(false);
    }
  });

  ui.sound.addEventListener("click", () => {
    audioEnabled = !audioEnabled;
    if (audioEnabled) {
      Sound.ensure();
      Sound.click();
    } else if (audioContext) {
      audioContext.suspend().catch(() => {});
    }
    ui.sound.setAttribute("aria-pressed", String(audioEnabled));
    ui.soundIcon.textContent = audioEnabled ? "◖" : "◗";
    ui.soundLabel.textContent = audioEnabled ? "声音开" : "声音关";
  });

  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === "Escape" && modalOpen && game.status !== "won" && game.status !== "lost") {
      setModalOpen(false);
      return;
    }
    if (modalOpen || event.metaKey || event.ctrlKey || event.altKey) return;

    const platformKeys = {
      "1": "HUB",
      "2": "T1",
      "3": "T2",
      "4": "R1"
    };
    if (platformKeys[event.key]) {
      event.preventDefault();
      selectPlatform(platformKeys[event.key]);
    } else if (event.key === "Enter") {
      event.preventDefault();
      launchFlight();
    } else if (event.key.toLowerCase() === "c") {
      event.preventDefault();
      coolInstalledBattery();
    }
  });

  window.addEventListener("resize", resizeCanvas);
  if ("ResizeObserver" in window) {
    new ResizeObserver(resizeCanvas).observe(canvas);
  }
  document.addEventListener("pointerdown", () => {
    if (audioEnabled) Sound.ensure();
  });

  function frame(now) {
    Core.tick(game, now);
    updateUI(now, false);
    handleGameEvent(game.lastEvent, now);
    checkCountdownSound();
    drawScene(now);
    lastFrame = now;
    window.requestAnimationFrame(frame);
  }

  ui.sound.setAttribute("aria-pressed", "true");
  ui.soundIcon.textContent = "◖";
  ui.soundLabel.textContent = "声音开";
  resizeCanvas();
  showBriefingModal();
  updateUI(performance.now(), true);
  window.requestAnimationFrame(frame);

  window.__skymed = {
    getState: () => game,
    getLastFrame: () => lastFrame,
    core: Core,
    restart: restartGame,
    selectPlatform,
    launchFlight
  };
})();
