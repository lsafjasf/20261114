(function () {
  "use strict";

  class WindAudio {
    constructor() {
      this.context = null;
      this.master = null;
      this.muted = false;
      this.active = true;
      this.ready = false;
    }

    async unlock() {
      if (this.context) {
        if (this.context.state === "suspended") {
          await this.context.resume();
        }
        return this.ready;
      }

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        return false;
      }

      this.context = new AudioContextClass();

      try {
        await this.context.resume();
        this.buildGraph();
        this.ready = true;
      } catch (error) {
        this.ready = false;
      }

      return this.ready;
    }

    buildGraph() {
      const context = this.context;
      this.master = context.createGain();
      this.master.gain.value = this.muted || !this.active ? 0 : 0.55;
      this.master.connect(context.destination);

      this.noiseBuffer = this.createNoiseBuffer(6);

      this.lowSource = this.makeNoiseSource();
      this.lowFilter = context.createBiquadFilter();
      this.lowFilter.type = "lowpass";
      this.lowFilter.frequency.value = 520;
      this.lowFilter.Q.value = 0.45;
      this.lowGain = context.createGain();
      this.lowGain.gain.value = 0.14;
      this.lowSource.connect(this.lowFilter).connect(this.lowGain).connect(this.master);

      this.airSource = this.makeNoiseSource();
      this.airFilter = context.createBiquadFilter();
      this.airFilter.type = "bandpass";
      this.airFilter.frequency.value = 720;
      this.airFilter.Q.value = 1.2;
      this.airGain = context.createGain();
      this.airGain.gain.value = 0.08;
      this.airSource.connect(this.airFilter).connect(this.airGain).connect(this.master);

      this.highSource = this.makeNoiseSource();
      this.highFilter = context.createBiquadFilter();
      this.highFilter.type = "highpass";
      this.highFilter.frequency.value = 2400;
      this.highGain = context.createGain();
      this.highGain.gain.value = 0.01;
      this.highSource.connect(this.highFilter).connect(this.highGain).connect(this.master);

      this.creakGain = context.createGain();
      this.creakGain.gain.value = 0;
      this.creakFilter = context.createBiquadFilter();
      this.creakFilter.type = "lowpass";
      this.creakFilter.frequency.value = 240;
      this.creakFilter.Q.value = 2;
      this.creakGain.connect(this.creakFilter).connect(this.master);

      this.creakOsc = context.createOscillator();
      this.creakOsc.type = "sawtooth";
      this.creakOsc.frequency.value = 48;
      this.creakOsc.connect(this.creakGain);
      this.creakOsc.start();

      this.lfo = context.createOscillator();
      this.lfo.type = "sine";
      this.lfo.frequency.value = 0.31;
      this.lfoGain = context.createGain();
      this.lfoGain.gain.value = 0.03;
      this.lfo.connect(this.lfoGain).connect(this.airGain.gain);
      this.lfo.start();
    }

    createNoiseBuffer(seconds) {
      const context = this.context;
      const length = Math.floor(context.sampleRate * seconds);
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      let brown = 0;

      for (let index = 0; index < length; index += 1) {
        const white = Math.random() * 2 - 1;
        brown = (brown + 0.018 * white) / 1.018;
        data[index] = brown * 2.8 + white * 0.34;
      }

      return buffer;
    }

    makeNoiseSource() {
      const source = this.context.createBufferSource();
      source.buffer = this.noiseBuffer;
      source.loop = true;
      source.loopStart = Math.random() * 2;
      source.start();
      return source;
    }

    setMuted(muted) {
      this.muted = muted;
      this.applyGain();
    }

    setActive(active) {
      this.active = active;
      this.applyGain();
    }

    applyGain() {
      if (!this.master || !this.context) {
        return;
      }

      this.master.gain.setTargetAtTime(
        this.muted || !this.active ? 0 : 0.55,
        this.context.currentTime,
        0.04
      );
    }

    update(flight) {
      if (!this.ready || this.muted) {
        return;
      }

      const now = this.context.currentTime;
      const altitude = Math.max(0, Math.min(100, flight.altitude || 0));
      const tension = Math.max(0, Math.min(100, flight.tension || 0));
      const speed = flight.windSpeed || 7;
      const layer = flight.layer || 0;
      const energy = Math.min(1, speed / 14);

      const airFrequency = 330 + altitude * 25 + layer * 180;
      const lowLevel = 0.055 + energy * 0.11 + (1 - altitude / 100) * 0.055;
      const airLevel = 0.022 + energy * 0.085 + altitude / 100 * 0.045;
      const highLevel = layer === 2 ? 0.025 + energy * 0.035 : 0.006 + altitude / 100 * 0.014;

      this.lowFilter.frequency.setTargetAtTime(400 + altitude * 8, now, 0.3);
      this.lowGain.gain.setTargetAtTime(lowLevel, now, 0.2);
      this.airFilter.frequency.setTargetAtTime(airFrequency, now, 0.25);
      this.airFilter.Q.setTargetAtTime(0.7 + energy * 1.2, now, 0.3);
      this.airGain.gain.setTargetAtTime(airLevel, now, 0.2);
      this.highFilter.frequency.setTargetAtTime(1900 + altitude * 20, now, 0.3);
      this.highGain.gain.setTargetAtTime(highLevel, now, 0.2);

      const strain = Math.max(0, tension - 78) / 22;
      this.creakGain.gain.setTargetAtTime(strain * 0.055, now, 0.12);
      this.creakOsc.frequency.setTargetAtTime(36 + tension * 0.36, now, 0.2);
    }

    chime(kind) {
      if (!this.ready || this.muted) {
        return;
      }

      const context = this.context;
      const now = context.currentTime;
      const tones = kind === "success" ? [523, 659, 784] : [330, 392];
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.16, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
      gain.connect(this.master);

      tones.forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        oscillator.connect(gain);
        const start = now + index * 0.13;
        oscillator.start(start);
        oscillator.stop(start + 0.75);
      });
    }
  }

  window.WindAudio = WindAudio;
})();
