'use strict';
/* main.js — 渲染（Canvas）+ 音效（Web Audio）+ 输入 */
(function () {
  const { WORLD, createWorld, createState, step, mudDrag } = window.SIM;
  const SEED = 20261114; // 固定 seed：采集点布局确定，潮位窗口内可达（见 test.js）

  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const hud = document.getElementById('hud');
  const banner = document.getElementById('banner');

  let world = createWorld(SEED);
  let state = createState(world);

  /* ---------- 输入 ---------- */
  const keys = {};
  addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;
    if (e.key.toLowerCase() === 'r') restart();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(e.key.toLowerCase())) e.preventDefault();
    audio.unlock();
  });
  addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

  function readInput() {
    if (autoInput) return autoInput(state);
    const k = (n) => (keys[n] ? 1 : 0);
    return {
      turn: k('arrowleft') + k('a') - k('arrowright') - k('d'),
      throttle: Math.max(k('arrowup') || k('w'), -0.4 * (k('arrowdown') || k('s'))),
    };
  }

  function restart() {
    world = createWorld(SEED);
    state = createState(world);
    wake.length = 0;
    prevDone = 0; prevSkirt = WORLD.skirtMax;
  }

  /* 自动化钩子：E2E 测试与演示用 */
  let autoInput = null;
  window.__game = {
    world: () => world,
    state: () => state,
    setAuto: (fn) => { autoInput = fn; },
    restart,
    ff: (sec) => { // 同步快进（渲染仍在下一帧刷新）
      const n = Math.round(sec * 60);
      for (let i = 0; i < n && state.status === 'running'; i++) {
        step(world, state, autoInput ? autoInput(state) : { turn: 0, throttle: 0 }, 1 / 60);
        spawnWake(1 / 60);
      }
      return state.status;
    },
  };

  /* ---------- Web Audio：气垫噪声 + 警报 ---------- */
  const audio = {
    ctx: null, fanGain: null, fanFilter: null, alarmOsc: null, alarmGain: null,
    unlock() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ac = this.ctx = new AC();
      // 气垫风扇：循环噪声 → 带通滤波 → 增益随油门
      const len = ac.sampleRate * 2;
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = ac.createBufferSource();
      src.buffer = buf; src.loop = true;
      this.fanFilter = ac.createBiquadFilter();
      this.fanFilter.type = 'bandpass'; this.fanFilter.frequency.value = 420; this.fanFilter.Q.value = 0.8;
      this.fanGain = ac.createGain(); this.fanGain.gain.value = 0;
      src.connect(this.fanFilter).connect(this.fanGain).connect(ac.destination);
      src.start();
      // 警报：方波，通断由告警状态控制
      this.alarmOsc = ac.createOscillator();
      this.alarmOsc.type = 'square'; this.alarmOsc.frequency.value = 880;
      this.alarmGain = ac.createGain(); this.alarmGain.gain.value = 0;
      this.alarmOsc.connect(this.alarmGain).connect(ac.destination);
      this.alarmOsc.start();
    },
    ping() { // 巡检完成提示音
      if (!this.ctx) return;
      const ac = this.ctx, o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(660, ac.currentTime);
      o.frequency.setValueAtTime(990, ac.currentTime + 0.12);
      g.gain.setValueAtTime(0.18, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.5);
      o.connect(g).connect(ac.destination);
      o.start(); o.stop(ac.currentTime + 0.5);
    },
    thud() { // 撞桩闷响
      if (!this.ctx) return;
      const ac = this.ctx, o = ac.createOscillator(), g = ac.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(90, ac.currentTime);
      o.frequency.exponentialRampToValueAtTime(40, ac.currentTime + 0.25);
      g.gain.setValueAtTime(0.5, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.3);
      o.connect(g).connect(ac.destination);
      o.start(); o.stop(ac.currentTime + 0.3);
    },
    update(dt, t) {
      if (!this.ctx) return;
      const c = state.craft;
      const skirt = state.skirt / WORLD.skirtMax;
      const target = 0.03 + c.throttle * 0.16 * (0.6 + 0.4 * skirt);
      this.fanGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.08);
      this.fanFilter.frequency.setTargetAtTime(320 + c.throttle * 500, this.ctx.currentTime, 0.1);
      // 告警：潮水逼近 或 底裙重伤 → 间歇鸣响
      const tideNear = state.tideY > state.craft.y - 160;
      const danger = (tideNear && state.craft.y < WORLD.exitY) || state.skirt < 35;
      const beep = danger && state.status === 'running' && (t % 0.8) < 0.4;
      this.alarmGain.gain.setTargetAtTime(beep ? 0.07 : 0, this.ctx.currentTime, 0.02);
      this.alarmOsc.frequency.value = state.skirt < 35 ? 620 : 880;
    },
  };

  /* ---------- 泥滩纹理（离屏预渲染，seed 固定） ---------- */
  const mudTex = document.createElement('canvas');
  mudTex.width = WORLD.W; mudTex.height = WORLD.H;
  (function paintMud() {
    const g = mudTex.getContext('2d');
    const rng = window.SIM.makeRng(SEED ^ 0x5eed);
    const grad = g.createLinearGradient(0, 0, 0, WORLD.H);
    grad.addColorStop(0, '#5d4f3a');
    grad.addColorStop(0.6, '#6e5f45');
    grad.addColorStop(1, '#7a6a4d');
    g.fillStyle = grad;
    g.fillRect(0, 0, WORLD.W, WORLD.H);
    // 泥块斑驳
    for (let i = 0; i < 2600; i++) {
      const x = rng() * WORLD.W, y = rng() * WORLD.H, r = 2 + rng() * 14;
      g.fillStyle = `rgba(${40 + rng() * 60 | 0},${34 + rng() * 48 | 0},${22 + rng() * 30 | 0},${0.05 + rng() * 0.1})`;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    // 潮水冲刷的波纹脊线
    g.strokeStyle = 'rgba(30,24,14,0.09)';
    for (let i = 0; i < 55; i++) {
      const y0 = WORLD.tideStartY + rng() * (WORLD.exitY - WORLD.tideStartY);
      g.lineWidth = 1 + rng() * 1.5;
      g.beginPath();
      for (let x = 0; x <= WORLD.W; x += 40) {
        const y = y0 + Math.sin(x * 0.02 + i) * 6 + (rng() - 0.5) * 3;
        x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
    }
    // 水洼反光
    for (let i = 0; i < 60; i++) {
      const x = rng() * WORLD.W, y = WORLD.tideStartY + rng() * (WORLD.H - WORLD.tideStartY);
      g.fillStyle = `rgba(150,180,200,${0.04 + rng() * 0.07})`;
      g.beginPath(); g.ellipse(x, y, 14 + rng() * 40, 4 + rng() * 8, 0, 0, 7); g.fill();
    }
  })();

  /* ---------- 气泡尾迹 ---------- */
  const wake = [];
  function spawnWake(dt) {
    const c = state.craft;
    const speed = Math.hypot(c.vx, c.vy);
    if (c.throttle > 0.15 && speed > 20 && state.status === 'running') {
      const n = Math.min(4, speed / 60);
      for (let i = 0; i < n; i++) {
        const back = WORLD.craftRadius + 4;
        wake.push({
          x: c.x - Math.cos(c.heading) * back + (Math.random() - 0.5) * 14,
          y: c.y - Math.sin(c.heading) * back + (Math.random() - 0.5) * 14,
          r: 1.5 + Math.random() * 3,
          life: 1,
          vx: -c.vx * 0.12 + (Math.random() - 0.5) * 14,
          vy: -c.vy * 0.12 + (Math.random() - 0.5) * 14,
        });
      }
    }
    for (let i = wake.length - 1; i >= 0; i--) {
      const b = wake[i];
      b.life -= dt * 0.9;
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.r += dt * 6;
      if (b.life <= 0) wake.splice(i, 1);
    }
    if (wake.length > 400) wake.splice(0, wake.length - 400);
  }

  /* ---------- 渲染 ---------- */
  function render(t) {
    ctx.drawImage(mudTex, 0, 0);

    // 管线（埋地管线 → 虚线示踪 + 标志桩）
    for (const pipe of world.pipes) {
      ctx.strokeStyle = 'rgba(40,32,20,0.85)';
      ctx.lineWidth = 5;
      ctx.setLineDash([14, 10]);
      ctx.beginPath();
      ctx.moveTo(pipe.from.x, pipe.from.y);
      ctx.quadraticCurveTo(pipe.mid.x, pipe.mid.y, pipe.to.x, pipe.to.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(220,190,90,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pipe.from.x, pipe.from.y);
      ctx.quadraticCurveTo(pipe.mid.x, pipe.mid.y, pipe.to.x, pipe.to.y);
      ctx.stroke();
    }
    // 汇管站
    ctx.fillStyle = '#3a3f45';
    ctx.fillRect(world.manifold.x - 22, world.manifold.y - 12, 44, 24);
    ctx.fillStyle = '#c8d2da';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('汇管站', world.manifold.x, world.manifold.y + 4);

    // 残桩
    for (const s of world.stumps) {
      ctx.fillStyle = '#2e2118';
      ctx.beginPath();
      ctx.moveTo(s.x - s.r, s.y + s.r * 0.6);
      ctx.lineTo(s.x - s.r * 0.3, s.y - s.r);
      ctx.lineTo(s.x + s.r * 0.4, s.y - s.r * 0.7);
      ctx.lineTo(s.x + s.r, s.y + s.r * 0.6);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.stroke();
    }

    // 巡检点 + 进度环
    world.points.forEach((p, i) => {
      const insp = state.inspections[i];
      ctx.strokeStyle = insp.done ? 'rgba(80,220,120,0.9)' : 'rgba(255,210,80,0.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.arc(p.x, p.y, WORLD.inspectRadius, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = insp.done ? '#3fae5a' : '#c9a23a';
      ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(insp.done ? '✓' : 'P' + (i + 1), p.x, p.y + 4);
      if (!insp.done && insp.progress > 0) {
        ctx.strokeStyle = '#7fe0ff';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 16, -Math.PI / 2,
          -Math.PI / 2 + (insp.progress / WORLD.dwellTime) * Math.PI * 2);
        ctx.stroke();
      }
    });

    // 气泡尾迹
    for (const b of wake) {
      ctx.strokeStyle = `rgba(210,235,245,${0.55 * b.life})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.stroke();
    }

    // 坡道出口（南侧安全区）
    ctx.fillStyle = '#565d64';
    ctx.fillRect(0, WORLD.exitY, WORLD.W, WORLD.H - WORLD.exitY);
    ctx.strokeStyle = '#e8d44d';
    ctx.lineWidth = 3;
    ctx.setLineDash([20, 14]);
    ctx.beginPath(); ctx.moveTo(0, WORLD.exitY); ctx.lineTo(WORLD.W, WORLD.exitY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffd94d';
    ctx.font = 'bold 14px monospace';
    ctx.fillText('撤 离 坡 道', WORLD.W / 2, WORLD.exitY + 24);

    // 艇体（气垫裙 + 舱体 + 航向线）
    const c = state.craft;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.heading);
    const skirtRatio = state.skirt / WORLD.skirtMax;
    ctx.fillStyle = skirtRatio > 0.35 ? '#22282e' : '#3a2020';
    ctx.beginPath(); ctx.ellipse(0, 0, 22, 15, 0, 0, 7); ctx.fill(); // 底裙
    ctx.fillStyle = '#d8dee4';
    ctx.beginPath(); ctx.ellipse(2, 0, 15, 9, 0, 0, 7); ctx.fill();  // 舱体
    ctx.fillStyle = '#2b6cb0';
    ctx.beginPath(); ctx.ellipse(7, 0, 6, 5, 0, 0, 7); ctx.fill();   // 驾驶舱
    ctx.strokeStyle = '#ff5a4d';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(24, 0); ctx.stroke(); // 航向
    ctx.restore();

    // 海水 + 潮线（泡沫边）
    const tide = state.tideY;
    const wg = ctx.createLinearGradient(0, 0, 0, Math.max(tide, 1));
    wg.addColorStop(0, 'rgba(20,60,90,0.95)');
    wg.addColorStop(1, 'rgba(40,110,150,0.75)');
    ctx.fillStyle = wg;
    ctx.fillRect(0, 0, WORLD.W, tide);
    ctx.strokeStyle = 'rgba(230,250,255,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 0; x <= WORLD.W; x += 16) {
      const y = tide + Math.sin(x * 0.03 + t * 2.2) * 4 + Math.sin(x * 0.011 - t * 1.3) * 3;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  /* ---------- HUD ---------- */
  function updateHud() {
    const c = state.craft;
    const speed = Math.hypot(c.vx, c.vy);
    const slip = Math.abs(window.SIM.wrapAngle(
      Math.atan2(c.vy, c.vx) - c.heading)) * 180 / Math.PI;
    const tideGap = c.y - state.tideY;
    const tideEta = state.time < WORLD.tideHoldUntil
      ? `回流倒计时 ${(WORLD.tideHoldUntil - state.time).toFixed(0)}s`
      : `潮线距离 ${tideGap.toFixed(0)}m`;
    const pts = state.inspections.map((s, i) =>
      s.done ? `P${i + 1}✓` : `P${i + 1}${(s.progress / WORLD.dwellTime * 100) | 0}%`).join('  ');
    hud.textContent =
      `潮位窗口  ${tideEta}\n` +
      `巡检进度  ${pts}\n` +
      `底裙完好  ${'█'.repeat(Math.ceil(state.skirt / 10))}${'░'.repeat(10 - Math.ceil(state.skirt / 10))} ${state.skirt.toFixed(0)}%\n` +
      `航速 ${speed.toFixed(0)}  侧滑 ${speed > 30 ? slip.toFixed(0) + '°' : '—'}  泥阻 ×${window.SIM.mudDrag(state).toFixed(2)}`;
    if (state.status === 'won') {
      banner.textContent = `✓ 巡检完成，安全撤离（${state.time.toFixed(1)}s）— R 重来`;
      banner.style.color = '#7fe08a';
    } else if (state.status === 'failed') {
      banner.textContent = state.failReason === 'tide'
        ? '✗ 潮水封路，撤离失败 — R 重来' : '✗ 底裙破裂，艇体损毁 — R 重来';
      banner.style.color = '#ff6a5a';
    } else {
      banner.textContent = '';
    }
  }

  /* ---------- 主循环（固定步长） ---------- */
  const DT = 1 / 60;
  let last = performance.now(), acc = 0, prevDone = 0, prevSkirt = WORLD.skirtMax;
  function frame(now) {
    acc += Math.min(0.1, (now - last) / 1000);
    last = now;
    while (acc >= DT) {
      step(world, state, readInput(), DT);
      spawnWake(DT);
      acc -= DT;
    }
    if (state.doneCount > prevDone) { audio.ping(); prevDone = state.doneCount; }
    if (state.skirt < prevSkirt - 0.5) { audio.thud(); }
    prevSkirt = state.skirt;
    audio.update(DT, state.time);
    render(now / 1000);
    updateHud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
