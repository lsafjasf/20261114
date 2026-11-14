/* Headless verification of the aquarium circulation rules.
 * Run: node tests/verify.js
 * Writes a machine-readable report to artifacts/verification.json. */
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('../js/sim.js');

const FPS = 30;
function run(simState, decide, maxSeconds) {
  const frames = Math.round(maxSeconds * FPS);
  const trace = [];
  for (let i = 0; i < frames && simState.status === 'running'; i++) {
    decide(simState);
    S.step(simState);
    if (i % FPS === 0) {
      trace.push({
        t: +simState.t.toFixed(1),
        pump: +simState.pump.toFixed(2),
        v1: +simState.v1.toFixed(2),
        v2: +simState.v2.toFixed(2),
        level: simState.level.map(x => +x.toFixed(3)),
        salinity: simState.salinity.map(x => +x.toFixed(3)),
        oxygen: simState.oxygen.map(x => +x.toFixed(3)),
        turbidity: simState.turbidity.map(x => +x.toFixed(3)),
        sandTimer: +simState.sandTimer.toFixed(1),
        pressure: +simState.pressure.toFixed(2)
      });
    }
  }
  return { state: simState, trace };
}

const report = { generatedAt: new Date().toISOString(), scenarios: {}, checks: [] };
function check(name, pass, detail) {
  report.checks.push({ name, pass, detail });
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + '  ' + detail);
}

// Scenario 1 (required): complete one stable circulation cycle.
{
  const s = S.createState(20261114);
  const { state, trace } = run(s, st => S.autoPilot(st), 180);
  report.scenarios.stableCycle = {
    status: state.status,
    closeReason: state.closeReason,
    durationSec: +state.t.toFixed(1),
    holdSec: +state.inRangeHold.toFixed(1),
    maxPump: +Math.max(...trace.map(r => r.pump)).toFixed(2),
    sandEverActive: trace.some(r => r.sandTimer > 0),
    final: trace[trace.length - 1],
    traceHead: trace.slice(0, 6),
    traceTail: trace.slice(-6),
    events: state.events
  };
  check('稳定循环完成', state.status === 'stabilized',
    'status=' + state.status + ' at ' + state.t.toFixed(1) + 's');
  check('全程泵速低于翻砂阈值', report.scenarios.stableCycle.maxPump < S.CONFIG.sandPumpThreshold,
    'maxPump=' + report.scenarios.stableCycle.maxPump + ' < ' + S.CONFIG.sandPumpThreshold);
  check('三缸最终全部达标', [0, 1, 2].every(i => S.inRange(state, i)),
    'inRange=' + [0, 1, 2].map(i => S.inRange(state, i)).join(','));
  check('稳定循环未触发翻砂', !report.scenarios.stableCycle.sandEverActive,
    'sandTimer stayed 0');
}

// Scenario 2 (required): fine-sand churn failure -> closure.
{
  const s = S.createState(99);
  s.target.pump = 1;
  const { state, trace } = run(s, st => { st.target.pump = 1; }, 40);
  report.scenarios.sandFailure = {
    status: state.status,
    closeReason: state.closeReason,
    durationSec: +state.t.toFixed(1),
    sandTimerAtClose: +state.sandTimer.toFixed(1),
    turbidityA: +state.turbidity[0].toFixed(3),
    trace: trace.filter(r => r.t % 2 === 0),
    events: state.events
  };
  check('细砂翻涌导致闭馆', state.status === 'closed' && state.closeReason === 'sand',
    'status=' + state.status + ' reason=' + state.closeReason);
  check('闭馆前翻砂持续约 8 秒',
    Math.abs(state.sandTimer - S.CONFIG.sandCloseSeconds) < 0.2,
    'sandTimer=' + state.sandTimer.toFixed(1) + 's');
  check('翻砂使 A 缸浊度越限', state.turbidity[0] > S.CONFIG.ranges.turbidity[1],
    'turbidityA=' + state.turbidity[0].toFixed(2) + ' > ' + S.CONFIG.ranges.turbidity[1]);
}

// Scenario 3: rapid valve switching creates pressure surges.
{
  const s = S.createState(5);
  let maxSurge = 0, alarmSeen = false;
  const frames = 10 * FPS;
  for (let i = 0; i < frames && s.status === 'running'; i++) {
    // alternate full-open / near-closed every ~0.33 s
    s.target.v1 = (Math.floor(i / 10) % 2 === 0) ? 1 : 0.05;
    s.target.v2 = (Math.floor(i / 10) % 2 === 0) ? 0.05 : 1;
    S.step(s);
    maxSurge = Math.max(maxSurge, s.surge);
    if (s.surgeAlarm > 0 || s.pressureAlarmOn) alarmSeen = true;
  }
  report.scenarios.pressureSurge = {
    maxSurge: +maxSurge.toFixed(2),
    surgeAlarmSeen: alarmSeen,
    events: s.events.filter(e => e.type === 'surge' || e.type === 'pressure')
  };
  check('快速切阀产生压力波动', maxSurge > S.CONFIG.surgeAlarm,
    'maxSurge=' + maxSurge.toFixed(2) + ' > ' + S.CONFIG.surgeAlarm);
  check('波动告警被触发', alarmSeen, 'surgeAlarmSeen=' + alarmSeen);
}

// Scenario 3b: large valve imbalance raises discharge pressure past the limit.
{
  const s = S.createState(5);
  s.target.pump = 1; s.target.v1 = 1; s.target.v2 = 0.1;
  let pressureAlarmSeen = false;
  const frames = 8 * FPS;
  for (let i = 0; i < frames && s.status === 'running'; i++) {
    s.target.pump = 1; s.target.v1 = 1; s.target.v2 = 0.1;
    S.step(s);
    if (s.pressureAlarmOn) pressureAlarmSeen = true;
  }
  report.scenarios.overpressure = {
    pressureAlarmSeen,
    maxPressure: +s.pressure.toFixed(2),
    events: s.events.filter(e => e.type === 'pressure')
  };
  check('阀门失衡导致超压告警', pressureAlarmSeen,
    'maxPressure=' + s.pressure.toFixed(2) + ' > ' + S.CONFIG.pressureAlarm);
}

// Scenario 4: no intervention -> drifting parameters eventually close the aquarium.
{
  const s = S.createState(11);
  const { state } = run(s, () => {}, 60);
  report.scenarios.driftClosure = {
    status: state.status,
    closeReason: state.closeReason,
    durationSec: +state.t.toFixed(1),
    abnormalTime: state.abnormalTime.map(x => +x.toFixed(1))
  };
  check('无干预时漂移最终闭馆', state.status === 'closed',
    'status=' + state.status + ' reason=' + state.closeReason +
    ' at ' + state.t.toFixed(1) + 's');
}

const failed = report.checks.filter(c => !c.pass);
report.passed = failed.length === 0;
const outDir = path.join(__dirname, '..', 'artifacts');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'verification.json'),
  JSON.stringify(report, null, 2));
console.log('\n' + (report.passed ? 'ALL CHECKS PASSED' : failed.length + ' CHECK(S) FAILED'));
process.exit(report.passed ? 0 : 1);
