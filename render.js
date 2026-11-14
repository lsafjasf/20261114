// Canvas 管线剖面渲染：温度色带、流向动画、阀门/泵/尖峰可视化。

export function tempColor(temp, alpha = 1) {
  // 20℃ 蓝 -> 60℃ 黄 -> 100℃ 红
  const t = Math.min(1, Math.max(0, (temp - 20) / 80));
  let r, g, b;
  if (t < 0.5) {
    const k = t / 0.5;
    r = Math.round(76 + (255 - 76) * k);
    g = Math.round(194 + (194 - 194) * k);
    b = Math.round(255 - (255 - 75) * k);
  } else {
    const k = (t - 0.5) / 0.5;
    r = 255;
    g = Math.round(194 - (194 - 93) * k);
    b = Math.round(75 - (75 - 60) * k);
  }
  return `rgba(${r},${g},${b},${alpha})`;
}

const TOP_Y = 210;
const BOT_Y = 360;
const RAD_X = 110;
const NODE_X = 800;
const VALVE_X = [330, 470, 610];

function pipe(ctx, x1, y1, x2, y2, color, width, dash, flow) {
  ctx.save();
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#1c2a3d';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.setLineDash(dash);
  ctx.lineDashOffset = -flow;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

function drawValve(ctx, x, y, opening, fast, time) {
  const s = 26;
  ctx.save();
  ctx.translate(x, y);
  const col = fast ? '#c08cff' : opening > 0.05 ? '#9fd8ff' : '#5a6c82';
  ctx.fillStyle = '#0f1723';
  ctx.strokeStyle = col;
  ctx.lineWidth = 2.5;
  // 阀体：两个对顶三角，开口间隙随开度变化
  const gap = 4 + opening * 12;
  ctx.beginPath();
  ctx.moveTo(-s, -s * 0.7);
  ctx.lineTo(-gap, 0);
  ctx.lineTo(-s, s * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(s, -s * 0.7);
  ctx.lineTo(gap, 0);
  ctx.lineTo(s, s * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 阀杆
  ctx.strokeStyle = col;
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.7);
  ctx.lineTo(0, -s - 12);
  ctx.stroke();
  ctx.fillStyle = col;
  ctx.fillRect(-7, -s - 20, 14, 7);
  if (fast) {
    ctx.strokeStyle = `rgba(192,140,255,${0.6 + 0.4 * Math.sin(time * 14)})`;
    ctx.beginPath();
    ctx.arc(0, 0, s + 8, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#cfe0f2';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`V${VALVE_X.indexOf(x) + 1} ${(opening * 100) | 0}%`, 0, s + 20);
  ctx.restore();
}

function drawPump(ctx, x, y, speed, time) {
  ctx.save();
  ctx.translate(x, y);
  const r = 30;
  ctx.fillStyle = '#0f1723';
  ctx.strokeStyle = speed > 0.02 ? '#4cc2ff' : '#44566c';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // 叶轮随泵速旋转
  ctx.rotate(time * speed * 9);
  ctx.fillStyle = speed > 0.02 ? 'rgba(76,194,255,0.85)' : '#3a4a5e';
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(10, -6, r - 6, 0);
    ctx.quadraticCurveTo(10, 6, 0, 0);
    ctx.fill();
  }
  ctx.rotate(-time * speed * 9);
  ctx.fillStyle = '#cfe0f2';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`旁路泵 ${(speed * 100) | 0}%`, 0, r + 20);
  ctx.restore();
}

export function drawScene(ctx, sim, time) {
  const { width: W, height: H } = ctx.canvas;
  ctx.clearRect(0, 0, W, H);
  // 背景网格
  ctx.strokeStyle = 'rgba(80,110,150,0.08)';
  ctx.lineWidth = 1;
  for (let gx = 0; gx < W; gx += 40) {
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
  }
  for (let gy = 0; gy < H; gy += 40) {
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
  }

  const flowAnim = time * (20 + sim.flow * 26);
  const hotCol = tempColor(sim.temp);
  const warmCol = tempColor(Math.max(20, sim.temp - 28));

  // 顶部供液管（散热器 -> 节点），经过三个阀门
  pipe(ctx, RAD_X + 70, TOP_Y, NODE_X - 80, TOP_Y, warmCol, 16, [16, 14], flowAnim);
  // 底部回液管（节点 -> 散热器），经过旁路泵
  pipe(ctx, NODE_X - 80, BOT_Y, RAD_X + 70, BOT_Y, hotCol, 16, [16, 14], -flowAnim);
  // 立管连接
  pipe(ctx, RAD_X + 70, TOP_Y, RAD_X + 70, BOT_Y, tempColor(30), 16, [], 0);
  pipe(ctx, NODE_X - 80, TOP_Y, NODE_X - 80, BOT_Y, hotCol, 16, [], 0);

  drawRadiator(ctx, RAD_X, (TOP_Y + BOT_Y) / 2);
  sim.valves.forEach((v, i) => drawValve(ctx, VALVE_X[i], TOP_Y, v, sim.valveFast[i], time));
  drawPump(ctx, 470, BOT_Y, sim.pump, time);
  drawNode(ctx, NODE_X, (TOP_Y + BOT_Y) / 2, sim, time);

  // 压力尖峰：节点处扩散红色冲击环
  if (sim.spike > 0.05) {
    const age = Math.min(1, sim.spike / 2);
    const radius = 60 + (1 - age) * 70;
    ctx.strokeStyle = `rgba(255,93,108,${0.7 * age})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(NODE_X, (TOP_Y + BOT_Y) / 2, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawHudText(ctx, sim, W);
}

function drawRadiator(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#0f1723';
  ctx.strokeStyle = '#4cc2ff';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.roundRect(-70, -70, 140, 140, 12);
  ctx.fill();
  ctx.stroke();
  // 散热栅格
  ctx.strokeStyle = 'rgba(76,194,255,0.55)';
  ctx.lineWidth = 3;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 18, -48);
    ctx.lineTo(i * 18, 48);
    ctx.stroke();
  }
  ctx.fillStyle = '#9fd8ff';
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('散热器', 0, 66);
  ctx.fillText('入口 12℃', 0, -86);
  ctx.restore();
}

function drawNode(ctx, x, y, sim, time) {
  ctx.save();
  ctx.translate(x, y);
  const alarm = sim.warn.temp || sim.temp > 85;
  const r = 58;
  // 温度色带：外圈渐变光环
  const grad = ctx.createRadialGradient(0, 0, 10, 0, 0, r + 26);
  grad.addColorStop(0, tempColor(sim.temp, 0.55));
  grad.addColorStop(1, tempColor(sim.temp, 0.02));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, r + 26, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#121c2b';
  ctx.strokeStyle = alarm ? '#ff5d6c' : tempColor(sim.temp);
  ctx.lineWidth = alarm ? 4 + Math.sin(time * 10) : 3;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#eaf2fc';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${sim.temp.toFixed(1)}℃`, 0, 2);
  ctx.fillStyle = '#7f93ad';
  ctx.font = '12px sans-serif';
  ctx.fillText('交换节点', 0, 22);
  ctx.fillText(`热负荷 ${sim.heat.toFixed(0)}kW`, 0, 86);
  ctx.restore();
}

function drawHudText(ctx, sim, W) {
  ctx.save();
  ctx.font = '12px "PingFang SC", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#7f93ad';
  const rows = [
    `压力 ${sim.pressure.toFixed(2)} bar（尖峰增量 ${sim.spike.toFixed(2)}）`,
    `流量 ${sim.flow.toFixed(2)} kg/s（目标滞后 ${1.8}s）`,
    `备用电力 ${sim.battery.toFixed(1)}%  任务时间 ${sim.t.toFixed(1)}s`,
  ];
  rows.forEach((r, i) => ctx.fillText(r, 24, 30 + i * 18));
  if (sim.failed) {
    ctx.fillStyle = 'rgba(255,93,108,0.15)';
    ctx.fillRect(0, 0, W, 40);
    ctx.fillStyle = '#ff5d6c';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(`任务失败：${sim.failReason}`, 24, 26);
  }
  ctx.restore();
}
