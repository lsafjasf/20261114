import {
  createGame,
  nextGuideZone,
  routeToTarget,
  stepGame
} from "../src/simulation.js";

function wrapAngle(angle) {
  let wrapped = angle;
  while (wrapped > Math.PI) wrapped -= Math.PI * 2;
  while (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function runAutopilot(seed = 20261114, options = {}) {
  const dt = options.dt || 0.05;
  const maxSeconds = options.maxSeconds || 108;
  const trace = [];
  const game = createGame(seed);
  let route = routeToTarget(game);
  let routeAge = 0;
  let justDeployed = false;
  let steps = 0;

  while (game.phase === "running" && game.elapsed < maxSeconds) {
    const target = nextGuideZone(game);
    const zone = game.world.zones.find((item) => item.id === target?.id);
    routeAge += dt;
    if (!route || route.target.id !== target.id || routeAge > 0.6) {
      route = routeToTarget(game, target);
      routeAge = 0;
    }
    if (!route?.path) {
      return { game, trace, steps, error: `no-route-${target.id}` };
    }

    let point = route.path[route.path.length - 1];
    for (const candidate of route.path) {
      if (Math.hypot(candidate.x - game.boat.x, candidate.y - game.boat.y) > 34) {
        point = candidate;
        break;
      }
    }

    const dx = point.x - game.boat.x;
    const dy = point.y - game.boat.y;
    const distance = Math.hypot(dx, dy);
    const desiredHeading = Math.atan2(dy, dx);
    const error = wrapAngle(desiredHeading - game.boat.heading);
    const speed = Math.hypot(game.boat.vx, game.boat.vy);
    const steer = clamp(error * 2.45, -1, 1);
    let throttle = 0.86;
    if (Math.abs(error) > 0.65) throttle = 0.18;
    if (Math.abs(error) > 0.35 && speed > 125) throttle = 0.06;
    if (distance < 110) throttle = clamp((distance - 32) / 100, 0.08, 0.42);
    const zoneDistance = zone ? Math.hypot(zone.x - game.boat.x, zone.y - game.boat.y) : Infinity;
    if (zoneDistance < 120) throttle = Math.min(throttle, 0.12);
    if (zoneDistance < 75) throttle = Math.min(throttle, 0.03);

    const inZone = zone && zoneDistance < zone.radius - 5;
    const pulse = inZone && !justDeployed;
    const events = stepGame(game, dt, { throttle, steer, deploy: pulse });
    justDeployed = events.some((event) => event.type === "deployed");
    steps += 1;

    if (steps % 20 === 0) {
      trace.push({
        time: Number(game.elapsed.toFixed(1)),
        x: Number(game.boat.x.toFixed(0)),
        y: Number(game.boat.y.toFixed(0)),
        tide: Number(game.tide.toFixed(2)),
        cargo: game.boat.cargo,
        grounded: game.boat.grounded,
        zoneDistance: Number(zoneDistance.toFixed(0))
      });
    }
  }
  return { game, trace, steps, error: game.phase === "win" ? null : "mission-not-complete" };
}
