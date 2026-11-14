// 无头场景验证：跑一次稳态通关、一次藻华失败。
// 用法：node test/scenarios.js
const Sim = require("../sim.js");

const DT = 0.5; // 秒/步

function run(name, controller, maxT) {
  const s = Sim.createState();
  const log = [];
  while (s.status === "running" && s.t < maxT) {
    const input = controller(s);
    Sim.step(s, input, DT);
    if (log.length === 0 || s.t - log[log.length - 1].t >= 30) {
      log.push(snapshot(s));
    }
  }
  log.push(snapshot(s));
  console.log(`\n=== ${name} ===`);
  for (const row of log) console.log(row);
  console.log(
    `结局: ${s.status}${s.failReason ? " — " + s.failReason : ""} | t=${s.t.toFixed(1)}s 多样性=${s.diversity.toFixed(2)}`
  );
  return s;
}

function snapshot(s) {
  return (
    `t=${s.t.toFixed(0).padStart(3)}s 营养=${s.nutrients.toFixed(0).padStart(3)} ` +
    `浮游=${s.phyto.toFixed(0).padStart(3)} 藻=${s.algae.toFixed(0).padStart(3)} ` +
    `鱼=${s.fish.toFixed(0).padStart(3)} 氧=${s.oxygen.toFixed(0).padStart(3)} ` +
    `透明度=${s.transparency.toFixed(0).padStart(3)} 多样性=${s.diversity.toFixed(2)}`
  );
}

// 场景一：稳态 —— 一个简单的"玩家"调节策略
function stableController(s) {
  return {
    light: 0.6,
    feed: s.nutrients < 30 ? 0.5 : 0, // 营养偏低才投喂
    dose: s.algae > 45 ? 0.3 : 0, // 藻类偏高时少量药剂
    waterChange: s.nutrients > 60, // 营养过高时换水
  };
}

// 场景二：藻华 —— 疯狂投喂、从不换水
function bloomController() {
  return { light: 0.9, feed: 1.0, dose: 0, waterChange: false };
}

const stable = run("场景一：稳态运行五分钟", stableController, 600);
const bloom = run("场景二：藻华失败", bloomController, 600);

let ok = true;
if (stable.status !== "win") {
  console.error("FAIL: 稳态场景未达成胜利");
  ok = false;
}
if (!(bloom.status === "fail" && bloom.failReason.includes("藻华"))) {
  console.error("FAIL: 藻华场景未以藻华失败收场");
  ok = false;
}
console.log(ok ? "\n两个场景均符合预期 ✔" : "\n场景校验未通过 ✘");
process.exit(ok ? 0 : 1);
