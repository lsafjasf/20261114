export class PumpAudio {
  constructor() {
    this.context = null;
    this.oscillator = null;
    this.gain = null;
    this.noiseGain = null;
    this.enabled = false;
  }

  async enable() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.context = new AudioContextClass();

      this.oscillator = this.context.createOscillator();
      this.gain = this.context.createGain();
      this.oscillator.type = 'sawtooth';
      this.oscillator.frequency.value = 80;
      this.gain.gain.value = 0.025;
      this.oscillator.connect(this.gain).connect(this.context.destination);
      this.oscillator.start();

      const buffer = this.context.createBuffer(1, this.context.sampleRate, this.context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < data.length; index += 1) {
        data[index] = Math.random() * 2 - 1;
      }
      const noise = this.context.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      this.noiseGain = this.context.createGain();
      this.noiseGain.gain.value = 0.008;
      noise.connect(this.noiseGain).connect(this.context.destination);
      noise.start();
    }

    await this.context.resume();
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
    if (this.gain) this.gain.gain.setTargetAtTime(0, this.context.currentTime, 0.05);
    if (this.noiseGain) this.noiseGain.gain.setTargetAtTime(0, this.context.currentTime, 0.05);
  }

  update(pressure, running) {
    if (!this.context || !this.enabled) return;
    const normalized = (pressure - 40) / 60;
    const targetGain = running ? 0.018 + normalized * 0.035 : 0.004;
    const targetNoise = running ? 0.006 + normalized * 0.026 : 0.002;
    this.oscillator.frequency.setTargetAtTime(62 + normalized * 94, this.context.currentTime, 0.08);
    this.gain.gain.setTargetAtTime(targetGain, this.context.currentTime, 0.08);
    this.noiseGain.gain.setTargetAtTime(targetNoise, this.context.currentTime, 0.08);
  }
}
