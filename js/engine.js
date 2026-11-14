export const CONFIG = Object.freeze({
  bayCount: 2,
  batteryCount: 4,
  totalCars: 6,
  targetDeliveries: 5,
  overheatTemp: 84,
  warningTemp: 74,
  ambientTemp: 26.5,
  swapDuration: 4.8,
  chargeDuration: 8.4,
  cooldownDuration: 1.8,
  coolingDuration: 3,
  idleCoolRate: 0.34,
  coolingRate: 10.8,
  idleChargeRate: 0.52,
});

export const CAR_BLUEPRINTS = Object.freeze([
  { id: "A-01", arrival: 0, patience: 27, demand: 24, color: "#64e9df", body: "#dce9e4" },
  { id: "A-02", arrival: 3.2, patience: 25, demand: 21, color: "#ceff56", body: "#d8e8c3" },
  { id: "A-03", arrival: 7.1, patience: 24, demand: 27, color: "#ffb54e", body: "#f1d6b1" },
  { id: "A-04", arrival: 11.8, patience: 23, demand: 23, color: "#e4a5ff", body: "#dfcbe8" },
  { id: "A-05", arrival: 16.9, patience: 23, demand: 25, color: "#ff8b73", body: "#ecc9c0" },
  { id: "A-06", arrival: 22.6, patience: 22, demand: 19, color: "#9ed6ff", body: "#c8dce8" },
]);

export const BATTERY_BLUEPRINTS = Object.freeze([
  { id: "P1", charge: 86, temp: 46.2, color: "#ceff56" },
  { id: "P2", charge: 74, temp: 35.4, color: "#5be7dc" },
  { id: "P3", charge: 94, temp: 29.1, color: "#b6f072" },
  { id: "P4", charge: 67, temp: 57.3, color: "#ffb54e" },
]);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function energyCost(mode, demand) {
  return Math.ceil(demand * (mode === "swap" ? 0.92 : 0.6));
}

export function serviceDuration(mode) {
  return mode === "swap" ? CONFIG.swapDuration : CONFIG.chargeDuration;
}

function heatRate(mode) {
  return mode === "swap" ? 4.35 : 1.5;
}

export class StationEngine {
  constructor({ onEvent = () => {} } = {}) {
    this.onEvent = onEvent;
    this.reset();
  }

  reset() {
    this.elapsed = 0;
    this.status = "ready";
    this.paused = false;
    this.arrivalsDone = 0;
    this.served = 0;
    this.left = [];
    this.deliveryOrder = [];
    this.lastEvent = null;

    this.cars = CAR_BLUEPRINTS.map((car) => ({
      ...car,
      waited: 0,
      state: "waiting",
      bayId: null,
    }));

    this.queue = [];
    this.bays = Array.from({ length: CONFIG.bayCount }, (_, index) => ({
      id: index + 1,
      status: "idle",
      carId: null,
      mode: null,
      batteryId: null,
      remaining: 0,
      total: 0,
      progress: 0,
      lastCarId: null,
    }));

    this.batteries = BATTERY_BLUEPRINTS.map((battery) => ({
      ...battery,
      cooling: false,
      coolingRemaining: 0,
      inUseBay: null,
      warned: false,
    }));
  }

  start() {
    if (this.status === "ready") {
      this.status = "running";
      this.processArrivals();
      this.emit({ type: "start", message: "站台开放，A-01 正在入口等待。" });
    }
  }

  restart() {
    this.reset();
    this.start();
  }

  pause() {
    if (this.status !== "running") return false;
    this.status = "paused";
    this.paused = true;
    this.emit({ type: "pause", message: "班次已暂停：所有计时冻结。" });
    return true;
  }

  resume() {
    if (this.status !== "paused") return false;
    this.status = "running";
    this.paused = false;
    this.emit({ type: "resume", message: "继续营业。" });
    return true;
  }

  emit(event) {
    this.lastEvent = event;
    this.onEvent(event);
  }

  processArrivals() {
    while (
      this.arrivalsDone < this.cars.length &&
      this.cars[this.arrivalsDone].arrival <= this.elapsed
    ) {
      const car = this.cars[this.arrivalsDone];
      car.state = "waiting";
      car.waited = Math.max(0, this.elapsed - car.arrival);
      this.queue.push(car);
      this.arrivalsDone += 1;
      this.emit({
        type: "arrival",
        carId: car.id,
        message: `${car.id} 抵达，电量需求 ${car.demand}%。`,
      });
    }
  }

  dispatch(carId, mode, batteryId) {
    if (this.status !== "running") {
      return this.reject("班次尚未运行或已暂停。");
    }
    if (mode !== "swap" && mode !== "charge") {
      return this.reject("未知的作业模式。");
    }

    const carIndex = this.queue.findIndex((car) => car.id === carId);
    if (carIndex < 0) return this.reject("该车辆不在队列中。");

    const bay = this.bays.find((item) => item.status === "idle");
    if (!bay) return this.reject("两个工位都在作业或切换，请稍等。");

    const battery = this.batteries.find((item) => item.id === batteryId);
    if (!battery) return this.reject("请先在电池库选择一块电池。");
    if (battery.cooling) return this.reject(`${battery.id} 正在冷却，暂时不可用。`);
    if (battery.inUseBay !== null) return this.reject(`${battery.id} 正被工位占用。`);

    const car = this.queue[carIndex];
    const cost = energyCost(mode, car.demand);
    if (battery.charge < cost) {
      return this.reject(`${battery.id} 电量不足，需要 ${cost}%。`);
    }

    this.queue.splice(carIndex, 1);
    car.state = "service";
    car.bayId = bay.id;
    battery.charge = clamp(battery.charge - cost, 0, 100);
    battery.inUseBay = bay.id;

    bay.status = "service";
    bay.carId = car.id;
    bay.mode = mode;
    bay.batteryId = battery.id;
    bay.total = serviceDuration(mode);
    bay.remaining = bay.total;
    bay.progress = 0;

    this.emit({
      type: "dispatch",
      carId: car.id,
      bayId: bay.id,
      mode,
      batteryId: battery.id,
      message: `${car.id} 进入 ${bay.id} 号工位 · ${mode === "swap" ? "快换" : "慢充"} · ${battery.id}`,
    });
    return { ok: true, bayId: bay.id, batteryId: battery.id };
  }

  reject(message) {
    this.emit({ type: "reject", message });
    return { ok: false, error: message };
  }

  startCooling(batteryId) {
    if (this.status !== "running") {
      return this.reject("暂停期间不能启动冷却。");
    }
    const battery = this.batteries.find((item) => item.id === batteryId);
    if (!battery) return this.reject("找不到该电池。");
    if (battery.inUseBay !== null) return this.reject("作业中的电池不能冷却。");
    if (battery.cooling) return this.reject(`${battery.id} 已经在冷却。`);
    if (battery.temp < 42) return this.reject(`${battery.id} 温度正常，无需冷却。`);

    battery.cooling = true;
    battery.coolingRemaining = CONFIG.coolingDuration;
    this.emit({
      type: "cooling",
      batteryId,
      message: `${battery.id} 启动液冷，3 秒内不可调度。`,
    });
    return { ok: true };
  }

  reorder(carId, direction) {
    if (this.status !== "running") return false;
    const index = this.queue.findIndex((car) => car.id === carId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= this.queue.length) return false;
    [this.queue[index], this.queue[target]] = [this.queue[target], this.queue[index]];
    this.emit({
      type: "reorder",
      message: `${carId} 调整到第 ${target + 1} 位入场。`,
    });
    return true;
  }

  tick(seconds) {
    if (this.status !== "running" || !Number.isFinite(seconds) || seconds <= 0) {
      return;
    }

    let remaining = seconds;
    while (remaining > 0 && this.status === "running") {
      const step = Math.min(remaining, 0.05);
      this.step(step);
      remaining -= step;
    }
  }

  step(dt) {
    this.elapsed += dt;
    this.processArrivals();
    this.updateBatteries(dt);
    if (this.status !== "running") return;
    this.updateBays(dt);
    if (this.status !== "running") return;
    this.updateQueue(dt);
    if (this.status !== "running") return;
    this.checkOutcome();
  }

  updateBatteries(dt) {
    for (const battery of this.batteries) {
      if (battery.cooling) {
        battery.temp -= CONFIG.coolingRate * dt;
        battery.coolingRemaining -= dt;
        if (battery.coolingRemaining <= 0) {
          battery.cooling = false;
          battery.coolingRemaining = 0;
          this.emit({
            type: "cooled",
            batteryId: battery.id,
            message: `${battery.id} 冷却完成，温度 ${battery.temp.toFixed(1)}°C。`,
          });
        }
      } else if (battery.inUseBay !== null) {
        const bay = this.bays[battery.inUseBay - 1];
        if (bay?.status === "service") {
          battery.temp += heatRate(bay.mode) * dt;
        }
      } else {
        battery.temp -= CONFIG.idleCoolRate * dt;
        battery.charge = clamp(battery.charge + CONFIG.idleChargeRate * dt, 0, 100);
      }

      battery.temp = Math.max(CONFIG.ambientTemp, battery.temp);

      if (battery.temp >= CONFIG.overheatTemp) {
        this.lose("overheat", `${battery.id} 热失控：电池温度达到 ${battery.temp.toFixed(1)}°C。`);
        return;
      }

      if (battery.temp >= CONFIG.warningTemp && !battery.warned) {
        battery.warned = true;
        this.emit({
          type: "warning",
          batteryId: battery.id,
          temp: battery.temp,
          message: `高温警报：${battery.id} 已达 ${battery.temp.toFixed(1)}°C，立即冷却或换用其他电池。`,
        });
      } else if (battery.temp < CONFIG.warningTemp - 5) {
        battery.warned = false;
      }
    }
  }

  updateBays(dt) {
    for (const bay of this.bays) {
      if (bay.status === "service") {
        bay.remaining = Math.max(0, bay.remaining - dt);
        bay.progress = 1 - bay.remaining / bay.total;
        if (bay.remaining <= 0) {
          this.completeService(bay);
          if (this.status !== "running") return;
        }
      } else if (bay.status === "cooldown") {
        bay.remaining = Math.max(0, bay.remaining - dt);
        bay.progress = 1 - bay.remaining / CONFIG.cooldownDuration;
        if (bay.remaining <= 0) {
          bay.status = "idle";
          bay.progress = 0;
          bay.carId = null;
          bay.mode = null;
          bay.batteryId = null;
        }
      }
    }
  }

  completeService(bay) {
    const car = this.cars.find((item) => item.id === bay.carId);
    const battery = this.batteries.find((item) => item.id === bay.batteryId);
    if (battery) battery.inUseBay = null;
    if (car) {
      car.state = "delivered";
      car.bayId = null;
      car.waited = Math.min(car.waited, car.patience);
    }

    this.served += 1;
    this.deliveryOrder.push(bay.carId);
    bay.lastCarId = bay.carId;
    bay.status = "cooldown";
    bay.remaining = CONFIG.cooldownDuration;
    bay.total = CONFIG.cooldownDuration;
    bay.progress = 0;

    this.emit({
      type: "delivered",
      carId: bay.carId,
      bayId: bay.id,
      served: this.served,
      message: `${bay.carId} 交付完成，工位切换中。已送走 ${this.served}/${CONFIG.targetDeliveries}。`,
    });

    if (this.served >= CONFIG.targetDeliveries) {
      this.win();
    }
  }

  updateQueue(dt) {
    for (const car of [...this.queue]) {
      car.waited += dt;
      if (car.waited >= car.patience) {
        const index = this.queue.indexOf(car);
        if (index >= 0) this.queue.splice(index, 1);
        car.state = "left";
        car.waited = car.patience;
        this.left.push(car.id);
        this.emit({
          type: "left",
          carId: car.id,
          message: `${car.id} 等待超时，已退出队列。`,
        });
      }
    }
  }

  checkOutcome() {
    if (this.status !== "running") return;
    if (this.arrivalsDone >= this.cars.length) {
      const inService = this.bays.filter((bay) => bay.status === "service").length;
      const possible = this.served + inService + this.queue.length;
      if (possible < CONFIG.targetDeliveries) {
        this.lose("abandoned", "可交付车辆不足五辆，晚高峰目标无法完成。");
      }
    }
  }

  win() {
    if (this.status !== "running") return;
    this.status = "won";
    this.paused = false;
    this.emit({
      type: "win",
      served: this.served,
      elapsed: this.elapsed,
      message: "晚高峰达成：五车离站，全程无热失控。",
    });
  }

  lose(reason, message) {
    if (this.status !== "running") return;
    this.status = "lost";
    this.paused = false;
    this.emit({
      type: reason,
      reason,
      served: this.served,
      elapsed: this.elapsed,
      message,
    });
  }

  snapshot() {
    return {
      elapsed: this.elapsed,
      status: this.status,
      paused: this.paused,
      served: this.served,
      target: CONFIG.targetDeliveries,
      arrivalsDone: this.arrivalsDone,
      queue: this.queue.map((car) => ({
        id: car.id,
        demand: car.demand,
        waited: car.waited,
        patience: car.patience,
        remaining: Math.max(0, car.patience - car.waited),
      })),
      bays: this.bays.map((bay) => ({ ...bay })),
      batteries: this.batteries.map((battery) => ({ ...battery })),
      left: [...this.left],
      deliveryOrder: [...this.deliveryOrder],
    };
  }
}
