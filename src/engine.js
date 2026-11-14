// Web Audio 渲染引擎：按当前节点顺序构建实时链路，调度输入脉冲并监测持续过载。

import { NODE_TYPE, modeOf } from './model.js';

export const OVERLOAD_LIMIT_SECONDS = 5;

const PING_INTERVAL = 1.2;
const PING_FREQUENCY = 320;
const PING_GAIN = 0.55;
const WET_GAIN = 0.6;
const DRY_GAIN = 0.45;

function createUnit(ctx, card) {
  const mode = modeOf(card);
  if (card.type === NODE_TYPE.GAIN) {
    const node = ctx.createGain();
    node.gain.value = mode.gain;
    return { input: node, output: node };
  }
  if (card.type === NODE_TYPE.FILTER) {
    const node = ctx.createBiquadFilter();
    node.type = mode.kind;
    node.frequency.value = mode.frequency;
    node.Q.value = mode.q;
    return { input: node, output: node };
  }
  // delay：内部构成 feedback -> delay -> 输出单元，反馈量由旋转档位决定。
  const delay = ctx.createDelay(2);
  delay.delayTime.value = mode.delayTime;
  const feedback = ctx.createGain();
  feedback.gain.value = mode.feedback;
  const output = ctx.createGain();
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(output);
  return { input: delay, output, feedbackGain: feedback };
}

export class AudioEngine {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.destination = destination || ctx.destination;
    this.sourceBus = ctx.createGain();
    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = DRY_GAIN;
    this.wetGain = ctx.createGain();
    this.wetGain.gain.value = WET_GAIN;
    this.merger = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.timeData = new Float32Array(this.analyser.fftSize);
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);

    this.sourceBus.connect(this.dryGain);
    this.dryGain.connect(this.merger);
    this.sourceBus.connect(this.wetGain);
    this.wetGain.connect(this.merger);
    this.merger.connect(this.analyser);
    this.analyser.connect(this.destination);

    this.units = [];
    this.overloadedSeconds = 0;
    this.failed = false;
    this.overloadSince = null;
    this.lastRms = 0;
    this.peak = 0;
  }

  // 按板上节点顺序重建 wet 处理链；dry 直通主信号始终保留。
  buildChain(board) {
    for (const unit of this.units) {
      try { unit.input.disconnect(); } catch { /* 未连接 */ }
      try { unit.output.disconnect(); } catch { /* 未连接 */ }
      if (unit.feedbackGain) {
        try { unit.feedbackGain.disconnect(); } catch { /* 未连接 */ }
      }
    }
    this.units = board.map((card) => createUnit(this.ctx, card));
    try { this.wetGain.disconnect(); } catch { /* 首次构建 */ }
    this.wetGain.connect(this.merger);
    if (this.units.length === 0) {
      return;
    }
    this.wetGain.connect(this.units[0].input);
    for (let i = 0; i < this.units.length - 1; i += 1) {
      this.units[i].output.connect(this.units[i + 1].input);
    }
    this.units[this.units.length - 1].output.connect(this.merger);
  }

  // 调度一个短促输入脉冲（带少量噪声，模拟工作站输入信号）。
  schedulePing(when) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = PING_FREQUENCY;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, when);
    amp.gain.exponentialRampToValueAtTime(PING_GAIN, when + 0.02);
    amp.gain.exponentialRampToValueAtTime(0.0001, when + 0.35);

    const noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) * 0.12;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const noiseAmp = ctx.createGain();
    noiseAmp.gain.value = 0.5;

    osc.connect(amp);
    amp.connect(this.sourceBus);
    noise.connect(noiseAmp);
    noiseAmp.connect(this.sourceBus);
    osc.start(when);
    osc.stop(when + 0.4);
    noise.start(when);
    noise.stop(when + 0.2);
  }

  startPings() {
    this.schedulePing(this.ctx.currentTime + 0.05);
  }

  // 实时监测：分析器时域采样越过满幅即累计，连续 5 秒判失败；出现干净帧则清零。
  update(nowSeconds) {
    if (this.failed) return { failed: true, overloaded: true, rms: this.lastRms, peak: this.peak };
    this.analyser.getFloatTimeDomainData(this.timeData);
    this.analyser.getByteFrequencyData(this.freqData);
    let sumSq = 0;
    let overloaded = false;
    for (let i = 0; i < this.timeData.length; i += 1) {
      const v = this.timeData[i];
      sumSq += v * v;
      // 浏览器 AnalyserNode 会把满幅样本钳在 ±1；Node 原生实现保留浮点，
      // 因此统一用 >= 1 判定削波，两种环境行为一致。
      if (Math.abs(v) >= 0.999) overloaded = true;
    }
    this.lastRms = Math.sqrt(sumSq / this.timeData.length);
    this.peak = 0;
    for (let i = 0; i < this.timeData.length; i += 1) {
      if (Math.abs(this.timeData[i]) > this.peak) this.peak = Math.abs(this.timeData[i]);
    }
    if (overloaded) {
      if (this.overloadSince === null) this.overloadSince = nowSeconds;
      this.overloadedSeconds = nowSeconds - this.overloadSince;
    } else {
      this.overloadedSeconds = 0;
      this.overloadSince = null;
    }
    if (this.overloadedSeconds >= OVERLOAD_LIMIT_SECONDS) {
      this.failed = true;
    }
    return {
      failed: this.failed,
      overloaded,
      overloadSeconds: this.overloadedSeconds,
      rms: this.lastRms,
      peak: this.peak,
    };
  }

  getSpectrum() {
    return this.freqData;
  }
}

// 离线路径：一次性把整段时间轴上的脉冲排好，渲染出 AudioBuffer 供自动化验证。
export function buildOfflineGraph(ctx, board, durationSeconds) {
  const engine = new AudioEngine(ctx);
  engine.buildChain(board);
  const pingCount = Math.max(1, Math.floor(durationSeconds / PING_INTERVAL));
  for (let i = 0; i < pingCount; i += 1) {
    engine.schedulePing(i * PING_INTERVAL + 0.05);
  }
  return engine;
}
