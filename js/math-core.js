/* 纯函数数学核心：曲线采样、相机变换、边缘越界检测。可在 Node 中直接 require。 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.HH = root.HH || {};
  Object.assign(root.HH, api);
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function lerp(a, b, u) {
    return a + (b - a) * u;
  }

  function catmullRom(p0, p1, p2, p3, u) {
    const u2 = u * u;
    const u3 = u2 * u;
    return 0.5 * (
      2 * p1 +
      (-p0 + p2) * u +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * u3
    );
  }

  /* points: [{t:0..1, v:number}]，按 t 升序。返回时间归一化位置 t 处的值。 */
  function sampleCurve(points, t) {
    if (!points.length) return 0;
    if (points.length === 1) return points[0].v;
    const sorted = points.slice().sort((a, b) => a.t - b.t);
    const x = clamp(t, 0, 1);
    if (x <= sorted[0].t) return sorted[0].v;
    const last = sorted[sorted.length - 1];
    if (x >= last.t) return last.v;

    let i = 0;
    while (i < sorted.length - 1 && sorted[i + 1].t < x) i++;
    const p1 = sorted[i];
    const p2 = sorted[i + 1];
    const p0 = sorted[i - 1] || p1;
    const p3 = sorted[i + 2] || p2;
    const span = p2.t - p1.t || 1;
    const u = (x - p1.t) / span;
    return catmullRom(p0.v, p1.v, p2.v, p3.v, u);
  }

  /* 由三条曲线求当前时刻相机状态，单位：pan/tilt 为场景像素，roll 为度。 */
  function cameraState(config, t) {
    return {
      pan: sampleCurve(config.pan.points, t),
      tilt: sampleCurve(config.tilt.points, t),
      roll: sampleCurve(config.roll.points, t),
    };
  }

  function degToRad(d) {
    return (d * Math.PI) / 180;
  }

  /* 取景框四角在场景坐标系中的位置。
     相机向右(pan>0)，画面内容向左移动，因此取景中心相对场景中心偏移 (pan, tilt)。 */
  function viewCornersInScene(sceneW, sceneH, viewW, viewH, state) {
    const angle = degToRad(state.roll);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const cx = sceneW / 2 + state.pan;
    const cy = sceneH / 2 + state.tilt;
    const hx = viewW / 2;
    const hy = viewH / 2;
    const local = [
      [-hx, -hy],
      [hx, -hy],
      [hx, hy],
      [-hx, hy],
    ];
    return local.map(([lx, ly]) => ({
      x: cx + cos * lx - sin * ly,
      y: cy + sin * lx + cos * ly,
    }));
  }

  /* 返回越界的边名数组；为空表示取景框完全落在街景画面内。 */
  function overscanEdges(sceneW, sceneH, viewW, viewH, state) {
    const corners = viewCornersInScene(sceneW, sceneH, viewW, viewH, state);
    const edges = [];
    if (corners.some((p) => p.x < 0)) edges.push("左");
    if (corners.some((p) => p.x > sceneW)) edges.push("右");
    if (corners.some((p) => p.y < 0)) edges.push("上");
    if (corners.some((p) => p.y > sceneH)) edges.push("下");
    return edges;
  }

  /* 逐帧扫描全片，返回所有越界帧信息。 */
  function findOvershoot(config, durationSec, fps, dims) {
    const totalFrames = Math.max(1, Math.round(durationSec * fps));
    const hits = [];
    for (let frame = 0; frame < totalFrames; frame++) {
      const t = totalFrames === 1 ? 0 : frame / (totalFrames - 1);
      const state = cameraState(config, t);
      const edges = overscanEdges(
        dims.sceneW, dims.sceneH, dims.viewW, dims.viewH, state
      );
      if (edges.length) hits.push({ frame, t, edges });
    }
    return hits;
  }

  /* 给定场景与取景尺寸，返回不越界时 pan/tilt 的理论最大余量（未计旋转）。 */
  function safeMargin(sceneW, sceneH, viewW, viewH) {
    return {
      pan: (sceneW - viewW) / 2,
      tilt: (sceneH - viewH) / 2,
    };
  }

  return {
    clamp,
    lerp,
    catmullRom,
    sampleCurve,
    cameraState,
    degToRad,
    viewCornersInScene,
    overscanEdges,
    findOvershoot,
    safeMargin,
  };
});
