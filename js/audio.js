class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.noise = null;
  }

  ensure() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return false;
      this.ctx = new AudioCtx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.3;
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 18;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.18;
      this.master.connect(compressor);
      compressor.connect(this.ctx.destination);
      this.noise = this.makeNoise(2);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return true;
  }

  makeNoise(seconds) {
    const length = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.36 + white * 0.64;
      data[i] = last;
    }
    return buffer;
  }

  canPlay() {
    return this.enabled && this.ensure();
  }

  paper(duration = 0.42, gain = 0.11, pan = 0) {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.72 + Math.random() * 0.22;
    const band = this.ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 1450 + Math.random() * 900;
    band.Q.value = 0.72;
    const high = this.ctx.createBiquadFilter();
    high.type = "highpass";
    high.frequency.value = 520;
    const amp = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.025);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(band);
    band.connect(high);
    high.connect(amp);
    amp.connect(panner);
    panner.connect(this.master);
    src.start(t, Math.random() * 0.5, duration + 0.05);
    src.stop(t + duration + 0.08);
  }

  wood(pitch = 190, gain = 0.22, delay = 0, pan = 0) {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime + delay;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this.master);

    const osc = this.ctx.createOscillator();
    const body = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(pitch, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(58, pitch * 0.43), t + 0.14);
    body.gain.setValueAtTime(0.0001, t);
    body.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    body.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    osc.connect(body);
    body.connect(panner);
    osc.start(t);
    osc.stop(t + 0.35);

    const knock = this.ctx.createBufferSource();
    knock.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 880;
    filter.Q.value = 1.4;
    const click = this.ctx.createGain();
    click.gain.setValueAtTime(0.0001, t);
    click.gain.exponentialRampToValueAtTime(gain * 0.42, t + 0.002);
    click.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
    knock.connect(filter);
    filter.connect(click);
    click.connect(panner);
    knock.start(t, Math.random() * 0.9, 0.08);
  }

  creak(intensity = 1) {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 620;
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(72 + Math.random() * 22, t);
    osc.frequency.linearRampToValueAtTime(120 + intensity * 55, t + 0.2);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.018 * intensity, t + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  cue() {
    this.paper(0.55, 0.095, -0.22);
    this.wood(154, 0.16, 0.08, -0.18);
    this.wood(226, 0.1, 0.2, 0.18);
  }

  success(act = 0) {
    this.paper(0.3, 0.055, 0.2);
    const root = [196, 174, 146][act] || 196;
    this.wood(root, 0.19, 0, -0.15);
    this.wood(root * 1.25, 0.16, 0.11, 0.08);
    this.wood(root * 1.5, 0.13, 0.23, 0.2);
  }

  failure() {
    this.wood(112, 0.24, 0, -0.1);
    this.wood(89, 0.2, 0.12, 0.12);
    this.creak(1.35);
    this.paper(0.7, 0.08, 0);
  }

  curtains() {
    this.paper(0.95, 0.08, -0.35);
    this.paper(0.82, 0.07, 0.35);
    this.wood(118, 0.13, 0.45, 0);
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) {
      this.ensure();
      this.paper(0.16, 0.05, 0);
    }
    return this.enabled;
  }
}

window.SoundEngine = SoundEngine;
