(() => {
  "use strict";

  const START_MINUTE = 7 * 60;
  const END_MINUTE = 10 * 60;
  const SAMPLE_STEP = 1;
  const SAMPLE_COUNT = (END_MINUTE - START_MINUTE) / SAMPLE_STEP;
  const FLOOR_AREA = 860;

  const HOTSPOTS = [
    {
      id: "gate-west",
      code: "GATE-01",
      symbol: "西",
      name: "西侧出站闸口",
      category: "出站闸口",
      kind: "gate",
      x: 0.14,
      y: 0.445,
      w: 0.13,
      h: 0.16,
      capacity: 92,
      base: 18,
      normalPeaks: [[72, 17, 34], [137, 22, 18]],
      surgeBoost: 76,
      surgeCenter: 94,
      phase: 1.4,
    },
    {
      id: "gate-center",
      code: "GATE-02",
      symbol: "中",
      name: "中央换乘闸口",
      category: "换乘闸口",
      kind: "gate",
      x: 0.435,
      y: 0.445,
      w: 0.13,
      h: 0.16,
      capacity: 118,
      base: 24,
      normalPeaks: [[82, 19, 49], [145, 17, 27]],
      surgeBoost: 142,
      surgeCenter: 95,
      phase: 0.2,
    },
    {
      id: "gate-east",
      code: "GATE-03",
      symbol: "东",
      name: "东侧出站闸口",
      category: "出站闸口",
      kind: "gate",
      x: 0.73,
      y: 0.445,
      w: 0.13,
      h: 0.16,
      capacity: 98,
      base: 20,
      normalPeaks: [[87, 22, 40], [150, 18, 22]],
      surgeBoost: 87,
      surgeCenter: 97,
      phase: 2.1,
    },
    {
      id: "passage-north",
      code: "PASS-01",
      symbol: "北",
      name: "北侧换乘通道",
      category: "换乘通道",
      kind: "passage",
      x: 0.435,
      y: 0.205,
      w: 0.13,
      h: 0.2,
      capacity: 135,
      base: 31,
      normalPeaks: [[79, 22, 57], [143, 21, 29]],
      surgeBoost: 111,
      surgeCenter: 93,
      phase: 3.2,
    },
    {
      id: "passage-south",
      code: "PASS-02",
      symbol: "南",
      name: "南侧疏散通道",
      category: "疏散通道",
      kind: "passage",
      x: 0.435,
      y: 0.67,
      w: 0.13,
      h: 0.19,
      capacity: 108,
      base: 17,
      normalPeaks: [[93, 20, 26], [155, 17, 42]],
      surgeBoost: 91,
      surgeCenter: 100,
      phase: 4.1,
    },
    {
      id: "passage-east",
      code: "PASS-03",
      symbol: "东",
      name: "东侧连接通道",
      category: "连接通道",
      kind: "passage",
      x: 0.79,
      y: 0.635,
      w: 0.075,
      h: 0.18,
      capacity: 96,
      base: 20,
      normalPeaks: [[85, 24, 38], [149, 19, 20]],
      surgeBoost: 78,
      surgeCenter: 101,
      phase: 5.3,
    },
  ];

  const state = {
    scene: "normal",
    selectedId: "gate-center",
    filter: "all",
    playhead: 0,
    playing: false,
    speed: 1,
    dotClock: 0,
    hoverId: null,
    lastFrame: performance.now(),
  };

  const dom = {
    body: document.body,
    mapStage: document.getElementById("mapStage"),
    stationCanvas: document.getElementById("stationCanvas"),
    timelineCanvas: document.getElementById("timelineCanvas"),
    detailCanvas: document.getElementById("detailCanvas"),
    timelineWrap: document.getElementById("timelineWrap"),
    timeSlider: document.getElementById("timeSlider"),
    playButton: document.getElementById("playButton"),
    playStateText: document.getElementById("playStateText"),
    currentTime: document.getElementById("currentTime"),
    detailTime: document.getElementById("detailTime"),
    syncTime: document.getElementById("syncTime"),
    tooltip: document.getElementById("mapTooltip"),
    hotspotHits: document.getElementById("hotspotHits"),
    hotspotList: document.getElementById("hotspotList"),
    listCount: document.getElementById("listCount"),
    selectedSymbol: document.getElementById("selectedSymbol"),
    selectedName: document.getElementById("selectedName"),
    selectedCategory: document.getElementById("selectedCategory"),
    selectedStatus: document.getElementById("selectedStatus"),
    selectedCount: document.getElementById("selectedCount"),
    selectedIndex: document.getElementById("selectedIndex"),
    selectedPeak: document.getElementById("selectedPeak"),
    emptyChart: document.getElementById("emptyChart"),
    statPeople: document.getElementById("statPeople"),
    statHotspots: document.getElementById("statHotspots"),
    statDensity: document.getElementById("statDensity"),
    statEfficiency: document.getElementById("statEfficiency"),
    peopleTrend: document.getElementById("peopleTrend"),
    hotspotTrend: document.getElementById("hotspotTrend"),
    densityLevel: document.getElementById("densityLevel"),
    efficiencyTrend: document.getElementById("efficiencyTrend"),
  };

  const sceneButtons = [...document.querySelectorAll("[data-scene]")];
  const filterButtons = [...document.querySelectorAll("[data-filter]")];
  const speedButtons = [...document.querySelectorAll("[data-speed]")];
  const mapContext = dom.stationCanvas.getContext("2d");
  const timelineContext = dom.timelineCanvas.getContext("2d");
  const detailContext = dom.detailCanvas.getContext("2d");

  function gaussian(minute, center, width) {
    return Math.exp(-0.5 * Math.pow((minute - center) / width, 2));
  }

  function smoothNoise(minute, phase) {
    return (
      Math.sin((minute + phase * 9) * 0.31) * 2.5 +
      Math.sin((minute + phase * 13) * 0.13) * 1.8
    );
  }

  function buildScene(sceneName) {
    const points = [];
    const isSurge = sceneName === "surge";

    for (let minute = 0; minute <= SAMPLE_COUNT; minute += SAMPLE_STEP) {
      const hotspotCounts = {};
      HOTSPOTS.forEach((hotspot) => {
        const normalCurve = hotspot.normalPeaks.reduce(
          (sum, [center, width, height]) =>
            sum + height * gaussian(minute, center, width),
          0
        );
        const suddenCurve = isSurge
          ? hotspot.surgeBoost * gaussian(minute, hotspot.surgeCenter, 7) +
            hotspot.surgeBoost * 0.24 * gaussian(minute, 124, 25)
          : 0;
        const sceneBase = isSurge ? hotspot.base * 1.08 : hotspot.base;
        const count = Math.max(
          4,
          Math.round(sceneBase + normalCurve + suddenCurve + smoothNoise(minute, hotspot.phase))
        );
        hotspotCounts[hotspot.id] = count;
      });

      const hotspotSum = Object.values(hotspotCounts).reduce((sum, count) => sum + count, 0);
      const total = Math.round(
        185 +
          hotspotSum * 0.91 +
          82 * gaussian(minute, 101, 42) +
          (isSurge ? 105 * gaussian(minute, 101, 26) : 0)
      );

      points.push({
        minute,
        counts: hotspotCounts,
        total,
        density: total / FLOOR_AREA,
      });
    }

    points.forEach((point, index) => {
      const crowded = HOTSPOTS.filter(
        (hotspot) =>
          congestionIndex(hotspot, point.counts[hotspot.id]) >= 76
      ).length;
      const averageIndex =
        HOTSPOTS.reduce(
          (sum, hotspot) =>
            sum + congestionIndex(hotspot, point.counts[hotspot.id]),
          0
        ) / HOTSPOTS.length;
      point.crowded = crowded;
      point.efficiency = Math.max(
        34,
        Math.min(
          99,
          Math.round(98 - crowded * 4.8 - Math.max(0, averageIndex - 45) * 0.2)
        )
      );
      point.previousDifference = index >= 5 ? point.total - points[index - 5].total : 0;
    });

    return points;
  }

  function congestionIndex(hotspot, count) {
    return Math.min(100, Math.round((count / hotspot.capacity) * 100));
  }

  const scenes = {
    normal: buildScene("normal"),
    surge: buildScene("surge"),
  };

  function minuteToClock(minute) {
    const absolute = START_MINUTE + Math.round(minute);
    const hour = Math.floor(absolute / 60) % 24;
    const minutePart = absolute % 60;
    return `${String(hour).padStart(2, "0")}:${String(minutePart).padStart(2, "0")}`;
  }

  function currentPoint() {
    const index = Math.max(
      0,
      Math.min(SAMPLE_COUNT, Math.round(state.playhead))
    );
    return scenes[state.scene][index];
  }

  function getHotspot(id) {
    return HOTSPOTS.find((hotspot) => hotspot.id === id) || HOTSPOTS[0];
  }

  function kindMatchesFilter(hotspot) {
    return state.filter === "all" || hotspot.kind === state.filter;
  }

  function levelFor(index) {
    if (index >= 90) {
      return { key: "alert", label: "拥挤" };
    }
    if (index >= 70) {
      return { key: "watch", label: "较拥挤" };
    }
    return { key: "smooth", label: "畅通" };
  }

  function formatSignedPercent(value, current) {
    if (!current) return "较 5 分钟前 0%";
    const percent = (value / Math.max(1, current - value)) * 100;
    const prefix = percent > 0 ? "+" : "";
    return `较 5 分钟前 ${prefix}${percent.toFixed(1)}%`;
  }

  function updateStats(point) {
    const selected = getHotspot(state.selectedId);
    const selectedCount = point.counts[selected.id];
    const selectedIndex = congestionIndex(selected, selectedCount);
    const selectedStatus = levelFor(selectedIndex);
    const currentClock = minuteToClock(state.playhead);
    const peak = Math.max(
      ...scenes[state.scene].map((sample) => sample.counts[selected.id])
    );

    dom.statPeople.textContent = point.total.toLocaleString("zh-CN");
    dom.statHotspots.textContent = point.crowded;
    dom.statDensity.textContent = point.density.toFixed(1);
    dom.statEfficiency.textContent = point.efficiency;
    dom.peopleTrend.textContent = formatSignedPercent(
      point.previousDifference,
      point.total
    );
    dom.peopleTrend.classList.toggle("is-up", point.previousDifference >= 0);
    dom.hotspotTrend.textContent = `需关注 ${point.crowded} 处`;
    dom.densityLevel.textContent =
      point.density < 0.75 ? "舒适" : point.density < 1.25 ? "适中" : "密集";
    dom.efficiencyTrend.textContent =
      point.efficiency > 78 ? "运行平稳" : point.efficiency > 58 ? "局部缓行" : "疏导中";
    dom.currentTime.textContent = currentClock;
    dom.detailTime.textContent = currentClock;
    dom.syncTime.textContent = currentClock;
    dom.timeSlider.value = String(Math.round(state.playhead));
    dom.timelineWrap.style.setProperty(
      "--playhead",
      `${(state.playhead / SAMPLE_COUNT) * 100}%`
    );

    dom.selectedSymbol.textContent = selected.symbol;
    dom.selectedName.textContent = selected.name;
    dom.selectedCategory.textContent = `${selected.category} · ${selected.code}`;
    dom.selectedStatus.textContent = selectedStatus.label;
    dom.selectedStatus.className = `status-badge ${
      selectedStatus.key === "smooth" ? "" : `is-${selectedStatus.key}`
    }`;
    dom.selectedCount.innerHTML = `${selectedCount}<small> 人</small>`;
    dom.selectedIndex.innerHTML = `${selectedIndex}<small> / 100</small>`;
    dom.selectedPeak.innerHTML = `${peak}<small> 人</small>`;
    dom.emptyChart.classList.remove("is-visible");

    document.querySelectorAll(".hotspot-hit").forEach((button) => {
      const hotspot = getHotspot(button.dataset.hotspot);
      const count = point.counts[hotspot.id];
      button.setAttribute(
        "aria-label",
        `${hotspot.name}，当前 ${count} 人，拥挤指数 ${congestionIndex(
          hotspot,
          count
        )}`
      );
    });
  }

  function renderHotspotList(point) {
    const visibleHotspots = HOTSPOTS.filter(kindMatchesFilter);
    dom.listCount.textContent = `共 ${visibleHotspots.length} 处`;
    dom.hotspotList.innerHTML = visibleHotspots
      .map((hotspot) => {
        const count = point.counts[hotspot.id];
        const index = congestionIndex(hotspot, count);
        const level = levelFor(index);
        return `
          <button
            class="hotspot-row ${state.selectedId === hotspot.id ? "is-selected" : ""}"
            data-hotspot-row="${hotspot.id}"
            data-level="${level.key}"
            type="button"
            aria-pressed="${state.selectedId === hotspot.id}"
          >
            <span class="row-symbol">${hotspot.symbol}</span>
            <span class="row-name">
              <strong>${hotspot.name}</strong>
              <span>${level.label} · ${hotspot.category}</span>
            </span>
            <span class="density-bar" aria-hidden="true"><i style="width:${index}%"></i></span>
            <span class="row-count"><strong>${count}</strong> 人</span>
          </button>
        `;
      })
      .join("");

    dom.hotspotList.querySelectorAll("[data-hotspot-row]").forEach((button) => {
      button.addEventListener("click", () => selectHotspot(button.dataset.hotspotRow));
    });
  }

  function buildHotspotHits() {
    dom.hotspotHits.innerHTML = HOTSPOTS.map(
      (hotspot) => `
        <button
          class="hotspot-hit"
          type="button"
          data-hotspot="${hotspot.id}"
          style="left:${hotspot.x * 100}%;top:${hotspot.y * 100}%;width:${
            hotspot.w * 100
          }%;height:${hotspot.h * 100}%"
        ></button>
      `
    ).join("");

    dom.hotspotHits.querySelectorAll("[data-hotspot]").forEach((button) => {
      const hotspot = getHotspot(button.dataset.hotspot);
      button.addEventListener("click", () => selectHotspot(hotspot.id));
      button.addEventListener("pointerenter", (event) => {
        state.hoverId = hotspot.id;
        showTooltip(hotspot, event.clientX, event.clientY);
      });
      button.addEventListener("pointermove", (event) => {
        showTooltip(hotspot, event.clientX, event.clientY);
      });
      button.addEventListener("pointerleave", hideTooltip);
      button.addEventListener("focus", () => {
        const bounds = button.getBoundingClientRect();
        showTooltip(hotspot, bounds.left + bounds.width / 2, bounds.top + 5);
      });
      button.addEventListener("blur", hideTooltip);
    });
  }

  function showTooltip(hotspot, clientX, clientY) {
    const point = currentPoint();
    const count = point.counts[hotspot.id];
    const index = congestionIndex(hotspot, count);
    const bounds = dom.mapStage.getBoundingClientRect();
    dom.tooltip.innerHTML = `<strong>${hotspot.name}</strong><span>${count} 人 · 拥挤指数 ${index}</span>`;
    dom.tooltip.style.left = `${clientX - bounds.left}px`;
    dom.tooltip.style.top = `${clientY - bounds.top}px`;
    dom.tooltip.classList.add("is-visible");
  }

  function hideTooltip() {
    state.hoverId = null;
    dom.tooltip.classList.remove("is-visible");
  }

  function selectHotspot(id) {
    if (!id || !getHotspot(id)) return;
    state.selectedId = id;
    updateStats(currentPoint());
    renderHotspotList(currentPoint());
    syncDataset();
    drawStation();
    drawDetailChart();
  }

  function syncFilterUI() {
    document.querySelectorAll(".hotspot-hit").forEach((button) => {
      const hotspot = getHotspot(button.dataset.hotspot);
      button.classList.toggle("is-filtered", !kindMatchesFilter(hotspot));
    });
    filterButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.filter === state.filter);
    });
  }

  function setFilter(filter) {
    state.filter = filter;
    if (!kindMatchesFilter(getHotspot(state.selectedId))) {
      const firstVisible = HOTSPOTS.find(kindMatchesFilter);
      if (firstVisible) state.selectedId = firstVisible.id;
    }
    syncFilterUI();
    const point = currentPoint();
    updateStats(point);
    renderHotspotList(point);
    syncDataset();
    drawStation();
    drawDetailChart();
  }

  function fitCanvas(canvas, context) {
    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const bitmapWidth = Math.round(width * ratio);
    const bitmapHeight = Math.round(height * ratio);
    if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
      canvas.width = bitmapWidth;
      canvas.height = bitmapHeight;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { width, height, ratio };
  }

  function roundedRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  function heatColor(index, alpha = 1) {
    const stops =
      index < 55
        ? [89, 176, 140]
        : index < 78
          ? [220, 181, 76]
          : [234, 105, 67];
    return `rgba(${stops[0]}, ${stops[1]}, ${stops[2]}, ${alpha})`;
  }

  function drawMapBackground(context, width, height) {
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#f3f5f1";
    context.fillRect(0, 0, width, height);

    context.save();
    context.fillStyle = "rgba(121, 136, 128, 0.12)";
    const gap = 18;
    for (let x = 9; x < width; x += gap) {
      for (let y = 9; y < height; y += gap) {
        context.beginPath();
        context.arc(x, y, 0.65, 0, Math.PI * 2);
        context.fill();
      }
    }

    const wash = context.createRadialGradient(
      width * 0.47,
      height * 0.43,
      0,
      width * 0.47,
      height * 0.43,
      width * 0.7
    );
    wash.addColorStop(0, "rgba(255, 255, 255, 0.7)");
    wash.addColorStop(1, "rgba(255, 255, 255, 0)");
    context.fillStyle = wash;
    context.fillRect(0, 0, width, height);
    context.restore();
  }

  function drawFloorPlan(context, width, height) {
    const w = width;
    const h = height;
    const scale = Math.max(0.72, Math.min(1.15, width / 920));

    context.save();
    context.shadowColor = "rgba(36, 52, 54, 0.07)";
    context.shadowBlur = 24;
    context.shadowOffsetY = 8;
    roundedRect(context, w * 0.055, h * 0.06, w * 0.89, h * 0.875, 14 * scale);
    context.fillStyle = "#fffefa";
    context.fill();
    context.shadowColor = "transparent";
    context.strokeStyle = "#dfe5dd";
    context.lineWidth = 1;
    context.stroke();

    roundedRect(context, w * 0.085, h * 0.075, w * 0.83, h * 0.185, 9 * scale);
    context.fillStyle = "#eef1eb";
    context.fill();
    context.strokeStyle = "#dce2da";
    context.stroke();

    context.strokeStyle = "#cdd6ce";
    context.lineWidth = 1.2;
    [0.115, 0.17].forEach((yPos) => {
      context.beginPath();
      context.moveTo(w * 0.1, h * yPos);
      context.lineTo(w * 0.9, h * yPos);
      context.stroke();
    });
    context.strokeStyle = "#e1e6df";
    context.lineWidth = 0.7;
    for (let x = 0.12; x < 0.9; x += 0.025) {
      context.beginPath();
      context.moveTo(w * x, h * 0.104);
      context.lineTo(w * x, h * 0.126);
      context.moveTo(w * x, h * 0.159);
      context.lineTo(w * x, h * 0.181);
      context.stroke();
    }

    drawTrain(context, w * 0.18, h * 0.093, w * 0.25, h * 0.039, scale);
    drawTrain(context, w * 0.61, h * 0.147, w * 0.22, h * 0.037, scale);

    roundedRect(context, w * 0.435, h * 0.2, w * 0.13, h * 0.205, 5 * scale);
    context.fillStyle = "#f9f9f5";
    context.fill();
    context.strokeStyle = "#e0e5dd";
    context.stroke();

    roundedRect(context, w * 0.1, h * 0.32, w * 0.8, h * 0.46, 10 * scale);
    context.fillStyle = "#fbfcf8";
    context.fill();
    context.strokeStyle = "#dfe4dd";
    context.lineWidth = 1.1;
    context.stroke();

    roundedRect(context, w * 0.435, h * 0.69, w * 0.13, h * 0.18, 5 * scale);
    context.fillStyle = "#fafaf6";
    context.fill();
    context.stroke();

    roundedRect(context, w * 0.79, h * 0.575, w * 0.075, h * 0.24, 5 * scale);
    context.fillStyle = "#fafaf6";
    context.fill();
    context.stroke();

    context.strokeStyle = "#d6ded6";
    context.setLineDash([5, 5]);
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(w * 0.435, h * 0.405);
    context.lineTo(w * 0.565, h * 0.405);
    context.moveTo(w * 0.435, h * 0.69);
    context.lineTo(w * 0.565, h * 0.69);
    context.stroke();
    context.setLineDash([]);

    drawHallDetails(context, w, h, scale);
    drawLabels(context, w, h, scale);
    context.restore();
  }

  function drawTrain(context, x, y, width, height, scale) {
    context.save();
    roundedRect(context, x, y, width, height, 5 * scale);
    context.fillStyle = "#e5ebec";
    context.strokeStyle = "#c6d1d3";
    context.lineWidth = 0.8;
    context.fill();
    context.stroke();
    context.fillStyle = "#c3d0d2";
    for (let i = 0; i < 4; i += 1) {
      roundedRect(
        context,
        x + width * 0.08 + i * width * 0.23,
        y + height * 0.27,
        width * 0.15,
        height * 0.42,
        1.5
      );
      context.fill();
    }
    context.restore();
  }

  function drawHallDetails(context, w, h, scale) {
    context.save();

    const pillars = [
      [0.17, 0.36],
      [0.33, 0.36],
      [0.67, 0.36],
      [0.83, 0.36],
      [0.17, 0.68],
      [0.33, 0.68],
      [0.67, 0.68],
      [0.83, 0.68],
    ];
    pillars.forEach(([x, y]) => {
      context.fillStyle = "#d4dbd4";
      context.fillRect(w * x - 1.8 * scale, h * y - 1.8 * scale, 3.6 * scale, 3.6 * scale);
      context.strokeStyle = "#bdc7bf";
      context.strokeRect(w * x - 1.8 * scale, h * y - 1.8 * scale, 3.6 * scale, 3.6 * scale);
    });

    context.strokeStyle = "#dce2db";
    context.lineWidth = 0.8;
    [
      [0.205, 0.43],
      [0.205, 0.54],
      [0.74, 0.43],
      [0.74, 0.54],
    ].forEach(([x, y]) => {
      context.strokeRect(w * x, h * y, w * 0.045, h * 0.052);
      context.beginPath();
      context.moveTo(w * (x + 0.009), h * (y + 0.015));
      context.lineTo(w * (x + 0.036), h * (y + 0.015));
      context.moveTo(w * (x + 0.009), h * (y + 0.027));
      context.lineTo(w * (x + 0.036), h * (y + 0.027));
      context.stroke();
    });

    drawGateBars(context, w * 0.148, h * 0.51, w * 0.114, h * 0.055, scale);
    drawGateBars(context, w * 0.443, h * 0.51, w * 0.114, h * 0.055, scale);
    drawGateBars(context, w * 0.738, h * 0.51, w * 0.114, h * 0.055, scale);

    drawDirectionArrow(context, w * 0.5, h * 0.28, 0, scale, "#b8c2bb");
    drawDirectionArrow(context, w * 0.5, h * 0.73, Math.PI, scale, "#b8c2bb");
    drawDirectionArrow(context, w * 0.825, h * 0.62, Math.PI / 2, scale, "#b8c2bb");

    drawStair(context, w * 0.125, h * 0.7, w * 0.042, h * 0.06, scale);
    drawStair(context, w * 0.835, h * 0.7, w * 0.042, h * 0.06, scale);
    drawStair(context, w * 0.3, h * 0.74, w * 0.042, h * 0.05, scale);
    drawStair(context, w * 0.66, h * 0.74, w * 0.042, h * 0.05, scale);

    context.restore();
  }

  function drawGateBars(context, x, y, width, height, scale) {
    context.save();
    context.fillStyle = "#e8ece7";
    context.fillRect(x, y, width, height);
    context.strokeStyle = "#b9c4bb";
    context.lineWidth = 1;
    const stalls = 4;
    for (let i = 0; i <= stalls; i += 1) {
      const px = x + (width / stalls) * i;
      context.beginPath();
      context.moveTo(px, y);
      context.lineTo(px, y + height);
      context.stroke();
    }
    context.strokeStyle = "#8fa296";
    context.lineWidth = 1.2;
    for (let i = 0; i < stalls; i += 1) {
      context.beginPath();
      context.moveTo(x + (width / stalls) * i + 5 * scale, y + height * 0.2);
      context.lineTo(x + (width / stalls) * i + 5 * scale, y + height * 0.8);
      context.stroke();
    }
    context.restore();
  }

  function drawDirectionArrow(context, x, y, rotation, scale, color) {
    context.save();
    context.translate(x, y);
    context.rotate(rotation);
    context.strokeStyle = color;
    context.lineWidth = 1.1;
    context.beginPath();
    context.moveTo(0, 10 * scale);
    context.lineTo(0, -8 * scale);
    context.moveTo(-4 * scale, -4 * scale);
    context.lineTo(0, -8 * scale);
    context.lineTo(4 * scale, -4 * scale);
    context.stroke();
    context.restore();
  }

  function drawStair(context, x, y, width, height, scale) {
    context.save();
    context.strokeStyle = "#d4dcd4";
    context.lineWidth = 0.8;
    context.strokeRect(x, y, width, height);
    for (let i = 1; i < 5; i += 1) {
      const px = x + (width / 5) * i;
      context.beginPath();
      context.moveTo(px, y);
      context.lineTo(px, y + height);
      context.stroke();
    }
    context.restore();
  }

  function drawLabels(context, w, h, scale) {
    context.save();
    context.fillStyle = "#8e9993";
    context.font = `600 ${9 * scale}px "Noto Sans SC", sans-serif`;
    context.textAlign = "left";
    context.fillText("到达站台", w * 0.1, h * 0.098);
    context.font = `500 ${7 * scale}px "Noto Sans SC", sans-serif`;
    context.fillStyle = "#adb6b0";
    context.fillText("ARRIVAL PLATFORM", w * 0.1, h * 0.098 + 10 * scale);

    context.textAlign = "center";
    context.fillStyle = "#a7b0aa";
    context.font = `500 ${9 * scale}px "Noto Sans SC", sans-serif`;
    context.fillText("候车大厅 · CONCOURSE", w * 0.5, h * 0.385);
    context.fillText("南出口", w * 0.5, h * 0.895);
    context.textAlign = "left";
    context.fillText("西出口", w * 0.075, h * 0.75);
    context.textAlign = "right";
    context.fillText("东出口", w * 0.93, h * 0.75);
    context.restore();
  }

  function drawHeatZones(context, width, height) {
    const point = currentPoint();
    const scale = Math.max(0.72, Math.min(1.15, width / 920));

    HOTSPOTS.forEach((hotspot) => {
      const count = point.counts[hotspot.id];
      const index = congestionIndex(hotspot, count);
      const visible = kindMatchesFilter(hotspot);
      const selected = state.selectedId === hotspot.id;
      const hovered = state.hoverId === hotspot.id;
      const x = hotspot.x * width;
      const y = hotspot.y * height;
      const zoneWidth = hotspot.w * width;
      const zoneHeight = hotspot.h * height;
      const centerX = x + zoneWidth / 2;
      const centerY = y + zoneHeight / 2;
      const color = heatColor(index);

      context.save();
      context.globalAlpha = visible ? 1 : 0.13;
      roundedRect(context, x, y, zoneWidth, zoneHeight, 9 * scale);
      context.clip();

      const gradient = context.createRadialGradient(
        centerX,
        centerY,
        2,
        centerX,
        centerY,
        Math.max(zoneWidth, zoneHeight) * 0.7
      );
      gradient.addColorStop(0, heatColor(index, 0.57));
      gradient.addColorStop(0.46, heatColor(index, 0.26));
      gradient.addColorStop(1, heatColor(index, 0.03));
      context.fillStyle = gradient;
      context.fillRect(x, y, zoneWidth, zoneHeight);

      context.fillStyle = heatColor(index, 0.1 + index * 0.0015);
      context.fillRect(x, y, zoneWidth, zoneHeight);

      const core = context.createRadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        Math.min(zoneWidth, zoneHeight) * 0.36
      );
      core.addColorStop(0, heatColor(index, 0.56));
      core.addColorStop(1, heatColor(index, 0));
      context.fillStyle = core;
      context.beginPath();
      context.ellipse(
        centerX,
        centerY,
        zoneWidth * 0.35,
        zoneHeight * 0.35,
        0,
        0,
        Math.PI * 2
      );
      context.fill();
      context.restore();

      context.save();
      context.globalAlpha = visible ? 1 : 0.2;
      roundedRect(
        context,
        x + 0.5,
        y + 0.5,
        zoneWidth - 1,
        zoneHeight - 1,
        9 * scale
      );
      context.strokeStyle = selected
        ? "rgba(235, 112, 65, 0.9)"
        : hovered
          ? "rgba(235, 112, 65, 0.58)"
          : "rgba(255, 255, 255, 0.45)";
      context.lineWidth = selected ? 1.6 : 0.8;
      context.stroke();

      if (selected) {
        drawSelectionCorners(context, x, y, zoneWidth, zoneHeight, scale);
      }

      drawHotspotLabel(
        context,
        hotspot,
        count,
        index,
        centerX,
        centerY,
        selected,
        scale
      );
      context.restore();
    });
  }

  function drawSelectionCorners(context, x, y, width, height, scale) {
    const length = 8 * scale;
    const inset = 4 * scale;
    context.save();
    context.strokeStyle = "#f37b43";
    context.lineWidth = 2;
    [
      [x + inset, y + inset, 1, 1],
      [x + width - inset, y + inset, -1, 1],
      [x + inset, y + height - inset, 1, -1],
      [x + width - inset, y + height - inset, -1, -1],
    ].forEach(([px, py, directionX, directionY]) => {
      context.beginPath();
      context.moveTo(px + length * directionX, py);
      context.lineTo(px, py);
      context.lineTo(px, py + length * directionY);
      context.stroke();
    });
    context.restore();
  }

  function drawHotspotLabel(
    context,
    hotspot,
    count,
    index,
    centerX,
    centerY,
    selected,
    scale
  ) {
    const width = 97 * scale;
    const height = 35 * scale;
    const level = levelFor(index);
    const badgeColor = heatColor(index);

    context.save();
    roundedRect(
      context,
      centerX - width / 2,
      centerY - height / 2,
      width,
      height,
      7 * scale
    );
    context.fillStyle = selected
      ? "rgba(255, 253, 250, 0.97)"
      : "rgba(255, 255, 255, 0.9)";
    context.fill();
    context.strokeStyle = selected
      ? "rgba(238, 122, 77, 0.55)"
      : "rgba(218, 225, 218, 0.9)";
    context.lineWidth = selected ? 1 : 0.7;
    context.stroke();

    context.fillStyle = level.key === "alert" ? "#bb5b39" : "#4d595e";
    context.font = `600 ${8.5 * scale}px "Noto Sans SC", sans-serif`;
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(hotspot.name, centerX - width / 2 + 8 * scale, centerY - 6 * scale);

    context.fillStyle = "#747f7c";
    context.font = `500 ${7.2 * scale}px "Noto Sans SC", sans-serif`;
    context.fillText(level.label, centerX - width / 2 + 8 * scale, centerY + 9 * scale);

    context.fillStyle = "#273740";
    context.font = `650 ${11 * scale}px "Noto Sans SC", sans-serif`;
    context.textAlign = "right";
    context.fillText(
      `${count}`,
      centerX + width / 2 - 8 * scale,
      centerY - 3 * scale
    );
    context.fillStyle = "#959e99";
    context.font = `500 ${6.5 * scale}px "Noto Sans SC", sans-serif`;
    context.fillText("人", centerX + width / 2 - 8 * scale, centerY + 10 * scale);

    context.beginPath();
    context.fillStyle = badgeColor;
    context.arc(centerX - width / 2 + 3 * scale, centerY - 8 * scale, 1.8 * scale, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  const PASSENGER_PATHS = [
    [
      [0.18, 0.335],
      [0.18, 0.385],
      [0.50, 0.385],
      [0.50, 0.29],
      [0.50, 0.225],
    ],
    [
      [0.50, 0.22],
      [0.50, 0.47],
      [0.445, 0.57],
      [0.26, 0.57],
      [0.205, 0.64],
    ],
    [
      [0.83, 0.34],
      [0.83, 0.39],
      [0.62, 0.39],
      [0.53, 0.43],
      [0.50, 0.70],
      [0.50, 0.825],
    ],
    [
      [0.79, 0.365],
      [0.79, 0.56],
      [0.827, 0.65],
      [0.827, 0.79],
      [0.827, 0.86],
    ],
    [
      [0.14, 0.38],
      [0.28, 0.38],
      [0.37, 0.45],
      [0.37, 0.56],
      [0.22, 0.56],
      [0.15, 0.63],
      [0.15, 0.73],
    ],
    [
      [0.56, 0.58],
      [0.66, 0.58],
      [0.67, 0.66],
      [0.60, 0.72],
      [0.56, 0.815],
    ],
    [
      [0.19, 0.58],
      [0.25, 0.58],
      [0.34, 0.64],
      [0.40, 0.64],
      [0.445, 0.72],
      [0.48, 0.81],
    ],
  ];

  function pointOnPolyline(points, progress) {
    const scaled = Math.max(0, Math.min(0.9999, progress)) * (points.length - 1);
    const index = Math.floor(scaled);
    const local = scaled - index;
    const start = points[index];
    const end = points[Math.min(index + 1, points.length - 1)];
    return {
      x: start[0] + (end[0] - start[0]) * local,
      y: start[1] + (end[1] - start[1]) * local,
    };
  }

  function drawPassengerDots(context, width, height) {
    const point = currentPoint();
    const count = state.scene === "surge" ? 72 : 56;
    const scale = Math.max(0.8, Math.min(1.15, width / 920));

    context.save();
    for (let index = 0; index < count; index += 1) {
      const path = PASSENGER_PATHS[index % PASSENGER_PATHS.length];
      const speed = 0.018 + (index % 7) * 0.0024;
      const progress =
        (((index * 0.173 + state.dotClock * speed) % 1) + 1) % 1;
      const previousProgress =
        (((index * 0.173 + (state.dotClock - 1.2) * speed) % 1) + 1) % 1;
      const position = pointOnPolyline(path, progress);
      const previous = pointOnPolyline(path, previousProgress);
      const wobble = Math.sin(index * 6.7 + state.dotClock * 0.05) * 0.0025;
      const x = (position.x + wobble) * width;
      const y = (position.y - wobble * 0.8) * height;
      const px = (previous.x + wobble) * width;
      const py = (previous.y - wobble * 0.8) * height;

      if (state.playing && Math.abs(x - px) + Math.abs(y - py) < width * 0.3) {
        context.strokeStyle = "rgba(236, 109, 61, 0.08)";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(px, py);
        context.lineTo(x, y);
        context.stroke();
      }

      const crowded = index % 5 === 0;
      context.beginPath();
      context.fillStyle = crowded
        ? "rgba(226, 96, 54, 0.7)"
        : index % 3 === 0
          ? "rgba(35, 62, 78, 0.6)"
          : "rgba(81, 135, 117, 0.62)";
      context.arc(x, y, (crowded ? 1.8 : 1.5) * scale, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function drawStation() {
    const { width, height } = fitCanvas(dom.stationCanvas, mapContext);
    drawMapBackground(mapContext, width, height);
    drawFloorPlan(mapContext, width, height);
    drawHeatZones(mapContext, width, height);
    drawPassengerDots(mapContext, width, height);
  }

  function drawTimeline() {
    const { width, height } = fitCanvas(dom.timelineCanvas, timelineContext);
    const context = timelineContext;
    const points = scenes[state.scene];
    const left = 3;
    const right = width - 3;
    const top = 7;
    const bottom = height - 7;
    const plotWidth = right - left;
    const plotHeight = bottom - top;
    const totals = points.map((point) => point.total);
    const minimum = Math.min(...totals);
    const maximum = Math.max(...totals);
    const range = Math.max(60, maximum - minimum);
    const minScale = minimum - range * 0.2;
    const maxScale = maximum + range * 0.18;
    const mapY = (value) =>
      bottom - ((value - minScale) / (maxScale - minScale)) * plotHeight;

    context.clearRect(0, 0, width, height);

    context.save();
    context.strokeStyle = "#eaede8";
    context.lineWidth = 0.7;
    for (let i = 0; i <= 6; i += 1) {
      const x = left + (plotWidth / 6) * i;
      context.beginPath();
      context.moveTo(x, top);
      context.lineTo(x, bottom);
      context.stroke();
    }
    context.strokeStyle = "#e3e7e1";
    context.beginPath();
    context.moveTo(left, bottom + 0.5);
    context.lineTo(right, bottom + 0.5);
    context.stroke();

    const area = context.createLinearGradient(0, top, 0, bottom);
    area.addColorStop(0, "rgba(240, 137, 88, 0.2)");
    area.addColorStop(1, "rgba(240, 137, 88, 0.015)");
    context.beginPath();
    points.forEach((point, index) => {
      const x = left + (index / SAMPLE_COUNT) * plotWidth;
      const y = mapY(point.total);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.lineTo(right, bottom);
    context.lineTo(left, bottom);
    context.closePath();
    context.fillStyle = area;
    context.fill();

    context.beginPath();
    points.forEach((point, index) => {
      const x = left + (index / SAMPLE_COUNT) * plotWidth;
      const y = mapY(point.total);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.strokeStyle = "#ed8b5c";
    context.lineWidth = 1.35;
    context.lineJoin = "round";
    context.stroke();

    const currentX = left + (state.playhead / SAMPLE_COUNT) * plotWidth;
    context.beginPath();
    context.moveTo(currentX, top - 2);
    context.lineTo(currentX, bottom + 1);
    context.strokeStyle = "rgba(223, 98, 52, 0.6)";
    context.lineWidth = 0.8;
    context.stroke();

    const currentSample = points[Math.round(state.playhead)];
    const currentY = mapY(currentSample.total);
    context.beginPath();
    context.fillStyle = "#fff";
    context.arc(currentX, currentY, 2.7, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.fillStyle = "#ed7b49";
    context.arc(currentX, currentY, 1.6, 0, Math.PI * 2);
    context.fill();

    const peakIndex = totals.indexOf(maximum);
    const peakX = left + (peakIndex / SAMPLE_COUNT) * plotWidth;
    context.fillStyle = "#958d83";
    context.font = '500 7px "Noto Sans SC", sans-serif';
    context.textAlign = "center";
    context.fillText(`${maximum} 人`, peakX, Math.max(8, top + 2));
    context.restore();
  }

  function drawDetailChart() {
    const { width, height } = fitCanvas(dom.detailCanvas, detailContext);
    const context = detailContext;
    const hotspot = getHotspot(state.selectedId);
    const points = scenes[state.scene];
    const values = points.map((point) =>
      congestionIndex(hotspot, point.counts[hotspot.id])
    );
    const maximum = Math.max(100, ...values);
    const left = 3;
    const right = width - 5;
    const top = 5;
    const bottom = height - 16;
    const plotWidth = right - left;
    const plotHeight = bottom - top;
    const mapY = (value) => bottom - (value / maximum) * plotHeight;

    context.clearRect(0, 0, width, height);
    context.save();
    [0, 50, 100].forEach((tick) => {
      const y = mapY(tick);
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(right, y);
      context.strokeStyle = tick === 0 ? "#dde3dc" : "#eff1ed";
      context.lineWidth = 0.7;
      context.stroke();
    });

    [70, 90].forEach((threshold, index) => {
      const y = mapY(threshold);
      context.beginPath();
      context.setLineDash([3, 4]);
      context.moveTo(left, y);
      context.lineTo(right, y);
      context.strokeStyle =
        index === 0 ? "rgba(218, 166, 69, 0.4)" : "rgba(224, 105, 66, 0.36)";
      context.lineWidth = 0.7;
      context.stroke();
      context.setLineDash([]);
    });

    const area = context.createLinearGradient(0, top, 0, bottom);
    area.addColorStop(0, "rgba(237, 126, 74, 0.23)");
    area.addColorStop(1, "rgba(237, 126, 74, 0.01)");
    context.beginPath();
    values.forEach((value, index) => {
      const x = left + (index / SAMPLE_COUNT) * plotWidth;
      const y = mapY(value);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.lineTo(right, bottom);
    context.lineTo(left, bottom);
    context.closePath();
    context.fillStyle = area;
    context.fill();

    context.beginPath();
    values.forEach((value, index) => {
      const x = left + (index / SAMPLE_COUNT) * plotWidth;
      const y = mapY(value);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.strokeStyle = "#e77d4d";
    context.lineWidth = 1.35;
    context.lineJoin = "round";
    context.stroke();

    const currentX = left + (state.playhead / SAMPLE_COUNT) * plotWidth;
    const currentValue = values[Math.round(state.playhead)];
    const currentY = mapY(currentValue);
    context.beginPath();
    context.moveTo(currentX, top);
    context.lineTo(currentX, bottom);
    context.strokeStyle = "rgba(231, 125, 77, 0.55)";
    context.lineWidth = 0.8;
    context.stroke();
    context.beginPath();
    context.fillStyle = "#fff";
    context.arc(currentX, currentY, 3.1, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.fillStyle = "#e77d4d";
    context.arc(currentX, currentY, 1.8, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "#a3aaa5";
    context.font = '500 7px "Noto Sans SC", sans-serif';
    context.textAlign = "left";
    context.fillText("07:00", left, height - 3);
    context.textAlign = "center";
    context.fillText("08:30", width / 2, height - 3);
    context.textAlign = "right";
    context.fillText("10:00", right, height - 3);

    const peakValue = Math.max(...values);
    context.textAlign = "left";
    context.fillStyle = "#9a948b";
    context.fillText(`峰值 ${peakValue}`, left, top + 7);
    context.restore();
  }

  let lastListKey = "";
  let toastTimer = null;

  function syncDataset() {
    const point = currentPoint();
    dom.body.dataset.currentScene = state.scene;
    dom.body.dataset.playheadMinute = String(Math.round(state.playhead));
    dom.body.dataset.currentTime = minuteToClock(state.playhead);
    dom.body.dataset.playing = String(state.playing);
    dom.body.dataset.selectedHotspot = state.selectedId;
    dom.body.dataset.currentFilter = state.filter;
    dom.body.dataset.passengerCount = String(point.total);
  }

  function refresh(forceList = false) {
    const point = currentPoint();
    updateStats(point);
    const listKey = `${state.scene}-${Math.round(state.playhead)}-${state.selectedId}-${state.filter}`;
    if (forceList || listKey !== lastListKey) {
      renderHotspotList(point);
      lastListKey = listKey;
    }
    drawStation();
    drawTimeline();
    drawDetailChart();
    syncDataset();
  }

  function updatePlaybackUI() {
    dom.playButton.dataset.state = state.playing ? "playing" : "paused";
    dom.playButton.setAttribute("aria-label", state.playing ? "暂停" : "播放");
    dom.playStateText.textContent = state.playing ? "播放中" : "已暂停";
    dom.body.dataset.playing = String(state.playing);
  }

  function pausePlayback() {
    if (!state.playing) return;
    state.playing = false;
    updatePlaybackUI();
    drawStation();
  }

  function setPlayhead(value, shouldPause = false) {
    state.playhead = Math.max(0, Math.min(SAMPLE_COUNT, Number(value)));
    if (shouldPause) pausePlayback();
    state.dotClock = state.playhead * 1.35 + 8;
    dom.timelineWrap.style.setProperty(
      "--playhead",
      `${(state.playhead / SAMPLE_COUNT) * 100}%`
    );
    refresh(true);
  }

  function togglePlayback() {
    if (state.playing) {
      pausePlayback();
      return;
    }
    if (state.playhead >= SAMPLE_COUNT - 0.01) {
      state.playhead = 0;
      state.dotClock = 8;
    }
    state.playing = true;
    state.lastFrame = performance.now();
    updatePlaybackUI();
  }

  function setScene(scene) {
    if (scene !== "normal" && scene !== "surge") return;
    if (state.scene === scene) return;
    state.scene = scene;
    sceneButtons.forEach((button) => {
      const active = button.dataset.scene === scene;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    lastListKey = "";
    refresh(true);
    showToast(
      scene === "surge"
        ? "已切换至突发客流 · 点位坐标与通道名称保持不变"
        : "已切换至正常客流 · 当前时刻保持不变"
    );
  }

  function showToast(message) {
    let toast = document.querySelector(".toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "toast";
      toast.setAttribute("role", "status");
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 2800);
  }

  function bindControls() {
    dom.playButton.addEventListener("click", togglePlayback);

    dom.timeSlider.addEventListener("pointerdown", () => {
      pausePlayback();
    });
    dom.timeSlider.addEventListener("input", (event) => {
      setPlayhead(event.target.value, true);
    });
    dom.timeSlider.addEventListener("change", (event) => {
      setPlayhead(event.target.value, true);
    });

    sceneButtons.forEach((button) => {
      button.addEventListener("click", () => setScene(button.dataset.scene));
    });
    filterButtons.forEach((button) => {
      button.addEventListener("click", () => setFilter(button.dataset.filter));
    });
    speedButtons.forEach((button) => {
      button.addEventListener("click", () => {
        state.speed = Number(button.dataset.speed);
        speedButtons.forEach((item) => {
          item.classList.toggle("is-active", item === button);
        });
        showToast(`播放速度已调整为 ${state.speed}×`);
      });
    });

    document.getElementById("resetView").addEventListener("click", () => {
      state.filter = "all";
      state.selectedId = "gate-center";
      syncFilterUI();
      setPlayhead(0, true);
      showToast("视图已复位");
    });

    document.querySelectorAll(".nav-item").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.classList.contains("is-active")) return;
        showToast("当前演示聚焦实时总览");
      });
    });

    window.addEventListener("keydown", (event) => {
      if (event.target.matches("input, button")) return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePlayback();
      } else if (event.code === "ArrowLeft") {
        setPlayhead(state.playhead - 5, true);
      } else if (event.code === "ArrowRight") {
        setPlayhead(state.playhead + 5, true);
      }
    });

    dom.stationCanvas.addEventListener("pointermove", (event) => {
      const bounds = dom.stationCanvas.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width;
      const y = (event.clientY - bounds.top) / bounds.height;
      const hotspot = HOTSPOTS.find(
        (item) =>
          kindMatchesFilter(item) &&
          x >= item.x &&
          x <= item.x + item.w &&
          y >= item.y &&
          y <= item.y + item.h
      );
      if (hotspot) {
        state.hoverId = hotspot.id;
        showTooltip(hotspot, event.clientX, event.clientY);
      } else {
        hideTooltip();
      }
    });
    dom.stationCanvas.addEventListener("pointerleave", hideTooltip);
    dom.stationCanvas.addEventListener("click", (event) => {
      const bounds = dom.stationCanvas.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width;
      const y = (event.clientY - bounds.top) / bounds.height;
      const hotspot = HOTSPOTS.find(
        (item) =>
          kindMatchesFilter(item) &&
          x >= item.x &&
          x <= item.x + item.w &&
          y >= item.y &&
          y <= item.y + item.h
      );
      if (hotspot) selectHotspot(hotspot.id);
    });
  }

  let lastAnimatedMinute = 0;

  function animationFrame(now) {
    const delta = Math.min(80, now - state.lastFrame);
    state.lastFrame = now;

    if (state.playing) {
      state.playhead = Math.min(
        SAMPLE_COUNT,
        state.playhead + (delta / 1000) * 8.2 * state.speed
      );
      state.dotClock += (delta / 1000) * 1.8 * state.speed;

      dom.timelineWrap.style.setProperty(
        "--playhead",
        `${(state.playhead / SAMPLE_COUNT) * 100}%`
      );
      dom.timeSlider.value = String(Math.round(state.playhead));

      const animatedMinute = Math.round(state.playhead);
      if (animatedMinute !== lastAnimatedMinute) {
        lastAnimatedMinute = animatedMinute;
        updateStats(currentPoint());
        const listKey = `${state.scene}-${animatedMinute}-${state.selectedId}-${state.filter}`;
        if (listKey !== lastListKey) {
          renderHotspotList(currentPoint());
          lastListKey = listKey;
        }
        dom.body.dataset.playheadMinute = String(animatedMinute);
        dom.body.dataset.currentTime = minuteToClock(state.playhead);
        dom.body.dataset.passengerCount = String(currentPoint().total);
      }

      drawStation();
      drawTimeline();
      drawDetailChart();

      if (state.playhead >= SAMPLE_COUNT) {
        state.playing = false;
        updatePlaybackUI();
      }
    }
    requestAnimationFrame(animationFrame);
  }

  function handleResize() {
    drawStation();
    drawTimeline();
    drawDetailChart();
  }

  function init() {
    buildHotspotHits();
    bindControls();
    sceneButtons.forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.scene === state.scene)
      );
    });
    updatePlaybackUI();
    syncFilterUI();
    refresh(true);

    const observer = new ResizeObserver(handleResize);
    observer.observe(dom.mapStage);
    observer.observe(dom.timelineWrap);
    observer.observe(dom.detailCanvas);
    window.addEventListener("resize", handleResize);
    requestAnimationFrame(animationFrame);

    window.stationCrowd = {
      getState: () => ({
        scene: state.scene,
        time: minuteToClock(state.playhead),
        minute: Math.round(state.playhead),
        playing: state.playing,
        filter: state.filter,
        selectedId: state.selectedId,
      }),
      setTime: (minute) => setPlayhead(minute, true),
      selectHotspot,
      setScene,
      setFilter,
    };
  }

  init();
})();
