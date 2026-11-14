// 夜空画布：星空、地平线、月亮、目标星高度、望远镜指向与窗口状态。
import { STARS, CONFIG, isAboveHorizon, isMoonBlocked } from './engine.js';

const FILTER_COLOR = { R: '#ff6b6b', G: '#7bed9f', B: '#70a1ff' };

function starBaseX(canvas, star, count) {
  const margin = 120;
  const span = canvas.width - margin * 2;
  return margin + (span * (star.id - 1)) / (count - 1);
}

// 星星沿一条上凸弧线运动：升起/落下时贴地平线，窗口中点在天顶方向
function starPosition(canvas, star, t) {
  const x = starBaseX(canvas, star, STARS.length);
  const groundY = canvas.height - 70;
  const mid = (star.rise + star.set) / 2;
  const half = (star.set - star.rise) / 2;
  const phase = (t - mid) / half; // -1..1
  const clamped = Math.max(-1.2, Math.min(1.2, phase));
  const arc = Math.max(0, 1 - clamped * clamped);
  const y = groundY - arc * 180;
  return { x, y, groundY, visible: Math.abs(clamped) <= 1 };
}

function drawBackground(ctx, canvas) {
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, '#05081a');
  grad.addColorStop(0.75, '#0d1638');
  grad.addColorStop(1, '#141d42');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 固定背景星
  ctx.fillStyle = '#8fa3d8';
  for (let i = 0; i < 70; i += 1) {
    const x = (i * 137.5) % canvas.width;
    const y = (i * 89.3) % (canvas.height - 90);
    const r = (i % 3) * 0.5 + 0.4;
    ctx.globalAlpha = 0.35 + (i % 5) * 0.12;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawGround(ctx, canvas) {
  const groundY = canvas.height - 70;
  ctx.fillStyle = '#1a2347';
  ctx.fillRect(0, groundY, canvas.width, canvas.height - groundY);
  ctx.strokeStyle = '#3d4f8f';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(canvas.width, groundY);
  ctx.stroke();
  ctx.fillStyle = '#6f83c4';
  ctx.font = '12px sans-serif';
  ctx.fillText('地平线', 10, groundY - 6);

  // 观测站圆顶
  ctx.fillStyle = '#28356a';
  ctx.beginPath();
  ctx.arc(canvas.width / 2, groundY + 8, 34, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(canvas.width / 2 - 34, groundY + 8, 68, 26);
}

function drawMoon(ctx, canvas, t) {
  // 月亮从左向右移动，月光屏蔽段附近画大而亮的月晕
  const x = 60 + (t / CONFIG.sessionEnd) * (canvas.width - 120);
  const y = 56;
  const anyBlocked = STARS.some((s) => isMoonBlocked(s, t));
  const glow = ctx.createRadialGradient(x, y, 4, x, y, anyBlocked ? 52 : 30);
  glow.addColorStop(0, anyBlocked ? 'rgba(255,240,190,0.95)' : 'rgba(230,236,255,0.7)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, anyBlocked ? 52 : 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = anyBlocked ? '#ffe9a8' : '#e8edff';
  ctx.beginPath();
  ctx.arc(x, y, 13, 0, Math.PI * 2);
  ctx.fill();
  if (anyBlocked) {
    ctx.fillStyle = '#ffd166';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('月光过强', x - 24, y + 34);
  }
}

function drawStar(ctx, canvas, star, t, currentTarget, validMap) {
  const pos = starPosition(canvas, star, t);
  const above = isAboveHorizon(star, t);
  const blocked = isMoonBlocked(star, t);
  const done = (validMap.get(star.id) || 0) >= star.required;
  const color = FILTER_COLOR[star.filter];

  if (!above) {
    // 尚未升起 / 已落下：在地平线下方画虚影
    ctx.globalAlpha = 0.25;
  }
  ctx.fillStyle = blocked ? '#ffd166' : color;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, currentTarget === star.id ? 8 : 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // 目标标签与状态
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  let label = `${star.name} [${star.filter}]`;
  if (!above) label += ' · 地平线下';
  else if (blocked) label += ' · 月光屏蔽';
  else label += ' · 可观测';
  if (done) label += ' ✓';
  ctx.fillStyle = done ? '#8ef0b4' : above ? (blocked ? '#ffd166' : '#b9c7ea') : '#5a6aa0';
  ctx.fillText(label, pos.x, pos.y - 14);
  ctx.textAlign = 'left';

  return { ...pos, color };
}

function drawTelescope(ctx, canvas, starPositions, currentTarget) {
  const baseX = canvas.width / 2;
  const baseY = canvas.height - 70 + 8;
  let tipX = baseX;
  let tipY = baseY - 40;
  if (currentTarget && starPositions.has(currentTarget)) {
    const p = starPositions.get(currentTarget);
    tipX = p.x;
    tipY = p.y;
  }
  ctx.strokeStyle = '#9fb4ef';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  ctx.fillStyle = '#cdd8ff';
  ctx.beginPath();
  ctx.arc(tipX, tipY, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#6f83c4';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(
    currentTarget ? `望远镜 → 星${currentTarget}` : '望远镜待命中',
    baseX,
    baseY + 30
  );
  ctx.textAlign = 'left';
}

export function renderSky(canvas, t, currentTarget, validMap) {
  const ctx = canvas.getContext('2d');
  drawBackground(ctx, canvas);
  drawMoon(ctx, canvas, t);
  drawGround(ctx, canvas);
  const positions = new Map();
  for (const star of STARS) {
    positions.set(star.id, drawStar(ctx, canvas, star, t, currentTarget, validMap));
  }
  drawTelescope(ctx, canvas, positions, currentTarget);

  ctx.fillStyle = '#dce6ff';
  ctx.font = 'bold 13px sans-serif';
  const clock = 19 * 60 + t;
  const hh = String(Math.floor(clock / 60)).padStart(2, '0');
  const mm = String(Math.floor(clock % 60)).padStart(2, '0');
  ctx.fillText(`模拟时间 ${hh}:${mm}（t=${Math.round(t)} 分）`, 12, 22);
}

export { starBaseX, starPosition, FILTER_COLOR };
