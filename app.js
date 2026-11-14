(() => {
  "use strict";

  const DURATION = 12;
  const STORAGE_KEY = "paper-theatre-project-v1";
  const TAU = Math.PI * 2;

  const LAYER_PRESETS = {
    tree: {
      name: "树",
      english: "THE TREE",
      color: "#708b73",
      depth: 2,
      anchor: { x: 345, y: 545 },
      caption: "月升之前，纸树先醒。",
      icon: '<path d="M12 22V8m0 5-4-4m4 7 4-5M6 10c0-3 2-5 5-6V2h2v2c3 1 5 3 5 6 0 3-2 5-5 5-3 0-5-2-5-5Z"/>',
    },
    moon: {
      name: "月亮",
      english: "THE MOON",
      color: "#d7a84f",
      depth: 1,
      anchor: { x: 788, y: 192 },
      caption: "一枚月亮，从纸缝里升起。",
      icon: '<path d="M16.5 3.2A9.2 9.2 0 1 0 21 15.8a7.4 7.4 0 0 1-4.5-12.6Z"/>',
    },
    boat: {
      name: "纸船",
      english: "PAPER BOAT",
      color: "#d36f58",
      depth: 3,
      anchor: { x: 710, y: 531 },
      caption: "纸船渡水，带走一小片夜色。",
      icon: '<path d="m2 14 4 6h12l4-6H2Zm4-1 6-9 6 9H6Zm7-8v8"/>',
    },
    figure: {
      name: "小人",
      english: "THE CHILD",
      color: "#d0a471",
      depth: 4,
      anchor: { x: 532, y: 557 },
      caption: "小人抬头，把星光收进口袋。",
      icon: '<path d="M10 6a2.2 2.2 0 1 0 0-4.4A2.2 2.2 0 0 0 10 6Zm-3 3h6l1.2 7H14l-.5 8h-2l-.4-5h-2.2l-.4 5h-2L6.5 16H5.2L6.4 9H7Z"/>',
    },
  };

  const DEFAULT_LAYERS = [
    { id: "tree", depth: 2, angle: 8, lift: 96, shift: 0, start: 0.4, duration: 2.3, maskIn: 0.4, maskOut: 10.8 },
    { id: "moon", depth: 1, angle: 5, lift: 82, shift: 0, start: 2.7, duration: 2.1, maskIn: 2.7, maskOut: 11.8 },
    { id: "boat", depth: 3, angle: 11, lift: 66, shift: 0, start: 5.1, duration: 2.3, maskIn: 5.1, maskOut: 11.5 },
    { id: "figure", depth: 4, angle: 6, lift: 48, shift: 0, start: 7.8, duration: 2.1, maskIn: 7.8, maskOut: 12 },
  ];

  const $ = (selector) => document.querySelector(selector);
  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const lerp = (from, to, amount) => from + (to - from) * amount;
  const easeInOutCubic = (value) => (value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2);
  const round = (value, places = 1) => Number(value.toFixed(places));
  const pad = (value) => String(value).padStart(2, "0");

  function createDefaultProject() {
    return {
      version: 1,
      title: "月升之前",
      duration: DURATION,
      playhead: 0,
      loop: true,
      sound: true,
      layers: DEFAULT_LAYERS.map((layer) => ({ ...layer })),
    };
  }

  function normalizeProject(candidate) {
    if (!candidate || !Array.isArray(candidate.layers)) return null;
    const known = new Set(Object.keys(LAYER_PRESETS));
    const layers = candidate.layers
      .filter((layer) => layer && known.has(layer.id))
      .map((layer) => {
        const start = clamp(Number(layer.start) || 0, 0, 11.6);
        const duration = clamp(Number(layer.duration) || 2.1, 0.4, Math.min(6, DURATION - start));
        const maskIn = clamp(Number(layer.maskIn) || 0, 0, 11.8);
        const maskOut = clamp(Number(layer.maskOut) || 12, maskIn + 0.2, 12);
        return {
          id: layer.id,
          depth: clamp(Number(layer.depth) || LAYER_PRESETS[layer.id].depth, 1, 4),
          angle: clamp(Number(layer.angle) || 0, 0, 45),
          lift: clamp(Number(layer.lift) || 0, 0, 180),
          shift: clamp(Number(layer.shift) || 0, -160, 160),
          start,
          duration,
          maskIn,
          maskOut,
        };
      });
    if (layers.length !== Object.keys(LAYER_PRESETS).length) return null;
    const usedDepths = new Set();
    layers.forEach((layer) => {
      let depth = Math.round(layer.depth);
      while (usedDepths.has(depth)) depth = (depth % 4) + 1;
      layer.depth = depth;
      usedDepths.add(depth);
    });
    return {
      version: 1,
      title: String(candidate.title || "月升之前").slice(0, 22),
      duration: DURATION,
      playhead: clamp(Number(candidate.playhead) || 0, 0, DURATION),
      loop: candidate.loop !== false,
      sound: candidate.sound !== false,
      layers,
    };
  }

  function loadSavedProject() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? normalizeProject(JSON.parse(saved)) : null;
    } catch {
      return null;
    }
  }

  const savedProject = loadSavedProject();
  const state = {
    project: savedProject || createDefaultProject(),
    selectedId: "tree",
    playing: false,
    time: savedProject ? savedProject.playhead : 0,
    lastFrame: 0,
    soundMuted: false,
    guides: true,
    scrubWasPlaying: false,
    interactionHappened: false,
    autoplayTimer: 0,
  };
  state.soundMuted = !state.project.sound;

  const canvas = $("#stageCanvas");
  const ctx = canvas.getContext("2d");
  const dom = {
    projectName: $("#projectName"),
    layerList: $("#layerList"),
    layerCount: $("#layerCount"),
    inspector: $("#inspector"),
    selectedSwatch: $("#selectedSwatch"),
    selectedName: $("#selectedName"),
    depthTag: $("#depthTag"),
    angleInput: $("#angleInput"),
    angleValue: $("#angleValue"),
    liftInput: $("#liftInput"),
    liftValue: $("#liftValue"),
    shiftInput: $("#shiftInput"),
    shiftValue: $("#shiftValue"),
    maskIn: $("#maskInInput"),
    maskOut: $("#maskOutInput"),
    maskFill: $("#maskFill"),
    maskValue: $("#maskValue"),
    startInput: $("#startInput"),
    durationInput: $("#durationInput"),
    playBtn: $("#playBtn"),
    centerPlay: $("#centerPlay"),
    currentTime: $("#currentTime"),
    playhead: $("#playhead"),
    playheadTime: $("#playheadTime"),
    trackRows: $("#trackRows"),
    trackLabels: $("#trackLabels"),
    trackField: $("#trackField"),
    ruler: $("#ruler"),
    timelineScroll: $("#timelineScroll"),
    stageStatus: $("#stageStatus"),
    statusDot: $("#statusDot"),
    stageCaption: $("#stageCaption"),
    loopBtn: $("#loopBtn"),
    soundToggle: $("#soundToggle"),
    soundLabel: $("#soundLabel"),
    audioBtn: $("#audioBtn"),
    guidesBtn: $("#guidesBtn"),
    stageFrame: $(".stage-frame"),
    stageWrap: $("#stageWrap"),
    backBtn: $("#backBtn"),
    saveBtn: $("#saveBtn"),
    importBtn: $("#importBtn"),
    fileInput: $("#fileInput"),
    toast: $("#toast"),
  };

  let toastTimer = 0;
  let saveTimer = 0;

  function getLayer(id = state.selectedId) {
    return state.project.layers.find((layer) => layer.id === id);
  }

  function layerMeta(layer) {
    return LAYER_PRESETS[layer.id];
  }

  function formatTime(seconds, withTenths = true) {
    const safe = Math.max(0, Math.min(DURATION, seconds));
    const minutes = Math.floor(safe / 60);
    const wholeSeconds = Math.floor(safe % 60);
    return withTenths
      ? `${pad(minutes)}:${pad(wholeSeconds)}.${Math.floor((safe % 1) * 10)}`
      : `${minutes}:${pad(wholeSeconds)}`;
  }

  function showToast(message) {
    dom.toast.textContent = message;
    dom.toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => dom.toast.classList.remove("is-visible"), 2600);
  }

  function scheduleAutoSave() {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => persistProject(false), 420);
  }

  function unfoldProgress(layer, time = state.time) {
    if (time <= layer.start) return 0;
    return easeInOutCubic(clamp((time - layer.start) / layer.duration));
  }

  function maskOpacity(layer, time = state.time) {
    if (time < layer.maskIn || time > layer.maskOut) return 0;
    const fadeIn = clamp((time - layer.maskIn) / 0.24);
    const fadeOut = clamp((layer.maskOut - time) / 0.24);
    return Math.min(fadeIn, fadeOut);
  }

  function orderedLayers() {
    return [...state.project.layers].sort((a, b) => a.depth - b.depth);
  }

  function chronologicalLayers() {
    return [...state.project.layers].sort((a, b) => a.start - b.start || a.depth - b.depth);
  }

  function currentCaption(time = state.time) {
    if (time >= 11.82) return "十二秒结束，故事还在纸里。";
    if (time < chronologicalLayers()[0].start) return "纸片屏住呼吸，等待第一束光。";
    const started = chronologicalLayers().filter((layer) => time >= layer.start);
    return started.length ? layerMeta(started[started.length - 1]).caption : "纸片屏住呼吸，等待第一束光。";
  }

  function renderLayerList() {
    const layers = chronologicalLayers();
    dom.layerCount.textContent = `${layers.length} 层`;
    dom.layerList.innerHTML = layers
      .map((layer) => {
        const meta = layerMeta(layer);
        const progress = unfoldProgress(layer);
        return `
          <button class="layer-item${layer.id === state.selectedId ? " is-selected" : ""}"
            type="button" data-layer-id="${layer.id}" aria-pressed="${layer.id === state.selectedId}"
            style="--thumb-color:${meta.color}">
            <span class="layer-thumb">
              <svg viewBox="0 0 24 24" aria-hidden="true">${meta.icon}</svg>
            </span>
            <span class="layer-meta">
              <strong>${meta.name}</strong>
              <span>${formatTime(layer.start)} — ${formatTime(layer.start + layer.duration)}</span>
            </span>
            <span class="layer-index">
              <b>D${layer.depth}</b>
              <i style="width:${Math.max(4, Math.round(8 + progress * 12))}px"></i>
            </span>
          </button>`;
      })
      .join("");
  }

  function buildRuler() {
    const ticks = [];
    for (let step = 0; step <= DURATION * 2; step += 1) {
      const seconds = step / 2;
      const left = (seconds / DURATION) * 100;
      const major = step % 2 === 0;
      ticks.push(`<span class="ruler-tick${major ? " is-major" : ""}" style="left:${left}%"></span>`);
      if (major) {
        ticks.push(`<span class="ruler-label" style="left:${left}%">${seconds === 0 ? "0s" : `${seconds}s`}</span>`);
      }
    }
    dom.ruler.innerHTML = ticks.join("");
  }

  function renderTimeline() {
    const layers = chronologicalLayers();
    dom.trackLabels.innerHTML = layers
      .map((layer) => {
        const meta = layerMeta(layer);
        return `
          <button class="track-label${layer.id === state.selectedId ? " is-selected" : ""}"
            type="button" data-layer-id="${layer.id}" style="--track-color:${meta.color}">
            <i></i><span>${meta.name}</span><em>D${layer.depth}</em>
          </button>`;
      })
      .join("");

    dom.trackRows.innerHTML = layers
      .map((layer) => {
        const meta = layerMeta(layer);
        const left = (layer.start / DURATION) * 100;
        const width = (layer.duration / DURATION) * 100;
        const maskLeft = (layer.maskIn / DURATION) * 100;
        const maskWidth = ((layer.maskOut - layer.maskIn) / DURATION) * 100;
        return `
          <div class="track-row${layer.id === state.selectedId ? " is-selected" : ""}"
            data-layer-id="${layer.id}" style="--clip-color:${meta.color}">
            <span class="mask-zone" style="left:${maskLeft}%;width:${maskWidth}%"></span>
            <div class="clip-block${layer.id === state.selectedId ? " is-selected" : ""}"
              data-clip-id="${layer.id}" style="left:${left}%;width:${width}%"
              title="拖动调整开始时间">
              <span class="clip-label">${meta.name} · ${round(layer.duration, 1)}s</span>
            </div>
          </div>`;
      })
      .join("");
  }

  function setRangeProgress(input) {
    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    input.style.setProperty("--range-progress", `${((value - min) / (max - min)) * 100}%`);
  }

  function syncInspector() {
    const layer = getLayer();
    if (!layer) return;
    const meta = layerMeta(layer);
    dom.selectedSwatch.style.background = meta.color;
    dom.selectedName.textContent = `${meta.name} · ${meta.english}`;
    dom.depthTag.textContent = `D${layer.depth}`;
    dom.depthTag.title = `点击切换深度 · ${layer.depth === 1 ? "最远" : layer.depth === 4 ? "最近" : `第 ${layer.depth} 层`}`;
    dom.angleInput.value = layer.angle;
    dom.liftInput.value = layer.lift;
    dom.shiftInput.value = layer.shift;
    dom.maskIn.value = layer.maskIn;
    dom.maskOut.value = layer.maskOut;
    dom.startInput.value = round(layer.start, 1);
    dom.durationInput.value = round(layer.duration, 1);
    dom.angleValue.value = `${layer.angle}°`;
    dom.liftValue.value = `${layer.lift} px`;
    dom.shiftValue.value = `${layer.shift > 0 ? "+" : ""}${layer.shift} px`;
    dom.maskValue.value = `${round(layer.maskIn, 1).toFixed(1)} – ${round(layer.maskOut, 1).toFixed(1)} s`;
    dom.maskFill.style.left = `${(layer.maskIn / DURATION) * 100}%`;
    dom.maskFill.style.width = `${((layer.maskOut - layer.maskIn) / DURATION) * 100}%`;
    [dom.angleInput, dom.liftInput, dom.shiftInput].forEach(setRangeProgress);
    dom.maskIn.style.zIndex = layer.maskIn > DURATION - 1.2 ? 3 : 2;
    dom.maskOut.style.zIndex = 2;
  }

  function syncTransport() {
    const isPlaying = state.playing;
    dom.playBtn.classList.toggle("is-playing", isPlaying);
    dom.playBtn.setAttribute("aria-label", isPlaying ? "暂停" : "播放");
    dom.centerPlay.setAttribute("aria-label", isPlaying ? "暂停" : "播放");
    dom.statusDot.classList.toggle("is-playing", isPlaying);
    dom.currentTime.textContent = formatTime(state.time);
    dom.playheadTime.textContent = formatTime(state.time);
    dom.playhead.style.setProperty("--playhead-x", `${(state.time / DURATION) * dom.trackField.clientWidth}px`);
    dom.stageCaption.textContent = currentCaption();
    dom.loopBtn.classList.toggle("is-on", state.project.loop);
    dom.loopBtn.setAttribute("aria-pressed", String(state.project.loop));
    dom.soundToggle.setAttribute("aria-pressed", String(!state.soundMuted));
    dom.soundToggle.classList.toggle("is-muted", state.soundMuted);
    dom.audioBtn.setAttribute("aria-pressed", String(!state.soundMuted));
    dom.soundLabel.textContent = state.soundMuted ? "纸声关闭" : "纸声开启";
    dom.guidesBtn.setAttribute("aria-pressed", String(state.guides));
    if (isPlaying) {
      dom.stageStatus.textContent = currentCaption();
    } else if (state.time >= DURATION - 0.01) {
      dom.stageStatus.textContent = state.project.loop ? "演出完成 · 即将循环" : "演出完成 · 12.0s";
    } else if (state.interactionHappened) {
      dom.stageStatus.textContent = `定格预览 · ${formatTime(state.time)}`;
    } else {
      dom.stageStatus.textContent = "待播放 · 所有纸片已就位";
    }
  }

  function renderAll() {
    dom.projectName.value = state.project.title;
    renderLayerList();
    syncInspector();
    renderTimeline();
    syncTransport();
  }

  const SCENE_WIDTH = 1100;
  const SCENE_HEIGHT = 682;
  let grainPattern = null;

  function hexToRgba(hex, alpha) {
    const value = hex.replace("#", "");
    const full = value.length === 3 ? value.split("").map((char) => char + char).join("") : value;
    const number = Number.parseInt(full, 16);
    return `rgba(${(number >> 16) & 255},${(number >> 8) & 255},${number & 255},${alpha})`;
  }

  function seededRandom(seed) {
    let value = seed >>> 0;
    return () => {
      value += 0x6d2b79f5;
      let mixed = value;
      mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
      mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
  }

  const starRandom = seededRandom(147);
  const stars = Array.from({ length: 52 }, () => ({
    x: 74 + starRandom() * 950,
    y: 62 + starRandom() * 330,
    radius: 0.7 + starRandom() * 1.4,
    alpha: 0.2 + starRandom() * 0.5,
  }));

  function createGrainPattern() {
    const grain = document.createElement("canvas");
    grain.width = 160;
    grain.height = 160;
    const grainCtx = grain.getContext("2d");
    const image = grainCtx.createImageData(160, 160);
    const random = seededRandom(1207);
    for (let index = 0; index < image.data.length; index += 4) {
      const tone = 110 + Math.floor(random() * 100);
      image.data[index] = tone;
      image.data[index + 1] = tone;
      image.data[index + 2] = tone;
      image.data[index + 3] = Math.floor(random() * 35);
    }
    grainCtx.putImageData(image, 0, 0);
    grainPattern = ctx.createPattern(grain, "repeat");
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
  }

  function fitStage() {
    const frameStyle = window.getComputedStyle(dom.stageFrame);
    const availableWidth =
      dom.stageFrame.clientWidth -
      Number.parseFloat(frameStyle.paddingLeft) -
      Number.parseFloat(frameStyle.paddingRight);
    const availableHeight =
      dom.stageFrame.clientHeight -
      Number.parseFloat(frameStyle.paddingTop) -
      Number.parseFloat(frameStyle.paddingBottom);
    const sceneRatio = SCENE_WIDTH / SCENE_HEIGHT;
    const width = Math.max(1, Math.min(availableWidth, 1040, availableHeight * sceneRatio));
    const height = width / sceneRatio;
    dom.stageWrap.style.width = `${width}px`;
    dom.stageWrap.style.height = `${height}px`;
  }

  function drawBackground(time) {
    const sky = ctx.createLinearGradient(0, 0, 0, SCENE_HEIGHT);
    sky.addColorStop(0, "#0f1d1e");
    sky.addColorStop(0.42, "#233a38");
    sky.addColorStop(0.7, "#465449");
    sky.addColorStop(1, "#202f2a");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, SCENE_WIDTH, SCENE_HEIGHT);

    const halo = ctx.createRadialGradient(788, 194, 8, 788, 194, 235);
    halo.addColorStop(0, "rgba(231, 179, 92, 0.25)");
    halo.addColorStop(0.35, "rgba(220, 163, 82, 0.09)");
    halo.addColorStop(1, "rgba(220, 163, 82, 0)");
    ctx.fillStyle = halo;
    ctx.fillRect(520, 0, 520, 470);

    ctx.save();
    stars.forEach((star, index) => {
      const shimmer = 0.72 + Math.sin(time * 0.9 + index * 1.77) * 0.28;
      ctx.globalAlpha = star.alpha * shimmer;
      ctx.fillStyle = "#f1e7cf";
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.radius, 0, TAU);
      ctx.fill();
    });
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(239, 226, 195, 0.16)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 9]);
    ctx.beginPath();
    ctx.moveTo(110, 285);
    ctx.bezierCurveTo(240, 278, 310, 286, 390, 282);
    ctx.moveTo(742, 305);
    ctx.bezierCurveTo(812, 298, 860, 306, 940, 297);
    ctx.stroke();
    ctx.restore();
  }

  function drawMountains() {
    ctx.save();
    ctx.fillStyle = "#5d6d5e";
    ctx.shadowColor = "rgba(7, 15, 13, 0.3)";
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 7;
    ctx.beginPath();
    ctx.moveTo(0, 474);
    ctx.lineTo(98, 396);
    ctx.lineTo(153, 430);
    ctx.lineTo(242, 340);
    ctx.lineTo(318, 425);
    ctx.lineTo(418, 365);
    ctx.lineTo(538, 474);
    ctx.lineTo(617, 414);
    ctx.lineTo(711, 462);
    ctx.lineTo(804, 383);
    ctx.lineTo(909, 447);
    ctx.lineTo(1007, 373);
    ctx.lineTo(1100, 447);
    ctx.lineTo(1100, 586);
    ctx.lineTo(0, 586);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#394f45";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(0, 532);
    ctx.bezierCurveTo(115, 452, 178, 504, 278, 456);
    ctx.bezierCurveTo(393, 400, 452, 493, 570, 458);
    ctx.bezierCurveTo(688, 424, 780, 485, 901, 443);
    ctx.bezierCurveTo(986, 414, 1042, 450, 1100, 431);
    ctx.lineTo(1100, 600);
    ctx.lineTo(0, 600);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#263d35";
    ctx.shadowBlur = 13;
    ctx.beginPath();
    ctx.moveTo(0, 565);
    ctx.bezierCurveTo(148, 501, 262, 542, 378, 516);
    ctx.bezierCurveTo(529, 481, 632, 534, 791, 506);
    ctx.bezierCurveTo(925, 483, 1021, 510, 1100, 491);
    ctx.lineTo(1100, 620);
    ctx.lineTo(0, 620);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "#1d302b";
    ctx.beginPath();
    ctx.moveTo(0, 595);
    ctx.bezierCurveTo(110, 570, 210, 602, 327, 579);
    ctx.bezierCurveTo(480, 548, 588, 596, 736, 575);
    ctx.bezierCurveTo(872, 556, 973, 585, 1100, 559);
    ctx.lineTo(1100, 682);
    ctx.lineTo(0, 682);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawWater(time) {
    ctx.save();
    ctx.globalAlpha = 0.26;
    ctx.strokeStyle = "#b8b485";
    ctx.lineWidth = 1;
    for (let line = 0; line < 12; line += 1) {
      const y = 560 + line * 7;
      const sway = Math.sin(time * 0.45 + line) * 8;
      ctx.beginPath();
      ctx.moveTo(555 + sway, y);
      ctx.bezierCurveTo(675, y - 4, 768, y + 5, 890 + sway * 0.4, y - 1);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawMoon() {
    const gradient = ctx.createLinearGradient(-76, -85, 58, 96);
    gradient.addColorStop(0, "#f2d58e");
    gradient.addColorStop(0.58, "#e3b95f");
    gradient.addColorStop(1, "#bd8539");
    ctx.save();
    ctx.shadowColor = "rgba(197, 138, 54, 0.55)";
    ctx.shadowBlur = 30;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(34, -82);
    ctx.bezierCurveTo(-20, -88, -80, -44, -81, 18);
    ctx.bezierCurveTo(-81, 73, -36, 109, 22, 105);
    ctx.bezierCurveTo(-5, 79, -18, 44, -10, 7);
    ctx.bezierCurveTo(-1, -34, 25, -64, 34, -82);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255, 239, 187, 0.58)";
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.fillStyle = "rgba(130, 82, 31, 0.3)";
    const craters = [
      [-44, -29, 9],
      [-57, 8, 5],
      [-38, 42, 7],
      [-54, 66, 3],
    ];
    craters.forEach(([x, y, radius]) => {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, TAU);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawTree(time) {
    const sway = Math.sin(time * 0.7) * 1.1;
    ctx.save();
    ctx.translate(sway, 0);

    ctx.shadowColor = "rgba(10, 19, 15, 0.42)";
    ctx.shadowBlur = 16;
    ctx.shadowOffsetX = 9;
    ctx.shadowOffsetY = 12;
    ctx.fillStyle = "#405d4d";
    ctx.beginPath();
    ctx.moveTo(-12, 3);
    ctx.bezierCurveTo(-7, -63, -16, -130, -9, -194);
    ctx.lineTo(-32, -190);
    ctx.lineTo(-24, -210);
    ctx.lineTo(-3, -201);
    ctx.lineTo(0, -249);
    ctx.lineTo(8, -200);
    ctx.lineTo(31, -217);
    ctx.lineTo(38, -195);
    ctx.lineTo(15, -190);
    ctx.bezierCurveTo(23, -126, 11, -59, 17, 3);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#314b3e";
    ctx.beginPath();
    ctx.moveTo(-7, 1);
    ctx.bezierCurveTo(-15, -42, 3, -67, -21, -102);
    ctx.lineTo(-7, -100);
    ctx.bezierCurveTo(5, -74, -3, -44, 5, 1);
    ctx.closePath();
    ctx.fill();

    const crown = ctx.createLinearGradient(-100, -390, 108, -185);
    crown.addColorStop(0, "#819479");
    crown.addColorStop(0.52, "#688267");
    crown.addColorStop(1, "#506c5b");
    ctx.fillStyle = crown;
    ctx.beginPath();
    ctx.moveTo(-2, -188);
    ctx.bezierCurveTo(-73, -189, -142, -233, -133, -285);
    ctx.bezierCurveTo(-167, -324, -129, -374, -78, -362);
    ctx.bezierCurveTo(-54, -415, 22, -428, 55, -381);
    ctx.bezierCurveTo(104, -407, 163, -365, 141, -313);
    ctx.bezierCurveTo(178, -271, 141, -223, 91, -221);
    ctx.bezierCurveTo(66, -187, 24, -178, -2, -188);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(223, 230, 198, 0.32)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.globalAlpha = 0.38;
    ctx.fillStyle = "#3f5b4b";
    const cuts = [
      [-103, -295, 14, 5, -0.5],
      [-55, -329, 8, 3, 0.4],
      [30, -348, 12, 4, -0.35],
      [83, -310, 9, 4, 0.2],
      [53, -253, 16, 4, -0.4],
      [-53, -253, 12, 3, 0.25],
    ];
    cuts.forEach(([x, y, rx, ry, rotation]) => {
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, rotation, 0, TAU);
      ctx.fill();
    });

    ctx.globalAlpha = 0.62;
    ctx.fillStyle = "#9cac88";
    [
      [-68, -210, 12, 7],
      [51, -221, 13, 7],
      [99, -276, 10, 6],
      [-109, -323, 9, 6],
    ].forEach(([x, y, rx, ry]) => {
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, -0.3, 0, TAU);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawBoat(time) {
    const bob = Math.sin(time * 1.25 + 1.1) * 2.2;
    ctx.save();
    ctx.translate(0, bob);
    ctx.shadowColor = "rgba(8, 17, 14, 0.4)";
    ctx.shadowBlur = 15;
    ctx.shadowOffsetX = 7;
    ctx.shadowOffsetY = 11;

    ctx.fillStyle = "#ecd9b2";
    ctx.beginPath();
    ctx.moveTo(-110, -17);
    ctx.lineTo(103, -17);
    ctx.lineTo(64, 42);
    ctx.lineTo(-60, 42);
    ctx.closePath();
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = "#d7b57f";
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(103, -17);
    ctx.lineTo(64, 42);
    ctx.lineTo(4, 25);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#c87355";
    ctx.beginPath();
    ctx.moveTo(-110, -17);
    ctx.lineTo(-73, 8);
    ctx.lineTo(-57, 42);
    ctx.lineTo(-60, 42);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#efdfbb";
    ctx.beginPath();
    ctx.moveTo(-6, -179);
    ctx.lineTo(-94, -13);
    ctx.lineTo(-5, -11);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#e6c386";
    ctx.beginPath();
    ctx.moveTo(-1, -143);
    ctx.lineTo(82, -13);
    ctx.lineTo(1, -11);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(86, 65, 39, 0.4)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-6, -174);
    ctx.lineTo(-6, -11);
    ctx.moveTo(1, -137);
    ctx.lineTo(1, -11);
    ctx.stroke();

    ctx.fillStyle = "#364f44";
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(1, -136);
    ctx.lineTo(3, -11);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = "#d2c294";
    ctx.lineWidth = 1;
    for (let index = 0; index < 3; index += 1) {
      ctx.beginPath();
      ctx.moveTo(-90 + index * 8, 27 + index * 4);
      ctx.lineTo(55 - index * 7, 27 + index * 4);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawFigure(time) {
    ctx.save();
    ctx.shadowColor = "rgba(10, 18, 14, 0.46)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 7;
    ctx.shadowOffsetY = 8;

    ctx.fillStyle = "#233630";
    ctx.beginPath();
    ctx.moveTo(-13, -51);
    ctx.bezierCurveTo(-17, -26, -21, -8, -20, 0);
    ctx.lineTo(-7, 0);
    ctx.lineTo(-4, -37);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(12, -51);
    ctx.bezierCurveTo(14, -28, 19, -10, 23, 0);
    ctx.lineTo(10, 0);
    ctx.lineTo(5, -38);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#c88b64";
    ctx.beginPath();
    ctx.moveTo(-20, -112);
    ctx.bezierCurveTo(-37, -92, -40, -62, -26, -53);
    ctx.lineTo(-5, -65);
    ctx.lineTo(1, -111);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#d4a45e";
    ctx.beginPath();
    ctx.moveTo(-13, -119);
    ctx.lineTo(12, -119);
    ctx.lineTo(20, -59);
    ctx.lineTo(7, -45);
    ctx.lineTo(-11, -45);
    ctx.lineTo(-21, -60);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = "#e9cc96";
    ctx.beginPath();
    ctx.moveTo(-15, -114);
    ctx.lineTo(-27, -95);
    ctx.lineTo(-29, -61);
    ctx.lineTo(-14, -64);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#2d4038";
    ctx.beginPath();
    ctx.moveTo(-10, -113);
    ctx.lineTo(11, -113);
    ctx.lineTo(14, -103);
    ctx.lineTo(-13, -103);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#d8ad70";
    ctx.beginPath();
    ctx.ellipse(0, -135, 17, 20, -0.08, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#28382f";
    ctx.beginPath();
    ctx.ellipse(-2, -143, 17, 12, -0.16, Math.PI, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-11, -145, 5, 0, TAU);
    ctx.fill();

    ctx.fillStyle = "#d7ad70";
    ctx.beginPath();
    ctx.moveTo(-16, -104);
    ctx.lineTo(18, -104);
    ctx.lineTo(28, -91);
    ctx.lineTo(23, -84);
    ctx.lineTo(10, -93);
    ctx.lineTo(-14, -94);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#ece2c8";
    ctx.beginPath();
    ctx.moveTo(-16, -153);
    ctx.lineTo(6, -151);
    ctx.lineTo(4, -166);
    ctx.lineTo(-6, -168);
    ctx.lineTo(-20, -163);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#253932";
    ctx.beginPath();
    ctx.moveTo(-13, -51);
    ctx.lineTo(-20, 0);
    ctx.lineTo(-9, 0);
    ctx.lineTo(-4, -38);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "#a56f52";
    ctx.beginPath();
    ctx.moveTo(-18, -72);
    ctx.lineTo(-9, -70);
    ctx.lineTo(-10, -55);
    ctx.lineTo(-20, -57);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawFigureLight(time) {
    const handX = 31;
    const handY = -111;
    const glow = 0.44 + Math.sin(time * 1.8) * 0.12;
    const halo = ctx.createRadialGradient(handX, handY - 16, 0, handX, handY - 16, 26);
    halo.addColorStop(0, `rgba(244, 207, 124, ${glow})`);
    halo.addColorStop(1, "rgba(244, 207, 124, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(handX, handY - 16, 29, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(226, 195, 127, 0.62)";
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(handX, handY);
    ctx.lineTo(handX + 2, handY - 8);
    ctx.stroke();
    ctx.fillStyle = "#f2d58a";
    ctx.beginPath();
    ctx.arc(handX + 2, handY - 16, 3.2, 0, TAU);
    ctx.fill();
  }

  function drawForeground() {
    ctx.save();
    ctx.fillStyle = "#172723";
    ctx.shadowColor = "rgba(4, 10, 8, 0.36)";
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = -5;
    ctx.beginPath();
    ctx.moveTo(0, 642);
    ctx.bezierCurveTo(142, 610, 238, 650, 356, 626);
    ctx.bezierCurveTo(487, 600, 611, 648, 763, 622);
    ctx.bezierCurveTo(885, 603, 979, 633, 1100, 612);
    ctx.lineTo(1100, 682);
    ctx.lineTo(0, 682);
    ctx.closePath();
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#263a32";
    ctx.lineWidth = 2.1;
    const grassRandom = seededRandom(905);
    for (let index = 0; index < 26; index += 1) {
      const x = grassRandom() * 1100;
      const y = 638 + grassRandom() * 32;
      const height = 11 + grassRandom() * 34;
      const lean = (grassRandom() - 0.5) * 16;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + lean * 0.3, y - height * 0.62, x + lean, y - height);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawFrame() {
    ctx.save();
    ctx.fillStyle = "#172521";
    ctx.fillRect(0, 0, SCENE_WIDTH, 17);
    ctx.fillRect(0, SCENE_HEIGHT - 15, SCENE_WIDTH, 15);
    ctx.fillRect(0, 0, 17, SCENE_HEIGHT);
    ctx.fillRect(SCENE_WIDTH - 17, 0, 17, SCENE_HEIGHT);

    ctx.strokeStyle = "rgba(215, 168, 79, 0.45)";
    ctx.lineWidth = 1;
    ctx.strokeRect(28, 28, SCENE_WIDTH - 56, SCENE_HEIGHT - 56);

    ctx.fillStyle = "#21332c";
    ctx.strokeStyle = "rgba(220, 190, 126, 0.23)";
    ctx.lineWidth = 1;
    [-1, 1].forEach((direction) => {
      for (let leaf = 0; leaf < 6; leaf += 1) {
        const x = direction < 0 ? 38 + leaf * 15 : SCENE_WIDTH - 38 - leaf * 15;
        const y = 8 + leaf * 6;
        ctx.beginPath();
        ctx.ellipse(x, y + 11, 8, 4, direction * (0.6 + leaf * 0.14), 0, TAU);
        ctx.fill();
        ctx.stroke();
      }
    });

    ctx.fillStyle = "#d6a54f";
    [171, 927].forEach((x) => {
      ctx.beginPath();
      ctx.arc(x, 17, 2.5, 0, TAU);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawGuides() {
    ctx.save();
    ctx.strokeStyle = "rgba(241, 232, 207, 0.12)";
    ctx.lineWidth = 0.75;
    ctx.setLineDash([4, 7]);
    ctx.strokeRect(46, 46, SCENE_WIDTH - 92, SCENE_HEIGHT - 92);
    ctx.setLineDash([2, 8]);
    ctx.beginPath();
    ctx.moveTo(SCENE_WIDTH / 3, 46);
    ctx.lineTo(SCENE_WIDTH / 3, SCENE_HEIGHT - 46);
    ctx.moveTo((SCENE_WIDTH / 3) * 2, 46);
    ctx.lineTo((SCENE_WIDTH / 3) * 2, SCENE_HEIGHT - 46);
    ctx.stroke();
    ctx.restore();
  }

  const layerDrawers = {
    moon: drawMoon,
    tree: drawTree,
    boat: drawBoat,
    figure: (time) => {
      drawFigure(time);
      drawFigureLight(time);
    },
  };

  function drawPaperLayer(layer, time) {
    const opacity = maskOpacity(layer, time);
    if (opacity <= 0.001) return;
    const progress = unfoldProgress(layer, time);
    const meta = layerMeta(layer);
    const angle = lerp(88, layer.angle, progress);
    const radians = (angle * Math.PI) / 180;
    const verticalScale = Math.max(0.018, Math.cos(radians));
    const shear = Math.sin(radians) * 0.075;

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.translate(
      meta.anchor.x + layer.shift * progress,
      meta.anchor.y + layer.lift * (1 - progress),
    );
    ctx.transform(1, 0, shear, verticalScale, 0, 0);
    layerDrawers[layer.id](time);
    ctx.restore();
  }

  function drawScene() {
    if (!canvas.width || !canvas.height) return;
    if (!grainPattern) createGrainPattern();
    ctx.setTransform(canvas.width / SCENE_WIDTH, 0, 0, canvas.height / SCENE_HEIGHT, 0, 0);
    ctx.clearRect(0, 0, SCENE_WIDTH, SCENE_HEIGHT);
    drawBackground(state.time);
    drawMountains();
    drawWater(state.time);
    orderedLayers().forEach((layer) => drawPaperLayer(layer, state.time));
    drawForeground();
    drawFrame();

    ctx.save();
    ctx.globalAlpha = 0.075;
    ctx.fillStyle = grainPattern;
    ctx.fillRect(0, 0, SCENE_WIDTH, SCENE_HEIGHT);
    ctx.restore();

    if (state.guides) drawGuides();
  }

  function hitTestLayer(event) {
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * SCENE_WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * SCENE_HEIGHT;
    const hitAreas = {
      tree: [210, 155, 270, 390],
      moon: [700, 88, 185, 200],
      boat: [580, 338, 255, 235],
      figure: [470, 382, 145, 190],
    };
    return orderedLayers()
      .reverse()
      .find((layer) => {
        const [left, top, width, height] = hitAreas[layer.id];
        return x >= left && x <= left + width && y >= top && y <= top + height;
      });
  }

  const PaperAudio = {
    context: null,
    master: null,
    noiseBuffer: null,
    activeSources: [],

    ensure() {
      if (state.soundMuted) return null;
      if (!this.context) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return null;
        this.context = new AudioContextClass();
        this.master = this.context.createGain();
        this.master.gain.value = 0.42;
        this.master.connect(this.context.destination);
        this.noiseBuffer = this.createNoiseBuffer();
      }
      if (this.context.state === "suspended") this.context.resume().catch(() => {});
      return this.context;
    },

    createNoiseBuffer() {
      const length = Math.floor(this.context.sampleRate * 2);
      const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
      const data = buffer.getChannelData(0);
      let previous = 0;
      for (let index = 0; index < length; index += 1) {
        const white = Math.random() * 2 - 1;
        previous = previous * 0.65 + white * 0.35;
        data[index] = previous;
      }
      return buffer;
    },

    registerSource(source) {
      this.activeSources.push(source);
      source.addEventListener("ended", () => {
        this.activeSources = this.activeSources.filter((item) => item !== source);
      });
    },

    slide(duration = 2) {
      const context = this.ensure();
      if (!context) return;
      const now = context.currentTime;
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      source.buffer = this.noiseBuffer;
      filter.type = "bandpass";
      filter.Q.value = 0.55;
      filter.frequency.setValueAtTime(820, now);
      filter.frequency.exponentialRampToValueAtTime(2650, now + 0.52);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.095, now + 0.09);
      gain.gain.setValueAtTime(0.075, now + 0.28);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + Math.min(1.35, duration * 0.55));
      source.connect(filter).connect(gain).connect(this.master);
      source.start(now);
      source.stop(now + Math.min(1.4, Math.max(0.5, duration * 0.55)));
      this.registerSource(source);
    },

    pageTurn() {
      const context = this.ensure();
      if (!context) return;
      const now = context.currentTime;
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      source.buffer = this.noiseBuffer;
      source.playbackRate.value = 1.35;
      filter.type = "highpass";
      filter.frequency.setValueAtTime(1450, now);
      filter.frequency.exponentialRampToValueAtTime(3400, now + 0.24);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.075, now + 0.045);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.43);
      source.connect(filter).connect(gain).connect(this.master);
      source.start(now);
      source.stop(now + 0.46);
      this.registerSource(source);
    },

    stop() {
      this.activeSources.forEach((source) => {
        try {
          source.stop();
        } catch {
          return;
        }
      });
      this.activeSources = [];
    },
  };

  const soundEvents = { slides: new Set(), flips: new Set() };

  function resetSoundEvents() {
    soundEvents.slides.clear();
    soundEvents.flips.clear();
  }

  function fireSoundEvents(from, to) {
    state.project.layers.forEach((layer) => {
      if (layer.start > from && layer.start <= to && !soundEvents.slides.has(layer.id)) {
        soundEvents.slides.add(layer.id);
        PaperAudio.slide(layer.duration);
      }
      const flipAt = layer.start + layer.duration * 0.73;
      if (flipAt > from && flipAt <= to && !soundEvents.flips.has(layer.id)) {
        soundEvents.flips.add(layer.id);
        PaperAudio.pageTurn();
      }
    });
  }

  function play(options = {}) {
    if (state.time >= DURATION - 0.001) {
      state.time = 0;
      resetSoundEvents();
    }
    state.playing = true;
    state.lastFrame = performance.now();
    if (!options.automatic) {
      state.interactionHappened = true;
      PaperAudio.ensure();
    }
    syncTransport();
    drawScene();
  }

  function pause() {
    state.playing = false;
    state.lastFrame = performance.now();
    PaperAudio.stop();
    state.interactionHappened = true;
    syncTransport();
    drawScene();
  }

  function togglePlayback() {
    if (state.playing) pause();
    else play();
  }

  function seek(time, pauseFirst = false) {
    if (pauseFirst && state.playing) pause();
    state.time = clamp(time, 0, DURATION);
    PaperAudio.stop();
    resetSoundEvents();
    state.interactionHappened = true;
    syncTransport();
    drawScene();
    scheduleAutoSave();
  }

  function advancePlayback(deltaSeconds) {
    const from = state.time;
    let to = from + deltaSeconds;
    if (to >= DURATION) {
      fireSoundEvents(from, DURATION);
      if (state.project.loop) {
        to -= DURATION;
        resetSoundEvents();
        fireSoundEvents(0, to);
      } else {
        state.time = DURATION;
        state.playing = false;
        PaperAudio.stop();
        syncTransport();
        drawScene();
        return;
      }
    } else {
      fireSoundEvents(from, to);
    }
    state.time = clamp(to, 0, DURATION);
    syncTransport();
    drawScene();
  }

  function animationLoop(timestamp) {
    window.requestAnimationFrame(animationLoop);
    if (!state.playing) {
      state.lastFrame = timestamp;
      return;
    }
    const delta = Math.min(0.12, Math.max(0, (timestamp - state.lastFrame) / 1000));
    state.lastFrame = timestamp;
    if (delta > 0) advancePlayback(delta);
  }

  function createSnapshot() {
    return {
      version: 1,
      title: state.project.title,
      duration: DURATION,
      playhead: round(state.time, 2),
      loop: state.project.loop,
      sound: !state.soundMuted,
      layers: state.project.layers.map((layer) => ({
        id: layer.id,
        depth: layer.depth,
        angle: layer.angle,
        lift: layer.lift,
        shift: layer.shift,
        start: round(layer.start, 2),
        duration: round(layer.duration, 2),
        maskIn: round(layer.maskIn, 2),
        maskOut: round(layer.maskOut, 2),
      })),
    };
  }

  function persistProject(download = false) {
    const snapshot = createSnapshot();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      showToast("浏览器存储不可用，请直接打开工程文件");
      return;
    }
    if (download) {
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const safeTitle = snapshot.title.replace(/[\\/:*?"<>|]/g, "-");
      link.href = url;
      link.download = `${safeTitle || "paper-theatre"}.papertheatre.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("工程已保存并导出 · 可随时重新打开");
    }
  }

  function applyProject(project) {
    const normalized = normalizeProject(project);
    if (!normalized) {
      showToast("无法识别这个工程文件");
      return false;
    }
    state.playing = false;
    PaperAudio.stop();
    state.project = normalized;
    state.time = normalized.playhead;
    state.soundMuted = !normalized.sound;
    state.selectedId = "tree";
    state.interactionHappened = true;
    resetSoundEvents();
    renderAll();
    drawScene();
    persistProject(false);
    showToast(`已载入「${normalized.title}」`);
    return true;
  }

  function selectLayer(id) {
    if (!getLayer(id)) return;
    state.selectedId = id;
    renderLayerList();
    syncInspector();
    renderTimeline();
    syncTransport();
    drawScene();
  }

  function cycleLayerDepth() {
    const layer = getLayer();
    if (!layer) return;
    const currentDepth = layer.depth;
    const nextDepth = currentDepth === 4 ? 1 : currentDepth + 1;
    const occupant = state.project.layers.find((item) => item.id !== layer.id && item.depth === nextDepth);
    if (occupant) occupant.depth = currentDepth;
    layer.depth = nextDepth;
    renderAll();
    drawScene();
    scheduleAutoSave();
    showToast(`深度已切换到 D${nextDepth} · ${layerMeta(layer).name}`);
  }

  function updateSelectedLayer(mutator, options = {}) {
    const layer = getLayer();
    if (!layer) return;
    mutator(layer);
    layer.start = clamp(layer.start, 0, DURATION - 0.4);
    layer.duration = clamp(layer.duration, 0.4, Math.min(6, DURATION - layer.start));
    layer.maskIn = clamp(layer.maskIn, 0, DURATION - 0.2);
    layer.maskOut = clamp(layer.maskOut, layer.maskIn + 0.2, DURATION);
    renderLayerList();
    syncInspector();
    renderTimeline();
    drawScene();
    scheduleAutoSave();
    if (options.toast) showToast(options.toast);
  }

  function pointerTime(event) {
    const rect = dom.trackField.getBoundingClientRect();
    return clamp(((event.clientX - rect.left) / rect.width) * DURATION, 0, DURATION);
  }

  function beginTimelinePointer(event) {
    if (event.button !== 0) return;
    const clip = event.target.closest(".clip-block");
    if (state.playing) pause();
    if (clip) {
      const id = clip.dataset.clipId;
      const layer = getLayer(id);
      if (!layer) return;
      selectLayer(id);
      state.clipDrag = {
        id,
        startX: event.clientX,
        originalStart: layer.start,
        moved: false,
      };
    } else {
      state.scrubbing = true;
      state.clipDrag = null;
      state.time = pointerTime(event);
      resetSoundEvents();
      syncTransport();
      drawScene();
    }
    state.interactionHappened = true;
    dom.trackField.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveTimelinePointer(event) {
    if (state.scrubbing) {
      state.time = pointerTime(event);
      syncTransport();
      drawScene();
      return;
    }
    if (!state.clipDrag) return;
    const layer = getLayer(state.clipDrag.id);
    if (!layer) return;
    const rect = dom.trackField.getBoundingClientRect();
    const delta = ((event.clientX - state.clipDrag.startX) / rect.width) * DURATION;
    const maximumStart = DURATION - Math.max(0.4, layer.duration);
    layer.start = clamp(state.clipDrag.originalStart + delta, 0, maximumStart);
    state.clipDrag.moved = true;
    renderLayerList();
    syncInspector();
    renderTimeline();
    drawScene();
  }

  function endTimelinePointer(event) {
    if (state.scrubbing || state.clipDrag) scheduleAutoSave();
    state.scrubbing = false;
    state.clipDrag = null;
    if (dom.trackField.hasPointerCapture(event.pointerId)) {
      dom.trackField.releasePointerCapture(event.pointerId);
    }
  }

  function setSoundMuted(muted) {
    state.soundMuted = muted;
    state.project.sound = !muted;
    if (muted) PaperAudio.stop();
    else PaperAudio.ensure();
    syncTransport();
    scheduleAutoSave();
  }

  function wireControls() {
    dom.layerList.addEventListener("click", (event) => {
      const item = event.target.closest("[data-layer-id]");
      if (item) selectLayer(item.dataset.layerId);
    });

    dom.trackLabels.addEventListener("click", (event) => {
      const item = event.target.closest("[data-layer-id]");
      if (item) selectLayer(item.dataset.layerId);
    });

    dom.angleInput.addEventListener("input", (event) => {
      updateSelectedLayer((layer) => {
        layer.angle = Number(event.target.value);
      });
    });

    dom.liftInput.addEventListener("input", (event) => {
      updateSelectedLayer((layer) => {
        layer.lift = Number(event.target.value);
      });
    });

    dom.shiftInput.addEventListener("input", (event) => {
      updateSelectedLayer((layer) => {
        layer.shift = Number(event.target.value);
      });
    });

    dom.maskIn.addEventListener("input", (event) => {
      updateSelectedLayer((layer) => {
        layer.maskIn = Math.min(Number(event.target.value), layer.maskOut - 0.2);
      });
    });

    dom.maskOut.addEventListener("input", (event) => {
      updateSelectedLayer((layer) => {
        layer.maskOut = Math.max(Number(event.target.value), layer.maskIn + 0.2);
      });
    });

    dom.startInput.addEventListener("input", (event) => {
      if (!event.target.value) return;
      updateSelectedLayer((layer) => {
        layer.start = Number(event.target.value);
      });
    });

    dom.durationInput.addEventListener("input", (event) => {
      if (!event.target.value) return;
      updateSelectedLayer((layer) => {
        layer.duration = Number(event.target.value);
      });
    });

    dom.projectName.addEventListener("input", (event) => {
      state.project.title = event.target.value.slice(0, 22) || "未命名工程";
      document.title = `纸间 · ${state.project.title}`;
      scheduleAutoSave();
    });

    dom.playBtn.addEventListener("click", togglePlayback);
    dom.centerPlay.addEventListener("click", togglePlayback);
    dom.backBtn.addEventListener("click", () => {
      seek(0, true);
      showToast("已回到第 0 秒");
    });

    dom.loopBtn.addEventListener("click", () => {
      state.project.loop = !state.project.loop;
      syncTransport();
      scheduleAutoSave();
      showToast(state.project.loop ? "循环播放已开启" : "循环播放已关闭");
    });

    const toggleSound = () => setSoundMuted(!state.soundMuted);
    dom.soundToggle.addEventListener("click", toggleSound);
    dom.audioBtn.addEventListener("click", toggleSound);
    dom.guidesBtn.addEventListener("click", () => {
      state.guides = !state.guides;
      syncTransport();
      drawScene();
    });

    dom.depthTag.addEventListener("click", cycleLayerDepth);

    dom.saveBtn.addEventListener("click", () => {
      state.interactionHappened = true;
      persistProject(true);
    });

    dom.importBtn.addEventListener("click", () => dom.fileInput.click());
    dom.fileInput.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        try {
          applyProject(JSON.parse(String(reader.result)));
        } catch {
          showToast("工程文件不是有效的 JSON");
        }
      });
      reader.readAsText(file);
      event.target.value = "";
    });

    dom.trackField.addEventListener("pointerdown", beginTimelinePointer);
    dom.trackField.addEventListener("pointermove", moveTimelinePointer);
    dom.trackField.addEventListener("pointerup", endTimelinePointer);
    dom.trackField.addEventListener("pointercancel", endTimelinePointer);

    canvas.addEventListener("click", (event) => {
      const layer = hitTestLayer(event);
      if (layer) selectLayer(layer.id);
    });
    canvas.addEventListener("pointermove", (event) => {
      canvas.style.cursor = hitTestLayer(event) ? "pointer" : "default";
    });

    document.addEventListener(
      "pointerdown",
      () => {
        state.interactionHappened = true;
      },
      { capture: true, once: true },
    );

    window.addEventListener("keydown", (event) => {
      if (event.target.matches("input, textarea, select, button")) return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePlayback();
      } else if (event.code === "ArrowLeft") {
        event.preventDefault();
        seek(state.time - (event.shiftKey ? 1 : 0.1), true);
      } else if (event.code === "ArrowRight") {
        event.preventDefault();
        seek(state.time + (event.shiftKey ? 1 : 0.1), true);
      }
    });

    window.addEventListener("beforeunload", () => persistProject(false));
  }

  function init() {
    renderAll();
    wireControls();
    fitStage();
    resizeCanvas();
    drawScene();

    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
      syncTransport();
      drawScene();
    });
    resizeObserver.observe(canvas);

    const stageObserver = new ResizeObserver(() => {
      fitStage();
      resizeCanvas();
      syncTransport();
      drawScene();
    });
    stageObserver.observe(dom.stageFrame);

    window.requestAnimationFrame(animationLoop);
    document.title = `纸间 · ${state.project.title}`;

    if (!savedProject) {
      window.setTimeout(() => {
        if (!state.interactionHappened && !state.playing && state.time === 0) {
          play({ automatic: true });
        }
      }, 900);
    }
  }

  init();
})();
