(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.IceSim = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TILE = 20;
  const COLS = 120;
  const ROWS = 80;
  const WIDTH = COLS * TILE;
  const HEIGHT = ROWS * TILE;
  const ROUTE_MIN_THICKNESS = 0.38;
  const FALL_THICKNESS = 0.105;
  const BASE_MASS = 320;
  const CORE_MASS = 46;
  const MAX_CORES = 3;
  const MAX_SPEED = 255;
  const SAMPLE_TIME = 1.15;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const smoothstep = (t) => t * t * (3 - 2 * t);
  const normalizeAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

  function hashSeed(seed) {
    let value = Number(seed) >>> 0;
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    return (value ^ (value >>> 16)) >>> 0;
  }

  function mulberry32(seed) {
    let state = hashSeed(seed);
    return function random() {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let value = Math.imul(state ^ (state >>> 15), 1 | state);
      value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeNoise(seed) {
    const offset = hashSeed(seed);
    function corner(x, y) {
      let value = Math.imul(x, 374761393) + Math.imul(y, 668265263) + offset;
      value = Math.imul(value ^ (value >>> 13), 1274126177);
      return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
    }
    function noise2(x, y) {
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const tx = smoothstep(x - xi);
      const ty = smoothstep(y - yi);
      const a = lerp(corner(xi, yi), corner(xi + 1, yi), tx);
      const b = lerp(corner(xi, yi + 1), corner(xi + 1, yi + 1), tx);
      return lerp(a, b, ty);
    }
    function fbm(x, y, octaves = 4) {
      let value = 0;
      let amplitude = 0.5;
      let frequency = 1;
      let total = 0;
      for (let i = 0; i < octaves; i += 1) {
        value += noise2(x * frequency, y * frequency) * amplitude;
        total += amplitude;
        amplitude *= 0.5;
        frequency *= 2.03;
      }
      return value / total;
    }
    return { noise2, fbm };
  }

  class MinHeap {
    constructor() {
      this.items = [];
    }
    push(node) {
      const items = this.items;
      items.push(node);
      let index = items.length - 1;
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (items[parent].priority <= node.priority) break;
        items[index] = items[parent];
        index = parent;
      }
      items[index] = node;
    }
    pop() {
      const items = this.items;
      if (!items.length) return null;
      const first = items[0];
      const last = items.pop();
      if (items.length && last) {
        let index = 0;
        while (true) {
          const left = index * 2 + 1;
          const right = left + 1;
          if (left >= items.length) break;
          let child = left;
          if (right < items.length && items[right].priority < items[left].priority) child = right;
          if (items[child].priority >= last.priority) break;
          items[index] = items[child];
          index = child;
        }
        items[index] = last;
      }
      return first;
    }
    get size() {
      return this.items.length;
    }
  }

  class IceWorld {
    constructor(seed = 20261114) {
      this.seed = Number(seed) >>> 0;
      this.tile = TILE;
      this.cols = COLS;
      this.rows = ROWS;
      this.width = WIDTH;
      this.height = HEIGHT;
      this.thickness = new Float32Array(COLS * ROWS);
      this.water = new Uint8Array(COLS * ROWS);
      this.noise = makeNoise(this.seed);
      this.layoutRandom = mulberry32(this.seed ^ 0xa51ce);
      this.camp = { x: 720, y: 800, radius: 104, name: "白鼬营地" };
      this.cores = this.createCores();
      this.generateIce();
      this.prepareSites();
      this.routes = [];
      this.routeViability = [];
      this.buildRoutes();
    }

    createCores() {
      const names = ["北脊样本", "蓝沟样本", "断层样本"];
      const angles = [-0.72, 0.18, 2.25];
      const radii = [645, 930, 735];
      return names.map((name, index) => ({
        id: index,
        name,
        x: clamp(
          this.camp.x + Math.cos(angles[index] + (this.layoutRandom() - 0.5) * 0.16) * (radii[index] + (this.layoutRandom() - 0.5) * 70),
          180,
          this.width - 180,
        ),
        y: clamp(
          this.camp.y + Math.sin(angles[index] + (this.layoutRandom() - 0.5) * 0.16) * (radii[index] + (this.layoutRandom() - 0.5) * 70),
          160,
          this.height - 160,
        ),
        radius: 76,
        collected: false,
      }));
    }

    generateIce() {
      for (let row = 0; row < ROWS; row += 1) {
        for (let col = 0; col < COLS; col += 1) {
          const index = row * COLS + col;
          const shelf = this.noise.fbm(col * 0.026 + 8.4, row * 0.026 + 2.7, 4);
          const grain = this.noise.fbm(col * 0.13 + 31.2, row * 0.13 + 19.4, 3);
          const vein = Math.abs(this.noise.fbm(col * 0.07 + 3.1, row * 0.07 + 9.8, 2) - 0.5);
          const lead = Math.abs(this.noise.fbm(col * 0.062 + 77.3, row * 0.135 + 41.7, 3) - 0.5);
          const polynya = this.noise.fbm(col * 0.047 + 115.2, row * 0.052 + 68.4, 3);
          let thickness = 0.2 + shelf * 0.74 + grain * 0.13 - vein * 0.22;
          if (lead < 0.085) thickness -= (0.085 - lead) * 6;
          if (polynya < 0.38) thickness -= (0.38 - polynya) * 1.45;
          const shore = Math.min(col, row, COLS - 1 - col, ROWS - 1 - row) / 9;
          thickness *= clamp(0.55 + shore * 0.45, 0.55, 1);
          thickness = clamp(thickness, 0.025, 0.98);
          this.thickness[index] = thickness;
          this.water[index] = thickness < 0.105 ? 1 : 0;
        }
      }
    }

    prepareSites() {
      this.stampSafe(this.camp.x, this.camp.y, 128, 0.94);
      for (const core of this.cores) this.stampSafe(core.x, core.y, 92, 0.88);
    }

    buildRoutes() {
      for (let index = 0; index < this.cores.length; index += 1) {
        const core = this.cores[index];
        let path = this.findPath(this.camp, core);
        if (!path || !this.isRouteViable(path)) {
          const fallback = this.createFallbackPath(this.camp, core, index);
          this.stampRoute(fallback, 0.52, 41);
          path = this.findPath(this.camp, core);
        }
        if (!path) {
          this.stampSafe(core.x, core.y, 160, 0.72);
          path = this.findPath(this.camp, core);
        }
        const smoothed = path ? this.smoothPath(path, 2) : [this.camp, core];
        this.stampRoute(smoothed, 0.5, 34);
        this.routes.push(smoothed);
        this.routeViability.push(this.isRouteViable(smoothed));
      }
    }

    createFallbackPath(start, end, index) {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const nx = -dy / length;
      const ny = dx / length;
      const direction = index % 2 === 0 ? 1 : -1;
      const points = [];
      const count = 8;
      for (let step = 0; step <= count; step += 1) {
        const t = step / count;
        const bend = Math.sin(t * Math.PI) * (120 + index * 25) * direction;
        const ripple = Math.sin(t * Math.PI * 3 + index) * 38;
        points.push({
          x: clamp(lerp(start.x, end.x, t) + nx * (bend + ripple), 40, this.width - 40),
          y: clamp(lerp(start.y, end.y, t) + ny * (bend - ripple), 40, this.height - 40),
        });
      }
      points[0] = { x: start.x, y: start.y };
      points[points.length - 1] = { x: end.x, y: end.y };
      return points;
    }

    stampSafe(x, y, radius, minimum) {
      const minCol = clamp(Math.floor((x - radius) / TILE), 0, COLS - 1);
      const maxCol = clamp(Math.ceil((x + radius) / TILE), 0, COLS - 1);
      const minRow = clamp(Math.floor((y - radius) / TILE), 0, ROWS - 1);
      const maxRow = clamp(Math.ceil((y + radius) / TILE), 0, ROWS - 1);
      for (let row = minRow; row <= maxRow; row += 1) {
        for (let col = minCol; col <= maxCol; col += 1) {
          const px = col * TILE + TILE / 2;
          const py = row * TILE + TILE / 2;
          const falloff = clamp(1 - Math.hypot(px - x, py - y) / radius, 0, 1);
          if (falloff <= 0) continue;
          const index = row * COLS + col;
          const target = lerp(ROUTE_MIN_THICKNESS, minimum, smoothstep(falloff));
          this.thickness[index] = Math.max(this.thickness[index], target);
          if (this.thickness[index] >= FALL_THICKNESS) this.water[index] = 0;
        }
      }
    }

    stampRoute(points, minimum = 0.5, radius = 34) {
      for (let index = 1; index < points.length; index += 1) {
        const a = points[index - 1];
        const b = points[index];
        const length = distance(a, b);
        const steps = Math.max(1, Math.ceil(length / 12));
        for (let step = 0; step <= steps; step += 1) {
          const t = step / steps;
          this.stampSafe(lerp(a.x, b.x, t), lerp(a.y, b.y, t), radius, minimum);
        }
      }
    }

    smoothPath(points, iterations = 2) {
      let path = points.map((point) => ({ x: point.x, y: point.y }));
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        const next = [path[0]];
        for (let index = 0; index < path.length - 1; index += 1) {
          const a = path[index];
          const b = path[index + 1];
          next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
          next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
        }
        next.push(path[path.length - 1]);
        path = next;
      }
      return path;
    }

    findPath(start, end) {
      const startCol = clamp(Math.floor(start.x / TILE), 0, COLS - 1);
      const startRow = clamp(Math.floor(start.y / TILE), 0, ROWS - 1);
      const endCol = clamp(Math.floor(end.x / TILE), 0, COLS - 1);
      const endRow = clamp(Math.floor(end.y / TILE), 0, ROWS - 1);
      const startIndex = startRow * COLS + startCol;
      const endIndex = endRow * COLS + endCol;
      const total = COLS * ROWS;
      const gScore = new Float64Array(total);
      gScore.fill(Infinity);
      gScore[startIndex] = 0;
      const cameFrom = new Int32Array(total);
      cameFrom.fill(-1);
      const closed = new Uint8Array(total);
      const open = new MinHeap();
      open.push({
        index: startIndex,
        priority: Math.hypot(endCol - startCol, endRow - startRow),
      });
      const neighbors = [
        [1, 0], [-1, 0], [0, 1], [0, -1],
        [1, 1], [1, -1], [-1, 1], [-1, -1],
      ];

      while (open.size) {
        const node = open.pop();
        if (closed[node.index]) continue;
        if (node.index === endIndex) {
          const path = [];
          let current = endIndex;
          while (current !== -1) {
            path.push({
              x: (current % COLS) * TILE + TILE / 2,
              y: Math.floor(current / COLS) * TILE + TILE / 2,
            });
            current = cameFrom[current];
          }
          path.reverse();
          path[0] = { x: start.x, y: start.y };
          path[path.length - 1] = { x: end.x, y: end.y };
          return path;
        }
        closed[node.index] = 1;
        const col = node.index % COLS;
        const row = Math.floor(node.index / COLS);
        for (const [dc, dr] of neighbors) {
          const nextCol = col + dc;
          const nextRow = row + dr;
          if (nextCol < 0 || nextRow < 0 || nextCol >= COLS || nextRow >= ROWS) continue;
          const nextIndex = nextRow * COLS + nextCol;
          if (closed[nextIndex]) continue;
          const thickness = this.thickness[nextIndex];
          if (thickness < ROUTE_MIN_THICKNESS) continue;
          if (dc !== 0 && dr !== 0) {
            const sideA = this.thickness[row * COLS + nextCol];
            const sideB = this.thickness[nextRow * COLS + col];
            if (sideA < ROUTE_MIN_THICKNESS || sideB < ROUTE_MIN_THICKNESS) continue;
          }
          const stepCost = dc !== 0 && dr !== 0 ? 1.414 : 1;
          const penalty = Math.max(0, 0.57 - thickness) * 13;
          const tentative = gScore[node.index] + stepCost + penalty;
          if (tentative >= gScore[nextIndex]) continue;
          cameFrom[nextIndex] = node.index;
          gScore[nextIndex] = tentative;
          const heuristic = Math.hypot(endCol - nextCol, endRow - nextRow);
          open.push({ index: nextIndex, priority: tentative + heuristic * 0.998 });
        }
      }
      return null;
    }

    isRouteViable(points, margin = 10) {
      if (!points || points.length < 2) return false;
      for (let index = 1; index < points.length; index += 1) {
        const a = points[index - 1];
        const b = points[index];
        const length = distance(a, b);
        const dx = (b.x - a.x) / Math.max(1, length);
        const dy = (b.y - a.y) / Math.max(1, length);
        const steps = Math.max(1, Math.ceil(length / 9));
        for (let step = 0; step <= steps; step += 1) {
          const t = step / steps;
          const x = lerp(a.x, b.x, t);
          const y = lerp(a.y, b.y, t);
          if (
            this.thicknessAt(x, y) < FALL_THICKNESS + 0.09 ||
            this.thicknessAt(x - dy * margin, y + dx * margin) < FALL_THICKNESS + 0.03 ||
            this.thicknessAt(x + dy * margin, y - dx * margin) < FALL_THICKNESS + 0.03
          ) {
            return false;
          }
        }
      }
      return true;
    }

    tileIndexAt(x, y) {
      const col = clamp(Math.floor(x / TILE), 0, COLS - 1);
      const row = clamp(Math.floor(y / TILE), 0, ROWS - 1);
      return row * COLS + col;
    }

    thicknessAt(x, y) {
      const gridX = clamp(x / TILE - 0.5, 0, COLS - 1);
      const gridY = clamp(y / TILE - 0.5, 0, ROWS - 1);
      const col = Math.floor(gridX);
      const row = Math.floor(gridY);
      const nextCol = Math.min(COLS - 1, col + 1);
      const nextRow = Math.min(ROWS - 1, row + 1);
      const tx = gridX - col;
      const ty = gridY - row;
      const a = this.thickness[row * COLS + col];
      const b = this.thickness[row * COLS + nextCol];
      const c = this.thickness[nextRow * COLS + col];
      const d = this.thickness[nextRow * COLS + nextCol];
      return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
    }

    wearAt(x, y, amount) {
      const index = this.tileIndexAt(x, y);
      const next = Math.max(0.045, this.thickness[index] - amount);
      this.thickness[index] = next;
      if (next < FALL_THICKNESS) this.water[index] = 1;
    }

    pathLength(points) {
      let total = 0;
      for (let index = 1; index < points.length; index += 1) {
        total += distance(points[index - 1], points[index]);
      }
      return total;
    }
  }

  class Simulation {
    constructor(options = {}) {
      this.seed = Number(options.seed ?? 20261114) >>> 0;
      this.world = new IceWorld(this.seed);
      this.maxCores = MAX_CORES;
      this.rng = mulberry32(this.seed ^ 0x5eed5eed);
      this.vehicle = {
        x: this.world.camp.x + 6,
        y: this.world.camp.y + 34,
        angle: -0.08,
        speed: 0,
        load: 0,
        oxygen: 100,
        hull: 100,
        odometer: 0,
        mass: BASE_MASS,
      };
      this.status = "ready";
      this.ending = null;
      this.endReason = null;
      this.time = 0;
      this.coresCollected = 0;
      this.coresDelivered = 0;
      this.coresDiscarded = 0;
      this.samplingCore = null;
      this.sampleProgress = 0;
      this.nearbyCore = null;
      this.maxLoad = 0;
      this.topSpeed = 0;
      this.damageTaken = 0;
      this.crackCount = 0;
      this.events = [];
      this.cracks = [];
      this.tracks = [];
      this.trackDistance = 0;
      this.lastTrack = null;
      this.crackCooldown = 0;
      this.discardHeld = false;
      this.hasLeftCamp = false;
      this.reachedCamp = false;
      this.routeVerified = this.world.routeViability.every(Boolean);
    }

    start() {
      if (this.status === "ready") {
        this.status = "playing";
        this.emit("start");
      }
      return this;
    }

    get mass() {
      return BASE_MASS + this.vehicle.load * CORE_MASS;
    }

    get speedKmh() {
      return Math.round(Math.abs(this.vehicle.speed) * 0.42);
    }

    get distanceFromCamp() {
      return distance(this.vehicle, this.world.camp);
    }

    get coreProgress() {
      return this.coresCollected / MAX_CORES;
    }

    emit(type, payload = {}) {
      this.events.push({ type, ...payload });
    }

    drainEvents() {
      const events = this.events;
      this.events = [];
      return events;
    }

    discardSample() {
      if (this.status !== "playing" || this.vehicle.load <= 0) return false;
      this.vehicle.load -= 1;
      this.coresDiscarded += 1;
      this.vehicle.mass = this.mass;
      this.emit("discard", {
        load: this.vehicle.load,
        mass: this.vehicle.mass,
      });
      this.addTrackFracture(0.68);
      return true;
    }

    nearbySample() {
      let nearest = null;
      let nearestDistance = Infinity;
      for (const core of this.world.cores) {
        if (core.collected) continue;
        const gap = distance(this.vehicle, core);
        if (gap < 84 && gap < nearestDistance) {
          nearest = core;
          nearestDistance = gap;
        }
      }
      return nearest;
    }

    startSample() {
      const core = this.nearbySample();
      if (!core || Math.abs(this.vehicle.speed) > 18) {
        this.samplingCore = null;
        this.sampleProgress = 0;
        return false;
      }
      this.samplingCore = core;
      return true;
    }

    update(dt, input = {}) {
      if (this.status !== "playing") return this;
      const frame = clamp(Number(dt) || 0, 0, 0.12);
      if (input.discard && !this.discardHeld) this.discardSample();
      this.discardHeld = Boolean(input.discard);
      const steps = Math.max(1, Math.ceil(frame / (1 / 70)));
      const step = frame / steps;
      for (let index = 0; index < steps && this.status === "playing"; index += 1) {
        this.step(step, input);
      }
      return this;
    }

    step(dt, input) {
      this.time += dt;
      this.nearbyCore = this.nearbySample();
      const load = this.vehicle.load;
      const speedNorm = clamp(Math.abs(this.vehicle.speed) / MAX_SPEED, 0, 1);

      if (input.sample && this.nearbyCore && Math.abs(this.vehicle.speed) < 18) {
        if (this.samplingCore !== this.nearbyCore) this.sampleProgress = 0;
        this.samplingCore = this.nearbyCore;
        this.sampleProgress += dt;
        this.vehicle.speed *= Math.exp(-5.5 * dt);
        if (this.sampleProgress >= SAMPLE_TIME) this.completeSample();
      } else {
        if (!input.sample) this.sampleProgress = Math.max(0, this.sampleProgress - dt * 2.8);
        this.samplingCore = this.nearbyCore;
      }

      const maxForward = MAX_SPEED - load * 13;
      const acceleration = 112 - load * 4.5;
      if (this.samplingCore && input.sample) {
        this.vehicle.speed *= Math.exp(-4 * dt);
      } else {
        if (input.up) this.vehicle.speed += acceleration * dt;
        if (input.down) this.vehicle.speed -= (this.vehicle.speed > 2 ? 185 : 96) * dt;
        if (!input.up && !input.down) {
          this.vehicle.speed *= Math.exp(-(0.36 + load * 0.035) * dt);
        }
      }
      this.vehicle.speed = clamp(this.vehicle.speed, -74, maxForward);
      if (Math.abs(this.vehicle.speed) < 0.35 && !input.up && !input.down) this.vehicle.speed = 0;

      const moving = Math.abs(this.vehicle.speed);
      const steerAuthority = 0.4 + 0.8 * clamp(moving / 82, 0, 1);
      const turning = input.left ? -1 : input.right ? 1 : 0;
      if (turning) {
        const direction = this.vehicle.speed < -0.5 ? -1 : 1;
        this.vehicle.angle += turning * steerAuthority * 1.42 * dt * direction;
      }

      const previousX = this.vehicle.x;
      const previousY = this.vehicle.y;
      this.vehicle.x += Math.cos(this.vehicle.angle) * this.vehicle.speed * dt;
      this.vehicle.y += Math.sin(this.vehicle.angle) * this.vehicle.speed * dt;
      const moved = Math.hypot(this.vehicle.x - previousX, this.vehicle.y - previousY);
      this.vehicle.odometer += moved;
      this.trackDistance += moved;
      this.topSpeed = Math.max(this.topSpeed, this.speedKmh);

      if (this.vehicle.x < 38 || this.vehicle.x > this.world.width - 38) {
        this.vehicle.x = clamp(this.vehicle.x, 38, this.world.width - 38);
        this.vehicle.speed *= -0.24;
      }
      if (this.vehicle.y < 38 || this.vehicle.y > this.world.height - 38) {
        this.vehicle.y = clamp(this.vehicle.y, 38, this.world.height - 38);
        this.vehicle.speed *= -0.24;
      }
      if (this.distanceFromCamp > 160) this.hasLeftCamp = true;

      const thickness = this.world.thicknessAt(this.vehicle.x, this.vehicle.y);
      const thinness = clamp((0.6 - thickness) / 0.42, 0, 1.35);
      const velocityPressure = 0.16 + Math.pow(speedNorm, 1.72) * 1.38;
      const loadPressure = 1 + load * 0.23;
      const stress = thinness * velocityPressure * loadPressure;

      this.vehicle.oxygen -= (0.095 + speedNorm * 0.185 + load * 0.012) * dt;
      this.vehicle.oxygen = Math.max(0, this.vehicle.oxygen);
      if (stress > 0.02) {
        const damage = stress * 0.62 * dt;
        this.vehicle.hull -= damage;
        this.damageTaken += damage;
      }
      this.vehicle.hull = Math.max(0, this.vehicle.hull);
      this.vehicle.mass = this.mass;

      const trackPressure = (0.00024 + speedNorm * speedNorm * 0.00082) * loadPressure;
      const sideX = Math.cos(this.vehicle.angle + Math.PI / 2) * 15;
      const sideY = Math.sin(this.vehicle.angle + Math.PI / 2) * 15;
      if (moving > 3) {
        this.world.wearAt(this.vehicle.x - sideX, this.vehicle.y - sideY, trackPressure * dt);
        this.world.wearAt(this.vehicle.x + sideX, this.vehicle.y + sideY, trackPressure * dt);
      }

      this.updateTracks();
      this.crackCooldown = Math.max(0, this.crackCooldown - dt);
      if (this.crackCooldown === 0 && speedNorm > 0.16 && thinness > 0.12) {
        const chance = 0.28 + thinness * speedNorm * 1.9;
        if (this.rng() < chance) {
          this.addTrackFracture(clamp(0.22 + thinness * speedNorm, 0.2, 1));
          this.emit("crack", { intensity: clamp(0.3 + thinness + speedNorm * 0.4, 0.3, 1) });
          this.crackCooldown = 0.3 + this.rng() * 0.55;
        }
      }

      if (this.vehicle.oxygen <= 0) this.fail("oxygen");
      else if (this.vehicle.hull <= 0) this.fail("hull");
      else if (this.world.thicknessAt(this.vehicle.x, this.vehicle.y) < FALL_THICKNESS) this.fail("fell");
      else if (this.coresCollected >= MAX_CORES && distance(this.vehicle, this.world.camp) < this.world.camp.radius) {
        this.finishAtCamp();
      }
    }

    completeSample() {
      const core = this.samplingCore;
      if (!core || core.collected) {
        this.sampleProgress = 0;
        return;
      }
      core.collected = true;
      this.sampleProgress = 0;
      this.samplingCore = null;
      this.coresCollected += 1;
      this.vehicle.load += 1;
      this.maxLoad = Math.max(this.maxLoad, this.vehicle.load);
      this.vehicle.speed = Math.min(this.vehicle.speed, 2);
      this.vehicle.mass = this.mass;
      this.addTrackFracture(0.55);
      this.emit("sample", {
        core: core.id,
        name: core.name,
        load: this.vehicle.load,
        collected: this.coresCollected,
      });
      if (this.coresCollected === MAX_CORES) this.emit("all-samples");
    }

    finishAtCamp() {
      if (this.vehicle.load <= 0) {
        this.fail("empty");
        return;
      }
      this.coresDelivered = this.vehicle.load;
      this.status = "won";
      this.ending = this.coresDelivered === MAX_CORES ? "complete" : "evacuated";
      this.emit("win", {
        ending: this.ending,
        delivered: this.coresDelivered,
        discarded: this.coresDiscarded,
      });
    }

    fail(reason) {
      this.status = "lost";
      this.endReason = reason;
      this.emit("fail", { reason });
    }

    updateTracks() {
      const sideX = Math.cos(this.vehicle.angle + Math.PI / 2) * 15;
      const sideY = Math.sin(this.vehicle.angle + Math.PI / 2) * 15;
      const left = { x: this.vehicle.x - sideX, y: this.vehicle.y - sideY };
      const right = { x: this.vehicle.x + sideX, y: this.vehicle.y + sideY };
      if (!this.lastTrack) {
        this.lastTrack = { left, right };
        return;
      }
      if (this.trackDistance < 8) return;
      this.trackDistance = 0;
      const strength = 0.18 + clamp(Math.abs(this.vehicle.speed) / MAX_SPEED, 0, 1) * 0.2;
      this.tracks.push(
        { x1: this.lastTrack.left.x, y1: this.lastTrack.left.y, x2: left.x, y2: left.y, strength },
        { x1: this.lastTrack.right.x, y1: this.lastTrack.right.y, x2: right.x, y2: right.y, strength },
      );
      this.lastTrack = { left, right };
      if (this.tracks.length > 2600) this.tracks.splice(0, this.tracks.length - 2600);
    }

    addTrackFracture(intensity = 0.5) {
      const side = this.rng() < 0.5 ? -1 : 1;
      const origin = {
        x: this.vehicle.x + Math.cos(this.vehicle.angle + Math.PI / 2) * side * 17,
        y: this.vehicle.y + Math.sin(this.vehicle.angle + Math.PI / 2) * side * 17,
      };
      const angle = this.vehicle.angle + side * Math.PI * 0.5 + (this.rng() - 0.5) * 0.7;
      this.growCrack(origin, angle, clamp(intensity, 0.2, 1.35), 2);
    }

    growCrack(origin, angle, intensity, depth) {
      if (this.cracks.length >= 210) this.cracks.shift();
      const points = [{ x: origin.x, y: origin.y }];
      let x = origin.x;
      let y = origin.y;
      let heading = angle;
      const steps = 3 + Math.round(2 + this.rng() * 4 * intensity);
      for (let step = 0; step < steps; step += 1) {
        let bestTurn = 0;
        let bestScore = Infinity;
        for (const turn of [-0.42, -0.2, 0, 0.2, 0.42]) {
          const look = 17;
          const lookX = x + Math.cos(heading + turn) * look;
          const lookY = y + Math.sin(heading + turn) * look;
          const thickness = this.world.thicknessAt(lookX, lookY);
          const score = thickness + this.rng() * 0.16 + Math.abs(turn) * 0.07;
          if (score < bestScore) {
            bestScore = score;
            bestTurn = turn;
          }
        }
        if (this.rng() > 0.82) bestTurn = (this.rng() - 0.5) * 0.75;
        heading += bestTurn;
        const stepLength = (10 + this.rng() * 13) * (0.55 + intensity * 0.55);
        x += Math.cos(heading) * stepLength;
        y += Math.sin(heading) * stepLength;
        if (x < 2 || y < 2 || x > this.world.width - 2 || y > this.world.height - 2) break;
        points.push({ x, y });
        if (this.world.thicknessAt(x, y) < 0.055 || points.length >= 7) break;
      }
      if (points.length < 2) return;
      const crack = {
        points,
        width: 0.6 + intensity * 1.45,
        alpha: 0.48 + Math.min(0.38, intensity * 0.22),
        age: this.time,
        intensity,
      };
      this.cracks.push(crack);
      this.crackCount += 1;
      if (depth > 0 && points.length > 2 && this.rng() < 0.46) {
        const fork = points[1 + Math.floor(this.rng() * (points.length - 1))];
        const branchAngle = heading + (this.rng() < 0.5 ? -1 : 1) * (0.6 + this.rng() * 0.45);
        this.growCrack(fork, branchAngle, intensity * 0.7, depth - 1);
      }
    }

    getRisk() {
      const thickness = this.world.thicknessAt(this.vehicle.x, this.vehicle.y);
      const speedNorm = clamp(Math.abs(this.vehicle.speed) / MAX_SPEED, 0, 1);
      const thinness = clamp((0.62 - thickness) / 0.45, 0, 1);
      const score = thinness * (0.32 + speedNorm * 0.85) * (1 + this.vehicle.load * 0.18);
      let level = "stable";
      let label = "冰面稳定";
      if (thickness < 0.135 || score > 0.8) {
        level = "danger";
        label = thickness < 0.135 ? "冰层临界" : "结构过载";
      } else if (thickness < 0.3 || score > 0.38) {
        level = "caution";
        label = thickness < 0.3 ? "薄冰区" : "裂痕扩张";
      }
      return { thickness, thinness, score, level, label };
    }

    getSummary() {
      return {
        seed: this.seed,
        status: this.status,
        ending: this.ending,
        endReason: this.endReason,
        time: this.time,
        oxygen: this.vehicle.oxygen,
        hull: this.vehicle.hull,
        load: this.vehicle.load,
        collected: this.coresCollected,
        delivered: this.coresDelivered,
        discarded: this.coresDiscarded,
        mass: this.mass,
        distance: this.vehicle.odometer,
        topSpeed: this.topSpeed,
        cracks: this.crackCount,
        routeVerified: this.routeVerified,
        routeLengths: this.world.routes.map((route) => this.world.pathLength(route)),
      };
    }
  }

  return {
    IceWorld,
    Simulation,
    constants: {
      TILE,
      COLS,
      ROWS,
      WIDTH,
      HEIGHT,
      ROUTE_MIN_THICKNESS,
      FALL_THICKNESS,
      BASE_MASS,
      CORE_MASS,
      MAX_CORES,
      MAX_SPEED,
      SAMPLE_TIME,
    },
    utilities: { clamp, lerp, distance, normalizeAngle, mulberry32 },
  };
});
