(function () {
  "use strict";

  const CONFIG = window.Bakery.CONFIG;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  class BakeryGame {
    constructor() {
      this.audio = new window.Bakery.Audio();
      this.renderer = new window.Bakery.Renderer(
        document.getElementById("gameCanvas"),
        CONFIG
      );
      this.dom = this.collectDom();
      this.state = this.createInitialState();
      this.cards = new Map();
      this.toastTimers = new Set();
      this.lastFrame = performance.now();
      this.lastTimerSecond = 0;
      this.autoPaused = false;
      this.buildBatchCards();
      this.bindEvents();
      this.applyMutedState(this.readMutedPreference());
      this.syncControls();
      this.updateUi();
      requestAnimationFrame((time) => this.frame(time));
    }

    collectDom() {
      return {
        canvas: document.getElementById("gameCanvas"),
        sessionClock: document.getElementById("sessionClock"),
        bakedCount: document.getElementById("bakedCount"),
        soundToggle: document.getElementById("soundToggle"),
        restartButton: document.getElementById("restartButton"),
        stageStatus: document.getElementById("stageStatus"),
        stageHint: document.getElementById("stageHint"),
        environmentSummary: document.getElementById("environmentSummary"),
        environmentPanel: document.querySelector(".environment-panel"),
        climateBadge: document.getElementById("climateBadge"),
        tempReadout: document.getElementById("tempReadout"),
        humidityReadout: document.getElementById("humidityReadout"),
        temperatureSlider: document.getElementById("temperatureSlider"),
        humiditySlider: document.getElementById("humiditySlider"),
        temperatureOutput: document.getElementById("temperatureOutput"),
        humidityOutput: document.getElementById("humidityOutput"),
        activityNeedle: document.getElementById("activityNeedle"),
        climateNote: document.getElementById("climateNote"),
        batchList: document.getElementById("batchList"),
        ovenPanel: document.getElementById("ovenPanel"),
        ovenState: document.getElementById("ovenState"),
        ovenProgressBar: document.getElementById("ovenProgressBar"),
        ovenCountdown: document.getElementById("ovenCountdown"),
        ovenMeta: document.getElementById("ovenMeta"),
        bakeButton: document.getElementById("bakeButton"),
        toastRegion: document.getElementById("toastRegion"),
        startOverlay: document.getElementById("startOverlay"),
        startButton: document.getElementById("startButton"),
        resultOverlay: document.getElementById("resultOverlay"),
        resultCard: document.getElementById("resultCard"),
        resultSeal: document.getElementById("resultSeal"),
        resultEyebrow: document.getElementById("resultEyebrow"),
        resultTitle: document.getElementById("resultTitle"),
        resultMessage: document.getElementById("resultMessage"),
        resultStats: document.getElementById("resultStats"),
        playAgainButton: document.getElementById("playAgainButton"),
        inspectButton: document.getElementById("inspectButton"),
      };
    }

    createInitialState() {
      return {
        phase: "intro",
        elapsed: 0,
        temp: 27,
        humidity: 76,
        selectedId: CONFIG.doughs[0].id,
        batches: CONFIG.doughs.map((dough) => ({
          id: dough.id,
          config: dough,
          maturity: dough.start,
          status: "proof",
          announcedReady: false,
          enteredAt: null,
          quality: null,
        })),
        oven: {
          phase: "idle",
          duration: 0,
          remaining: 0,
          progress: 0,
          batchId: null,
        },
        failureBatchId: null,
      };
    }

    buildBatchCards() {
      this.state.batches.forEach((batch, index) => {
        const card = document.createElement("article");
        card.className = "batch-card";
        card.dataset.id = batch.id;
        card.tabIndex = 0;
        card.setAttribute("role", "button");
        card.innerHTML = `
          <div class="batch-thumb" aria-hidden="true"></div>
          <div class="batch-info">
            <div class="batch-title-row">
              <strong>${batch.config.name}</strong>
              <span class="batch-percent">${Math.round(batch.maturity)}%</span>
            </div>
            <div class="maturity-track" aria-hidden="true">
              <span class="maturity-fill"></span>
            </div>
            <div class="batch-subline">
              <span class="batch-state">醒发中</span>
              <i class="dot"></i>
              <span>${batch.config.cue}</span>
            </div>
          </div>
          <button class="batch-action" type="button" aria-label="将${batch.config.name}送入烤炉">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2.5 8h10m-4-4 4 4-4 4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/>
            </svg>
          </button>
        `;
        card.querySelector(".batch-thumb").style.setProperty("--dough-color", batch.config.color);
        const action = card.querySelector(".batch-action");
        card.addEventListener("click", (event) => {
          if (event.target.closest(".batch-action")) return;
          this.selectBatch(batch.id, true);
        });
        card.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            this.selectBatch(batch.id, true);
          }
        });
        action.addEventListener("click", (event) => {
          event.stopPropagation();
          this.selectBatch(batch.id, false);
          this.startBake(batch.id);
        });
        this.dom.batchList.appendChild(card);
        this.cards.set(batch.id, {
          card,
          percent: card.querySelector(".batch-percent"),
          fill: card.querySelector(".maturity-fill"),
          stateLabel: card.querySelector(".batch-state"),
          action,
          thumb: card.querySelector(".batch-thumb"),
          index,
        });
      });
    }

    bindEvents() {
      this.dom.startButton.addEventListener("click", () => this.startSession());
      this.dom.restartButton.addEventListener("click", () => this.resetGame());
      this.dom.playAgainButton.addEventListener("click", () => this.resetGame());
      this.dom.inspectButton.addEventListener("click", () => {
        this.dom.resultOverlay.classList.add("is-hidden");
        this.dom.stageStatus.textContent = "成品展示中";
        this.dom.stageHint.textContent = "画面已定格。重新开炉即可再挑战一次。";
        this.audio.uiClick();
      });

      this.dom.soundToggle.addEventListener("click", async () => {
        const nextMuted = !this.audio.muted;
        this.applyMutedState(nextMuted);
        if (!nextMuted) {
          await this.audio.unlock();
          this.audio.setClimate(this.state.temp, this.state.humidity);
          this.audio.uiClick();
        }
        this.saveMutedPreference(nextMuted);
        this.dom.soundToggle.blur();
      });

      this.dom.temperatureSlider.addEventListener("input", (event) => {
        this.setClimate("temp", Number(event.target.value));
      });
      this.dom.humiditySlider.addEventListener("input", (event) => {
        this.setClimate("humidity", Number(event.target.value));
      });
      [this.dom.temperatureSlider, this.dom.humiditySlider].forEach((slider) => {
        slider.addEventListener("change", () => this.audio.uiClick());
      });

      document.querySelectorAll("[data-step-target]").forEach((button) => {
        button.addEventListener("click", () => {
          const key = button.dataset.stepTarget === "temperature" ? "temp" : "humidity";
          const slider = key === "temp" ? this.dom.temperatureSlider : this.dom.humiditySlider;
          const delta = Number(button.dataset.step);
          const next = clamp(Number(slider.value) + delta, Number(slider.min), Number(slider.max));
          slider.value = String(next);
          this.setClimate(key, next);
          this.audio.uiClick();
        });
      });

      this.dom.bakeButton.addEventListener("click", () => {
        if (this.state.selectedId) this.startBake(this.state.selectedId);
      });

      this.dom.canvas.addEventListener("click", (event) => {
        const hit = this.renderer.hitTest(event.clientX, event.clientY);
        if (!hit) return;
        if (hit.type === "batch") {
          this.selectBatch(hit.id, true);
          return;
        }
        if (hit.type === "oven") {
          if (this.state.selectedId) {
            this.startBake(this.state.selectedId);
          } else {
            this.toast("先在醒发箱里选一批面团。", "warm", "◎");
          }
        }
      });

      this.dom.canvas.addEventListener("pointermove", (event) => {
        const hit = this.renderer.hitTest(event.clientX, event.clientY);
        this.renderer.setHovered(hit && hit.type === "batch" ? hit.id : null);
      });
      this.dom.canvas.addEventListener("pointerleave", () => this.renderer.setHovered(null));

      window.addEventListener("keydown", (event) => {
        if (event.key === " " && !event.repeat) {
          const target = event.target;
          if (target && (target.tagName === "INPUT" || target.tagName === "BUTTON")) return;
          event.preventDefault();
          if (this.state.phase === "running" && this.state.selectedId) {
            this.startBake(this.state.selectedId);
          }
        }
        if (/^[123]$/.test(event.key) && this.state.phase === "running") {
          const batch = this.state.batches[Number(event.key) - 1];
          if (batch) this.selectBatch(batch.id, true);
        }
      });

      document.addEventListener("visibilitychange", () => {
        if (document.hidden && this.state.phase === "running") {
          this.state.phase = "paused";
          this.autoPaused = true;
          this.audio.stopOven();
          this.updateUi();
        } else if (!document.hidden && this.autoPaused) {
          this.state.phase = "running";
          this.autoPaused = false;
          this.lastFrame = performance.now();
          this.updateUi();
        }
      });
    }

    readMutedPreference() {
      try {
        return window.localStorage.getItem("warm-oven-muted") === "1";
      } catch (error) {
        return false;
      }
    }

    saveMutedPreference(muted) {
      try {
        window.localStorage.setItem("warm-oven-muted", muted ? "1" : "0");
      } catch (error) {
        // Local storage can be unavailable in privacy-restricted contexts.
      }
    }

    applyMutedState(muted) {
      this.audio.setMuted(muted);
      this.dom.soundToggle.classList.toggle("is-muted", muted);
      this.dom.soundToggle.setAttribute("aria-pressed", muted ? "false" : "true");
      this.dom.soundToggle.setAttribute("aria-label", muted ? "开启声音" : "关闭声音");
    }

    async startSession() {
      const unlocked = await this.audio.unlock();
      this.audio.setClimate(this.state.temp, this.state.humidity);
      this.dom.startOverlay.classList.add("is-hidden");
      this.state.phase = "running";
      this.lastFrame = performance.now();
      this.toast(
        unlocked ? "环境音已开启 · 三批面团开始醒发" : "开始醒发 · 浏览器未允许声音",
        "warm",
        "♫"
      );
      this.updateUi();
      this.dom.canvas.focus({ preventScroll: true });
    }

    setClimate(key, value) {
      if (key === "temp") {
        this.state.temp = clamp(Math.round(value), CONFIG.tempRange[0], CONFIG.tempRange[1]);
      } else {
        this.state.humidity = clamp(Math.round(value), CONFIG.humidityRange[0], CONFIG.humidityRange[1]);
      }
      this.audio.setClimate(this.state.temp, this.state.humidity);
      this.updateClimateUi();
    }

    growthFactor(dough) {
      const tempNorm = clamp((this.state.temp - 18) / 18, 0, 1);
      const humidityNorm = clamp((this.state.humidity - 55) / 40, 0, 1);
      const warmth = 0.55 + tempNorm * 0.6 + humidityNorm * 0.45;
      const fit = clamp(
        1 - Math.abs(this.state.temp - dough.idealTemp) / 20 -
        Math.abs(this.state.humidity - dough.idealHumidity) / 55,
        0.55,
        1.05
      );
      return warmth * (0.75 + fit * 0.25);
    }

    selectBatch(id, playSound) {
      const batch = this.state.batches.find((item) => item.id === id);
      if (!batch) return;
      this.state.selectedId = id;
      if (playSound) this.audio.uiClick();
      this.updateUi();
    }

    startBake(id) {
      if (this.state.phase !== "running") {
        if (this.state.phase === "paused") {
          this.toast("游戏已暂停，回到窗口后继续。", "warm", "Ⅱ");
        }
        return;
      }
      const batch = this.state.batches.find((item) => item.id === id);
      if (!batch) return;
      if (this.state.oven.phase !== "idle") {
        this.toast(
          this.state.oven.phase === "baking" ? "烤炉里已经有一批了，等它出炉。" : "炉温还没恢复，再等几秒。",
          "warm",
          "⌛"
        );
        return;
      }
      if (batch.status === "baking" || batch.status === "baked") {
        this.toast(`${batch.config.shortName}已经处理过了。`, "warm", "✓");
        return;
      }
      if (batch.status === "overproof") {
        this.toast(`${batch.config.shortName}已经过发，不能入炉。`, "danger", "!");
        return;
      }
      if (batch.status !== "ready") {
        this.toast(`再等等，${batch.config.shortName}还差一点。`, "warm", "◎");
        return;
      }

      batch.status = "baking";
      batch.enteredAt = batch.maturity;
      batch.quality = null;
      this.state.oven = {
        phase: "baking",
        duration: CONFIG.bakeSeconds,
        remaining: CONFIG.bakeSeconds,
        progress: 0,
        batchId: batch.id,
      };
      this.state.selectedId = batch.id;
      this.audio.ovenStart();
      this.toast(`${batch.config.shortName}入炉 · ${Math.round(batch.maturity)}% 正好`, "good", "◆");
      this.updateUi();
    }

    update(delta) {
      this.state.elapsed += delta;
      const climateFactor = this.growthFactor.bind(this);

      for (const batch of this.state.batches) {
        if (batch.status !== "proof" && batch.status !== "ready") continue;
        const rate = batch.config.baseRate * climateFactor(batch.config);
        batch.maturity += rate * delta;

        if (batch.status === "proof" && batch.maturity >= CONFIG.readyAt) {
          batch.status = "ready";
          if (!batch.announcedReady) {
            batch.announcedReady = true;
            this.audio.readyChime();
            this.toast(`${batch.config.shortName}到了最佳状态，快安排入炉。`, "good", "●");
          }
          if (this.state.selectedId === batch.id) {
            this.state.selectedId = batch.id;
          }
        }

        if (batch.maturity >= CONFIG.overAt) {
          batch.maturity = Math.min(batch.maturity, 112);
          batch.status = "overproof";
          this.finishFailure(batch);
          return;
        }
      }

      this.updateOven(delta);
      if (this.state.phase !== "running") return;

      const second = Math.floor(this.state.elapsed);
      if (second > this.lastTimerSecond) {
        this.lastTimerSecond = second;
        this.audio.tick(second % 4 === 0);
      }
    }

    updateOven(delta) {
      const oven = this.state.oven;
      if (oven.phase === "idle") return;

      oven.remaining = Math.max(0, oven.remaining - delta);
      oven.progress = clamp(1 - oven.remaining / oven.duration, 0, 1);

      if (oven.remaining > 0) return;

      if (oven.phase === "baking") {
        const batch = this.state.batches.find((item) => item.id === oven.batchId);
        if (batch) {
          batch.status = "baked";
          batch.quality = batch.enteredAt >= 84 && batch.enteredAt <= 95 ? "恰到好处" : "合格";
        }
        this.audio.ovenDone();
        const baked = this.state.batches.filter((item) => item.status === "baked").length;

        if (baked === this.state.batches.length) {
          this.finishSuccess();
          return;
        }

        oven.phase = "recovering";
        oven.duration = CONFIG.recoverySeconds;
        oven.remaining = CONFIG.recoverySeconds;
        oven.progress = 0;
        oven.batchId = null;
        const nextReady = this.state.batches.find((item) => item.status === "ready");
        if (nextReady) this.state.selectedId = nextReady.id;
        this.toast("一批出炉，炉温正在恢复。下一批别错过窗口。", "warm", "◒");
        return;
      }

      oven.phase = "idle";
      oven.duration = 0;
      oven.remaining = 0;
      oven.progress = 0;
      oven.batchId = null;
      this.toast("炉温恢复，可以放入下一批了。", "good", "◇");
    }

    finishSuccess() {
      this.state.phase = "success";
      this.audio.success();
      this.showResult(true);
    }

    finishFailure(batch) {
      if (this.state.phase !== "running") return;
      this.state.phase = "failure";
      this.state.failureBatchId = batch.id;
      this.audio.stopOven();
      this.audio.failure();
      this.showResult(false, batch);
    }

    showResult(success, failedBatch) {
      const baked = this.state.batches.filter((item) => item.status === "baked");
      const average = baked.length
        ? baked.reduce((sum, item) => sum + item.enteredAt, 0) / baked.length
        : 0;
      this.dom.resultCard.classList.toggle("is-failure", !success);
      this.dom.resultSeal.textContent = success ? "✓" : "!";
      this.dom.resultEyebrow.textContent = success ? "ALL BAKED · 全部合格" : "PROOF LOST · 发酵失败";
      this.dom.resultTitle.textContent = success ? "三炉皆成" : "醒过头了";
      this.dom.resultMessage.textContent = success
        ? `温度、湿度和炉温都踩在了点上。三批面包依次出炉，${baked.every((item) => item.quality === "恰到好处") ? "每一只都鼓得恰到好处。" : "每一只都守住了最佳窗口。"}`
        : `${failedBatch.config.name}在醒发箱里停留太久，面筋失去了支撑。烤炉一次的容量，要求每一批都必须准时。`;

      this.dom.resultStats.innerHTML = success
        ? `
          <div class="result-stat"><span>总用时</span><strong>${this.formatTime(this.state.elapsed)}</strong></div>
          <div class="result-stat"><span>平均入炉</span><strong>${Math.round(average)}%</strong></div>
          <div class="result-stat"><span>成品评价</span><strong>${baked.length} / 3 合格</strong></div>
        `
        : `
          <div class="result-stat"><span>已出炉</span><strong>${baked.length} / 3</strong></div>
          <div class="result-stat"><span>过发批次</span><strong>${failedBatch.config.shortName}</strong></div>
          <div class="result-stat"><span>本次用时</span><strong>${this.formatTime(this.state.elapsed)}</strong></div>
        `;
      this.dom.playAgainButton.textContent = success ? "再烤一炉" : "重新开炉";
      this.dom.resultOverlay.classList.remove("is-hidden");
      window.setTimeout(() => this.dom.playAgainButton.focus({ preventScroll: true }), 320);
      this.updateUi();
    }

    showToast(message, tone, symbol) {
      const toast = document.createElement("div");
      toast.className = `toast is-${tone || "warm"}`;
      const badge = document.createElement("span");
      badge.className = "toast-symbol";
      badge.textContent = symbol || "·";
      const text = document.createElement("span");
      text.textContent = message;
      toast.append(badge, text);
      this.dom.toastRegion.appendChild(toast);

      const timer = window.setTimeout(() => {
        toast.classList.add("is-leaving");
        window.setTimeout(() => {
          toast.remove();
          this.toastTimers.delete(timer);
        }, 340);
      }, 3100);
      this.toastTimers.add(timer);
    }

    toast(message, tone, symbol) {
      this.showToast(message, tone, symbol);
    }

    resetGame() {
      this.toastTimers.forEach((timer) => window.clearTimeout(timer));
      this.toastTimers.clear();
      this.dom.toastRegion.replaceChildren();
      this.audio.stopOven();
      this.state = this.createInitialState();
      this.lastTimerSecond = 0;
      this.autoPaused = false;
      this.renderer.setHovered(null);
      this.dom.startOverlay.classList.remove("is-hidden");
      this.dom.resultOverlay.classList.add("is-hidden");
      this.dom.resultCard.classList.remove("is-failure");
      this.dom.stageStatus.textContent = "醒发箱运转中";
      this.dom.stageHint.textContent = "轻点面团查看状态，等它鼓到刚好再入炉。";
      this.syncControls();
      this.updateUi();
      this.audio.uiClick();
    }

    syncControls() {
      this.dom.temperatureSlider.value = String(this.state.temp);
      this.dom.humiditySlider.value = String(this.state.humidity);
      this.updateClimateUi();
    }

    updateClimateUi() {
      const temp = this.state.temp;
      const humidity = this.state.humidity;
      const tempProgress = (temp - CONFIG.tempRange[0]) / (CONFIG.tempRange[1] - CONFIG.tempRange[0]) * 100;
      const humidityProgress = (humidity - CONFIG.humidityRange[0]) / (CONFIG.humidityRange[1] - CONFIG.humidityRange[0]) * 100;

      this.dom.tempReadout.textContent = String(temp);
      this.dom.humidityReadout.textContent = String(humidity);
      this.dom.temperatureOutput.textContent = `${temp}°C`;
      this.dom.humidityOutput.textContent = `${humidity}%`;
      this.dom.environmentSummary.textContent = `${temp}°C · ${humidity}% RH`;
      this.dom.temperatureSlider.style.setProperty("--track-progress", `${tempProgress}%`);
      this.dom.humiditySlider.style.setProperty("--track-progress", `${humidityProgress}%`);
      this.dom.temperatureSlider.setAttribute("aria-valuetext", `${temp} 摄氏度`);
      this.dom.humiditySlider.setAttribute("aria-valuetext", `${humidity}% 相对湿度`);

      let badge = "舒适";
      let badgeClass = "";
      let note = "温暖湿润，酵母正舒展。留意每批面团的节奏。";
      if (temp >= 32 || humidity >= 88) {
        badge = "偏热";
        badgeClass = "is-hot";
        note = "温度偏高，发酵正在加速，最佳窗口会更短。";
      } else if (temp <= 22 || humidity <= 63) {
        badge = "偏凉";
        badgeClass = "is-cool";
        note = "环境偏凉，发酵放缓；别把面团拖过最佳窗口。";
      } else if (temp >= 29 && humidity >= 81) {
        badge = "活跃";
        note = "酵母活力充足，适合让三批依次进入状态。";
      } else if (temp <= 25 && humidity <= 70) {
        badge = "缓和";
        badgeClass = "is-cool";
        note = "低温慢发，适合给后两批留出烤炉回温的时间。";
      }
      this.dom.climateBadge.textContent = badge;
      this.dom.climateBadge.className = `status-badge ${badgeClass}`.trim();
      this.dom.climateNote.textContent = note;

      const activity = clamp((this.growthFactor(CONFIG.doughs[0]) - 0.55) / 0.75, 0, 1);
      this.dom.activityNeedle.style.transform = `translateX(-1px) rotate(${-118 + activity * 236}deg)`;
    }

    updateUi() {
      const selected = this.state.batches.find((batch) => batch.id === this.state.selectedId);
      const baked = this.state.batches.filter((batch) => batch.status === "baked");
      const ready = this.state.batches.filter((batch) => batch.status === "ready");

      this.dom.sessionClock.textContent = this.formatTime(this.state.elapsed);
      this.dom.bakedCount.textContent = String(baked.length);
      this.updateClimateUi();

      this.state.batches.forEach((batch) => {
        const view = this.cards.get(batch.id);
        if (!view) return;
        view.card.classList.toggle("is-selected", this.state.selectedId === batch.id);
        view.card.classList.toggle("is-ready", batch.status === "ready");
        view.card.classList.toggle("is-overproof", batch.status === "overproof");
        view.card.classList.toggle("is-baking", batch.status === "baking");
        view.card.classList.toggle("is-baked", batch.status === "baked");
        const shownMaturity = batch.status === "baked" ? batch.enteredAt : batch.maturity;
        view.percent.textContent = `${Math.round(shownMaturity)}%`;
        view.fill.style.width = `${clamp(shownMaturity / 112, 0, 1) * 100}%`;
        view.stateLabel.textContent = this.batchStatusLabel(batch);
        const canBake = batch.status === "ready" &&
          this.state.oven.phase === "idle" &&
          this.state.phase === "running";
        view.action.disabled = !canBake;
        view.action.setAttribute(
          "aria-label",
          canBake
            ? `将${batch.config.name}送入烤炉`
            : `${batch.config.name}${this.batchStatusLabel(batch)}`
        );
        view.card.setAttribute(
          "aria-label",
          `${batch.config.name}，成熟度 ${Math.round(shownMaturity)}%，${this.batchStatusLabel(batch)}`
        );
      });

      this.dom.ovenPanel.classList.toggle("is-active", this.state.oven.phase === "baking");
      this.dom.ovenPanel.classList.toggle("is-recovering", this.state.oven.phase === "recovering");
      const ovenBatch = this.state.batches.find((batch) => batch.id === this.state.oven.batchId);
      if (this.state.oven.phase === "baking") {
        this.dom.ovenState.textContent = "烘烤中";
        this.dom.ovenCountdown.textContent = `${this.state.oven.remaining.toFixed(1)}s`;
        this.dom.ovenMeta.textContent = `${ovenBatch ? ovenBatch.config.shortName : "面包"}在炉 · 炉门已关`;
      } else if (this.state.oven.phase === "recovering") {
        this.dom.ovenState.textContent = "回温中";
        this.dom.ovenCountdown.textContent = `${this.state.oven.remaining.toFixed(1)}s`;
        this.dom.ovenMeta.textContent = "石窑正在恢复蓄热";
      } else {
        this.dom.ovenState.textContent = "空闲";
        this.dom.ovenCountdown.textContent = "—";
        this.dom.ovenMeta.textContent = "一次只放一批 · 出炉后需回温";
      }
      const ovenProgress = this.state.oven.phase === "baking"
        ? this.state.oven.progress
        : this.state.oven.phase === "recovering"
          ? 1 - this.state.oven.progress
          : 0;
      this.dom.ovenProgressBar.style.width = `${clamp(ovenProgress, 0, 1) * 100}%`;

      const canUseBakeButton = Boolean(selected) &&
        selected.status === "ready" &&
        this.state.oven.phase === "idle" &&
        this.state.phase === "running";
      this.dom.bakeButton.disabled = !canUseBakeButton;
      this.dom.bakeButton.querySelector("span").textContent = selected
        ? selected.status === "ready"
          ? `送入 · ${selected.config.shortName}`
          : "送入烤炉"
        : "送入烤炉";

      this.updateStageCopy(selected, ready);
    }

    updateStageCopy(selected, ready) {
      if (this.state.phase === "success") {
        this.dom.stageStatus.textContent = "三批均已合格";
        this.dom.stageHint.textContent = "订单完成。石窑还留着余温。";
        return;
      }
      if (this.state.phase === "failure") {
        const failed = this.state.batches.find((batch) => batch.id === this.state.failureBatchId);
        this.dom.stageStatus.textContent = "醒发中断";
        this.dom.stageHint.textContent = `${failed ? failed.config.name : "一批面团"}醒过了头，面筋已失去支撑。`;
        return;
      }
      if (this.state.phase === "paused") {
        this.dom.stageStatus.textContent = "已暂停";
        this.dom.stageHint.textContent = "回到这个窗口后，发酵会继续。";
        return;
      }
      if (this.state.phase === "intro") {
        this.dom.stageStatus.textContent = "醒发箱运转中";
        this.dom.stageHint.textContent = "轻点面团查看状态，等它鼓到刚好再入炉。";
        return;
      }

      this.dom.stageStatus.textContent = this.state.oven.phase === "baking"
        ? "烤炉烘烤中"
        : ready.length > 0
          ? `${ready.length} 批正好，可入炉`
          : "醒发箱运转中";

      if (this.state.oven.phase === "baking") {
        this.dom.stageHint.textContent = "炉门已关，留意下一批的成熟度。";
      } else if (this.state.oven.phase === "recovering") {
        this.dom.stageHint.textContent = `石窑回温还需 ${this.state.oven.remaining.toFixed(1)} 秒，先看住醒发箱。`;
      } else if (selected && selected.status === "ready") {
        this.dom.stageHint.textContent = `${selected.config.shortName}正在最佳窗口，按空格或送入烤炉。`;
      } else if (selected) {
        this.dom.stageHint.textContent = `${selected.config.shortName}还在醒发，观察气泡与体积的变化。`;
      } else {
        this.dom.stageHint.textContent = "轻点面团查看状态，等它鼓到刚好再入炉。";
      }
    }

    batchStatusLabel(batch) {
      switch (batch.status) {
        case "ready": return "正好 · 可入炉";
        case "overproof": return "已过发";
        case "baking": return "烘烤中";
        case "baked": return batch.quality || "已出炉";
        default: return "醒发中";
      }
    }

    formatTime(seconds) {
      const whole = Math.max(0, Math.floor(seconds));
      const minutes = Math.floor(whole / 60);
      const remainder = whole % 60;
      return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
    }

    frame(time) {
      const delta = Math.min((time - this.lastFrame) / 1000, 0.05);
      this.lastFrame = time;
      if (this.state.phase === "running") {
        this.update(delta);
      }
      this.renderer.draw(this.state, time);
      this.updateUi();
      requestAnimationFrame((nextTime) => this.frame(nextTime));
    }

    snapshot() {
      return {
        phase: this.state.phase,
        elapsed: this.state.elapsed,
        temp: this.state.temp,
        humidity: this.state.humidity,
        selectedId: this.state.selectedId,
        batches: this.state.batches.map((batch) => ({
          id: batch.id,
          maturity: Number(batch.maturity.toFixed(2)),
          status: batch.status,
          enteredAt: batch.enteredAt,
          quality: batch.quality,
        })),
        oven: { ...this.state.oven },
      };
    }
  }

  window.Bakery.Game = BakeryGame;
  window.addEventListener("DOMContentLoaded", () => {
    window.bakeryGame = new BakeryGame();
  });
})();
