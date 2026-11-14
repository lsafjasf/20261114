// 无依赖 Node 验证：直接复用浏览器同款 scene/diff 模块，跑通完整验证链路。
// 运行：node tests/verify.mjs
import assert from 'node:assert/strict';
import {
  DEFAULT_PARAMS,
  FRAME_COUNT,
  FRAME_DURATION,
  HEIGHT,
  WIDTH,
  renderScene,
} from '../js/scene.js';
import { computeDiff, renderView } from '../js/diff.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const paramsB0 = { ...DEFAULT_PARAMS, sunHue: 15 };

console.log('1) 实际找到差异（默认参数，A sunHue=45 vs B sunHue=15）');
const frame = 24;
const bufA = renderScene(frame, DEFAULT_PARAMS);
const bufB = renderScene(frame, paramsB0);
const diff0 = computeDiff(bufA, bufB, 25);
console.log(
  `   帧 ${frame}: 变化比例=${(diff0.changedRatio * 100).toFixed(2)}%`,
  `最大差异=(${diff0.maxX}, ${diff0.maxY}) d=${diff0.maxDistance.toFixed(1)}`,
  `平均=${diff0.meanDistance.toFixed(2)}`,
);

check('同参数渲染应完全无差异', () => {
  const same = computeDiff(
    renderScene(frame, DEFAULT_PARAMS),
    renderScene(frame, DEFAULT_PARAMS),
    25,
  );
  assert.equal(same.changedRatio, 0);
  assert.equal(same.maxDistance, 0);
});

check('差异确实存在且最大差异位置落在太阳区域内', () => {
  assert.ok(diff0.changedRatio > 0, '应检测到变化像素');
  const t = frame / (FRAME_COUNT - 1);
  const sunX = 48 + (WIDTH - 96) * t;
  const sunY = 150 - 90 * Math.sin(Math.PI * t);
  const dist = Math.hypot(diff0.maxX - sunX, diff0.maxY - sunY);
  assert.ok(dist <= 22, `最大差异点距太阳中心 ${dist.toFixed(1)}px，应 ≤22px`);
});

console.log('\n2) 调整 B 的颜色参数后，观察差分图局部更新');
const changedPixelCount = Math.round(diff0.changedRatio * WIDTH * HEIGHT);

check('把 B 的太阳色相改成与 A 相同(45)，差异应整体消失', () => {
  const matched = computeDiff(
    bufA,
    renderScene(frame, { ...paramsB0, sunHue: 45 }),
    25,
  );
  assert.equal(matched.changedRatio, 0);
  assert.equal(matched.maxDistance, 0);
});

check('把色相调得更远(300)，变化像素应增多且最大点仍在太阳处', () => {
  const farther = computeDiff(
    bufA,
    renderScene(frame, { ...paramsB0, sunHue: 300 }),
    25,
  );
  assert.ok(farther.changedRatio > diff0.changedRatio);
  const t = frame / (FRAME_COUNT - 1);
  const sunX = 48 + (WIDTH - 96) * t;
  const sunY = 150 - 90 * Math.sin(Math.PI * t);
  const dist = Math.hypot(farther.maxX - sunX, farther.maxY - sunY);
  assert.ok(dist <= 22);
  console.log(
    `   hue=300: 变化比例=${(farther.changedRatio * 100).toFixed(2)}%`,
    `（原 ${(diff0.changedRatio * 100).toFixed(2)}%）`,
    `最大点=(${farther.maxX}, ${farther.maxY})`,
  );
});

check('非太阳区域（地面采样点）差分始终为 0，证明更新是局部的', () => {
  for (const hue of [15, 45, 300]) {
    const d = computeDiff(
      bufA,
      renderScene(frame, { ...paramsB0, sunHue: hue }),
      25,
    );
    const groundIndex = (HEIGHT - 8) * WIDTH + 40;
    assert.equal(d.distances[groundIndex], 0);
  }
});

check('差分视图可正常渲染且仅差异区为非黑色', () => {
  const imageData = { data: new Uint8ClampedArray(WIDTH * HEIGHT * 4) };
  renderView(imageData, bufA, bufB, diff0, 'diff', 25);
  let lit = 0;
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    const o = i * 4;
    if (
      imageData.data[o] +
        imageData.data[o + 1] +
        imageData.data[o + 2] >
      0
    ) {
      lit++;
    }
  }
  assert.ok(Math.abs(lit - changedPixelCount) / WIDTH / HEIGHT < 0.02);
});

console.log('\n3) 时间轴与差值计算一致性');
check('逐帧差值与时间轴取值一一对应、可重复', () => {
  for (let f = 0; f < FRAME_COUNT; f++) {
    const d1 = computeDiff(
      renderScene(f, DEFAULT_PARAMS),
      renderScene(f, paramsB0),
      25,
    );
    const d2 = computeDiff(
      renderScene(f, DEFAULT_PARAMS),
      renderScene(f, paramsB0),
      25,
    );
    assert.equal(d1.changedRatio, d2.changedRatio);
    assert.equal(d1.maxX, d2.maxX);
    assert.equal(d1.maxY, d2.maxY);
    const t = f / (FRAME_COUNT - 1);
    const sunX = 48 + (WIDTH - 96) * t;
    const sunY = 150 - 90 * Math.sin(Math.PI * t);
    const dist = Math.hypot(d1.maxX - sunX, d1.maxY - sunY);
    assert.ok(dist <= 22, `帧 ${f} 最大差异点偏离太阳`);
    assert.ok(d1.changedRatio > 0, `帧 ${f} 应有差异`);
  }
});

check('时间标签换算正确（帧号 × 帧时长）', () => {
  const f = 17;
  assert.equal(+(f * FRAME_DURATION).toFixed(3), +(17 / 24).toFixed(3));
});

check('阈值升高时变化比例单调不增', () => {
  const low = computeDiff(bufA, bufB, 0);
  const high = computeDiff(bufA, bufB, 100);
  assert.ok(high.changedRatio <= low.changedRatio);
});

console.log(`\n全部 ${passed} 项验证通过 ✔`);
