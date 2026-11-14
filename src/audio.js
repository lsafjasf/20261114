import { trainPose } from './geometry.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.rumble = {};
    this.lastJoint = { blue: 0, amber: 0 };
    this.enabled = true;
    this.ready = false;
  }

  async init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return this.ctx;
    }
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    try {
      this.ctx = new AudioCtor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.8 : 0;
      this.master.connect(this.ctx.destination);
      this.noise = this.makeNoise(2.4);
      this.buildRumble('blue', 0.017, 0.9);
      this.buildRumble('amber', 0.014, 0.6);
      this.ready = true;
      if (this.ctx.state === 'suspended') await this.ctx.resume();
    } catch (error) {
      this.ctx = null;
      this.ready = false;
    }
    return this.ctx;
  }

  makeNoise(seconds) {
    const length = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.62 + white * 0.38;
      data[i] = last;
    }
    return buffer;
  }

  buildRumble(id, level, pitch) {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380 * pitch;
    filter.Q.value = 0.8;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = 0;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(this.master);
    source.start();
    this.rumble[id] = { gain, panner, level };
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(enabled ? 0.8 : 0, this.ctx.currentTime, 0.04);
    }
    if (enabled) this.init();
  }

  update(state) {
    if (!this.ready || !this.enabled) return;
    if (!state.started) {
      for (const nodes of Object.values(this.rumble)) {
        nodes.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      }
      return;
    }
    for (const train of state.trains) {
      const nodes = this.rumble[train.id];
      if (!nodes) continue;
      const pose = trainPose(train);
      const pan = Math.max(-0.65, Math.min(0.65, (pose.x - 640) / 620));
      const moving = train.status === 'running' || train.status === 'braking';
      const target = moving ? nodes.level : 0.002;
      nodes.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.12);
      nodes.panner.pan.setTargetAtTime(pan, this.ctx.currentTime, 0.25);
      if (train.status === 'waiting' || train.done) {
        this.lastJoint[train.id] = train.p;
        continue;
      }
      const joint = Math.floor(train.p * 96);
      if (joint !== this.lastJoint[train.id] && moving) {
        this.lastJoint[train.id] = joint;
        this.clack(train, pan);
      }
      if (joint !== this.lastJoint[train.id] && !moving) this.lastJoint[train.id] = joint;
    }
  }

  clack(train, pan) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    const band = this.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = train.loop === 'outer' ? 1650 : 2050;
    band.Q.value = 1.4;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.055, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;
    source.connect(band);
    band.connect(gain);
    gain.connect(panner);
    panner.connect(this.master);
    source.start(t);
    source.stop(t + 0.09);

    const thump = this.ctx.createOscillator();
    const tg = this.ctx.createGain();
    thump.type = 'triangle';
    thump.frequency.setValueAtTime(train.loop === 'outer' ? 120 : 148, t);
    thump.frequency.exponentialRampToValueAtTime(62, t + 0.07);
    tg.gain.setValueAtTime(0.035, t);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    thump.connect(tg);
    tg.connect(panner);
    thump.start(t);
    thump.stop(t + 0.09);
  }

  switchClunk() {
    this.init().then(() => {
      if (!this.ctx || !this.enabled) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(118, t);
      osc.frequency.exponentialRampToValueAtTime(54, t + 0.13);
      gain.gain.setValueAtTime(0.11, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t);
      osc.stop(t + 0.17);

      const source = this.ctx.createBufferSource();
      source.buffer = this.noise;
      const band = this.ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 1250;
      band.Q.value = 2.1;
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(0.08, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      source.connect(band);
      band.connect(ng);
      ng.connect(this.master);
      source.start(t);
      source.stop(t + 0.08);
    });
  }

  lockBuzz() {
    this.init().then(() => {
      if (!this.ctx || !this.enabled) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 82;
      gain.gain.setValueAtTime(0.045, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t);
      osc.stop(t + 0.19);
    });
  }

  brake() {
    this.init().then(() => {
      if (!this.ctx || !this.enabled) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(1850, t);
      osc.frequency.exponentialRampToValueAtTime(720, t + 0.62);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.034, t + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.68);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t);
      osc.stop(t + 0.7);

      const source = this.ctx.createBufferSource();
      source.buffer = this.noise;
      const band = this.ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = 0.7;
      band.frequency.setValueAtTime(900, t);
      band.frequency.exponentialRampToValueAtTime(380, t + 0.55);
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(0.025, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      source.connect(band);
      band.connect(ng);
      ng.connect(this.master);
      source.start(t);
      source.stop(t + 0.62);
    });
  }

  chime() {
    this.init().then(() => {
      if (!this.ctx || !this.enabled) return;
      const t = this.ctx.currentTime;
      [660, 880].forEach((freq, index) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t + index * 0.09);
        gain.gain.exponentialRampToValueAtTime(0.045, t + index * 0.09 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + index * 0.09 + 0.23);
        osc.connect(gain);
        gain.connect(this.master);
        osc.start(t + index * 0.09);
        osc.stop(t + index * 0.09 + 0.25);
      });
    });
  }

  fanfare() {
    this.init().then(() => {
      if (!this.ctx || !this.enabled) return;
      const t = this.ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, index) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        const start = t + index * 0.115;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.055, start + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.4);
        osc.connect(gain);
        gain.connect(this.master);
        osc.start(start);
        osc.stop(start + 0.42);
      });
    });
  }

  failTone() {
    this.init().then(() => {
      if (!this.ctx || !this.enabled) return;
      const t = this.ctx.currentTime;
      [196, 147, 98].forEach((freq, index) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        const start = t + index * 0.16;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.028, start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
        osc.connect(gain);
        gain.connect(this.master);
        osc.start(start);
        osc.stop(start + 0.32);
      });
    });
  }
}
