'use strict';

const { createSim, CFG } = require('./sim.js');
const { PumpPlayer, ValvePlayer } = require('./pilot.js');

const sim = createSim();
const pumpPlayer = new PumpPlayer();
const valvePlayer = new ValvePlayer();
const dt = CFG.DT;

sim.start();
let lastReport = -10;
let maxHammer = 0;

while (sim.status === 'running') {
  valvePlayer.act(sim, dt);
  pumpPlayer.act(sim, dt);
  sim.step(dt);
  maxHammer = Math.max(maxHammer, sim.damageHammer);

  if (sim.t - lastReport >= 30) {
    lastReport = sim.t;
    const [a, b] = sim.pools;
    console.log(
      `t=${sim.t.toFixed(0).padStart(4)}s  ` +
      `hA=${a.h.toFixed(3)} hB=${b.h.toFixed(3)}  ` +
      `v=${a.valve.toFixed(2)}/${b.valve.toFixed(2)}  ` +
      `p=${a.pump.toFixed(2)}/${b.pump.toFixed(2)}  ` +
      `Qd=${sim.flowTotalDrain.toFixed(3)}  稳态=${sim.steady.toFixed(0)}s  ` +
      `水锤损伤=${sim.damageHammer}  气蚀=${sim.damageCav.toFixed(0)}`
    );
  }
  if (sim.t > 1500) {
    sim.endReason = '超时：1500s 内未能建立稳态';
    break;
  }
}

const [a, b] = sim.pools;
console.log('\n===== 最终结果 =====');
console.log('状态:', sim.status, sim.endReason || '');
console.log('用时:', sim.t.toFixed(1), 's（连续稳态要求', CFG.STEADY_TIME, 's）');
console.log(`水位区间: A=[${a.h.toFixed(3)}] B=[${b.h.toFixed(3)}] 历史min=${sim.stats.minLevel.toFixed(3)} max=${sim.stats.maxLevel.toFixed(3)}`);
console.log('水锤事件:', sim.stats.hammerEvents, ' 峰值损伤:', maxHammer, '/', CFG.DAMAGE_LOSE);
console.log('气蚀事件:', sim.stats.cavEvents, ' 气蚀损伤:', sim.damageCav.toFixed(1));
console.log('最终总排水流量:', sim.flowTotalDrain.toFixed(4), ' 允许区间', `[${CFG.FLOW_MIN}, ${CFG.FLOW_MAX}]`);

const pass = sim.status === 'won'
  && sim.stats.hammerEvents === 0
  && sim.stats.cavEvents === 0
  && sim.flowTotalDrain >= CFG.FLOW_MIN
  && sim.flowTotalDrain <= CFG.FLOW_MAX;

if (!pass) {
  console.error('\nFAIL: 协作稳态验证未通过');
  process.exit(1);
}
console.log('\nPASS: 两名自动玩家在无水锤、无气蚀情况下完成五分钟协作稳态');
