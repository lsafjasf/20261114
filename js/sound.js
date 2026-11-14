/* 轻量操作音效：纯振荡器短音，无外部资源，可静音 */
(function (global) {
  'use strict';
  const Sound = {
    ctx: null, enabled: true,
    _ensure: function () {
      if (!this.ctx) {
        const AC = global.AudioContext || global.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    _blip: function (freq, dur, type, gain) {
      if (!this.enabled) return;
      const ctx = this._ensure();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      const t = ctx.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain || 0.05, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    },
    slide: function () { this._blip(420, 0.045, 'triangle', 0.025); },
    submit: function () { this._blip(560, 0.09, 'sine', 0.045); },
    hit: function () {
      this._blip(660, 0.1, 'sine', 0.05);
      setTimeout(() => this._blip(880, 0.16, 'sine', 0.05), 90);
    },
    miss: function () { this._blip(180, 0.18, 'sawtooth', 0.035); },
    round: function () { this._blip(330, 0.12, 'triangle', 0.04); }
  };
  global.Sound = Sound;
})(typeof window !== 'undefined' ? window : globalThis);
