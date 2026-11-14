export const DURATION_SECONDS = 12 * 60;
export const PASS_STORAGE_LITERS = 800;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class WaterStationSimulation {
  constructor(options = {}) {
    this.now = options.now ?? (() => Date.now());
    this.reset(options);
  }

  reset(options = {}) {
    this.elapsed = 0;
    this.turbidity = 18;
    this.storage = options.initialStorage ?? 850;
    this.minStorage = this.storage;
    this.bypass = options.bypass ?? 20;
    this.pumpPressure = options.pumpPressure ?? 65;
    this.backwashCycle = options.backwashCycle ?? 150;
    this.autoBackwash = options.autoBackwash ?? true;
    this.speed = options.speed ?? 1;
    this.eventKey = 0;
    this.events = [];
    this.lastBackwashStart = 0;
    this.backwash = null;
    this.backwashWaterUsed = 0;
    this.failureReason = null;
    this.manualBackwashArmed = false;
    this.membranes = [
      { id: 'A', fouling: 5, life: 100, flow: 0, backwashing: false, clogged: false },
      { id: 'B', fouling: 4, life: 100, flow: 0, backwashing: false, clogged: false }
    ];
    this.history = [{
      t: 0,
      turbidity: this.turbidity,
      pressure: this.pumpPressure,
      storage: this.storage,
      minStorage: this.minStorage,
      foulingA: 5,
      foulingB: 4
    }];
    return this.snapshot();
  }

  setControl(name, value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    if (name === 'bypass') this.bypass = clamp(numeric, 0, 100);
    if (name === 'pumpPressure') this.pumpPressure = clamp(numeric, 40, 100);
    if (name === 'backwashCycle') this.backwashCycle = clamp(numeric, 60, 360);
    if (name === 'autoBackwash') this.autoBackwash = Boolean(value);
    if (name === 'speed') this.speed = clamp(numeric, 1, 10);
  }

  requestBackwash() {
    if (!this.backwash && !this.failureReason) {
      const due = this.autoBackwash &&
        this.elapsed - this.lastBackwashStart >= this.backwashCycle;
      if (!due) this.manualBackwashArmed = true;
    }
  }

  get finished() {
    return this.elapsed >= DURATION_SECONDS || Boolean(this.failureReason);
  }

  get passed() {
    return this.elapsed >= DURATION_SECONDS &&
      !this.failureReason &&
      this.minStorage >= PASS_STORAGE_LITERS;
  }

  updateTurbidity(dt) {
    const t = this.elapsed;
    const wave =
      18 +
      10 * Math.sin(t / 27) +
      7 * Math.sin(t / 61 + 1.4) +
      3 * Math.sin(t / 11 + 0.8);
    let spike = 0;
    for (const event of this.events) {
      const age = t - event.start;
      if (age >= 0 && age < event.duration) {
        spike += event.strength * Math.exp(-age / 18);
      }
    }
    const next = clamp(wave + spike, 4, 90);
    this.turbidity += (next - this.turbidity) * Math.min(1, dt / 4);
  }

  scheduleTurbidityEvent(strength = 42, duration = 45) {
    this.events.push({
      key: ++this.eventKey,
      start: this.elapsed + 1,
      duration,
      strength
    });
  }

  startBackwash() {
    const target = this.membranes
      .filter((membrane) => !membrane.clogged && !membrane.backwashing)
      .sort((a, b) => b.fouling - a.fouling)[0];
    if (!target) return;
    target.backwashing = true;
    this.backwash = {
      membraneId: target.id,
      remaining: 6,
      water: 0
    };
    this.lastBackwashStart = this.elapsed;
    this.manualBackwashArmed = false;
  }

  updateBackwash(dt) {
    if (!this.backwash) {
      const due = this.autoBackwash &&
        this.elapsed - this.lastBackwashStart >= this.backwashCycle;
      if ((due || this.manualBackwashArmed) && !this.failureReason) {
        this.startBackwash();
      }
      return;
    }
    const membrane = this.membranes.find((item) => item.id === this.backwash.membraneId);
    const stepSeconds = Math.min(dt, this.backwash.remaining);
    this.backwash.remaining -= stepSeconds;
    this.backwash.water += 9 * stepSeconds;
    this.backwashWaterUsed += 9 * stepSeconds;
    this.storage = Math.max(0, this.storage - 9 * stepSeconds);
    if (this.backwash.remaining <= 0) {
      if (membrane) {
        membrane.fouling = Math.max(0, membrane.fouling * 0.28);
        membrane.backwashing = false;
      }
      this.backwash = null;
    }
  }

  updateMembranes(dt) {
    const bypassFactor = 0.45 + (this.bypass / 100) * 0.85;
    const inletLoad = this.turbidity * bypassFactor;
    const pressureFactor = 0.75 + this.pumpPressure / 100;
    let totalFlow = 0;

    for (const membrane of this.membranes) {
      if (membrane.backwashing) {
        membrane.flow = 0;
        continue;
      }
      if (membrane.clogged) {
        membrane.flow = 0;
        continue;
      }

      membrane.fouling += (0.0115 * inletLoad * pressureFactor - 0.0025) * dt;
      membrane.fouling = clamp(membrane.fouling, 0, 100);
      if (membrane.fouling >= 100) {
        membrane.clogged = true;
        membrane.fouling = 100;
        membrane.flow = 0;
        this.failureReason = `膜组件 ${membrane.id} 堵塞`;
        continue;
      }

      const pressureFlow = 0.018 * (this.pumpPressure - 34);
      const foulingFactor = 1 - membrane.fouling / 125;
      membrane.flow = clamp(2 * pressureFlow * foulingFactor, 0, 1.7);
      totalFlow += membrane.flow;
    }

    if (!this.backwash) {
      this.storage = Math.min(1300, this.storage + totalFlow * dt);
    }

    this.storage = Math.max(0, this.storage - 1.18 * dt);
    if (this.storage <= 0) {
      this.failureReason = '储水耗尽，供水中断';
    }
  }

  updateWear(dt) {
    for (const membrane of this.membranes) {
      if (membrane.clogged) continue;
      const pressureStress = Math.max(0, this.pumpPressure - 76) / 24;
      membrane.life -= (0.018 + 0.11 * pressureStress * pressureStress) * dt;
      if (membrane.life <= 0) {
        membrane.life = 0;
        this.failureReason = `膜组件 ${membrane.id} 寿命耗尽`;
      }
    }
  }

  step(dt = 1) {
    const stepSeconds = Math.min(dt, DURATION_SECONDS - this.elapsed);
    if (stepSeconds <= 0 || this.finished) return this.snapshot();

    this.elapsed += stepSeconds;
    this.updateTurbidity(stepSeconds);
    this.updateBackwash(stepSeconds);
    this.updateMembranes(stepSeconds);
    this.updateWear(stepSeconds);
    this.minStorage = Math.min(this.minStorage, this.storage);

    const previous = this.history[this.history.length - 1];
    if (this.elapsed >= DURATION_SECONDS || this.elapsed - previous.t >= 5) {
      this.history.push({
        t: this.elapsed,
        turbidity: this.turbidity,
        pressure: this.pumpPressure,
        storage: this.storage,
        foulingA: this.membranes[0].fouling,
        foulingB: this.membranes[1].fouling
      });
      if (this.history.length > 160) this.history.shift();
    }
    return this.snapshot();
  }

  run(seconds, script) {
    for (let second = 0; second < seconds && !this.finished; second += 1) {
      if (typeof script === 'function') script(this, this.elapsed);
      this.step(1);
    }
    return this.snapshot();
  }

  snapshot() {
    const production = this.membranes.reduce((sum, membrane) => {
      return sum + (membrane.backwashing ? 0 : membrane.flow);
    }, 0);
    return {
      elapsed: this.elapsed,
      remaining: Math.max(0, DURATION_SECONDS - this.elapsed),
      turbidity: this.turbidity,
      storage: this.storage,
      minStorage: this.minStorage,
      passStorage: PASS_STORAGE_LITERS,
      bypass: this.bypass,
      pumpPressure: this.pumpPressure,
      backwashCycle: this.backwashCycle,
      autoBackwash: this.autoBackwash,
      speed: this.speed,
      production,
      backwash: this.backwash ? { ...this.backwash } : null,
      backwashWaterUsed: this.backwashWaterUsed,
      membranes: this.membranes.map((membrane) => ({ ...membrane })),
      history: this.history.map((point) => ({ ...point })),
      finished: this.finished,
      passed: this.passed,
      failureReason: this.failureReason
    };
  }
}
