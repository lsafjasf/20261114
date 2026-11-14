(function (root) {
  "use strict";

  class FanAudio {
    constructor() {
      this.context = null;
      this.enabled = true;
      this.started = false;
      this.nodes = null;
      this.load = 0;
    }

    unlock() {
      if (!this.enabled) return null;
      const AudioCtor = root.AudioContext || root.webkitAudioContext;
      if (!AudioCtor) return null;
      if (!this.context) this.context = new AudioCtor();
      if (this.context.state === "suspended") this.context.resume();
      if (!this.started) this.build();
      return this.context;
    }

    build() {
      const ctx = this.context;
      const seconds = 2;
      const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i += 1) {
        const white = Math.random() * 2 - 1;
        last = last * 0.72 + white * 0.28;
        data[i] = last;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      const airFilter = ctx.createBiquadFilter();
      airFilter.type = "bandpass";
      airFilter.Q.value = 0.7;
      const airGain = ctx.createGain();
      airGain.gain.value = 0;

      const motor = ctx.createOscillator();
      motor.type = "triangle";
      motor.frequency.value = 45;
      const motorFilter = ctx.createBiquadFilter();
      motorFilter.type = "lowpass";
      motorFilter.frequency.value = 180;
      const motorGain = ctx.createGain();
      motorGain.gain.value = 0;

      const master = ctx.createGain();
      master.gain.value = this.enabled ? 0.72 : 0;

      noise.connect(airFilter).connect(airGain).connect(master);
      motor.connect(motorFilter).connect(motorGain).connect(master);
      master.connect(ctx.destination);
      noise.start();
      motor.start();
      this.nodes = { noise, airFilter, airGain, motor, motorFilter, motorGain, master };
      this.started = true;
      this.apply(0);
    }

    apply(load) {
      if (!this.nodes || !this.context) return;
      const now = this.context.currentTime;
      const level = Math.max(0, Math.min(1, load));
      this.nodes.airGain.gain.setTargetAtTime(level > 0.015 ? 0.012 + level * 0.115 : 0, now, 0.12);
      this.nodes.airFilter.frequency.setTargetAtTime(420 + level * 1500, now, 0.15);
      this.nodes.motorGain.gain.setTargetAtTime(level > 0.015 ? 0.018 + level * 0.06 : 0, now, 0.2);
      this.nodes.motor.frequency.setTargetAtTime(41 + level * 38, now, 0.25);
      this.nodes.motorFilter.frequency.setTargetAtTime(130 + level * 300, now, 0.3);
    }

    update(load) {
      this.load = load;
      if (!this.context || !this.enabled) return;
      this.apply(load);
    }

    setEnabled(enabled) {
      this.enabled = enabled;
      if (enabled) this.unlock();
      if (!this.nodes || !this.context) return;
      this.nodes.master.gain.setTargetAtTime(enabled ? 0.72 : 0, this.context.currentTime, 0.08);
      if (enabled) this.apply(this.load);
    }

    cue(type) {
      if (!this.enabled) return;
      const ctx = this.unlock();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      osc.type = type === "alert" ? "square" : "sine";
      osc.frequency.setValueAtTime(type === "alert" ? 176 : 392, now);
      osc.frequency.exponentialRampToValueAtTime(type === "alert" ? 132 : 523, now + 0.18);
      filter.type = "lowpass";
      filter.frequency.value = type === "alert" ? 680 : 1600;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(type === "alert" ? 0.055 : 0.035, now + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
      osc.connect(filter).connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.36);
    }
  }

  root.FanAudio = FanAudio;
})(typeof globalThis !== "undefined" ? globalThis : this);
