export const WORLD = Object.freeze({
  width: 1600,
  height: 1000,
  margin: 42,
  startTide: 0.16,
  highTide: 0.96,
  floodSeconds: 96,
  missionSeconds: 112
});

const SHOAL_BLUEPRINTS = [
  { id: "north-west", x: 640, y: 335, rx: 490, ry: 54, rot: -0.035, growth: 0.62, tone: 0 },
  { id: "north-east", x: 1490, y: 335, rx: 112, ry: 78, rot: 0.14, growth: 0.62, tone: 1 },
  { id: "mussel-bank", x: 635, y: 430, rx: 105, ry: 68, rot: -0.32, growth: 0.3, tone: 2 },
  { id: "sand-bar", x: 410, y: 620, rx: 82, ry: 44, rot: 0.24, growth: 0.22, tone: 1 },
  { id: "eel-bank", x: 1018, y: 635, rx: 66, ry: 104, rot: -0.17, growth: 0.26, tone: 0 },
  { id: "west-reef", x: 266, y: 321, rx: 72, ry: 88, rot: 0.2, growth: 0.18, tone: 2 },
  { id: "south-bank", x: 690, y: 946, rx: 138, ry: 48, rot: 0.04, growth: 0.12, tone: 1 }
];

const ZONE_BLUEPRINTS = [
  { id: "A", name: "北湾站", x: 1035, y: 166, radius: 57, note: "优先布设" },
  { id: "B", name: "东堤站", x: 1462, y: 610, radius: 57, note: "外海通道" },
  { id: "C", name: "南滩站", x: 908, y: 818, radius: 57, note: "缓流区" }
];

const SAFE_SPINES = [
  [[430, 800], [560, 865], [900, 820], [1130, 785], [1350, 690], [1462, 610]],
  [[430, 800], [520, 880], [800, 880], [908, 818]],
  [[1180, 740], [1310, 650], [1390, 540], [1355, 420], [1320, 335], [1160, 210], [1035, 166]]
];

export function normalizeSeed(value) {
  if (value === undefined || value === null || value === "") return 20261114;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return Number(text) >>> 0;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function range(random, min, max) {
  return min + (max - min) * random();
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSquared = abx * abx + aby * aby;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lengthSquared));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

function distanceToSpines(x, y) {
  let closest = Infinity;
  for (const spine of SAFE_SPINES) {
    for (let index = 1; index < spine.length; index += 1) {
      const [ax, ay] = spine[index - 1];
      const [bx, by] = spine[index];
      closest = Math.min(closest, distanceToSegment(x, y, ax, ay, bx, by));
    }
  }
  return closest;
}

function makeShoal(blueprint, random, index) {
  const jitter = index < 2 ? 7 : 15;
  const shoal = {
    ...blueprint,
    x: blueprint.x + range(random, -jitter, jitter),
    y: blueprint.y + range(random, -jitter, jitter),
    rx: blueprint.rx + range(random, -7, 7),
    ry: blueprint.ry + range(random, -5, 5),
    rot: blueprint.rot + range(random, -0.05, 0.05),
    wobble: Array.from({ length: 28 }, () => range(random, 0.94, 1.06)),
    seed: Math.floor(random() * 4294967296)
  };
  return shoal;
}

function makeZones(random) {
  return ZONE_BLUEPRINTS.map((zone, index) => ({
    ...zone,
    x: zone.x + range(random, -8, 8),
    y: zone.y + range(random, -6, 6),
    status: "pending",
    deployedAt: null,
    buoyPhase: range(random, 0, Math.PI * 2),
    index
  }));
}

function makeDriftwood(random, world) {
  const logs = [];
  let attempts = 0;
  while (logs.length < 13 && attempts < 400) {
    attempts += 1;
    const x = range(random, 110, 1510);
    const y = range(random, 120, 900);
    const radius = range(random, 15, 28);
    const nearZone = world.zones.some((zone) => Math.hypot(x - zone.x, y - zone.y) < zone.radius + 55);
    const nearStart = Math.hypot(x - world.start.x, y - world.start.y) < 100;
    const nearSpine = distanceToSpines(x, y) < radius + 38;
    const inShoal = isPointInShoal(world, x, y, WORLD.startTide, 24);
    if (nearZone || nearStart || nearSpine || inShoal) continue;
    logs.push({
      x,
      y,
      radius,
      length: range(random, 34, 66),
      angle: range(random, 0, Math.PI * 2),
      branch: range(random, -0.7, 0.7),
      drift: range(random, -1, 1)
    });
  }
  return logs;
}

export function generateWorld(seedInput = 20261114) {
  const seed = normalizeSeed(seedInput);
  const random = mulberry32(seed);
  const world = {
    seed,
    seedLabel: String(seed).slice(-8).toUpperCase(),
    width: WORLD.width,
    height: WORLD.height,
    start: { x: 430 + range(random, -5, 5), y: 800 + range(random, -5, 5), heading: -0.25 },
    zones: makeZones(random),
    shoals: SHOAL_BLUEPRINTS.map((shoal, index) => makeShoal(shoal, random, index)),
    logs: [],
    deco: {
      waveOffset: range(random, 0, 40),
      shoreSeed: Math.floor(random() * 100000),
      channelGlow: range(random, 0, Math.PI * 2)
    }
  };
  world.logs = makeDriftwood(random, world);
  world.tideProfile = {
    start: WORLD.startTide + range(random, -0.006, 0.006),
    high: WORLD.highTide + range(random, -0.012, 0.012),
    floodSeconds: WORLD.floodSeconds + range(random, -4, 4)
  };
  return world;
}

export function tideAt(world, elapsedSeconds) {
  const profile = world.tideProfile || WORLD;
  const progress = Math.max(0, Math.min(1, elapsedSeconds / profile.floodSeconds));
  const eased = progress * progress * (3 - 2 * progress);
  return profile.start + (profile.high - profile.start) * eased;
}

export function shoalScale(shoal, tide) {
  return 0.94 + tide * (0.52 + shoal.growth * 0.35);
}

export function isPointInShoal(world, x, y, tide, margin = 0) {
  for (const shoal of world.shoals) {
    const scale = shoalScale(shoal, tide);
    const cos = Math.cos(shoal.rot);
    const sin = Math.sin(shoal.rot);
    const dx = x - shoal.x;
    const dy = y - shoal.y;
    const localX = dx * cos + dy * sin;
    const localY = -dx * sin + dy * cos;
    const rx = shoal.rx * scale + margin;
    const ry = shoal.ry * scale + margin;
    if ((localX * localX) / (rx * rx) + (localY * localY) / (ry * ry) <= 1) {
      return shoal;
    }
  }
  return null;
}

export function isOutsideBounds(x, y, margin = 0) {
  return x < WORLD.margin + margin || x > worldWidthMinusMargin(margin) || y < WORLD.margin + margin || y > worldHeightMinusMargin(margin);
}

function worldWidthMinusMargin(margin) {
  return WORLD.width - WORLD.margin - margin;
}

function worldHeightMinusMargin(margin) {
  return WORLD.height - WORLD.margin - margin;
}

export function northPassageOpen(world, tide) {
  const west = world.shoals.find((shoal) => shoal.id === "north-west");
  const east = world.shoals.find((shoal) => shoal.id === "north-east");
  const scale = shoalScale(west, tide);
  const sameScale = shoalScale(east, tide);
  const westEdge = west.x + west.rx * Math.max(scale, sameScale);
  const eastEdge = east.x - east.rx * Math.max(scale, sameScale);
  return eastEdge - westEdge > 24;
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
      if (items[parent].score <= node.score) break;
      items[index] = items[parent];
      index = parent;
    }
    items[index] = node;
  }

  pop() {
    const items = this.items;
    if (items.length === 0) return null;
    const root = items[0];
    const tail = items.pop();
    if (items.length === 0) return root;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= items.length) break;
      let child = left;
      if (right < items.length && items[right].score < items[left].score) child = right;
      if (items[child].score >= tail.score) break;
      items[index] = items[child];
      index = child;
    }
    items[index] = tail;
    return root;
  }
}

function cellBlocked(world, x, y, tide, margin) {
  return isOutsideBounds(x, y, margin) || Boolean(isPointInShoal(world, x, y, tide, margin));
}

function nearestOpenCell(world, x, y, tide, margin, grid) {
  if (!cellBlocked(world, x, y, tide, margin)) return { x, y };
  for (let radius = 1; radius <= 5; radius += 1) {
    for (let oy = -radius; oy <= radius; oy += 1) {
      for (let ox = -radius; ox <= radius; ox += 1) {
        if (Math.max(Math.abs(ox), Math.abs(oy)) !== radius) continue;
        const candidateX = x + ox * grid;
        const candidateY = y + oy * grid;
        if (!cellBlocked(world, candidateX, candidateY, tide, margin)) return { x: candidateX, y: candidateY };
      }
    }
  }
  return null;
}

function lineIsClear(world, start, goal, tide, margin) {
  const distance = Math.hypot(goal.x - start.x, goal.y - start.y);
  const steps = Math.max(1, Math.ceil(distance / 10));
  for (let index = 1; index < steps; index += 1) {
    const t = index / steps;
    const x = start.x + (goal.x - start.x) * t;
    const y = start.y + (goal.y - start.y) * t;
    if (cellBlocked(world, x, y, tide, margin)) return false;
  }
  return true;
}

function simplifyPath(world, points, tide, margin) {
  if (points.length < 3) return points;
  const simplified = [points[0]];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let next = points.length - 1;
    while (next > anchor + 1 && !lineIsClear(world, points[anchor], points[next], tide, margin)) {
      next -= 1;
    }
    simplified.push(points[next]);
    anchor = next;
  }
  return simplified;
}

export function findPath(world, start, goal, tide, options = {}) {
  const grid = options.grid || 16;
  const margin = options.margin ?? 17;
  const cols = Math.floor((WORLD.width - WORLD.margin * 2) / grid);
  const rows = Math.floor((WORLD.height - WORLD.margin * 2) / grid);
  const localX = (x) => x - WORLD.margin;
  const localY = (y) => y - WORLD.margin;
  const toCell = (x, y) => ({
    col: Math.max(0, Math.min(cols - 1, Math.round(localX(x) / grid))),
    row: Math.max(0, Math.min(rows - 1, Math.round(localY(y) / grid)))
  });
  const centerOf = (cell) => ({
    x: WORLD.margin + cell.col * grid,
    y: WORLD.margin + cell.row * grid
  });

  const snappedStart = nearestOpenCell(world, start.x, start.y, tide, margin, grid);
  const snappedGoal = nearestOpenCell(world, goal.x, goal.y, tide, margin, grid);
  if (!snappedStart || !snappedGoal) return null;
  const startCell = toCell(snappedStart.x, snappedStart.y);
  const goalCell = toCell(snappedGoal.x, snappedGoal.y);
  const keyOf = (cell) => cell.row * cols + cell.col;
  const startKey = keyOf(startCell);
  const goalKey = keyOf(goalCell);

  const open = new MinHeap();
  const best = new Map();
  const cameFrom = new Map();
  const startScore = Math.hypot(goalCell.col - startCell.col, goalCell.row - startCell.row);
  open.push({ ...startCell, key: startKey, cost: 0, score: startScore });
  best.set(startKey, 0);

  const directions = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]
  ];

  let found = false;
  let iterations = 0;
  while (open.items.length > 0 && iterations < 14000) {
    iterations += 1;
    const current = open.pop();
    const currentKey = current.key;
    if (current.cost > (best.get(currentKey) ?? Infinity)) continue;
    if (currentKey === goalKey) {
      found = true;
      break;
    }
    for (const [dx, dy, cost] of directions) {
      const col = current.col + dx;
      const row = current.row + dy;
      if (col < 0 || col >= cols || row < 0 || row >= rows) continue;
      const point = centerOf({ col, row });
      if (cellBlocked(world, point.x, point.y, tide, margin)) continue;
      if (dx !== 0 && dy !== 0) {
        const sideA = centerOf({ col: current.col + dx, row: current.row });
        const sideB = centerOf({ col: current.col, row: current.row + dy });
        if (cellBlocked(world, sideA.x, sideA.y, tide, margin) || cellBlocked(world, sideB.x, sideB.y, tide, margin)) {
          continue;
        }
      }
      const nextKey = row * cols + col;
      const nextCost = current.cost + cost;
      if (nextCost >= (best.get(nextKey) ?? Infinity)) continue;
      best.set(nextKey, nextCost);
      cameFrom.set(nextKey, currentKey);
      const heuristic = Math.hypot(goalCell.col - col, goalCell.row - row);
      open.push({ col, row, key: nextKey, cost: nextCost, score: nextCost + heuristic });
    }
  }

  if (!found) return null;
  const cells = [];
  let cursor = goalKey;
  while (cursor !== startKey) {
    const row = Math.floor(cursor / cols);
    const col = cursor % cols;
    cells.push(centerOf({ col, row }));
    cursor = cameFrom.get(cursor);
    if (cursor === undefined) return null;
  }
  cells.reverse();
  const raw = [{ x: start.x, y: start.y }, ...cells, { x: goal.x, y: goal.y }];
  return simplifyPath(world, raw, tide, margin);
}

export function verifyRoutes(world, tide) {
  const routes = world.zones.map((zone) => {
    const path = findPath(world, world.start, zone, tide, { grid: 14, margin: 15 });
    return {
      id: zone.id,
      name: zone.name,
      reachable: Boolean(path),
      points: path ? path.length : 0
    };
  });
  return {
    tide,
    passageOpen: northPassageOpen(world, tide),
    routes,
    allReachable: routes.every((route) => route.reachable)
  };
}
