'use strict';

// Canvas 2D 渲染：俯视三指机械手、受力色带、物体形变/滑移/提升。

const FINGER_ANGLES = [-Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6];
const REST_RADIUS = 130;
const CONTACT_RADIUS = 58;
const OBJ_RADIUS = 52;
const FINGER_LEN = 58;

function forceColor(ratio) {
  // 蓝(低) -> 绿 -> 黄 -> 红(危险)
  const r = Math.max(0, Math.min(1, ratio));
  const hue = 210 * (1 - r);
  return `hsl(${hue}, 85%, 48%)`;
}

class Renderer {
  constructor(canvas, objDef) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.objDef = objDef;
  }

  setObject(objDef) {
    this.objDef = objDef;
  }

  draw(snap, maxSafe) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cx = w / 2;
    const cy = h / 2 + 10 - (snap.liftHeight || 0);
    ctx.clearRect(0, 0, w, h);
    this.drawWorkbench(w, h);

    // 中心物体（含径向形变与滑移偏移）
    const deform = 0.35 * (snap.deformPct || 0) / 100;
    const crushFlash = snap.failed && /压坏/.test(snap.reason || '');
    this.drawObject(cx + (snap.slipOffset || 0), cy, deform, crushFlash);

    // 三根手指 + 受力色带
    snap.fingerForces.forEach((force, i) => {
      this.drawFinger(i, cx + (snap.slipOffset || 0), cy, force, snap.fingerGaps[i], maxSafe, snap.phase);
    });

    this.drawPalm(cx + (snap.slipOffset || 0), cy);
  }

  drawWorkbench(w, h) {
    const ctx = this.ctx;
    ctx.fillStyle = '#10151f';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(120,150,190,0.10)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 36) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 36) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }

  drawPalm(cx, cy) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(cx, cy, 24, 0, Math.PI * 2);
    ctx.fillStyle = '#3a4658';
    ctx.fill();
    ctx.strokeStyle = '#6b7d96';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#9fb4cf';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('掌', cx, cy);
  }

  drawFinger(i, cx, cy, force, gap, maxSafe, phase) {
    const ctx = this.ctx;
    const angle = FINGER_ANGLES[i];
    const reach = CONTACT_RADIUS + gap * ((REST_RADIUS - CONTACT_RADIUS) / GAP);
    const tipX = cx + Math.cos(angle) * reach;
    const tipY = cy + Math.sin(angle) * reach;
    const baseX = cx + Math.cos(angle) * (reach + FINGER_LEN);
    const baseY = cy + Math.sin(angle) * (reach + FINGER_LEN);
    const ratio = maxSafe ? force / maxSafe : 0;

    // 指节连杆
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.lineTo(tipX, tipY);
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#46586f';
    ctx.stroke();

    // 关节
    const midX = (baseX + tipX) / 2;
    const midY = (baseY + tipY) / 2;
    ctx.beginPath();
    ctx.arc(midX, midY, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#5d728d';
    ctx.fill();

    // 指尖受力色带（环绕指尖的弧）
    ctx.beginPath();
    ctx.arc(tipX, tipY, 13, angle - Math.PI / 2, angle + Math.PI / 2);
    ctx.lineWidth = 5;
    ctx.strokeStyle = force > 0.01 ? forceColor(ratio) : '#2c3849';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(tipX, tipY, 9, 0, Math.PI * 2);
    ctx.fillStyle = force > 0.01 ? forceColor(ratio) : '#54677f';
    ctx.fill();

    // 指尖向外延伸的受力等级条
    const barLen = 46 * Math.max(0.04, Math.min(1, ratio + (force > 0.01 ? 0 : 0)));
    const bx = tipX + Math.cos(angle) * 16;
    const by = tipY + Math.sin(angle) * 16;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + Math.cos(angle) * (force > 0.01 ? barLen : 4), by + Math.sin(angle) * (force > 0.01 ? barLen : 4));
    ctx.lineWidth = 4;
    ctx.strokeStyle = force > 0.01 ? forceColor(ratio) : '#2c3849';
    ctx.stroke();

    // 力数值标签
    ctx.fillStyle = '#c8d6e8';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${force.toFixed(1)}N`, tipX + Math.cos(angle) * 34, tipY + Math.sin(angle) * 34 - 8);
  }

  drawObject(cx, cy, deform, crushFlash) {
    const ctx = this.ctx;
    const obj = this.objDef;
    // 三向受捏：手指方向压扁、垂直方向略鼓起
    const rx = OBJ_RADIUS * (1 - deform);
    const ry = OBJ_RADIUS * (1 + deform * 0.6);

    ctx.save();
    if (crushFlash) {
      ctx.shadowColor = '#ff3b3b';
      ctx.shadowBlur = 26;
    }
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(cx - 12, cy - 14, 6, cx, cy, ry);
    if (obj.id === 'soft') {
      grad.addColorStop(0, crushFlash ? '#ff9a9a' : '#ffe08a');
      grad.addColorStop(1, crushFlash ? '#c62828' : '#e8a33d');
    } else if (obj.id === 'medium') {
      grad.addColorStop(0, crushFlash ? '#ff9a9a' : '#7fe0c3');
      grad.addColorStop(1, crushFlash ? '#c62828' : '#2f9e7e');
    } else {
      grad.addColorStop(0, crushFlash ? '#ff9a9a' : '#c3cdd9');
      grad.addColorStop(1, crushFlash ? '#c62828' : '#5f6f82');
    }
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = crushFlash ? '#ff5252' : 'rgba(255,255,255,0.35)';
    ctx.stroke();
    ctx.restore();

    // 物体标签
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(obj.label, cx, cy + ry + 18);

    if (crushFlash) {
      ctx.strokeStyle = 'rgba(255,70,70,0.9)';
      ctx.lineWidth = 2;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
        ctx.lineTo(cx + Math.cos(a) * (rx + 14), cy + Math.sin(a) * (ry + 14));
        ctx.stroke();
      }
    }
  }
}

window.Renderer = Renderer;
window.forceColor = forceColor;
