'use strict';

// 三指机械手抓握仿真核心：纯函数 + 状态机，无 DOM 依赖，可在 Node 中测试。
// 单位：力 N，距离 m，时间 s，压强/速度/阈值均为 0-100 的玩家输入。

const FINGER_FORCE_FACTORS = [1.0, 0.96, 1.04]; // 三指微小制造差异，最差手指决定压坏
const WORST_FINGER = 1.04;
const FINGER_COUNT = 3;
const REACTION_BASE = 0.02; // 接触反馈触发后的基础制动延迟
const GAP = 0.18; // 指尖到物体表面的初始距离

// stiffness: 接触刚度 N/m；maxSafe: 单指安全力；mu: 摩擦系数；weight: 物重 N
const OBJECTS = {
  soft:   { id: 'soft',   label: '软物（海绵球）',   stiffness: 1200,  maxSafe: 8,  crushDeform: 0.55, mu: 0.95, weight: 3.0 },
  medium: { id: 'medium', label: '中等（硅胶块）',   stiffness: 4000,  maxSafe: 16, crushDeform: 0.32, mu: 0.70, weight: 7.0 },
  hard:   { id: 'hard',   label: '硬物（金属罐）',   stiffness: 15000, maxSafe: 30, crushDeform: 0.10, mu: 0.38, weight: 12.0 },
};

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

const PHASES = ['idle', 'approaching', 'compressing', 'holding', 'lifting', 'passed', 'failed'];

// 逐帧动画状态机：驱动 Canvas 渲染与电机声，最终判定与静态 evaluate 一致。
class GraspSim {
  constructor(params) {
    this.metrics = evaluate(params);
    this.params = params;
    this.obj = OBJECTS[params.objectId];
    this.phase = 'idle';
    this.phaseElapsed = 0;
    this.elapsed = 0;
    this.failed = false;
    this.passed = false;
    this.reason = '';
    this.fingerForces = [0, 0, 0];
    this.fingerGaps = [GAP, GAP, GAP];
    // 视觉闭合时长：闭合越快动画越短（与物理速度解耦，避免等待数十秒）
    this.approachDuration = 1.8 - (params.speed / 100) * 1.2;
    this.peakSeen = 0;
    this.slipOffset = 0;
    this.liftHeight = 0;
    this.holdForceTarget = Math.min(this.metrics.targetMax, this.metrics.thresholdForce);
  }

  start() {
    this.phase = 'approaching';
  }

  fail(reason) {
    this.failed = true;
    this.reason = reason;
    this.phase = 'failed';
  }

  update(dt) {
    if (this.passed || this.failed) return;
    dt = Math.max(0, Math.min(dt, 0.05));
    this.phaseElapsed += dt;
    this.elapsed += dt;
    const m = this.metrics;

    if (this.phase === 'approaching') {
      const gap = GAP * Math.max(0, 1 - this.phaseElapsed / this.approachDuration);
      this.fingerGaps = FINGER_FORCE_FACTORS.map(() => gap);
      this.fingerForces = [0, 0, 0];
      if (gap <= 0) {
        this.phase = 'compressing';
        this.phaseElapsed = 0;
      }
    } else if (this.phase === 'compressing') {
      const frac = clamp01(this.phaseElapsed / 0.35);
      const ease = 1 - Math.pow(1 - frac, 2);
      const peak = m.peakForce;
      this.fingerForces = FINGER_FORCE_FACTORS.map((k) => peak * (k / WORST_FINGER) * ease);
      this.fingerGaps = FINGER_FORCE_FACTORS.map(() => GAP * (1 - ease));
      this.peakSeen = Math.max(this.peakSeen, ...this.fingerForces);
      if (this.peakSeen > this.obj.maxSafe) this.fail('压力超过安全极限，物体被压坏');
      else if (frac >= 1) {
        this.phase = 'holding';
        this.phaseElapsed = 0;
      }
    } else if (this.phase === 'holding') {
      this.fingerForces = FINGER_FORCE_FACTORS.map((k) => this.holdForceTarget * k);
      this.fingerGaps = FINGER_FORCE_FACTORS.map(() => 0);
      if (this.phaseElapsed >= 0.6) {
        this.phase = 'lifting';
        this.phaseElapsed = 0;
      }
    } else if (this.phase === 'lifting') {
      this.fingerForces = FINGER_FORCE_FACTORS.map((k) => this.holdForceTarget * k);
      if (m.slipRatio > 1) {
        this.slipOffset += 60 * dt * (m.slipRatio - 0.8);
        if (this.phaseElapsed > 0.45) this.fail('提升时摩擦力不足，物体滑脱');
      } else {
        this.liftHeight = Math.min(70, 70 * clamp01(this.phaseElapsed / 0.8));
        if (this.phaseElapsed >= 0.9) {
          this.passed = true;
          this.phase = 'passed';
        }
      }
    }
  }

  snapshot() {
    return {
      phase: this.phase,
      elapsed: this.elapsed,
      fingerForces: this.fingerForces,
      fingerGaps: this.fingerGaps,
      peakForce: Math.max(this.peakSeen, this.metrics.peakForce),
      deformPct: this.metrics.deformPct * clamp01(this.peakSeen / Math.max(0.001, this.metrics.peakForce)),
      slipOffset: this.slipOffset,
      liftHeight: this.liftHeight,
      passed: this.passed,
      failed: this.failed,
      reason: this.reason,
      metrics: this.metrics,
    };
  }
}

// 由玩家输入与物体参数推演一次完整抓取的关键指标（静态、确定性）。
function evaluate(params) {
  const obj = OBJECTS[params.objectId];
  const speed = Math.max(1, Math.min(100, params.speed));
  const pressure = Math.max(0, Math.min(100, params.pressure));
  const feedback = Math.max(0, Math.min(100, params.feedback));

  const velocity = 0.03 * (speed / 100);                 // m/s 闭合速度
  const targetMax = pressure * 0.6;                      // 电机最大指令力 N
  const thresholdForce = (feedback / 100) * 30;          // 接触反馈阈值 N
  const commanded = Math.min(targetMax, thresholdForce); // 系统真正维持的目标力

  // 高速闭合 + 反馈延迟 -> 制动后惯性超调，约为目标力的一个速度相关比例
  const overshootRatio = 0.04 + 0.5 * (speed / 100);
  const brakeTime = REACTION_BASE + 0.0009 * speed;      // s（用于展示）
  const overshootForce = commanded * overshootRatio;
  const basePeak = commanded + overshootForce;
  const peakWorst = basePeak * WORST_FINGER;             // 最差手指峰值
  const holdWorst = Math.min(targetMax, thresholdForce) * WORST_FINGER;
  const holdAvg = Math.min(targetMax, thresholdForce);

  const deformPct = clamp01(peakWorst / obj.stiffness / 0.04) * 100;
  const requiredGrip = obj.weight / (FINGER_COUNT * obj.mu); // 防滑所需单指力
  const slipRatio = requiredGrip / Math.max(0.001, holdAvg);
  const crushed = peakWorst > obj.maxSafe;
  const liftSlip = slipRatio > 1;

  return {
    objectId: obj.id,
    velocity,
    targetMax,
    thresholdForce,
    commanded,
    overshootForce,
    brakeTime,
    peakForce: peakWorst,
    holdForce: holdWorst,
    holdAvg,
    deformPct,
    requiredGrip,
    slipRatio,
    slipRisk: clamp01(slipRatio),
    crushMargin: obj.maxSafe - peakWorst,
    gripMargin: holdAvg - requiredGrip,
    crushed,
    liftSlip,
    pass: !crushed && !liftSlip,
    contactTime: GAP / Math.max(velocity, 0.0003),
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { OBJECTS, FINGER_FORCE_FACTORS, evaluate, clamp01, GAP, GraspSim, PHASES };
}
