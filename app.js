(function () {
  "use strict";

  const WORLD_WIDTH = window.MotionScene.WORLD_WIDTH;
  const WORLD_HEIGHT = window.MotionScene.WORLD_HEIGHT;
  const BASE_VIEW_WIDTH = 760;
  const BASE_VIEW_HEIGHT = BASE_VIEW_WIDTH * (9 / 16);
  const PATH_STEPS = 320;
  const SAMPLES = {
    version: 1,
    name: "河畔暮光",
    duration: 8,
    world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
    path: {
      start: { x: 612, y: 607 },
      control1: { x: 758, y: 456 },
      control2: { x: 997, y: 452 },
      end: { x: 1186, y: 506 }
    },
    keyframes: [
      { time: 0, zoom: 1.35, rotation: -4 },
      { time: 2.35, zoom: 1.52, rotation: 3.5 },
      { time: 5.15, zoom: 1.92, rotation: 11 },
      { time: 8, zoom: 1.58, rotation: 0 }
    ],
    loop: true
  };

  const dom = {
    stage: document.getElementById("canvasStage"),
    directorCanvas: document.getElementById("directorCanvas"),
    previewCanvas: document.getElementById("previewCanvas"),
    grabHint: document.getElementById("grabHint"),
    canvasReadout: document.getElementById("canvasReadout"),
    playButton: document.getElementById("playButton"),
    projectKicker: document.getElementById("projectKicker"),
    timeline: document.getElementById("timeline"),
    timelineProgress: document.getElementById("timelineProgress"),
    timelinePlayhead: document.getElementById("timelinePlayhead"),
    timelineKeyframes: document.getElementById("timelineKeyframes"),
    timeNow: document.getElementById("timeNow"),
    timeTotal: document.getElementById("timeTotal"),
    timelineEndLabel: document.getElementById("timelineEndLabel"),
    loopButton: document.getElementById("loopButton"),
    zoomReadout: document.getElementById("zoomReadout"),
    rotationReadout: document.getElementById("rotationReadout"),
    positionReadout: document.getElementById("positionReadout"),
    lengthReadout: document.getElementById("lengthReadout"),
    keyframeCount: document.getElementById("keyframeCount"),
    progressReadout: document.getElementById("progressReadout"),
    durationReadout: document.getElementById("durationReadout"),
    keyframeList: document.getElementById("keyframeList"),
    selectedKeyTime: document.getElementById("selectedKeyTime"),
    zoomInput: document.getElementById("zoomInput"),
    rotationInput: document.getElementById("rotationInput"),
    zoomValue: document.getElementById("zoomValue"),
    rotationValue: document.getElementById("rotationValue"),
    addKeyframeButton: document.getElementById("addKeyframeButton"),
    deleteKeyframeButton: document.getElementById("deleteKeyframeButton"),
    saveButton: document.getElementById("saveButton"),
    loadButton: document.getElementById("loadButton"),
    fileInput: document.getElementById("fileInput"),
    saveState: document.getElementById("saveState"),
    projectTitle: document.getElementById("projectTitle"),
    previewTag: document.getElementById("previewTag"),
    toast: document.getElementById("toast"),
    toastText: document.getElementById("toastText")
  };

  const directorCanvas = setupCanvas(dom.directorCanvas);
  const previewCanvas = setupCanvas(dom.previewCanvas);
  const worldImage = window.MotionScene.buildWorldCanvas();

  let project = cloneProject(SAMPLES);
  let time = 0;
  let playing = false;
  let selectedKeyId = null;
  let dirty = false;
  let draggingHandle = null;
  let hoverHandle = null;
  let scrubbing = false;
  let needsRender = true;
  let directorView = null;
  let geometry = null;
  let nextKeyId = 1;
  let toastTimer = null;

  function setupCanvas(canvas) {
    return { element: canvas, ctx: canvas.getContext("2d"), width: 0, height: 0, dpr: 1 };
  }

  function resizeCanvas(target) {
    const rect = target.element.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (target.width === width && target.height === height && target.dpr === dpr) return false;
    target.width = width;
    target.height = height;
    target.dpr = dpr;
    target.element.width = Math.round(width * dpr);
    target.element.height = Math.round(height * dpr);
    target.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  function cloneProject(source) {
    return {
      version: 1,
      name: source.name,
      duration: source.duration,
      world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
      path: {
        start: { ...source.path.start },
        control1: { ...source.path.control1 },
        control2: { ...source.path.control2 },
        end: { ...source.path.end }
      },
      keyframes: source.keyframes.map((key) => ({
        time: key.time,
        zoom: key.zoom,
        rotation: key.rotation
      })),
      loop: source.loop !== false
    };
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(a, b, amount) {
    return a + (b - a) * amount;
  }

  function smoothstep(value) {
    return value * value * (3 - 2 * value);
  }

  function cubicPoint(path, t) {
    const oneMinus = 1 - t;
    const a = oneMinus * oneMinus * oneMinus;
    const b = 3 * oneMinus * oneMinus * t;
    const c = 3 * oneMinus * t * t;
    const d = t * t * t;
    return {
      x: a * path.start.x + b * path.control1.x + c * path.control2.x + d * path.end.x,
      y: a * path.start.y + b * path.control1.y + c * path.control2.y + d * path.end.y
    };
  }

  function buildGeometry() {
    const points = [];
    const lengths = [0];
    let previous = cubicPoint(project.path, 0);
    let total = 0;
    points.push({ ...previous, t: 0, length: 0 });
    for (let i = 1; i <= PATH_STEPS; i += 1) {
      const t = i / PATH_STEPS;
      const point = cubicPoint(project.path, t);
      total += Math.hypot(point.x - previous.x, point.y - previous.y);
      points.push({ ...point, t, length: total });
      lengths.push(total);
      previous = point;
    }
    return { points, lengths, total };
  }

  function pointAtProgress(progress) {
    if (!geometry) geometry = buildGeometry();
    const target = clamp(progress, 0, 1) * geometry.total;
    let low = 0;
    let high = geometry.points.length - 1;
    while (low < high - 1) {
      const mid = Math.floor((low + high) / 2);
      if (geometry.points[mid].length < target) low = mid;
      else high = mid;
    }
    const start = geometry.points[low];
    const end = geometry.points[high];
    const span = end.length - start.length;
    const amount = span > 0.0001 ? (target - start.length) / span : 0;
    const previous = geometry.points[Math.max(0, low - 1)];
    const next = geometry.points[Math.min(geometry.points.length - 1, high + 1)];
    return {
      x: lerp(start.x, end.x, amount),
      y: lerp(start.y, end.y, amount),
      angle: Math.atan2(next.y - previous.y, next.x - previous.x)
    };
  }

  function getCameraState() {
    const keys = project.keyframes;
    const progress = project.duration > 0 ? time / project.duration : 0;
    let before = keys[0];
    let after = keys[keys.length - 1];
    if (time <= keys[0].time) {
      before = keys[0];
      after = keys[0];
    } else if (time < keys[keys.length - 1].time) {
      for (let i = 0; i < keys.length - 1; i += 1) {
        if (time >= keys[i].time && time <= keys[i + 1].time) {
          before = keys[i];
          after = keys[i + 1];
          break;
        }
      }
    }
    const span = after.time - before.time;
    const rawAmount = span > 0.0001 ? (time - before.time) / span : 0;
    const amount = smoothstep(clamp(rawAmount, 0, 1));
    const location = pointAtProgress(progress);
    return {
      x: location.x,
      y: location.y,
      angle: location.angle,
      zoom: lerp(before.zoom, after.zoom, amount),
      rotation: lerp(before.rotation, after.rotation, amount),
      progress
    };
  }

  function nextKeyIdValue() {
    const id = `key-${nextKeyId}`;
    nextKeyId += 1;
    return id;
  }

  function prepareKeys(keys) {
    return keys
      .slice()
      .sort((a, b) => a.time - b.time)
      .map((key) => ({ ...key, id: key.id || nextKeyIdValue() }));
  }

  function currentSelectedKey() {
    return project.keyframes.find((key) => key.id === selectedKeyId) || null;
  }

  function formatTimecode(value) {
    const safe = Math.max(0, value);
    const minutes = Math.floor(safe / 60).toString().padStart(2, "0");
    const seconds = Math.floor(safe % 60).toString().padStart(2, "0");
    const tenths = Math.floor((safe % 1) * 10);
    return `${minutes}:${seconds}.${tenths}`;
  }

  function formatAngle(value, digits = 1) {
    const sign = value < 0 ? "−" : value > 0 ? "+" : "";
    return `${sign}${Math.abs(value).toFixed(digits)}°`;
  }

  function formatZoom(value) {
    return `${value.toFixed(2)}×`;
  }

  function formatProgress(value) {
    return `${(value * 100).toFixed(1)}%`;
  }

  function updateTransportUI() {
    const progress = project.duration > 0 ? clamp(time / project.duration, 0, 1) : 0;
    dom.timeNow.textContent = formatTimecode(time);
    dom.timeTotal.textContent = `/ ${formatTimecode(project.duration)}`;
    dom.timelineEndLabel.textContent = `${project.duration % 1 === 0 ? project.duration.toFixed(0) : project.duration.toFixed(1)}s`;
    dom.timelineProgress.style.width = `${progress * 100}%`;
    dom.timelinePlayhead.style.left = `${progress * 100}%`;
    dom.timeline.setAttribute("aria-valuenow", time.toFixed(2));
    dom.timeline.setAttribute("aria-valuemax", project.duration.toFixed(2));
    dom.progressReadout.textContent = formatProgress(progress);
  }

  function updateCameraReadouts() {
    const camera = getCameraState();
    if (!geometry) geometry = buildGeometry();
    const fovWidth = BASE_VIEW_WIDTH / camera.zoom;
    dom.zoomReadout.textContent = formatZoom(camera.zoom);
    dom.rotationReadout.textContent = formatAngle(camera.rotation);
    dom.positionReadout.textContent = `X${Math.round(camera.x)} · Y${Math.round(camera.y)}`;
    dom.lengthReadout.textContent = `${Math.round(geometry ? geometry.total : 0).toLocaleString("en-US")} px`;
    dom.previewTag.textContent = `FOV ${Math.round(fovWidth)} × ${Math.round(fovWidth * 9 / 16)}`;
    updateTransportUI();
  }

  function renderTimelineKeys() {
    dom.timelineKeyframes.replaceChildren();
    for (const key of project.keyframes) {
      const marker = document.createElement("span");
      marker.className = `timeline-key${key.id === selectedKeyId ? " is-selected" : ""}`;
      marker.style.left = `${clamp(key.time / project.duration, 0, 1) * 100}%`;
      marker.title = `${key.time.toFixed(2)}s · ${formatZoom(key.zoom)} · ${formatAngle(key.rotation)}`;
      dom.timelineKeyframes.appendChild(marker);
    }
  }

  function renderKeyframeList() {
    dom.keyframeList.replaceChildren();
    for (const key of project.keyframes) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `keyframe-row${key.id === selectedKeyId ? " is-selected" : ""}`;
      row.dataset.keyId = key.id;
      row.setAttribute("aria-pressed", key.id === selectedKeyId ? "true" : "false");
      row.innerHTML = `
        <span class="key-dot"></span>
        <span class="key-time">${key.time.toFixed(2)}s</span>
        <span class="key-value">${formatZoom(key.zoom)}</span>
        <span class="key-angle">${formatAngle(key.rotation)}</span>
      `;
      dom.keyframeList.appendChild(row);
    }
    dom.keyframeCount.textContent = `${project.keyframes.length} 段`;
  }

  function syncKeyEditor() {
    const key = currentSelectedKey();
    if (!key) {
      dom.selectedKeyTime.textContent = "—";
      dom.zoomInput.value = "1.35";
      dom.rotationInput.value = "0";
      dom.zoomValue.textContent = "—";
      dom.rotationValue.textContent = "—";
      dom.deleteKeyframeButton.disabled = true;
      return;
    }
    dom.selectedKeyTime.textContent = `${key.time.toFixed(2)}s`;
    dom.zoomInput.value = key.zoom.toFixed(2);
    dom.rotationInput.value = key.rotation.toFixed(1);
    dom.zoomValue.textContent = formatZoom(key.zoom);
    dom.rotationValue.textContent = formatAngle(key.rotation, 0);
    dom.deleteKeyframeButton.disabled = project.keyframes.length <= 1;
  }

  function refreshAllUI() {
    if (!geometry) geometry = buildGeometry();
    dom.projectTitle.textContent = project.name;
    dom.projectKicker.textContent = `SHOT 01 / ${project.duration.toFixed(0).padStart(2, "0")} SEC`;
    dom.durationReadout.textContent = `${project.duration.toFixed(2)}s`;
    updateCameraReadouts();
    renderTimelineKeys();
    renderKeyframeList();
    syncKeyEditor();
    needsRender = true;
  }

  function markDirty() {
    dirty = true;
    dom.saveState.classList.add("is-dirty");
    dom.saveState.querySelector("span").textContent = "有未保存修改";
  }

  function markClean(label) {
    dirty = false;
    dom.saveState.classList.remove("is-dirty");
    dom.saveState.querySelector("span").textContent = label;
  }

  function showToast(message, error = false) {
    window.clearTimeout(toastTimer);
    dom.toastText.textContent = message;
    dom.toast.classList.toggle("is-error", error);
    dom.toast.querySelector(".toast-mark").textContent = error ? "!" : "✓";
    dom.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => dom.toast.classList.remove("is-visible"), 2600);
  }

  function setPlaying(value) {
    playing = value;
    dom.playButton.classList.toggle("is-playing", playing);
    dom.playButton.setAttribute("aria-label", playing ? "暂停镜头" : "播放镜头");
    needsRender = true;
  }

  function togglePlayback() {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (time >= project.duration - 0.001) time = 0;
    setPlaying(true);
  }

  function setTime(value) {
    time = clamp(value, 0, project.duration);
    updateCameraReadouts();
    needsRender = true;
  }

  function normalizePoint(point) {
    if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
      throw new Error("路线控制点数据无效");
    }
    return {
      x: clamp(Number(point.x), 0, WORLD_WIDTH),
      y: clamp(Number(point.y), 0, WORLD_HEIGHT)
    };
  }

  function normalizeProject(raw) {
    if (!raw || typeof raw !== "object") throw new Error("JSON 必须是一个对象");
    if (!raw.path) throw new Error("缺少 path 路线字段");
    if (!Array.isArray(raw.keyframes) || raw.keyframes.length === 0) {
      throw new Error("至少需要一个缩放/旋转关键帧");
    }
    const duration = Number(raw.duration);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 120) {
      throw new Error("duration 需要在 0–120 秒之间");
    }
    const path = {
      start: normalizePoint(raw.path.start),
      control1: normalizePoint(raw.path.control1),
      control2: normalizePoint(raw.path.control2),
      end: normalizePoint(raw.path.end)
    };

    let keys = raw.keyframes.map((key, index) => {
      const keyTime = Number(key.time);
      const zoom = Number(key.zoom);
      const rotation = Number(key.rotation);
      if (!Number.isFinite(keyTime) || !Number.isFinite(zoom) || !Number.isFinite(rotation)) {
        throw new Error(`第 ${index + 1} 个关键帧数据无效`);
      }
      return {
        time: clamp(keyTime, 0, duration),
        zoom: clamp(zoom, 0.2, 8),
        rotation: clamp(rotation, -180, 180)
      };
    });

    keys.sort((a, b) => a.time - b.time);
    keys = keys.filter((key, index) => index === 0 || Math.abs(key.time - keys[index - 1].time) > 0.01);
    if (keys.length === 0) throw new Error("至少需要一个有效关键帧");

    return {
      version: 1,
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 60) : "未命名镜头",
      duration,
      world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
      path,
      keyframes: keys.map((key) => ({ ...key, id: nextKeyIdValue() })),
      loop: raw.loop !== false
    };
  }

  function applyProject(raw, statusLabel) {
    const loaded = normalizeProject(raw);
    project = loaded;
    time = 0;
    playing = false;
    geometry = null;
    selectedKeyId = project.keyframes[0].id;
    dom.playButton.classList.remove("is-playing");
    dom.playButton.setAttribute("aria-label", "播放镜头");
    dom.loopButton.classList.toggle("is-active", project.loop);
    dom.loopButton.setAttribute("aria-pressed", project.loop ? "true" : "false");
    markClean(statusLabel);
    refreshAllUI();
  }

  function serializeProject() {
    return {
      version: 1,
      name: project.name,
      duration: project.duration,
      world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
      path: {
        start: { x: Math.round(project.path.start.x * 10) / 10, y: Math.round(project.path.start.y * 10) / 10 },
        control1: { x: Math.round(project.path.control1.x * 10) / 10, y: Math.round(project.path.control1.y * 10) / 10 },
        control2: { x: Math.round(project.path.control2.x * 10) / 10, y: Math.round(project.path.control2.y * 10) / 10 },
        end: { x: Math.round(project.path.end.x * 10) / 10, y: Math.round(project.path.end.y * 10) / 10 }
      },
      keyframes: project.keyframes.map((key) => ({
        time: Math.round(key.time * 100) / 100,
        zoom: Math.round(key.zoom * 100) / 100,
        rotation: Math.round(key.rotation * 10) / 10
      })),
      loop: project.loop
    };
  }

  function downloadProject() {
    const data = serializeProject();
    const text = `${JSON.stringify(data, null, 2)}\n`;
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "camera-route-8s.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    markClean("JSON 已保存");
    showToast(`镜头路线已保存 · ${project.duration.toFixed(2)}s`);
  }

  function getDirectorView(width, height) {
    const worldAspect = WORLD_WIDTH / WORLD_HEIGHT;
    const canvasAspect = width / height;
    let drawWidth;
    let drawHeight;
    let x;
    let y;
    if (canvasAspect > worldAspect) {
      drawHeight = height;
      drawWidth = drawHeight * worldAspect;
      x = (width - drawWidth) / 2;
      y = 0;
    } else {
      drawWidth = width;
      drawHeight = drawWidth / worldAspect;
      x = 0;
      y = (height - drawHeight) / 2;
    }
    return {
      x,
      y,
      width: drawWidth,
      height: drawHeight,
      scale: drawWidth / WORLD_WIDTH
    };
  }

  function worldToDirector(point) {
    return {
      x: directorView.x + point.x * directorView.scale,
      y: directorView.y + point.y * directorView.scale
    };
  }

  function screenToWorld(x, y) {
    return {
      x: (x - directorView.x) / directorView.scale,
      y: (y - directorView.y) / directorView.scale
    };
  }

  function traceRoute(ctx, points) {
    if (!points.length) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(points[i].x, points[i].y);
    }
  }

  function drawTag(ctx, x, y, text, tone = "light") {
    ctx.save();
    ctx.font = '600 9px "SFMono-Regular", Consolas, monospace';
    const width = ctx.measureText(text).width + 12;
    const height = 18;
    ctx.translate(x, y);
    ctx.fillStyle = tone === "accent" ? "rgba(255, 107, 61, 0.93)" : "rgba(19, 23, 18, 0.82)";
    ctx.beginPath();
    ctx.roundRect(-width / 2, -height / 2, width, height, 4);
    ctx.fill();
    ctx.strokeStyle = tone === "accent" ? "rgba(255, 225, 196, 0.32)" : "rgba(255, 252, 239, 0.16)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = tone === "accent" ? "#21130e" : "rgba(255, 250, 238, 0.82)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 0, 0.5);
    ctx.restore();
  }

  function drawCameraFrame(ctx, camera) {
    const position = worldToDirector(camera);
    const screenWidth = (BASE_VIEW_WIDTH / camera.zoom) * directorView.scale;
    const screenHeight = (BASE_VIEW_HEIGHT / camera.zoom) * directorView.scale;
    const rotation = camera.rotation * (Math.PI / 180);

    ctx.save();
    ctx.translate(position.x, position.y);
    ctx.rotate(rotation);
    ctx.fillStyle = "rgba(255, 240, 211, 0.055)";
    ctx.fillRect(-screenWidth / 2, -screenHeight / 2, screenWidth, screenHeight);

    ctx.shadowColor = "rgba(8, 12, 10, 0.5)";
    ctx.shadowBlur = 7;
    ctx.strokeStyle = "rgba(255, 249, 235, 0.88)";
    ctx.lineWidth = 1.25;
    ctx.strokeRect(-screenWidth / 2, -screenHeight / 2, screenWidth, screenHeight);
    ctx.shadowBlur = 0;

    ctx.strokeStyle = "rgba(255, 244, 219, 0.18)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 5]);
    for (let i = 1; i <= 2; i += 1) {
      const x = -screenWidth / 2 + (screenWidth * i) / 3;
      const y = -screenHeight / 2 + (screenHeight * i) / 3;
      ctx.beginPath();
      ctx.moveTo(x, -screenHeight / 2);
      ctx.lineTo(x, screenHeight / 2);
      ctx.moveTo(-screenWidth / 2, y);
      ctx.lineTo(screenWidth / 2, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    const cornerLength = Math.min(17, screenWidth * 0.08);
    ctx.strokeStyle = "#fff8e9";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "square";
    const left = -screenWidth / 2;
    const right = screenWidth / 2;
    const top = -screenHeight / 2;
    const bottom = screenHeight / 2;
    const corners = [
      [left, top, 1, 1], [right, top, -1, 1],
      [left, bottom, 1, -1], [right, bottom, -1, -1]
    ];
    for (const [x, y, dx, dy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x + dx * cornerLength, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + dy * cornerLength);
      ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = "rgba(255, 107, 61, 0.96)";
    ctx.beginPath();
    ctx.arc(position.x, position.y, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(15, 19, 15, 0.9)";
    ctx.lineWidth = 2;
    ctx.stroke();

    drawTag(
      ctx,
      position.x,
      position.y - Math.max(22, screenHeight / 2 + 22),
      `CAM · ${formatZoom(camera.zoom)} · ${formatAngle(camera.rotation, 0)}`,
      "accent"
    );
  }

  const HANDLE_META = [
    { key: "start", label: "START", color: "#dce58c" },
    { key: "control1", label: "C1", color: "#f7ead4" },
    { key: "control2", label: "C2", color: "#f7ead4" },
    { key: "end", label: "END", color: "#ff8c67" }
  ];

  function drawHandles(ctx) {
    const path = project.path;
    const start = worldToDirector(path.start);
    const control1 = worldToDirector(path.control1);
    const control2 = worldToDirector(path.control2);
    const end = worldToDirector(path.end);

    ctx.save();
    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255, 247, 229, 0.28)";
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(control1.x, control1.y);
    ctx.moveTo(control2.x, control2.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.setLineDash([]);

    for (const meta of HANDLE_META) {
      const point = worldToDirector(path[meta.key]);
      const active = hoverHandle === meta.key || draggingHandle === meta.key;
      const radius = meta.key === "start" || meta.key === "end" ? (active ? 9 : 7.5) : (active ? 7 : 5.8);

      if (meta.key === "control1" || meta.key === "control2") {
        ctx.save();
        ctx.translate(point.x, point.y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = "#242a21";
        ctx.strokeStyle = meta.color;
        ctx.lineWidth = active ? 2.4 : 1.6;
        ctx.beginPath();
        ctx.rect(-radius, -radius, radius * 2, radius * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius + 4, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(15, 19, 14, 0.9)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = meta.color;
        ctx.lineWidth = active ? 2.6 : 1.8;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius * 0.38, 0, Math.PI * 2);
        ctx.fillStyle = meta.color;
        ctx.fill();
      }
      drawTag(ctx, point.x, point.y - (meta.key === "start" || meta.key === "end" ? 22 : 18), meta.label);
    }
    ctx.restore();
  }

  function drawRoute(ctx, camera) {
    if (!geometry) geometry = buildGeometry();
    const screenPoints = geometry.points.map((point) => worldToDirector(point));
    const targetLength = camera.progress * geometry.total;
    let completedPoints = [];
    for (let i = 0; i < geometry.points.length; i += 1) {
      if (geometry.points[i].length <= targetLength) completedPoints.push(screenPoints[i]);
    }
    if (completedPoints.length === 0) completedPoints = [screenPoints[0]];
    const destination = worldToDirector(pointAtProgress(camera.progress));
    completedPoints.push(destination);

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    traceRoute(ctx, screenPoints);
    ctx.strokeStyle = "rgba(11, 15, 12, 0.36)";
    ctx.lineWidth = 7;
    ctx.stroke();

    traceRoute(ctx, screenPoints);
    ctx.strokeStyle = "rgba(255, 247, 228, 0.58)";
    ctx.lineWidth = 2;
    ctx.setLineDash([1, 7]);
    ctx.stroke();
    ctx.setLineDash([]);

    traceRoute(ctx, completedPoints);
    ctx.strokeStyle = "rgba(255, 107, 61, 0.96)";
    ctx.lineWidth = 2.6;
    ctx.stroke();

    for (const key of project.keyframes) {
      const point = worldToDirector(pointAtProgress(key.time / project.duration));
      const selected = key.id === selectedKeyId;
      ctx.save();
      ctx.translate(point.x, point.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = selected ? "#ff6b3d" : "#f4e8d1";
      ctx.strokeStyle = "rgba(20, 23, 18, 0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(-4.2, -4.2, 8.4, 8.4);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    const arrowLength = 17;
    ctx.fillStyle = "#fff8e7";
    ctx.beginPath();
    ctx.moveTo(destination.x + Math.cos(camera.angle) * arrowLength, destination.y + Math.sin(camera.angle) * arrowLength);
    ctx.lineTo(
      destination.x + Math.cos(camera.angle + 2.55) * 7,
      destination.y + Math.sin(camera.angle + 2.55) * 7
    );
    ctx.lineTo(
      destination.x + Math.cos(camera.angle - 2.55) * 7,
      destination.y + Math.sin(camera.angle - 2.55) * 7
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function renderDirector() {
    const ctx = directorCanvas.ctx;
    const width = directorCanvas.width;
    const height = directorCanvas.height;
    directorView = getDirectorView(width, height);
    const camera = getCameraState();

    ctx.setTransform(directorCanvas.dpr, 0, 0, directorCanvas.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#0d100c";
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.beginPath();
    ctx.rect(directorView.x, directorView.y, directorView.width, directorView.height);
    ctx.clip();
    ctx.drawImage(worldImage, directorView.x, directorView.y, directorView.width, directorView.height);

    const edgeShade = ctx.createRadialGradient(
      width * 0.5, height * 0.47, Math.min(width, height) * 0.2,
      width * 0.5, height * 0.47, Math.max(width, height) * 0.65
    );
    edgeShade.addColorStop(0, "rgba(12, 17, 14, 0)");
    edgeShade.addColorStop(1, "rgba(12, 17, 14, 0.2)");
    ctx.fillStyle = edgeShade;
    ctx.fillRect(directorView.x, directorView.y, directorView.width, directorView.height);
    ctx.restore();

    drawRoute(ctx, camera);
    drawCameraFrame(ctx, camera);
    drawHandles(ctx);
  }

  function renderPreview() {
    const ctx = previewCanvas.ctx;
    const width = previewCanvas.width;
    const height = previewCanvas.height;
    const camera = getCameraState();
    const viewWorldWidth = BASE_VIEW_WIDTH / camera.zoom;
    const scale = width / viewWorldWidth;

    ctx.setTransform(previewCanvas.dpr, 0, 0, previewCanvas.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#151a15";
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    ctx.translate(width / 2, height / 2);
    ctx.rotate(-camera.rotation * (Math.PI / 180));
    ctx.scale(scale, scale);
    ctx.translate(-camera.x, -camera.y);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(worldImage, 0, 0);
    ctx.restore();

    const grade = ctx.createLinearGradient(0, 0, 0, height);
    grade.addColorStop(0, "rgba(12, 24, 23, 0.18)");
    grade.addColorStop(0.46, "rgba(12, 24, 23, 0)");
    grade.addColorStop(1, "rgba(9, 18, 16, 0.17)");
    ctx.fillStyle = grade;
    ctx.fillRect(0, 0, width, height);

    const vignette = ctx.createRadialGradient(width / 2, height / 2, height * 0.25, width / 2, height / 2, width * 0.62);
    vignette.addColorStop(0, "rgba(4, 7, 5, 0)");
    vignette.addColorStop(1, "rgba(4, 7, 5, 0.25)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }

  function render() {
    renderDirector();
    renderPreview();
    needsRender = false;
  }

  function localCanvasPoint(event) {
    const rect = dom.directorCanvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  function findHandleAt(x, y) {
    if (!directorView) return null;
    let best = null;
    let bestDistance = 17;
    for (const meta of HANDLE_META) {
      const point = worldToDirector(project.path[meta.key]);
      const distance = Math.hypot(x - point.x, y - point.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = meta.key;
      }
    }
    return best;
  }

  function updateCanvasCursor() {
    if (draggingHandle) dom.directorCanvas.style.cursor = "grabbing";
    else if (hoverHandle) dom.directorCanvas.style.cursor = "grab";
    else dom.directorCanvas.style.cursor = "crosshair";
  }

  function onDirectorPointerDown(event) {
    if (event.button !== 0) return;
    const local = localCanvasPoint(event);
    const handle = findHandleAt(local.x, local.y);
    if (!handle) return;
    event.preventDefault();
    draggingHandle = handle;
    hoverHandle = handle;
    dom.directorCanvas.setPointerCapture(event.pointerId);
    dom.grabHint.classList.add("is-hidden");
    updateCanvasCursor();
    needsRender = true;
  }

  function onDirectorPointerMove(event) {
    const local = localCanvasPoint(event);
    if (!directorView) return;
    const world = screenToWorld(local.x, local.y);
    const clamped = {
      x: clamp(world.x, 0, WORLD_WIDTH),
      y: clamp(world.y, 0, WORLD_HEIGHT)
    };
    dom.canvasReadout.textContent = `X ${Math.round(clamped.x).toString().padStart(3, "0")} · Y ${Math.round(clamped.y).toString().padStart(3, "0")}`;

    if (draggingHandle) {
      project.path[draggingHandle] = clamped;
      geometry = null;
      geometry = buildGeometry();
      markDirty();
      updateCameraReadouts();
      needsRender = true;
      return;
    }

    const handle = findHandleAt(local.x, local.y);
    if (handle !== hoverHandle) {
      hoverHandle = handle;
      updateCanvasCursor();
      needsRender = true;
    }
  }

  function onDirectorPointerUp(event) {
    if (!draggingHandle) return;
    if (dom.directorCanvas.hasPointerCapture(event.pointerId)) {
      dom.directorCanvas.releasePointerCapture(event.pointerId);
    }
    draggingHandle = null;
    hoverHandle = findHandleAt(localCanvasPoint(event).x, localCanvasPoint(event).y);
    updateCanvasCursor();
    needsRender = true;
  }

  function onDirectorPointerLeave() {
    if (draggingHandle) return;
    hoverHandle = null;
    updateCanvasCursor();
    needsRender = true;
  }

  function scrubTimeline(event) {
    const rect = dom.timeline.getBoundingClientRect();
    const progress = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    setTime(progress * project.duration);
  }

  function onTimelinePointerDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    scrubbing = true;
    setPlaying(false);
    dom.timeline.setPointerCapture(event.pointerId);
    scrubTimeline(event);
  }

  function onTimelinePointerMove(event) {
    if (!scrubbing) return;
    scrubTimeline(event);
  }

  function onTimelinePointerUp(event) {
    if (!scrubbing) return;
    scrubbing = false;
    if (dom.timeline.hasPointerCapture(event.pointerId)) {
      dom.timeline.releasePointerCapture(event.pointerId);
    }
  }

  function selectKeyframe(id, seek) {
    const key = project.keyframes.find((item) => item.id === id);
    if (!key) return;
    selectedKeyId = key.id;
    if (seek) {
      setPlaying(false);
      setTime(key.time);
    }
    renderKeyframeList();
    renderTimelineKeys();
    syncKeyEditor();
    needsRender = true;
  }

  function addKeyframeAtCurrentTime() {
    const camera = getCameraState();
    let key = project.keyframes.find((item) => Math.abs(item.time - time) < 0.04);
    if (!key) {
      key = {
        id: nextKeyIdValue(),
        time: Math.round(time * 100) / 100,
        zoom: Math.round(camera.zoom * 100) / 100,
        rotation: Math.round(camera.rotation * 10) / 10
      };
      project.keyframes.push(key);
      project.keyframes.sort((a, b) => a.time - b.time);
      markDirty();
      showToast(`已在 ${key.time.toFixed(2)}s 添加关键帧`);
    } else {
      showToast(`当前时间已有关键帧 · ${key.time.toFixed(2)}s`);
    }
    setPlaying(false);
    selectedKeyId = key.id;
    renderKeyframeList();
    renderTimelineKeys();
    syncKeyEditor();
    updateCameraReadouts();
    needsRender = true;
  }

  function deleteSelectedKeyframe() {
    if (project.keyframes.length <= 1) return;
    const index = project.keyframes.findIndex((key) => key.id === selectedKeyId);
    if (index < 0) return;
    const removed = project.keyframes[index];
    project.keyframes.splice(index, 1);
    selectedKeyId = project.keyframes[Math.min(index, project.keyframes.length - 1)].id;
    markDirty();
    renderKeyframeList();
    renderTimelineKeys();
    syncKeyEditor();
    updateCameraReadouts();
    needsRender = true;
    showToast(`已删除 ${removed.time.toFixed(2)}s 关键帧`);
  }

  function updateSelectedKeyFromSliders() {
    const key = currentSelectedKey();
    if (!key) return;
    key.zoom = clamp(Number(dom.zoomInput.value), 0.75, 3.2);
    key.rotation = clamp(Number(dom.rotationInput.value), -45, 45);
    dom.zoomValue.textContent = formatZoom(key.zoom);
    dom.rotationValue.textContent = formatAngle(key.rotation, 0);
    markDirty();
    renderKeyframeList();
    renderTimelineKeys();
    updateCameraReadouts();
    needsRender = true;
  }

  async function loadProjectFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      applyProject(parsed, "JSON 已载入");
      showToast(`已载入镜头路线 · ${project.duration.toFixed(2)}s · ${project.keyframes.length} 个关键帧`);
    } catch (error) {
      showToast(error instanceof SyntaxError ? "JSON 格式无法解析" : error.message || "载入失败", true);
    } finally {
      dom.fileInput.value = "";
    }
  }

  function resizeAll() {
    const directorChanged = resizeCanvas(directorCanvas);
    const previewChanged = resizeCanvas(previewCanvas);
    if (directorChanged || previewChanged) needsRender = true;
  }

  let previousFrame = performance.now();

  function animationTick(now) {
    const delta = Math.min(0.08, Math.max(0, (now - previousFrame) / 1000));
    previousFrame = now;
    if (playing) {
      time += delta;
      if (time >= project.duration) {
        if (project.loop) {
          time %= project.duration;
        } else {
          time = project.duration;
          setPlaying(false);
        }
      }
      updateCameraReadouts();
      needsRender = true;
    }
    if (needsRender) render();
    window.requestAnimationFrame(animationTick);
  }

  function handleKeyboard(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      downloadProject();
      return;
    }
    if (event.target === dom.timeline) return;
    const tag = event.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") return;

    if (event.code === "Space") {
      event.preventDefault();
      togglePlayback();
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      setPlaying(false);
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const step = event.shiftKey ? 1 : 1 / 24;
      setTime(time + direction * step);
    }
  }

  dom.playButton.addEventListener("click", togglePlayback);
  dom.loopButton.addEventListener("click", () => {
    project.loop = !project.loop;
    dom.loopButton.classList.toggle("is-active", project.loop);
    dom.loopButton.setAttribute("aria-pressed", project.loop ? "true" : "false");
    markDirty();
  });
  dom.timeline.addEventListener("pointerdown", onTimelinePointerDown);
  dom.timeline.addEventListener("pointermove", onTimelinePointerMove);
  dom.timeline.addEventListener("pointerup", onTimelinePointerUp);
  dom.timeline.addEventListener("pointercancel", onTimelinePointerUp);
  dom.timeline.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      setPlaying(false);
      setTime(time + (event.key === "ArrowRight" ? 1 : -1) / 24);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setPlaying(false);
      setTime(event.key === "Home" ? 0 : project.duration);
    } else if (event.code === "Space") {
      event.preventDefault();
      togglePlayback();
    }
  });
  dom.directorCanvas.addEventListener("pointerdown", onDirectorPointerDown);
  dom.directorCanvas.addEventListener("pointermove", onDirectorPointerMove);
  dom.directorCanvas.addEventListener("pointerup", onDirectorPointerUp);
  dom.directorCanvas.addEventListener("pointercancel", onDirectorPointerUp);
  dom.directorCanvas.addEventListener("pointerleave", onDirectorPointerLeave);

  dom.keyframeList.addEventListener("click", (event) => {
    const row = event.target.closest(".keyframe-row");
    if (row) selectKeyframe(row.dataset.keyId, true);
  });
  dom.addKeyframeButton.addEventListener("click", addKeyframeAtCurrentTime);
  dom.deleteKeyframeButton.addEventListener("click", deleteSelectedKeyframe);
  dom.zoomInput.addEventListener("input", updateSelectedKeyFromSliders);
  dom.rotationInput.addEventListener("input", updateSelectedKeyFromSliders);
  dom.saveButton.addEventListener("click", downloadProject);
  dom.loadButton.addEventListener("click", () => dom.fileInput.click());
  dom.fileInput.addEventListener("change", () => loadProjectFile(dom.fileInput.files[0]));

  document.addEventListener("keydown", handleKeyboard);

  const resizeObserver = new ResizeObserver(resizeAll);
  resizeObserver.observe(dom.stage);
  resizeObserver.observe(dom.previewCanvas.parentElement);
  window.addEventListener("resize", resizeAll);

  project.keyframes = prepareKeys(project.keyframes);
  selectedKeyId = project.keyframes[0].id;
  markClean("示例已载入");
  refreshAllUI();
  resizeAll();
  render();
  window.requestAnimationFrame(animationTick);
})();
