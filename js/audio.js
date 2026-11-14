(function (root) {
  "use strict";

  class Soundscape {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.engineGain = null;
      this.engineFilter = null;
      this.engineOsc = null;
      this.engineSub = null;
      this.clatterGain = null;
      this.ambientGain = null;
      this.noiseBuffer = null;
      this.muted = false;
      this.ready = false;
      this.lastUpdate = 0;
    }

    async enable() {
      if (!this.ctx) this.build();
      if (this.ctx && this.ctx.state === "suspended") {
        try {
          await this.ctx.resume();
        } catch (error) {
          return false;
        }
      }
      return Boolean(this.ctx);
    }

    build() {
      const AudioContextClass = root.AudioContext || root.webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.78;
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -16;
      compressor.knee.value = 18;
      compressor.ratio.value = 5;
      compressor.attack.value = 0.005;
      compressor.release.value = 0.28;
      this.master.connect(compressor);
      compressor.connect(ctx.destination);

      this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      let last = 0;
      for (let index = 0; index < data.length; index += 1) {
        const white = Math.random() * 2 - 1;
        last = last * 0.82 + white * 0.18;
        data[index] = last;
      }

      this.ambientGain = ctx.createGain();
      this.ambientGain.gain.value = 0.018;
      const windFilter = ctx.createBiquadFilter();
      windFilter.type = "lowpass";
      windFilter.frequency.value = 420;
      windFilter.Q.value = 0.7;
      const wind = ctx.createBufferSource();
      wind.buffer = this.noiseBuffer;
      wind.loop = true;
      wind.playbackRate.value = 0.63;
      wind.connect(windFilter);
      windFilter.connect(this.ambientGain);
      this.ambientGain.connect(this.master);
      wind.start();

      this.engineFilter = ctx.createBiquadFilter();
      this.engineFilter.type = "lowpass";
      this.engineFilter.frequency.value = 260;
      this.engineFilter.Q.value = 2.6;
      this.engineGain = ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineOsc = ctx.createOscillator();
      this.engineOsc.type = "sawtooth";
      this.engineOsc.frequency.value = 44;
      this.engineSub = ctx.createOscillator();
      this.engineSub.type = "triangle";
      this.engineSub.frequency.value = 88;
      const subGain = ctx.createGain();
      subGain.gain.value = 0.36;
      this.engineOsc.connect(this.engineFilter);
      this.engineSub.connect(subGain);
      subGain.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.master);
      this.engineOsc.start();
      this.engineSub.start();

      this.clatterGain = ctx.createGain();
      this.clatterGain.gain.value = 0;
      const clatterFilter = ctx.createBiquadFilter();
      clatterFilter.type = "bandpass";
      clatterFilter.frequency.value = 1450;
      clatterFilter.Q.value = 1.1;
      const clatter = ctx.createBufferSource();
      clatter.buffer = this.noiseBuffer;
      clatter.loop = true;
      clatter.playbackRate.value = 1.6;
      clatter.connect(clatterFilter);
      clatterFilter.connect(this.clatterGain);
      this.clatterGain.connect(this.master);
      clatter.start();
      this.ready = true;
    }

    updateMotor(speed = 0, load = 0, active = true) {
      if (!this.ready || !this.ctx) return;
      const now = this.ctx.currentTime;
      const normalized = Math.max(0, Math.min(1, Math.abs(speed) / 255));
      const target = active ? 0.026 + normalized * 0.045 : 0;
      const frequency = 42 + normalized * 57 + load * 2.2;
      this.engineGain.gain.setTargetAtTime(target, now, 0.08);
      this.engineOsc.frequency.setTargetAtTime(frequency, now, 0.08);
      this.engineSub.frequency.setTargetAtTime(frequency * 2.03, now, 0.08);
      this.engineFilter.frequency.setTargetAtTime(180 + normalized * 640, now, 0.12);
      this.clatterGain.gain.setTargetAtTime(active ? normalized * 0.016 : 0, now, 0.1);
      this.lastUpdate = now;
    }

    noiseBurst({ duration = 0.2, frequency = 1800, q = 0.8, gain = 0.12, playbackRate = 1 }) {
      if (!this.ready) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const source = ctx.createBufferSource();
      source.buffer = this.noiseBuffer;
      source.playbackRate.value = playbackRate;
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = frequency;
      filter.Q.value = q;
      const envelope = ctx.createGain();
      envelope.gain.setValueAtTime(0.0001, now);
      envelope.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), now + 0.008);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      source.connect(filter);
      filter.connect(envelope);
      envelope.connect(this.master);
      source.start(now);
      source.stop(now + duration + 0.03);
    }

    tone(frequency, duration, type = "sine", gain = 0.04, slide = 0) {
      if (!this.ready) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const oscillator = ctx.createOscillator();
      const envelope = ctx.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, now);
      if (slide) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, frequency + slide), now + duration);
      envelope.gain.setValueAtTime(0.0001, now);
      envelope.gain.exponentialRampToValueAtTime(gain, now + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(envelope);
      envelope.connect(this.master);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.02);
    }

    crack(intensity = 0.5) {
      if (!this.ready) return;
      const strength = Math.max(0.2, Math.min(1, intensity));
      this.noiseBurst({
        duration: 0.1 + strength * 0.2,
        frequency: 900 + Math.random() * 2500,
        q: 0.72 + Math.random() * 1.2,
        gain: 0.06 + strength * 0.13,
        playbackRate: 0.85 + Math.random() * 0.5,
      });
      this.noiseBurst({
        duration: 0.04 + strength * 0.05,
        frequency: 3500 + Math.random() * 1800,
        q: 0.9,
        gain: 0.02 + strength * 0.045,
        playbackRate: 1.2,
      });
      this.tone(96 - strength * 25, 0.15 + strength * 0.11, "triangle", 0.018 + strength * 0.024, -38);
    }

    sample() {
      this.tone(240, 0.12, "square", 0.025, 90);
      setTimeout(() => this.tone(440, 0.18, "triangle", 0.04, 220), 140);
      setTimeout(() => this.tone(660, 0.24, "sine", 0.035, 120), 320);
      this.noiseBurst({ duration: 0.42, frequency: 520, q: 0.6, gain: 0.03, playbackRate: 0.7 });
    }

    discard() {
      this.noiseBurst({ duration: 0.2, frequency: 220, q: 0.55, gain: 0.16, playbackRate: 0.42 });
      this.tone(92, 0.28, "triangle", 0.055, -42);
    }

    warn() {
      this.tone(520, 0.11, "square", 0.025, -40);
      setTimeout(() => this.tone(510, 0.14, "square", 0.025, -40), 160);
    }

    win(complete = true) {
      const notes = complete ? [392, 523, 659, 784] : [330, 392, 523];
      notes.forEach((note, index) => {
        setTimeout(() => this.tone(note, 0.45, "triangle", 0.04), index * 165);
      });
    }

    fail(reason) {
      this.tone(reason === "fell" ? 70 : 210, 0.75, "sawtooth", 0.05, -150);
      this.noiseBurst({ duration: 0.7, frequency: 280, q: 0.5, gain: 0.12, playbackRate: 0.35 });
    }

    setMuted(muted) {
      this.muted = Boolean(muted);
      if (!this.master || !this.ctx) return;
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.78, this.ctx.currentTime, 0.05);
    }

    toggle() {
      this.setMuted(!this.muted);
      return this.muted;
    }
  }

  root.IceAudio = Soundscape;
})(typeof globalThis !== "undefined" ? globalThis : this);
