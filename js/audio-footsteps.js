/* Web Audio 程序化脚步声：滤波噪声脉冲 + 低频 thump，按时间线调度。 */
(function () {
  "use strict";
  const HH = (window.HH = window.HH || globalThis.HH || {}); globalThis.HH = HH;

  HH.FootstepAudio = function FootstepAudio() {
    this.ctx = null;
    this.master = null;
    this.enabled = false;
    this.rate = 1.8;
    this.volume = 0.5;
    this.nextStepAt = 0;
    this.stepIndex = 0;
    this.timer = null;
  };

  HH.FootstepAudio.prototype.ensureContext = function () {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error("当前浏览器不支持 Web Audio");
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
  };

  HH.FootstepAudio.prototype.enable = function () {
    this.ensureContext();
    if (this.ctx.state === "suspended") this.ctx.resume();
    this.enabled = true;
  };

  HH.FootstepAudio.prototype.disable = function () {
    this.enabled = false;
    this.stopScheduler();
  };

  HH.FootstepAudio.prototype.setVolume = function (v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  };

  HH.FootstepAudio.prototype.setRate = function (rate) {
    this.rate = Math.max(0.5, rate);
  };

  HH.FootstepAudio.prototype.playStep = function (when) {
    const ctx = this.ctx;
    const duration = 0.16;
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const decay = Math.pow(1 - i / bufferSize, 2.2);
      data[i] = (Math.random() * 2 - 1) * decay;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 320 + (this.stepIndex % 2) * 90;
    band.Q.value = 0.9;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.9, when);
    noiseGain.gain.exponentialRampToValueAtTime(0.02, when + duration);
    noise.connect(band).connect(noiseGain).connect(this.master);
    noise.start(when);
    noise.stop(when + duration);

    const thump = ctx.createOscillator();
    thump.type = "sine";
    thump.frequency.setValueAtTime(95, when);
    thump.frequency.exponentialRampToValueAtTime(48, when + 0.12);
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.7, when);
    thumpGain.gain.exponentialRampToValueAtTime(0.01, when + 0.14);
    thump.connect(thumpGain).connect(this.master);
    thump.start(when);
    thump.stop(when + 0.16);

    this.stepIndex++;
  };

  /* timelineNow: 返回当前时间线秒数；durationSec: 总时长。 */
  HH.FootstepAudio.prototype.startScheduler = function (timelineNow, durationSec) {
    if (!this.enabled || !this.ctx) return;
    this.stopScheduler();
    const interval = 1 / this.rate;
    const step = interval;
    let firstStep = Math.ceil(timelineNow() / step) * step;
    if (firstStep < timelineNow()) firstStep += step;
    this.nextStepAt = firstStep;

    const self = this;
    this.timer = window.setInterval(function () {
      if (!self.enabled) return;
      const ahead = self.ctx.currentTime + 0.12;
      while (self.nextStepAt < ahead) {
        const tl = self.nextStepAt;
        const now = timelineNow();
        if (tl >= now - 0.05 && tl <= durationSec) {
          self.playStep(self.ctx.currentTime + Math.max(0, tl - now));
        }
        self.nextStepAt += step;
        if (self.nextStepAt > durationSec + 0.2) break;
      }
    }, 40);
  };

  HH.FootstepAudio.prototype.stopScheduler = function () {
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  };

  HH.FootstepAudio.prototype.seek = function (timelineNow, durationSec, playing) {
    this.stopScheduler();
    if (playing) this.startScheduler(timelineNow, durationSec);
  };
})();
