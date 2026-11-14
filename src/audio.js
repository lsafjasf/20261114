import { CONFIG as C } from './config.js';

// 缆绳张力 -> 音高：松弛静音，张紧后频率随张力指数上升，过紧叠加警告颤音。
export class TensionAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.ready = false;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const ctx = this.ctx;
    this.osc = ctx.createOscillator();
    this.osc.type = 'sine';
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'square';
    this.lfo.frequency.value = 9;
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = 0;
    this.lfo.connect(this.lfoGain).connect(this.osc.frequency);
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.osc.connect(this.gain).connect(ctx.destination);
    this.osc.start();
    this.lfo.start();
    this.ready = true;
  }

  update(tension) {
    if (!this.ready || this.muted) return;
    const a = C.audio;
    const load = Math.min(1, tension / a.tightFreq);
    const engaged = tension > 4;
    const freq = engaged
      ? a.slackFreq + (a.tightFreq - a.slackFreq) * Math.pow(load, 1.35)
      : a.slackFreq;
    const now = this.ctx.currentTime;
    this.osc.frequency.setTargetAtTime(freq, now, 0.05);
    const danger = tension > C.rope.safeTension;
    const targetGain = engaged
      ? a.masterGain * (0.25 + 0.75 * load) * (danger ? 1 : 0.85)
      : 0;
    this.gain.gain.setTargetAtTime(targetGain, now, 0.08);
    this.lfoGain.gain.setTargetAtTime(danger ? 28 : 0, now, 0.05);
  }

  blip(freq = 660, dur = 0.12, type = 'triangle', vol = 0.12) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + dur);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ready && this.muted) this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    return this.muted;
  }
}
