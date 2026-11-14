export const WORLD = {
  width: 1280,
  height: 720,
  waterTop: 108,
  waterBottom: 612,
  northDock: { x: 640, y: 143, width: 154 },
  southDock: { x: 640, y: 578, width: 154 },
  channel: { left: 500, right: 780, clearance: 30 },
  capacity: 3,
  passengerCount: 6,
};

export const BOAT = {
  baseAcceleration: 190,
  baseMaxSpeed: 224,
  passengerDrag: 0.34,
  collisionDamage: 7,
  length: 76,
  width: 31,
};

export const PASSENGERS = [
  { id: "p1", name: "沈伯", batch: 1, note: "提着旧收音机" },
  { id: "p2", name: "阿禾", batch: 1, note: "抱着纸箱" },
  { id: "p3", name: "小满", batch: 1, note: "赶末班车" },
  { id: "p4", name: "秦姨", batch: 2, note: "带一篮白菊" },
  { id: "p5", name: "渡生", batch: 2, note: "沉默的邮差" },
  { id: "p6", name: "苇苇", batch: 2, note: "第一次过河" },
];

function hashSeed(seed) {
  const text = String(seed);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function makeRng(seed) {
  let state = hashSeed(seed);
  const next = () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
  };
}

function driftwoodIntersectsChannel(item, channel) {
  const nearestX = Math.max(channel.left, Math.min(item.x, channel.right));
  const nearestY = Math.max(0, Math.min(item.y, WORLD.waterBottom));
  return Math.hypot(item.x - nearestX, item.y - nearestY) < item.radius + channel.clearance;
}

export function isMainChannelClear(world) {
  return world.driftwood.every((item) => !driftwoodIntersectsChannel(item, world.channel));
}

export function generateWorld(seed) {
  const rng = makeRng(seed);
  const northLeftX = rng.range(235, 410);
  const northRightX = WORLD.width - northLeftX - rng.range(-18, 55);
  const southLeftX = Math.min(470, Math.max(210, northLeftX + rng.range(-86, 86)));
  const southRightX = Math.min(1060, Math.max(810, WORLD.width - southLeftX + rng.range(-54, 34)));

  const beaconSpecs = [
    { id: "nw", side: "north", label: "北 · 左", x: northLeftX, y: 92, phase: rng.range(0, 8) },
    { id: "ne", side: "north", label: "北 · 右", x: northRightX, y: 92, phase: rng.range(0, 8) },
    { id: "sw", side: "south", label: "南 · 左", x: southLeftX, y: 646, phase: rng.range(0, 8) },
    { id: "se", side: "south", label: "南 · 右", x: southRightX, y: 646, phase: rng.range(0, 8) },
  ];

  const beacons = beaconSpecs.map((beacon, index) => ({
    ...beacon,
    index,
    period: rng.range(6.2, 9.4) + index * 0.24,
    onDuration: rng.range(1.15, 1.85),
    color: beacon.side === "north" ? "#ffc26f" : "#96e3ff",
  }));

  const driftwood = [];
  const count = rng.int(9, 13);
  for (let attempt = 0; attempt < 240 && driftwood.length < count; attempt += 1) {
    const side = rng.next() < 0.5 ? "west" : "east";
    const x =
      side === "west"
        ? rng.range(88, WORLD.channel.left - 66)
        : rng.range(WORLD.channel.right + 66, WORLD.width - 88);
    const y = rng.range(WORLD.waterTop + 70, WORLD.waterBottom - 66);
    const radius = rng.range(13, 27);
    const candidate = {
      id: `w${driftwood.length + 1}`,
      x,
      y,
      radius,
      length: radius * rng.range(1.8, 3.4),
      angle: rng.range(0, Math.PI * 2),
      drift: rng.range(-0.5, 0.5),
      tone: rng.int(0, 2),
    };

    if (driftwoodIntersectsChannel(candidate, WORLD.channel)) continue;
    if (Math.hypot(candidate.x - WORLD.southDock.x, candidate.y - WORLD.southDock.y) < 116) continue;
    if (Math.hypot(candidate.x - WORLD.northDock.x, candidate.y - WORLD.northDock.y) < 116) continue;
    if (driftwood.some((item) => Math.hypot(item.x - candidate.x, item.y - candidate.y) < item.radius + radius + 18)) {
      continue;
    }
    driftwood.push(candidate);
  }

  return {
    seed: String(seed),
    beacons,
    driftwood,
    channel: { ...WORLD.channel },
    current: { x: rng.range(25, 39), y: 0 },
  };
}

export function getHandling(passengerCount) {
  const load = Math.max(0, Math.min(WORLD.passengerCount, passengerCount));
  const overload = Math.max(0, load - WORLD.capacity);
  const mass = 1 + load * BOAT.passengerDrag + overload * 0.55;
  return {
    load,
    mass,
    overloaded: overload > 0,
    acceleration: (BOAT.baseAcceleration / Math.sqrt(mass)) * (overload > 0 ? 0.82 : 1),
    maxSpeed: (BOAT.baseMaxSpeed / Math.sqrt(mass)) * (overload > 0 ? 0.76 : 1),
    collisionDamage: BOAT.collisionDamage * (1 + load * 0.32 + overload * 0.58),
  };
}

export function createPassengers() {
  return PASSENGERS.map((passenger) => ({ ...passenger, status: "waiting" }));
}

export function boardPassengers(passengers, count = WORLD.capacity) {
  const alreadyAboard = passengers.filter((passenger) => passenger.status === "aboard").length;
  const room = Math.max(0, Math.min(count, WORLD.capacity - alreadyAboard));
  let boarded = 0;
  const next = passengers.map((passenger) => {
    if (boarded >= room || passenger.status !== "waiting") return passenger;
    boarded += 1;
    return { ...passenger, status: "aboard" };
  });
  return { passengers: next, boarded };
}

export function deliverPassengers(passengers) {
  let delivered = 0;
  const next = passengers.map((passenger) => {
    if (passenger.status !== "aboard") return passenger;
    delivered += 1;
    return { ...passenger, status: "delivered" };
  });
  return { passengers: next, delivered };
}

export function countPassengers(passengers, status) {
  return passengers.filter((passenger) => passenger.status === status).length;
}

export function getObjective(passengers) {
  const waiting = countPassengers(passengers, "waiting");
  const aboard = countPassengers(passengers, "aboard");
  const delivered = countPassengers(passengers, "delivered");
  if (delivered === PASSENGERS.length) {
    return { key: "return", label: "全部送达 · 返航南岸", detail: "回到南岸结束这一夜" };
  }
  if (aboard > 0) {
    return { key: "north", label: "驶向北岸", detail: `船上 ${aboard} 人 · 雷达可辨漂木` };
  }
  if (waiting > 0) {
    return { key: "south", label: "驶向南岸接人", detail: `还剩 ${waiting} 人等候` };
  }
  return { key: "return", label: "返航南岸", detail: "雾中归港" };
}

