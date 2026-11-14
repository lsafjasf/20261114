const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class LoomAudio {
  constructor() {
    this.enabled = true;
    this.context = null;
    this.master = null;
    this.ambient = null;
    this.lastSpeed = 3.1;
  }

  async wake() {
    if (!this.enabled) return;
    if (!this.context) this.createGraph();
    if (this.context?.state === "suspended") {
      await this.context.resume();
    }
  }

  createGraph() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    const context = new AudioContextClass();
    const master = context.createGain();
    master.gain.value = this.enabled ? 0.72 : 0;
    master.connect(context.destination);

    const ambient = context.createGain();
    ambient.gain.value = 0;
    ambient.connect(master);

    const low = context.createOscillator();
    low.type = "triangle";
    low.frequency.value = 98;
    const lowGain = context.createGain();
    lowGain.gain.value = 0.05;
    low.connect(lowGain).connect(ambient);

    const motor = context.createOscillator();
    motor.type = "sawtooth";
    motor.frequency.value = 196;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 260;
    filter.Q.value = 1.2;
    const motorGain = context.createGain();
    motorGain.gain.value = 0.018;
    motor.connect(filter).connect(motorGain).connect(ambient);

    const flutter = context.createOscillator();
    flutter.type = "sine";
    flutter.frequency.value = 3.4;
    const flutterGain = context.createGain();
    flutterGain.gain.value = 0.012;
    flutter.connect(flutterGain).connect(lowGain.gain);

    low.start();
    motor.start();
    flutter.start();

    this.context = context;
    this.master = master;
    this.ambient = ambient;
    this.ambientNodes = { low, lowGain, motor, motorGain, flutter, flutterGain };
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!this.master) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(enabled ? 0.72 : 0, now, 0.04);
  }

  update(speed, running) {
    if (!this.context || !this.ambientNodes) return;
    const now = this.context.currentTime;
    const safeSpeed = clamp(speed, 1.2, 5.6);
    if (Math.abs(safeSpeed - this.lastSpeed) > 0.02) {
      this.lastSpeed = safeSpeed;
      const motorFrequency = 160 + safeSpeed * 27;
      this.ambientNodes.motor.frequency.setTargetAtTime(
        motorFrequency,
        now,
        0.08,
      );
      this.ambientNodes.flutter.frequency.setTargetAtTime(
        2.1 + safeSpeed * 0.72,
        now,
        0.1,
      );
      this.ambientNodes.low.frequency.setTargetAtTime(
        82 + safeSpeed * 7,
        now,
        0.1,
      );
    }
    const level = running ? 0.12 + safeSpeed * 0.012 : 0.006;
    this.ambient.gain.setTargetAtTime(level, now, running ? 0.08 : 0.22);
  }

  ping(frequency, duration = 0.055, volume = 0.12, pan = 0) {
    if (!this.context || !this.enabled) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(80, frequency * 0.64),
      now + duration,
    );
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    panner.pan.value = clamp(pan, -1, 1);
    oscillator.connect(gain).connect(panner).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  click(direction = "right") {
    const pan = direction === "right" ? 0.36 : -0.36;
    this.ping(direction === "right" ? 540 : 470, 0.045, 0.075, pan);
    window.setTimeout(() => this.ping(210, 0.026, 0.055, pan * 0.7), 8);
  }

  defect() {
    this.ping(146, 0.11, 0.065, 0);
  }

  breakThread() {
    if (!this.context || !this.enabled) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(390, now);
    oscillator.frequency.exponentialRampToValueAtTime(42, now + 0.42);
    gain.gain.setValueAtTime(0.13, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.52);
  }

  complete() {
    const notes = [392, 523.25, 659.25];
    notes.forEach((frequency, index) => {
      window.setTimeout(
        () => this.ping(frequency, 0.32, 0.075, (index - 1) * 0.18),
        index * 120,
      );
    });
  }
}
