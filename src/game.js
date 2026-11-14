(function () {
  "use strict";

  const C = window.ARM_CONFIG;
  const { WORLD, ARM, clamp, distance } = C;

  function rotate(x, y, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return { x: x * cos - y * sin, y: x * sin + y * cos };
  }

  function normalizeAngle(angle) {
    let value = angle;
    while (value > Math.PI) value -= Math.PI * 2;
    while (value < -Math.PI) value += Math.PI * 2;
    return value;
  }

  class ArmGame {
    constructor(options) {
      this.audio = options && options.audio ? options.audio : null;
      this.onToast = options && options.onToast ? options.onToast : () => {};
      this.onStatus = options && options.onStatus ? options.onStatus : () => {};
      this.reset();
    }

    reset(autoStart) {
      this.phase = autoStart ? "running" : "standby";
      this.time = C.MISSION_TIME;
      this.elapsed = 0;
      this.controls = { turn: 0, reach: 0 };
      this.arm = {
        angle: ARM.startAngle,
        angularVel: 0,
        extension: ARM.startReach,
        extensionVel: 0,
        holding: null,
        clampClosed: false,
        clampAnim: 0,
        autoOpenAt: 0,
        lastAngle: ARM.startAngle,
        lastExtension: ARM.startReach,
      };
      this.durability = { shoulder: 100, wrist: 100 };
      this.pods = C.makePods();
      this.metrics = {
        emptyClamps: 0,
        collisions: 0,
        picked: 0,
        docked: 0,
        bestDockSpeed: null,
        lastImpact: 0,
        lastCollision: "",
      };
      this.particles = [];
      this.shake = 0;
      this.flash = 0;
      this.collisionCooldown = 0;
      this.ignorePodUntil = 0;
      this.timePulse = 0;
      this.endTime = 0;
      this.toastText = "";
      this.dockedSpeeds = [];
      this.motorLevel = 0;
      this.statusSignature = "";
      this.emitStatus(true);
    }

    start() {
      if (this.phase !== "standby") return;
      this.phase = "running";
      this.notify("对接序列启动 · 保持稳定", "success");
    }

    notify(text, kind) {
      this.toastText = text;
      this.onToast(text, kind || "");
    }

    setControl(axis, value) {
      if (axis === "turn") this.controls.turn = value;
      if (axis === "reach") this.controls.reach = value;
      if (value !== 0) this.start();
    }

    geometryFor(angle, extension) {
      const base = { x: ARM.baseX, y: ARM.baseY };
      const shoulderDir = { x: Math.cos(angle), y: Math.sin(angle) };
      const elbow = {
        x: base.x + shoulderDir.x * ARM.upper,
        y: base.y + shoulderDir.y * ARM.upper,
      };
      const wristAngle = angle + ARM.elbowBend;
      const forearmDir = { x: Math.cos(wristAngle), y: Math.sin(wristAngle) };
      const wrist = {
        x: elbow.x + forearmDir.x * extension,
        y: elbow.y + forearmDir.y * extension,
      };
      const grip = {
        x: wrist.x + forearmDir.x * ARM.gripLength,
        y: wrist.y + forearmDir.y * ARM.gripLength,
      };
      return { base, elbow, wrist, grip, shoulderDir, forearmDir, wristAngle };
    }

    geometry() {
      return this.geometryFor(this.arm.angle, this.arm.extension);
    }

    inertia() {
      const payload = this.arm.holding ? this.arm.holding.mass : 0;
      const lever = (this.arm.extension + 90) / 520;
      return 1.35 + payload * lever * lever * 1.25;
    }

    gripVelocity(geom) {
      const shoulder = this.geometryFor(this.arm.angle, this.arm.extension);
      const carry = this.arm.extension + ARM.gripLength;
      const upperOmega = this.arm.angularVel;
      return {
        x:
          -Math.sin(this.arm.angle) * ARM.upper * upperOmega +
          -Math.sin(shoulder.wristAngle) * carry * upperOmega +
          geom.forearmDir.x * this.arm.extensionVel,
        y:
          Math.cos(this.arm.angle) * ARM.upper * upperOmega +
          Math.cos(shoulder.wristAngle) * carry * upperOmega +
          geom.forearmDir.y * this.arm.extensionVel,
      };
    }

    toggleClamp() {
      if (this.phase === "standby") this.start();
      if (this.phase !== "running") return;
      if (this.arm.holding) {
        this.releasePod();
        return;
      }
      if (this.arm.clampClosed) {
        this.arm.clampClosed = false;
        this.arm.autoOpenAt = 0;
        if (this.audio) this.audio.empty();
        return;
      }

      this.arm.clampClosed = true;
      const geom = this.geometry();
      let nearest = null;
      let nearestDistance = Infinity;
      for (const pod of this.pods) {
        if (pod.state !== "free") continue;
        const gap = distance(geom.grip.x, geom.grip.y, pod.x, pod.y);
        if (gap < pod.radius + 32 && gap < nearestDistance) {
          nearest = pod;
          nearestDistance = gap;
        }
      }

      if (!nearest) {
        this.metrics.emptyClamps += 1;
        this.notify("夹空 · 夹爪内没有吊舱，重新对准", "danger");
        this.emitStatus(true);
        if (this.audio) this.audio.empty();
        this.arm.autoOpenAt = this.elapsed + 0.32;
        return;
      }

      const relative = rotate(nearest.x - geom.grip.x, nearest.y - geom.grip.y, -geom.wristAngle);
      nearest.state = "held";
      nearest.vx = 0;
      nearest.vy = 0;
      nearest.holdX = relative.x;
      nearest.holdY = relative.y;
      nearest.holdAngle = nearest.angle - geom.wristAngle;
      this.arm.holding = nearest;
      this.arm.autoOpenAt = 0;
      this.metrics.picked += 1;
      this.notify(`${nearest.id} 已锁定 · 载荷 ${nearest.mass.toFixed(1)} t`, "success");
      this.emitStatus(true);
      if (this.audio) this.audio.lock(true);
    }

    releasePod() {
      const pod = this.arm.holding;
      if (!pod) {
        this.arm.clampClosed = false;
        if (this.audio) this.audio.empty();
        return;
      }
      const geom = this.geometry();
      const velocity = this.gripVelocity(geom);
      const speed = Math.hypot(velocity.x, velocity.y);
      const slotGap = distance(pod.slotX, pod.slotY, geom.grip.x, geom.grip.y);
      const podGap = distance(pod.slotX, pod.slotY, pod.x, pod.y);
      const slotFree = !this.pods.some(
        (candidate) => candidate !== pod && candidate.state === "docked" && candidate.index === pod.index
      );

      if (podGap < 54 && slotGap < 64 && speed < 145 && slotFree) {
        this.dockPod(pod, speed);
        return;
      }

      pod.state = "free";
      pod.vx = clamp(velocity.x, -160, 160);
      pod.vy = clamp(velocity.y, -160, 160);
      pod.spin = clamp(this.arm.angularVel * 0.22, -0.12, 0.12);
      pod.roamed = true;
      this.arm.holding = null;
      this.arm.clampClosed = false;
      this.ignorePodUntil = this.elapsed + 0.55;
      this.notify(
        podGap < 54 ? "释放速度过高 · 对接未锁定" : "吊舱已释放 · 漂浮中",
        podGap < 54 ? "danger" : ""
      );
      this.emitStatus(true);
      if (this.audio) this.audio.lock(false);
    }

    dockPod(pod, speed) {
      pod.state = "docked";
      pod.x = pod.slotX;
      pod.y = pod.slotY;
      pod.vx = 0;
      pod.vy = 0;
      pod.spin = 0;
      pod.angle = 0;
      pod.dockedSpeed = speed;
      this.dockedSpeeds.push(speed);
      this.metrics.docked = this.pods.filter((candidate) => candidate.state === "docked").length;
      this.metrics.bestDockSpeed =
        this.metrics.bestDockSpeed === null ? speed : Math.min(this.metrics.bestDockSpeed, speed);
      this.arm.holding = null;
      this.arm.clampClosed = false;
      this.ignorePodUntil = this.elapsed + 0.55;
      this.notify(`${pod.id} 对接锁定 · 冲击 ${speed.toFixed(1)} px/s`, "success");
      this.emitStatus(true);
      if (this.audio) {
        this.audio.lock(true);
        this.audio.docked();
      }
      if (this.metrics.docked === this.pods.length) {
        this.phase = "success";
        this.completionTime = C.MISSION_TIME - this.time;
        this.endTime = this.elapsed;
        this.notify("全部三条吊舱转运完成", "success");
        if (this.audio) this.audio.success();
      }
    }

    emitStatus(force) {
      const signature = [
        this.phase,
        this.metrics.emptyClamps,
        this.metrics.collisions,
        this.metrics.docked,
        Math.floor(this.durability.shoulder),
        Math.floor(this.durability.wrist),
        this.arm.holding ? this.arm.holding.id : "none",
      ].join("|");
      if (!force && signature === this.statusSignature) return;
      this.statusSignature = signature;
      this.onStatus({
        phase: this.phase,
        emptyClamps: this.metrics.emptyClamps,
        collisions: this.metrics.collisions,
        docked: this.metrics.docked,
        holding: this.arm.holding ? this.arm.holding.id : null,
        durability: { ...this.durability },
      });
    }

    step(dt) {
      const safeDt = clamp(dt, 0, 0.05);
      this.elapsed += safeDt;
      this.collisionCooldown = Math.max(0, this.collisionCooldown - safeDt);
      this.shake = Math.max(0, this.shake - safeDt * 32);
      this.flash = Math.max(0, this.flash - safeDt * 2.8);
      this.timePulse += safeDt;
      this.arm.clampAnim +=
        ((this.arm.clampClosed ? 1 : 0) - this.arm.clampAnim) * Math.min(1, safeDt * 15);
      if (
        this.arm.autoOpenAt > 0 &&
        this.elapsed >= this.arm.autoOpenAt &&
        !this.arm.holding
      ) {
        this.arm.clampClosed = false;
        this.arm.autoOpenAt = 0;
      }

      if (this.phase === "running") {
        this.time = Math.max(0, this.time - safeDt);
        this.updateArm(safeDt);
        this.updatePods(safeDt);
        this.motorLevel = this.computeMotorLevel();
        if (this.time <= 0) this.fail("任务超时 · 转运窗口已关闭");
      } else if (this.phase === "standby") {
        this.updatePods(safeDt);
        this.motorLevel *= 0.86;
      } else {
        this.motorLevel *= 0.88;
      }
      this.updateParticles(safeDt);
      this.emitStatus(false);
    }

    computeMotorLevel() {
      const turnLoad = Math.abs(this.controls.turn) * (0.55 + Math.min(1, Math.abs(this.arm.angularVel)));
      const reachLoad = Math.abs(this.controls.reach) * 0.72;
      return clamp(Math.max(turnLoad, reachLoad), 0, 1);
    }

    updateArm(dt) {
      const mass = this.arm.holding ? this.arm.holding.mass : 0;
      const previous = { angle: this.arm.angle, extension: this.arm.extension };
      const torqueFactor = 1 / (1 + mass * 0.46);
      const maxOmega = 1.22 * torqueFactor;
      const omegaAccel = (5.5 + mass * 0.2) * torqueFactor;
      const targetOmega = this.controls.turn * maxOmega;
      this.arm.angularVel +=
        clamp(targetOmega - this.arm.angularVel, -omegaAccel * dt, omegaAccel * dt);

      const maxExtensionSpeed = 175 / (1 + mass * 0.165);
      const extensionAccel = (390 + mass * 15) / (1 + mass * 0.22);
      const targetExtension = this.controls.reach * maxExtensionSpeed;
      this.arm.extensionVel +=
        clamp(
          targetExtension - this.arm.extensionVel,
          -extensionAccel * dt,
          extensionAccel * dt
        );

      this.arm.angle += this.arm.angularVel * dt;
      this.arm.extension += this.arm.extensionVel * dt;
      if (this.arm.angle < ARM.minAngle) {
        this.arm.angle = ARM.minAngle;
        this.arm.angularVel = Math.max(0, this.arm.angularVel);
      }
      if (this.arm.angle > ARM.maxAngle) {
        this.arm.angle = ARM.maxAngle;
        this.arm.angularVel = Math.min(0, this.arm.angularVel);
      }
      if (this.arm.extension < ARM.minReach) {
        this.arm.extension = ARM.minReach;
        this.arm.extensionVel = Math.max(0, this.arm.extensionVel);
      }
      if (this.arm.extension > ARM.maxReach) {
        this.arm.extension = ARM.maxReach;
        this.arm.extensionVel = Math.min(0, this.arm.extensionVel);
      }

      let geometry = this.geometry();
      const hit = this.findArmWallHit(geometry);
      if (hit) {
        const impactSpeed = Math.max(
          Math.abs(this.arm.angularVel) * (ARM.upper + this.arm.extension) * 0.58,
          Math.abs(this.arm.extensionVel) * 1.35
        );
        this.arm.angle = previous.angle;
        this.arm.extension = previous.extension;
        this.arm.angularVel *= -0.18;
        this.arm.extensionVel *= -0.12;
        const joint = hit.segment === 0 ? "shoulder" : "wrist";
        this.applyCollision(
          impactSpeed * (1 + mass * 0.22),
          hit.point,
          joint,
          hit.wall.side === "top" ? "上部舱壁" : hit.wall.side === "bottom" ? "下部舱壁" : "侧向舱壁"
        );
      }

      if (this.arm.holding) {
        if (hit) geometry = this.geometry();
        this.syncHeldPod(geometry);
      }
    }

    pointSegmentDistance(px, py, ax, ay, bx, by) {
      const dx = bx - ax;
      const dy = by - ay;
      const lengthSquared = dx * dx + dy * dy;
      if (lengthSquared === 0) return { distance: distance(px, py, ax, ay), x: ax, y: ay, t: 0 };
      let t = ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
      t = clamp(t, 0, 1);
      const x = ax + dx * t;
      const y = ay + dy * t;
      return { distance: distance(px, py, x, y), x, y, t };
    }

    findArmWallHit(geometry) {
      const segments = [
        { a: geometry.base, b: geometry.elbow },
        { a: geometry.elbow, b: geometry.grip },
      ];
      for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
        const segment = segments[segmentIndex];
        const samples = segmentIndex === 0 ? 28 : 64;
        for (let i = 0; i <= samples; i += 1) {
          const t = i / samples;
          const x = segment.a.x + (segment.b.x - segment.a.x) * t;
          const y = segment.a.y + (segment.b.y - segment.a.y) * t;
          for (const wall of C.WALLS) {
            if (C.pointInRect(x, y, wall, ARM.linkWidth * 0.5)) {
              return { wall, point: { x, y }, segment: segmentIndex };
            }
          }
        }
      }
      return null;
    }

    applyCollision(impactSpeed, point, joint, label, damageScale) {
      if (this.collisionCooldown > 0 || this.phase !== "running") return;
      this.collisionCooldown = C.COLLISION_COOLDOWN;
      const damage = Math.max(0.8, clamp(4 + impactSpeed * 0.045, 4, 19) * (damageScale || 1));
      this.durability[joint] = Math.max(0, this.durability[joint] - damage);
      this.metrics.collisions += 1;
      this.metrics.lastImpact = impactSpeed;
      this.metrics.lastCollision = label;
      this.shake = clamp(5 + impactSpeed * 0.032, 5, 14);
      this.flash = 0.35;
      this.spawnSparks(point.x, point.y, Math.round(7 + impactSpeed * 0.03), "#ffb24d");
      const jointLabel = joint === "shoulder" ? "肩关节" : "腕关节";
      this.notify(`${label}碰撞 · ${jointLabel}耐久 -${damage.toFixed(0)}`, "danger");
      if (this.audio) this.audio.collision(clamp(impactSpeed / 400, 0.25, 1));
      this.emitStatus(true);
      if (this.durability.shoulder <= 0 || this.durability.wrist <= 0) {
        this.fail("关节结构失效 · 机械臂已失去控制");
      }
    }

    syncHeldPod(geometry) {
      const pod = this.arm.holding;
      if (!pod) return;
      const offset = rotate(pod.holdX, pod.holdY, geometry.wristAngle);
      pod.x = geometry.grip.x + offset.x;
      pod.y = geometry.grip.y + offset.y;
      pod.angle = geometry.wristAngle + pod.holdAngle;
    }

    updatePods(dt) {
      for (const pod of this.pods) {
        if (pod.state === "held" || pod.state === "docked") continue;
        const bounds = pod.roamed ? C.BAY : C.DRIFT_AREA;
        const wobble = Math.sin(this.elapsed * 1.7 + pod.index * 2.1) * 2.2;
        pod.vx += wobble * dt;
        pod.vy += Math.cos(this.elapsed * 1.4 + pod.index) * 1.3 * dt;
        const speed = Math.hypot(pod.vx, pod.vy);
        if (speed > 14) {
          pod.vx = (pod.vx / speed) * 14;
          pod.vy = (pod.vy / speed) * 14;
        }
        pod.x += pod.vx * dt;
        pod.y += pod.vy * dt;
        pod.angle += pod.spin * dt;

        const left = bounds.x + pod.radius;
        const right = bounds.x + bounds.w - pod.radius;
        const top = bounds.y + pod.radius;
        const bottom = bounds.y + bounds.h - pod.radius;
        if (pod.x < left) {
          pod.x = left;
          pod.vx = Math.abs(pod.vx) * 0.68;
        } else if (pod.x > right) {
          pod.x = right;
          pod.vx = -Math.abs(pod.vx) * 0.68;
        }
        if (pod.y < top) {
          pod.y = top;
          pod.vy = Math.abs(pod.vy) * 0.68;
        } else if (pod.y > bottom) {
          pod.y = bottom;
          pod.vy = -Math.abs(pod.vy) * 0.68;
        }
      }

      for (let i = 0; i < this.pods.length; i += 1) {
        for (let j = i + 1; j < this.pods.length; j += 1) {
          const a = this.pods[i];
          const b = this.pods[j];
          if (a.state === "held" || b.state === "held" || a.state === "docked" || b.state === "docked") {
            continue;
          }
          const gap = distance(a.x, a.y, b.x, b.y);
          const overlap = a.radius + b.radius + 7 - gap;
          if (overlap > 0 && gap > 0.01) {
            const nx = (b.x - a.x) / gap;
            const ny = (b.y - a.y) / gap;
            a.x -= nx * overlap * 0.5;
            a.y -= ny * overlap * 0.5;
            b.x += nx * overlap * 0.5;
            b.y += ny * overlap * 0.5;
          }
        }
      }

      if (this.elapsed < this.ignorePodUntil || !this.arm) return;
      const geometry = this.geometry();
      const armSpeed =
        Math.abs(this.arm.angularVel) * (ARM.upper + this.arm.extension * 0.55) +
        Math.abs(this.arm.extensionVel) * 0.6;
      if (armSpeed < 72) return;
      const segments = [
        { a: geometry.base, b: geometry.elbow, segment: 0 },
        { a: geometry.elbow, b: geometry.grip, segment: 1 },
      ];
      for (const pod of this.pods) {
        if (pod.state !== "free") continue;
        if (distance(geometry.grip.x, geometry.grip.y, pod.x, pod.y) < pod.radius + 42) {
          continue;
        }
        for (const segment of segments) {
          const closest = this.pointSegmentDistance(
            pod.x,
            pod.y,
            segment.a.x,
            segment.a.y,
            segment.b.x,
            segment.b.y
          );
          if (closest.distance < pod.radius + ARM.linkWidth * 0.5) {
            const nx = (pod.x - closest.x) / Math.max(1, closest.distance);
            const ny = (pod.y - closest.y) / Math.max(1, closest.distance);
            pod.vx += nx * clamp(armSpeed * 0.18, 8, 40);
            pod.vy += ny * clamp(armSpeed * 0.18, 8, 40);
            pod.roamed = true;
            this.applyCollision(
              armSpeed,
              { x: closest.x, y: closest.y },
              segment.segment === 0 ? "shoulder" : "wrist",
              `吊舱 ${pod.id} 撞击`,
              0.32
            );
            break;
          }
        }
      }
    }

    spawnSparks(x, y, count, color) {
      for (let i = 0; i < count; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 30 + Math.random() * 135;
        this.particles.push({
          type: i % 3 === 0 ? "dust" : "spark",
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0.25 + Math.random() * 0.68,
          maxLife: 0.93,
          size: 1 + Math.random() * 2.4,
          color,
        });
      }
    }

    updateParticles(dt) {
      for (const particle of this.particles) {
        particle.life -= dt;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vx *= 1 - dt * 2.2;
        particle.vy *= 1 - dt * 2.2;
      }
      this.particles = this.particles.filter((particle) => particle.life > 0);
    }

    fail(reason) {
      if (this.phase !== "running") return;
      this.phase = "failed";
      this.endTime = this.elapsed;
      this.failureReason = reason;
      this.notify(reason, "danger");
      this.emitStatus(true);
    }
  }

  window.ArmGame = ArmGame;
})();
