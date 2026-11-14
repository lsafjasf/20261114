export class RiverAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.engine = null;
    this.muted = false;
    this.noiseBuffer = null;
  }

  async init() {
    if (this.context) {
      if (this.context.state === "suspended") await this.context.resume();
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    this.context = new AudioContextClass();
    this.master = this.context.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(this.context.destination);
    this.noiseBuffer = this.#makeNoiseBuffer();
    this.#startEngine();
  }

  #makeNoiseBuffer() {
    const length = this.context.sampleRate * 1.4;
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      samples[index] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  #startEngine() {
    const context = this.context;
    const low = context.createOscillator();
    const high = context.createOscillator();
    const lowGain = context.createGain();
    const highGain = context.createGain();
    const filter = context.createBiquadFilter();
    const output = context.createGain();

    low.type = "sawtooth";
    high.type = "triangle";
    low.frequency.value = 48;
    high.frequency.value = 94;
    lowGain.gain.value = 0.36;
    highGain.gain.value = 0.17;
    filter.type = "lowpass";
    filter.frequency.value = 240;
    filter.Q.value = 1.2;
    output.gain.value = 0.08;

    low.connect(lowGain).connect(filter);
    high.connect(highGain).connect(filter);
    filter.connect(output).connect(this.master);
    low.start();
    high.start();
    this.engine = { low, high, filter, output };
  }

  updateEngine(speed, load, throttle) {
    if (!this.context || !this.engine) return;
    const now = this.context.currentTime;
    const speedRatio = Math.min(1, Math.abs(speed) / 230);
    const base = 46 + speedRatio * 58 + load * 5.5 + throttle * 5;
    this.engine.low.frequency.setTargetAtTime(base, now, 0.12);
    this.engine.high.frequency.setTargetAtTime(base * 1.94, now, 0.12);
    this.engine.filter.frequency.setTargetAtTime(190 + speedRatio * 390, now, 0.15);
    this.engine.output.gain.setTargetAtTime(
      0.045 + speedRatio * 0.055 + throttle * 0.018,
      now,
      0.1,
    );
  }

  async whistle(strength = 1) {
    await this.init();
    if (!this.context || this.muted) return;
    const context = this.context;
    const now = context.currentTime;
    const output = context.createGain();
    output.gain.value = 0;
    output.connect(this.master);

    const hornFilter = context.createBiquadFilter();
    hornFilter.type = "lowpass";
    hornFilter.frequency.value = 1050;
    hornFilter.Q.value = 0.7;
    hornFilter.connect(output);

    for (const [frequency, gainValue, detune] of [
      [196, 0.5, -3],
      [286, 0.29, 2],
      [392, 0.13, -7],
    ]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.value = frequency;
      oscillator.detune.value = detune;
      gain.gain.value = gainValue;
      oscillator.connect(gain).connect(hornFilter);
      oscillator.start(now);
      oscillator.stop(now + 0.9);
    }

    const peak = 0.13 * strength;
    output.gain.setValueAtTime(0, now);
    output.gain.linearRampToValueAtTime(peak, now + 0.03);
    output.gain.setValueAtTime(peak, now + 0.34);
    output.gain.exponentialRampToValueAtTime(0.0001, now + 0.82);
  }

  hit(intensity = 1) {
    if (!this.context || this.muted) return;
    const context = this.context;
    const now = context.currentTime;
    const noise = context.createBufferSource();
    const noiseGain = context.createGain();
    const filter = context.createBiquadFilter();
    const thump = context.createOscillator();
    const thumpGain = context.createGain();

    noise.buffer = this.noiseBuffer;
    noise.playbackRate.value = 0.62;
    filter.type = "lowpass";
    filter.frequency.value = 360;
    noiseGain.gain.setValueAtTime(0.28 * intensity, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
    noise.connect(filter).connect(noiseGain).connect(this.master);
    noise.start(now);
    noise.stop(now + 0.55);

    thump.type = "sine";
    thump.frequency.setValueAtTime(92, now);
    thump.frequency.exponentialRampToValueAtTime(38, now + 0.3);
    thumpGain.gain.setValueAtTime(0.16 * intensity, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);
    thump.connect(thumpGain).connect(this.master);
    thump.start(now);
    thump.stop(now + 0.38);
  }

  dock() {
    if (!this.context || this.muted) return;
    const context = this.context;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(330, now);
    oscillator.frequency.exponentialRampToValueAtTime(510, now + 0.24);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.035, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.62);
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.context.currentTime, 0.08);
    }
  }
}
