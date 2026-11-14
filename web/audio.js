/* Web Audio 合成：机械节拍、操作确认音、堵塞/溢出警报（无外部音频资源） */
(function () {
  'use strict';

  function AudioEngine() {
    this.ctx = null;
    this.muted = false;
    this.alarmNodes = null;
  }

  AudioEngine.prototype.ensure = function () {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  };

  AudioEngine.prototype.setMuted = function (m) {
    this.muted = m;
    if (m) this.stopAlarm();
  };

  // 单次机械咔哒：短噪声脉冲 + 低频方波
  AudioEngine.prototype.click = function (freq, dur) {
    if (this.muted) return;
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq || 180, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + (dur || 0.08));
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + (dur || 0.08));
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + (dur || 0.08) + 0.02);
  };

  // 机械节拍：皮带运转的周期性轻击
  AudioEngine.prototype.tick = function () {
    if (this.muted) return;
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.03, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) * 0.25;
    }
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = 0.12;
    src.buffer = buf;
    src.connect(gain).connect(ctx.destination);
    src.start(t);
  };

  // 操作确认：两声上行
  AudioEngine.prototype.confirm = function () {
    this.click(320, 0.07);
    const self = this;
    setTimeout(function () { self.click(480, 0.07); }, 70);
  };

  // 堵塞警报：双音交替循环，直到 stopAlarm
  AudioEngine.prototype.startAlarm = function () {
    if (this.muted || this.alarmNodes) return;
    const ctx = this.ensure();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 660;
    lfo.frequency.value = 2.2;
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain).connect(osc.frequency);
    gain.gain.value = 0.06;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    lfo.start();
    this.alarmNodes = { osc, lfo, gain };
  };

  AudioEngine.prototype.stopAlarm = function () {
    if (!this.alarmNodes) return;
    const ctx = this.ctx;
    const n = this.alarmNodes;
    const t = ctx.currentTime;
    n.gain.gain.cancelScheduledValues(t);
    n.gain.gain.setValueAtTime(n.gain.gain.value, t);
    n.gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    n.osc.stop(t + 0.18);
    n.lfo.stop(t + 0.18);
    this.alarmNodes = null;
  };

  // 溢出失败：下行滑音
  AudioEngine.prototype.crash = function () {
    if (this.muted) return;
    this.stopAlarm();
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(400, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.7);
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.75);
  };

  // 通关：三音上行琶音
  AudioEngine.prototype.win = function () {
    if (this.muted) return;
    this.stopAlarm();
    const notes = [523, 659, 784];
    notes.forEach((f, i) => {
      const self = this;
      setTimeout(function () { self.click(f, 0.18); }, i * 140);
    });
  };

  window.AudioEngine = AudioEngine;
})();
