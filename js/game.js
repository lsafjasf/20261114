(function () {
  "use strict";

  const Renderer = window.WindRenderer;
  const LAYERS = Renderer.LAYERS;
  const TARGETS = Renderer.TARGETS;
  const GROUND_ALTITUDE = Renderer.GROUND_ALTITUDE;

  const SAMPLE_DURATION = 3;
  const SAFE_DAMAGE = 30;
  const MIN_X = 254;
  const MAX_X = 1186;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function damp(current, target, speed, delta) {
    return current + (target - current) * (1 - Math.exp(-speed * delta));
  }

  class WindKiteGame {
    constructor(options = {}) {
      this.onEvent = options.onEvent || function () {};
      this.reset();
    }

    reset() {
      this.phase = "ready";
      this.elapsed = 0;
      this.x = 800;
      this.previousX = this.x;
      this.altitude = GROUND_ALTITUDE;
      this.lineLength = 4;
      this.tension = 52;
      this.damage = 0;
      this.peakDamage = 0;
      this.samples = [false, false, false];
      this.sampleProgress = [0, 0, 0];
      this.readings = [null, null, null];
      this.activeSample = -1;
      this.sampleValue = 0;
      this.layer = 0;
      this.windSpeed = LAYERS[0].wind;
      this.kiteAngle = 0;
      this.xVelocity = 0;
      this.landTimer = 0;
      this.slackTime = 0;
      this.strainTime = 0;
      this.endPayload = null;
    }

    start() {
      this.reset();
      this.phase = "playing";
      this.onEvent({ type: "start" });
    }

    update(delta, input) {
      const dt = Math.min(delta, 0.05);

      if (this.phase === "landed") {
        this.landTimer += dt;
        this.tension = damp(this.tension, 53, 1.8, dt);
        if (this.landTimer >= 1.05) {
          this.finish();
        }
        this.syncVisualState();
        return;
      }

      if (this.phase !== "playing") {
        this.syncVisualState();
        return;
      }

      this.elapsed += dt;
      this.layer = this.altitude < 34 ? 0 : this.altitude < 68 ? 1 : 2;
      const layer = LAYERS[this.layer];
      const gust = Math.sin(this.elapsed * 1.07) * 0.52 + Math.sin(this.elapsed * 2.63) * 0.22;
      this.windSpeed = layer.wind + gust;

      const payout = input.has("KeyW") ? 1 : 0;
      const reel = input.has("KeyS") ? 1 : 0;
      const left = input.has("KeyA") ? 1 : 0;
      const right = input.has("KeyD") ? 1 : 0;
      const lineIntent = payout - reel;
      const lateralIntent = right - left;

      const authority = this.tension < 26 ? 0.34 : this.tension < 32 ? 0.68 : 1;
      this.previousX = this.x;

      this.lineLength = clamp(this.lineLength + lineIntent * 16 * dt, 0, 100);

      const riseSpeed = this.tension < 26 ? 0.82 : this.tension > 90 ? 1.05 : 1.32;
      this.altitude += (this.lineLength - this.altitude) * riseSpeed * dt;

      if (this.tension < 24 && this.altitude > 3) {
        this.altitude -= (24 - this.tension) * 0.075 * dt;
      }
      this.altitude = clamp(this.altitude, 0, 100);

      const windPush = layer.direction * (this.windSpeed * 0.92 + 1.6);
      this.x += (lateralIntent * 142 * authority + windPush) * dt;
      this.x = clamp(this.x, MIN_X, MAX_X);
      this.xVelocity = (this.x - this.previousX) / Math.max(dt, 0.001);

      this.layer = this.altitude < 34 ? 0 : this.altitude < 68 ? 1 : 2;
      const currentLayer = LAYERS[this.layer];
      const gap = this.altitude - this.lineLength;
      const baseTension = 56 + this.altitude * 0.055 + (this.layer === 2 ? 2.2 : 0);
      const spoolEffect = payout ? -21 : reel ? 15 : 0;
      const gapFactor = lineIntent > 0 ? 1.55 : 0.9;
      const targetTension = clamp(
        baseTension + spoolEffect + gap * gapFactor + Math.abs(lateralIntent) * 1.8 + gust * 1.4,
        4,
        100
      );
      this.tension = damp(this.tension, targetTension, 2.15, dt);

      const targetAngle = lateralIntent * 0.13
        + currentLayer.direction * 0.055
        + Math.sin(this.elapsed * 2.1) * (this.tension < 24 ? 0.09 : 0.025);
      this.kiteAngle = damp(this.kiteAngle, targetAngle, 4.2, dt);

      this.slackTime = this.tension < 26 ? this.slackTime + dt : Math.max(0, this.slackTime - dt * 1.8);
      this.strainTime = this.tension > 78 ? this.strainTime + dt : Math.max(0, this.strainTime - dt * 1.8);

      if (this.tension > 78) {
        const overload = (this.tension - 78) / 22;
        this.damage = Math.min(100, this.damage + overload * 30 * dt);
        this.peakDamage = Math.max(this.peakDamage, this.damage);
      }

      this.updateSampling(dt);

      if (this.damage >= 100) {
        this.phase = "failed";
        this.onEvent({ type: "break" });
        return;
      }

      if (this.altitude <= 0.55 && this.lineLength <= 1) {
        this.beginLanding();
      }

      this.syncVisualState();
    }

    updateSampling(dt) {
      let insideIndex = -1;

      for (let index = 0; index < TARGETS.length; index += 1) {
        if (this.samples[index]) {
          continue;
        }
        const target = TARGETS[index];
        const dx = (this.x - target.x) / 77;
        const dy = (this.altitude - target.altitude) / 8.85;
        if (dx * dx + dy * dy <= 1) {
          insideIndex = index;
          break;
        }
      }

      this.activeSample = insideIndex;
      if (insideIndex >= 0) {
        this.sampleProgress[insideIndex] += dt / SAMPLE_DURATION;
        if (this.sampleProgress[insideIndex] >= 1) {
          this.completeSample(insideIndex);
        }
      }

      for (let index = 0; index < this.sampleProgress.length; index += 1) {
        if (index !== insideIndex && !this.samples[index] && this.sampleProgress[index] > 0) {
          this.sampleProgress[index] = Math.max(0, this.sampleProgress[index] - dt * 0.62);
        }
      }

      this.sampleValue = insideIndex >= 0
        ? this.sampleProgress[insideIndex]
        : Math.max(...this.sampleProgress);
    }

    completeSample(index) {
      const target = TARGETS[index];
      const layer = LAYERS[index];
      this.samples[index] = true;
      this.sampleProgress[index] = 0;
      this.sampleProgress[this.activeSample] = 0;
      this.activeSample = -1;
      this.sampleValue = 0;
      this.readings[index] = {
        altitude: target.altitude,
        windSpeed: layer.wind,
        direction: layer.direction > 0 ? "W→E" : "E→W"
      };
      this.onEvent({ type: "sample", index, reading: this.readings[index] });
    }

    beginLanding() {
      this.phase = "landed";
      this.landTimer = 0;
      this.activeSample = -1;
      this.sampleValue = 0;
      this.xVelocity = 0;
      this.tension = Math.max(this.tension, 32);
      this.onEvent({ type: "touchdown" });
    }

    finish() {
      const sampleCount = this.samples.filter(Boolean).length;
      const allSampled = sampleCount === TARGETS.length;
      const safe = allSampled && this.peakDamage <= SAFE_DAMAGE;
      this.phase = "finished";
      this.endPayload = {
        success: safe,
        allSampled,
        sampleCount,
        damage: this.peakDamage,
        tension: this.tension,
        elapsed: this.elapsed,
        readings: this.readings.slice()
      };
      this.onEvent({ type: "finish", result: this.endPayload });
    }

    syncVisualState() {
      this.layer = this.altitude < 34 ? 0 : this.altitude < 68 ? 1 : 2;
      if (this.activeSample < 0) {
        this.sampleValue = Math.max(...this.sampleProgress);
      } else {
        this.sampleValue = this.sampleProgress[this.activeSample];
      }
    }

    getSnapshot() {
      return {
        phase: this.phase,
        elapsed: this.elapsed,
        x: this.x,
        altitude: this.altitude,
        lineLength: this.lineLength,
        tension: this.tension,
        damage: this.peakDamage,
        samples: this.samples.slice(),
        sampleProgress: this.activeSample >= 0 ? this.sampleProgress[this.activeSample] : 0,
        activeSample: this.activeSample,
        sampleValue: this.sampleValue,
        layer: this.layer,
        windSpeed: this.windSpeed,
        kiteAngle: this.kiteAngle,
        xVelocity: this.xVelocity,
        slackTime: this.slackTime,
        strainTime: this.strainTime,
        landTimer: this.landTimer
      };
    }
  }

  WindKiteGame.SAMPLE_DURATION = SAMPLE_DURATION;
  WindKiteGame.SAFE_DAMAGE = SAFE_DAMAGE;
  window.WindKiteGame = WindKiteGame;
})();
