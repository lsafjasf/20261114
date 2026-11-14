/* 八格分镜核心模型：纯逻辑，无 DOM 依赖，浏览器与 Node 通用。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.StoryModel = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var PANEL_COUNT = 8;
  var MIN_DURATION = 0.25;

  var SHOT_TYPES = [
    { id: "extreme-long", name: "大远景", color: "#3d5a80" },
    { id: "long", name: "远景", color: "#4f6d9e" },
    { id: "full", name: "全景", color: "#5d8a66" },
    { id: "medium", name: "中景", color: "#8a7a4e" },
    { id: "close", name: "近景", color: "#a06a4f" },
    { id: "extreme-close", name: "特写", color: "#b0526b" },
    { id: "insert", name: "空镜/插入", color: "#6a5a8c" },
    { id: "pov", name: "主观镜头", color: "#4e8a8a" }
  ];

  function shotTypeById(id) {
    for (var i = 0; i < SHOT_TYPES.length; i++) {
      if (SHOT_TYPES[i].id === id) return SHOT_TYPES[i];
    }
    return SHOT_TYPES[0];
  }

  function createDefault(totalLength, bpm) {
    var total = totalLength || 16;
    var panels = [];
    for (var i = 0; i < PANEL_COUNT; i++) {
      panels.push({
        duration: total / PANEL_COUNT,
        shotType: SHOT_TYPES[i % SHOT_TYPES.length].id,
        locked: false
      });
    }
    return { bpm: bpm || 120, totalLength: total, panels: panels };
  }

  function clampDuration(d) {
    d = Number(d);
    if (!isFinite(d)) d = MIN_DURATION;
    return Math.max(MIN_DURATION, Math.round(d * 1000) / 1000);
  }

  /* 用户手动修改某格时长：标记 locked，重分配时不再被覆盖。 */
  function setPanelDuration(state, index, duration) {
    var p = state.panels[index];
    if (!p) return state;
    p.duration = clampDuration(duration);
    p.locked = true;
    return state;
  }

  function setPanelShotType(state, index, shotType) {
    var p = state.panels[index];
    if (!p) return state;
    p.shotType = shotTypeById(shotType).id;
    return state;
  }

  function totalDuration(state) {
    return state.panels.reduce(function (s, p) { return s + p.duration; }, 0);
  }

  /*
   * 总长度变化：未锁定的格子等分剩余时长，locked 格子保持用户值。
   * 若剩余时长不足以给未锁定格子分配最小时长，则按最小时长兜底。
   */
  function redistribute(state, newTotal) {
    newTotal = Math.max(PANEL_COUNT * MIN_DURATION, Number(newTotal) || 0);
    state.totalLength = newTotal;
    var lockedSum = 0;
    var freeIdx = [];
    state.panels.forEach(function (p, i) {
      if (p.locked) lockedSum += p.duration;
      else freeIdx.push(i);
    });
    if (freeIdx.length === 0) return state;
    var remain = Math.max(newTotal - lockedSum, freeIdx.length * MIN_DURATION);
    var each = Math.round((remain / freeIdx.length) * 1000) / 1000;
    freeIdx.forEach(function (i, k) {
      if (k < freeIdx.length - 1) {
        state.panels[i].duration = each;
      } else {
        /* 最后一格吸收毫秒舍入误差，保证总时长精确 */
        var used = each * (freeIdx.length - 1);
        state.panels[i].duration = Math.round((remain - used) * 1000) / 1000;
      }
    });
    return state;
  }

  /* 每格起始时间（秒）。 */
  function panelStarts(state) {
    var starts = [];
    var t = 0;
    state.panels.forEach(function (p) { starts.push(t); t += p.duration; });
    return starts;
  }

  /* 时间 t 落在哪一格（0 基），越界返回 -1。 */
  function panelAt(state, t) {
    var acc = 0;
    for (var i = 0; i < state.panels.length; i++) {
      acc += state.panels[i].duration;
      if (t < acc) return i;
    }
    return -1;
  }

  function serialize(state) {
    return JSON.stringify({
      app: "storyboard-beat-aligner",
      version: 1,
      bpm: state.bpm,
      totalLength: state.totalLength,
      panels: state.panels.map(function (p) {
        return { duration: p.duration, shotType: p.shotType, locked: !!p.locked };
      })
    }, null, 2);
  }

  function deserialize(json) {
    var data = typeof json === "string" ? JSON.parse(json) : json;
    if (!data || !Array.isArray(data.panels) || data.panels.length !== PANEL_COUNT) {
      throw new Error("工程文件格式不正确：需要 " + PANEL_COUNT + " 个分镜格");
    }
    var state = createDefault(data.totalLength, data.bpm);
    state.panels = data.panels.map(function (p) {
      return {
        duration: clampDuration(p.duration),
        shotType: shotTypeById(p.shotType).id,
        locked: !!p.locked
      };
    });
    state.totalLength = Math.max(PANEL_COUNT * MIN_DURATION, Number(data.totalLength) || totalDuration(state));
    state.bpm = Math.min(240, Math.max(40, Number(data.bpm) || 120));
    return state;
  }

  return {
    PANEL_COUNT: PANEL_COUNT,
    MIN_DURATION: MIN_DURATION,
    SHOT_TYPES: SHOT_TYPES,
    shotTypeById: shotTypeById,
    createDefault: createDefault,
    setPanelDuration: setPanelDuration,
    setPanelShotType: setPanelShotType,
    totalDuration: totalDuration,
    redistribute: redistribute,
    panelStarts: panelStarts,
    panelAt: panelAt,
    serialize: serialize,
    deserialize: deserialize
  };
});
