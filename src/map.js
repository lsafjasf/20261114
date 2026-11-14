import { mulberry32, range, intRange } from './rng.js';

export const ROAD_WIDTH = 230;
export const TRACK_LENGTH = 5600;
export const DEFAULT_SEED = 20261114;

// 由 seed 生成山口道路：弯曲中心线、侧坡、积雪、冰墙、受困车辆、落石事件
export function createMap(seed = DEFAULT_SEED) {
  const rng = mulberry32(seed);
  const centerX = new Float32Array(TRACK_LENGTH + 1);
  const snowDepth = new Float32Array(TRACK_LENGTH + 1);
  const slope = new Float32Array(TRACK_LENGTH + 1);

  const rngA = mulberry32(seed ^ 0x9e3779b9);
  let drift = 0;
  for (let y = 0; y <= TRACK_LENGTH; y++) {
    drift += range(rngA, -0.55, 0.55);
    drift = Math.max(-46, Math.min(46, drift));
    const curve =
      70 * Math.sin(y * 0.0042 + 1.3) +
      48 * Math.sin(y * 0.0017 + 4.1) +
      22 * Math.sin(y * 0.009);
    centerX[y] = 480 + curve + drift;
  }

  // 侧坡带：正号向右推、负号向左推；包含一段强侧坡（侧滑验收用）
  const slopeBands = [];
  let cursor = 500;
  while (cursor < TRACK_LENGTH - 400) {
    const start = cursor + intRange(rng, 60, 220);
    const length = intRange(rng, 220, 460);
    const end = Math.min(start + length, TRACK_LENGTH - 200);
    const accel = (rng() < 0.5 ? -1 : 1) * range(rng, 26, 62);
    slopeBands.push({ start, end, accel });
    cursor = end;
  }
  slopeBands.push({ start: 3050, end: 3450, accel: 118 });
  for (const band of slopeBands) {
    for (let y = band.start; y < band.end && y <= TRACK_LENGTH; y++) {
      slope[y] = band.accel;
    }
  }

  // 积雪深度：普通薄雪 + 随机深雪堆（铲雪阻力的来源）
  for (let y = 0; y <= TRACK_LENGTH; y++) {
    snowDepth[y] = 0.32 + 0.1 * Math.sin(y * 0.05) + rng() * 0.12;
  }
  const drifts = [];
  for (let i = 0; i < 26; i++) {
    const y = intRange(rng, 350, TRACK_LENGTH - 500);
    const halfWidth = range(rng, 34, 78);
    const offset = range(rng, -ROAD_WIDTH * 0.28, ROAD_WIDTH * 0.28);
    const depth = range(rng, 0.9, 1.6);
    drifts.push({ y, halfWidth, offset, depth });
    for (let yy = y - 40; yy <= y + 40; yy++) {
      if (yy < 0 || yy > TRACK_LENGTH) continue;
      const falloff = Math.max(0, 1 - Math.abs(yy - y) / 42);
      snowDepth[yy] = Math.max(snowDepth[yy], 0.4 + depth * falloff);
    }
  }

  // 冰墙：静态障碍，撞击扣耐久；始终留出可通过缺口
  const walls = [];
  const strandedYs = [1450, 3150, 5050];
  for (let i = 0; i < 12; i++) {
    let y = 700 + i * 380 + intRange(rng, -60, 60);
    let guard = 0;
    while (strandedYs.some((sy) => Math.abs(sy - y) < 140) && guard < 12) {
      y += 170;
      guard += 1;
    }
    const gapWidth = range(rng, 92, 118);
    const minGapLeft = -ROAD_WIDTH / 2 + 22;
    const maxGapLeft = ROAD_WIDTH / 2 - 22 - gapWidth;
    const gapLeft = range(rng, minGapLeft, maxGapLeft);
    walls.push({
      y,
      gapLeft,
      gapRight: gapLeft + gapWidth,
      damage: intRange(rng, 14, 22),
      hitCooldown: 0,
    });
  }

  // 三辆受困车辆，沿道路递增布置，全部位于路面内
  const stranded = [1450, 3150, 5050].map((y, i) => ({
    y,
    x: centerX[y] + [ -28, 34, -18 ][i],
    rescued: false,
    rescueIndex: i,
  }));

  // 落石事件：seed 固定，事件在仿真时间点触发
  const rockEvents = [];
  for (let i = 0; i < 10; i++) {
    rockEvents.push({
      t: 6 + i * 4.2 + range(rng, 0, 1.4),
      y: 900 + i * 430 + intRange(rng, -80, 80),
      vx: range(rng, -60, 60),
      fired: false,
    });
  }

  return {
    seed,
    roadWidth: ROAD_WIDTH,
    length: TRACK_LENGTH,
    centerX,
    snowDepth,
    slope,
    slopeBands,
    drifts,
    walls,
    stranded,
    rockEvents,
  };
}

export function centerAt(map, y) {
  const yy = Math.max(0, Math.min(map.length, Math.round(y)));
  return map.centerX[yy];
}

export function snowAt(map, y) {
  const yy = Math.max(0, Math.min(map.length, Math.round(y)));
  return map.snowDepth[yy];
}

export function slopeAt(map, y) {
  const yy = Math.max(0, Math.min(map.length, Math.round(y)));
  return map.slope[yy];
}

// 可达性校验：道路上的每个冰墙缺口都覆盖在路面范围内
export function validateReachable(map) {
  const errors = [];
  for (const wall of map.walls) {
    const cx = centerAt(map, wall.y);
    const left = cx - map.roadWidth / 2;
    const right = cx + map.roadWidth / 2;
    if (wall.gapLeft < -map.roadWidth / 2 + 14) {
      errors.push(`冰墙 y=${wall.y} 缺口超出左路缘`);
    }
    if (wall.gapRight > map.roadWidth / 2 - 14) {
      errors.push(`冰墙 y=${wall.y} 缺口超出右路缘`);
    }
    if (wall.gapRight - wall.gapLeft < 70) {
      errors.push(`冰墙 y=${wall.y} 缺口过窄`);
    }
    for (const car of map.stranded) {
      if (Math.abs(car.y - wall.y) < 90) {
        errors.push(`冰墙 y=${wall.y} 与受困车辆 y=${car.y} 冲突`);
      }
    }
    if (cx + wall.gapLeft < left || cx + wall.gapRight > right) {
      errors.push(`冰墙 y=${wall.y} 缺口未落在路面内`);
    }
  }
  for (const car of map.stranded) {
    if (Math.abs(car.x - centerAt(map, car.y)) > map.roadWidth / 2 - 30) {
      errors.push(`受困车辆 y=${car.y} 不在路面内`);
    }
  }
  return { ok: errors.length === 0, errors };
}
