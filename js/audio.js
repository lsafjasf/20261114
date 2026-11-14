(function () {
  "use strict";

  class BakeryAudio {
    constructor() {
      this.context = null;
      this.master = null;
      this.ambientGain = null;
      this.ambientFilter = null;
      this.hum = null;
      this.ovenGain = null;
      this.muted = false;
      this.unlocked = false;
    }

    async unlock() {
      if (!this.context) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return false;
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = this.muted ? 0 : 0.36;
        this.master.connect(this.context.destination);
        this.createAmbience();
      }

      if (this.context.state === "suspended") {
        try {
          await this.context.resume();
        } catch (error) {
          return false;
        }
      }

      this.unlocked = this.context.state === "running";
      return this.unlocked;
    }

    createAmbience() {
      const ctx = this.context;
      const noiseLength = ctx.sampleRate * 3;
      const buffer = ctx.createBuffer(1, noiseLength, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;

      for (let index = 0; index < data.length; index += 1) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.018 * white) / 1.018;
        data[index] = last * 3.15;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;

      this.ambientFilter = ctx.createBiquadFilter();
      this.ambientFilter.type = "lowpass";
      this.ambientFilter.frequency.value = 420;
      this.ambientFilter.Q.value = 0.25;

      this.ambientGain = ctx.createGain();
      this.ambientGain.gain.value = 0.035;

      noise.connect(this.ambientFilter);
      this.ambientFilter.connect(this.ambientGain);
      this.ambientGain.connect(this.master);
      noise.start();

      this.hum = ctx.createOscillator();
      const humGain = ctx.createGain();
      this.hum.type = "sine";
      this.hum.frequency.value = 56;
      humGain.gain.value = 0.008;
      this.hum.connect(humGain);
      humGain.connect(this.master);
      this.hum.start();

      this.ovenGain = ctx.createGain();
      this.ovenGain.gain.value = 0;
      this.ovenGain.connect(this.master);

      const ovenNoise = ctx.createBufferSource();
      ovenNoise.buffer = buffer;
      ovenNoise.loop = true;
      ovenNoise.playbackRate.value = 0.62;
      const ovenFilter = ctx.createBiquadFilter();
      ovenFilter.type = "bandpass";
      ovenFilter.frequency.value = 160;
      ovenFilter.Q.value = 0.55;
      ovenNoise.connect(ovenFilter);
      ovenFilter.connect(this.ovenGain);
      ovenNoise.start();

      const ovenHum = ctx.createOscillator();
      const ovenHumGain = ctx.createGain();
      ovenHum.type = "triangle";
      ovenHum.frequency.value = 43;
      ovenHumGain.gain.value = 0.04;
      ovenHum.connect(ovenHumGain);
      ovenHumGain.connect(this.ovenGain);
      ovenHum.start();
    }

    setMuted(muted) {
      this.muted = muted;
      if (!this.context || !this.master) return;
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setTargetAtTime(muted ? 0 : 0.36, this.context.currentTime, 0.03);
    }

    setClimate(temp, humidity) {
      if (!this.context || !this.ambientFilter) return;
      const now = this.context.currentTime;
      const tempNorm = Math.max(0, Math.min(1, (temp - 18) / 18));
      const humidityNorm = Math.max(0, Math.min(1, (humidity - 55) / 40));
      this.ambientFilter.frequency.setTargetAtTime(300 + tempNorm * 360, now, 0.5);
      this.ambientGain.gain.setTargetAtTime(0.025 + humidityNorm * 0.018, now, 0.5);
      if (this.hum) {
        this.hum.frequency.setTargetAtTime(52 + tempNorm * 9, now, 0.7);
      }
    }

    tone(frequency, duration, options) {
      if (!this.context || !this.unlocked || this.muted) return;
      const settings = Object.assign({
        type: "sine",
        gain: 0.05,
        delay: 0,
        endFrequency: null,
      }, options);
      const ctx = this.context;
      const start = ctx.currentTime + settings.delay;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = settings.type;
      oscillator.frequency.setValueAtTime(frequency, start);
      if (settings.endFrequency) {
        oscillator.frequency.exponentialRampToValueAtTime(settings.endFrequency, start + duration);
      }
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(settings.gain, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(this.master);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.03);
    }

    uiClick() {
      this.tone(690, 0.045, { type: "triangle", gain: 0.022, endFrequency: 520 });
    }

    tick(isDownbeat) {
      if (!this.unlocked) return;
      const now = this.context.currentTime;
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = isDownbeat ? 392 : 294;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(isDownbeat ? 0.019 : 0.009, now + 0.009);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
      oscillator.connect(gain);
      gain.connect(this.master);
      oscillator.start(now);
      oscillator.stop(now + 0.16);
    }

    readyChime() {
      this.tone(523.25, 0.42, { type: "sine", gain: 0.045 });
      this.tone(659.25, 0.46, { type: "sine", gain: 0.032, delay: 0.1 });
    }

    ovenStart() {
      if (!this.context || !this.ovenGain) return;
      this.ovenGain.gain.setTargetAtTime(0.055, this.context.currentTime, 0.45);
      this.tone(98, 0.55, { type: "triangle", gain: 0.042, endFrequency: 72 });
    }

    ovenDone() {
      if (!this.context || !this.ovenGain) return;
      this.ovenGain.gain.setTargetAtTime(0, this.context.currentTime, 0.25);
      this.tone(783.99, 0.34, { type: "sine", gain: 0.04 });
      this.tone(1046.5, 0.5, { type: "sine", gain: 0.03, delay: 0.09 });
    }

    stopOven() {
      if (!this.context || !this.ovenGain) return;
      this.ovenGain.gain.cancelScheduledValues(this.context.currentTime);
      this.ovenGain.gain.setTargetAtTime(0, this.context.currentTime, 0.08);
    }

    success() {
      if (!this.context || !this.ovenGain) return;
      this.ovenGain.gain.setTargetAtTime(0, this.context.currentTime, 0.5);
      [261.63, 329.63, 392, 523.25, 659.25].forEach((note, index) => {
        this.tone(note, 0.75, {
          type: index < 2 ? "triangle" : "sine",
          gain: 0.045 - index * 0.003,
          delay: index * 0.12,
        });
      });
    }

    failure() {
      if (!this.context || !this.ovenGain) return;
      this.ovenGain.gain.setTargetAtTime(0, this.context.currentTime, 0.3);
      this.tone(220, 0.65, { type: "triangle", gain: 0.052, endFrequency: 128 });
      this.tone(174.61, 0.9, { type: "sine", gain: 0.035, delay: 0.16, endFrequency: 98 });
    }
  }

  window.Bakery = window.Bakery || {};
  window.Bakery.Audio = BakeryAudio;
})();
