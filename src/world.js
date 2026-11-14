const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;

export const WORLD = {
  width: 1440,
  height: 900,
  leftAnchor: { x: 228, y: 172 },
  rightAnchor: { x: 1212, y: 178 },
  railSag: 68,
  trolleyMin: 392,
  trolleyMax: 1052,
  lengthMin: 152,
  lengthMax: 448,
  gravity: 880,
};

export const TARGETS = [
  { id: 1, code: "W-01", x: 538, y: 402, width: 136, height: 154 },
  { id: 2, code: "W-02", x: 902, y: 545, width: 136, height: 154 },
  { id: 3, code: "W-03", x: 646, y: 674, width: 136, height: 154 },
];

export const DOCK_RULES = {
  safeAngle: 10,
  hardAngle: 16,
  captureX: 49,
  captureY: 55,
  holdTime: 1.35,
  damage: 18,
};

const CUP_LOCAL = { x: -138, y: 4 };

export class MaintenanceWorld {
  constructor() {
    this.reset();
  }

  reset() {
    this.time = 0;
    this.windTime = 0;
    this.trolleyX = 735;
    this.trolleyVelocity = 0;
    this.trolleyAcceleration = 0;
    this.cableLength = 266;
    this.angle = -0.055;
    this.angularVelocity = 0.008;
    this.anchorEnergy = 1;
    this.anchored = false;
    this.anchorLock = 0;
    this.cupIntegrity = 100;
    this.docking = null;
    this.dockProgress = 0;
    this.dockTarget = null;
    this.holdCooldown = 0;
    this.completed = false;
    this.winTimer = 0;
    this.maxContactAngle = 0;
    this.justWon = false;
    this.wonEventHandled = false;
    this.tickAccumulator = 0;
    this.notice = null;
    this.events = [];
    this.targets = TARGETS.map((target) => ({ ...target, complete: false }));
    this.windSpeed = 5.8;
    this.windTarget = 5.8;
    this.windDirection = 1;
    this.gustTimer = 10.5;
    this.gustDuration = 0;
    this.gustAge = 0;
    this.gustPower = 0;
    this.windSurge = 0;
    this.gondolaX = 0;
    this.gondolaY = 0;
    this.cupX = 0;
    this.cupY = 0;
    this.railY = 0;
    this.contactAngle = 0;
    this.tension = 0.5;
    this.nearestTarget = null;
    this.targetDistance = Infinity;
    this.targetOffsetX = Infinity;
    this.targetOffsetY = Infinity;
    this.inCaptureZone = false;
    this.angleSafe = false;
    this._lastDockInput = false;
    this.updateGeometry();
  }

  railHeightAt(x) {
    const { leftAnchor, rightAnchor, railSag } = WORLD;
    const t = clamp((x - leftAnchor.x) / (rightAnchor.x - leftAnchor.x), 0, 1);
    return lerp(leftAnchor.y, rightAnchor.y, t) + railSag * 4 * t * (1 - t);
  }

  updateGeometry() {
    this.railY = this.railHeightAt(this.trolleyX);
    this.gondolaX = this.trolleyX + Math.sin(this.angle) * this.cableLength;
    this.gondolaY = this.railY + Math.cos(this.angle) * this.cableLength;
    this.cupX =
      this.gondolaX + CUP_LOCAL.x * Math.cos(this.angle) - CUP_LOCAL.y * Math.sin(this.angle);
    this.cupY =
      this.gondolaY + CUP_LOCAL.x * Math.sin(this.angle) + CUP_LOCAL.y * Math.cos(this.angle);
    this.contactAngle = (this.angle * 180) / Math.PI;
    this.tension = clamp(
      0.3 + (this.cableLength / WORLD.lengthMax) * 0.42 + Math.abs(this.contactAngle) * 0.011 + this.windSpeed / 58,
      0,
      1,
    );

    let nearest = null;
    let nearestDistance = Infinity;
    for (const target of this.targets) {
      if (target.complete) continue;
      const dx = this.cupX - target.x;
      const dy = this.cupY - target.y;
      const distance = Math.hypot(dx, dy);
      if (distance < nearestDistance) {
        nearest = target;
        nearestDistance = distance;
      }
    }
    this.nearestTarget = nearest;
    this.targetDistance = nearestDistance;
    if (nearest) {
      this.targetOffsetX = this.cupX - nearest.x;
      this.targetOffsetY = this.cupY - nearest.y;
      this.inCaptureZone =
        Math.abs(this.targetOffsetX) <= DOCK_RULES.captureX &&
        Math.abs(this.targetOffsetY) <= DOCK_RULES.captureY;
    } else {
      this.targetOffsetX = Infinity;
      this.targetOffsetY = Infinity;
      this.inCaptureZone = false;
    }
    this.angleSafe = Math.abs(this.contactAngle) <= DOCK_RULES.safeAngle;
  }

  update(delta, input) {
    this.events.length = 0;
    if (this.notice) {
      this.notice.ttl -= delta;
      if (this.notice.ttl <= 0) this.notice = null;
    }
    if (this.completed) {
      this.winTimer += delta;
      this.updateWind(delta, false);
      this.updateAnchor(delta, false);
      this.integrateSwing(delta, false);
      this.updateGeometry();
      this.audioPulse(delta);
      return;
    }

    const dt = Math.min(delta, 0.035);
    this.time += dt;
    this.holdCooldown = Math.max(0, this.holdCooldown - dt);

    this.updateWind(dt, true);
    this.updateAnchor(dt, input.anchor);
    this.updateControls(dt, input);
    this.integrateSwing(dt, input);
    this.updateGeometry();
    this.updateDocking(dt, input);
    this.audioPulse(dt);
  }

  updateWind(dt, allowChange) {
    this.windTime += dt;
    this.gustTimer -= dt;
    if (this.gustTimer <= 0 && this.gustDuration <= 0) {
      this.gustTimer = 11 + Math.random() * 5;
      this.gustDuration = 3.2 + Math.random() * 1.8;
      this.gustAge = 0;
      this.gustPower = 5.5 + Math.random() * 5.5;
      this.windDirection *= -1;
    }

    let gust = 0;
    if (this.gustDuration > 0) {
      this.gustAge += dt;
      const envelope = Math.sin(clamp(this.gustAge / this.gustDuration, 0, 1) * Math.PI);
      gust = this.gustPower * Math.pow(envelope, 1.5);
      if (this.gustAge >= this.gustDuration) {
        this.gustDuration = 0;
        this.gustAge = 0;
      }
    }

    const base =
      4.9 +
      Math.sin(this.windTime * 0.18 + 0.8) * 1.45 +
      Math.sin(this.windTime * 0.61) * 0.72 +
      Math.sin(this.windTime * 1.17 + 2.1) * 0.25;
    const desired = allowChange ? clamp(base + gust, 1.2, 18) : 5.2;
    this.windSurge = gust;
    this.windTarget = desired;
    this.windSpeed += (this.windTarget - this.windSpeed) * Math.min(1, dt * 1.8);
  }

  updateAnchor(dt, wantsAnchor) {
    const canAnchor = wantsAnchor && this.anchorEnergy > 0.012 && this.holdCooldown <= 0;
    this.anchored = canAnchor;
    if (canAnchor) {
      this.anchorEnergy = Math.max(0, this.anchorEnergy - dt * 0.205);
      this.anchorLock = 2.2;
    } else {
      this.anchorLock = Math.max(0, this.anchorLock - dt);
      const rechargeRate = this.anchorLock > 0 ? 0.035 : 0.075;
      this.anchorEnergy = Math.min(1, this.anchorEnergy + dt * rechargeRate);
    }
  }

  updateControls(dt, input) {
    const canControl = !this.anchored && this.holdCooldown <= 0;
    let direction = 0;
    if (canControl) {
      if (input.left) direction -= 1;
      if (input.right) direction += 1;
    }

    if (direction !== 0) {
      this.trolleyVelocity += direction * 390 * dt;
      this.trolleyVelocity = clamp(this.trolleyVelocity, -122, 122);
    } else {
      this.trolleyVelocity *= Math.exp(-5.2 * dt);
    }
    this.trolleyVelocity += this.windDirection * this.windSpeed * 0.13 * dt;
    if (this.anchored) this.trolleyVelocity *= Math.exp(-18 * dt);

    const previousVelocity = this.trolleyVelocity;
    this.trolleyX += this.trolleyVelocity * dt;
    if (this.trolleyX < WORLD.trolleyMin) {
      this.trolleyX = WORLD.trolleyMin;
      this.trolleyVelocity = Math.abs(this.trolleyVelocity) * 0.22;
    } else if (this.trolleyX > WORLD.trolleyMax) {
      this.trolleyX = WORLD.trolleyMax;
      this.trolleyVelocity = -Math.abs(this.trolleyVelocity) * 0.22;
    }
    this.trolleyAcceleration = (this.trolleyVelocity - previousVelocity) / Math.max(dt, 0.001);

    let lengthDirection = 0;
    if (canControl) {
      if (input.up) lengthDirection -= 1;
      if (input.down) lengthDirection += 1;
    }
    if (lengthDirection !== 0) {
      this.cableLength = clamp(
        this.cableLength + lengthDirection * 83 * dt,
        WORLD.lengthMin,
        WORLD.lengthMax,
      );
      this.angularVelocity += lengthDirection * 0.005 * dt;
    }
  }

  integrateSwing(dt, input) {
    const length = this.cableLength;
    let acceleration = -(WORLD.gravity / length) * Math.sin(this.angle);
    acceleration -= this.angularVelocity * 1.18;
    acceleration -= (this.trolleyAcceleration / length) * Math.cos(this.angle) * 0.78;

    const windForce = this.windSpeed * 7.6;
    acceleration +=
      ((windForce * this.windDirection) / length) * Math.cos(this.angle) * 0.68;

    if (this.anchored) {
      acceleration = -this.angle * 11 - this.angularVelocity * 8;
    } else if (this.inCaptureZone && this.angleSafe && !input.dock) {
      acceleration -= this.angularVelocity * 0.48;
    }

    this.angularVelocity += acceleration * dt;
    this.angle += this.angularVelocity * dt;
    this.angle = clamp(this.angle, -0.56, 0.56);
    this.maxContactAngle = Math.max(this.maxContactAngle, Math.abs(this.angle * (180 / Math.PI)));
  }

  updateDocking(dt, input) {
    const dockPressed = input.dock;
    const justPressed = dockPressed && !this._lastDockInput;
    this._lastDockInput = dockPressed;

    if (!dockPressed) {
      this.docking = null;
      this.dockProgress = 0;
      this.dockTarget = null;
      return;
    }

    if (this.cupIntegrity <= 0 || this.holdCooldown > 0) {
      this.docking = null;
      this.dockProgress = 0;
      this.dockTarget = null;
      return;
    }

    const target = this.nearestTarget;
    if (!target) return;

    if (justPressed && this.inCaptureZone && Math.abs(this.contactAngle) > DOCK_RULES.hardAngle) {
      this.impactCup("冲击角过大");
      return;
    }

    if (this.docking && Math.abs(this.contactAngle) > DOCK_RULES.hardAngle) {
      this.impactCup("吸附失稳");
      return;
    }

    if (!this.inCaptureZone || Math.abs(this.contactAngle) > DOCK_RULES.safeAngle) {
      if (!this.inCaptureZone) this.docking = null;
      this.dockProgress = Math.max(0, this.dockProgress - dt * 1.4);
      return;
    }

    if (!this.docking || this.dockTarget !== target) {
      this.docking = target;
      this.dockTarget = target;
      this.dockProgress = 0;
    }

    this.dockProgress += dt / DOCK_RULES.holdTime;
    this.tickAccumulator += dt;
    if (this.tickAccumulator > 0.17) {
      this.tickAccumulator = 0;
      this.audioTick = true;
    }

    if (this.dockProgress >= 1) {
      this.completeDock(target);
    }
  }

  impactCup(reason) {
    this.cupIntegrity = Math.max(0, this.cupIntegrity - DOCK_RULES.damage);
    this.holdCooldown = 0.95;
    this.angularVelocity += this.angle >= 0 ? -0.22 : 0.22;
    this.docking = null;
    this.dockProgress = 0;
    this.notice = {
      text: `${reason} · 吸盘完整性 -${DOCK_RULES.damage}%`,
      tone: "bad",
      event: "fail",
      ttl: 2.6,
    };
    this.events.push({ type: "fail" });
    if (this.cupIntegrity <= 0) {
      this.cupIntegrity = 0;
      this.holdCooldown = 2.2;
      this.notice.text = "吸盘失效 · 按 R 重新开始";
    }
  }

  completeDock(target) {
    target.complete = true;
    this.docking = null;
    this.dockProgress = 0;
    this.dockTarget = null;
    this.holdCooldown = 1.1;
    this.notice = {
      text: `${target.code} 固定完成 · ${this.targets.filter((item) => item.complete).length}/3`,
      tone: "good",
      event: "success",
      ttl: 2.6,
    };
    this.events.push({ type: "success" });
    this._lastDockInput = true;
    if (this.targets.every((item) => item.complete)) {
      this.completed = true;
      this.justWon = true;
      this.winTimer = 0;
      this.events.push({ type: "win" });
    }
    this.updateGeometry();
  }

  audioPulse(dt) {
    if (!this.audioTick) return;
    this.events.push({ type: "tick" });
    this.audioTick = false;
  }

  getTrolleyInput(input) {
    if (this.anchored || this.holdCooldown > 0) return 0;
    return (input.right ? 1 : 0) - (input.left ? 1 : 0);
  }

  get elapsedLabel() {
    const total = Math.floor(this.time);
    const minutes = String(Math.floor(total / 60)).padStart(2, "0");
    const seconds = String(total % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }
}
