const S = require('../js/simulation.js');

function run(speeds, homes, strategies, budget) {
  const sim = new S.Simulation({
    speeds, homes, strategies, budget,
  });
  return sim.runHeadless();
}

function fmt(r) {
  return {
    ok: r.success,
    t: r.time.toFixed(1),
    energy: Math.round(r.energy),
    stops: r.stops,
    starts: r.starts,
    complaints: r.complaints,
    delivered: r.delivered + '/' + r.total,
    avgWait: r.avgWait == null ? '-' : r.avgWait.toFixed(1),
    maxWait: Math.round(r.maxWait),
    reasons: r.reasons.join('; '),
  };
}

const speedSets = {
  allSlow: ['slow', 'slow', 'slow'],
  allMedium: ['medium', 'medium', 'medium'],
  allFast: ['fast', 'fast', 'fast'],
  mixed: ['fast', 'medium', 'medium'],
};
const homeSets = {
  homeLobby: [1, 1, 1],
  homeZonal: [1, 4, 7],
  homeMid: [4, 4, 4],
};
const strategies = ['collective', 'collective', 'collective'];

for (const [hk, homes] of Object.entries(homeSets)) {
  for (const [sk, speeds] of Object.entries(speedSets)) {
    const r = run(speeds, homes, strategies, 99999);
    console.log(hk.padEnd(10), sk.padEnd(10), JSON.stringify(fmt(r)));
  }
}

// 策略维度对比（中速 + 两种回位）
console.log('\n--- 停靠策略对比（中速，分区回位）---');
for (const strat of ['collective', 'allstop', 'fullload']) {
  const r = run(['medium', 'medium', 'medium'], [1, 4, 7],
    [strat, strat, strat], 99999);
  console.log(strat.padEnd(10), JSON.stringify(fmt(r)));
}
