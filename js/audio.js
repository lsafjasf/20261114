export class Soundscape {
  constructor() {
    this.context = null;
    this.master = null;
    this.noiseBuffer = null;
    this.muted = false;
    this.stats = { arm: 0, alarm: 0, cooling: 0, delivered: 0, win: 0 };
  }

  ensure() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!this.context) {
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = 0.58;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") this.context.resume();
    return this.context;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.58, this.context.currentTime, 0.04);
    }
  }

  tone({
    frequency,
    endFrequency = frequency,
    duration = 0.2,
    gain = 0.2,
    type = "sine",
    delay = 0,
    filterFrequency = null,
    q = 1,
  }) {
    if (this.muted || !this.ensure()) return;
    const ctx = this.context;
    const start = ctx.currentTime + 0.025 + delay;
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    const filter = filterFrequency ? ctx.createBiquadFilter() : null;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(20, endFrequency),
      start + duration,
    );
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + 0.025);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    if (filter) {
      filter.type = "bandpass";
      filter.frequency.value = filterFrequency;
      filter.Q.value = q;
      oscillator.connect(filter).connect(envelope);
    } else {
      oscillator.connect(envelope);
    }
    envelope.connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  noise({ duration = 0.3, gain = 0.12, delay = 0, lowpass = 2400, highpass = 80 }) {
    if (this.muted || !this.ensure()) return;
    const ctx = this.context;
    if (!this.noiseBuffer) {
      this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let index = 0; index < data.length; index += 1) {
        data[index] = Math.random() * 2 - 1;
      }
    }

    const start = ctx.currentTime + 0.025 + delay;
    const source = ctx.createBufferSource();
    const low = ctx.createBiquadFilter();
    const high = ctx.createBiquadFilter();
    const envelope = ctx.createGain();
    source.buffer = this.noiseBuffer;
    low.type = "lowpass";
    low.frequency.value = lowpass;
    high.type = "highpass";
    high.frequency.value = highpass;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + 0.025);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(low).connect(high).connect(envelope);
    envelope.connect(this.master);
    source.start(start);
    source.stop(start + duration + 0.01);
  }

  arm(mode = "swap") {
    this.stats.arm += 1;
    if (this.muted) return;
    const fast = mode === "swap";
    this.tone({
      frequency: fast ? 92 : 74,
      endFrequency: fast ? 158 : 110,
      duration: fast ? 1.15 : 1.7,
      gain: 0.09,
      type: "sawtooth",
      filterFrequency: 260,
      q: 3,
    });
    this.noise({ duration: fast ? 1.1 : 1.5, gain: 0.055, highpass: 900, lowpass: 3800 });
    const ratchetTimes = fast ? [0.15, 0.36, 0.57, 0.78] : [0.22, 0.52, 0.82, 1.15];
    for (const delay of ratchetTimes) {
      this.noise({ duration: 0.055, gain: 0.12, delay, highpass: 1300, lowpass: 5200 });
    }
    this.tone({
      frequency: 82,
      endFrequency: 42,
      duration: 0.2,
      gain: 0.13,
      type: "triangle",
      delay: fast ? 1.22 : 1.78,
    });
  }

  alarm() {
    this.stats.alarm += 1;
    if (this.muted) return;
    for (let index = 0; index < 7; index += 1) {
      this.tone({
        frequency: index % 2 === 0 ? 880 : 1180,
        endFrequency: index % 2 === 0 ? 720 : 1040,
        duration: 0.14,
        gain: 0.12,
        type: "square",
        delay: index * 0.21,
        filterFrequency: 1040,
        q: 1.5,
      });
    }
    this.tone({
      frequency: 240,
      endFrequency: 310,
      duration: 1.45,
      gain: 0.045,
      type: "sawtooth",
      filterFrequency: 480,
      q: 4,
    });
  }

  cooling() {
    this.stats.cooling += 1;
    if (this.muted) return;
    this.noise({ duration: 1.8, gain: 0.075, highpass: 1300, lowpass: 6000 });
    this.tone({
      frequency: 420,
      endFrequency: 190,
      duration: 1.35,
      gain: 0.035,
      type: "triangle",
      delay: 0.2,
    });
  }

  delivered() {
    this.stats.delivered += 1;
    if (this.muted) return;
    this.tone({ frequency: 420, endFrequency: 660, duration: 0.22, gain: 0.1, type: "sine" });
    this.tone({
      frequency: 660,
      endFrequency: 880,
      duration: 0.28,
      gain: 0.09,
      type: "sine",
      delay: 0.18,
    });
    this.noise({ duration: 0.2, gain: 0.03, delay: 0.1, highpass: 1200 });
  }

  arrival() {
    if (this.muted) return;
    this.tone({
      frequency: 190,
      endFrequency: 240,
      duration: 0.18,
      gain: 0.04,
      type: "triangle",
      delay: 0.1,
    });
    this.noise({ duration: 0.45, gain: 0.022, lowpass: 420, highpass: 80 });
  }

  leftQueue() {
    if (this.muted) return;
    this.tone({
      frequency: 260,
      endFrequency: 90,
      duration: 0.65,
      gain: 0.11,
      type: "sawtooth",
      filterFrequency: 380,
      q: 2,
    });
  }

  win() {
    this.stats.win += 1;
    if (this.muted) return;
    const notes = [330, 440, 554, 660, 880];
    notes.forEach((frequency, index) => {
      this.tone({
        frequency,
        endFrequency: frequency * 1.06,
        duration: 0.45,
        gain: 0.085,
        type: "sine",
        delay: index * 0.13,
      });
    });
  }

  overheat() {
    if (this.muted) return;
    this.alarm();
    this.noise({ duration: 1.2, gain: 0.18, lowpass: 1600, highpass: 120 });
  }
}
