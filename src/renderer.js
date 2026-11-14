// Canvas 渲染：信号流节点图、节点状态、过载指示与实时频谱。

import { NODE_TYPE, modeOf } from './model.js';

const CARD_W = 150;
const CARD_H = 190;
const CARD_GAP = 60;

const TYPE_META = {
  [NODE_TYPE.FILTER]: { title: '滤波 FILTER', color: '#4f8cff', icon: '≈' },
  [NODE_TYPE.GAIN]: { title: '增益 GAIN', color: '#f5a524', icon: 'G' },
  [NODE_TYPE.DELAY]: { title: '延迟 DELAY', color: '#b56dff', icon: 'D' },
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cardRects = [];
  }

  layout(board, width) {
    const total = board.length * CARD_W + (board.length - 1) * CARD_GAP;
    const startX = (width - total) / 2;
    this.cardRects = board.map((_, i) => ({
      x: startX + i * (CARD_W + CARD_GAP),
      y: 150,
      w: CARD_W,
      h: CARD_H,
    }));
  }

  cardAt(mx, my) {
    const idx = this.cardRects.findIndex((r) =>
      mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h);
    return idx === -1 ? null : idx;
  }

  draw(state) {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    this.layout(state.board, w);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0e1117';
    ctx.fillRect(0, 0, w, h);

    this.drawHeader(state);
    this.drawFlowBase(w);
    this.drawConnections(state);
    this.drawCards(state);
    this.drawSpectrum(state, h);
    this.drawOverloadBar(state, h);
  }

  drawHeader(state) {
    const { ctx } = this;
    ctx.fillStyle = '#e6edf3';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('音频工作站 · 信号链路排障', 28, 42);
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#9aa7b4';
    ctx.fillText('点击同一节点旋转档位 · 点击两个节点交换位置 · 任意时刻实时监听当前链路', 28, 68);

    ctx.textAlign = 'right';
    ctx.fillStyle = state.status.failed ? '#ff4d4f' : '#9aa7b4';
    ctx.font = 'bold 15px sans-serif';
    const text = state.status.failed
      ? '失败：持续过载超过 5 秒'
      : `RMS ${state.status.rms.toFixed(3)} · 峰值 ${state.status.peak.toFixed(3)}`;
    ctx.fillText(text, this.canvas.width - 28, 42);
  }

  drawFlowBase(width) {
    const { ctx } = this;
    const y = 150 + CARD_H / 2;
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#7ee787';
    ctx.fillText('输入 SOURCE', 70, y - 56);
    ctx.fillStyle = '#79c0ff';
    ctx.fillText('输出 OUTPUT', width - 70, y - 56);
  }

  drawConnections(state) {
    const { ctx, canvas } = this;
    const y = 150 + CARD_H / 2;
    const points = [
      { x: 40, y },
      ...this.cardRects.map((r) => ({ x: r.x + r.w / 2, y })),
      { x: canvas.width - 40, y },
    ];
    const hot = state.status.overloaded;
    ctx.lineWidth = 3;
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      if (hot) {
        grad.addColorStop(0, '#ff7875');
        grad.addColorStop(1, '#ff4d4f');
      } else {
        grad.addColorStop(0, '#388bfd');
        grad.addColorStop(1, '#56d364');
      }
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.moveTo(a.x + (i === 0 ? 0 : 30), a.y);
      ctx.lineTo(b.x - (i === points.length - 2 ? 0 : 30), b.y);
      ctx.stroke();
      this.drawArrow(b.x - 34, b.y, hot ? '#ff4d4f' : '#56d364');
    }
    // 信号流动粒子
    const t = performance.now() / 1000;
    ctx.fillStyle = hot ? '#ffccc7' : '#ffffff';
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const p = (t * (hot ? 1.6 : 0.8) + i * 0.33) % 1;
      const x = a.x + 34 + (b.x - a.x - 68) * p;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  drawArrow(x, y, color) {
    const { ctx } = this;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x + 8, y);
    ctx.lineTo(x, y - 6);
    ctx.lineTo(x, y + 6);
    ctx.closePath();
    ctx.fill();
  }

  drawCards(state) {
    const { ctx } = this;
    state.board.forEach((card, i) => {
      const rect = this.cardRects[i];
      const meta = TYPE_META[card.type];
      const mode = modeOf(card);
      const selected = state.selectedIndex === i;
      ctx.save();
      if (selected) {
        ctx.shadowColor = meta.color;
        ctx.shadowBlur = 18;
      }
      ctx.fillStyle = '#161b22';
      ctx.strokeStyle = selected ? meta.color : '#30363d';
      ctx.lineWidth = selected ? 3 : 2;
      this.roundRect(rect.x, rect.y, rect.w, rect.h, 12);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = meta.color;
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(meta.title, rect.x + rect.w / 2, rect.y + 30);

      ctx.beginPath();
      ctx.arc(rect.x + rect.w / 2, rect.y + 72, 22, 0, Math.PI * 2);
      ctx.fillStyle = `${meta.color}22`;
      ctx.fill();
      ctx.fillStyle = meta.color;
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText(meta.icon, rect.x + rect.w / 2, rect.y + 81);

      ctx.fillStyle = '#e6edf3';
      ctx.font = 'bold 14px sans-serif';
      this.drawWrapped(mode.label, rect.x + rect.w / 2, rect.y + 122, rect.w - 16);

      ctx.fillStyle = '#9aa7b4';
      ctx.font = '12px sans-serif';
      ctx.fillText(`槽位 ${i + 1} · 档位 ${card.mode + 1}`, rect.x + rect.w / 2, rect.y + rect.h - 16);

      // 节点状态灯：危险档位红色，正常档位绿色。
      const danger = card.mode === 0;
      ctx.beginPath();
      ctx.arc(rect.x + rect.w - 18, rect.y + 16, 6, 0, Math.PI * 2);
      ctx.fillStyle = danger ? '#ff4d4f' : '#52c41a';
      ctx.fill();
    });
  }

  drawSpectrum(state, h) {
    const { ctx, canvas } = this;
    const baseY = h - 120;
    ctx.fillStyle = '#161b22';
    this.roundRect(28, baseY - 20, canvas.width - 56, 100, 10);
    ctx.fill();
    ctx.fillStyle = '#9aa7b4';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('实时频谱 SPECTRUM', 40, baseY - 4);

    const data = state.spectrum;
    const bars = 96;
    const step = Math.floor(data.length / bars) || 1;
    const barW = (canvas.width - 90) / bars;
    for (let i = 0; i < bars; i += 1) {
      const v = data[i * step] / 255;
      const bh = Math.max(2, v * 68);
      const x = 45 + i * barW;
      ctx.fillStyle = v > 0.85 ? '#ff4d4f' : `hsl(${200 - v * 120}, 80%, 55%)`;
      ctx.fillRect(x, baseY + 70 - bh, barW - 2, bh);
    }
  }

  drawOverloadBar(state, h) {
    const { ctx, canvas } = this;
    const y = h - 28;
    ctx.fillStyle = '#30363d';
    this.roundRect(28, y, canvas.width - 56, 12, 6);
    ctx.fill();
    const ratio = Math.min(1, state.status.overloadSeconds / 5);
    if (ratio > 0) {
      ctx.fillStyle = ratio >= 1 ? '#ff4d4f' : '#faad14';
      this.roundRect(28, y, (canvas.width - 56) * ratio, 12, 6);
      ctx.fill();
    }
    ctx.fillStyle = '#9aa7b4';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('持续过载计时（满格即失败）', canvas.width - 28, y - 6);
  }

  drawWrapped(text, x, y, maxWidth) {
    const { ctx } = this;
    const words = text.split(' ');
    let line = '';
    const lines = [];
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    lines.push(line);
    lines.forEach((l, i) => ctx.fillText(l, x, y + i * 17));
  }

  roundRect(x, y, w, h, r) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
