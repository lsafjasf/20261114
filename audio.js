// Web Audio 泵音：音高/音量/滤波随泵速变化，叠加低频机械脉动。

export class PumpAudio {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.osc = null;
    this.lfo = null;
    this.gain = null;
    this.filter = null;
  }

  async enable() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.osc = this.ctx.createOscillator();
      this.osc.type = 'sawtooth';
      this.filter = this.ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.gain = this.ctx.createGain();
      this.lfo = this.ctx.createOscillator();
      this.lfo.type = 'sine';
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 6;
      this.lfo.connect(lfoGain).connect(this.osc.frequency);
      this.osc.connect(this.filter).connect(this.gain).connect(this.ctx.destination);
      this.osc.start();
      this.lfo.start();
      this.gain.gain.value = 0;
    }
    await this.ctx.resume();
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
    if (this.gain) this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }

  // speed: 0~1 泵速；spike: 0+ 压力尖峰，出现时短暂提升亮度与音量
  update(speed, spike) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const baseFreq = 55 + speed * 150;
    this.osc.frequency.setTargetAtTime(baseFreq, t, 0.08);
    this.lfo.frequency.setTargetAtTime(4 + speed * 14, t, 0.1);
    this.filter.frequency.setTargetAtTime(300 + speed * 1600 + spike * 500, t, 0.05);
    const vol = speed > 0.02 ? 0.02 + speed * 0.06 + Math.min(spike, 2) * 0.02 : 0;
    this.gain.gain.setTargetAtTime(vol, t, 0.06);
  }
}
