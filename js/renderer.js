const TAU = Math.PI * 2;

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, width, height, radius);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function drawPipe(ctx, x1, y1, x2, y2, color = '#67e8f9', width = 10) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(103, 232, 249, 0.16)';
  ctx.lineWidth = width + 8;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

function drawTank(ctx, x, y, width, height, label, level, color = '#38bdf8') {
  ctx.save();
  roundedRect(ctx, x, y, width, height, 12);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(226,245,250,0.45)';
  ctx.lineWidth = 2;
  ctx.stroke();
  const fillHeight = height * Math.max(0, Math.min(1, level));
  ctx.beginPath();
  ctx.rect(x + 5, y + height - fillHeight - 5, width - 10, fillHeight);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.fillRect(x + 5, y + 5, width - 10, height - 10);
  ctx.restore();
  ctx.fillStyle = '#dff8fc';
  ctx.font = '700 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, x + width / 2, y - 10);
}

function drawPump(ctx, x, y, pressure, running) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = running ? '#164e63' : '#334155';
  ctx.strokeStyle = '#67e8f9';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, 38, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.rotate((pressure / 100) * 0.7);
  ctx.strokeStyle = '#a5f3fc';
  ctx.lineWidth = 4;
  for (let index = 0; index < 4; index += 1) {
    ctx.rotate(Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(14, -8, 27, 0);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = '#dff8fc';
  ctx.font = '700 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('高压泵', x, y + 61);
}

function drawMembrane(ctx, x, y, membrane, activeBackwash) {
  const clogged = membrane.clogged;
  const backwashing = membrane.backwashing || activeBackwash === membrane.id;
  const color = clogged ? '#ef4444' : backwashing ? '#f59e0b' : '#22d3ee';
  ctx.save();
  roundedRect(ctx, x, y, 92, 142, 16);
  ctx.fillStyle = clogged ? 'rgba(239,68,68,0.18)' : 'rgba(34,211,238,0.11)';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();
  for (let index = 0; index < 7; index += 1) {
    ctx.strokeStyle = clogged ? 'rgba(239,68,68,0.75)' : 'rgba(165,243,252,0.42)';
    ctx.beginPath();
    ctx.moveTo(x + 18 + index * 9, y + 18);
    ctx.lineTo(x + 18 + index * 9, y + 124);
    ctx.stroke();
  }
  ctx.fillStyle = '#e8f7fb';
  ctx.font = '800 17px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`膜 ${membrane.id}`, x + 46, y - 12);
  ctx.font = '700 13px sans-serif';
  ctx.fillStyle = color;
  ctx.fillText(clogged ? '堵塞' : backwashing ? '反洗中' : `${membrane.fouling.toFixed(0)}% 污染`, x + 46, y + 166);
  ctx.restore();
}

function drawGauge(ctx, x, y, label, value, max, unit, color) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(x, y, 32, -Math.PI * 0.78, Math.PI * 0.78);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 32, -Math.PI * 0.78, -Math.PI * 0.78 + Math.PI * 1.56 * Math.min(1, value / max));
  ctx.stroke();
  ctx.fillStyle = '#e8f7fb';
  ctx.textAlign = 'center';
  ctx.font = '800 15px sans-serif';
  ctx.fillText(`${value.toFixed(0)}${unit}`, x, y + 6);
  ctx.font = '700 12px sans-serif';
  ctx.fillStyle = '#9fc3cc';
  ctx.fillText(label, x, y + 27);
  ctx.restore();
}

function drawChart(ctx, x, y, width, height, history) {
  ctx.save();
  roundedRect(ctx, x, y, width, height, 16);
  ctx.fillStyle = 'rgba(3, 18, 27, 0.72)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(151, 218, 231, 0.16)';
  ctx.stroke();

  const left = x + 54;
  const right = x + width - 20;
  const top = y + 28;
  const bottom = y + height - 34;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let index = 0; index <= 4; index += 1) {
    const gridY = top + ((bottom - top) / 4) * index;
    ctx.beginPath();
    ctx.moveTo(left, gridY);
    ctx.lineTo(right, gridY);
    ctx.stroke();
  }

  const points = history.length >= 2 ? history : [{ t: 0, turbidity: 0, pressure: 0, storage: 0 }, ...history];
  const maxTime = Math.max(720, points[points.length - 1].t);
  const series = [
    ['turbidity', 100, '#f59e0b', '浊度 NTU'],
    ['pressure', 100, '#ef4444', '膜压 bar'],
    ['storage', 1400, '#38bdf8', '储水 L']
  ];

  for (const [key, max, color] of series) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    points.forEach((point, index) => {
      const px = left + (point.t / maxTime) * (right - left);
      const py = bottom - (point[key] / max) * (bottom - top);
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }

  ctx.fillStyle = '#dff8fc';
  ctx.font = '800 15px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('膜压 / 浊度 / 储水趋势', x + 18, y + 20);
  let legendX = x + 350;
  for (const [, , color, label] of series) {
    ctx.fillStyle = color;
    ctx.fillRect(legendX, y + 10, 18, 5);
    ctx.fillStyle = '#b9d7df';
    ctx.font = '700 11px sans-serif';
    ctx.fillText(label, legendX + 24, y + 16);
    legendX += label.length * 11 + 42;
  }
  ctx.fillStyle = '#87aeb8';
  ctx.textAlign = 'right';
  ctx.fillText('12 分钟', right, bottom + 24);
  ctx.restore();
}

export function renderStation(canvas, state) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, '#0a2635');
  gradient.addColorStop(1, '#07151f');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#e8f7fb';
  ctx.font = '800 22px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('海水取水 → 预处理 → 高压泵 → 双 RO 膜 → 储水', 28, 38);

  drawTank(ctx, 44, 88, 92, 126, '海水', 0.78, '#0ea5e9');
  drawPipe(ctx, 136, 152, 202, 152);
  roundedRect(ctx, 202, 102, 118, 100, 18);
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fill();
  ctx.strokeStyle = '#67e8f9';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#dff8fc';
  ctx.font = '800 15px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('预处理', 261, 144);
  ctx.font = '700 13px sans-serif';
  ctx.fillStyle = '#a5f3fc';
  ctx.fillText(`旁路 ${state.bypass.toFixed(0)}%`, 261, 172);

  drawPipe(ctx, 320, 152, 388, 152);
  drawPump(ctx, 426, 152, state.pumpPressure, !state.finished);
  drawPipe(ctx, 464, 152, 536, 152);
  drawMembrane(ctx, 536, 82, state.membranes[0], state.backwash?.membraneId);
  drawMembrane(ctx, 664, 82, state.membranes[1], state.backwash?.membraneId);
  drawPipe(ctx, 628, 152, 664, 152);
  drawPipe(ctx, 756, 152, 812, 152);
  drawTank(ctx, 812, 88, 62, 126, '储水', state.storage / 1300, '#22d3ee');

  drawGauge(ctx, 142, 270, '浊度', state.turbidity, 100, '', '#f59e0b');
  drawGauge(ctx, 286, 270, '膜压', state.pumpPressure, 100, '', '#ef4444');
  drawGauge(ctx, 430, 270, '储水', state.storage, 1300, '', '#38bdf8');
  drawGauge(ctx, 574, 270, '产水', state.production, 2.4, '', '#22c55e');
  ctx.fillStyle = state.backwash ? '#fbbf24' : '#9fc3cc';
  ctx.font = '800 15px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(state.backwash ? `反洗中：膜 ${state.backwash.membraneId}，剩余 ${state.backwash.remaining.toFixed(1)}s` : '自动反洗待命', 680, 276);

  drawChart(ctx, 28, 330, 844, 262, state.history);
}
