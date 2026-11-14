/* Canvas 渲染：瓶体颗粒、缓存区、堵塞点、分流器与下游装箱 */
(function () {
  'use strict';

  const COLORS = {
    belt: '#2b3a4d',
    beltEdge: '#46607d',
    bottle: '#7fd4ff',
    bottleCap: '#e8f4ff',
    buffer: '#1b2a3a',
    bufferFill: '#2f6d4f',
    bufferWarn: '#b8862f',
    jam: '#ff5a5a',
    jamGlow: 'rgba(255,90,90,.35)',
    down: '#3a2f55',
    downFill: '#7c5cff',
    text: '#9fb4c8',
  };

  function Renderer(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.W = canvas.width;
    this.H = canvas.height;
  }

  Renderer.prototype.bottle = function (x, y, angle, jammed) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle || 0);
    // 瓶身
    ctx.fillStyle = jammed ? '#ff9a9a' : COLORS.bottle;
    roundRect(ctx, -7, -5, 14, 10, 3);
    ctx.fill();
    // 瓶盖
    ctx.fillStyle = COLORS.bottleCap;
    ctx.fillRect(5, -3, 3, 6);
    ctx.restore();
  };

  Renderer.prototype.belt = function (x1, y1, x2, y2) {
    const ctx = this.ctx;
    ctx.strokeStyle = COLORS.beltEdge;
    ctx.lineWidth = 16;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.strokeStyle = COLORS.belt;
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };

  Renderer.prototype.bufferBox = function (x, y, w, h, level, cap, label, jammed, paused) {
    const ctx = this.ctx;
    ctx.fillStyle = COLORS.buffer;
    roundRect(ctx, x, y, w, h, 6);
    ctx.fill();
    ctx.strokeStyle = paused ? '#f0b67f' : jammed ? COLORS.jam : COLORS.beltEdge;
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, w, h, 6);
    ctx.stroke();
    // 水位填充
    const ratio = Math.min(1, level / cap);
    const fillH = (h - 8) * ratio;
    ctx.fillStyle = ratio > 0.8 ? COLORS.bufferWarn : COLORS.bufferFill;
    roundRect(ctx, x + 4, y + h - 4 - fillH, w - 8, fillH, 4);
    ctx.fill();
    // 缓存内瓶颗粒
    const cols = Math.max(1, Math.floor((w - 10) / 16));
    for (let i = 0; i < level; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const bx = x + 10 + col * 16;
      const by = y + h - 12 - row * 15;
      if (by > y + 6) this.bottle(bx, by, 0, jammed);
    }
    ctx.fillStyle = COLORS.text;
    ctx.font = '12px sans-serif';
    ctx.fillText(label + ' ' + level + '/' + cap, x + 4, y - 6);
  };

  Renderer.prototype.jamPoint = function (x, y, t) {
    const ctx = this.ctx;
    const pulse = 6 + Math.sin(t * 8) * 2.5;
    ctx.fillStyle = COLORS.jamGlow;
    ctx.beginPath();
    ctx.arc(x, y, pulse + 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.jam;
    ctx.beginPath();
    ctx.arc(x, y, pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('堵', x, y + 4);
    ctx.textAlign = 'left';
  };

  Renderer.prototype.draw = function (s) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    const t = s.time;

    // 布局坐标
    const feedY = 70;
    const divX = 240;
    const laneAY = 180;
    const laneBY = 330;
    const bufX = 560;
    const bufW = 150;
    const bufH = 90;
    const mergeX = 770;
    const mergeY = 255;

    // 进料皮带
    this.belt(40, feedY, divX, feedY);
    s.feed.forEach((bt) => {
      const x = 40 + bt.p * (divX - 40);
      this.bottle(x, feedY, 0, false);
    });
    ctx.fillStyle = COLORS.text;
    ctx.font = '12px sans-serif';
    ctx.fillText('上游进料', 40, feedY - 18);

    // 分流器
    ctx.save();
    ctx.translate(divX, feedY);
    ctx.fillStyle = '#d7e0ea';
    ctx.beginPath();
    if (s.diverter.mode === 'A') {
      ctx.moveTo(0, -8); ctx.lineTo(26, 26); ctx.lineTo(-10, 18);
    } else if (s.diverter.mode === 'B') {
      ctx.moveTo(0, 8); ctx.lineTo(26, -26); ctx.lineTo(-10, -18);
    } else {
      ctx.moveTo(0, -10); ctx.lineTo(20, 0); ctx.lineTo(0, 10); ctx.lineTo(-12, 0);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = s.diverter.timer > 0 ? '#f0b67f' : COLORS.text;
    ctx.fillText('分流器: ' + s.diverter.mode + (s.diverter.timer > 0 ? '（切换延迟）' : ''), divX - 10, feedY - 18);

    // 两条支线
    [['A', laneAY], ['B', laneBY]].forEach(([lane, y]) => {
      const b = s.branches[lane];
      // 分流到支线的斜皮带 + 水平支线皮带
      this.belt(divX + 10, feedY, divX + 60, y);
      this.belt(divX + 60, y, bufX, y);
      b.belt.forEach((bt) => {
        const x = divX + 60 + bt.p * (bufX - divX - 60);
        this.bottle(x, y, 0, b.jammed);
      });
      // 堵塞点
      if (b.jammed) this.jamPoint(bufX - 14, y, t);
      if (b.paused) {
        ctx.fillStyle = '#f0b67f';
        ctx.fillText('已暂停' + (b.jammed ? ' · 清堵中 ' + (b.clearAcc || 0).toFixed(1) + 's' : ''), divX + 60, y - 16);
      }
      if (b.resumeTimer > 0) {
        ctx.fillStyle = '#8fe388';
        ctx.fillText('启动延迟 ' + b.resumeTimer.toFixed(1) + 's', divX + 60, y - 16);
      }
      // 支线缓存
      this.bufferBox(bufX, y - bufH / 2, bufW, bufH, b.buffer.length, s.cfg.BRANCH_CAP,
        '支线' + lane + '缓存', b.jammed, b.paused);
    });

    // 汇合皮带
    this.belt(bufX + bufW, laneAY, mergeX, mergeY);
    this.belt(bufX + bufW, laneBY, mergeX, mergeY);
    this.belt(mergeX, mergeY, mergeX + 90, mergeY);
    s.merge.forEach((bt, i) => {
      const x = mergeX + 10 + i * 18;
      this.bottle(x, mergeY, 0, false);
    });

    // 下游缓存与装箱
    const downX = mergeX + 100;
    this.bufferBox(downX, mergeY - 45, 120, 90, s.down.buffer.length, s.cfg.DOWN_CAP,
      '下游缓存', false, false);
    ctx.fillStyle = COLORS.text;
    ctx.fillText('灌装/装箱', downX, mergeY + 64);
    // 装箱进度
    const packRatio = s.down.buffer.length ? s.down.packAcc / s.cfg.PACK_TIME : 0;
    ctx.fillStyle = COLORS.downFill;
    ctx.fillRect(downX, mergeY + 70, 120 * Math.min(1, packRatio), 6);

    // 速度指示
    ctx.fillStyle = s.speedRamp > 0 ? '#f0b67f' : COLORS.text;
    ctx.fillText('传送速度: ' + s.speed + (s.speedRamp > 0 ? '（变速延迟 ' + s.speedRamp.toFixed(1) + 's）' : ''), 40, this.H - 24);
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  window.Renderer = Renderer;
})();
