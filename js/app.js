(() => {
  "use strict";

  const E = window.NeonEngine;
  const $ = (id) => document.getElementById(id);
  const clone = (value) => ({ ...value });
  const output = (value) => String(value).padStart(2, "0");

  const dom = {
    canvas: $("sceneCanvas"),
    canvasWrap: $("canvasWrap"),
    playBtn: $("playBtn"),
    resetBtn: $("resetBtn"),
    exportBtn: $("exportBtn"),
    timeline: $("timeline"),
    timelineTracks: $("timelineTracks"),
    playhead: $("playhead"),
    timeCode: $("timeCode"),
    playStatus: $("playStatus"),
    frameStatus: document.querySelector(".frame-status"),
    voltage: $("voltageReadout"),
    signText: $("signText"),
    letterCount: $("letterCount"),
    letterRail: $("letterRail"),
    selectedLetter: $("selectedLetter"),
    selectedName: $("selectedName"),
    energyReadout: $("energyReadout"),
    faultCount: $("faultCount"),
    toast: $("toast"),
    presetBtn: $("presetBtn"),
    restoreBtn: $("restoreBtn"),
    helpBtn: $("helpBtn"),
    helpDialog: $("helpDialog"),
    helpClose: $("helpClose"),
    helpDone: $("helpDone"),
    bootScreen: $("bootScreen"),
    controls: {
      cycle: $("cycleRange"),
      duty: $("dutyRange"),
      hue: $("hueRange"),
      sweep: $("sweepRange"),
      delay: $("delayRange"),
      fault: $("faultRange")
    },
    values: {
      cycle: $("cycleValue"),
      duty: $("dutyValue"),
      hue: $("hueValue"),
      sweep: $("sweepValue"),
      delay: $("delayValue"),
      fault: $("faultValue")
    }
  };

  const renderer = E.createRenderer(dom.canvas);
  const state = {
    text: "NIGHT",
    letters: E.DEFAULTS.slice(0, 5).map(clone),
    selectedIndex: 0,
    time: 0,
    playing: true,
    lastTimestamp: performance.now(),
    lastUiUpdate: 0
  };

  let toastTimer = 0;
  let scrubbing = false;

  const RANGE_META = {
    cycle: { min: 1, max: 4, color: "#ffb74d" },
    duty: { min: 35, max: 90, color: "#ffcf7a" },
    hue: { min: 0, max: 360, color: "#ff6fb5" },
    sweep: { min: 0, max: 100, color: "#8fffc9" },
    delay: { min: 0, max: 3.9, color: "#d6b9ff" },
    fault: { min: 0, max: 100, color: "#ff6fb5" }
  };

  function makeLetter(index) {
    const base = E.DEFAULTS[index % E.DEFAULTS.length];
    return {
      ...clone(base),
      hue: (base.hue + index * 7) % 360
    };
  }

  function selectedLetter() {
    return state.letters[state.selectedIndex] || null;
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    dom.toast.textContent = message;
    dom.toast.classList.add("show");
    toastTimer = window.setTimeout(() => dom.toast.classList.remove("show"), 2200);
  }

  function formatTime(seconds) {
    return `00:${seconds.toFixed(2).padStart(5, "0")}`;
  }

  function paintRange(input, value, meta) {
    input.style.setProperty("--fill", `${((value - meta.min) / (meta.max - meta.min)) * 100}%`);
    if (input === dom.controls.hue) {
      input.style.setProperty("--range-color", `hsl(${value}, 82%, 62%)`);
    } else {
      input.style.setProperty("--range-color", meta.color);
    }
  }

  function syncControls() {
    const letter = selectedLetter();
    const values = letter
      ? {
          cycle: letter.cycle,
          duty: Math.round(letter.duty * 100),
          hue: Math.round(letter.hue),
          sweep: Math.round(letter.sweep * 100),
          delay: letter.delay,
          fault: Math.round(letter.fault * 100)
        }
      : { cycle: 2, duty: 65, hue: 0, sweep: 0, delay: 0, fault: 0 };

    for (const [key, input] of Object.entries(dom.controls)) {
      input.value = values[key];
      input.disabled = !letter;
      paintRange(input, values[key], RANGE_META[key]);
    }

    dom.values.cycle.textContent = `${values.cycle.toFixed(1)} s`;
    dom.values.duty.textContent = `${values.duty}%`;
    dom.values.hue.textContent = `${values.hue}°`;
    dom.values.sweep.textContent = `${values.sweep}%`;
    dom.values.delay.textContent = `${values.delay.toFixed(2)} s`;
    dom.values.fault.textContent = `${values.fault}%`;

    if (!letter) {
      dom.selectedLetter.textContent = "—";
      dom.selectedName.textContent = "等待输入文字";
      document.documentElement.style.setProperty("--selected-hue", "#5d6572");
      return;
    }

    const char = state.text[state.selectedIndex] || "A";
    dom.selectedLetter.textContent = char;
    dom.selectedName.textContent = `字母 ${output(state.selectedIndex + 1)} · ${char}`;
    dom.selectedLetter.parentElement.style.setProperty(
      "--selected-hue",
      `hsl(${letter.hue}, 90%, 61%)`
    );
  }

  function buildLetterRail() {
    dom.letterRail.innerHTML = "";
    const slots = Math.max(5, state.letters.length);
    for (let index = 0; index < Math.min(7, slots); index += 1) {
      const letter = state.letters[index];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "letter-tab";
      button.dataset.index = String(index);
      if (letter) {
        button.style.setProperty("--tab-hue", `hsl(${letter.hue}, 90%, 62%)`);
        button.style.setProperty("--energy", "72%");
        button.innerHTML = `${state.text[index]}<span class="tab-meter"><i></i></span>`;
        button.setAttribute("aria-label", `编辑字母 ${state.text[index]}`);
        button.addEventListener("click", () => selectLetter(index));
      } else {
        button.classList.add("empty");
        button.disabled = true;
        button.textContent = "·";
      }
      if (index === state.selectedIndex && letter) {
        button.classList.add("active");
        button.setAttribute("aria-current", "true");
      }
      dom.letterRail.appendChild(button);
    }
  }

  function selectLetter(index) {
    state.selectedIndex = index;
    buildLetterRail();
    syncControls();
  }

  function syncText(nextText) {
    state.text = nextText;
    state.letters = Array.from(nextText).map((char, index) => {
      const current = state.letters[index];
      return current ? clone(current) : makeLetter(index);
    });
    if (state.letters.length === 0) {
      state.selectedIndex = -1;
    } else {
      state.selectedIndex = Math.min(Math.max(0, state.selectedIndex), state.letters.length - 1);
    }
    dom.signText.value = nextText;
    dom.letterCount.textContent = `${nextText.length} / 7`;
    dom.faultCount.textContent = output(
      state.letters.filter((letter) => letter.fault >= 0.2).length
    );
    buildLetterRail();
    buildTimeline();
    syncControls();
  }

  function getOnRuns(letter) {
    const runs = [];
    let runStart = null;
    const step = 0.025;
    for (let time = 0; time <= E.LOOP_SECONDS; time += step) {
      const local = E.positiveMod(time - letter.delay, E.LOOP_SECONDS);
      const phase = E.positiveMod(local, letter.cycle) / letter.cycle;
      const on = phase < letter.duty;
      if (on && runStart === null) {
        runStart = time;
      }
      if (!on && runStart !== null) {
        runs.push([runStart, time]);
        runStart = null;
      }
    }
    if (runStart !== null) {
      runs.push([runStart, E.LOOP_SECONDS]);
    }
    return runs;
  }

  function buildTimeline() {
    dom.timelineTracks.innerHTML = "";
    dom.timelineTracks.style.gridTemplateRows = `repeat(${Math.max(1, state.letters.length)}, 1fr)`;

    state.letters.forEach((letter, index) => {
      const row = document.createElement("div");
      row.className = "timeline-row";
      if (index === state.selectedIndex) {
        row.classList.add("active");
      }
      row.style.setProperty("--track-hue", `hsl(${letter.hue}, 90%, 62%)`);
      const label = document.createElement("span");
      label.className = "row-letter";
      label.textContent = state.text[index];
      row.appendChild(label);

      for (const [start, end] of getOnRuns(letter)) {
        const strip = document.createElement("span");
        strip.className = "tube-strip on";
        strip.style.left = `${(start / E.LOOP_SECONDS) * 100}%`;
        strip.style.width = `${Math.max(0.4, ((end - start) / E.LOOP_SECONDS) * 100)}%`;
        row.appendChild(strip);
      }
      dom.timelineTracks.appendChild(row);
    });
  }

  function setPlaying(playing) {
    state.playing = playing;
    dom.playBtn.classList.toggle("paused", !playing);
    dom.playBtn.setAttribute("aria-label", playing ? "暂停预览" : "播放预览");
    dom.playStatus.textContent = playing ? "ANIMATING" : "FRAME HELD";
    dom.frameStatus.classList.toggle("paused", !playing);
  }

  function updateTransport() {
    const progress = state.time / E.LOOP_SECONDS;
    dom.playhead.style.left = `${progress * 100}%`;
    dom.timeCode.textContent = formatTime(state.time);
    dom.timeline.setAttribute("aria-valuenow", state.time.toFixed(2));
    const ripple = Math.sin(state.time * 2.9) * 0.8 + Math.sin(state.time * 7.7) * 0.35;
    dom.voltage.textContent = `${(118.4 + ripple).toFixed(1)} V`;
  }

  function updateEnergyMeters() {
    const tabs = dom.letterRail.querySelectorAll(".letter-tab");
    state.letters.forEach((letter, index) => {
      const sample = E.sampleLetter(letter, state.time, index);
      const level = Math.round(sample.energy * 100);
      const tab = tabs[index];
      if (tab && !tab.classList.contains("empty")) {
        tab.style.setProperty("--energy", `${level}%`);
      }
      if (index === state.selectedIndex) {
        const text = dom.energyReadout.querySelector("span");
        if (text) {
          text.textContent = `${level}%`;
        }
        dom.energyReadout.style.setProperty(
          "--energy-hue",
          `hsl(${sample.hue}, 90%, 64%)`
        );
      }
    });
  }

  function updateSeek(clientX) {
    const rect = dom.timeline.getBoundingClientRect();
    const fraction = E.clamp((clientX - rect.left) / rect.width, 0, 1);
    state.time = fraction * E.LOOP_SECONDS;
    updateTransport();
    updateEnergyMeters();
  }

  function handleControlInput(key) {
    const letter = selectedLetter();
    if (!letter) {
      return;
    }
    const value = Number(dom.controls[key].value);
    if (key === "duty" || key === "sweep" || key === "fault") {
      letter[key] = value / 100;
    } else {
      letter[key] = value;
    }

    paintRange(dom.controls[key], value, RANGE_META[key]);
    const displays = {
      cycle: `${Number(value).toFixed(1)} s`,
      duty: `${Math.round(value)}%`,
      hue: `${Math.round(value)}°`,
      sweep: `${Math.round(value)}%`,
      delay: `${Number(value).toFixed(2)} s`,
      fault: `${Math.round(value)}%`
    };
    dom.values[key].textContent = displays[key];
    dom.selectedLetter.parentElement.style.setProperty(
      "--selected-hue",
      `hsl(${letter.hue}, 90%, 61%)`
    );
    dom.faultCount.textContent = output(
      state.letters.filter((item) => item.fault >= 0.2).length
    );
    buildLetterRail();
    buildTimeline();
  }

  function seekBy(delta) {
    setPlaying(false);
    state.time = E.positiveMod(state.time + delta, E.LOOP_SECONDS);
    updateTransport();
    updateEnergyMeters();
  }

  function exportFrame() {
    dom.exportBtn.disabled = true;
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = 1280;
    exportCanvas.height = 720;
    const exportContext = exportCanvas.getContext("2d", { alpha: false });
    renderer.renderScene(exportContext, 1280, 720, state);

    const finish = (blob) => {
      dom.exportBtn.disabled = false;
      if (!blob) {
        showToast("导出失败，请重试");
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `neon-frame-${state.time.toFixed(2).replace(".", "_")}s.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      showToast(`PNG 已导出 · 1280 × 720 · ${formatTime(state.time)}`);
    };

    if (exportCanvas.toBlob) {
      exportCanvas.toBlob(finish, "image/png");
    } else {
      const data = exportCanvas.toDataURL("image/png");
      finish(data ? new Blob([data], { type: "image/png" }) : null);
    }
  }

  function openHelp() {
    dom.helpDialog.hidden = false;
    dom.helpDone.focus();
  }

  function closeHelp() {
    dom.helpDialog.hidden = true;
    dom.helpBtn.focus();
  }

  function loadAcceptancePreset() {
    state.letters = [];
    state.selectedIndex = 0;
    state.time = 0;
    setPlaying(true);
    dom.signText.value = "NIGHT";
    syncText("NIGHT");
    updateTransport();
    showToast("已载入 8 秒验收节奏 · 5 个独立相位");
  }

  function restoreDefaults() {
    state.letters = Array.from(state.text).map((_, index) => makeLetter(index));
    state.time = 0;
    setPlaying(false);
    dom.faultCount.textContent = output(
      state.letters.filter((letter) => letter.fault >= 0.2).length
    );
    buildLetterRail();
    buildTimeline();
    syncControls();
    updateTransport();
    updateEnergyMeters();
    showToast("当前招牌已恢复出厂参数");
  }

  dom.playBtn.addEventListener("click", () => {
    setPlaying(!state.playing);
  });

  dom.resetBtn.addEventListener("click", () => {
    setPlaying(false);
    state.time = 0;
    updateTransport();
    updateEnergyMeters();
    showToast("已重置到 0.00 s");
  });

  dom.exportBtn.addEventListener("click", exportFrame);

  for (const key of Object.keys(dom.controls)) {
    dom.controls[key].addEventListener("input", () => handleControlInput(key));
  }

  dom.timeline.addEventListener("pointerdown", (event) => {
    scrubbing = true;
    setPlaying(false);
    dom.timeline.setPointerCapture(event.pointerId);
    updateSeek(event.clientX);
  });

  dom.timeline.addEventListener("pointermove", (event) => {
    if (scrubbing) {
      updateSeek(event.clientX);
    }
  });

  const stopScrubbing = (event) => {
    scrubbing = false;
    if (dom.timeline.hasPointerCapture(event.pointerId)) {
      dom.timeline.releasePointerCapture(event.pointerId);
    }
  };
  dom.timeline.addEventListener("pointerup", stopScrubbing);
  dom.timeline.addEventListener("pointercancel", stopScrubbing);

  dom.timeline.addEventListener("keydown", (event) => {
    const keys = {
      ArrowLeft: -0.1,
      ArrowDown: -0.1,
      ArrowRight: 0.1,
      ArrowUp: 0.1
    };
    if (event.key in keys) {
      event.preventDefault();
      seekBy(keys[event.key]);
    } else if (event.key === "Home") {
      event.preventDefault();
      setPlaying(false);
      state.time = 0;
      updateTransport();
    } else if (event.key === "End") {
      event.preventDefault();
      setPlaying(false);
      state.time = E.LOOP_SECONDS - 0.01;
      updateTransport();
    }
  });

  let composing = false;
  dom.signText.addEventListener("compositionstart", () => {
    composing = true;
  });
  dom.signText.addEventListener("compositionend", () => {
    composing = false;
    syncText(dom.signText.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 7));
  });
  dom.signText.addEventListener("input", () => {
    if (composing) {
      return;
    }
    const next = dom.signText.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 7);
    syncText(next);
  });

  dom.presetBtn.addEventListener("click", loadAcceptancePreset);
  dom.restoreBtn.addEventListener("click", restoreDefaults);
  dom.helpBtn.addEventListener("click", openHelp);
  dom.helpClose.addEventListener("click", closeHelp);
  dom.helpDone.addEventListener("click", closeHelp);
  dom.helpDialog.addEventListener("click", (event) => {
    if (event.target === dom.helpDialog) {
      closeHelp();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !dom.helpDialog.hidden) {
      closeHelp();
      return;
    }
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("input, textarea, button")) {
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      setPlaying(!state.playing);
    }
  });

  function frame(now) {
    const delta = Math.min(0.06, (now - state.lastTimestamp) / 1000 || 0);
    state.lastTimestamp = now;
    if (state.playing) {
      state.time = E.positiveMod(state.time + delta, E.LOOP_SECONDS);
    }
    renderer.render(state);

    if (now - state.lastUiUpdate > 70) {
      updateTransport();
      updateEnergyMeters();
      state.lastUiUpdate = now;
    }
    window.requestAnimationFrame(frame);
  }

  if ("ResizeObserver" in window) {
    const resizeObserver = new ResizeObserver(() => renderer.resize());
    resizeObserver.observe(dom.canvasWrap);
  } else {
    window.addEventListener("resize", () => renderer.resize());
  }

  dom.signText.value = state.text;
  syncText(state.text);
  setPlaying(true);
  updateTransport();
  renderer.resize();
  window.requestAnimationFrame(frame);
  window.setTimeout(() => dom.bootScreen.classList.add("hide"), 720);
  window.setTimeout(() => dom.bootScreen.remove(), 1300);
})();
