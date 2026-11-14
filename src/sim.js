import { createMap, centerAt, snowAt, slopeAt, validateReachable } from './map.js';

export const FIXED_DT = 1 / 60;
export const PLOW_MAX_SPEED = 330; // px/s
export const RESCUE_SPEED_LIMIT = 130; // 接触救援时的速度上限

const PLOW_HALF_WIDTH = 16;
const PLOW_HALF_LENGTH = 24;
const OFFROAD_GRIP = 0.34;

export function createSimulation({ seed, autopilot = false } = {}) {
  const map = createMap(seed);
  const reach = validateReachable(map);
  if (!reach.ok) {
    throw new Error(`地图不可达: ${reach.errors.join('; ')}`);
  }

  const state = {
    time: 0,
    map,
    autopilot,
    plow: {
      x: map.centerX[0],
      y: 40,
      vx: 0,
      vy: 24,
      heading: 0, // 朝向道路上方（+y 方向），正值向右偏
      durability: 100,
      load: 0, // 已挂载的受困车辆数
      braking: false,
      plowing: 0,
      offroad: false,
    },
    rocks: [],
    tracks: [],
    rescued: 0,
    convoy: [], // 已救援车辆跟随链
    closureY: -260, // 暴风雪封闭前沿，从道路起点向上推进
    closureDelay: 11,
    closureSpeed: 152,
    wind: 8,
    status: 'running', // running | won | failed
    failReason: null,
    collisions: 0,
    maxLateralSpeed: 0,
    slipTime: 0,
    events: [],
  };
  return state;
}

function massOf(plow) {
  return 1 + plow.load * 0.45;
}

function engineForce(input, plow, snow) {
  if (input.throttle) return 620 / massOf(plow);
  if (input.brake) return -760 / massOf(plow);
  return 70 * (0.55 + snow) / massOf(plow); // 松油门后的滑行阻力（沿 -y 为正向加速）
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function lateralState(state) {
  const { plow, map } = state;
  const cx = centerAt(map, plow.y);
  const offset = plow.x - cx;
  const edge = map.roadWidth / 2;
  return { cx, offset, edge, offroad: Math.abs(offset) > edge };
}

export function step(state, input) {
  if (state.status !== 'running') return state;
  const dt = FIXED_DT;
  const { plow, map } = state;
  state.time += dt;
  state.wind = 8 + 6 * Math.sin(state.time * 0.7) + 4 * Math.sin(state.time * 2.3);

  const snow = snowAt(map, plow.y);
  const slopeAccel = slopeAt(map, plow.y);
  const lat = lateralState(state);
  plow.offroad = lat.offroad;

  // ---- 纵向动力学：惯性、引擎/刹车、铲雪阻力（深雪更慢）----
  const plowDrag = 150 * snow + 90 * snow * snow;
  plow.plowing = snow;
  let ay = engineForce(input, plow, snow) - plowDrag / massOf(plow);
  plow.braking = !!input.brake;

  // ---- 转向：低速转向弱，高速有惯性；航向 0 朝前进方向（+y），正值向右 ----
  const speed = Math.hypot(plow.vx, plow.vy);
  const steerStrength = 2.1 * Math.min(1, speed / 70);
  if (input.steer !== 0) {
    plow.heading += input.steer * steerStrength * dt * (input.brake ? 0.7 : 1);
  }
  plow.heading = clamp(plow.heading, -1.25, 1.25);

  // ---- 横向动力学：侧坡推力 + 轮胎抓地（积雪/路外降低抓地）----
  const gripBase = lat.offroad ? OFFROAD_GRIP : 1.05 - snow * 0.28;
  const grip = gripBase * (1 - plow.load * 0.06);
  // 车头沿 +y 前进：h=0 时前向量 (0,1)、右向量 (1,0)，两向量严格正交
  const h = plow.heading;
  const hx = Math.sin(h);
  const hy = Math.cos(h);
  const rightX = Math.cos(h);
  const rightY = -Math.sin(h);

  // 分解为纵向/横向速度
  let vLong = plow.vx * hx + plow.vy * hy;
  let vLat = plow.vx * rightX + plow.vy * rightY;

  // 纵向：引擎、刹车、铲雪阻力直接作用在车头方向
  vLong += ay * dt;
  if (vLong < 0) vLong = 0; // 不允许倒车
  const speedCap = PLOW_MAX_SPEED + plow.load * 18;
  vLong = Math.min(vLong, speedCap);

  // 横向：侧坡持续推挤，轮胎抓地让横向速度指数衰减
  const slopeLat = slopeAccel; // 坡面方向与车体右侧基本一致
  vLat += slopeLat * dt;
  vLat *= Math.exp(-grip * 3.2 * dt);

  plow.vx = hx * vLong + rightX * vLat;
  plow.vy = hy * vLong + rightY * vLat;

  plow.x += plow.vx * dt;
  plow.y += plow.vy * dt;
  plow.y = Math.min(plow.y, map.length - 2);

  state.maxLateralSpeed = Math.max(state.maxLateralSpeed, Math.abs(plow.vx));

  handleWalls(state, dt);
  handleRocks(state, dt);
  handleRescue(state);
  handleClosure(state, dt);
  recordTracks(state);
  updateConvoy(state, dt);
  checkFailureAndWin(state);
  return state;
}

function handleWalls(state, dt) {
  const { plow, map } = state;
  for (const wall of map.walls) {
    if (wall.hitCooldown > 0) wall.hitCooldown -= dt;
    const dy = plow.y - wall.y;
    if (Math.abs(dy) > PLOW_HALF_LENGTH + 8) continue;
    const cx = centerAt(map, wall.y);
    const rel = plow.x - cx;
    const inGap = rel > wall.gapLeft + PLOW_HALF_WIDTH &&
      rel < wall.gapRight - PLOW_HALF_WIDTH;
    if (!inGap && wall.hitCooldown <= 0) {
      plow.durability = Math.max(0, plow.durability - wall.damage);
      plow.vy *= 0.18;
      plow.vx += (rel < (wall.gapLeft + wall.gapRight) / 2 ? -1 : 1) * 90;
      wall.hitCooldown = 0.8;
      state.collisions += 1;
      state.events.push({ type: 'wall', t: state.time, y: wall.y });
    }
  }
}

function handleRocks(state, dt) {
  const { plow, map } = state;
  for (const evt of map.rockEvents) {
    if (!evt.fired && state.time >= evt.t) {
      evt.fired = true;
      const fromLeft = evt.vx >= 0;
      state.rocks.push({
        x: centerAt(map, evt.y) + (fromLeft ? -map.roadWidth / 2 - 30 : map.roadWidth / 2 + 30),
        y: evt.y,
        vx: evt.vx || (fromLeft ? 120 : -120),
        vy: -30,
        radius: 13,
        damage: 12,
      });
      state.events.push({ type: 'rockSpawn', t: state.time, y: evt.y });
    }
  }
  for (const rock of state.rocks) {
    if (rock.dead) continue;
    rock.x += rock.vx * dt;
    rock.y += rock.vy * dt;
    rock.vy += 26 * dt;
    const dx = rock.x - plow.x;
    const dy = rock.y - plow.y;
    if (Math.hypot(dx, dy) < rock.radius + PLOW_HALF_WIDTH) {
      plow.durability = Math.max(0, plow.durability - rock.damage);
      plow.vx += Math.sign(dx || 1) * 130;
      plow.vy *= 0.72;
      rock.dead = true;
      state.collisions += 1;
      state.events.push({ type: 'rockHit', t: state.time, y: plow.y });
    }
    if (Math.abs(rock.x - centerAt(map, rock.y)) > map.roadWidth / 2 + 60 ||
      rock.y < 0 || rock.y > map.length) {
      rock.dead = true;
    }
  }
  state.rocks = state.rocks.filter((r) => !r.dead);
}

function handleRescue(state) {
  const { plow, map } = state;
  for (const car of map.stranded) {
    if (car.rescued) continue;
    if (car.ramCooldown > 0) car.ramCooldown = Math.max(0, car.ramCooldown - FIXED_DT);
    const dx = car.x - plow.x;
    const dy = car.y - plow.y;
    if (Math.hypot(dx, dy) < 40) {
      if (plow.vy > RESCUE_SPEED_LIMIT) {
        // 高速冲撞受困车辆：双方受损，不算救援
        plow.durability = Math.max(0, plow.durability - 10);
        plow.vy *= 0.5;
        car.ramCooldown = 1;
        state.events.push({ type: 'ram', t: state.time, y: car.y });
        continue;
      }
      if (car.ramCooldown > 0) continue;
      car.rescued = true;
      plow.load += 1;
      state.rescued += 1;
      state.convoy.push({ x: car.x, y: car.y, anchor: car, targetIndex: state.convoy.length });
      state.events.push({ type: 'rescue', t: state.time, y: car.y, load: plow.load });
    }
  }
}

function handleClosure(state, dt) {
  if (state.time < state.closureDelay) return;
  state.closureY += state.closureSpeed * dt;
  if (state.closureY > state.plow.y + PLOW_HALF_LENGTH) {
    state.status = 'failed';
    state.failReason = 'blizzard'; // 道路被暴风雪完全封闭
  }
}

function recordTracks(state) {
  const { plow, tracks } = state;
  const last = tracks[tracks.length - 1];
  if (!last || Math.hypot(plow.x - last.x, plow.y - last.y) > 14) {
    tracks.push({ x: plow.x, y: plow.y, t: state.time });
    if (tracks.length > 600) tracks.shift();
  }
}

function updateConvoy(state, dt) {
  const { plow, convoy, map } = state;
  let leader = { x: plow.x, y: plow.y };
  const gap = 52;
  for (const car of convoy) {
    const dx = leader.x - car.x;
    const dy = leader.y - car.y;
    const d = Math.hypot(dx, dy) || 1;
    const want = gap + 12 * state.plow.load;
    if (d > want) {
      car.x += (dx / d) * (d - want) * Math.min(1, 5 * dt);
      car.y += (dy / d) * (d - want) * Math.min(1, 5 * dt);
    }
    car.x += (centerAt(map, car.y) - car.x) * 0.25 * dt;
    leader = car;
  }
}

function checkFailureAndWin(state) {
  const { plow } = state;
  if (state.status !== 'running') return;
  if (plow.durability <= 0) {
    state.status = 'failed';
    state.failReason = 'durability';
    return;
  }
  // 侧滑失控：横向速度持续过大且冲到路外
  if (state.time > 2 && Math.abs(plow.vx) > 175 && plow.offroad) {
    state.slipTime += FIXED_DT;
  } else {
    state.slipTime = Math.max(0, state.slipTime - FIXED_DT * 0.5);
  }
  if (state.slipTime > 0.55) {
    state.status = 'failed';
    state.failReason = 'skid';
    return;
  }
  if (plow.y >= state.map.length - 4 && state.rescued === state.map.stranded.length) {
    state.status = 'won';
  }
}

// 刹车距离指标：载荷越大、积雪越深，制动距离越长
export function brakingDistance(load, snow = 0.4, initialSpeed = 260) {
  const decel = 760 / (1 + load * 0.45) + (150 * snow + 90 * snow * snow) / (1 + load * 0.45);
  return (initialSpeed * initialSpeed) / (2 * decel);
}
