// 山区灌溉渠 · 渲染 / 输入 / 音频
(function () {
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const CFG = Sim.CFG;

  let state = Sim.createState();
  let running = false;
  let acc = 0;
  let lastTs = 0;
  let dashOffset = 0;
  let sensorFlash = 0; // 读数刷新高亮计时

  // ---------- 音频：水声随闸门开度与流量变化 ----------
  let audio = null;
  function initAudio() {
    if (audio) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    const len = ac.sampleRate * 2;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { // 布朗噪声，更像水声
      const w = Math.random() * 2 - 1;
      b = (b + 0.02 * w) / 1.02;
      d[i] = b * 3.5;
    }
    const src = ac.createBufferSource();
    src.buffer = buf; src.loop = true;
    const filt = ac.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 500;
    const gain = ac.createGain();
    gain.gain.value = 0;
    src.connect(filt); filt.connect(gain); gain.connect(ac.destination);
    src.start();
    audio = { ac, filt, gain };
  }

  function updateAudio() {
    if (!audio) return;
    const f = state.flows;
    const flow = f.qIn + f.qSluice + (f.qLeak || 0);
    const gateMix = (state.gates.intake.cur + state.gates.sluice.cur) / 2;
    const targetGain = running && state.status === 'playing'
      ? Math.min(0.22, 0.01 + flow * 0.035) : 0;
    const targetFreq = 350 + 2200 * gateMix + (state.surge.active ? 500 : 0);
    audio.gain.gain.setTargetAtTime(targetGain, audio.ac.currentTime, 0.15);
    audio.filt.frequency.setTargetAtTime(targetFreq, audio.ac.currentTime, 0.2);
  }

  function beep(freq, dur, when) {
    if (!audio) return;
    const ac = audio.ac;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.15, ac.currentTime + when);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + when + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(ac.currentTime + when); o.stop(ac.currentTime + when + dur);
  }

  // ---------- 输入 ----------
  const sliders = {
    intake: document.getElementById('gIntake'),
    divert: document.getElementById('gDivert'),
    sluice: document.getElementById('gSluice'),
  };
  const labels = {
    intake: document.getElementById('vIntake'),
    divert: document.getElementById('vDivert'),
    sluice: document.getElementById('vSluice'),
  };
  function applySlider(name) {
    const v = sliders[name].value / 100;
    Sim.setGate(state, name, v);
    labels[name].textContent = sliders[name].value + '%';
  }
  Object.keys(sliders).forEach((n) => {
    sliders[n].addEventListener('input', () => applySlider(n));
  });

  const keyMap = { q: ['intake', 5], a: ['intake', -5], w: ['divert', 5], s: ['divert', -5], e: ['sluice', 5], d: ['sluice', -5] };
  document.addEventListener('keydown', (ev) => {
    const m = keyMap[ev.key.toLowerCase()];
    if (!m || !running) return;
    const s = sliders[m[0]];
    s.value = Math.max(0, Math.min(100, Number(s.value) + m[1]));
    applySlider(m[0]);
  });

  function reset() {
    state = Sim.createState();
    Object.keys(sliders).forEach((n) => { sliders[n].value = 0; applySlider(n); });
    document.getElementById('overlay').style.display = 'none';
    acc = 0;
  }

  document.getElementById('btnStart').addEventListener('click', () => {
    initAudio(); reset(); running = true;
  });
  document.getElementById('ovBtn').addEventListener('click', () => {
    initAudio(); reset(); running = true;
  });

  // ---------- 场景几何 ----------
  const LAY = {
    canalTop: 150, canalBed: 190, canalX0: 128, canalX1: 770,
    srcX0: 26, srcX1: 126, srcTop: 96,
    intakeX: 128, divertX: 600,
    branchX0: 616, branchX1: 656, distY0: 350, distY1: 372,
    fieldTop: 400, fieldBed: 512,
    fields: [{ x0: 150, x1: 300 }, { x0: 340, x1: 490 }, { x0: 530, x1: 680 }],
    resX0: 770, resX1: 930, resTop: 150, resBed: 470,
    riverX0: 700, riverY0: 512, riverY1: 546,
  };
  const QMAX = CFG.sourceBase + CFG.surgeMag;

  function flowDashes(x0, y0, x1, y1, q, color) {
    if (q < 0.05) return;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.floor(len / 26);
    const speed = q * 60;
    ctx.strokeStyle = color || 'rgba(200,235,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const t = ((i / n) + (dashOffset * speed / 26 / 60) % 1) % 1;
      const px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
      ctx.moveTo(px, py);
      ctx.lineTo(px + (x1 - x0) / len * 8, py + (y1 - y0) / len * 8);
    }
    ctx.stroke();
  }

  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#2b4158'); sky.addColorStop(0.5, '#22303f'); sky.addColorStop(1, '#1c2836');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    // 远山
    ctx.fillStyle = '#31465c';
    ctx.beginPath();
    ctx.moveTo(0, 150); ctx.lineTo(90, 40); ctx.lineTo(200, 150);
    ctx.moveTo(120, 150); ctx.lineTo(260, 60); ctx.lineTo(400, 150);
    ctx.fill();
    ctx.fillStyle = '#3c5a78';
    ctx.beginPath(); ctx.moveTo(60, 150); ctx.lineTo(140, 70); ctx.lineTo(230, 150); ctx.fill();
    // 地面
    ctx.fillStyle = '#2c3a2e';
    ctx.fillRect(0, LAY.fieldBed, W, H - LAY.fieldBed);
    ctx.fillStyle = '#33453a';
    ctx.fillRect(0, LAY.canalBed, W, 8);
  }

  function drawGateSlab(x, yTop, yBed, open, label) {
    const h = (yBed - yTop) * (1 - open);
    ctx.fillStyle = '#8a97a5';
    ctx.fillRect(x - 6, yTop - 14, 12, h + 14);
    ctx.fillStyle = '#5c6873';
    ctx.fillRect(x - 9, yTop - 18, 18, 6);
    ctx.fillStyle = '#cfe3f5';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, yTop - 24);
    ctx.fillText(Math.round(open * 100) + '%', x, yBed + 16);
  }

  function drawSourceAndCanal() {
    const f = state.flows;
    // 山溪源池
    ctx.fillStyle = '#3a3f46';
    ctx.fillRect(LAY.srcX0 - 6, LAY.srcTop, LAY.srcX1 - LAY.srcX0 + 12, LAY.canalBed - LAY.srcTop + 6);
    ctx.fillStyle = state.surge.active ? '#3f9fd8' : '#2f7fb8';
    ctx.fillRect(LAY.srcX0, LAY.srcTop + 14, LAY.srcX1 - LAY.srcX0, LAY.canalBed - LAY.srcTop - 14);
    ctx.fillStyle = '#dcecf8'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('山溪', (LAY.srcX0 + LAY.srcX1) / 2, LAY.srcTop + 8);
    if (state.surge.active) {
      ctx.fillStyle = '#ffcf5c'; ctx.font = 'bold 13px sans-serif';
      ctx.fillText('⚠ 山洪', (LAY.srcX0 + LAY.srcX1) / 2, LAY.srcTop - 8);
    }
    // 干渠
    ctx.fillStyle = '#3a3f46';
    ctx.fillRect(LAY.canalX0, LAY.canalTop, LAY.canalX1 - LAY.canalX0, LAY.canalBed - LAY.canalTop + 6);
    const depth = Math.min(1, f.qIn / QMAX) * (LAY.canalBed - LAY.canalTop - 4);
    ctx.fillStyle = '#2f7fb8';
    ctx.fillRect(LAY.canalX0, LAY.canalBed - depth, LAY.canalX1 - LAY.canalX0, depth);
    flowDashes(LAY.canalX0 + 10, LAY.canalBed - depth / 2, LAY.canalX1 - 10, LAY.canalBed - depth / 2, f.qIn);
    // 进水闸
    drawGateSlab(LAY.intakeX, LAY.canalTop, LAY.canalBed, state.gates.intake.cur, '进水闸');
  }

  function drawBranch() {
    const f = state.flows;
    // 支渠：junction 下行 + 横向配水渠
    ctx.fillStyle = '#3a3f46';
    ctx.fillRect(LAY.branchX0, LAY.canalBed, LAY.branchX1 - LAY.branchX0, LAY.distY1 - LAY.canalBed);
    ctx.fillRect(LAY.fields[0].x0, LAY.distY0, LAY.branchX1 - LAY.fields[0].x0, LAY.distY1 - LAY.distY0);
    if (f.qField > 0.05) {
      ctx.fillStyle = '#2f7fb8';
      ctx.fillRect(LAY.branchX0 + 4, LAY.canalBed, LAY.branchX1 - LAY.branchX0 - 8, LAY.distY1 - LAY.canalBed);
      ctx.fillRect(LAY.fields[0].x0, LAY.distY0 + 4, LAY.branchX1 - LAY.fields[0].x0, LAY.distY1 - LAY.distY0 - 8);
      flowDashes(LAY.branchX1 - 14, LAY.distY0 + 12, LAY.fields[0].x0 + 10, LAY.distY0 + 12, f.qField);
    }
    // 分流闸（画在岔口）
    drawGateSlab(LAY.divertX + 36, LAY.canalTop, LAY.canalBed, state.gates.divert.cur, '分流闸');
    // 当前灌溉的田：落水口
    const k = state.fields.findIndex((fl) => !fl.done);
    if (k >= 0 && f.qField > 0.05) {
      const cx = (LAY.fields[k].x0 + LAY.fields[k].x1) / 2;
      ctx.fillStyle = '#4aa3dd';
      ctx.fillRect(cx - 7, LAY.distY1, 14, LAY.fieldTop - LAY.distY1);
      flowDashes(cx, LAY.distY1 + 4, cx, LAY.fieldTop - 4, f.qField, 'rgba(230,245,255,0.8)');
    }
  }

  function drawFields() {
    const px = (LAY.fieldBed - LAY.fieldTop); // 像素高度
    for (let i = 0; i < 3; i++) {
      const c = CFG.fields[i], f = state.fields[i], g = LAY.fields[i];
      const scale = px / (c.max * 1.15);
      // 田埂与土壤
      ctx.fillStyle = '#4a3b2a';
      ctx.fillRect(g.x0 - 6, LAY.fieldTop - 6, g.x1 - g.x0 + 12, px + 12);
      ctx.fillStyle = '#5d4a33';
      ctx.fillRect(g.x0, LAY.fieldTop, g.x1 - g.x0, px);
      // 水层
      const wh = Math.min(px, f.L * scale);
      ctx.fillStyle = 'rgba(64,150,210,0.85)';
      ctx.fillRect(g.x0, LAY.fieldBed - wh, g.x1 - g.x0, wh);
      // 目标带（绿）与超限线（红）
      const yLo = LAY.fieldBed - c.lo * scale, yHi = LAY.fieldBed - c.hi * scale;
      ctx.fillStyle = 'rgba(90,200,120,0.18)';
      ctx.fillRect(g.x0, yHi, g.x1 - g.x0, yLo - yHi);
      ctx.strokeStyle = '#5ac878'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(g.x0, yLo); ctx.lineTo(g.x1, yLo);
      ctx.moveTo(g.x0, yHi); ctx.lineTo(g.x1, yHi); ctx.stroke();
      const yMax = LAY.fieldBed - c.max * scale;
      ctx.strokeStyle = '#e05c5c';
      ctx.beginPath(); ctx.moveTo(g.x0, yMax); ctx.lineTo(g.x1, yMax); ctx.stroke();
      ctx.setLineDash([]);
      // 名称与传感器读数（2 秒前的旧值）
      ctx.textAlign = 'center';
      ctx.fillStyle = '#dcecf8'; ctx.font = 'bold 13px sans-serif';
      ctx.fillText(c.name, (g.x0 + g.x1) / 2, LAY.fieldTop - 12);
      ctx.font = '12px monospace';
      ctx.fillStyle = sensorFlash > 0 ? '#8fe6a0' : '#9fd0ec';
      const sv = f.done ? '完成 ✓' : state.sensor.fields[i].toFixed(2) + ' m';
      ctx.fillText('传感 ' + sv, (g.x0 + g.x1) / 2, LAY.fieldBed + 18);
      if (f.done) { // 稻苗
        ctx.strokeStyle = '#6fd06f'; ctx.lineWidth = 2;
        ctx.beginPath();
        for (let x = g.x0 + 12; x < g.x1 - 6; x += 16) {
          ctx.moveTo(x, LAY.fieldBed - wh);
          ctx.lineTo(x - 3, LAY.fieldBed - wh - 12);
          ctx.moveTo(x, LAY.fieldBed - wh);
          ctx.lineTo(x + 3, LAY.fieldBed - wh - 12);
        }
        ctx.stroke();
      }
    }
  }

  function drawReservoir() {
    const f = state.flows;
    const r = CFG.reservoir;
    const scale = (LAY.resBed - LAY.resTop) / (r.hMax * 1.08);
    // 池体
    ctx.fillStyle = '#3a3f46';
    ctx.fillRect(LAY.resX0 - 8, LAY.resTop - 6, LAY.resX1 - LAY.resX0 + 16, LAY.resBed - LAY.resTop + 12);
    ctx.fillStyle = '#243646';
    ctx.fillRect(LAY.resX0, LAY.resTop, LAY.resX1 - LAY.resX0, LAY.resBed - LAY.resTop);
    // 水
    const wh = Math.min(LAY.resBed - LAY.resTop, state.H * scale);
    ctx.fillStyle = '#2f7fb8';
    ctx.fillRect(LAY.resX0, LAY.resBed - wh, LAY.resX1 - LAY.resX0, wh);
    // 干渠来水（跌入池）
    if (f.qRes > 0.05) {
      ctx.fillStyle = '#4aa3dd';
      ctx.fillRect(LAY.resX0 - 4, LAY.canalBed - 6, 10, LAY.resBed - wh - LAY.canalBed + 6);
    }
    // 最低/最高水位线
    const yMin = LAY.resBed - r.hMin * scale, yMax = LAY.resBed - r.hMax * scale;
    ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#e05c5c';
    ctx.beginPath(); ctx.moveTo(LAY.resX0, yMin); ctx.lineTo(LAY.resX1, yMin); ctx.stroke();
    ctx.strokeStyle = '#ffb04d';
    ctx.beginPath(); ctx.moveTo(LAY.resX0, yMax); ctx.lineTo(LAY.resX1, yMax); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
    ctx.fillStyle = '#e05c5c'; ctx.fillText('最低蓄水', LAY.resX0 + 4, yMin - 4);
    ctx.fillStyle = '#ffb04d'; ctx.fillText('漫顶线', LAY.resX0 + 4, yMax - 4);
    // 泄洪闸与下游河道
    drawGateSlab(LAY.resX1 + 8, LAY.resBed - 44, LAY.resBed, state.gates.sluice.cur, '泄洪闸');
    ctx.fillStyle = '#24425c';
    ctx.fillRect(LAY.riverX0, LAY.riverY0, W - LAY.riverX0, LAY.riverY1 - LAY.riverY0);
    const rq = f.qSluice + (f.qLeak || 0);
    if (rq > 0.03) {
      ctx.fillStyle = '#2f7fb8';
      const rh = Math.min(LAY.riverY1 - LAY.riverY0, 6 + rq * 8);
      ctx.fillRect(LAY.riverX0, LAY.riverY1 - rh, W - LAY.riverX0, rh);
      flowDashes(LAY.riverX0 + 8, LAY.riverY1 - rh / 2, W - 8, LAY.riverY1 - rh / 2, rq);
    }
    ctx.fillStyle = '#dcecf8'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('蓄水池', (LAY.resX0 + LAY.resX1) / 2, LAY.resTop - 12);
    ctx.font = '12px monospace';
    ctx.fillStyle = sensorFlash > 0 ? '#8fe6a0' : '#9fd0ec';
    ctx.fillText('传感 ' + state.sensor.H.toFixed(2) + ' m', (LAY.resX0 + LAY.resX1) / 2, LAY.resBed + 18);
  }

  function drawHUD() {
    // 剩余时间
    const left = Math.max(0, CFG.timeLimit - state.t);
    const mm = String(Math.floor(left / 60)).padStart(1, '0');
    const ss = String(Math.floor(left % 60)).padStart(2, '0');
    ctx.textAlign = 'left'; ctx.font = 'bold 16px monospace';
    ctx.fillStyle = left < 30 ? '#ff7a6b' : '#dcecf8';
    ctx.fillText('剩余时间 ' + mm + ':' + ss, 16, 28);
    // 传感器倒计时
    ctx.textAlign = 'right'; ctx.font = '12px sans-serif';
    ctx.fillStyle = '#9fb4c8';
    ctx.fillText('传感器下次更新', W - 130, 22);
    ctx.fillStyle = '#33465a';
    ctx.fillRect(W - 120, 12, 104, 10);
    ctx.fillStyle = '#4db2ff';
    ctx.fillRect(W - 120, 12, 104 * (1 - state.sensor.age / CFG.sensorInterval), 10);
    // 山洪预警横幅
    if (state.surge.active && state.status === 'playing') {
      ctx.textAlign = 'center'; ctx.font = 'bold 15px sans-serif';
      ctx.fillStyle = '#ffcf5c';
      ctx.fillText('⚠ 山洪来袭，上游流量激增！', W / 2, 28);
    }
    // 状态提示
    if (!running) {
      ctx.textAlign = 'center'; ctx.font = '15px sans-serif';
      ctx.fillStyle = '#9fb4c8';
      ctx.fillText('点击「开始」进行灌溉调度', W / 2, 52);
    }
  }

  function render() {
    drawBackground();
    drawSourceAndCanal();
    drawBranch();
    drawFields();
    drawReservoir();
    drawHUD();
  }

  // ---------- 结算 ----------
  let overlayShown = false;
  function showOverlay() {
    overlayShown = true;
    const won = state.status === 'won';
    document.getElementById('ovTitle').textContent = won ? '灌溉完成！' : '灌溉失败';
    document.getElementById('ovTitle').style.color = won ? '#7fe090' : '#ff7a6b';
    const stats = '用时 ' + state.t.toFixed(0) + ' 秒 · 蓄水池 ' + state.H.toFixed(2) +
      ' m · 田水位 [' + state.fields.map((f) => f.L.toFixed(2)).join(', ') + ']';
    document.getElementById('ovText').textContent = state.reason + '　' + stats;
    document.getElementById('overlay').style.display = 'flex';
    if (won) { beep(523, 0.15, 0); beep(659, 0.15, 0.18); beep(784, 0.3, 0.36); }
    else { beep(330, 0.25, 0); beep(220, 0.4, 0.28); }
  }

  // ---------- 主循环 ----------
  let prevAge = 0;
  function frame(ts) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, ((ts - lastTs) || 16) / 1000);
    lastTs = ts;
    if (running && state.status === 'playing') {
      acc += dt;
      while (acc >= CFG.dt) { Sim.step(state); acc -= CFG.dt; }
    }
    dashOffset += dt;
    if (state.sensor.age < prevAge) sensorFlash = 1;
    prevAge = state.sensor.age;
    sensorFlash = Math.max(0, sensorFlash - dt * 1.5);
    updateAudio();
    render();
    if (running && state.status !== 'playing' && !overlayShown) showOverlay();
    if (state.status === 'playing') overlayShown = false;
  }
  requestAnimationFrame(frame);
})();
