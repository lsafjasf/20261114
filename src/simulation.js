import {
  WORLD,
  findPath,
  generateWorld,
  isPointInShoal,
  shoalScale,
  tideAt
} from "./world.js";

const BOAT = Object.freeze({
  hullRadius: 18,
  dryMass: 480,
  sensorMass: 130,
  maxSpeed: 265,
  reverseSpeed: 72
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function approach(value, target, delta) {
  if (value < target) return Math.min(value + delta, target);
  return Math.max(value - delta, target);
}

function wrapAngle(angle) {
  let wrapped = angle;
  while (wrapped > Math.PI) wrapped -= Math.PI * 2;
  while (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}

function emit(game, type, detail = {}) {
  game.events.push({ type, ...detail });
}

export function boatMass(game) {
  return BOAT.dryMass + game.boat.cargo * BOAT.sensorMass;
}

export function cargoLightness(game) {
  return 1 - game.boat.cargo / 3;
}

export function handlingLabel(game) {
  if (game.boat.cargo >= 3) return "稳";
  if (game.boat.cargo === 2) return "渐轻";
  if (game.boat.cargo === 1) return "轻快";
  return "极轻";
}

export function createGame(seed = 20261114, now = 0) {
  const world = generateWorld(seed);
  const game = {
    world,
    phase: "running",
    reason: null,
    elapsed: now,
    remaining: WORLD.missionSeconds - now,
    tide: tideAt(world, now),
    boat: {
      x: world.start.x,
      y: world.start.y,
      heading: world.start.heading,
      vx: 0,
      vy: 0,
      angularVelocity: 0,
      engine: 0,
      cargo: 3,
      deployed: 0,
      grounded: false,
      impact: 0,
      deployFlash: 0
    },
    events: [],
    deployLatch: false,
    toastClock: 0,
    route: null,
    routeTimer: 0,
    lastGuideZone: null
  };
  return game;
}

export function zoneAt(game, x = game.boat.x, y = game.boat.y) {
  return game.world.zones.find((zone) => Math.hypot(x - zone.x, y - zone.y) <= zone.radius - 3) || null;
}

export function nextGuideZone(game) {
  const zones = game.world.zones;
  const north = zones.find((zone) => zone.id === "A");
  if (north.status !== "deployed") return north;
  return zones
    .filter((zone) => zone.status !== "deployed")
    .sort((a, b) => Math.hypot(a.x - game.boat.x, a.y - game.boat.y) - Math.hypot(b.x - game.boat.x, b.y - game.boat.y))[0] || null;
}

export function tryDeploy(game) {
  if (game.phase !== "running") return { ok: false, reason: "mission-over" };
  if (game.boat.cargo <= 0) return { ok: false, reason: "empty" };
  const zone = zoneAt(game);
  if (!zone) return { ok: false, reason: "outside-zone" };
  if (zone.status === "deployed") return { ok: false, reason: "already-deployed" };

  zone.status = "deployed";
  zone.deployedAt = game.elapsed;
  game.boat.cargo -= 1;
  game.boat.deployed += 1;
  game.boat.deployFlash = 1;
  emit(game, "deployed", { zone });

  if (game.boat.deployed === 3) {
    game.phase = "win";
    game.remaining = Math.max(0, game.remaining);
    emit(game, "win", { elapsed: game.elapsed });
  }
  return { ok: true, zone };
}

function resolveShoalCollision(game) {
  const boat = game.boat;
  const shoal = isPointInShoal(game.world, boat.x, boat.y, game.tide, BOAT.hullRadius - 4);
  if (!shoal) return false;

  const scale = shoalScale(shoal, game.tide);
  const cos = Math.cos(shoal.rot);
  const sin = Math.sin(shoal.rot);
  const dx = boat.x - shoal.x;
  const dy = boat.y - shoal.y;
  const localX = dx * cos + dy * sin;
  const localY = -dx * sin + dy * cos;
  const rx = shoal.rx * scale + BOAT.hullRadius;
  const ry = shoal.ry * scale + BOAT.hullRadius;
  const denominator = Math.max(0.0001, Math.hypot(localX / rx, localY / ry));
  const edgeX = localX / denominator;
  const edgeY = localY / denominator;
  boat.x = shoal.x + edgeX * cos - edgeY * sin;
  boat.y = shoal.y + edgeX * sin + edgeY * cos;
  boat.vx *= 0.36;
  boat.vy *= 0.36;
  boat.engine = Math.min(boat.engine, 0.15);
  boat.impact = 1;
  if (!boat.grounded) emit(game, "grounded", { shoal });
  boat.grounded = true;
  return true;
}

function resolveLogCollisions(game) {
  const boat = game.boat;
  for (const log of game.world.logs) {
    const dx = boat.x - log.x;
    const dy = boat.y - log.y;
    const distance = Math.hypot(dx, dy);
    const minimum = BOAT.hullRadius + log.radius * 0.68;
    if (distance >= minimum || distance < 0.001) continue;
    const nx = dx / distance;
    const ny = dy / distance;
    boat.x = log.x + nx * minimum;
    boat.y = log.y + ny * minimum;
    const bounce = Math.max(20, Math.abs(boat.vx * nx + boat.vy * ny));
    boat.vx = boat.vx * 0.45 + nx * bounce * 0.18;
    boat.vy = boat.vy * 0.45 + ny * bounce * 0.18;
    boat.impact = Math.max(boat.impact, 0.7);
    emit(game, "driftwood", { log });
  }
}

function resolveBounds(game) {
  const boat = game.boat;
  const low = WORLD.margin + BOAT.hullRadius;
  const highX = WORLD.width - WORLD.margin - BOAT.hullRadius;
  const highY = WORLD.height - WORLD.margin - BOAT.hullRadius;
  if (boat.x < low) {
    boat.x = low;
    boat.vx = Math.abs(boat.vx) * 0.35;
  } else if (boat.x > highX) {
    boat.x = highX;
    boat.vx = -Math.abs(boat.vx) * 0.35;
  }
  if (boat.y < low) {
    boat.y = low;
    boat.vy = Math.abs(boat.vy) * 0.35;
  } else if (boat.y > highY) {
    boat.y = highY;
    boat.vy = -Math.abs(boat.vy) * 0.35;
  }
}

export function stepGame(game, dt, controls = {}) {
  game.events = [];
  if (game.phase !== "running") {
    game.boat.impact = Math.max(0, game.boat.impact - dt * 3);
    game.boat.deployFlash = Math.max(0, game.boat.deployFlash - dt * 3);
    return game.events;
  }

  const delta = clamp(dt, 0, 0.05);
  const boat = game.boat;
  const throttleInput = clamp(controls.throttle || 0, -1, 1);
  const steerInput = clamp(controls.steer || 0, -1, 1);
  const lightness = cargoLightness(game);

  game.elapsed += delta;
  game.remaining = Math.max(0, WORLD.missionSeconds - game.elapsed);
  game.tide = tideAt(game.world, game.elapsed);
  game.toastClock = Math.max(0, game.toastClock - delta);
  game.boat.deployFlash = Math.max(0, game.boat.deployFlash - delta * 2.8);
  game.boat.impact = Math.max(0, game.boat.impact - delta * 2.6);

  const throttleRate = throttleInput === 0 ? 1.7 : 2.5;
  boat.engine = approach(boat.engine, throttleInput, throttleRate * delta);
  const engineMagnitude = Math.abs(boat.engine);

  const thrustPower = 170 + 98 * lightness;
  const forwardThrust = engineMagnitude * thrustPower;
  const reverseScale = boat.engine < 0 ? 0.54 : 1;
  const headingSpeed = clamp(Math.hypot(boat.vx, boat.vy) / 48, 0.3, 1);
  const turnRate = (0.54 + 0.72 * lightness) * headingSpeed;
  const direction = boat.engine < -0.08 ? -1 : 1;
  const targetAngular = steerInput * turnRate * direction;
  boat.angularVelocity = approach(boat.angularVelocity, targetAngular, delta * 2.8);
  boat.heading = wrapAngle(boat.heading + boat.angularVelocity * delta);

  boat.vx += Math.cos(boat.heading) * forwardThrust * reverseScale * delta;
  boat.vy += Math.sin(boat.heading) * forwardThrust * reverseScale * delta;

  const drag = Math.exp(-0.88 * delta);
  boat.vx *= drag;
  boat.vy *= drag;

  const gust = Math.sin(game.elapsed * 0.5 + game.world.deco.channelGlow) * 1.2;
  boat.vx += (2.2 + gust) * delta * (0.4 + game.tide);

  const speed = Math.hypot(boat.vx, boat.vy);
  const speedCap = boat.engine < -0.05 ? BOAT.reverseSpeed : BOAT.maxSpeed;
  if (speed > speedCap) {
    boat.vx *= speedCap / speed;
    boat.vy *= speedCap / speed;
  }

  boat.x += boat.vx * delta;
  boat.y += boat.vy * delta;
  boat.grounded = false;
  resolveBounds(game);
  resolveShoalCollision(game);
  resolveLogCollisions(game);

  const deployPressed = Boolean(controls.deploy);
  if (deployPressed && !game.deployLatch) {
    const result = tryDeploy(game);
    if (!result.ok) emit(game, "deploy-failed", { reason: result.reason });
    game.deployLatch = true;
  } else if (!deployPressed) {
    game.deployLatch = false;
  }

  if (game.remaining <= 0 && game.phase === "running") {
    game.phase = "lost";
    game.reason = "backflow";
    emit(game, "lose", { reason: "backflow" });
  }
  return game.events;
}

export function routeToTarget(game, target = nextGuideZone(game)) {
  if (!target) return null;
  const path = findPath(game.world, game.boat, target, game.tide, { grid: 18, margin: 16 });
  return { target, path, tide: game.tide };
}

export function deployState(game) {
  const zone = zoneAt(game);
  if (!zone) return "none";
  return zone.status === "deployed" ? "occupied" : "ready";
}

export { BOAT, WORLD };
