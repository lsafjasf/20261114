const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class SkyAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.windGain = null;
    this.windFilter = null;
    this.whistleGain = null;
    this.whistleFilter = null;
    this.cableGain = null;
    this.cableFilter = null;
    this.cableOsc = null;
    this.cableOsc2 = null;
    this.noiseBuffer = null;
    this.muted = false;
    this.started = false;
  }

  async start() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context = new AudioContext();
      this.buildGraph();
      this.started = true;
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
  }

  buildGraph() {
    const ctx = this.context;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.58;
    this.master.connect(ctx.destination);

    this.noiseBuffer = this.makeNoiseBuffer(4);

    const windSource = ctx.createBufferSource();
    windSource.buffer = this.noiseBuffer;
    windSource.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "lowpass";
    this.windFilter.frequency.value = 320;
    this.windFilter.Q.value = 0.75;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.035;
    windSource.connect(this.windFilter).connect(this.windGain).connect(this.master);
    windSource.start();

    const whistleSource = ctx.createBufferSource();
    whistleSource.buffer = this.noiseBuffer;
    whistleSource.loop = true;
    whistleSource.playbackRate.value = 1.37;
    this.whistleFilter = ctx.createBiquadFilter();
    this.whistleFilter.type = "bandpass";
    this.whistleFilter.frequency.value = 960;
    this.whistleFilter.Q.value = 8;
    this.whistleGain = ctx.createGain();
    this.whistleGain.gain.value = 0.003;
    whistleSource.connect(this.whistleFilter).connect(this.whistleGain).connect(this.master);
    whistleSource.start();

    this.cableFilter = ctx.createBiquadFilter();
    this.cableFilter.type = "lowpass";
    this.cableFilter.frequency.value = 310;
    this.cableFilter.Q.value = 2.4;
    this.cableGain = ctx.createGain();
    this.cableGain.gain.value = 0.004;
    this.cableFilter.connect(this.cableGain).connect(this.master);

    this.cableOsc = ctx.createOscillator();
    this.cableOsc.type = "sawtooth";
    this.cableOsc.frequency.value = 62;
    this.cableOsc.connect(this.cableFilter);
    this.cableOsc.start();

    this.cableOsc2 = ctx.createOscillator();
    this.cableOsc2.type = "sine";
    this.cableOsc2.frequency.value = 124;
    const cable2Gain = ctx.createGain();
    cable2Gain.gain.value = 0.36;
    this.cableOsc2.connect(cable2Gain).connect(this.cableFilter);
    this.cableOsc2.start();

    const lfo = ctx.createOscillator();
    const lfoDepth = ctx.createGain();
    lfo.type = "sine";
    lfo.frequency.value = 0.13;
    lfoDepth.gain.value = 48;
    lfo.connect(lfoDepth).connect(this.cableFilter.frequency);
    lfo.start();
  }

  makeNoiseBuffer(seconds) {
    const ctx = this.context;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.965 + white * 0.035;
      data[index] = last * 2.8 + white * 0.11;
    }
    return buffer;
  }

  update({ windSpeed = 0, tension = 0.5, swing = 0, anchored = false, active = true }) {
    if (!this.context || this.context.state !== "running") return;
    const now = this.context.currentTime;
    const wind = clamp(windSpeed / 18, 0, 1.4);
    const motion = clamp(Math.abs(swing) / 18, 0, 1);
    const anchorDuck = anchored ? 0.52 : 1;
    const activeDuck = active ? 1 : 0.35;

    this.windGain.gain.setTargetAtTime((0.018 + wind * 0.17) * activeDuck, now, 0.18);
    this.windFilter.frequency.setTargetAtTime(180 + wind * 690 + motion * 130, now, 0.22);
    this.whistleGain.gain.setTargetAtTime((wind * wind * 0.033 + motion * 0.009) * anchorDuck, now, 0.2);
    this.whistleFilter.frequency.setTargetAtTime(710 + wind * 810 + motion * 180, now, 0.28);

    const cableFreq = 44 + tension * 79 + motion * 7;
    this.cableOsc.frequency.setTargetAtTime(cableFreq, now, 0.12);
    this.cableOsc2.frequency.setTargetAtTime(cableFreq * 2.01, now, 0.12);
    this.cableGain.gain.setTargetAtTime((0.0018 + tension * 0.0085 + motion * 0.0025) * activeDuck, now, 0.2);
    this.cableFilter.frequency.setTargetAtTime(190 + tension * 300 + motion * 80, now, 0.18);
  }

  setMuted(muted) {
    this.muted = muted;
    if (!this.master || !this.context) return;
    this.master.gain.setTargetAtTime(muted ? 0 : 0.58, this.context.currentTime, 0.04);
  }

  dockSuccess() {
    if (!this.context) return;
    const notes = [392, 523.25, 659.25, 783.99];
    notes.forEach((frequency, index) => {
      this.tone(frequency, 0.38, 0.055, index * 0.09, "sine");
    });
    this.noiseBurst(0.16, 0.028, 320, "highpass");
  }

  dockFail() {
    if (!this.context) return;
    this.tone(84, 0.24, 0.11, 0, "triangle", 48);
    this.noiseBurst(0.2, 0.5, 440, "lowpass");
  }

  win() {
    if (!this.context) return;
    const now = this.context.currentTime;
    const chord = [261.63, 329.63, 392, 523.25, 659.25];
    chord.forEach((frequency, index) => {
      this.tone(frequency, 1.9, 0.04, index * 0.045 + 0.08, "sine", frequency * 0.996);
    });
    this.tone(130.81, 1.6, 0.055, 0.12, "triangle", 128);
    if (this.windGain) this.windGain.gain.setTargetAtTime(0.006, now, 0.8);
  }

  tick() {
    this.tone(940, 0.035, 0.013, 0, "sine");
  }

  tone(frequency, duration, volume, delay = 0, type = "sine", endFrequency = frequency) {
    if (!this.context || this.muted) return;
    const ctx = this.context;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.03);
  }

  noiseBurst(duration, volume, cutoff, type = "lowpass", delay = 0) {
    if (!this.context || this.muted || !this.noiseBuffer) return;
    const ctx = this.context;
    const now = ctx.currentTime + delay;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = type;
    filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + duration + 0.02);
  }
}
