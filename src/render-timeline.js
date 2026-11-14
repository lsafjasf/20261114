// 时间轴画布：网格、观测窗口、月光段、三行星轨与排程动作。
import { STARS, CONFIG, observableWindows } from './engine.js';
import { FILTER_COLOR } from './render-sky.js';

const PAD = { left: 64, right: 18, top: 40, bottom: 26 };
const LANE_H = 44;
const LANE_GAP = 12;

const KIND_STYLE = {
  slew: { fill: '#3a4f96', label: '转台' },
  filter: { fill: '#7a5ea8', label: '色片' },
  expose: { fill: '#2f7d5f', label: '曝光' },
};

export function timelineGeometry(canvas) {
  const width = canvas.width - PAD.left - PAD.right;
  const x = (t) => PAD.left + (t / CONFIG.sessionEnd) * width;
  const laneY = (index) => PAD.top + index * (LANE_H + LANE_GAP);
  return { width, x, laneY };
}

function drawGrid(ctx, canvas, x) {
  ctx.strokeStyle = '#1d2a52';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#8fa3d8';
  ctx.font = '11px sans-serif';
  for (let t = 0; t <= CONFIG.sessionEnd; t += 5) {
    const gx = x(t);
    ctx.beginPath();
    ctx.moveTo(gx, PAD.top - 10);
    ctx.lineTo(gx, canvas.height - PAD.bottom + 8);
    ctx.stroke();
    const hh = String(19 + Math.floor(t / 60)).padStart(2, '0');
    const mm = String(t % 60).padStart(2, '0');
    ctx.fillText(`${hh}:${mm}`, gx - 14, PAD.top - 16);
  }
}

function drawLanes(ctx, canvas, x, laneY) {
  STARS.forEach((star, index) => {
    const y = laneY(index);
    // 整条升起-落下区间底色
    ctx.fillStyle = '#101a3e';
    ctx.fillRect(x(star.rise), y, x(star.set) - x(star.rise), LANE_H);

    // 可观测子窗口（绿色光带）
    for (const win of observableWindows(star)) {
      ctx.fillStyle = 'rgba(47,125,79,0.45)';
      ctx.fillRect(x(win.start), y, x(win.end) - x(win.start), LANE_H);
    }

    // 月光屏蔽段（琥珀色斜纹感）
    for (const moon of star.moonBlocked) {
      const mx = x(Math.max(moon.start, star.rise));
      const mw = x(Math.min(moon.end, star.set)) - mx;
      if (mw <= 0) continue;
      ctx.fillStyle = 'rgba(255,209,102,0.35)';
      ctx.fillRect(mx, y, mw, LANE_H);
      ctx.strokeStyle = 'rgba(255,209,102,0.7)';
      ctx.beginPath();
      ctx.moveTo(mx, y + LANE_H);
      ctx.lineTo(mx + 8, y);
      ctx.stroke();
    }

    // 边框与星名
    ctx.strokeStyle = '#2c3a66';
    ctx.strokeRect(x(star.rise), y, x(star.set) - x(star.rise), LANE_H);
    ctx.fillStyle = FILTER_COLOR[star.filter];
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(
      `${star.name}[${star.filter}] 需${star.required}分`,
      PAD.left - 8,
      y + LANE_H / 2 + 4
    );
    ctx.textAlign = 'left';
  });
}

function actionLaneIndex(action) {
  if (action.kind === 'expose') return STARS.findIndex((s) => s.id === action.starId);
  if (action.kind === 'slew') return STARS.findIndex((s) => s.id === action.starId);
  // 换色片放到需要该色片的星轨上
  const idx = STARS.findIndex((s) => s.filter === action.filter);
  return idx >= 0 ? idx : 0;
}

function drawActions(ctx, x, laneY, actions, selectedIndex) {
  actions.forEach((action, index) => {
    const lane = actionLaneIndex(action);
    const y = laneY(lane) + 6;
    const h = LANE_H - 12;
    const ax = x(action.start);
    const aw = Math.max(3, x(action.end) - ax);
    const style = KIND_STYLE[action.kind] || { fill: '#555', label: '?' };
    ctx.fillStyle = style.fill;
    ctx.fillRect(ax, y, aw, h);
    if (index === selectedIndex) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(ax - 1, y - 1, aw + 2, h + 2);
      ctx.lineWidth = 1;
    }
    ctx.fillStyle = '#eaf0ff';
    ctx.font = '10px sans-serif';
    if (aw > 26) {
      const target = action.starId ? `星${action.starId}` : `${action.filter}片`;
      ctx.fillText(`${style.label}${target}`, ax + 3, y + h / 2 + 3);
    }
  });
}

function drawPlayhead(ctx, canvas, x, t) {
  const gx = x(t);
  ctx.strokeStyle = '#ff8fa3';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(gx, PAD.top - 10);
  ctx.lineTo(gx, canvas.height - PAD.bottom + 8);
  ctx.stroke();
  ctx.lineWidth = 1;
}

export function renderTimeline(canvas, actions, t, selectedIndex) {
  const ctx = canvas.getContext('2d');
  const { x, laneY } = timelineGeometry(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#060a18';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawGrid(ctx, canvas, x);
  drawLanes(ctx, canvas, x, laneY);
  drawActions(ctx, x, laneY, actions, selectedIndex);
  drawPlayhead(ctx, canvas, x, t);
}

// 命中测试：返回被点击动作的下标
export function hitTest(canvas, actions, px, py) {
  const { x, laneY } = timelineGeometry(canvas);
  for (let i = actions.length - 1; i >= 0; i -= 1) {
    const action = actions[i];
    const lane = actionLaneIndex(action);
    const y = laneY(lane) + 6;
    const h = LANE_H - 12;
    if (
      px >= x(action.start) &&
      px <= x(action.end) &&
      py >= y &&
      py <= y + h
    ) {
      return i;
    }
  }
  return -1;
}
