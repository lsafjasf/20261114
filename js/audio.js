// 基于 Web Audio 的状态音效：运行嗡鸣随速度变调，到站/投诉/结束提示音
(function (root) {
  'use strict';

  const HUM = {
    slow: 70, medium: 100, fast: 140,
  };

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.muted = false;
      this.hums = [];
    }

    ensure() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      for (let i = 0; i < 3; i++) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = HUM.medium;
        gain.gain.value = 0;
        osc.connect(gain).connect(this.master);
        osc.start();
        this.hums.push({ osc, gain });
      }
    }

    setMuted(muted) {
      this.muted = muted;
      if (this.master) {
        this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
      }
    }

    // 每帧同步三部梯的运行状态
    sync(cars) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      cars.forEach((car, i) => {
        const hum = this.hums[i];
        if (!hum) return;
        if (car.mode === 'moving') {
          const base = HUM[car.speedKey] || HUM.medium;
          const target = base * (car.dir < 0 ? 0.85 : 1);
          hum.osc.frequency.setTargetAtTime(target, t, 0.12);
          hum.gain.gain.setTargetAtTime(0.045, t, 0.1);
        } else if (car.mode === 'doors') {
          hum.osc.frequency.setTargetAtTime(50, t, 0.1);
          hum.gain.gain.setTargetAtTime(0.015, t, 0.1);
        } else {
          hum.gain.gain.setTargetAtTime(0, t, 0.15);
        }
      });
    }

    _beep(freq, duration, type, when, vol) {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      const start = this.ctx.currentTime + (when || 0);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(vol || 0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain).connect(this.master);
      osc.start(start);
      osc.stop(start + duration + 0.05);
    }

    arrive() {
      this._beep(880, 0.18, 'sine', 0, 0.16);
      this._beep(660, 0.28, 'sine', 0.16, 0.16);
    }

    complaint() {
      this._beep(220, 0.2, 'square', 0, 0.12);
      this._beep(180, 0.32, 'square', 0.2, 0.12);
    }

    finish(success) {
      if (success) {
        [523, 659, 784, 1047].forEach((f, i) =>
          this._beep(f, 0.3, 'triangle', i * 0.16, 0.18));
      } else {
        [392, 330, 262].forEach((f, i) =>
          this._beep(f, 0.35, 'sawtooth', i * 0.2, 0.14));
      }
    }
  }

  root.AudioEngine = AudioEngine;
})(window);
