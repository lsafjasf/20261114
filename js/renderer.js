// Canvas 渲染：电梯井、轿厢、层站等待队列
(function (root) {
  'use strict';

  const CAR_COLORS = ['#4da3ff', '#3ddc97', '#ffb454'];

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.W = canvas.width;
      this.H = canvas.height;
      this.margin = { top: 24, bottom: 18, left: 70, right: 30 };
      this.shaftW = 118;
      this.gap = 22;
      this.lastFlash = new Map(); // 投诉闪烁计时
    }

    _yFor(pos, floorH, floors) {
      const innerH = this.H - this.margin.top - this.margin.bottom;
      const topFloorY = this.margin.top;
      return topFloorY + (floors - pos) * (innerH / (floors - 1)) - floorH / 2;
    }

    _flash(floor, now) {
      const t = this.lastFlash.get(floor) || -99;
      return now - t < 1.2;
    }

    flashComplaint(floor) {
      this.lastFlash.set(floor, performance.now() / 1000);
    }

    draw(snap, constants) {
      const { ctx } = this;
      const floors = constants.FLOORS;
      const innerH = this.H - this.margin.top - this.margin.bottom;
      const floorH = innerH / (floors - 1);
      const shaftX0 = this.margin.left;
      const now = performance.now() / 1000;

      ctx.clearRect(0, 0, this.W, this.H);
      ctx.fillStyle = '#0c1322';
      ctx.fillRect(0, 0, this.W, this.H);

      // 楼层基准线与层号
      for (let f = floors; f >= 1; f--) {
        const y = this.margin.top + (floors - f) * floorH;
        ctx.strokeStyle = '#243355';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(this.margin.left - 8, y + floorH / 2);
        ctx.lineTo(this.W - this.margin.right, y + floorH / 2);
        ctx.stroke();
        ctx.fillStyle = '#93a4c4';
        ctx.font = '13px sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(f + 'F', this.margin.left - 14, y + floorH / 2);
      }

      // 井道
      snap.cars.forEach((car, i) => {
        const x = shaftX0 + i * (this.shaftW + this.gap);
        ctx.fillStyle = '#111c33';
        ctx.fillRect(x, this.margin.top, this.shaftW, innerH);
        ctx.strokeStyle = '#2c3d61';
        ctx.strokeRect(x, this.margin.top, this.shaftW, innerH);

        // 回位层标记
        const hy = this._yFor(car.home, floorH, floors);
        ctx.strokeStyle = CAR_COLORS[i] + '88';
        ctx.setLineDash([6, 5]);
        ctx.strokeRect(x + 6, hy + 4, this.shaftW - 12, floorH - 8);
        ctx.setLineDash([]);
        ctx.fillStyle = CAR_COLORS[i];
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('回位 ' + car.home + 'F', x + 8, hy + 2);

        // 轿厢
        const cy = this._yFor(car.pos, floorH, floors);
        const moving = car.mode === 'moving';
        ctx.fillStyle = moving ? CAR_COLORS[i] : CAR_COLORS[i] + 'bb';
        const carH = floorH * 0.62;
        this._roundRect(x + 12, cy + (floorH - carH) / 2,
          this.shaftW - 24, carH, 6);
        ctx.fill();

        // 门状态高亮
        if (car.mode === 'doors') {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          this._roundRect(x + 12, cy + (floorH - carH) / 2,
            this.shaftW - 24, carH, 6);
          ctx.stroke();
        }

        // 轿厢信息：载客 / 方向 / 目标
        ctx.fillStyle = '#0c1322';
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const arrow = car.dir > 0 ? '▲' : car.dir < 0 ? '▼' : '■';
        ctx.fillText(arrow + ' ' + car.load + '/' + car.capacity,
          x + this.shaftW / 2, cy + floorH / 2);

        ctx.fillStyle = CAR_COLORS[i];
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        const stateText = car.mode === 'moving'
          ? '→ ' + car.target + 'F'
          : car.mode === 'doors' ? '开门中' : '空闲';
        ctx.fillText(stateText, x + this.shaftW / 2,
          this.margin.top + innerH + 14);
      });

      // 右侧等待队列（按楼层聚合）
      const queueX = shaftX0 +
        snap.cars.length * this.shaftW + (snap.cars.length - 1) * this.gap + 14;
      this._drawQueues(snap, floorH, floors, queueX, now, constants);
    }

    _drawQueues(snap, floorH, floors, x, now, constants) {
      const { ctx } = this;
      const patience = (constants && constants.PATIENCE) || 60;
      const byFloor = new Map();
      snap.waiting.forEach((p) => {
        if (!byFloor.has(p.from)) byFloor.set(p.from, []);
        byFloor.get(p.from).push(p);
      });
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      byFloor.forEach((list, floor) => {
        const y = this.margin.top + (floors - floor) * floorH + floorH / 2;
        const flashing = list.some((p) => p.complained) || this._flash(floor, now);
        list.slice(0, 10).forEach((p, idx) => {
          const px = x + idx * 22;
          ctx.fillStyle = p.complained ? '#ff6b6b'
            : p.waited > patience * 0.7 ? '#ffb454' : '#cfe0ff';
          ctx.beginPath();
          ctx.arc(px, y, 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#0c1322';
          ctx.font = 'bold 9px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(String(p.to), px, y);
          ctx.textAlign = 'left';
        });
        if (list.length > 10) {
          ctx.fillStyle = '#93a4c4';
          ctx.font = '11px sans-serif';
          ctx.fillText('+' + (list.length - 10), x + 10 * 22, y);
        }
        if (flashing) {
          ctx.strokeStyle = '#ff6b6b';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, 11, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }

    _roundRect(x, y, w, h, r) {
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

  root.ElevatorRenderer = Renderer;
})(window);
