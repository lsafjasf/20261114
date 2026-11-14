import { CONFIG as C } from './config.js';

export function makeParticles(count = 90) {
  const W = C.world, pts = [];
  for (let i = 0; i < count; i++) {
    pts.push({
      x: Math.random() * W.width,
      y: Math.random() * W.height,
      r: 0.8 + Math.random() * 1.8,
      speed: 0.5 + Math.random() * 0.9,
      alpha: 0.12 + Math.random() * 0.25
    });
  }
  return pts;
}

function drawBackground(ctx, time, particles) {
  const W = C.world;
  const g = ctx.createLinearGradient(0, 0, 0, W.height);
  g.addColorStop(0, '#0b2440');
  g.addColorStop(1, '#07182c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W.width, W.height);
  for (const p of particles) {
    p.x += p.speed * (0.5 + 0.12 * Math.sin(time + p.y));
    if (p.x > W.width + 6) { p.x = -6; p.y = Math.random() * W.height; }
    ctx.fillStyle = `rgba(150,200,235,${p.alpha})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCurrentStreaks(ctx, time) {
  ctx.strokeStyle = 'rgba(120,180,220,0.10)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 7; i++) {
    const y = 70 + i * 95;
    const off = (time * 26 + i * 130) % (C.world.width + 220);
    ctx.beginPath();
    for (let x = -120; x < C.world.width; x += 24) {
      const xx = x + off;
      const yy = y + Math.sin((x + time * 40) * 0.012) * 9;
      x === -120 ? ctx.moveTo(xx, yy) : ctx.lineTo(xx, yy);
    }
    ctx.stroke();
  }
}

function drawSafeZone(ctx, time) {
  const s = C.safeZone;
  ctx.save();
  ctx.fillStyle = 'rgba(72,220,170,0.10)';
  ctx.beginPath();
  ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.setLineDash([12, 10]);
  ctx.lineDashOffset = -time * 22;
  ctx.strokeStyle = 'rgba(110,235,190,0.85)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(150,240,205,0.9)';
  ctx.font = 'bold 20px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('安全区', s.x, s.y - s.radius - 14);
  ctx.restore();
}

function drawWreck(ctx) {
  const w = C.wreck;
  ctx.save();
  ctx.translate(w.x, w.y);
  ctx.fillStyle = '#1d3147';
  ctx.strokeStyle = 'rgba(120,160,190,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-w.radius, 14);
  ctx.lineTo(-10, -18);
  ctx.lineTo(16, -8);
  ctx.lineTo(w.radius + 6, 12);
  ctx.lineTo(w.radius - 2, 20);
  ctx.lineTo(-w.radius, 20);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(160,190,215,0.55)';
  ctx.font = '15px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('沉船', 0, -30);
  ctx.restore();
}

function drawHazards(ctx, time) {
  for (const w of C.whirlpools) {
    ctx.save();
    ctx.translate(w.x, w.y);
    const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, w.radius);
    grad.addColorStop(0, 'rgba(10,30,55,0.85)');
    grad.addColorStop(1, 'rgba(30,80,120,0.05)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, w.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(110,170,215,0.35)';
    ctx.lineWidth = 2;
    for (let k = 0; k < 3; k++) {
      const rr = w.radius * (0.28 + k * 0.22);
      ctx.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.1; a += 0.18) {
        const ang = a + time * (1.6 - k * 0.4) + k;
        const x = Math.cos(ang) * rr, y = Math.sin(ang) * rr;
        a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  for (const r of C.rocks) {
    ctx.save();
    const grad = ctx.createRadialGradient(r.x - 8, r.y - 10, 4, r.x, r.y, r.radius);
    grad.addColorStop(0, '#5a6b7d');
    grad.addColorStop(1, '#28384a');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,180,205,0.25)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
}

function drawRope(ctx, world) {
  const f = world.front, r = world.rear;
  const t = world.rope.tension;
  const danger = t > C.rope.safeTension;
  const slack = world.rope.sag > 0;
  const color = danger
    ? '#ff5a52'
    : slack ? '#7d93a8' : `rgb(${220 + Math.min(35, t * 0.1)},${90 - t * 0.08 | 0},${80 - t * 0.1 | 0})`;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = C.rope.renderWidth + (danger ? 1.5 : 0);
  ctx.strokeStyle = color;
  if (danger) {
    ctx.shadowColor = '#ff5a52';
    ctx.shadowBlur = 14;
  }
  ctx.beginPath();
  ctx.moveTo(f.x, f.y);
  if (slack) {
    const mx = (f.x + r.x) / 2;
    const my = (f.y + r.y) / 2 + world.rope.sag;
    ctx.quadraticCurveTo(mx, my, r.x, r.y);
  } else {
    ctx.lineTo(r.x, r.y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawAnchor(ctx, b, time) {
  if (!b.anchored) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,210,120,0.9)';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.lineDashOffset = -time * 20;
  ctx.beginPath();
  ctx.moveTo(b.x, b.y + 12);
  ctx.lineTo(b.x, b.y + 34);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#ffd27a';
  ctx.beginPath();
  ctx.arc(b.x, b.y + 38, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBoat(ctx, b, opts, time) {
  drawAnchor(ctx, b, time);
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.angle);
  const dmg = 1 - b.hp / C.boats.hullMax;
  const hull = opts.color;
  ctx.fillStyle = hull;
  ctx.strokeStyle = 'rgba(230,245,255,0.75)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-20, -11);
  ctx.lineTo(22, 0);
  ctx.lineTo(-20, 11);
  ctx.lineTo(-12, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  if (opts.thrust > 0) {
    ctx.fillStyle = 'rgba(120,220,255,0.75)';
    ctx.beginPath();
    ctx.moveTo(-20, -5);
    ctx.lineTo(-30 - 10 * opts.thrust, 0);
    ctx.lineTo(-20, 5);
    ctx.closePath();
    ctx.fill();
  }
  if (dmg > 0.18) {
    ctx.strokeStyle = `rgba(20,25,32,${Math.min(0.9, dmg + 0.2)})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-8, -6);
    ctx.lineTo(2, -1);
    ctx.lineTo(-4, 4);
    ctx.lineTo(8, 8);
    ctx.stroke();
    if (dmg > 0.5) {
      ctx.beginPath();
      ctx.moveTo(6, -8);
      ctx.lineTo(-2, 2);
      ctx.lineTo(10, 5);
      ctx.stroke();
    }
  }
  ctx.restore();

  const bw = 44;
  ctx.fillStyle = 'rgba(10,25,42,0.7)';
  ctx.fillRect(b.x - bw / 2, b.y - 34, bw, 5);
  ctx.fillStyle = dmg > 0.5 ? '#ff7a6b' : '#7ce8b0';
  ctx.fillRect(b.x - bw / 2, b.y - 34, bw * Math.max(0, b.hp / C.boats.hullMax), 5);
  ctx.fillStyle = 'rgba(235,245,255,0.92)';
  ctx.font = '14px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(opts.label, b.x, b.y + 52);
}

export function render(ctx, world, particles, ui) {
  const time = world.time;
  world.rear.angle = (ui.rearLateral || 0) > 0
    ? Math.PI / 2
    : (ui.rearLateral || 0) < 0 ? -Math.PI / 2 : Math.PI;
  drawBackground(ctx, time, particles);
  drawCurrentStreaks(ctx, time);
  drawSafeZone(ctx, time);
  drawWreck(ctx);
  drawHazards(ctx, time);
  drawRope(ctx, world);
  drawBoat(ctx, world.front, {
    color: '#e08a4a',
    label: '前船 · 左玩家',
    thrust: ui.thrust || 0
  }, time);
  drawBoat(ctx, world.rear, {
    color: '#5aa9e6',
    label: '后船 · 右玩家',
    thrust: Math.abs(ui.rearLateral || 0)
  }, time);
}
