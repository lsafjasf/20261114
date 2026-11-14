'use strict';

const { createSim, CFG } = require('./sim.js');

function run(name, setup, cap = 400) {
  const sim = createSim();
  sim.start();
  let steps = 0;
  while (sim.status === 'running' && steps < cap / CFG.DT) {
    setup(sim);
    sim.step(CFG.DT);
    steps++;
  }
  const ok = sim.status === 'lost';
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${sim.status}${sim.endReason ? ' / ' + sim.endReason : ''}`);
  return ok;
}

let allPass = true;

allPass &= run('猛烈开关阀门触发水锤累积爆管', (sim) => {
  const phase = Math.floor(sim.t * 4) % 2;
  sim.setValve(0, phase, true);
  sim.setValve(1, phase, true);
  sim.setPump(0, 0.5, false);
  sim.setPump(1, 0.5, false);
}, 120);

allPass &= run('停泵导致平台淹没', (sim) => {
  sim.setPump(0, 0, false);
  sim.setPump(1, 0, false);
  sim.setValve(0, 0.2, false);
  sim.setValve(1, 0.2, false);
}, 60);

allPass &= run('低水位强行抽泵导致气蚀损毁', (sim) => {
  sim.pools[0].h = 0.05;
  sim.pools[1].h = 0.05;
  sim.setPump(0, 0.8, false);
  sim.setPump(1, 0.8, false);
  sim.setValve(0, 0, false);
  sim.setValve(1, 0, false);
}, 120);

allPass &= run('只进水不排水导致漫顶', (sim) => {
  sim.setValve(0, 0.9, false);
  sim.setValve(1, 0.9, false);
  sim.setPump(0, 0, false);
  sim.setPump(1, 0, false);
}, 240);

const sim = createSim();
sim.start();
sim.setPump(0, 0.08, false);
sim.setPump(1, 0.08, false);
for (let i = 0; i < 60; i++) sim.step(CFG.DT);
const alarmTexts = sim.alarms.map((a) => a.text);
const flowAlarmWorks = alarmTexts.some((t) => t.includes('流量'));
console.log(`${flowAlarmWorks ? 'PASS' : 'FAIL'} 共享流量频道会播报调度越限报警`);
allPass &= flowAlarmWorks;

if (!allPass) process.exit(1);
console.log('\n全部失败路径与共享报警机制验证通过');
