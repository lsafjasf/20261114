// 无头模拟测试：桩掉 DOM/Canvas，验证冷锋事件与游戏平衡
const noop = () => {};
const gradient = { addColorStop: noop };
const ctxStub = new Proxy({}, {
  get: (t, k) => {
    if (k === "createLinearGradient" || k === "createRadialGradient") return () => gradient;
    return noop;
  },
  set: () => true,
});
const elStub = () => ({
  style: {},
  classList: { add: noop, remove: noop, toggle: noop },
  addEventListener: noop,
  appendChild: noop,
  textContent: "",
  innerHTML: "",
  getContext: () => ctxStub,
  width: 960,
  height: 520,
});
global.document = { getElementById: elStub, createElement: elStub };
global.window = { addEventListener: noop };
global.performance = { now: () => 0 };
global.requestAnimationFrame = noop;

const src = require("fs").readFileSync("./game.js", "utf8");
eval(src + "\n;module.exports = { resetState, state, update, draw, updateHud, toggle, NIGHT_LENGTH, TIME_SCALE };");
const { resetState, state, update, draw, updateHud, toggle, NIGHT_LENGTH, TIME_SCALE } = module.exports;

function run(policy, label) {
  resetState();
  state.running = true;
  let minOutside = 99;
  let sawFront = false;
  const dt = 0.05;
  for (let step = 0; step < NIGHT_LENGTH / TIME_SCALE / dt + 10; step++) {
    if (state.over) break;
    policy();
    update(dt);
    draw();       // 渲染冒烟测试
    updateHud();  // HUD 冒烟测试
    minOutside = Math.min(minOutside, state.outside);
    if (state.front) sawFront = true;
  }
  const temps = state.zones.map(z => z.temp.toFixed(1)).join("/");
  const healths = state.zones.map(z => Math.round(z.health)).join("/");
  console.log(`${label}: over=${state.over} win=${state.win} front=${sawFront} ` +
    `minOutside=${minOutside.toFixed(1)}C power=${Math.round(state.power)}% ` +
    `endTemp=[${temps}] health=[${healths}]`);
  return { win: state.win, sawFront, minOutside };
}

// 策略1：什么都不做 —— 应该失败
const r1 = run(() => {}, "放任不管");

// 策略2：合理操作 —— 应该获胜
const r2 = run(() => {
  state.zones.forEach((z) => {
    const [iLo] = z.def.ideal;
    if (z.temp < iLo && !z.heater) toggle(z, "heater");
    if (z.temp > iLo + 1.5 && z.heater) toggle(z, "heater");
    if ((state.frontWarned || z.temp < z.def.safe[0] + 3) && !z.curtain) toggle(z, "curtain");
    if (z.humidity > 82 && !z.window) toggle(z, "window");
    if (z.humidity < 55 && z.window) toggle(z, "window");
  });
}, "合理操作");

let ok = true;
if (r1.win) { console.error("FAIL: 放任不管不应获胜"); ok = false; }
if (!r2.win) { console.error("FAIL: 合理操作应能获胜"); ok = false; }
if (!r2.sawFront) { console.error("FAIL: 冷锋事件未触发"); ok = false; }
if (r2.minOutside > -2) { console.error("FAIL: 冷锋降温不足"); ok = false; }
console.log(ok ? "ALL PASS" : "SOME FAILED");
process.exit(ok ? 0 : 1);
