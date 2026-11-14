/* Node 单测：验证模型核心逻辑 */
const assert = require("assert");
const M = require("../model.js");

// 1. 默认工程：8 格等宽
let s = M.createDefault(16, 120);
assert.strictEqual(s.panels.length, 8);
assert.strictEqual(M.totalDuration(s), 16);

// 2. 用户修改第 2、5 格时长后被锁定
M.setPanelDuration(s, 1, 4);
M.setPanelDuration(s, 4, 2.5);
assert.strictEqual(s.panels[1].locked, true);
assert.strictEqual(s.panels[4].locked, true);

// 3. 总长度变化：locked 格不被覆盖，其余等分剩余
M.redistribute(s, 24);
assert.strictEqual(s.panels[1].duration, 4, "locked 格 1 不应被覆盖");
assert.strictEqual(s.panels[4].duration, 2.5, "locked 格 4 不应被覆盖");
const free = [0, 2, 3, 5, 6, 7].map(i => s.panels[i].duration);
const expected = Math.round(((24 - 4 - 2.5) / 6) * 1000) / 1000;
free.slice(0, 5).forEach(d => assert.strictEqual(d, expected, "未锁定格应等宽"));
assert.ok(Math.abs(free[5] - expected) < 0.002, "末格仅吸收毫秒舍入误差");
assert.ok(Math.abs(M.totalDuration(s) - 24) < 1e-9, "总时长应等于新总长度");

// 4. 全部锁定后重分配：任何格都不变
M.redistribute(s, 40);
assert.strictEqual(s.panels[1].duration, 4);

// 5. panelAt / panelStarts 一致性
const starts = M.panelStarts(s);
assert.strictEqual(M.panelAt(s, starts[1] + 0.01), 1);
assert.strictEqual(M.panelAt(s, M.totalDuration(s) + 1), -1);

// 6. JSON 序列化往返
const json = M.serialize(s);
const s2 = M.deserialize(json);
assert.deepStrictEqual(s2, s);

// 7. 非法 JSON 报错
assert.throws(() => M.deserialize('{"panels":[1,2]}'));

// 8. 镜头类型回退与设置
M.setPanelShotType(s2, 0, "close");
assert.strictEqual(s2.panels[0].shotType, "close");
M.setPanelShotType(s2, 0, "不存在");
assert.strictEqual(s2.panels[0].shotType, M.SHOT_TYPES[0].id);

console.log("model.test.js: 全部 8 组断言通过");
