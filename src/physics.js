import { CONFIG } from './config.js';

const C = CONFIG;

function boat(x, y) {
  return { x, y, vx: 0, vy: 0, angle: Math.PI, anchored: false, hp: C.boats.hullMax };
}

// 固定场景初始状态。
export function makeWorld() {
  return {
    time: 0,
    front: boat(C.start.front.x, C.start.front.y),
    rear: boat(C.start.rear.x, C.start.rear.y),
    rope: { tension: 0, stretch: 0, length: 0, sag: 0 },
    status: 'running', // running | won | lost
    safeHold: 0,
    event: null,       // 本帧事件：damage | rock | win | lose
    phase: 0
  };
}

export function currentAt(x, y, time) {
  const g = C.world;
  const grad = C.current.shearY * ((y - g.height / 2) / (g.height / 2));
  const nx = C.current.noise * Math.sin(time * 0.7 + y * 0.021);
  const ny = C.current.noise * 0.6 * Math.cos(time * 0.5 + x * 0.017);
  return { x: C.current.baseX + grad + nx, y: ny };
}

function whirlForce(b, time) {
  let fx = 0, fy = 0;
  for (const w of C.whirlpools) {
    const dx = b.x - w.x, dy = b.y - w.y;
    const d = Math.hypot(dx, dy);
    if (d >= w.radius || d < 0.001) continue;
    const falloff = 1 - d / w.radius;
    const pull = -w.strength * falloff;
    const swirl = w.strength * 0.85 * falloff;
    fx += (dx / d) * pull + (-dy / d) * swirl;
    fy += (dy / d) * pull + (dx / d) * swirl;
  }
  return { x: fx, y: fy };
}

// 弹性缆绳：松弛（距离 <= 自然长度）时张力为 0。
function ropeForces(world) {
  const a = world.front, b = world.rear;
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 0.001;
  const r = C.rope;
  const stretch = dist - r.restLength;
  let tension = 0;
  if (stretch > 0) {
    const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
    const rate = (rvx * dx + rvy * dy) / dist;
    tension = Math.max(0, r.stiffness * stretch + r.damping * rate);
  }
  const ux = dx / dist, uy = dy / dist;
  world.rope.tension = tension;
  world.rope.stretch = Math.max(0, stretch);
  world.rope.length = dist;
  world.rope.sag = stretch <= 0 ? Math.min(46, (r.restLength - dist) * 0.55) : 0;
  return {
    front: { x: ux * tension, y: uy * tension },
    rear: { x: -ux * tension, y: -uy * tension }
  };
}

function resolveCircle(b, c, radius, world, damaging) {
  const dx = b.x - c.x, dy = b.y - c.y;
  const dist = Math.hypot(dx, dy) || 0.001;
  const minDist = radius + C.boats.radius;
  if (dist >= minDist) return;
  const nx = dx / dist, ny = dy / dist;
  const pen = minDist - dist;
  b.x += nx * pen;
  b.y += ny * pen;
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) {
    b.vx -= vn * nx * 1.35;
    b.vy -= vn * ny * 1.35;
    if (damaging) {
      const dmg = Math.max(0, -vn - 45) * 0.03;
      if (dmg > 0) { b.hp -= dmg; world.event = 'rock'; }
    }
  }
}

// input: { thrust: -1..1, rearLateral: -1..1, anchor: 'front'|'rear'|null }
export function stepWorld(world, input, dt = C.dt) {
  if (world.status !== 'running') return world;
  world.event = null;
  world.phase += dt;
  world.time += dt;
  const f = world.front, r = world.rear;

  // 同时只能锚定一艘：新锚定立即释放另一艘。
  if (input.anchor === 'front') {
    if (!f.anchored) f.anchored = true;
    f.ax = f.x; f.ay = f.y;
    r.anchored = false;
  } else if (input.anchor === 'rear') {
    if (!r.anchored) r.anchored = true;
    r.ax = r.x; r.ay = r.y;
    f.anchored = false;
  } else {
    f.anchored = false;
    r.anchored = false;
  }

  const rf = ropeForces(world);
  for (const [b, thrust, lateral, ropeF] of [
    [f, input.thrust || 0, 0, rf.front],
    [r, 0, input.rearLateral || 0, rf.rear]
  ]) {
    const cur = currentAt(b.x, b.y, world.time);
    const wh = whirlForce(b, world.time);
    let fx = cur.x + wh.x + ropeF.x - C.boats.linearDrag * b.vx;
    let fy = cur.y + wh.y + ropeF.y - C.boats.linearDrag * b.vy;
    if (b === f) {
      fx += Math.cos(f.angle) * thrust * C.boats.maxThrust;
      fy += Math.sin(f.angle) * thrust * C.boats.maxThrust;
    } else {
      fy += lateral * C.boats.rearLateral;
    }
    b.vx += fx * dt;
    b.vy += fy * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.anchored) {
      b.x = b.ax;
      b.y = b.ay;
      b.vx = 0;
      b.vy = 0;
    }
  }

  for (const rock of C.rocks) {
    resolveCircle(f, rock, rock.radius, world, true);
    resolveCircle(r, rock, rock.radius, world, true);
  }
  resolveCircle(f, C.wreck, C.wreck.keepOut, world, false);
  resolveCircle(r, C.wreck, C.wreck.keepOut, world, false);
  f.x = Math.max(24, Math.min(C.world.width - 24, f.x));
  r.x = Math.max(24, Math.min(C.world.width - 24, r.x));
  f.y = Math.max(24, Math.min(C.world.height - 24, f.y));
  r.y = Math.max(24, Math.min(C.world.height - 24, r.y));

  // 缆绳过紧：两船同时累积船体损伤。
  const over = world.rope.tension - C.rope.safeTension;
  if (over > 0) {
    const dmg = over * C.rope.damageRate * dt;
    f.hp -= dmg;
    r.hp -= dmg;
    world.event = 'damage';
  }
  if (f.hp <= 0 || r.hp <= 0) {
    f.hp = Math.max(0, f.hp);
    r.hp = Math.max(0, r.hp);
    world.status = 'lost';
    world.event = 'lose';
    return world;
  }

  const sz = C.safeZone;
  const inside = (b) => Math.hypot(b.x - sz.x, b.y - sz.y) + C.boats.radius <= sz.radius;
  const slow = (b) => Math.hypot(b.vx, b.vy) <= C.win.maxSpeed;
  if (inside(f) && inside(r) && slow(f) && slow(r)) {
    world.safeHold += dt;
    if (world.safeHold >= C.win.holdTime) {
      world.status = 'won';
      world.event = 'win';
    }
  } else {
    world.safeHold = 0;
  }
  return world;
}
