(function () {
  "use strict";

  class RescueAudio {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.wind = null;
      this.winch = null;
      this.muted = false;
      this.ready = false;
    }

    async start() {
      if (this.ready) {
        await this.ctx.resume();
        return;
      }

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      this.ctx = new AudioCtx();
      const ctx = this.ctx;
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -20;
      compressor.knee.value = 18;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.008;
      compressor.release.value = 0.22;

      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.72;
      this.master.connect(compressor);
      compressor.connect(ctx.destination);

      this.noiseBuffer = this.makeNoiseBuffer(2.5);
      this.startWind();
      this.startWinch();
      this.ready = true;
      await ctx.resume();
    }

    makeNoiseBuffer(seconds) {
      const length = Math.floor(this.ctx.sampleRate * seconds);
      const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        last = last * 0.82 + white * 0.18;
        data[i] = white * 0.58 + last * 0.42;
      }
      return buffer;
    }

    makeNoiseSource() {
      const source = this.ctx.createBufferSource();
      source.buffer = this.noiseBuffer;
      source.loop = true;
      return source;
    }

    startWind() {
      const ctx = this.ctx;
      const source = this.makeNoiseSource();
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 520;
      band.Q.value = 0.55;

      const low = ctx.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.value = 1250;
      low.Q.value = 0.3;

      const gain = ctx.createGain();
      gain.gain.value = 0.003;
      source.connect(band);
      band.connect(low);
      low.connect(gain);
      gain.connect(this.master);
      source.start();
      this.wind = { source, band, low, gain };
    }

    startWinch() {
      const ctx = this.ctx;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 380;
      filter.Q.value = 2.4;

      const motor = ctx.createOscillator();
      motor.type = "sawtooth";
      motor.frequency.value = 42;

      const harmonic = ctx.createOscillator();
      harmonic.type = "triangle";
      harmonic.frequency.value = 83;

      const harmonicGain = ctx.createGain();
      harmonicGain.gain.value = 0.33;

      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 7.2;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 9;

      motor.connect(filter);
      harmonic.connect(harmonicGain);
      harmonicGain.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      lfo.connect(lfoGain);
      lfoGain.connect(motor.frequency);
      motor.start();
      harmonic.start();
      lfo.start();

      this.winch = { gain, filter, motor, harmonic, lfo };
    }

    setWind(speed, gust) {
      if (!this.ready) return;
      const now = this.ctx.currentTime;
      const level = Math.min(0.11, 0.012 + speed * 0.0052 + (gust ? 0.045 : 0));
      this.wind.gain.gain.setTargetAtTime(level, now, 0.32);
      this.wind.band.frequency.setTargetAtTime(390 + speed * 42, now, 0.28);
      this.wind.low.frequency.setTargetAtTime(900 + speed * 120, now, 0.25);
    }

    setWinch(active, intensity = 0.5) {
      if (!this.ready) return;
      const now = this.ctx.currentTime;
      const level = active ? 0.022 + intensity * 0.025 : 0;
      this.winch.gain.gain.setTargetAtTime(level, now, active ? 0.06 : 0.16);
      this.winch.filter.frequency.setTargetAtTime(260 + intensity * 550, now, 0.08);
      this.winch.motor.frequency.setTargetAtTime(34 + intensity * 29, now, 0.1);
      this.winch.harmonic.frequency.setTargetAtTime(70 + intensity * 52, now, 0.1);
    }

    tone(freq, duration, type, volume, when = 0, endFreq = null) {
      if (!this.ready) return;
      const ctx = this.ctx;
      const t = ctx.currentTime + when;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + duration);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(volume, t + 0.009);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t);
      osc.stop(t + duration + 0.03);
    }

    noiseBurst(duration, volume, frequency, q = 1.2) {
      if (!this.ready) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const source = this.makeNoiseSource();
      source.loop = false;
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = frequency;
      filter.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(volume, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      source.start(t);
      source.stop(t + duration + 0.02);
    }

    clank() {
      if (!this.ready) return;
      this.tone(112, 0.3, "triangle", 0.12, 0, 59);
      this.tone(247, 0.12, "square", 0.035);
      this.noiseBurst(0.16, 0.16, 1450, 2.2);
      this.tone(480, 0.08, "sine", 0.03, 0.03, 390);
    }

    board() {
      if (!this.ready) return;
      this.clank();
      [523.25, 659.25, 783.99].forEach((freq, index) => {
        this.tone(freq, 0.22, "sine", 0.045, 0.08 + index * 0.075);
      });
    }

    gate() {
      if (!this.ready) return;
      this.clank();
      this.tone(880, 0.11, "sine", 0.035, 0.15);
      this.tone(1174.66, 0.18, "sine", 0.025, 0.25);
    }

    gustWarning() {
      if (!this.ready) return;
      this.tone(246.94, 0.16, "square", 0.035);
      this.tone(246.94, 0.16, "square", 0.035, 0.26);
      this.noiseBurst(0.55, 0.08, 680, 0.8);
    }

    collision() {
      if (!this.ready) return;
      this.tone(91, 0.78, "sawtooth", 0.16, 0, 31);
      this.tone(154, 0.44, "square", 0.08, 0, 48);
      this.noiseBurst(0.62, 0.32, 420, 0.75);
      this.noiseBurst(0.25, 0.18, 2100, 1.6);
    }

    complete() {
      if (!this.ready) return;
      const notes = [392, 523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, index) => {
        this.tone(freq, 0.55, "sine", 0.045, index * 0.12);
        if (index < 3) this.tone(freq / 2, 0.5, "triangle", 0.022, index * 0.12);
      });
      this.noiseBurst(0.9, 0.035, 2400, 0.6);
    }

    toggleMute() {
      this.muted = !this.muted;
      if (!this.ready) return this.muted;
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.72, this.ctx.currentTime, 0.04);
      return this.muted;
    }

    stopAll() {
      if (!this.ready) return;
      this.setWinch(false);
      this.wind.gain.gain.setTargetAtTime(0.002, this.ctx.currentTime, 0.4);
    }
  }

  window.RescueAudio = RescueAudio;
})();
