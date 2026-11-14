// game.js — 渲染、音频与交互
/* global WaterSim */
(function () {
  'use strict';
  const Sim = WaterSim;
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;

  let sim = null;
  let running = false;
  let lastReal = 0;
  let simAcc = 0;
  const SIM_SPEED = 4; // 1 现实秒 = 4 模拟秒（20 分钟模拟 ≈ 5 分钟实机）
  const flocs = [];   // 絮体粒子（视觉）
  const flowDots = [];// 管线水流点（视觉）

  // ---------- 音频：泵声随产水流量变化 ----------
  const AudioSys = {
    ctx: null, osc: null, osc2: null, gain: null, noise: null, noiseGain: null,
    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0;
      this.gain.connect(this.ctx.destination);
      this.osc = this.ctx.createOscillator();
      this.osc.type = 'sawtooth';
      this.osc2 = this.ctx.createOscillator();
      this.osc2.type = 'sine';
      const g2 = this.ctx.createGain(); g2.gain.value = 0.5;
      this.osc.connect(this.gain);
      this.osc2.connect(g2); g2.connect(this.gain);
      // 水流噪声
      const len = this.ctx.sampleRate * 2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = this.ctx.createBufferSource();
      this.noise.buffer = buf; this.noise.loop = true;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 900;
      this.noiseGain = this.ctx.createGain(); this.noiseGain.gain.value = 0;
      this.noise.connect(lp); lp.connect(this.noiseGain);
      this.noiseGain.connect(this.ctx.destination);
      this.osc.start(); this.osc2.start(); this.noise.start();
    },
    update(flow) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const f = 45 + flow * 1.1; // 泵速频率
      this.osc.frequency.setTargetAtTime(f, t, 0.1);
      this.osc2.frequency.setTargetAtTime(f * 2.01, t, 0.1);
      this.gain.gain.setTargetAtTime(Math.min(0.12, flow * 0.0016), t, 0.15);
      this.noiseGain.gain.setTargetAtTime(Math.min(0.05, flow * 0.0007), t, 0.2);
    },
    alarm() {
      if (!this.ctx) return;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = 'square'; o.frequency.value = 660;
      g.gain.setValueAtTime(0.08, this.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.5);
      o.connect(g); g.connect(this.ctx.destination);
      o.start(); o.stop(this.ctx.currentTime + 0.5);
    },
  };

  // ---------- UI 绑定 ----------
  const $ = (id) => document.getElementById(id);
  const els = {
    dose: $('cDose'), sed: $('cSed'), fil: $('cFil'),
    vDose: $('vDose'), vSed: $('vSed'), vFil: $('vFil'), vOpt: $('vOpt'),
    log: $('log'), overlay: $('overlay'),
  };

  function bindControls() {
    els.dose.value = sim.dose; els.sed.value = sim.sedTime; els.fil.value = sim.filterSpeed;
    els.dose.oninput = () => { sim.dose = +els.dose.value; };
    els.sed.oninput = () => { sim.sedTime = +els.sed.value; };
    els.fil.oninput = () => { sim.filterSpeed = +els.fil.value; };
    $('btnBackwash').onclick = () => Sim.backwash(sim);
    $('btnDesludge').onclick = () => Sim.desludge(sim);
  }

  function fmtTime(t) {
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function setHud(id, text, cls) {
    const el = $(id);
    el.textContent = text;
    el.className = cls || '';
  }

  let lastEventCount = 0;

  // ---------- 视觉：池体布局 ----------
  const TOP = 110, BOT = 470;
  const TANKS = {
    raw:   { x: 20,  w: 120, label: '原水水库' },
    mix:   { x: 180, w: 90,  label: '混合池' },
    floc:  { x: 310, w: 150, label: '絮凝池' },
    sed:   { x: 500, w: 200, label: '沉淀池' },
    filt:  { x: 740, w: 150, label: '滤池' },
    clear: { x: 930, w: 210, label: '清水库' },
  };
  const PIPES = [ // [fromTank, toTank]
    ['raw', 'mix'], ['mix', 'floc'], ['floc', 'sed'], ['sed', 'filt'], ['filt', 'clear'],
  ];

  function turbColor(ntu) {
    // 浊度 → 水色：浑浊棕 → 清澈蓝
    const k = Math.min(1, Math.log10(1 + ntu) / 2); // 0 清 → 1 浊
    const r = Math.round(40 + (148 - 40) * k);
    const g = Math.round(120 + (104 - 120) * k);
    const b = Math.round(200 + (58 - 200) * k);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function initVisuals() {
    flocs.length = 0; flowDots.length = 0;
    for (let i = 0; i < 60; i++) {
      flocs.push({
        zone: i < 25 ? 'floc' : 'sed',
        x: 0, y: 0, vx: 0, vy: 0,
        r: 1 + Math.random() * 3,
        seed: Math.random() * 1000,
      });
    }
    for (const p of flocs) resetFloc(p, true);
    for (let i = 0; i < 40; i++) flowDots.push({ seg: (Math.random() * PIPES.length) | 0, k: Math.random() });
  }

  function resetFloc(p, randomY) {
    const t = TANKS[p.zone];
    p.x = t.x + 8 + Math.random() * (t.w - 16);
    p.y = randomY ? TOP + 40 + Math.random() * (BOT - TOP - 80) : TOP + 40;
    p.vx = (Math.random() - 0.5) * 6;
  }

  function syncVisuals(dt) {
    if (!sim) return;
    const q = sim.flocQuality;
    for (const p of flocs) {
      p.seed += dt;
      if (p.zone === 'floc') {
        // 絮凝池：缓慢搅动
        p.x += (p.vx + Math.sin(p.seed * 1.5) * 8) * dt;
        p.y += Math.cos(p.seed) * 5 * dt;
        const t = TANKS.floc;
        if (p.x < t.x + 6 || p.x > t.x + t.w - 6) p.vx *= -1;
        p.y = Math.max(TOP + 36, Math.min(BOT - 20, p.y));
      } else {
        // 沉淀池：絮体下沉，沉底后重生
        p.y += (10 + q * 40 * (p.r / 4)) * dt;
        p.x += Math.sin(p.seed) * 4 * dt;
        const sludgeTop = BOT - 6 - sim.sludge * 0.5;
        if (p.y > sludgeTop) resetFloc(p, false);
      }
    }
    const speed = sim.flow / 80;
    for (const d of flowDots) {
      d.k += dt * speed * 1.5;
      if (d.k >= 1) { d.k = 0; d.seg = (d.seg + 1) % PIPES.length; }
    }
  }

  // ---------- 绘制 ----------
  function drawTank(t, waterTop, ntu) {
    ctx.strokeStyle = '#3a5a7a';
    ctx.lineWidth = 2;
    ctx.strokeRect(t.x, TOP, t.w, BOT - TOP);
    ctx.fillStyle = turbColor(ntu);
    ctx.globalAlpha = 0.85;
    ctx.fillRect(t.x + 1, waterTop, t.w - 2, BOT - waterTop - 1);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#8fb3d1';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t.label, t.x + t.w / 2, TOP - 10);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0e1a29';
    ctx.fillRect(0, 0, W, H);
    if (!sim) return;

    // 管线
    const pipeY = TOP + 150;
    for (const [a, b] of PIPES) {
      const ta = TANKS[a], tb = TANKS[b];
      ctx.strokeStyle = '#2c4a66';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(ta.x + ta.w, pipeY);
      ctx.lineTo(tb.x, pipeY);
      ctx.stroke();
    }
    // 管线水流点
    ctx.fillStyle = '#7fd4ff';
    for (const d of flowDots) {
      const [a, b] = PIPES[d.seg];
      const ta = TANKS[a], tb = TANKS[b];
      const x = ta.x + ta.w + (tb.x - ta.x - ta.w) * d.k;
      ctx.beginPath();
      ctx.arc(x, pipeY, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // 池体（水位：水库/清水库变动，工艺池近满）
    drawTank(TANKS.raw, BOT - sim.rawStorage / 100 * (BOT - TOP - 10) - 5, sim.rawNTU);
    drawTank(TANKS.mix, TOP + 30, sim.rawNTU);
    drawTank(TANKS.floc, TOP + 30, sim.rawNTU * 0.9);
    drawTank(TANKS.sed, TOP + 30, sim.settledNTU);
    drawTank(TANKS.filt, TOP + 30, sim.settledNTU);
    drawTank(TANKS.clear, BOT - sim.storage / Sim.CLEAR_CAP * (BOT - TOP - 10) - 5, sim.effluentNTU);

    // 加药装置与滴药
    const mt = TANKS.mix;
    ctx.fillStyle = '#274b38';
    ctx.fillRect(mt.x + mt.w / 2 - 18, TOP - 58, 36, 34);
    ctx.fillStyle = '#8fb3d1';
    ctx.fillText('混凝剂', mt.x + mt.w / 2, TOP - 64);
    ctx.strokeStyle = '#7fe0a8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mt.x + mt.w / 2, TOP - 24);
    ctx.lineTo(mt.x + mt.w / 2, TOP);
    ctx.stroke();
    if (sim.dose > 0.5) {
      const dripK = (performance.now() / (600 - sim.dose * 8)) % 1;
      ctx.fillStyle = '#7fe0a8';
      ctx.beginPath();
      ctx.arc(mt.x + mt.w / 2, TOP + dripK * 26, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 絮体粒子
    for (const p of flocs) {
      const size = p.zone === 'floc'
        ? p.r * (0.5 + sim.flocQuality)
        : p.r * (0.4 + sim.flocQuality * 0.8);
      ctx.fillStyle = 'rgba(210,180,130,0.8)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    // 沉淀池污泥层
    const st = TANKS.sed;
    const sh = sim.sludge * 0.5;
    ctx.fillStyle = sim.sludgeAlarm ? '#8a3b2e' : '#5a4632';
    ctx.fillRect(st.x + 1, BOT - 1 - sh, st.w - 2, sh);

    // 滤池砂床 + 截留杂质
    const ft = TANKS.filt;
    ctx.fillStyle = '#c2a878';
    ctx.fillRect(ft.x + 1, BOT - 90, ft.w - 2, 89);
    ctx.fillStyle = 'rgba(90,60,30,' + (sim.headloss / 100 * 0.8) + ')';
    ctx.fillRect(ft.x + 1, BOT - 90, ft.w - 2, 30 + sim.headloss * 0.3);
    if (sim.backwashLeft > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      for (let i = 0; i < 8; i++) {
        const bx = ft.x + 10 + i * (ft.w - 20) / 7;
        const by = BOT - 20 - ((performance.now() / 5 + i * 40) % 70);
        ctx.beginPath(); ctx.arc(bx, by, 3, 0, Math.PI * 2); ctx.fill();
      }
    }

    drawStatusBanner();
  }

  function drawStatusBanner() {
    let msg = null, color = '#ffc94d';
    if (sim._breaking) { msg = '⚠ 滤池穿透！'; color = '#ff6b6b'; }
    else if (sim.sludgeAlarm) { msg = '⚠ 污泥压力过高'; color = '#ff6b6b'; }
    else if (sim.backwashLeft > 0) msg = '反冲洗中…';
    else if (sim.desludgeLeft > 0) msg = '排泥中…';
    else if (sim.throttled) msg = '⚠ 原水不足，降产运行';
    else if (sim.rationing) msg = '⚠ 清水库存偏低，限供中';
    if (!msg) return;
    if (color === '#ff6b6b' && Math.floor(performance.now() / 400) % 2) return; // 闪烁
    ctx.fillStyle = color;
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(msg, W / 2, 40);
  }
  function pushLog() {
    for (; lastEventCount < sim.events.length; lastEventCount++) {
      const e = sim.events[lastEventCount];
      const div = document.createElement('div');
      div.innerHTML = '<span class="t">[' + fmtTime(e.t) + ']</span>' + e.msg;
      if (e.type === 'breakthrough' || e.type === 'sludge') {
        div.style.color = '#ff6b6b';
        AudioSys.alarm();
      } else if (e.type === 'throttle' || e.type === 'ration') {
        div.style.color = '#ffc94d';
      }
      els.log.appendChild(div);
    }
    els.log.scrollTop = els.log.scrollHeight;
  }

  function updateHud() {
    setHud('hTime', fmtTime(sim.t));
    setHud('hRaw', sim.rawNTU.toFixed(1));
    setHud('hSet', sim.settledNTU.toFixed(2));
    setHud('hEff', sim.effluentNTU.toFixed(2),
      sim.effluentNTU > Sim.STANDARD_NTU ? 'bad' : '');
    setHud('hSto', sim.storage.toFixed(0) + ' m³',
      sim.rationing ? 'warn' : '');
    setHud('hSlu', sim.sludge.toFixed(0) + '%', sim.sludgeAlarm ? 'bad' : sim.sludge > 75 ? 'warn' : '');
    setHud('hHead', sim.headloss.toFixed(0) + '%', sim.headloss > 80 ? 'bad' : sim.headloss > 55 ? 'warn' : '');
    setHud('hFlow', sim.flow.toFixed(1), sim.throttled ? 'warn' : '');
    setHud('hRatio', (sim.compliantTime / Math.max(1, sim.t) * 100).toFixed(1) + '%');
    els.vDose.textContent = sim.dose.toFixed(1);
    els.vSed.textContent = sim.sedTime;
    els.vFil.textContent = sim.filterSpeed.toFixed(1);
    els.vOpt.textContent = Sim.optimalDose(sim.rawNTU).toFixed(0);
    $('btnBackwash').disabled = sim.backwashLeft > 0;
    $('btnDesludge').disabled = sim.desludgeLeft > 0;
  }

  function endGame() {
    running = false;
    AudioSys.update(0);
    const ratio = (sim.compliantTime / Sim.SIM_SECONDS * 100).toFixed(1);
    els.overlay.innerHTML =
      '<h2>' + (sim.success ? '运行成功！' : '运行失败') + '</h2>' +
      '<p>达标率 ' + ratio + '%（需 ≥90%） · 清水库存 ' + sim.storage.toFixed(0) +
      ' m³（需 ≥250）<br>滤池穿透 ' + sim.breakthroughs + ' 次' +
      (sim.dryOut ? ' · 清水库曾干涸' : '') + '</p>' +
      '<button onclick="location.reload()">重新开始</button>';
    els.overlay.classList.remove('hidden');
  }

  // ---------- 主循环 ----------
  function frame(now) {
    if (!running) return;
    const dtReal = Math.min(0.1, (now - lastReal) / 1000);
    lastReal = now;
    simAcc += dtReal * SIM_SPEED;
    while (simAcc >= 1 && !sim.over) { Sim.step(sim, 1); simAcc -= 1; }
    syncVisuals(dtReal);
    draw();
    updateHud();
    pushLog();
    AudioSys.update(sim.flow);
    if (sim.over) { endGame(); return; }
    requestAnimationFrame(frame);
  }

  $('startBtn').onclick = () => {
    sim = Sim.createSim((Math.random() * 1e9) | 0);
    bindControls();
    initVisuals();
    AudioSys.init();
    els.overlay.classList.add('hidden');
    running = true;
    lastReal = performance.now();
    requestAnimationFrame(frame);
  };
})();
