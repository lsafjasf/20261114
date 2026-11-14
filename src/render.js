import { centerAt, snowAt, slopeAt } from './map.js';
import { mulberry32 } from './rng.js';

// Canvas 渲染：俯视山口道路、风雪、车辙、车灯、落石与冰墙
export function createRenderer(canvas, map) {
  const ctx = canvas.getContext('2d');
  const rng = mulberry32(map.seed ^ 0x51ed270b);
  const flakes = [];
  for (let i = 0; i < 220; i++) {
    flakes.push({
      x: rng() * canvas.width,
      y: rng() * canvas.height,
      r: 0.8 + rng() * 2.4,
      phase: rng() * Math.PI * 2,
      speed: 40 + rng() * 120,
      respawn: rng,
    });
  }

  return {
    draw(state, input) {
      const { width: W, height: H } = canvas;
      const camX = state.plow.x;
      const camY = state.plow.y - H * 0.32;
      ctx.clearRect(0, 0, W, H);
      drawTerrain(ctx, map, camX, camY, W, H);
      drawTracks(ctx, state, camX, camY);
      drawWalls(ctx, map, camX, camY, W, H);
      drawStranded(ctx, map, camX, camY);
      drawConvoy(ctx, state, camX, camY);
      drawClosure(ctx, state, camX, camY, W, H);
      drawRocks(ctx, state, camX, camY);
      drawHeadlights(ctx, state, camX, camY);
      drawPlow(ctx, state, camX, camY);
      drawSnow(ctx, flakes, state, W, H);
      drawVignette(ctx, W, H, state.wind);
    },
  };
}

function sx(worldX, camX) {
  return worldX - camX + 480;
}
function sy(worldY, camY) {
  return worldY - camY;
}

function drawTerrain(ctx, map, camX, camY, W, H) {
  ctx.fillStyle = '#20283a';
  ctx.fillRect(0, 0, W, H);
  const y0 = Math.max(0, Math.floor(camY) - 2);
  const y1 = Math.min(map.length, Math.ceil(camY + H) + 2);
  ctx.beginPath();
  ctx.moveTo(sx(centerAt(map, y0) - map.roadWidth / 2, camX), sy(y0, camY));
  for (let y = y0; y <= y1; y += 8) {
    ctx.lineTo(sx(centerAt(map, y) - map.roadWidth / 2, camX), sy(y, camY));
  }
  for (let y = y1; y >= y0; y -= 8) {
    ctx.lineTo(sx(centerAt(map, y) + map.roadWidth / 2, camX), sy(y, camY));
  }
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#3d4760');
  grad.addColorStop(1, '#4a556f');
  ctx.fillStyle = grad;
  ctx.fill();

  // 积雪着色：深雪更白，提示铲雪减速区域
  for (let y = y0; y < y1; y += 24) {
    const depth = snowAt(map, y);
    if (depth > 0.85) {
      const cx = centerAt(map, y);
      ctx.fillStyle = `rgba(235,242,255,${Math.min(0.5, (depth - 0.7) * 0.5)})`;
      ctx.fillRect(sx(cx - map.roadWidth / 2, camX), sy(y, camY), map.roadWidth, 26);
    }
    const slope = slopeAt(map, y);
    if (Math.abs(slope) > 90) {
      const cx = centerAt(map, y);
      ctx.fillStyle = 'rgba(255,180,90,0.13)';
      ctx.fillRect(sx(cx - map.roadWidth / 2, camX), sy(y, camY), map.roadWidth, 24);
    }
  }
}

function drawTracks(ctx, state, camX, camY) {
  ctx.strokeStyle = 'rgba(20,28,44,0.35)';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  for (const tr of state.tracks) {
    const x = sx(tr.x, camX);
    const y = sy(tr.y, camY);
    if (y < -20 || y > 700) continue;
    ctx.beginPath();
    ctx.moveTo(x - 9, y);
    ctx.lineTo(x + 9, y);
    ctx.stroke();
  }
}

function drawWalls(ctx, map, camX, camY, W, H) {
  for (const wall of map.walls) {
    const y = sy(wall.y, camY);
    if (y < -30 || y > H + 30) continue;
    const cx = centerAt(map, wall.y);
    const left = cx - map.roadWidth / 2;
    const gapL = cx + wall.gapLeft;
    const gapR = cx + wall.gapRight;
    ctx.fillStyle = '#b9d4ec';
    ctx.strokeStyle = '#7fa8c9';
    ctx.lineWidth = 2;
    const block = (x1, x2) => {
      ctx.fillRect(sx(x1, camX), y - 10, x2 - x1, 20);
      ctx.strokeRect(sx(x1, camX), y - 10, x2 - x1, 20);
    };
    block(left, gapL);
    block(gapR, cx + map.roadWidth / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(sx(left, camX), y - 10, gapL - left, 5);
    ctx.fillRect(sx(gapR, camX), y - 10, cx + map.roadWidth / 2 - gapR, 5);
  }
}

function drawStranded(ctx, map, camX, camY) {
  for (const car of map.stranded) {
    if (car.rescued) continue;
    const x = sx(car.x, camX);
    const y = sy(car.y, camY);
    if (y < -40 || y > 700) continue;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#e8b34b';
    roundRect(ctx, -13, -20, 26, 40, 5);
    ctx.fill();
    ctx.fillStyle = '#2c3550';
    ctx.fillRect(-9, -12, 18, 10);
    ctx.fillStyle = '#ff5d5d';
    ctx.fillRect(-11, 14, 7, 4);
    ctx.fillRect(4, 14, 7, 4);
    ctx.restore();
    // 求救信标闪烁
    const blink = 0.5 + 0.5 * Math.sin(performance.now() * 0.006 + car.y);
    ctx.fillStyle = `rgba(255,80,80,${0.35 + blink * 0.5})`;
    ctx.beginPath();
    ctx.arc(x, y - 26, 4 + blink * 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawConvoy(ctx, state, camX, camY) {
  for (const car of state.convoy) {
    const x = sx(car.x, camX);
    const y = sy(car.y, camY);
    if (y < -40 || y > 700) continue;
    ctx.fillStyle = '#5fb878';
    roundRect(ctx, x - 12, y - 18, 24, 36, 5);
    ctx.fill();
    ctx.fillStyle = '#2c3550';
    ctx.fillRect(x - 8, y - 10, 16, 9);
  }
}

function drawClosure(ctx, state, camX, camY, W, H) {
  const y = sy(state.closureY, camY);
  if (y < -80 || y > H + 80) return;
  const g = ctx.createLinearGradient(0, y - 70, 0, y + 30);
  g.addColorStop(0, 'rgba(220,232,255,0)');
  g.addColorStop(1, 'rgba(220,232,255,0.82)');
  ctx.fillStyle = g;
  ctx.fillRect(0, y - 70, W, 100);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('暴风雪封闭前沿', W / 2, y - 42);
}

function drawRocks(ctx, state, camX, camY) {
  for (const rock of state.rocks) {
    const x = sx(rock.x, camX);
    const y = sy(rock.y, camY);
    ctx.fillStyle = '#5d5448';
    ctx.beginPath();
    ctx.arc(x, y, rock.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7c7060';
    ctx.beginPath();
    ctx.arc(x - 4, y - 4, rock.radius * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHeadlights(ctx, state, camX, camY) {
  const p = state.plow;
  const x = sx(p.x, camX);
  const y = sy(p.y, camY);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(p.heading);
  const beam = ctx.createRadialGradient(0, -30, 6, 0, -120, 150);
  beam.addColorStop(0, 'rgba(255,246,200,0.38)');
  beam.addColorStop(1, 'rgba(255,246,200,0)');
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(-14, -22);
  ctx.lineTo(0, -180);
  ctx.lineTo(14, -22);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawPlow(ctx, state, camX, camY) {
  const p = state.plow;
  const x = sx(p.x, camX);
  const y = sy(p.y, camY);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(p.heading);
  // 铲刃
  ctx.fillStyle = '#c8d4e2';
  ctx.fillRect(-20, -30, 40, 7);
  // 车身
  ctx.fillStyle = '#d9534f';
  roundRect(ctx, -15, -22, 30, 46, 6);
  ctx.fill();
  ctx.fillStyle = '#24304a';
  ctx.fillRect(-10, -14, 20, 12);
  ctx.fillStyle = '#ffe9a8';
  ctx.fillRect(-12, -24, 6, 4);
  ctx.fillRect(6, -24, 6, 4);
  if (p.braking) {
    ctx.fillStyle = '#ff4d4d';
    ctx.fillRect(-12, 20, 7, 4);
    ctx.fillRect(5, 20, 7, 4);
  }
  ctx.restore();
}

function drawSnow(ctx, flakes, state, W, H) {
  ctx.fillStyle = 'rgba(245,250,255,0.85)';
  const wind = state.wind;
  for (const f of flakes) {
    f.y += f.speed * (1 / 60);
    f.x += (wind * 6 + Math.sin(performance.now() * 0.002 + f.phase) * 14) * (1 / 60);
    if (f.y > H) {
      f.y = -4;
      f.x = f.respawn() * W;
    }
    if (f.x > W + 6) f.x = -6;
    if (f.x < -6) f.x = W + 6;
    ctx.globalAlpha = 0.35 + f.r * 0.2;
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawVignette(ctx, W, H, wind) {
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
  g.addColorStop(0, 'rgba(10,16,30,0)');
  g.addColorStop(1, `rgba(10,16,30,${0.45 + Math.min(0.2, wind * 0.01)})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
