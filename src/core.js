// 纯逻辑核心：复节奏数学、闸门开合、物体运动与碰撞判定。
// 不依赖 DOM / Web Audio，可同时被浏览器与 Node 仿真引用。

export const BAR = 4.0;                 // 一个小节（秒），3:4:5 在每小节内对齐
export const GATES = [
  { id: 0, n: 3, name: '三脉冲', color: '#4cc9f0', freq: 392.0 },
  { id: 1, n: 4, name: '四脉冲', color: '#f4a261', freq: 523.25 },
  { id: 2, n: 5, name: '五脉冲', color: '#e76f8f', freq: 659.25 },
];

export const SPAWN_INTERVAL = 2.0;      // 每 2 秒投入一个物体
export const OBJECT_COUNT = 12;         // 需要通过的物体总数
export const MAX_FAIL_STREAK = 3;       // 连续三次失败即停机

// 隧道几何（世界坐标，单位像素；逻辑层只存比例）
export const TUNNEL = {
  width: 900,
  spawnX: 40,
  exitX: 860,
  gateX: [300, 470, 640],
};
export const OBJECT_SPEED = 120;        // 像素 / 秒

// 物体到达各闸门的时间偏移（相对自身生成时刻）
export const GATE_TRAVEL = TUNNEL.gateX.map(
  (x) => (x - TUNNEL.spawnX) / OBJECT_SPEED,
);

// 默认参数：故意调成“无法通过”，要求玩家/调参求解
export const DEFAULT_PARAMS = GATES.map((g) => ({
  strength: 0.35,
  offset: 0.0,
}));

// 已验证可让 12 个物体全部通过的参数（由 test/simulate.mjs 搜索得出，带容错余量）
export const SOLVED_PARAMS = [
  { strength: 0.75, offset: 0.375 },
  { strength: 0.50, offset: 0.583 },
  { strength: 0.75, offset: 0.0 },
];

export function gatePeriod(gate) {
  return BAR / gate.n;
}

// 强弱 → 开门半宽（相位单位）。strength∈[0,1]
export function gateHalfPhase(strength) {
  return 0.05 + 0.35 * strength;
}

// 相位：把时间折叠到 [0,1)，offset 为脉冲中心相对节拍原点的相位偏移
export function gatePhaseAt(gate, params, time) {
  const period = gatePeriod(gate);
  const shifted = (time - params.offset * period) / period;
  return shifted - Math.floor(shifted);
}

// 距最近脉冲中心的环形距离（相位单位，0~0.5）
export function phaseDistanceToPulse(phase) {
  const d = phase - Math.round(phase);
  return Math.abs(d);
}

export function isGateOpenAt(gate, params, time) {
  const phase = gatePhaseAt(gate, params, time);
  return phaseDistanceToPulse(phase) <= gateHalfPhase(params.strength);
}

// 物体在某一时刻的世界坐标
export function objectX(spawnTime, time) {
  if (time < spawnTime) return TUNNEL.spawnX;
  return TUNNEL.spawnX + (time - spawnTime) * OBJECT_SPEED;
}

// 精确判定某个物体（生成时刻 spawnTime）在每个闸门处的通过结果。
// 到达时刻是解析精确值，避免按帧采样带来的误差。
export function evaluateObject(params, spawnTime) {
  const results = GATES.map((gate, i) => {
    const arriveTime = spawnTime + GATE_TRAVEL[i];
    const open = isGateOpenAt(gate, params[i], arriveTime);
    return { gateId: gate.id, arriveTime, open };
  });
  const firstClosed = results.find((r) => !r.open);
  return {
    spawnTime,
    passed: !firstClosed,
    failedAt: firstClosed ? firstClosed.gateId : null,
    results,
  };
}

// 整批 12 个物体的离线仿真，返回逐物体结果与统计
export function simulateRun(params) {
  const objects = [];
  let failStreak = 0;
  let halted = false;
  for (let k = 0; k < OBJECT_COUNT; k += 1) {
    const spawnTime = k * SPAWN_INTERVAL;
    const outcome = halted
      ? { spawnTime, passed: false, failedAt: -1, results: [], neverRan: true }
      : evaluateObject(params, spawnTime);
    if (!outcome.passed) {
      failStreak += 1;
      if (failStreak >= MAX_FAIL_STREAK) halted = true;
    } else {
      failStreak = 0;
    }
    objects.push(outcome);
  }
  const passed = objects.filter((o) => o.passed).length;
  return {
    objects,
    passed,
    allPassed: passed === OBJECT_COUNT,
    halted,
  };
}

// 网格搜索可行参数（供离线调参与验证）。逐闸门求“覆盖全部到达时刻、
// 且最差余量最大”的参数；为可复现，采用固定网格分辨率。
export function searchSolution() {
  const steps = 120;
  const params = GATES.map((gate, gi) => {
    let localBest = null;
    for (let oi = 0; oi < steps; oi += 1) {
      const offset = oi / steps;
      // 该偏移下覆盖所有到达时刻所需的最小半宽
      let needHalf = 0;
      for (let k = 0; k < OBJECT_COUNT; k += 1) {
        const arrive = k * SPAWN_INTERVAL + GATE_TRAVEL[gi];
        const dist = phaseDistanceToPulse(gatePhaseAt(gate, { strength: 1, offset }, arrive));
        needHalf = Math.max(needHalf, dist);
      }
      // 留出固定容错，反推强弱
      const targetHalf = needHalf + 0.06;
      if (targetHalf > gateHalfPhase(1)) continue;
      const strength = Math.min(
        1,
        Math.max(0, (targetHalf - 0.05) / 0.35),
      );
      const candidate = {
        strength: Math.round(strength * 1000) / 1000,
        offset,
      };
      // 以最弱（最省强弱）且余量充足为优
      if (!localBest || candidate.strength < localBest.candidate.strength) {
        localBest = { candidate, worstMargin: gateHalfPhase(candidate.strength) - needHalf };
      }
    }
    return localBest ? localBest.candidate : { strength: 1, offset: 0 };
  });
  const run = simulateRun(params);
  return { params, passed: run.passed, run };
}
