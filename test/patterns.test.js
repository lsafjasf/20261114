const test = require('node:test');
const assert = require('node:assert');
const {
  PRESETS, DEFAULTS, toLocal, renderTile, renderUnit, renderRegion, getUnitSize
} = require('../src/patterns');

test('wrap 折叠：边界两侧为同一周期邻居', () => {
  assert.strictEqual(toLocal(0, 10, false), 0);
  assert.strictEqual(toLocal(9.5, 10, false), 9.5);
  assert.strictEqual(toLocal(10, 10, false), 0);
  assert.strictEqual(toLocal(-0.5, 10, false), 9.5);
});

test('mirror 折叠：三角波在单元边界导数反转但值连续', () => {
  assert.strictEqual(toLocal(0, 10, true), 0);
  assert.strictEqual(toLocal(9.5, 10, true), 9.5);
  assert.strictEqual(toLocal(10.5, 10, true), 9.5);
  assert.strictEqual(toLocal(20, 10, true), 0);
  assert.strictEqual(toLocal(-0.5, 10, true), 0.5);
});

test('镜像模式的可平铺单元是基础单元的 2 倍', () => {
  assert.deepStrictEqual(getUnitSize({ mirrorX: true, mirrorY: false }), { width: 240, height: 120 });
  assert.deepStrictEqual(getUnitSize({ mirrorX: true, mirrorY: true }), { width: 240, height: 240 });
  assert.deepStrictEqual(getUnitSize({}), { width: DEFAULTS.tileW, height: DEFAULTS.tileH });
});

test('每个预设的单元在任意偏移处平铺均逐像素一致（无接缝边框）', () => {
  for (const name of Object.keys(PRESETS)) {
    const params = PRESETS[name];
    const unit = renderUnit(params);
    for (const [ox, oy] of [[unit.width, 0], [0, unit.height], [unit.width, unit.height], [-unit.width, -unit.height]]) {
      const shifted = renderRegion(params, unit.width, unit.height, ox, oy, params.ssaa);
      assert.deepStrictEqual(Array.from(shifted.data), Array.from(unit.data), `${name} @${ox},${oy}`);
    }
  }
});

test('镜像折叠：仅经纱条纹下 f(x) 与 f(2w-x) 连续采样一致', () => {
  // 条纹只依赖 x，镜像后在 2w 周期上严格左右对称
  const params = Object.assign({}, DEFAULTS, {
    mirrorX: true, mirrorY: true, tileW: 60, tileH: 60,
    lineWidth: 5, pitchX: 12, pitchY: 12, ssaa: 1
  });
  const { toLocal } = require('../src/patterns');
  // 在 2w 周期内取若干点，与其在三角波另一斜边的镜像点对比
  for (let i = 0; i < 2 * params.tileW; i += 7) {
    const x = i + 0.37;
    const lx = toLocal(x, params.tileW, true);
    const mirrorX = lx + 2 * (params.tileW - lx); // 反射点（仍在同一周期内）
    const y = 8.71; // 固定在非纬纱行
    const a = renderRegion(params, 1, 1, x, y, 1).data;
    const b = renderRegion(params, 1, 1, mirrorX, y, 1).data;
    assert.deepStrictEqual([a[0], a[1], a[2]], [b[0], b[1], b[2]], `x=${x}`);
  }
});

test('输出为不透明 RGBA', () => {
  const unit = renderUnit(PRESETS.twill);
  for (let i = 3; i < unit.data.length; i += 4) {
    assert.strictEqual(unit.data[i], 255);
  }
});
