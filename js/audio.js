'use strict';

// Web Audio 合成三指电机声：基频随闭合速度变化，负载（指力）提升音量与粗糙度，
// 打滑触发噪声抖动，压坏给出短促下行警示音。
class MotorAudio {
  constructor() {
    this.ctx = null;
    this.osc = null;
    this.gain = null;
    this.lfo = null;
    this.lfoGain = null;
    this.noiseBuffer = null;
    this.noiseGain = null;
    this.enabled = true;
  }

  ensureContext() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.osc = this.ctx.createOscillator();
    this.osc.type = 'sawtooth';
    this.osc.frequency.value = 60;

    this.lfo = this.ctx.createOscillator();
    this.lfo.type = 'square';
    this.lfo.frequency.value = 18;
    this.lfoGain = this.ctx.createGain();
    this.lfoGain.gain.value = 0;
    this.lfo.connect(this.lfoGain).connect(this.osc.frequency);

    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    this.osc.connect(filter).connect(this.gain).connect(this.ctx.destination);

    const len = this.ctx.sampleRate;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.osc.start();
    this.lfo.start();
  }

  resume() {
    this.ensureContext();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  // intensity 0-1（负载），speed 0-100，slip 0-1
  update(intensity, speed, slip) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const running = intensity > 0.02;
    const freq = 55 + speed * 1.6 + intensity * 90;
    this.osc.frequency.setTargetAtTime(running ? freq : 45, t, 0.05);
    this.gain.gain.setTargetAtTime(running ? 0.02 + intensity * 0.10 : 0, t, 0.08);
    this.lfoGain.gain.setTargetAtTime(slip > 0.6 ? 14 : intensity * 4, t, 0.1);
  }

  warn() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(320, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.35);
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(g).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + 0.42);
  }

  success() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    [440, 660, 880].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.1);
      g.gain.exponentialRampToValueAtTime(0.12, t + i * 0.1 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.1 + 0.12);
      o.connect(g).connect(this.ctx.destination);
      o.start(t + i * 0.1);
      o.stop(t + i * 0.1 + 0.14);
    });
  }

  toggle() {
    this.enabled = !this.enabled;
    if (!this.enabled && this.gain) this.gain.gain.value = 0;
    return this.enabled;
  }
}

window.MotorAudio = MotorAudio;
