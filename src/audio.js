(function () {
  "use strict";

  class OrbitalAudio {
    constructor() {
      this.context = null;
      this.master = null;
      this.motorGain = null;
      this.motorOsc = null;
      this.motorFilter = null;
      this.muted = false;
      this.level = 0;
    }

    start() {
      if (!this.context) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return false;
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = this.muted ? 0 : 0.7;
        this.master.connect(this.context.destination);
        this.createMotor();
      }
      if (this.context.state === "suspended") {
        this.context.resume();
      }
      return true;
    }

    createMotor() {
      const ctx = this.context;
      this.motorFilter = ctx.createBiquadFilter();
      this.motorFilter.type = "lowpass";
      this.motorFilter.frequency.value = 310;
      this.motorFilter.Q.value = 3.2;
      this.motorGain = ctx.createGain();
      this.motorGain.gain.value = 0;
      this.motorOsc = ctx.createOscillator();
      this.motorOsc.type = "sawtooth";
      this.motorOsc.frequency.value = 52;

      const overtone = ctx.createOscillator();
      overtone.type = "triangle";
      overtone.frequency.value = 104;
      const overtoneGain = ctx.createGain();
      overtoneGain.gain.value = 0.16;

      this.motorOsc.connect(this.motorFilter);
      overtone.connect(overtoneGain);
      overtoneGain.connect(this.motorFilter);
      this.motorFilter.connect(this.motorGain);
      this.motorGain.connect(this.master);
      this.motorOsc.start();
      overtone.start();
    }

    setMuted(muted) {
      this.muted = muted;
      if (this.master) {
        this.master.gain.setTargetAtTime(muted ? 0 : 0.7, this.context.currentTime, 0.03);
      }
    }

    setMotor(level, pitch) {
      if (!this.context || !this.motorGain) return;
      this.level = level;
      const now = this.context.currentTime;
      const safeLevel = Math.max(0, Math.min(1, level));
      this.motorGain.gain.setTargetAtTime(safeLevel * 0.035, now, 0.045);
      this.motorOsc.frequency.setTargetAtTime(43 + pitch * 38, now, 0.06);
      this.motorFilter.frequency.setTargetAtTime(180 + pitch * 380, now, 0.06);
    }

    makeNoise(duration) {
      const ctx = this.context;
      const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) {
        data[i] = Math.random() * 2 - 1;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      return source;
    }

    lock(strong) {
      if (!this.start()) return;
      const ctx = this.context;
      const now = ctx.currentTime;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(strong ? 0.23 : 0.15, now + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);
      gain.connect(this.master);

      const noise = this.makeNoise(0.16);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = strong ? 1280 : 2100;
      filter.Q.value = 1.2;
      noise.connect(filter);
      filter.connect(gain);
      noise.start(now);
      noise.stop(now + 0.16);

      [145, 360, 680].forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const ping = ctx.createGain();
        osc.type = index === 0 ? "square" : "sine";
        osc.frequency.setValueAtTime(freq, now);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.72, now + 0.14);
        ping.gain.setValueAtTime(index === 0 ? 0.075 : 0.045, now);
        ping.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);
        osc.connect(ping);
        ping.connect(this.master);
        osc.start(now);
        osc.stop(now + 0.18);
      });
    }

    empty() {
      if (!this.start()) return;
      const ctx = this.context;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(185, now);
      osc.frequency.exponentialRampToValueAtTime(92, now + 0.12);
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(now);
      osc.stop(now + 0.15);
    }

    collision(severity) {
      if (!this.start()) return;
      const ctx = this.context;
      const now = ctx.currentTime;
      const amount = Math.max(0.2, Math.min(1, severity));
      const noise = this.makeNoise(0.32);
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(900, now);
      filter.frequency.exponentialRampToValueAtTime(120, now + 0.28);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.2 * amount, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      noise.start(now);
      noise.stop(now + 0.34);

      const thump = ctx.createOscillator();
      const thumpGain = ctx.createGain();
      thump.type = "sine";
      thump.frequency.setValueAtTime(88, now);
      thump.frequency.exponentialRampToValueAtTime(38, now + 0.26);
      thumpGain.gain.setValueAtTime(0.22 * amount, now);
      thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      thump.connect(thumpGain);
      thumpGain.connect(this.master);
      thump.start(now);
      thump.stop(now + 0.3);
    }

    docked() {
      if (!this.start()) return;
      const ctx = this.context;
      const now = ctx.currentTime;
      [392, 523.25, 659.25, 783.99].forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + index * 0.065;
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.075, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.42);
        osc.connect(gain);
        gain.connect(this.master);
        osc.start(start);
        osc.stop(start + 0.44);
      });
    }

    success() {
      if (!this.start()) return;
      const ctx = this.context;
      const now = ctx.currentTime;
      [261.63, 329.63, 392, 523.25, 659.25].forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + 0.2 + index * 0.11;
        osc.type = "triangle";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.1, start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.8);
        osc.connect(gain);
        gain.connect(this.master);
        osc.start(start);
        osc.stop(start + 0.85);
      });
    }
  }

  window.OrbitalAudio = OrbitalAudio;
})();
