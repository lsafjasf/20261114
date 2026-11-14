export class EngineAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.engineOsc = null;
    this.subOsc = null;
    this.rpmLfo = null;
    this.rpmDepth = null;
    this.noiseGain = null;
    this.washGain = null;
    this.muted = false;
    this.started = false;
    this.lastWarning = -10;
  }

  buildNoiseBuffer(seconds = 2) {
    const length = Math.floor(this.context.sampleRate * seconds);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.82 + white * 0.18;
      data[index] = last;
    }
    return buffer;
  }

  async start() {
    if (this.started) {
      if (this.context?.state === "suspended") await this.context.resume();
      return true;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;
    this.context = new AudioContextClass();
    this.started = true;
    const ctx = this.context;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.42;
    this.master.connect(ctx.destination);

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.0001;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = 260;
    this.engineFilter.Q.value = 2.2;
    this.engineGain.connect(this.engineFilter);
    this.engineFilter.connect(this.master);

    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = "sawtooth";
    this.engineOsc.frequency.value = 44;
    this.engineOsc.connect(this.engineGain);

    const subGain = ctx.createGain();
    subGain.gain.value = 0.38;
    this.subOsc = ctx.createOscillator();
    this.subOsc.type = "triangle";
    this.subOsc.frequency.value = 22;
    this.subOsc.connect(subGain);
    subGain.connect(this.engineGain);

    this.rpmLfo = ctx.createOscillator();
    this.rpmLfo.type = "sine";
    this.rpmLfo.frequency.value = 4.6;
    this.rpmDepth = ctx.createGain();
    this.rpmDepth.gain.value = 2.2;
    this.rpmLfo.connect(this.rpmDepth);
    this.rpmDepth.connect(this.engineOsc.frequency);

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = this.buildNoiseBuffer();
    noiseSource.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 190;
    noiseFilter.Q.value = 0.7;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0.0001;
    noiseSource.connect(noiseFilter);
    noiseFilter.connect(this.noiseGain);
    this.noiseGain.connect(this.master);

    const washSource = ctx.createBufferSource();
    washSource.buffer = this.buildNoiseBuffer(3);
    washSource.loop = true;
    const washFilter = ctx.createBiquadFilter();
    washFilter.type = "lowpass";
    washFilter.frequency.value = 620;
    washFilter.Q.value = 0.4;
    this.washGain = ctx.createGain();
    this.washGain.gain.value = 0.016;
    washSource.connect(washFilter);
    washFilter.connect(this.washGain);
    this.washGain.connect(this.master);

    this.engineOsc.start();
    this.subOsc.start();
    this.rpmLfo.start();
    noiseSource.start();
    washSource.start();
    await ctx.resume();
    return true;
  }

  update({ throttle, speed, cargo, tide, phase }) {
    if (!this.context || !this.engineGain) return;
    const now = this.context.currentTime;
    const load = Math.abs(throttle);
    const active = phase === "running";
    const rpm = 42 + load * 53 + Math.min(speed, 260) * 0.085 + cargo * 2.4;
    const amplitude = active ? 0.018 + load * 0.11 + Math.min(speed / 1200, 0.05) : 0.0001;
    this.engineOsc.frequency.setTargetAtTime(rpm, now, 0.08);
    this.subOsc.frequency.setTargetAtTime(rpm * 0.5, now, 0.1);
    this.engineFilter.frequency.setTargetAtTime(210 + load * 360 + speed * 0.8, now, 0.1);
    this.engineGain.gain.setTargetAtTime(amplitude, now, 0.1);
    this.noiseGain.gain.setTargetAtTime(active ? 0.003 + load * 0.035 : 0.0001, now, 0.12);
    this.washGain.gain.setTargetAtTime(0.012 + tide * 0.018 + Math.min(speed / 120, 0.014), now, 0.4);
    this.rpmDepth.gain.setTargetAtTime(1.3 + load * 2.8, now, 0.15);
  }

  chime(kind = "deploy") {
    if (!this.context || this.muted) return;
    const ctx = this.context;
    const now = ctx.currentTime;
    const notes = kind === "win" ? [523.25, 659.25, 783.99] : [392, 587.33];
    notes.forEach((frequency, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02 + index * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55 + index * 0.14);
      oscillator.connect(gain);
      gain.connect(this.master);
      oscillator.start(now + index * 0.08);
      oscillator.stop(now + 0.8 + index * 0.15);
    });
  }

  warning() {
    if (!this.context || this.muted) return;
    const now = this.context.currentTime;
    if (now - this.lastWarning < 1.6) return;
    this.lastWarning = now;
    [0, 0.18].forEach((offset) => {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = "square";
      oscillator.frequency.value = 196;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.045, now + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.12);
      oscillator.connect(gain);
      gain.connect(this.master);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + 0.14);
    });
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.42, this.context.currentTime, 0.05);
    }
  }
}
