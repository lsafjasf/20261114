// 自动打一遍灌溉：仅用传感器（2 秒延迟）读数做决策，验证游戏可通关。
const Sim = require('./sim.js');
const { CFG } = Sim;

function play(seed, verbose) {
  const s = Sim.createState(seed);
  let sluiceOn = false;
  while (s.status === 'playing') {
    const cur = s.fields.findIndex((f) => !f.done);
    if (cur >= 0) {
      // 灌溉阶段：分流闸全开去灌区，按传感器水位给进水闸调速
      const Ls = s.sensor.fields[cur];
      const c = CFG.fields[cur];
      Sim.setGate(s, 'divert', 1);
      if (Ls > c.hi - 0.28) Sim.setGate(s, 'intake', 0.12);      // 接近目标，细流防过冲
      else if (Ls > c.hi - 0.6) Sim.setGate(s, 'intake', 0.45);  // 减速区
      else Sim.setGate(s, 'intake', 0.95);                       // 全速
    } else {
      // 全部完成：补水蓄水或保持
      Sim.setGate(s, 'divert', 0);
      Sim.setGate(s, 'intake', s.sensor.H < CFG.reservoir.hMin + 0.15 ? 0.8 : 0);
    }
    // 蓄水池滞环控制，防止漫顶
    if (s.sensor.H > 2.55) sluiceOn = true;
    else if (s.sensor.H < 2.1) sluiceOn = false;
    Sim.setGate(s, 'sluice', sluiceOn ? 1 : 0);

    Sim.step(s);
  }
  if (verbose) {
    console.log(
      `seed=${seed} -> ${s.status} @ t=${s.t.toFixed(1)}s  H=${s.H.toFixed(2)}  ` +
        `fields=[${s.fields.map((f) => f.L.toFixed(2)).join(', ')}]  ${s.reason}`
    );
  }
  return s;
}

let wins = 0;
const N = 30;
for (let seed = 1; seed <= N; seed++) {
  const s = play(seed, seed <= 5);
  if (s.status === 'won') wins++;
}
console.log(`\n${wins}/${N} 局获胜`);
if (wins < N) {
  console.error('存在无法通关的种子，需要调参。');
  process.exit(1);
}
console.log('OK: 策略可稳定完成一次灌溉。');
