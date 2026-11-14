import { WORLD, LOOPS, JUNCTIONS, STATIONS, findStation, findJunction } from './config.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

export function progressAngle(p) {
  return (135 + p * 360) * DEG;
}

export function pointOnLoop(loopId, p) {
  const loop = LOOPS[loopId];
  const angle = progressAngle(p);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const x = WORLD.cx + loop.rx * cos;
  const y = WORLD.cy + loop.ry * sin;
  let tx = -loop.rx * sin;
  let ty = loop.ry * cos;
  const len = Math.hypot(tx, ty) || 1;
  tx /= len;
  ty /= len;
  return {
    x,
    y,
    angle: Math.atan2(ty, tx),
    tx,
    ty,
    nx: ty,
    ny: -tx,
    loop: loopId,
    p
  };
}

export function pointOnLoopOffset(loopId, p, offset) {
  const pose = pointOnLoop(loopId, p);
  return { x: pose.x + pose.nx * offset, y: pose.y + pose.ny * offset, pose };
}

export function stationPose(station) {
  const pose = pointOnLoop(station.loop, station.p);
  const offset = station.loop === 'outer' ? 35 : -29;
  const side = station.loop === 'outer' ? 1 : -1;
  return {
    ...pose,
    x: pose.x + pose.nx * offset,
    y: pose.y + pose.ny * offset,
    offset,
    side
  };
}

export function junctionPoses(junction) {
  const outer = pointOnLoop('outer', junction.p);
  const inner = pointOnLoop('inner', junction.p);
  const mid = { x: (outer.x + inner.x) / 2, y: (outer.y + inner.y) / 2 };
  return {
    outer,
    inner,
    mid,
    angle: Math.atan2(inner.y - outer.y, inner.x - outer.x)
  };
}

export function easeInOut(t) {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}

export function mixPose(a, b, t) {
  const x = a.x + (b.x - a.x) * t;
  const y = a.y + (b.y - a.y) * t;
  let tx = a.tx + (b.tx - a.tx) * t;
  let ty = a.ty + (b.ty - a.ty) * t;
  const len = Math.hypot(tx, ty) || 1;
  tx /= len;
  ty /= len;
  return { x, y, angle: Math.atan2(ty, tx), tx, ty };
}

export function trainPose(train) {
  if (train.done) {
    const depot = depotPose(train.id);
    return { ...depot, angle: depot.angle };
  }
  if (train.transition) {
    const amount = easeInOut(train.transition.elapsed / Math.max(0.001, train.transition.duration || 0.42));
    const from = pointOnLoop(train.transition.from, train.p);
    const to = pointOnLoop(train.transition.to, train.p);
    return mixPose(from, to, amount);
  }
  return pointOnLoop(train.loop, train.p);
}

export function depotPose(trainId) {
  const slots = {
    blue: { x: 286, y: 640, angle: 0.02 },
    amber: { x: 370, y: 646, angle: -0.02 }
  };
  return slots[trainId] || { x: 330, y: 645, angle: 0 };
}

export function switchPlaquePose(junction) {
  const poses = junctionPoses(junction);
  const pose = pointOnLoop('outer', junction.p);
  return {
    x: poses.mid.x + pose.nx * 18,
    y: poses.mid.y + pose.ny * 18,
    angle: 0
  };
}

export function approachSignalPose(junction, loopId) {
  const p = junction.p - 0.032;
  const pose = pointOnLoop(loopId, p);
  const offset = loopId === 'outer' ? 17 : -11;
  return {
    x: pose.x + pose.nx * offset,
    y: pose.y + pose.ny * offset,
    angle: pose.angle,
    nx: pose.nx,
    ny: pose.ny,
    p
  };
}

export function sampleLoop(loopId, steps = 360) {
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const p = i / steps;
    points.push(pointOnLoop(loopId, p));
  }
  return points;
}

export { TAU, DEG };
