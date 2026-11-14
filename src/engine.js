import { pickFrequencies } from './rng.js';

const NOISE_BAND = [300, 2400]; // 残余能量评估带（主声源低通在 240Hz 以下）
const RESIDUAL_GOAL = 0.22; // 噪声带残余能量低于未处理参考值的 22% 即达标
const WIN_HOLD_SECONDS = 1.2;
const FAIL_DISTORTION = 100;

function makeShaperCurve(drive, size = 1024) {
  const curve = new Float32Array(size);
  const norm = Math.tanh(drive);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / norm;
  }
  return curve;
}

export class NoiseEngine {
  constructor(ctx, seed) {
    this.ctx = ctx;
    this.seed = seed;
    this.noiseFrequencies = pickFrequencies(seed);
    this.distortion = 0;
    this.instantStress = 0;
    this.residualRatio = 1;
    this.referenceEnergy = null;
    this._refSamples = [];
    this._refReadyAt = ctx.currentTime + 0.8;
    this.belowThresholdSince = null;
    this.state = 'running'; // running | won | failed
    this._lastTime = ctx.currentTime;
    this._notchPrev = [];
    this._buildGraph();
  }

  _buildGraph() {
    const ctx = this.ctx;

    // ---- 主声源：低音乐句垫（A 小和弦，低通压在噪声带以下）----
    this.mainBus = ctx.createGain();
    this.mainBus.gain.value = 0.32;
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 230;
    padFilter.Q.value = 0.4;
    const padNotes = [55, 110, 164.81, 220];
    padNotes.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? 'triangle' : 'sine';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 0.9 : 0.5 / i;
      osc.connect(g).connect(padFilter);
      osc.start();
      this['_pad' + i] = osc;
    });
    // 缓慢呼吸感
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.06;
    lfo.connect(lfoGain).connect(this.mainBus.gain);
    lfo.start();
    this._lfo = lfo;
    padFilter.connect(this.mainBus);

    // ---- 失真级：只作用于主声源 ----
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '4x';
    this.shaper.curve = makeShaperCurve(1);
    this.mainBus.connect(this.shaper);

    // ---- 三组临街周期噪声（固定 seed 决定频率）----
    this.noiseBus = ctx.createGain();
    this.noiseBus.gain.value = 0.9;
    this._noiseOscs = this.noiseFrequencies.map((f, i) => {
      const osc = ctx.createOscillator();
      // 纯线谱周期噪声：以正弦为主，一组三角波保留少量谐波色彩
      osc.type = ['sine', 'triangle', 'sine'][i];
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = [0.09, 0.075, 0.085][i];
      // 幅度起伏模拟门窗耦合，频率保持稳定以便陷波对准
      const trem = ctx.createOscillator();
      trem.frequency.value = 0.3 + i * 0.17;
      const tremGain = ctx.createGain();
      tremGain.gain.value = g.gain.value * 0.15;
      trem.connect(tremGain).connect(g.gain);
      trem.start();
      osc.connect(g).connect(this.noiseBus);
      osc.start();
      return osc;
    });

    // ---- 混合后进入玩家的滤波/对消链 ----
    this.chainInput = ctx.createGain();
    this.shaper.connect(this.chainInput);
    this.noiseBus.connect(this.chainInput);

    this.notches = [];
    let node = this.chainInput;
    for (let i = 0; i < 4; i++) {
      const notch = ctx.createBiquadFilter();
      notch.type = 'notch';
      notch.frequency.value = 1000;
      notch.Q.value = 1;
      node.connect(notch);
      node = notch;
      this.notches.push(notch);
      this._notchPrev.push({ freq: 1000, t: ctx.currentTime });
    }

    this.phases = [];
    for (let i = 0; i < 2; i++) {
      const unit = this._makePhaseUnit();
      node.connect(unit.input);
      node = unit.output;
      this.phases.push(unit);
    }

    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    node.connect(this.master);

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.3;
    this.master.connect(this.analyser);
    this.master.connect(ctx.destination);

    this._spectrum = new Float32Array(this.analyser.frequencyBinCount);
  }

  _makePhaseUnit() {
    const ctx = this.ctx;
    const input = ctx.createGain();
    const output = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 1;
    const delay = ctx.createDelay(0.01);
    delay.delayTime.value = 0.0005;
    const wet = ctx.createGain();
    wet.gain.value = 0; // 负增益实现反相对消
    input.connect(dry).connect(output);
    input.connect(delay).connect(wet).connect(output);
    return { input, output, delay, wet };
  }

  // 玩家控制接口 ----------------------------------------------------------
  setNotch(index, { frequency, q }) {
    const notch = this.notches[index];
    if (frequency !== undefined) {
      const now = this.ctx.currentTime;
      notch.frequency.setTargetAtTime(frequency, now, 0.03);
      this._notchPrev[index] = { freq: frequency, t: now };
    }
    if (q !== undefined) notch.Q.setTargetAtTime(q, this.ctx.currentTime, 0.03);
  }

  // phaseDeg: 10..180（延迟半周期对应的相位），wet: 0..1
  setPhase(index, { phaseDeg, wet }) {
    const unit = this.phases[index];
    if (phaseDeg !== undefined) {
      const delaySeconds = (phaseDeg / 180) * 0.00167;
      unit.delay.delayTime.setTargetAtTime(delaySeconds, this.ctx.currentTime, 0.03);
    }
    if (wet !== undefined) unit.wet.gain.setTargetAtTime(-wet, this.ctx.currentTime, 0.03);
  }

  resetControls() {
    this.notches.forEach((n, i) => {
      n.frequency.setTargetAtTime(1000, this.ctx.currentTime, 0.02);
      n.Q.setTargetAtTime(1, this.ctx.currentTime, 0.02);
      this._notchPrev[i] = { freq: 1000, t: this.ctx.currentTime };
    });
    this.phases.forEach((u) => {
      u.delay.delayTime.setTargetAtTime(0.0005, this.ctx.currentTime, 0.02);
      u.wet.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
    });
  }

  // 每帧评估 --------------------------------------------------------------
  update(controlState) {
    if (this.state !== 'running') return this.snapshot();
    const now = this.ctx.currentTime;
    const dt = Math.min(0.1, now - this._lastTime);
    this._lastTime = now;

    this._updateStress(controlState, dt);
    this._updateResidual(now, dt);
    return this.snapshot();
  }

  _updateStress(controlState, dt) {
    let stress = 0;
    // 陷波器：Q 过高 + 频率猛扫
    controlState.notches.forEach((c, i) => {
      const qStress = Math.max(0, (c.q - 8) / 32);
      const prev = this._notchPrev[i];
      const sweepDt = Math.max(0.02, this.ctx.currentTime - prev.t);
      const octaves = Math.abs(Math.log2(c.frequency / Math.max(20, prev.freq)));
      const sweepStress = Math.min(1, (octaves / sweepDt) / 6);
      stress += 0.16 * qStress + 0.12 * sweepStress;
    });
    // 相位对消：湿声拉满 + 延迟走到极端
    controlState.phases.forEach((c) => {
      const extreme = c.phaseDeg / 180;
      stress += 0.2 * c.wet * (0.45 + 0.55 * extreme * extreme);
    });
    stress = Math.min(1, stress);
    this.instantStress = stress;

    // 累计失真：满压力约 12 秒到 100%
    this.distortion = Math.min(FAIL_DISTORTION, this.distortion + stress * (100 / 12) * dt);
    const drive = 1 + 3 * stress;
    this.shaper.curve = makeShaperCurve(drive);
    if (this.distortion >= FAIL_DISTORTION) this.state = 'failed';
  }

  _measureBandEnergy() {
    this.analyser.getFloatFrequencyData(this._spectrum);
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    const lo = Math.max(1, Math.round(NOISE_BAND[0] / binHz));
    const hi = Math.min(this._spectrum.length - 1, Math.round(NOISE_BAND[1] / binHz));
    // 动态噪声底：带内 dB 的低分位数；只统计高出噪声底 8 dB 的 bin，
    // 这样残余能量反映的是噪声"线"而非本底与主声源泄漏。
    const slice = Array.from(this._spectrum.slice(lo, hi + 1)).sort((a, b) => a - b);
    const floor = slice[Math.floor(slice.length * 0.2)];
    let sum = 0;
    for (let i = lo; i <= hi; i++) {
      if (this._spectrum[i] >= floor + 8) sum += Math.pow(10, this._spectrum[i] / 20);
    }
    return sum;
  }

  _updateResidual(now, dt) {
    const energy = this._measureBandEnergy();
    if (this.referenceEnergy === null) {
      // 启动后的前 0.8 秒自动采集未处理参考（按挂钟时间，不依赖外部帧率）
      this._refSamples.push(energy);
      if (now >= this._refReadyAt) {
        this._refSamples.sort((a, b) => a - b);
        const mid = this._refSamples[Math.floor(this._refSamples.length / 2)];
        this.referenceEnergy = mid;
      }
      this.residualRatio = 1;
      return;
    }
    this.residualRatio = energy / this.referenceEnergy;
    if (this.residualRatio < RESIDUAL_GOAL) {
      if (this.belowThresholdSince === null) this.belowThresholdSince = now;
      if (now - this.belowThresholdSince >= WIN_HOLD_SECONDS) this.state = 'won';
    } else {
      this.belowThresholdSince = null;
    }
  }

  snapshot() {
    return {
      state: this.state,
      distortion: this.distortion,
      instantStress: this.instantStress,
      residualRatio: this.residualRatio,
      goal: RESIDUAL_GOAL,
      spectrum: this._spectrum,
      binHz: this.ctx.sampleRate / this.analyser.fftSize,
    };
  }

  dispose() {
    this.state = 'disposed';
    [...this._noiseOscs, this._lfo, ...[0, 1, 2, 3].map((i) => this['_pad' + i])]
      .filter(Boolean)
      .forEach((osc) => {
        try { osc.stop(); } catch { /* already stopped */ }
      });
    try { this.ctx.close(); } catch { /* already closed */ }
  }
}

export { RESIDUAL_GOAL, FAIL_DISTORTION };
