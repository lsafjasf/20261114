export class SoundEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.enabled = true;
    this.ambientStarted = false;
    this.ambientNodes = [];
    this.noiseBuffer = null;
  }

  init() {
    if (this.context) {
      if (this.context.state === "suspended") this.context.resume();
      return;
    }

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      this.enabled = false;
      return;
    }

    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = this.enabled ? 0.62 : 0;
    this.master.connect(this.context.destination);
    this.noiseBuffer = this.createNoiseBuffer(2);
    this.startAmbient();
  }

  createNoiseBuffer(seconds) {
    const length = Math.ceil(this.context.sampleRate * seconds);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.72 + white * 0.28;
      data[index] = last;
    }
    return buffer;
  }

  startAmbient() {
    if (!this.context || this.ambientStarted) return;
    this.ambientStarted = true;
    const ambient = this.context.createGain();
    ambient.gain.value = 0.012;
    ambient.connect(this.master);

    const hum = this.context.createOscillator();
    hum.type = "sine";
    hum.frequency.value = 43;
    const humGain = this.context.createGain();
    humGain.gain.value = 0.7;
    hum.connect(humGain).connect(ambient);
    hum.start();

    const harmonic = this.context.createOscillator();
    harmonic.type = "triangle";
    harmonic.frequency.value = 86.5;
    const harmonicGain = this.context.createGain();
    harmonicGain.gain.value = 0.22;
    harmonic.connect(harmonicGain).connect(ambient);
    harmonic.start();

    const air = this.context.createBufferSource();
    air.buffer = this.noiseBuffer;
    air.loop = true;
    const airFilter = this.context.createBiquadFilter();
    airFilter.type = "bandpass";
    airFilter.frequency.value = 420;
    airFilter.Q.value = 0.5;
    const airGain = this.context.createGain();
    airGain.gain.value = 0.1;
    air.connect(airFilter).connect(airGain).connect(ambient);
    air.start();

    this.ambientNodes.push(ambient, hum, harmonic, air);
  }

  toggle() {
    this.init();
    this.enabled = !this.enabled;
    if (this.master && this.context) {
      const target = this.enabled ? 0.62 : 0;
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setTargetAtTime(target, this.context.currentTime, 0.08);
      if (this.enabled) this.context.resume();
    }
    return this.enabled;
  }

  ensure() {
    this.init();
    if (this.context?.state === "suspended") this.context.resume();
  }

  tone(frequency, duration, options = {}) {
    if (!this.context || !this.master || !this.enabled) return;
    const {
      delay = 0,
      gain = 0.1,
      type = "sine",
      endFrequency = null,
      destination = this.master,
    } = options;
    const start = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (endFrequency !== null) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
    }
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(gain, start + Math.min(0.018, duration * 0.2));
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope).connect(destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  noise(duration, options = {}) {
    if (!this.context || !this.master || !this.enabled || !this.noiseBuffer) return;
    const { delay = 0, gain = 0.08, frequency = 600, type = "bandpass", q = 0.7 } = options;
    const start = this.context.currentTime + delay;
    const source = this.context.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const envelope = this.context.createGain();
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(gain, start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(envelope).connect(this.master);
    source.start(start);
    source.stop(start + duration + 0.01);
  }

  select() {
    this.tone(520, 0.045, { gain: 0.035, type: "triangle" });
  }

  rotate() {
    this.noise(0.055, { gain: 0.055, frequency: 1600, q: 1.8 });
    this.tone(370, 0.065, { gain: 0.045, type: "triangle", endFrequency: 440 });
  }

  place() {
    this.noise(0.16, { gain: 0.13, frequency: 720, q: 0.8 });
    this.tone(92, 0.2, { gain: 0.16, type: "sine", endFrequency: 58 });
    this.tone(760, 0.09, { gain: 0.07, type: "triangle", delay: 0.04, endFrequency: 560 });
    this.tone(1180, 0.05, { gain: 0.025, type: "square", delay: 0.08 });
  }

  remove() {
    this.noise(0.12, { gain: 0.07, frequency: 1100, q: 1.2 });
    this.tone(240, 0.18, { gain: 0.07, type: "triangle", endFrequency: 90 });
  }

  fail() {
    this.noise(0.6, { gain: 0.09, frequency: 380, type: "lowpass", q: 0.4 });
    [0, 0.22, 0.44].forEach((delay, index) => {
      this.tone(index % 2 ? 152 : 188, 0.16, {
        gain: 0.12,
        type: "square",
        delay,
        endFrequency: index % 2 ? 120 : 210,
      });
    });
    this.tone(72, 0.55, { gain: 0.09, type: "sawtooth", delay: 0.05 });
  }

  checkPass() {
    [330, 494, 659, 880].forEach((frequency, index) => {
      this.tone(frequency, 0.22, {
        delay: index * 0.09,
        gain: 0.07,
        type: "triangle",
      });
    });
    this.tone(1318, 0.55, { delay: 0.38, gain: 0.035, type: "sine" });
    this.noise(0.28, { delay: 0.4, gain: 0.025, frequency: 2600 });
  }

  launch() {
    this.tone(70, 1.5, { gain: 0.16, type: "sawtooth", endFrequency: 140 });
    this.tone(110, 1.7, { delay: 0.15, gain: 0.12, type: "sine", endFrequency: 440 });
    [220, 330, 440, 660, 880].forEach((frequency, index) => {
      this.tone(frequency, 0.7, {
        delay: 0.7 + index * 0.12,
        gain: 0.055,
        type: "triangle",
      });
    });
    this.noise(1.5, { delay: 0.15, gain: 0.045, frequency: 900, type: "lowpass" });
  }
}
