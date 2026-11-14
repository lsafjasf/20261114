const Sim = require('./src/sim.js');

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log('  PASS ' + msg);
  else { failures++; console.error('  FAIL ' + msg); }
}

// 推荐调度策略：优先光伏，缺口由电池(<=25)再发电机(<=40)补足，盈余充电
function dispatch(state) {
  const t = state.t;
  const avail = Sim.SCENARIO.solarAvail[t];
  const dem = Sim.SCENARIO.loadDemand[t];
  const solar = Math.min(avail, Sim.CONFIG.lineCaps.solar);
  let deficit = dem - solar;
  let batt = 0, gen = 0;
  if (deficit > 0) {
    batt = Math.min(Sim.CONFIG.lineCaps.battery, deficit);
    deficit -= batt;
    gen = Math.min(Sim.CONFIG.lineCaps.gen, deficit);
  } else {
    batt = -Math.min(Sim.CONFIG.lineCaps.battery, -deficit);
  }
  return { solar, gen, battery: batt };
}

console.log('[1] 内置场景：完成一次 20 秒调度');
{
  const st = Sim.createState();
  let last = null;
  while (st.status === 'running') {
    last = Sim.tick(st, dispatch(st));
    assert(Math.abs(last.imbalance) < 1e-9, `t=${last.t} 功率守恒 (imbalance=${last.imbalance.toExponential(2)})`);
    if (last.batteryCharge > 0) assert(last.batteryDischarge === 0, `t=${last.t} 充电时放电为 0`);
    if (last.batteryDischarge > 0) assert(last.batteryCharge === 0, `t=${last.t} 放电时充电为 0`);
    assert(!last.anyOverload, `t=${last.t} 无线路过载`);
  }
  assert(st.status === 'success', `20 秒未断电，调度成功 (status=${st.status})`);
  assert(last.t === Sim.CONFIG.duration - 1, '运行满 20 个调度秒');
}

console.log('[2] 过载测试：发电机 50kW > 线路容量 40kW');
{
  const st = Sim.createState();
  const r1 = Sim.tick(st, { solar: 0, gen: 50, battery: 0 });
  assert(r1.lines.gen.overload === true, '发电机线路变红（过载标记）');
  assert(r1.lines.gen.flow === 50 && r1.lines.gen.cap === 40, '线路负载 50/40 kW');
  Sim.tick(st, { solar: 0, gen: 50, battery: 0 });
  const r3 = Sim.tick(st, { solar: 0, gen: 50, battery: 0 });
  assert(st.status === 'tripped', `持续过载 ${Sim.CONFIG.tripSeconds}s 跳闸 (status=${st.status})`);
  assert(r3.lines.gen.timer === 3, '过载计时累计到 3s');
}

console.log('[3] 过载测试：电池 30kW > 线路容量 25kW');
{
  const st = Sim.createState();
  const r = Sim.tick(st, { solar: 40, gen: 0, battery: 30 });
  assert(r.lines.battery.overload === true, '电池线路变红（放电 30 > 25）');
}

console.log('[4] 断电测试：供给不足');
{
  const st = Sim.createState();
  Sim.tick(st, { solar: 0, gen: 0, battery: 0 });
  Sim.tick(st, { solar: 0, gen: 0, battery: 0 });
  Sim.tick(st, { solar: 0, gen: 0, battery: 0 });
  assert(st.status === 'blackout', `功率缺口导致断电 (status=${st.status})`);
}

console.log(failures === 0 ? '\n全部测试通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
