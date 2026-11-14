import { WORLD, LOOPS, JUNCTIONS, STATIONS, SIM, findStation } from './config.js';
import {
  TAU, pointOnLoop, stationPose, junctionPoses, trainPose, depotPose,
  switchPlaquePose, approachSignalPose, sampleLoop
} from './geometry.js';

const TWO_PI = Math.PI * 2;

function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
}

function drawPolyline(ctx, points, width, color, offset = 0) {
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = point.x + point.nx * offset;
    const y = point.y + point.ny * offset;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}

const GRASS = (() => {
  const random = mulberry32(149);
  return Array.from({ length: 460 }, () => ({
    x: 46 + random() * 1188,
    y: 42 + random() * 636,
    w: 0.5 + random() * 1.4,
    h: 1 + random() * 2.8,
    a: 0.045 + random() * 0.09
  }));
})();

const TREES = [
  { x: 84, y: 188, s: 1.05 }, { x: 116, y: 214, s: 0.78 }, { x: 1200, y: 190, s: 1.1 },
  { x: 1168, y: 165, s: 0.72 }, { x: 1192, y: 636, s: 0.92 }, { x: 1142, y: 654, s: 0.72 },
  { x: 94, y: 654, s: 0.9 }, { x: 528, y: 87, s: 0.62 }, { x: 758, y: 86, s: 0.58 },
  { x: 992, y: 632, s: 0.55 }
];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.trails = { blue: [], amber: [] };
    this.time = 0;
    this.lastPoses = { blue: null, amber: null };
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = WORLD.width * dpr;
    this.canvas.height = WORLD.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dpr = dpr;
  }

  draw(state, now) {
    const dt = this.lastTime ? Math.min(0.1, (now - this.lastTime) / 1000) : 1 / 60;
    this.lastTime = now;
    this.time += dt;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, WORLD.width, WORLD.height);
    this.drawTable(ctx);
    this.drawScenery(ctx);
    this.drawBallast(ctx);
    this.drawConnectors(ctx, state);
    this.drawRails(ctx);
    this.drawStations(ctx, state);
    this.drawJunctionZones(ctx, state);
    this.drawSignals(ctx, state);
    this.updateTrails(state, dt);
    this.drawTrails(ctx);
    this.drawTrains(ctx, state);
    this.drawDepot(ctx, state);
    this.drawLighting(ctx);
    this.drawTableMarks(ctx);
  }

  drawTable(ctx) {
    ctx.fillStyle = '#080d0a';
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    const wood = ctx.createLinearGradient(0, 0, WORLD.width, WORLD.height);
    wood.addColorStop(0, '#73502f');
    wood.addColorStop(0.26, '#4b311d');
    wood.addColorStop(0.55, '#634326');
    wood.addColorStop(0.8, '#3f2918');
    wood.addColorStop(1, '#75542f');
    roundedRect(ctx, 10, 10, WORLD.width - 20, WORLD.height - 20, 25);
    ctx.fillStyle = wood;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(243, 211, 153, 0.25)';
    ctx.stroke();

    const felt = ctx.createRadialGradient(WORLD.cx - 120, WORLD.cy - 160, 90, WORLD.cx, WORLD.cy, 670);
    felt.addColorStop(0, '#78866a');
    felt.addColorStop(0.5, '#68785d');
    felt.addColorStop(1, '#4c5d47');
    roundedRect(ctx, 34, 32, WORLD.width - 68, WORLD.height - 64, 18);
    ctx.fillStyle = felt;
    ctx.fill();
    ctx.strokeStyle = 'rgba(38, 29, 16, 0.55)';
    ctx.lineWidth = 5;
    ctx.stroke();

    const innerShade = ctx.createRadialGradient(WORLD.cx, WORLD.cy, 260, WORLD.cx, WORLD.cy, 620);
    innerShade.addColorStop(0, 'rgba(255, 242, 201, 0.06)');
    innerShade.addColorStop(0.65, 'rgba(0, 0, 0, 0)');
    innerShade.addColorStop(1, 'rgba(18, 27, 17, 0.34)');
    roundedRect(ctx, 34, 32, WORLD.width - 68, WORLD.height - 64, 18);
    ctx.fillStyle = innerShade;
    ctx.fill();

    for (const blade of GRASS) {
      ctx.strokeStyle = `rgba(232, 231, 183, ${blade.a})`;
      ctx.lineWidth = blade.w;
      ctx.beginPath();
      ctx.moveTo(blade.x, blade.y);
      ctx.lineTo(blade.x + blade.w * 1.4, blade.y - blade.h);
      ctx.stroke();
    }
  }

  drawScenery(ctx) {
    this.drawPond(ctx);
    for (const tree of TREES) this.drawTree(ctx, tree);
    this.drawShed(ctx, 90, 604, -0.08);
    this.drawShed(ctx, 1186, 104, 0.06);
    this.drawTower(ctx, 1110, 634);
  }

  drawPond(ctx) {
    ctx.save();
    ctx.translate(103, 103);
    ctx.rotate(-0.14);
    const grad = ctx.createRadialGradient(-16, -9, 4, 0, 0, 62);
    grad.addColorStop(0, '#8aa3a0');
    grad.addColorStop(0.65, '#5f7d7d');
    grad.addColorStop(1, '#4b6867');
    ctx.fillStyle = 'rgba(15, 24, 18, 0.34)';
    ctx.beginPath();
    ctx.ellipse(4, 7, 60, 33, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, 0, 57, 30, 0, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = 'rgba(218, 229, 205, 0.23)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.ellipse(-10 + i * 9, -4 + i * 6, 24 - i * 4, 9 - i * 2, -0.1, 0.1, 2.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawTree(ctx, tree) {
    const { x, y, s } = tree;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.fillStyle = 'rgba(12, 20, 12, 0.27)';
    ctx.beginPath();
    ctx.ellipse(7, 9, 15, 6, 0.2, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = '#3b3021';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(0, 3);
    ctx.lineTo(0, 14);
    ctx.stroke();
    const foliage = ctx.createRadialGradient(-5, -8, 2, 0, 0, 17);
    foliage.addColorStop(0, '#72865a');
    foliage.addColorStop(0.6, '#546b46');
    foliage.addColorStop(1, '#344a34');
    ctx.fillStyle = foliage;
    for (const [dx, dy, r] of [[0, -5, 14], [-8, 2, 10], [8, 2, 10], [0, 7, 9]]) {
      ctx.beginPath();
      ctx.arc(dx, dy, r, 0, TWO_PI);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(207, 213, 162, 0.18)';
    ctx.beginPath();
    ctx.arc(-5, -10, 5, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }

  drawShed(ctx, x, y, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(14, 20, 13, 0.26)';
    roundedRect(ctx, -22, -8, 50, 28, 4);
    ctx.fill();
    ctx.fillStyle = '#72543a';
    roundedRect(ctx, -25, -15, 50, 26, 3);
    ctx.fill();
    ctx.fillStyle = '#bb9d6d';
    roundedRect(ctx, -21, 0, 42, 12, 2);
    ctx.fill();
    ctx.fillStyle = '#4f6a55';
    ctx.fillRect(-2, 3, 8, 9);
    ctx.fillStyle = 'rgba(255, 232, 184, 0.62)';
    ctx.fillRect(-16, -8, 10, 5);
    ctx.strokeStyle = 'rgba(55, 38, 22, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-25, -15);
    ctx.lineTo(25, 11);
    ctx.stroke();
    ctx.restore();
  }

  drawTower(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(10, 15, 10, 0.28)';
    ctx.beginPath();
    ctx.ellipse(6, 10, 24, 9, 0.2, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = '#6d5036';
    roundedRect(ctx, -14, -16, 30, 28, 3);
    ctx.fill();
    ctx.fillStyle = '#a98857';
    roundedRect(ctx, -10, -12, 22, 18, 2);
    ctx.fill();
    ctx.fillStyle = '#354b3b';
    for (let i = 0; i < 3; i += 1) ctx.fillRect(-7 + i * 7, -9, 4, 5);
    ctx.fillStyle = '#304537';
    ctx.beginPath();
    ctx.moveTo(-18, -16);
    ctx.lineTo(-3, -28);
    ctx.lineTo(18, -16);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawBallast(ctx) {
    for (const loopId of ['outer', 'inner']) {
      const points = sampleLoop(loopId, 340);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      drawPolyline(ctx, points, 43, 'rgba(20, 25, 17, 0.32)', 4);
      drawPolyline(ctx, points, 33, '#a09377');
      drawPolyline(ctx, points, 25, '#ab9e82');
      ctx.save();
      for (let i = 0; i < points.length; i += 3) {
        const point = points[i];
        const seed = (i * 17 + (loopId === 'outer' ? 3 : 9)) % 11;
        ctx.fillStyle = seed > 5 ? 'rgba(75, 63, 45, 0.24)' : 'rgba(228, 218, 185, 0.22)';
        ctx.beginPath();
        ctx.arc(point.x - point.nx * (2 + (seed % 4)) + (seed % 3), point.y - point.ny * 3 + (seed % 2), 0.8 + (seed % 2) * 0.4, 0, TWO_PI);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  drawConnectors(ctx, state) {
    const switchStates = Object.fromEntries(state.switches.map((item) => [item.id, item.state]));
    for (const junction of JUNCTIONS) {
      const poses = junctionPoses(junction);
      const dx = poses.inner.x - poses.outer.x;
      const dy = poses.inner.y - poses.outer.y;
      const length = Math.hypot(dx, dy);
      const ux = dx / length;
      const uy = dy / length;
      const nx = -uy;
      const ny = ux;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(18, 25, 17, 0.3)';
      ctx.lineWidth = 33;
      ctx.beginPath();
      ctx.moveTo(poses.outer.x + 3, poses.outer.y + 4);
      ctx.lineTo(poses.inner.x + 3, poses.inner.y + 4);
      ctx.stroke();
      ctx.strokeStyle = '#9e9176';
      ctx.lineWidth = 26;
      ctx.beginPath();
      ctx.moveTo(poses.outer.x, poses.outer.y);
      ctx.lineTo(poses.inner.x, poses.inner.y);
      ctx.stroke();

      const tieCount = Math.max(3, Math.round(length / 13));
      for (let i = 1; i < tieCount; i += 1) {
        const t = i / tieCount;
        const x = poses.outer.x + dx * t;
        const y = poses.outer.y + dy * t;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.atan2(uy, ux));
        ctx.fillStyle = '#705638';
        roundedRect(ctx, -1.7, -9, 3.4, 18, 1);
        ctx.fill();
        ctx.restore();
      }
      const railGap = 4.3;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(poses.outer.x + nx * railGap * side, poses.outer.y + ny * railGap * side);
        ctx.lineTo(poses.inner.x + nx * railGap * side, poses.inner.y + ny * railGap * side);
        ctx.strokeStyle = '#474d42';
        ctx.lineWidth = 3.6;
        ctx.stroke();
        ctx.strokeStyle = '#d3cbb9';
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }

      const cross = switchStates[junction.id] === 'cross';
      if (!cross) {
        ctx.strokeStyle = 'rgba(53, 66, 47, 0.48)';
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.moveTo(poses.outer.x, poses.outer.y);
        ctx.lineTo(poses.inner.x, poses.inner.y);
        ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(214, 177, 101, 0.16)';
        ctx.lineWidth = 30;
        ctx.beginPath();
        ctx.moveTo(poses.outer.x, poses.outer.y);
        ctx.lineTo(poses.inner.x, poses.inner.y);
        ctx.stroke();
      }

      const outerPose = poses.outer;
      const bladeX = cross ? ux * 20 : outerPose.tx * 20;
      const bladeY = cross ? uy * 20 : outerPose.ty * 20;
      ctx.strokeStyle = '#d3b06c';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(outerPose.x, outerPose.y);
      ctx.lineTo(outerPose.x + bladeX, outerPose.y + bladeY);
      ctx.stroke();
      ctx.fillStyle = '#f0d89f';
      ctx.beginPath();
      ctx.arc(outerPose.x + bladeX, outerPose.y + bladeY, 2.2, 0, TWO_PI);
      ctx.fill();
    }
  }

  drawRails(ctx) {
    for (const loopId of ['outer', 'inner']) {
      const railPoints = sampleLoop(loopId, 360);
      const tieCount = 168;
      for (let i = 0; i < tieCount; i += 1) {
        const point = pointOnLoop(loopId, i / tieCount);
        ctx.save();
        ctx.translate(point.x, point.y);
        ctx.rotate(point.angle);
        ctx.fillStyle = i % 4 === 0 ? '#6d5235' : '#765a3b';
        ctx.fillRect(-1.7, -9.4, 3.4, 18.8);
        ctx.restore();
      }
      ctx.lineCap = 'butt';
      drawPolyline(ctx, railPoints, 3.8, '#43483e', 4.7);
      drawPolyline(ctx, railPoints, 2.1, '#d7d0bf', 4.7);
      drawPolyline(ctx, railPoints, 3.8, '#43483e', -4.7);
      drawPolyline(ctx, railPoints, 2.1, '#d7d0bf', -4.7);
      drawPolyline(ctx, railPoints, 1, 'rgba(255, 250, 225, 0.36)', 5.7);
      drawPolyline(ctx, railPoints, 1, 'rgba(255, 250, 225, 0.28)', -5.7);
      for (let i = 0; i < 28; i += 1) {
        const point = pointOnLoop(loopId, i / 28);
        ctx.fillStyle = 'rgba(40, 42, 31, 0.5)';
        ctx.beginPath();
        ctx.arc(point.x + point.nx * 4.7, point.y + point.ny * 4.7, 1.1, 0, TWO_PI);
        ctx.fill();
      }
    }
  }

  drawStations(ctx, state) {
    for (const station of STATIONS) this.drawStation(ctx, station, state);
  }

  drawStation(ctx, station, state) {
    const pose = stationPose(station);
    const missionTrains = state.trains.filter((train) => train.visited.includes(station.id));
    const nextTrains = state.trains.filter((train) => train.nextEvent && train.nextEvent.kind === 'station' && train.nextEvent.station === station.id);
    const highlight = nextTrains[0]?.color || missionTrains[0]?.color || null;
    ctx.save();
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.angle);
    ctx.fillStyle = 'rgba(16, 22, 15, 0.25)';
    roundedRect(ctx, -31, -8, 64, 18, 4);
    ctx.fill();
    ctx.fillStyle = '#d8ccb1';
    roundedRect(ctx, -32, -10, 64, 17, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(73, 56, 32, 0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = 'rgba(55, 42, 25, 0.35)';
    for (let i = 0; i < 10; i += 1) ctx.fillRect(-27 + i * 5.5, -7.5, 3.4, 1.2);
    ctx.fillStyle = '#8e7048';
    roundedRect(ctx, -12, -2, 24, 10, 1.5);
    ctx.fill();
    ctx.fillStyle = '#4c654e';
    roundedRect(ctx, -9, -8, 18, 8, 1.5);
    ctx.fill();
    ctx.fillStyle = 'rgba(233, 220, 189, 0.44)';
    ctx.fillRect(-8, -7, 6, 5);
    if (highlight) {
      ctx.strokeStyle = highlight;
      ctx.globalAlpha = 0.42 + Math.sin(this.time * 3.2) * 0.16;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.roundRect(-35, -13, 70, 24, 5);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    const labelDistance = station.loop === 'outer' ? 58 : -52;
    const labelPose = pointOnLoop(station.loop, station.p);
    const lx = labelPose.x + labelPose.nx * labelDistance;
    const ly = labelPose.y + labelPose.ny * labelDistance;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 10px "Noto Sans SC Variable", "PingFang SC", sans-serif';
    const text = station.name;
    const width = ctx.measureText(text).width + 18;
    ctx.fillStyle = 'rgba(33, 45, 31, 0.67)';
    roundedRect(ctx, lx - width / 2, ly - 7.5, width, 15, 4);
    ctx.fill();
    ctx.strokeStyle = highlight ? `${highlight}88` : 'rgba(219, 208, 177, 0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#e3e6d6';
    ctx.fillText(text, lx - 2, ly + 0.3);
    ctx.fillStyle = '#a9a27d';
    ctx.font = '600 7px "SFMono-Regular", monospace';
    ctx.fillText(station.code, lx + width / 2 - 7, ly + 0.4);
    ctx.restore();
  }

  drawJunctionZones(ctx, state) {
    const byId = Object.fromEntries(state.switches.map((item) => [item.id, item]));
    for (const junction of JUNCTIONS) {
      const poses = junctionPoses(junction);
      const info = byId[junction.id];
      const occupied = info && info.occupied;
      const dx = poses.inner.x - poses.outer.x;
      const dy = poses.inner.y - poses.outer.y;
      const length = Math.hypot(dx, dy) + 16;
      const angle = Math.atan2(dy, dx);
      ctx.save();
      ctx.translate(poses.mid.x, poses.mid.y);
      ctx.rotate(angle);
      ctx.fillStyle = occupied ? 'rgba(224, 90, 69, 0.16)' : 'rgba(200, 165, 106, 0.055)';
      roundedRect(ctx, -length / 2, -22, length, 44, 14);
      ctx.fill();
      ctx.setLineDash([5, 4]);
      ctx.lineDashOffset = occupied ? -this.time * 18 : 0;
      ctx.strokeStyle = occupied ? 'rgba(236, 112, 89, 0.88)' : 'rgba(218, 190, 132, 0.28)';
      ctx.lineWidth = 1.2;
      roundedRect(ctx, -length / 2, -22, length, 44, 14);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      const plaque = switchPlaquePose(junction);
      const px = plaque.x;
      const py = plaque.y;
      ctx.save();
      ctx.translate(px, py);
      ctx.fillStyle = occupied ? '#582a24' : 'rgba(20, 29, 22, 0.9)';
      roundedRect(ctx, -17, -9, 34, 18, 5);
      ctx.fill();
      ctx.strokeStyle = occupied ? '#e0705b' : 'rgba(214, 183, 121, 0.45)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '600 8px "SFMono-Regular", monospace';
      ctx.fillStyle = occupied ? '#ffd1c6' : '#e5cb94';
      ctx.fillText(junction.id, 0, 0.4);
      if (occupied) {
        ctx.fillStyle = '#ffb0a1';
        ctx.font = '8px "Noto Sans SC Variable", "PingFang SC", sans-serif';
        ctx.fillText('占用', 0, 17);
      }
      ctx.restore();
    }
  }

  drawSignals(ctx, state) {
    for (const junction of JUNCTIONS) {
      const switchState = state.switches.find((item) => item.id === junction.id)?.state;
      const occupied = state.switches.find((item) => item.id === junction.id)?.occupied;
      for (const loopId of ['outer', 'inner']) {
        const pose = approachSignalPose(junction, loopId);
        const approaching = state.trains.some((train) => {
          if (train.done || train.status === 'waiting') return false;
          if (train.loop !== loopId || !train.nextEvent || train.nextEvent.kind !== 'switch') return false;
          if (train.nextEvent.junction !== junction.id) return false;
          const distance = junction.p === 0 ? 1 - train.p : junction.p - train.p;
          return distance > -0.01 && distance < 0.13 && train.nextEvent.state !== switchState;
        });
        const held = state.trains.some((train) => train.hold && train.hold.type === 'signal' && train.hold.junction === junction.id && train.loop === loopId);
        const danger = approaching || held;
        ctx.save();
        ctx.translate(pose.x, pose.y);
        ctx.rotate(pose.angle);
        ctx.fillStyle = 'rgba(14, 20, 14, 0.72)';
        roundedRect(ctx, -3.5, -8, 7, 16, 2.5);
        ctx.fill();
        ctx.fillStyle = danger ? '#de5a43' : '#7ccc8d';
        ctx.shadowColor = danger ? 'rgba(224, 90, 69, 0.85)' : 'rgba(124, 204, 141, 0.5)';
        ctx.shadowBlur = 9;
        ctx.beginPath();
        ctx.arc(0, -3, 2.5, 0, TWO_PI);
        ctx.fill();
        ctx.shadowBlur = 0;
        if (occupied) {
          ctx.strokeStyle = 'rgba(224, 90, 69, 0.5)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(0, -3, 5, 0, TWO_PI);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  updateTrails(state, dt) {
    if (state.elapsed < this.lastElapsed - 0.01) {
      this.trails = { blue: [], amber: [] };
      this.lastPoses = { blue: null, amber: null };
    }
    this.lastElapsed = state.elapsed;
    for (const train of state.trains) {
      const trail = this.trails[train.id];
      if (!trail) continue;
      if (train.status === 'waiting' || train.done) {
        this.lastPoses[train.id] = null;
        continue;
      }
      const pose = trainPose(train);
      const last = this.lastPoses[train.id];
      if (!last || Math.hypot(pose.x - last.x, pose.y - last.y) > 2.2) {
        trail.push({ x: pose.x, y: pose.y, t: this.time });
      }
      this.lastPoses[train.id] = { x: pose.x, y: pose.y };
      while (trail.length && this.time - trail[0].t > 1.35) trail.shift();
      if (trail.length > 36) trail.shift();
    }
  }

  drawTrails(ctx) {
    for (const train of Object.values(this.trails)) {
      if (train.length < 2) continue;
      ctx.lineCap = 'round';
      for (let i = 1; i < train.length; i += 1) {
        const a = train[i - 1];
        const b = train[i];
        const age = Math.max(0, 1 - (this.time - b.t) / 1.35);
        const distance = Math.hypot(b.x - a.x, b.y - a.y);
        if (distance > 34) continue;
        ctx.strokeStyle = `rgba(15, 20, 15, ${age * 0.16})`;
        ctx.lineWidth = 5.5 * age + 1;
        ctx.beginPath();
        ctx.moveTo(a.x + 2, a.y + 3);
        ctx.lineTo(b.x + 2, b.y + 3);
        ctx.stroke();
      }
    }
    for (const [id, trail] of Object.entries(this.trails)) {
      const color = id === 'blue' ? '#4da3ff' : '#f6b73c';
      for (let i = 1; i < trail.length; i += 1) {
        const a = trail[i - 1];
        const b = trail[i];
        const age = Math.max(0, 1 - (this.time - b.t) / 1.35);
        const distance = Math.hypot(b.x - a.x, b.y - a.y);
        if (distance > 34) continue;
        ctx.strokeStyle = color;
        ctx.globalAlpha = age * 0.65;
        ctx.lineWidth = 3.4 * age + 0.5;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        if (i % 3 === 0) {
          ctx.globalAlpha = age * 0.48;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(b.x, b.y, 1.3 + 1.6 * age, 0, TWO_PI);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  drawTrains(ctx, state) {
    for (const train of state.trains) {
      if (train.done) continue;
      const pose = trainPose(train);
      const held = train.status === 'held' || train.status === 'braking';
      const waiting = train.status === 'waiting';
      ctx.save();
      ctx.translate(pose.x, pose.y);
      ctx.rotate(pose.angle);
      ctx.globalAlpha = waiting ? 0.7 : 1;

      if (held) {
        const pulse = 17 + Math.sin(this.time * 7) * 2;
        ctx.strokeStyle = 'rgba(232, 102, 80, 0.65)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, pulse, 0, TWO_PI);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(11, 16, 11, 0.3)';
      ctx.beginPath();
      ctx.ellipse(2, 6, 31, 9, 0, 0, TWO_PI);
      ctx.fill();

      ctx.fillStyle = '#2e322c';
      roundedRect(ctx, -42, -4.5, 58, 9, 4);
      ctx.fill();
      ctx.strokeStyle = 'rgba(222, 210, 180, 0.32)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(-34, 0);
      ctx.lineTo(13, 0);
      ctx.stroke();

      const coach = ctx.createLinearGradient(0, -7, 0, 7);
      coach.addColorStop(0, train.color);
      coach.addColorStop(0.52, train.accent);
      coach.addColorStop(1, train.color);
      ctx.fillStyle = coach;
      roundedRect(ctx, -43, -6.5, 22, 13, 4);
      ctx.fill();
      ctx.strokeStyle = 'rgba(16, 25, 19, 0.48)';
      ctx.lineWidth = 0.9;
      ctx.stroke();
      ctx.fillStyle = '#253d4e';
      for (let i = 0; i < 3; i += 1) {
        roundedRect(ctx, -39 + i * 6, -3.8, 3.5, 3.5, 1);
        ctx.fill();
      }

      const body = ctx.createLinearGradient(0, -7, 0, 7);
      body.addColorStop(0, train.accent);
      body.addColorStop(0.32, train.color);
      body.addColorStop(0.68, train.color);
      body.addColorStop(1, '#1e5c91');
      ctx.fillStyle = body;
      roundedRect(ctx, -20, -7, 34, 14, 5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(13, 25, 22, 0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#20394d';
      roundedRect(ctx, -14, -4.4, 9, 3.6, 1.2);
      ctx.fill();
      roundedRect(ctx, -2, -4.4, 9, 3.6, 1.2);
      ctx.fill();
      ctx.fillStyle = 'rgba(238, 246, 238, 0.68)';
      ctx.fillRect(-15, 2.6, 27, 1.2);
      ctx.fillStyle = '#2d4437';
      ctx.beginPath();
      ctx.arc(13, 0, 4.2, -Math.PI / 2, Math.PI / 2);
      ctx.fill();
      ctx.fillStyle = '#ffecbb';
      ctx.shadowColor = 'rgba(255, 236, 187, 0.8)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(14.5, 0, 1.6, 0, TWO_PI);
      ctx.fill();
      ctx.shadowBlur = 0;

      const beam = ctx.createLinearGradient(15, 0, 62, 0);
      beam.addColorStop(0, 'rgba(255, 236, 182, 0.2)');
      beam.addColorStop(1, 'rgba(255, 236, 182, 0)');
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(15, -3);
      ctx.lineTo(62, -11);
      ctx.lineTo(62, 11);
      ctx.lineTo(15, 3);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#1d2720';
      for (const x of [-36, -27, -11, -2, 9]) {
        roundedRect(ctx, x, -7.8, 3.5, 2, 1);
        ctx.fill();
        roundedRect(ctx, x, 5.8, 3.5, 2, 1);
        ctx.fill();
      }
      ctx.restore();

      const badge = this.statusBadge(train, state.elapsed);
      this.drawTrainBadge(ctx, pose.x, pose.y - 27, train.color, badge, held);
    }
  }

  statusBadge(train, elapsed) {
    if (train.status === 'waiting') {
      const left = Math.max(0, train.departAt - elapsed);
      return `待发 ${left.toFixed(0)}s`;
    }
    if (train.status === 'held') return '保护停车';
    if (train.status === 'braking') return '制动中';
    if (train.status === 'dwell') return '停靠中';
    if (train.status === 'done') return '已入库';
    return '运行中';
  }

  drawTrainBadge(ctx, x, y, color, text, alarm) {
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.font = '600 8.5px "Noto Sans SC Variable", "PingFang SC", sans-serif';
    const width = ctx.measureText(text).width + 22;
    ctx.fillStyle = alarm ? 'rgba(72, 29, 24, 0.9)' : 'rgba(14, 23, 17, 0.82)';
    roundedRect(ctx, x - width / 2, y - 7.5, width, 15, 4);
    ctx.fill();
    ctx.strokeStyle = alarm ? 'rgba(224, 90, 69, 0.55)' : 'rgba(255, 255, 255, 0.11)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.fillStyle = alarm ? '#ff8f7c' : color;
    ctx.beginPath();
    ctx.arc(x - width / 2 + 7, y, 2.4, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = alarm ? '#ffd0c7' : '#e7eadc';
    ctx.fillText(text, x - width / 2 + 13, y + 0.4);
    ctx.restore();
  }

  drawDepot(ctx, state) {
    const yardY = 645;
    ctx.save();
    ctx.strokeStyle = 'rgba(26, 32, 21, 0.25)';
    ctx.lineWidth = 20;
    ctx.beginPath();
    ctx.moveTo(218, yardY + 3);
    ctx.lineTo(456, yardY + 3);
    ctx.stroke();
    ctx.strokeStyle = '#9b8e73';
    ctx.lineWidth = 15;
    ctx.beginPath();
    ctx.moveTo(218, yardY);
    ctx.lineTo(456, yardY);
    ctx.stroke();
    for (let x = 225; x < 452; x += 10) {
      ctx.fillStyle = '#72583a';
      ctx.fillRect(x, yardY - 6, 2.5, 12);
    }
    for (const offset of [-3.2, 3.2]) {
      ctx.strokeStyle = '#d3cbb9';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(218, yardY + offset);
      ctx.lineTo(456, yardY + offset);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(21, 31, 23, 0.75)';
    roundedRect(ctx, 218, 661, 64, 15, 4);
    ctx.fill();
    ctx.fillStyle = '#b9b18c';
    ctx.font = '7px "SFMono-Regular", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('FIDDLE YARD', 250, 671);
    ctx.restore();

    let slot = 0;
    for (const train of state.trains) {
      if (!train.done) continue;
      const x = 286 + slot * 82;
      ctx.save();
      ctx.translate(x, yardY);
      ctx.globalAlpha = 0.88;
      ctx.fillStyle = 'rgba(10, 15, 10, 0.25)';
      ctx.beginPath();
      ctx.ellipse(1, 4, 25, 6, 0, 0, TWO_PI);
      ctx.fill();
      const grad = ctx.createLinearGradient(0, -5, 0, 5);
      grad.addColorStop(0, train.accent);
      grad.addColorStop(0.55, train.color);
      grad.addColorStop(1, '#263d2c');
      ctx.fillStyle = grad;
      roundedRect(ctx, -20, -6, 38, 12, 3);
      ctx.fill();
      ctx.fillStyle = '#243c4c';
      ctx.fillRect(-12, -3.5, 8, 3);
      ctx.fillRect(0, -3.5, 8, 3);
      ctx.fillStyle = '#e6dfc7';
      ctx.font = '7px "Noto Sans SC Variable", "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('入库', 0, 17);
      ctx.restore();
      slot += 1;
    }
  }

  drawLighting(ctx) {
    const vignette = ctx.createRadialGradient(WORLD.cx - 40, WORLD.cy - 90, 210, WORLD.cx, WORLD.cy + 20, 690);
    vignette.addColorStop(0, 'rgba(255, 238, 186, 0.035)');
    vignette.addColorStop(0.55, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(4, 9, 6, 0.4)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    const warm = ctx.createLinearGradient(0, 0, 720, 480);
    warm.addColorStop(0, 'rgba(255, 232, 174, 0.075)');
    warm.addColorStop(0.45, 'rgba(255, 232, 174, 0.018)');
    warm.addColorStop(1, 'rgba(255, 232, 174, 0)');
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
  }

  drawTableMarks(ctx) {
    for (const [x, y] of [[25, 25], [1255, 25], [25, 695], [1255, 695]]) {
      ctx.fillStyle = 'rgba(232, 202, 143, 0.55)';
      ctx.beginPath();
      ctx.arc(x, y, 3.4, 0, TWO_PI);
      ctx.fill();
      ctx.strokeStyle = 'rgba(38, 25, 13, 0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 2, y);
      ctx.lineTo(x + 2, y);
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(1094, 676);
    ctx.strokeStyle = 'rgba(237, 219, 180, 0.52)';
    ctx.fillStyle = 'rgba(237, 219, 180, 0.62)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(94, 0);
    ctx.moveTo(0, -3);
    ctx.lineTo(0, 3);
    ctx.moveTo(47, -2);
    ctx.lineTo(47, 2);
    ctx.moveTo(94, -3);
    ctx.lineTo(94, 3);
    ctx.stroke();
    ctx.font = '6.5px "SFMono-Regular", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('0', 0, -7);
    ctx.fillText('1 m', 94, -7);
    ctx.fillText('SCALE 1:220', 47, 12);
    ctx.restore();

    ctx.save();
    ctx.translate(1222, 72);
    ctx.strokeStyle = 'rgba(240, 224, 188, 0.45)';
    ctx.fillStyle = 'rgba(240, 224, 188, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 9);
    ctx.lineTo(0, -9);
    ctx.moveTo(-4, -4);
    ctx.lineTo(0, -9);
    ctx.lineTo(4, -4);
    ctx.stroke();
    ctx.font = '6px "SFMono-Regular", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('N', 0, -13);
    ctx.restore();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(236, 211, 165, 0.55)';
    ctx.font = '600 8px "SFMono-Regular", monospace';
    ctx.fillText('MICRO RAILWAY · INTERLOCKING No.04', WORLD.cx, 705);
    ctx.restore();
  }
}
