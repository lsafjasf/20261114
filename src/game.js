import {
  BOAT,
  WORLD,
  boardPassengers,
  countPassengers,
  createPassengers,
  deliverPassengers,
  generateWorld,
  getHandling,
  getObjective,
} from "./model.js";
import { RiverRenderer } from "./renderer.js";

const BERTHS = {
  north: { x: WORLD.northDock.x, y: WORLD.northDock.y + 18 },
  south: { x: WORLD.southDock.x, y: WORLD.southDock.y - 18 },
};

function formatTime(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function shortestAngle(from, to) {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export class FerryGame {
  constructor(canvas, ui, audio) {
    this.ui = ui;
    this.audio = audio;
    this.renderer = new RiverRenderer(canvas);
    this.keys = new Set();
    this.toastTimer = 0;
    this.flashTimer = 0;
    this.wakeSpawn = 0;
    this.hitCooldowns = new Map();
    this.reset("first-fog");
  }

  reset(seed) {
    clearTimeout(this.toastTimer);
    if (this.ui?.toast) this.ui.toast.classList.remove("visible");
    this.seed = String(seed || "first-fog");
    this.world = generateWorld(this.seed);
    this.renderer.setWorld(this.world);
    this.passengers = createPassengers();
    this.boat = {
      x: BERTHS.south.x,
      y: BERTHS.south.y,
      vx: 0,
      vy: 0,
      angle: 0,
      damage: 0,
    };
    this.time = 0;
    this.elapsed = 0;
    this.started = false;
    this.complete = false;
    this.finalReturn = false;
    this.echo = 0;
    this.echoCooldown = 0;
    this.wake = [];
    this.nearDock = null;
    this.dockedAt = null;
    this.dockCooldown = 0;
    this.dockArmed = true;
    this.boundCooldown = 0;
    this.stats = { hits: 0, whistles: 0, maxLoad: 0 };
    this.keys.clear();
    this.hitCooldowns.clear();
    this.load = 0;
    this.throttle = 0;
    this.shake = 0;
    this.#renderPassengers();
    this.#refreshHud();
  }

  start(seed = this.seed) {
    this.reset(seed);
    this.started = true;
    this.ui.startScreen.classList.add("hidden");
    this.ui.resultScreen.classList.add("hidden");
    this.audio.init();
    this.#dock("south", true);
  }

  restart() {
    this.start(this.seed);
    this.showToast("航次重置 · 浓雾再次合拢", 1600);
  }

  setKey(code, pressed) {
    if (pressed) this.keys.add(code);
    else this.keys.delete(code);
  }

  soundWhistle() {
    if (!this.started || this.complete || this.echoCooldown > 0) return;
    this.echo = 1;
    this.echoCooldown = 0.65;
    this.stats.whistles += 1;
    this.audio.whistle(1);
    this.showToast("短汽笛 · 岸标正在回应", 1250);
  }

  toggleMute() {
    this.audio.setMuted(!this.audio.muted);
    this.showToast(this.audio.muted ? "声音已关闭" : "声音已开启", 1100);
  }

  update(delta) {
    const dt = Math.min(delta, 0.034);
    this.time += dt;
    this.echoCooldown = Math.max(0, this.echoCooldown - dt);
    this.echo = Math.max(0, this.echo - dt / 2.35);
    this.shake = Math.max(0, this.shake - dt * 3.2);
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) this.ui.damageFlash.classList.remove("active");
    }

    if (this.started && !this.complete) {
      this.elapsed += dt;
      this.#updatePhysics(dt);
      this.#updateDockState(dt);
      this.#updateWake(dt);
      this.audio.updateEngine(Math.hypot(this.boat.vx, this.boat.vy), this.load, this.throttle);
      this.#updateRealtimeHud();
    } else if (this.dockedAt) {
      this.boat.vx = 0;
      this.boat.vy = 0;
    }
  }

  showToast(message, duration = 2100) {
    clearTimeout(this.toastTimer);
    this.ui.toast.textContent = message;
    this.ui.toast.classList.add("visible");
    this.toastTimer = setTimeout(() => this.ui.toast.classList.remove("visible"), duration);
  }

  #inputVector() {
    let x = 0;
    let y = 0;
    if (this.keys.has("ArrowLeft") || this.keys.has("KeyA")) x -= 1;
    if (this.keys.has("ArrowRight") || this.keys.has("KeyD")) x += 1;
    if (this.keys.has("ArrowUp") || this.keys.has("KeyW")) y -= 1;
    if (this.keys.has("ArrowDown") || this.keys.has("KeyS")) y += 1;
    return { x, y };
  }

  #updatePhysics(dt) {
    const input = this.#inputVector();
    const moving = input.x !== 0 || input.y !== 0;
    this.throttle = moving ? 1 : 0;
    this.load = countPassengers(this.passengers, "aboard");
    this.stats.maxLoad = Math.max(this.stats.maxLoad, this.load);
    const handling = getHandling(this.load);

    if (this.dockedAt && moving) {
      this.dockedAt = null;
      this.dockCooldown = 0.75;
      this.audio.dock();
    }

    if (this.dockedAt) {
      this.boat.vx *= Math.exp(-dt * 7);
      this.boat.vy *= Math.exp(-dt * 7);
      return;
    }

    const length = Math.hypot(input.x, input.y) || 1;
    const ax = (input.x / length) * handling.acceleration;
    const ay = (input.y / length) * handling.acceleration;
    this.boat.vx += (ax + this.world.current.x * 0.5) * dt;
    this.boat.vy += ay * dt;

    const drag = Math.exp(-dt * 0.72);
    this.boat.vx *= drag;
    this.boat.vy *= drag;

    const speed = Math.hypot(this.boat.vx, this.boat.vy);
    if (speed > handling.maxSpeed) {
      const scale = handling.maxSpeed / speed;
      this.boat.vx *= scale;
      this.boat.vy *= scale;
    }

    this.boat.x += this.boat.vx * dt;
    this.boat.y += this.boat.vy * dt;
    const steeringSpeed = Math.hypot(this.boat.vx, this.boat.vy);
    if (steeringSpeed > 5.5) {
      const target = Math.atan2(this.boat.vx, -this.boat.vy);
      this.boat.angle += shortestAngle(this.boat.angle, target) * Math.min(1, dt * 3.9);
    }

    this.#resolveBounds(handling, dt);
    this.#resolveDriftwood(handling);
  }

  #registerImpact(handling, intensity, message) {
    const damage = handling.collisionDamage * intensity;
    this.boat.damage = Math.min(100, this.boat.damage + damage);
    this.stats.hits += 1;
    this.shake = Math.min(1, 0.35 + intensity * 0.5);
    this.flashTimer = 0.2;
    this.ui.damageFlash.classList.add("active");
    this.audio.hit(Math.min(1.3, 0.45 + intensity));
    if (message) this.showToast(message, 1250);
  }

  #resolveBounds(handling, dt) {
    const margin = 25;
    const top = WORLD.waterTop + 22;
    const bottom = WORLD.waterBottom - 22;
    let impact = 0;

    if (this.boat.x < margin) {
      this.boat.x = margin;
      this.boat.vx = Math.abs(this.boat.vx) * 0.35;
      impact = Math.abs(this.boat.vx) / handling.maxSpeed;
    } else if (this.boat.x > WORLD.width - margin) {
      this.boat.x = WORLD.width - margin;
      this.boat.vx = -Math.abs(this.boat.vx) * 0.35;
      impact = Math.abs(this.boat.vx) / handling.maxSpeed;
    }

    if (this.boat.y < top) {
      this.boat.y = top;
      this.boat.vy = Math.abs(this.boat.vy) * 0.35;
      impact = Math.max(impact, Math.abs(this.boat.vy) / handling.maxSpeed);
    } else if (this.boat.y > bottom) {
      this.boat.y = bottom;
      this.boat.vy = -Math.abs(this.boat.vy) * 0.35;
      impact = Math.max(impact, Math.abs(this.boat.vy) / handling.maxSpeed);
    }

    if (impact > 0.18 && (this.boundCooldown || 0) <= 0) {
      this.boundCooldown = 1.1;
      this.#registerImpact(handling, Math.min(1.4, impact), "撞上河岸 · 船体受损");
    }
    this.boundCooldown = Math.max(0, this.boundCooldown - dt);
  }

  #resolveDriftwood(handling) {
    const boatRadius = 23;
    for (const item of this.world.driftwood) {
      const cooldown = this.hitCooldowns.get(item.id) || 0;
      if (cooldown > this.elapsed) continue;
      const dx = this.boat.x - item.x;
      const dy = this.boat.y - item.y;
      const minDistance = boatRadius + item.radius * 0.82;
      const distance = Math.hypot(dx, dy);
      if (distance >= minDistance || distance < 0.001) continue;

      const nx = dx / distance;
      const ny = dy / distance;
      const overlap = minDistance - distance + 1.5;
      this.boat.x += nx * overlap;
      this.boat.y += ny * overlap;
      const intoHazard = this.boat.vx * nx + this.boat.vy * ny;
      const impact = Math.min(1.5, Math.max(0.28, Math.abs(intoHazard) / 150));
      if (intoHazard < 0) {
        this.boat.vx -= intoHazard * 1.7 * nx;
        this.boat.vy -= intoHazard * 1.7 * ny;
        this.boat.vx *= 0.55;
        this.boat.vy *= 0.55;
      }
      this.hitCooldowns.set(item.id, this.elapsed + 1.35);
      this.#registerImpact(handling, impact, "擦到漂木 · 满载时损伤更重");
    }
  }

  #updateWake(dt) {
    for (const particle of this.wake) {
      particle.age += dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx += this.world.current.x * 0.18 * dt;
    }
    this.wake = this.wake.filter((particle) => particle.age < particle.life);

    const speed = Math.hypot(this.boat.vx, this.boat.vy);
    if (!this.dockedAt && speed > 20) {
      this.wakeSpawn -= dt;
      const interval = 0.052 - Math.min(0.024, speed / 11000);
      while (this.wakeSpawn <= 0) {
        this.wakeSpawn += interval;
        const side = Math.random() < 0.5 ? -1 : 1;
        const localX = side * (9 + Math.random() * 9);
        const localY = 31 + Math.random() * 9;
        const cos = Math.cos(this.boat.angle);
        const sin = Math.sin(this.boat.angle);
        this.wake.push({
          x: this.boat.x + localX * cos - localY * sin,
          y: this.boat.y + localX * sin + localY * cos,
          vx: this.boat.vx * -0.08 + side * 8,
          vy: this.boat.vy * -0.08 + 8,
          angle: this.boat.angle + (Math.random() - 0.5) * 0.7,
          size: 2.2 + Math.random() * 4.2,
          age: 0,
          life: 0.7 + Math.random() * 1.2,
        });
      }
    } else {
      this.wakeSpawn = 0;
    }
    if (this.wake.length > 120) this.wake.splice(0, this.wake.length - 120);
  }

  #updateDockState(dt) {
    this.dockCooldown = Math.max(0, this.dockCooldown - dt);
    const berthX = BERTHS.south.x;
    const nearNorth =
      Math.abs(this.boat.x - berthX) < 92 && Math.abs(this.boat.y - BERTHS.north.y) < 62;
    const nearSouth =
      Math.abs(this.boat.x - berthX) < 92 && Math.abs(this.boat.y - BERTHS.south.y) < 62;
    const side = nearNorth ? "north" : nearSouth ? "south" : null;
    this.nearDock = side;
    if (!side) {
      this.dockArmed = true;
      if (this.dockedAt && Math.hypot(this.boat.vx, this.boat.vy) > 8) {
        this.dockedAt = null;
      }
      return;
    }

    const speed = Math.hypot(this.boat.vx, this.boat.vy);
    if (!this.dockedAt && this.dockArmed && speed < 88 && this.dockCooldown <= 0) {
      this.#dock(side);
    }
  }

  #dock(side, initial = false) {
    if (!this.dockArmed && !initial) return;
    const berth = BERTHS[side];
    this.dockedAt = side;
    this.dockArmed = false;
    this.boat.x = berth.x;
    this.boat.y = berth.y;
    this.boat.vx = 0;
    this.boat.vy = 0;
    this.nearDock = side;

    const delivered = countPassengers(this.passengers, "delivered");
    const aboard = countPassengers(this.passengers, "aboard");
    this.load = aboard;

    if (side === "south") {
      if (delivered === WORLD.passengerCount && this.finalReturn) {
        this.#finish();
        return;
      }

      const waiting = countPassengers(this.passengers, "waiting");
      if (waiting > 0 && aboard < WORLD.capacity) {
        const result = boardPassengers(this.passengers, WORLD.capacity - aboard);
        this.passengers = result.passengers;
        this.load = countPassengers(this.passengers, "aboard");
        this.stats.maxLoad = Math.max(this.stats.maxLoad, this.load);
        const batch = delivered === 0 ? "第一批" : "第二批";
        this.audio.dock();
        this.showToast(`${batch} ${result.boarded} 人登船 · 载重 ${this.load} / 3`, 2200);
      } else if (waiting > 0) {
        this.showToast("船上仍有乘客 · 请先驶向北岸", 1700);
      } else if (!initial) {
        this.showToast("南岸暂时无人等候", 1500);
      }
    } else if (aboard > 0) {
      const result = deliverPassengers(this.passengers);
      this.passengers = result.passengers;
      this.load = 0;
      this.audio.dock();
      const totalDelivered = countPassengers(this.passengers, "delivered");
      if (totalDelivered === WORLD.passengerCount) {
        this.finalReturn = true;
        this.showToast("六名乘客均已抵北岸 · 返航南岸", 2700);
      } else {
        this.showToast(`${result.delivered} 人抵达北岸 · 返航接下一批`, 2400);
      }
    } else if (!initial) {
      this.showToast("北岸浮桥 · 船上没有乘客", 1500);
    }

    this.#renderPassengers();
    this.#refreshHud();
  }

  #finish() {
    this.complete = true;
    this.dockedAt = "south";
    this.boat.vx = 0;
    this.boat.vy = 0;
    this.audio.dock();
    this.ui.resultTime.textContent = formatTime(this.elapsed);
    this.ui.resultHits.textContent = String(this.stats.hits);
    this.ui.resultDamage.textContent = `${Math.round(this.boat.damage)}%`;
    this.ui.resultScreen.classList.remove("hidden");
    this.ui.seedValue.textContent = this.seed;
  }

  #renderPassengers() {
    this.ui.passengerList.innerHTML = this.passengers
      .map(
        (passenger) => `
          <li class="${passenger.status}">
            <span class="name">${passenger.name}<i>第${passenger.batch}批</i></span>
            <span class="note">${passenger.status === "delivered" ? "已抵北岸" : passenger.status === "aboard" ? "在船上" : passenger.note}</span>
          </li>`,
      )
      .join("");
  }

  #refreshHud() {
    if (!this.started) {
      this.ui.objectiveLabel.textContent = "等待启航";
      this.ui.objectiveDetail.textContent = "雾势正在合拢";
    }
    const objective = getObjective(this.passengers);
    const delivered = countPassengers(this.passengers, "delivered");
    const waiting = countPassengers(this.passengers, "waiting");
    this.load = countPassengers(this.passengers, "aboard");
    this.ui.seedValue.textContent = this.seed;
    if (this.started) {
      this.ui.objectiveLabel.textContent = objective.label;
      this.ui.objectiveDetail.textContent = objective.detail;
    }
    this.ui.deliveredCount.textContent = String(delivered);
    this.ui.loadReadout.textContent = `${this.load} / 3`;
    this.ui.loadBar.style.width = `${(this.load / WORLD.capacity) * 100}%`;

    if (delivered === WORLD.passengerCount) {
      this.ui.batchState.textContent = this.finalReturn ? "返航靠岸中" : "两批乘客已送达";
    } else if (delivered === 0 && this.load > 0) {
      this.ui.batchState.textContent = "第一批航行中";
    } else if (delivered === 0) {
      this.ui.batchState.textContent = "第一批待登船";
    } else if (waiting > 0) {
      this.ui.batchState.textContent = this.load > 0 ? "第二批航行中" : "第二批待登船";
    } else {
      this.ui.batchState.textContent = "第二批航行中";
    }

    if (this.dockedAt) {
      this.ui.vesselState.textContent = "系泊";
    } else if (this.boat.damage > 65) {
      this.ui.vesselState.textContent = "船体危急";
    } else if (this.load > 0) {
      this.ui.vesselState.textContent = `${this.load} 人载客`;
    } else {
      this.ui.vesselState.textContent = "空载";
    }

    const handling = getHandling(this.load);
    if (this.load === 0) {
      this.ui.handlingNote.textContent = "空载 · 转向轻快，受横流影响更明显";
    } else {
      const speedLoss = Math.round((1 - handling.maxSpeed / BOAT.baseMaxSpeed) * 100);
      const damageGain = Math.round((handling.collisionDamage / BOAT.collisionDamage - 1) * 100);
      this.ui.handlingNote.textContent =
        this.load === WORLD.capacity
          ? `满载 · 极速 -${speedLoss}% · 碰撞损伤 +${damageGain}%`
          : `载客 ${this.load} 人 · 加速与极速下降`;
    }
  }

  #updateRealtimeHud() {
    const speed = Math.hypot(this.boat.vx, this.boat.vy);
    const handling = getHandling(this.load);
    this.ui.speedReadout.textContent = `${(speed / 9).toFixed(1)} 节`;
    this.ui.speedBar.style.width = `${Math.min(100, (speed / handling.maxSpeed) * 100)}%`;
    this.ui.loadReadout.textContent = `${this.load} / 3`;
    this.ui.loadBar.style.width = `${(this.load / WORLD.capacity) * 100}%`;
  }

  debugSnapshot() {
    const delivered = countPassengers(this.passengers, "delivered");
    const waiting = countPassengers(this.passengers, "waiting");
    const aboard = countPassengers(this.passengers, "aboard");
    return {
      seed: this.seed,
      started: this.started,
      complete: this.complete,
      finalReturn: this.finalReturn,
      echo: this.echo,
      load: this.load,
      delivered,
      waiting,
      aboard,
      damage: this.boat.damage,
      objective: getObjective(this.passengers).key,
      handling: getHandling(this.load),
      boat: { x: this.boat.x, y: this.boat.y, vx: this.boat.vx, vy: this.boat.vy },
      passengers: this.passengers.map(({ id, batch, status }) => ({ id, batch, status })),
    };
  }

  debugDock(side) {
    if (!this.started || this.complete || !BERTHS[side]) return this.debugSnapshot();
    this.#dock(side, true);
    return this.debugSnapshot();
  }
}
