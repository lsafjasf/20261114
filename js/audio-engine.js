import {
  BEEP_DURATION,
  BEAT_INTERVAL,
  CUE_FREQS,
  CUE_TIMES,
  DURATION,
} from './constants.js';

const LOOKAHEAD = 0.12;
const TICK_MS = 25;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.output = null;
    this.playing = false;
    this.position = 0;
    this.contextStart = 0;
    this.nextBeatTime = 0;
    this.nextBeatIndex = 0;
    this.cueFlags = CUE_TIMES.map(() => false);
    this.timer = null;
    this.onEnded = null;
  }

  async ensureContext() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.output = this.ctx.createGain();
      this.output.gain.value = 0.6;
      this.output.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  getAnalyser() {
    return this.analyser;
  }

  getCurrentTime() {
    if (!this.ctx) {
      return this.position;
    }
    if (this.playing) {
      const projected = this.position + (this.ctx.currentTime - this.contextStart);
      return Math.min(DURATION, projected);
    }
    return this.position;
  }

  isPlaying() {
    return this.playing;
  }

  async play(fromPosition = this.position) {
    await this.ensureContext();
    this.position = Math.min(DURATION, Math.max(0, fromPosition));
    if (this.position >= DURATION) {
      this.position = 0;
    }
    this.contextStart = this.ctx.currentTime;
    this.playing = true;
    this.nextBeatIndex = Math.floor(this.position / BEAT_INTERVAL);
    this.nextBeatTime = this.contextStart + Math.max(
      0,
      this.nextBeatIndex * BEAT_INTERVAL - this.position
    );
    this.cueFlags = CUE_TIMES.map((time) => time < this.position - 1e-6);
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
  }

  pause() {
    if (!this.playing) {
      return;
    }
    this.position = this.getCurrentTime();
    this.playing = false;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  seek(position) {
    const wasPlaying = this.playing;
    if (wasPlaying) {
      this.pause();
    }
    this.position = Math.min(DURATION, Math.max(0, position));
    if (wasPlaying) {
      this.play(this.position);
    }
  }

  stopAll() {
    this.pause();
    this.position = 0;
  }

  schedule() {
    if (!this.playing || !this.ctx) {
      return;
    }
    const horizon = this.ctx.currentTime + LOOKAHEAD;
    while (this.nextBeatTime < horizon) {
      const eventPosition = this.position + (this.nextBeatTime - this.contextStart);
      if (eventPosition >= DURATION) {
        break;
      }
      const cueIndex = CUE_TIMES.findIndex(
        (time, index) => !this.cueFlags[index] && Math.abs(time - eventPosition) < BEAT_INTERVAL / 2
      );
      if (cueIndex >= 0) {
        this.cueFlags[cueIndex] = true;
        this.scheduleBeep(this.nextBeatTime, CUE_FREQS[cueIndex], 0.22);
      } else {
        this.scheduleBeep(this.nextBeatTime, 180, 0.045, 0.12);
      }
      this.nextBeatIndex += 1;
      this.nextBeatTime += BEAT_INTERVAL;
    }

    if (this.position + (this.ctx.currentTime - this.contextStart) >= DURATION) {
      this.pause();
      this.position = DURATION;
      if (this.onEnded) {
        this.onEnded();
      }
    }
  }

  scheduleBeep(when, frequency, duration = BEEP_DURATION, gainValue = 0.3) {
    const oscillator = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, when);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(gainValue, when + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    oscillator.connect(gain);
    gain.connect(this.output);
    oscillator.start(when);
    oscillator.stop(when + duration + 0.02);
  }
}
