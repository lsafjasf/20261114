(function (root) {
  class Ambience {
    constructor() { this.ctx = null; }

    ensure() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain();
      this.master.gain.value = 0.0;
      this.master.connect(ctx.destination);

      // 电网低频嗡鸣：基频 + 泛音，随负载改变音高与响度
      this.humGain = ctx.createGain();
      this.humGain.gain.value = 0.05;
      this.humGain.connect(this.master);
      this.osc1 = ctx.createOscillator();
      this.osc1.type = 'sine';
      this.osc1.frequency.value = 50;
      this.osc1.connect(this.humGain);
      this.osc1.start();
      this.osc2 = ctx.createOscillator();
      this.osc2.type = 'triangle';
      this.osc2.frequency.value = 100;
      const g2 = ctx.createGain();
      g2.gain.value = 0.3;
      this.osc2.connect(g2).connect(this.humGain);
      this.osc2.start();

      // 过载告警：方波 + LFO 调制响度
      this.alarmGain = ctx.createGain();
      this.alarmGain.gain.value = 0;
      this.alarm = ctx.createOscillator();
      this.alarm.type = 'square';
      this.alarm.frequency.value = 220;
      this.lfo = ctx.createOscillator();
      this.lfo.frequency.value = 4;
      this.lfoGain = ctx.createGain();
      this.lfoGain.gain.value = 0.04;
      this.lfo.connect(this.lfoGain).connect(this.alarmGain.gain);
      this.alarm.connect(this.alarmGain).connect(this.master);
      this.alarm.start();
      this.lfo.start();
    }

    // loadRatio 0..1，overload 是否有过载线路
    update(loadRatio, overload) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const target = 0.35 + 0.5 * loadRatio;
      this.master.gain.setTargetAtTime(target, t, 0.2);
      this.osc1.frequency.setTargetAtTime(45 + 35 * loadRatio, t, 0.3);
      this.osc2.frequency.setTargetAtTime(90 + 70 * loadRatio, t, 0.3);
      this.humGain.gain.setTargetAtTime(0.03 + 0.06 * loadRatio, t, 0.2);
      this.alarmGain.gain.setTargetAtTime(overload ? 0.05 : 0, t, 0.1);
    }

    mute() {
      if (!this.ctx) return;
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    }
  }
  root.Ambience = Ambience;
})(window);
