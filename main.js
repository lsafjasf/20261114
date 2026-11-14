(function () {
  'use strict';

  const { createSim, CFG } = window.PumpSim;
  const { PumpPlayer, ValvePlayer } = window.PumpPilot;

  const sim = createSim();
  const audio = new window.PumpAudio();
  const pilots = { pump: new PumpPlayer(), valve: new ValvePlayer() };
  const canvas = document.getElementById('canvas');
  const ctx2d = canvas.getContext('2d');

  const state = {
    running: false,
    demo: false,
    keys: new Set(),
    lastFrame: performance.now(),
    acc: 0,
    lastAlarmCount: 0,
    cavitationSoundCooldown: 0
  };

  const el = {
    time: document.getElementById('hud-time'),
    steady: document.getElementById('hud-steady'),
    flow: document.getElementById('hud-flow'),
    damage: document.getElementById('hud-damage'),
    status: document.getElementById('hud-status'),
    steadyFill: document.getElementById('steady-fill'),
    alarmList: document.getElementById('alarm-list'),
    modal: document.getElementById('modal'),
    modalTitle: document.getElementById('modal-title'),
    modalText: document.getElementById('modal-text'),
    modalCard: document.querySelector('.modal-card')
  };

  function fmtTime(t) {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function levelTag(p) {
    if (p.h < CFG.WARN_LOW || p.h > CFG.WARN_HIGH) return ['crit', '危险'];
    if (p.h < CFG.SAFE_LOW || p.h > CFG.SAFE_HIGH) return ['warn', '越限'];
    return ['ok', '安全'];
  }

  function buildSidePanels() {
    const valveHost = document.getElementById('valve-blocks');
    const pumpHost = document.getElementById('pump-blocks');
    sim.pools.forEach((p, i) => {
      const name = p.label;
      valveHost.insertAdjacentHTML('beforeend', `
        <div class="pool-block" data-vpool="${i}">
          <h3>${name} · 进水阀 <span class="tag" data-tag="v${i}">安全</span></h3>
          <div class="meter-row"><span>阀位开度</span><b data-v="valve${i}">0%</b></div>
          <div class="track valve"><i data-vbar="valve${i}"></i></div>
          <div class="meter-row"><span>来水压力（仅你可见）</span><b data-v="psrc${i}">0.00 MPa</b></div>
          <div class="track pressure"><i data-vbar="psrc${i}"></i></div>
          <div class="meter-row"><span>本阀进水流量</span><b data-v="qin${i}">0.000 m³/s</b></div>
          <div class="meter-row"><span class="blind">泵转速 / 出口压力</span><b class="blind">██ 对面席位</b></div>
          <div class="stepper">
            <button data-act="valve-up" data-i="${i}">开大 ▲</button>
            <button data-act="valve-down" data-i="${i}">关小 ▼</button>
          </div>
        </div>`);
      pumpHost.insertAdjacentHTML('beforeend', `
        <div class="pool-block" data-ppool="${i}">
          <h3>${name} · 排水泵 <span class="tag" data-tag="p${i}">安全</span></h3>
          <div class="meter-row"><span>泵转速设定</span><b data-v="pump${i}">0%</b></div>
          <div class="track pump"><i data-vbar="pump${i}"></i></div>
          <div class="meter-row"><span>出口压力（仅你可见）</span><b data-v="pout${i}">0.00 MPa</b></div>
          <div class="track pressure"><i data-vbar="pout${i}"></i></div>
          <div class="meter-row"><span>本泵排水流量</span><b data-v="qd${i}">0.000 m³/s</b></div>
          <div class="meter-row"><span>停泵计时</span><b data-v="stop${i}">0.0 s</b></div>
          <div class="meter-row"><span class="blind">阀位 / 来水压力</span><b class="blind">██ 对面席位</b></div>
          <div class="stepper">
            <button data-act="pump-up" data-i="${i}">升速 ▲</button>
            <button data-act="pump-down" data-i="${i}">降速 ▼</button>
          </div>
        </div>`);
    });
    document.querySelectorAll('.stepper button').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        audio.unlock();
        audio.click();
        const i = Number(btn.dataset.i);
        const fast = state.keys.has('Shift') || e.shiftKey;
        const step = fast ? 0.35 : 0.1;
        const p = sim.pools[i];
        if (btn.dataset.act === 'valve-up') sim.setValve(i, p.valveTarget + step, fast);
        if (btn.dataset.act === 'valve-down') sim.setValve(i, p.valveTarget - step, fast);
        if (btn.dataset.act === 'pump-up') sim.setPump(i, p.pumpTarget + step, fast);
        if (btn.dataset.act === 'pump-down') sim.setPump(i, p.pumpTarget - step, fast);
      });
    });
  }

  buildSidePanels();

  const KEY_MAP = {
    q: ['valve', 0, 1], a: ['valve', 0, -1],
    w: ['valve', 1, 1], s: ['valve', 1, -1],
    i: ['pump', 0, 1], k: ['pump', 0, -1],
    o: ['pump', 1, 1], l: ['pump', 1, -1]
  };

  window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (key === 'm') toggleMute();
    state.keys.add(key.length === 1 ? key : e.key);
    if (KEY_MAP[key] && !e.repeat) audio.unlock();
  });
  window.addEventListener('keyup', (e) => state.keys.delete(e.key.toLowerCase()));

  function applyKeyboard(dt) {
    const fast = state.keys.has('Shift');
    const rate = fast ? CFG.RATE_FAST : CFG.RATE_NORMAL;
    const move = rate * dt;
    Object.entries(KEY_MAP).forEach(([key, [kind, i, dir]]) => {
      if (!state.keys.has(key)) return;
      const p = sim.pools[i];
      if (kind === 'valve') sim.setValve(i, p.valveTarget + dir * move, fast);
      else sim.setPump(i, p.pumpTarget + dir * move, fast);
    });
  }

  function appendAlarm(entry) {
    const li = document.createElement('li');
    li.className = entry.sev;
    li.textContent = `${fmtTime(entry.t)}  ${entry.text}`;
    el.alarmList.appendChild(li);
    while (el.alarmList.children.length > 40) el.alarmList.removeChild(el.alarmList.firstChild);
    el.alarmList.scrollTop = el.alarmList.scrollHeight;
    const muted = el.alarmList.querySelector('.muted');
    if (muted) muted.remove();
  }

  function handleEvents() {
    sim.events.forEach((ev) => {
      if (ev.type === 'alarm') {
        appendAlarm(ev);
        audio.alarm(ev.sev === 'crit');
      } else if (ev.type === 'hammer') {
        audio.hammer(ev.severe);
      } else if (ev.type === 'lose') {
        finishGame(false, ev.reason);
      } else if (ev.type === 'win') {
        finishGame(true);
      }
    });
    if (sim.damageCav > 0) {
      state.cavitationSoundCooldown -= CFG.DT;
      if (state.cavitationSoundCooldown <= 0 && sim.pools.some((p) => p.h < CFG.CRIT_LOW && p.pump > 0.1)) {
        audio.cavitation();
        state.cavitationSoundCooldown = 0.5;
      }
    }
  }

  function finishGame(won, reason) {
    state.running = false;
    state.demo = false;
    audio.jingle(won);
    el.modalCard.classList.toggle('won', won);
    el.modalCard.classList.toggle('lost', !won);
    el.modalTitle.textContent = won ? '任务完成 · 协作稳态达成' : '任务失败';
    el.modalText.textContent = won
      ? `两个集水池在安全门限内稳定运行满 5 分钟，用时 ${fmtTime(sim.t)}。全程水锤事件 ${sim.stats.hammerEvents} 次。`
      : `${reason}（坚持了 ${fmtTime(sim.t)}）。点击复位后再试一次，注意沟通动作节奏。`;
    el.modal.classList.remove('hidden');
  }

  function setText(selector, value) {
    const node = document.querySelector(selector);
    if (node) node.textContent = value;
  }
  function setBar(selector, ratio) {
    const node = document.querySelector(selector);
    if (node) node.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  }

  function refreshPanels() {
    el.time.textContent = fmtTime(sim.t);
    el.steady.textContent = `${fmtTime(sim.steady)} / 5:00`;
    el.flow.textContent = sim.flowTotalDrain.toFixed(3);
    el.damage.textContent = `${Math.round(sim.damageHammer)}%`;
    el.steadyFill.style.width = `${(sim.steady / CFG.STEADY_TIME) * 100}%`;
    el.status.className = `hud-item status ${sim.status === 'lost' ? 'over' : sim.status === 'won' ? 'won' : ''}`;
    el.status.querySelector('b').textContent =
      sim.status === 'idle' ? '待机' : sim.status === 'won' ? '胜利' : sim.status === 'lost' ? '失败' : (state.demo ? '演示中' : '值班中');

    sim.pools.forEach((p, i) => {
      setText(`[data-v="valve${i}"]`, `${Math.round(p.valve * 100)}%`);
      setBar(`[data-vbar="valve${i}"]`, p.valve);
      setText(`[data-v="psrc${i}"]`, `${p.pSrc.toFixed(2)} MPa`);
      setBar(`[data-vbar="psrc${i}"]`, p.pSrc);
      setText(`[data-v="qin${i}"]`, `${p.qIn.toFixed(3)} m³/s`);
      setText(`[data-v="pump${i}"]`, `${Math.round(p.pump * 100)}%`);
      setBar(`[data-vbar="pump${i}"]`, p.pump);
      setText(`[data-v="pout${i}"]`, `${p.pOut.toFixed(2)} MPa`);
      setBar(`[data-vbar="pout${i}"]`, p.pOut / 1.6);
      setText(`[data-v="qd${i}"]`, `${p.qDrain.toFixed(3)} m³/s`);
      setText(`[data-v="stop${i}"]`, `${p.stopTimer.toFixed(1)} s`);
      const [cls, label] = levelTag(p);
      document.querySelectorAll(`[data-tag="v${i}"],[data-tag="p${i}"]`).forEach((tag) => {
        tag.className = `tag ${cls}`;
        tag.textContent = label;
      });
    });
  }

  function frame(now) {
    requestAnimationFrame(frame);
    let frameDt = (now - state.lastFrame) / 1000;
    state.lastFrame = now;
    frameDt = Math.min(frameDt, 0.1);
    if (state.running) {
      state.acc += frameDt;
      while (state.acc >= CFG.DT) {
        state.acc -= CFG.DT;
        if (state.demo) {
          pilots.valve.act(sim, CFG.DT);
          pilots.pump.act(sim, CFG.DT);
        } else {
          applyKeyboard(CFG.DT);
        }
        sim.step(CFG.DT);
        handleEvents();
        if (!state.running) break;
      }
    }
    drawScene(ctx2d, canvas, sim, CFG);
    refreshPanels();
    audio.update(sim);
  }

  function drawScene(g, canvas, sim, cfg) {
    const W = canvas.width;
    const H = canvas.height;
    g.clearRect(0, 0, W, H);

    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#101d2c');
    grad.addColorStop(1, '#070d14');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    g.strokeStyle = 'rgba(90,120,150,0.10)';
    g.lineWidth = 1;
    for (let x = 0; x < W; x += 48) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
    }
    for (let y = 0; y < H; y += 48) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }

    drawRockLayers(g, W, H, sim.t);
    drawGroundSlab(g, W, H);

    const tankTop = 96;
    const tankBottom = 430;
    const tankW = 250;
    const centers = [250, 700];

    centers.forEach((cx, i) => drawTank(g, sim.pools[i], cx, tankTop, tankBottom, tankW, cfg, sim.t));
    centers.forEach((cx, i) => drawPumpAndPipes(g, sim.pools[i], cx, tankBottom, tankW, sim.t));
    drawSharedHeader(g, sim, centers, tankBottom, W);
    drawFloodOverlay(g, sim, W, H);
  }

  function drawRockLayers(g, W, H, t) {
    const layers = [
      { y: 470, c: '#1a2a33', amp: 10 },
      { y: 500, c: '#16232b', amp: 14 },
      { y: 530, c: '#111d24', amp: 18 }
    ];
    layers.forEach((layer, li) => {
      g.fillStyle = layer.c;
      g.beginPath();
      g.moveTo(0, H);
      for (let x = 0; x <= W; x += 24) {
        const y = layer.y + Math.sin(x * 0.012 + li * 2 + t * 0.05) * layer.amp;
        g.lineTo(x, y);
      }
      g.lineTo(W, H);
      g.closePath();
      g.fill();
    });
  }

  function drawGroundSlab(g, W, H) {
    g.fillStyle = '#22303d';
    g.fillRect(0, 452, W, 18);
    g.fillStyle = '#2c3e4e';
    for (let x = 0; x < W; x += 64) g.fillRect(x, 452, 58, 4);
  }

  function drawTank(g, p, cx, top, bottom, w, cfg, t) {
    const x0 = cx - w / 2;
    const x1 = cx + w / 2;
    g.fillStyle = 'rgba(16,28,40,0.85)';
    g.fillRect(x0, top, w, bottom - top);
    g.strokeStyle = '#46607a';
    g.lineWidth = 3;
    g.strokeRect(x0, top, w, bottom - top);

    const span = bottom - top;
    const ySafeHigh = bottom - cfg.SAFE_HIGH * span;
    const ySafeLow = bottom - cfg.SAFE_LOW * span;
    g.setLineDash([10, 8]);
    g.strokeStyle = 'rgba(76,175,125,0.75)';
    g.lineWidth = 1.5;
    [ySafeHigh, ySafeLow].forEach((y) => {
      g.beginPath(); g.moveTo(x0 + 4, y); g.lineTo(x1 - 4, y); g.stroke();
    });
    g.setLineDash([]);
    g.fillStyle = 'rgba(76,175,125,0.85)';
    g.font = '12px sans-serif';
    g.fillText('安全门限 68%', x1 - 108, ySafeHigh - 6);
    g.fillText('安全门限 32%', x1 - 108, ySafeLow + 16);

    const waterH = p.h * span;
    const wy = bottom - waterH;
    const wg = g.createLinearGradient(0, wy, 0, bottom);
    const flash = p.hammerFlash;
    wg.addColorStop(0, flash > 0.4 ? '#ff9a5c' : '#3fb6d4');
    wg.addColorStop(1, flash > 0.4 ? '#a34a1f' : '#1d6f93');
    g.fillStyle = wg;
    g.fillRect(x0 + 3, wy, w - 6, waterH);

    g.strokeStyle = 'rgba(220,245,255,0.55)';
    g.lineWidth = 2;
    g.beginPath();
    for (let x = x0 + 4; x <= x1 - 4; x += 8) {
      const y = wy + Math.sin(x * 0.08 + t * 3) * 2.4;
      x === x0 + 4 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();

    g.fillStyle = '#d6e2ee';
    g.font = 'bold 15px sans-serif';
    g.fillText(p.label, x0 + 12, top + 22);
    g.font = 'bold 26px "Segoe UI", sans-serif';
    g.fillStyle = p.h > cfg.SAFE_HIGH || p.h < cfg.SAFE_LOW ? '#f0a832' : '#8fe3f0';
    g.fillText(`${Math.round(p.h * 100)}%`, x1 - 78, top + 30);
  }

  function drawPumpAndPipes(g, p, cx, tankBottom, tankW, t) {
    const x0 = cx - tankW / 2;
    const x1 = cx + tankW / 2;
    const pipeY = tankBottom + 34;
    const pumpX = cx + 40;

    g.strokeStyle = '#54708c';
    g.lineWidth = 14;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x0 - 70, 150);
    g.lineTo(x0, 150);
    g.lineTo(x0, pipeY);
    g.lineTo(pumpX - 26, pipeY);
    g.stroke();

    g.strokeStyle = '#5f7f9d';
    g.beginPath();
    g.moveTo(pumpX + 26, pipeY);
    g.lineTo(x1 + 60, pipeY);
    g.lineTo(x1 + 60, 500);
    g.stroke();

    drawValve(g, x0, 150, p.valve, p.inletHammer);
    drawGauge(g, x0 - 70, 110, p.pIn, '进水压力', p.inletHammer);
    drawPump(g, pumpX, pipeY, p.pump, p.outletHammer, t, p.label);
    drawGauge(g, pumpX + 78, pipeY - 52, p.pOut / 1.6, '出口压力', p.outletHammer);

    g.fillStyle = '#9fb6cb';
    g.font = '12px sans-serif';
    g.fillText(`进水 ${p.qIn.toFixed(3)}`, x0 - 60, 190);
    g.fillText(`排水 ${p.qDrain.toFixed(3)}`, pumpX + 56, pipeY + 34);
  }

  function drawValve(g, x, y, opening, hammer) {
    const size = 15 + opening * 8;
    g.save();
    g.translate(x, y);
    g.fillStyle = hammer > 0.3 ? '#ff7a4d' : '#c97b2f';
    g.strokeStyle = '#efc184';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-size, -size);
    g.lineTo(0, 0);
    g.lineTo(-size, size);
    g.closePath();
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(size, -size);
    g.lineTo(0, 0);
    g.lineTo(size, size);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = '#f4d9b0';
    g.fillRect(-3, -size - 14, 6, 14);
    g.restore();
    if (hammer > 0.05) {
      g.strokeStyle = `rgba(255,120,70,${hammer})`;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(x, y, 30 + (1 - hammer) * 24, 0, Math.PI * 2);
      g.stroke();
    }
  }

  function drawPump(g, x, y, speed, hammer, t, label) {
    g.fillStyle = '#1d3145';
    g.strokeStyle = hammer > 0.3 ? '#ff7a4d' : '#6fa3d0';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(x, y, 26, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.save();
    g.translate(x, y);
    g.rotate(t * speed * 10);
    g.strokeStyle = speed > 0.05 ? '#9fd4f5' : '#46607a';
    g.lineWidth = 3;
    for (let k = 0; k < 4; k++) {
      g.rotate(Math.PI / 2);
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(8, -6, 16, 0);
      g.stroke();
    }
    g.restore();
    g.fillStyle = '#9fd4f5';
    g.beginPath();
    g.arc(x, y, 4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#d6e2ee';
    g.font = '12px sans-serif';
    g.fillText(`${label}泵 ${Math.round(speed * 100)}%`, x - 30, y + 48);
    if (hammer > 0.05) {
      g.strokeStyle = `rgba(255,120,70,${hammer})`;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(x, y, 34 + (1 - hammer) * 26, 0, Math.PI * 2);
      g.stroke();
    }
  }

  function drawGauge(g, x, y, ratio, label, pulse) {
    const r = 22;
    g.fillStyle = '#0d1823';
    g.strokeStyle = pulse > 0.3 ? '#ff7a4d' : '#46607a';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    const ang = -Math.PI * 0.75 + Math.max(0, Math.min(1, ratio)) * Math.PI * 1.5;
    g.strokeStyle = ratio > 0.85 ? '#ef5350' : '#37c7d6';
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(ang) * (r - 6), y + Math.sin(ang) * (r - 6));
    g.stroke();
    g.fillStyle = '#9fb6cb';
    g.font = '10px sans-serif';
    g.textAlign = 'center';
    g.fillText(label, x, y + r + 13);
    g.textAlign = 'left';
  }

  function drawSharedHeader(g, sim, centers, tankBottom, W) {
    const y = 500;
    g.strokeStyle = '#6d4f33';
    g.lineWidth = 16;
    g.beginPath();
    g.moveTo(centers[0] + 185, y);
    g.lineTo(centers[1] - 185, y);
    g.stroke();
    g.fillStyle = '#d6e2ee';
    g.font = '13px sans-serif';
    g.fillText(`共享排水集管  总流量 ${sim.flowTotalDrain.toFixed(3)} m³/s（调度区间 ${CFG.FLOW_MIN}–${CFG.FLOW_MAX}）`, W / 2 - 190, y + 38);
  }

  function drawFloodOverlay(g, sim, W, H) {
    const stopMax = Math.max(sim.pools[0].stopTimer, sim.pools[1].stopTimer);
    const ratio = Math.max(0, (stopMax - cfg.FLOOD_WARN) / (cfg.FLOOD_LOSE - cfg.FLOOD_WARN));
    if (ratio <= 0) return;
    const depth = ratio * 90;
    g.fillStyle = `rgba(40,120,160,${0.25 + ratio * 0.3})`;
    g.fillRect(0, H - depth, W, depth);
    g.fillStyle = '#ffd27d';
    g.font = 'bold 16px sans-serif';
    g.fillText('⚠ 平台积水上涨中', 24, H - depth - 10);
  }

  function toggleMute() {
    const muted = audio.setMuted(!state.muted);
    state.muted = muted;
    document.getElementById('btn-mute').textContent = muted ? '🔇 静音' : '🔊 音效';
  }

  document.getElementById('btn-mute').addEventListener('click', toggleMute);
  document.getElementById('modal-close').addEventListener('click', () => el.modal.classList.add('hidden'));

  document.getElementById('btn-start').addEventListener('click', () => {
    audio.unlock();
    if (sim.status === 'idle') sim.start();
    state.running = true;
    state.demo = false;
    state.lastFrame = performance.now();
  });

  document.getElementById('btn-demo').addEventListener('click', () => {
    audio.unlock();
    if (sim.status === 'idle') sim.start();
    state.running = true;
    state.demo = true;
    state.lastFrame = performance.now();
    el.alarmList.innerHTML = '';
  });

  document.getElementById('btn-reset').addEventListener('click', () => {
    sim.reset();
    pilots.pump = new PumpPlayer();
    pilots.valve = new ValvePlayer();
    state.running = false;
    state.demo = false;
    state.acc = 0;
    state.lastFrame = performance.now();
    el.modal.classList.add('hidden');
    el.alarmList.innerHTML = '<li class="muted">系统复位，等待值班开始……</li>';
    refreshPanels();
  });

  refreshPanels();
  requestAnimationFrame((t) => { state.lastFrame = t; requestAnimationFrame(frame); });

  window.__pumpGame = { sim, state, el, audio, pilots, frame };
})();
