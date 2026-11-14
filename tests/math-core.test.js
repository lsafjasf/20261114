const assert = require("assert");
const HH = require("../js/math-core.js");

const DIMS = { sceneW: 1920, sceneH: 1080, viewW: 1280, viewH: 720 };

function curve(points) {
  return { points: points.map(([t, v]) => ({ t, v })) };
}

function configWith(pan, tilt, roll) {
  const flat = (v) => curve([[0, v], [1, v]]);
  return { pan: flat(pan), tilt: flat(tilt), roll: flat(roll) };
}

{
  const pts = curve([[0, 0], [0.5, 10], [1, 20]]).points;
  assert.strictEqual(HH.sampleCurve(pts, 0), 0, "曲线起点应为 0");
  assert.strictEqual(HH.sampleCurve(pts, 1), 20, "曲线终点应为 20");
  assert.strictEqual(HH.sampleCurve(pts, 0.5), 10, "采样应精确通过关键帧");
  assert.ok(HH.sampleCurve(pts, 0.25) > 0, "单调曲线在 0.25 处应为正值");
  assert.ok(
    HH.sampleCurve(pts, 0.25) < HH.sampleCurve(pts, 0.75),
    "单调上升曲线采样保持有序"
  );
  assert.strictEqual(
    HH.sampleCurve(curve([[0, 7]]).points, 0.42), 7, "单点曲线返回常量"
  );
}

{
  const margin = HH.safeMargin(DIMS.sceneW, DIMS.sceneH, DIMS.viewW, DIMS.viewH);
  assert.deepStrictEqual(margin, { pan: 320, tilt: 180 }, "安全余量计算");
  assert.deepStrictEqual(
    HH.overscanEdges(DIMS.sceneW, DIMS.sceneH, DIMS.viewW, DIMS.viewH,
      { pan: 0, tilt: 0, roll: 0 }),
    [],
    "居中取景框不应越界"
  );
  assert.deepStrictEqual(
    HH.overscanEdges(DIMS.sceneW, DIMS.sceneH, DIMS.viewW, DIMS.viewH,
      { pan: 321, tilt: 0, roll: 0 }),
    ["右"],
    "pan 超出余量应右侧露边"
  );
  assert.deepStrictEqual(
    HH.overscanEdges(DIMS.sceneW, DIMS.sceneH, DIMS.viewW, DIMS.viewH,
      { pan: -321, tilt: 0, roll: 0 }),
    ["左"],
    "负 pan 应左侧露边"
  );
  assert.deepStrictEqual(
    HH.overscanEdges(DIMS.sceneW, DIMS.sceneH, DIMS.viewW, DIMS.viewH,
      { pan: 0, tilt: 181, roll: 0 }),
    ["下"],
    "tilt 超出余量应下侧露边"
  );
  assert.deepStrictEqual(
    HH.overscanEdges(DIMS.sceneW, DIMS.sceneH, DIMS.viewW, DIMS.viewH,
      { pan: 0, tilt: 0, roll: -90 }),
    ["上", "下"],
    "90 度旋转后取景框纵向尺寸超过场景，上下边越界"
  );
  const safeRoll = HH.overscanEdges(
    DIMS.sceneW, DIMS.sceneH, DIMS.viewW, DIMS.viewH,
    { pan: 0, tilt: 0, roll: 1 }
  );
  assert.deepStrictEqual(safeRoll, [], "1 度轻微旋转不应越界");
}

{
  const calm = configWith(0, 0, 0);
  const hits = HH.findOvershoot(calm, 4, 30, DIMS);
  assert.strictEqual(hits.length, 0, "静止居中配置全片 120 帧无越界");
  assert.strictEqual(
    HH.overscanEdges(DIMS.sceneW, DIMS.sceneH, DIMS.viewW, DIMS.viewH,
      HH.cameraState(calm, 1)).length,
    0,
    "末尾帧不越出画面"
  );
}

{
  const wild = configWith(400, 0, 0);
  const hits = HH.findOvershoot(wild, 4, 30, DIMS);
  assert.strictEqual(hits.length, 120, "大幅 pan 应每帧越界");
  assert.ok(hits.every((h) => h.edges.includes("右")), "越界方向为右侧");
}

{
  const animated = {
    pan: curve([[0, 0], [0.5, 350], [1, 0]]),
    tilt: curve([[0, 0], [1, 0]]),
    roll: curve([[0, 0], [1, 0]]),
  };
  const hits = HH.findOvershoot(animated, 4, 30, DIMS);
  assert.ok(hits.length > 0 && hits[0].frame > 0, "动画中段越界可被扫描到");
  const endEdges = HH.overscanEdges(
    DIMS.sceneW, DIMS.sceneH, DIMS.viewW, DIMS.viewH,
    HH.cameraState(animated, 1)
  );
  assert.deepStrictEqual(endEdges, [], "即使中段越界，末尾帧仍需安全");
}

{
  const corners = HH.viewCornersInScene(
    DIMS.sceneW, DIMS.sceneH, DIMS.viewW, DIMS.viewH,
    { pan: 100, tilt: -50, roll: 0 }
  );
  const center = {
    x: corners.reduce((s, p) => s + p.x, 0) / 4,
    y: corners.reduce((s, p) => s + p.y, 0) / 4,
  };
  assert.ok(Math.abs(center.x - (960 + 100)) < 1e-9, "取景中心随 pan 平移");
  assert.ok(Math.abs(center.y - (540 - 50)) < 1e-9, "取景中心随 tilt 平移");
}

console.log("math-core: 全部断言通过");
