/* 渲染、交互与音频。物理逻辑在 bridge.js。 */
(function () {
  'use strict';
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const MARGIN = 60;
  const DECK_Y = 260;
  const TOWER_TOP = 120;

  // ---------- 音频：音高随张力变化，应力过高出现颤音 ----------
  const AudioSys = {
    ctx: null, osc: null, osc2: null, gain: null, strain: null, lfo: null, lfoGain: null,
    ensure() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const c = this.ctx = new AC();
      this.gain = c.createGain(); this.gain.gain.value = 0;
      this.osc = c.createOscillator(); this.osc.type = 'sine';
      this.osc.connect(this.gain); this.gain.connect(c.destination);
      this.osc.start();
      this.strain = c.createGain(); this.strain.gain.value = 0;
      this.osc2 = c.createOscillator(); this.osc2.type = 'sawtooth';
      this.lfo = c.createOscillator(); this.lfo.frequency.value = 9;
      this.lfoGain = c.createGain(); this.lfoGain.gain.value = 0;
      this.lfo.connect(this.lfoGain); this.lfoGain.connect(this.osc2.frequency);
      this.osc2.connect(this.strain); this.strain.connect(c.destination);
      this.osc2.start(); this.lfo.start();
    },
    update(tension, stressRatio, running) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const freq = 70 + tension * 230;
      this.osc.frequency.setTargetAtTime(freq, t, 0.05);
      this.osc2.frequency.setTargetAtTime(freq * 1.007, t, 0.05);
      this.gain.gain.setTargetAtTime(running ? 0.045 : 0.02, t, 0.1);
      const warn = Math.max(0, (stressRatio - 0.55) / 0.45);
      this.strain.gain.setTargetAtTime(warn * 0.05, t, 0.08);
      this.lfoGain.gain.setTargetAtTime(warn * 14, t, 0.08);
    },
    blip(freq, dur, type, vol) {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type || 'square'; o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t + dur);
    },
    breakSound() {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime;
      const len = c.sampleRate * 0.25;
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = c.createBufferSource(); src.buffer = buf;
      const g = c.createGain(); g.gain.gain.value = 0.35;
      src.connect(g); g.connect(c.destination); src.start(t);
      this.blip(90, 0.4, 'sawtooth', 0.2);
    },
    winSound() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.blip(f, 0.35, 'sine', 0.15), i * 140)); },
    loseSound() { [330, 220, 147].forEach((f, i) => setTimeout(() => this.blip(f, 0.4, 'sawtooth', 0.12), i * 180)); },
  };

  // ---------- 模拟状态 ----------
  const ui = {
    tension: document.getElementById('tension'),
    spacing: document.getElementById('spacing'),
    tensionVal: document.getElementById('tensionVal'),
    spacingVal: document.getElementById('spacingVal'),
    reinforceVal: document.getElementById('reinforceVal'),
    startBtn: document.getElementById('startBtn'),
    resetBtn: document.getElementById('resetBtn'),
    status: document.getElementById('status'),
  };

  let state = null;
  let eventCursor = 0;

  function newSim() {
    state = BridgeSim.createSim({
      tension: ui.tension.value / 100,
      spacing: Number(ui.spacing.value),
      seed: (Date.now() % 100000) | 0,
    });
    eventCursor = 0;
    ui.reinforceVal.textContent = state.reinforceLeft;
    ui.startBtn.disabled = false;
    ui.spacing.disabled = false;
  }

  function setStatus(msg, color) {
    ui.status.textContent = msg;
    ui.status.style.color = color || '#ffd166';
  }

  ui.tension.addEventListener('input', () => {
    ui.tensionVal.textContent = ui.tension.value + '%';
    AudioSys.ensure();
    if (state) BridgeSim.setTension(state, ui.tension.value / 100);
  });
  ui.spacing.addEventListener('input', () => {
    ui.spacingVal.textContent = ui.spacing.value + ' m';
    if (state && state.status === 'setup') newSim();
  });
  ui.startBtn.addEventListener('click', () => {
    AudioSys.ensure();
    BridgeSim.start(state);
    ui.startBtn.disabled = true;
    ui.spacing.disabled = true;
    setStatus('车队放行中……留意红色高应力桥板，可实时调整张力。');
  });
  ui.resetBtn.addEventListener('click', () => {
    newSim();
    setStatus('已重置：调整参数并点击桥板加固，然后放行车队。');
  });

  // ---------- 坐标映射 ----------
  function pxPerM() { return (W - 2 * MARGIN) / state.bridgeLength; }
  function plankX(i) { return MARGIN + (i + 0.5) * state.cfg.plankLength * pxPerM(); }
  function plankScreenY(i) { return DECK_Y + state.y[i] * 90; }
  function worldX(x) { return MARGIN + x * pxPerM(); }

  cv.addEventListener('click', (e) => {
    if (!state || state.status !== 'setup') return;
    const r = cv.getBoundingClientRect();
    const mx = (e.clientX - r.left) * (cv.width / r.width);
    const my = (e.clientY - r.top) * (cv.height / r.height);
    if (my < DECK_Y - 40 || my > DECK_Y + 60) return;
    const i = Math.floor((mx - MARGIN) / (state.cfg.plankLength * pxPerM()));
    if (i < 0 || i >= state.n) return;
    if (i === 0 || i === state.n - 1) { setStatus('两端桥板坐落在桥台上，无需加固。', '#8fa3bd'); return; }
    const ok = BridgeSim.toggleReinforce(state, i);
    if (!ok) setStatus('加固次数已用完！点击已加固的桥板可取消。', '#ff8a80');
    ui.reinforceVal.textContent = state.reinforceLeft;
  });

  // ---------- 事件 -> 提示与音效 ----------
  function processEvents() {
    while (eventCursor < state.events.length) {
      const e = state.events[eventCursor++];
      if (e.type === 'break') {
        AudioSys.breakSound();
        setStatus(`⚠️ ${e.t.toFixed(1)}s：#${e.plank} 号桥板应力超限断裂！`, '#ff8a80');
      } else if (e.type === 'vehicle_fell') {
        AudioSys.loseSound();
        setStatus(`💥 ${e.vehicle} 压上断板坠落，任务失败！点击重置再来。`, '#ff5252');
      } else if (e.type === 'collapse') {
        AudioSys.loseSound();
        setStatus('💥 断板过多，桥梁整体垮塌！点击重置再来。', '#ff5252');
      } else if (e.type === 'crossed') {
        setStatus(`✅ ${e.vehicle} 已安全抵达对岸（${e.t.toFixed(1)}s）`, '#7ee2a8');
      } else if (e.type === 'won') {
        AudioSys.winSound();
        setStatus(`🎉 全部救援车安全通过！总用时 ${e.t.toFixed(1)}s，峰值应力 ${state.maxStress.toFixed(0)}/${state.cfg.stressLimit}`, '#7ee2a8');
      }
    }
  }

  // ---------- 绘制 ----------
  function stressColor(ratio) {
    const r = Math.min(1, ratio);
    const h = 120 * (1 - r);
    return `hsl(${h}, 85%, ${45 + r * 10}%)`;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const n = state.n, ppm = pxPerM();
    const pw = state.cfg.plankLength * ppm;

    // 峡谷与桥台
    ctx.fillStyle = '#141d2b';
    ctx.fillRect(0, DECK_Y + 90, W, H - DECK_Y - 90);
    ctx.fillStyle = '#3d4f68';
    ctx.fillRect(0, DECK_Y - 6, MARGIN, 96);
    ctx.fillRect(W - MARGIN, DECK_Y - 6, MARGIN, 96);
    ctx.fillStyle = '#546a8a';
    ctx.fillRect(MARGIN - 14, TOWER_TOP - 10, 10, DECK_Y - TOWER_TOP + 16);
    ctx.fillRect(W - MARGIN + 4, TOWER_TOP - 10, 10, DECK_Y - TOWER_TOP + 16);

    // 主缆（抛物线）与吊索
    ctx.strokeStyle = '#c8d6e8'; ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 0; x <= 1.001; x += 0.02) {
      const cx = MARGIN + x * (W - 2 * MARGIN);
      const cy = TOWER_TOP + Math.sin(Math.PI * x) * 46;
      x === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = state.tension > 0.6 ? '#9fe8c0' : state.tension > 0.3 ? '#e8d89f' : '#e8a89f';
    for (let i = 0; i < n; i++) {
      if (state.broken[i]) continue;
      const x = plankX(i);
      const cableY = TOWER_TOP + Math.sin(Math.PI * (x - MARGIN) / (W - 2 * MARGIN)) * 46;
      ctx.beginPath();
      ctx.moveTo(x, cableY);
      ctx.lineTo(x, plankScreenY(i) - 6);
      ctx.stroke();
    }

    // 桥板（应力色带：绿->黄->红）
    for (let i = 0; i < n; i++) {
      const x = plankX(i), y = plankScreenY(i);
      const slopeL = i > 0 ? state.y[i] - state.y[i - 1] : 0;
      const slopeR = i < n - 1 ? state.y[i + 1] - state.y[i] : 0;
      const ang = Math.atan2((slopeL + slopeR) * 45, pw);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      if (state.broken[i]) ctx.globalAlpha = 0.7;
      const ratio = state.stress[i] / BridgeSim.plankLimit(state, i);
      ctx.fillStyle = state.broken[i] ? '#5a2f2f' : stressColor(ratio);
      ctx.fillRect(-pw / 2 + 1, -6, pw - 2, 12);
      if (state.reinforced[i]) {
        ctx.strokeStyle = '#dfe9f5'; ctx.lineWidth = 2;
        ctx.strokeRect(-pw / 2 + 2, -7, pw - 4, 14);
        ctx.beginPath();
        ctx.moveTo(-pw / 2 + 4, 6); ctx.lineTo(pw / 2 - 4, -6);
        ctx.moveTo(-pw / 2 + 4, -6); ctx.lineTo(pw / 2 - 4, 6);
        ctx.stroke();
      }
      ctx.restore();
      // 应力数值微标
      if (!state.broken[i] && ratio > 0.55 && state.status === 'running') {
        ctx.fillStyle = '#ffd166';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(Math.round(ratio * 100) + '%', x, y + 24);
      }
    }

    // 车辆
    for (const v of state.vehicles) {
      if (v.state === 'done') continue;
      const vx = worldX(v.x);
      const halfW = state.cfg.vehicleLength * ppm / 2;
      let vy = DECK_Y - 6;
      const pi = Math.max(0, Math.min(n - 1, Math.floor(v.x / state.cfg.plankLength)));
      if (v.x > 0 && v.x < state.bridgeLength) vy = plankScreenY(pi) - 6;
      if (v.state === 'fallen') { vy += (state.time - 0) * 2; }
      const colors = ['#6fc3ff', '#ffb74d', '#ef5350'];
      ctx.save();
      ctx.translate(vx, vy);
      if (v.state === 'fallen') ctx.rotate(0.5);
      ctx.fillStyle = colors[v.index % 3];
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-halfW, -26, halfW * 2, 22, 4);
      else ctx.rect(-halfW, -26, halfW * 2, 22);
      ctx.fill();
      ctx.fillStyle = '#1a2332';
      ctx.beginPath(); ctx.arc(-halfW * 0.55, 0, 6, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(halfW * 0.55, 0, 6, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(v.mass + 't', 0, -11);
      ctx.restore();
      if (v.state === 'waiting' && state.status === 'setup') {
        ctx.fillStyle = '#8fa3bd';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(v.name, vx, vy - 34);
      }
    }

    // 底部应力色带图例
    ctx.fillStyle = '#8fa3bd';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('应力色带：', MARGIN, H - 18);
    for (let k = 0; k < 60; k++) {
      ctx.fillStyle = stressColor(k / 59);
      ctx.fillRect(MARGIN + 62 + k * 3, H - 27, 3, 10);
    }
    ctx.fillStyle = '#8fa3bd';
    ctx.fillText('低', MARGIN + 62, H - 32);
    ctx.fillText('高（超限断裂）', MARGIN + 222, H - 32);

    // 峰值应力仪表
    const ratio = Math.min(1, state.maxStress / state.cfg.stressLimit);
    ctx.fillStyle = '#22314a';
    ctx.fillRect(W - MARGIN - 160, 20, 160, 12);
    ctx.fillStyle = stressColor(ratio);
    ctx.fillRect(W - MARGIN - 160, 20, 160 * ratio, 12);
    ctx.fillStyle = '#cfe0f5';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`峰值应力 ${state.maxStress.toFixed(0)}/${state.cfg.stressLimit}`, W - MARGIN, 48);
  }

  // ---------- 主循环 ----------
  let last = performance.now(), acc = 0;
  function frame(now) {
    const elapsed = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (state.status === 'running') {
      acc += elapsed;
      const dt = state.cfg.dt;
      let guard = 0;
      while (acc >= dt && guard++ < 200 && state.status === 'running') {
        BridgeSim.step(state);
        acc -= dt;
      }
    }
    processEvents();
    let maxRatio = 0;
    for (let i = 0; i < state.n; i++) {
      if (state.broken[i]) continue;
      maxRatio = Math.max(maxRatio, state.stress[i] / BridgeSim.plankLimit(state, i));
    }
    AudioSys.update(state.tension, maxRatio, state.status === 'running');
    draw();
    requestAnimationFrame(frame);
  }

  newSim();
  requestAnimationFrame(frame);
})();
