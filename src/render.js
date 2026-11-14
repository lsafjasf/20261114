// Canvas 渲染：隧道、旋转栅门、节拍环、物体与特效。
// 所有画面只依赖 state.vt（虚拟时间），暂停时 vt 不增长 => 画面同步冻结。

import {
  GATES, TUNNEL, gatePhaseAt, gateHalfPhase, gatePeriod,
  phaseDistanceToPulse,
} from './core.js';

const PAD_X = 30;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 960;
    this.h = 380;
    this.trackY = 230;
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = this.w * this.dpr;
    canvas.height = this.h * this.dpr;
    canvas.style.width = `${this.w}px`;
    canvas.style.height = `${this.h}px`;
    this.ctx.scale(this.dpr, this.dpr);
  }

  // 把逻辑世界 x（基于 TUNNEL.width）映射到画布坐标
  wx(worldX) {
    const usable = this.w - PAD_X * 2;
    return PAD_X + (worldX / TUNNEL.width) * usable;
  }

  draw(state) {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    this.drawBackdrop(state);
    this.drawTrack();
    GATES.forEach((gate, gi) => this.drawGate(state, gate, gi));
    this.drawObjects(state);
    this.drawSpawner(state);
    if (state.paused) this.drawPauseOverlay();
    if (state.halted) this.drawHaltOverlay();
  }

  drawBackdrop(state) {
    const { ctx, w, h } = this;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#10162b');
    grad.addColorStop(1, '#0a0e1c');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    // 随虚拟时间缓慢滚动的网格
    const shift = (state.vt * 30) % 40;
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 1;
    for (let x = -shift; x < w; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
  }

  drawTrack() {
    const { ctx, trackY } = this;
    const left = this.wx(TUNNEL.spawnX);
    const right = this.wx(TUNNEL.exitX);
    ctx.strokeStyle = 'rgba(120,150,220,0.35)';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(left, trackY); ctx.lineTo(right, trackY); ctx.stroke();
    ctx.strokeStyle = 'rgba(120,150,220,0.18)';
    ctx.lineWidth = 1;
    for (let x = left; x <= right; x += 24) {
      ctx.beginPath(); ctx.moveTo(x, trackY - 14); ctx.lineTo(x, trackY + 14); ctx.stroke();
    }
  }

  drawSpawner(state) {
    const { ctx, trackY } = this;
    const x = this.wx(TUNNEL.spawnX) - 14;
    ctx.save();
    ctx.translate(x, trackY);
    ctx.fillStyle = '#3a4a7a';
    ctx.fillRect(-10, -26, 14, 52);
    ctx.fillStyle = '#7c93d8';
    const lamp = state.spawnPulse > 0 ? '#ffe08a' : '#46588f';
    ctx.fillStyle = lamp;
    ctx.beginPath(); ctx.arc(0, -30, 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  drawGate(state, gate, gi) {
    const { ctx, trackY } = this;
    const x = this.wx(TUNNEL.gateX[gi]);
    const p = state.params[gi];
    const period = gatePeriod(gate);
    const phase = gatePhaseAt(gate, p, state.vt);
    const dist = phaseDistanceToPulse(phase);
    const half = gateHalfPhase(p.strength);
    const open = dist <= half;
    const flash = state.flashes[gi] || 0;       // 脉冲命中后的余辉 0~1
    const radius = 34;

    // 节拍环：显示本闸门周期内的相位位置与开门弧
    const ringY = 78;
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath(); ctx.arc(x, ringY, 20, 0, Math.PI * 2); ctx.stroke();
    // 开门弧（以脉冲中心 0 相位=顶端为基准，跨 ±half）
    ctx.strokeStyle = gate.color;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(x, ringY, 20, -Math.PI / 2 - half * Math.PI * 2,
      -Math.PI / 2 + half * Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // 当前相位游标
    const dotAng = -Math.PI / 2 + phase * Math.PI * 2;
    ctx.fillStyle = open ? gate.color : '#8a93b8';
    ctx.beginPath();
    ctx.arc(x + Math.cos(dotAng) * 20, ringY + Math.sin(dotAng) * 20, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = gate.color;
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${gate.n}`, x, ringY + 4);
    ctx.restore();

    // 支柱
    ctx.fillStyle = '#2a3556';
    ctx.fillRect(x - 4, ringY + 24, 8, trackY - ringY - 24 + 22);

    // 旋转栅门：三片叶片随相位连续旋转。
    // 关门时叶片横在轨道上（垂直，挡路）；靠近脉冲中心时旋转到与轨道平行（放行）。
    const spin = (state.vt / period) * Math.PI * 2 + p.offset * Math.PI * 2;
    const openAmount = Math.max(0, 1 - dist / Math.max(half, 1e-6));
    // 0=完全横挡(π/2)，1=完全平行(0)；用 openAmount 插值
    const openAngle = (Math.PI / 2) * (1 - openAmount);
    ctx.save();
    ctx.translate(x, trackY);
    const glow = open ? 0.4 + 0.6 * openAmount + flash * 0.5 : flash * 0.3;
    ctx.shadowColor = gate.color;
    ctx.shadowBlur = 12 * glow;
    ctx.strokeStyle = open ? gate.color : '#6b769a';
    ctx.lineWidth = 5;
    const bladeLen = radius;
    // 三片旋转叶片（120° 分布）
    for (let b = 0; b < 3; b += 1) {
      const ang = openAngle + (b / 3) * Math.PI * 2 + spin * 0.15;
      ctx.save();
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(bladeLen, 0);
      ctx.stroke();
      ctx.restore();
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = gate.color;
    ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // 状态文字
    ctx.fillStyle = open ? gate.color : '#8a93b8';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(open ? '开' : '合', x, trackY + radius + 16);
  }

  drawObjects(state) {
    const { ctx, trackY } = this;
    for (const obj of state.objects) {
      if (obj.done && !obj.crashed) continue;
      const x = this.wx(obj.x);
      ctx.save();
      ctx.translate(x, trackY);
      if (obj.crashed) {
        // 撞击爆裂
        ctx.strokeStyle = '#ff5d6c';
        ctx.lineWidth = 2;
        const r = 8 + (state.vt - obj.crashTime) * 40;
        for (let a = 0; a < 6; a += 1) {
          const ang = (a / 6) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(Math.cos(ang) * r * 0.4, Math.sin(ang) * r * 0.4);
          ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
          ctx.stroke();
        }
      } else {
        ctx.fillStyle = '#dfe7ff';
        ctx.shadowColor = '#9fc0ff';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.roundRect(-9, -9, 18, 18, 5);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#243056';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(String(obj.id), 0, 4);
      }
      ctx.restore();
    }
  }

  drawPauseOverlay() {
    const { ctx, w, h } = this;
    ctx.fillStyle = 'rgba(8,12,26,0.55)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffe08a';
    ctx.font = 'bold 30px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('⏸ 已冻结（音乐与闸门同步暂停）', w / 2, h / 2);
  }

  drawHaltOverlay() {
    const { ctx, w, h } = this;
    ctx.fillStyle = 'rgba(60,10,20,0.6)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ff5d6c';
    ctx.font = 'bold 32px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('■ 连续三次失败，隧道停机', w / 2, h / 2 - 8);
    ctx.fillStyle = '#ffd0d6';
    ctx.font = '16px monospace';
    ctx.fillText('点击「复位」重新调参', w / 2, h / 2 + 26);
  }
}
