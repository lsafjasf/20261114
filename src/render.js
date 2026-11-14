(function (root) {
  const NODES = {
    solar: { x: 150, y: 110, label: '太阳能', color: '#fbbf24' },
    battery: { x: 150, y: 300, label: '电池', color: '#4ade80' },
    gen: { x: 150, y: 490, label: '备用发电机', color: '#94a3b8' },
    bus: { x: 500, y: 300, label: '汇流母线', color: '#7dd3fc' },
    load: { x: 830, y: 300, label: '负载', color: '#38bdf8' },
  };

  const LINES = {
    solar: { from: 'solar', to: 'bus', color: '#fbbf24' },
    gen: { from: 'gen', to: 'bus', color: '#94a3b8' },
    battery: { from: 'battery', to: 'bus', color: '#4ade80' },
    load: { from: 'bus', to: 'load', color: '#38bdf8' },
  };

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.particles = { solar: [], gen: [], battery: [], load: [] };
      this.spawnAcc = { solar: 0, gen: 0, battery: 0, load: 0 };
    }

    updateParticles(dt, result) {
      for (const key of Object.keys(LINES)) {
        const line = result ? result.lines[key] : null;
        const flow = line ? line.flow : 0;
        let dir = 1;
        if (key === 'battery' && result && result.battCmd < 0) dir = -1; // 充电时反向
        this.spawnAcc[key] += flow * dt * 0.12;
        while (this.spawnAcc[key] >= 1) {
          this.spawnAcc[key] -= 1;
          this.particles[key].push({ p: dir > 0 ? 0 : 1, dir });
        }
        const speed = 0.15 + flow * 0.004;
        this.particles[key] = this.particles[key].filter((pt) => {
          pt.p += pt.dir * speed * dt;
          return pt.p >= 0 && pt.p <= 1;
        });
      }
    }

    draw(result, soc) {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.drawLines(ctx, result);
      this.drawParticles(ctx, result);
      this.drawNodes(ctx, result, soc);
    }

    drawLines(ctx, result) {
      for (const key of Object.keys(LINES)) {
        const L = LINES[key];
        const a = NODES[L.from], b = NODES[L.to];
        const info = result ? result.lines[key] : null;
        const overload = info && info.overload;
        const ratio = info ? Math.min(1, info.flow / info.cap) : 0;
        ctx.save();
        ctx.lineWidth = 3 + ratio * 7;
        ctx.strokeStyle = overload ? '#ef4444' : L.color;
        ctx.globalAlpha = overload ? 0.95 : 0.35 + ratio * 0.5;
        if (overload) { ctx.shadowColor = '#ef4444'; ctx.shadowBlur = 16; }
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.restore();
        if (info) {
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          ctx.font = '12px ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.fillStyle = overload ? '#fca5a5' : '#8fa3c0';
          const warn = overload ? ` 过载 ${info.timer}s` : '';
          ctx.fillText(`${info.flow.toFixed(0)}/${info.cap} kW${warn}`, mx, my - 10);
        }
      }
    }

    drawParticles(ctx, result) {
      for (const key of Object.keys(LINES)) {
        const L = LINES[key];
        const a = NODES[L.from], b = NODES[L.to];
        const overload = result && result.lines[key].overload;
        ctx.fillStyle = overload ? '#ef4444' : L.color;
        for (const pt of this.particles[key]) {
          const x = a.x + (b.x - a.x) * pt.p;
          const y = a.y + (b.y - a.y) * pt.p;
          ctx.beginPath();
          ctx.arc(x, y, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    drawNodes(ctx, result, soc) {
      for (const key of Object.keys(NODES)) {
        const n = NODES[key];
        ctx.save();
        ctx.beginPath();
        ctx.arc(n.x, n.y, 34, 0, Math.PI * 2);
        ctx.fillStyle = '#141c2c';
        ctx.strokeStyle = n.color;
        ctx.lineWidth = 3;
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = n.color;
        ctx.font = '20px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const icons = { solar: '☀', battery: '⚡', gen: '⚙', bus: '◉', load: '⌂' };
        ctx.fillText(icons[key], n.x, n.y);
        ctx.fillStyle = '#dbe4f0';
        ctx.font = '13px sans-serif';
        ctx.fillText(n.label, n.x, n.y + 50);
        ctx.font = '12px ui-monospace, monospace';
        ctx.fillStyle = '#8fa3c0';
        ctx.fillText(this.nodeText(key, result, soc), n.x, n.y + 68);
        ctx.restore();
      }
    }

    nodeText(key, result, soc) {
      if (!result) return key === 'battery' ? `SOC ${(soc * 100).toFixed(0)}%` : '';
      switch (key) {
        case 'solar': return `${result.solar.toFixed(0)} kW / 可用 ${result.avail}`;
        case 'gen': return `${result.gen.toFixed(0)} kW`;
        case 'battery': {
          const s = result.battCmd > 0 ? `放电 ${result.battCmd.toFixed(0)} kW`
            : result.battCmd < 0 ? `充电 ${(-result.battCmd).toFixed(0)} kW` : '空闲';
          return `${s} SOC ${(soc * 100).toFixed(0)}%`;
        }
        case 'load': return `${result.delivered.toFixed(0)} / 需求 ${result.demand} kW`;
        default: return '';
      }
    }
  }

  root.Renderer = Renderer;
})(window);
