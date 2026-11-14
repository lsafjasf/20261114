(function () {
  'use strict';
  const S = window.ElevatorSim;

  const els = {
    canvas: document.getElementById('scene'),
    time: document.getElementById('hud-time'),
    delivered: document.getElementById('hud-delivered'),
    energy: document.getElementById('hud-energy'),
    budget: document.getElementById('hud-budget'),
    starts: document.getElementById('hud-starts'),
    complaints: document.getElementById('hud-complaints'),
    wait: document.getElementById('hud-wait'),
    carControls: document.getElementById('car-controls'),
    budgetInput: document.getElementById('budget-input'),
    multiplier: document.getElementById('speed-multiplier'),
    start: document.getElementById('btn-start'),
    pause: document.getElementById('btn-pause'),
    reset: document.getElementById('btn-reset'),
    mute: document.getElementById('btn-mute'),
    compare: document.getElementById('btn-compare'),
    result: document.getElementById('result-card'),
    compareCard: document.getElementById('compare-card'),
    legend: document.getElementById('legend'),
  };

  const STRATEGY_LABELS = {
    collective: '集体 SCAN',
    allstop: '逐层就近',
    fullload: '满载直驶',
  };
  const HOME_PRESETS = [
    { label: '大堂回位', homes: [1, 1, 1] },
    { label: '分区回位', homes: [1, 4, 7] },
    { label: '中层回位', homes: [4, 4, 4] },
  ];

  let sim = null;
  let renderer = null;
  const audio = new window.AudioEngine();
  let rafId = null;
  let lastFrame = 0;
  let accumulator = 0;
  let muted = false;
  let lastEventCount = 0;

  function buildCarControls() {
    const speedKeys = Object.keys(S.SPEED_PROFILES);
    els.carControls.innerHTML = '';
    for (let i = 0; i < S.CARS; i++) {
      const block = document.createElement('div');
      block.className = 'car-block';
      block.innerHTML =
        '<div class="car-title"><span>' + (i + 1) + ' 号梯</span></div>' +
        '<label>速度 <select data-i="' + i + '" data-k="speed">' +
        speedKeys.map((k) =>
          '<option value="' + k + '"' + (k === 'medium' ? ' selected' : '') + '>' +
          S.SPEED_PROFILES[k].label + '</option>').join('') +
        '</select></label>' +
        '<label>停靠策略 <select data-i="' + i + '" data-k="strategy">' +
        Object.keys(STRATEGY_LABELS).map((k) =>
          '<option value="' + k + '">' + STRATEGY_LABELS[k] + '</option>').join('') +
        '</select></label>' +
        '<label>空闲回位层 <select data-i="' + i + '" data-k="home">' +
        Array.from({ length: S.FLOORS }, (_, f) =>
          '<option value="' + (f + 1) + '"' +
          ([1, 4, 7][i] === f + 1 ? ' selected' : '') + '>' + (f + 1) + 'F</option>').join('') +
        '</select></label>';
      els.carControls.appendChild(block);
    }
  }

  function readConfig() {
    const speeds = [];
    const strategies = [];
    const homes = [];
    els.carControls.querySelectorAll('select').forEach((sel) => {
      const i = Number(sel.dataset.i);
      const k = sel.dataset.k;
      if (k === 'speed') speeds[i] = sel.value;
      if (k === 'strategy') strategies[i] = sel.value;
      if (k === 'home') homes[i] = Number(sel.value);
    });
    return {
      speeds, strategies, homes,
      budget: Number(els.budgetInput.value) || 1600,
    };
  }

  function setControlsDisabled(disabled) {
    els.carControls.querySelectorAll('select').forEach((s) => { s.disabled = disabled; });
    els.budgetInput.disabled = disabled;
  }

  function startGame() {
    audio.ensure();
    sim = new S.Simulation(readConfig());
    lastEventCount = 0;
    accumulator = 0;
    lastFrame = performance.now();
    setControlsDisabled(true);
    els.start.disabled = true;
    els.pause.disabled = false;
    els.pause.textContent = '暂停';
    els.result.classList.add('hidden');
    els.compareCard.classList.add('hidden');
    loop();
  }

  function resetGame() {
    cancelAnimationFrame(rafId);
    rafId = null;
    sim = null;
    setControlsDisabled(false);
    els.start.disabled = false;
    els.pause.disabled = true;
    els.pause.textContent = '暂停';
    els.result.classList.add('hidden');
    drawIdle();
  }

  function togglePause() {
    if (!sim) return;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
      els.pause.textContent = '继续';
    } else {
      lastFrame = performance.now();
      els.pause.textContent = '暂停';
      loop();
    }
  }

  function loop() {
    const now = performance.now();
    const multiplier = Number(els.multiplier.value);
    accumulator += Math.min(0.1, (now - lastFrame) / 1000) * multiplier;
    lastFrame = now;
    let guard = 0;
    while (accumulator >= S.STEP && !sim.finished && guard < 200) {
      sim.step();
      accumulator -= S.STEP;
      guard += 1;
    }
    handleAudioEvents();
    updateHud();
    renderer.draw(sim.snapshot(), S);
    if (sim.finished) {
      finishGame();
      return;
    }
    rafId = requestAnimationFrame(loop);
  }

  function handleAudioEvents() {
    const events = sim.events;
    for (let i = lastEventCount; i < events.length; i++) {
      const e = events[i];
      if (e.type === 'arrive') audio.arrive();
      if (e.type === 'complaint') {
        audio.complaint();
        renderer.flashComplaint(e.floor);
      }
      if (e.type === 'finish') audio.finish(e.result.success);
    }
    lastEventCount = events.length;
    audio.sync(sim.snapshot().cars);
  }

  function updateHud() {
    const snap = sim.snapshot();
    els.time.textContent = snap.time.toFixed(1) + 's';
    els.delivered.textContent = snap.delivered + '/' + snap.total;
    els.energy.textContent = Math.round(snap.energy) + ' 度';
    els.budget.textContent = snap.budget + ' 度';
    els.starts.textContent = snap.starts;
    els.complaints.textContent = snap.complaints + '/' + S.COMPLAINT_LIMIT;
    els.wait.textContent = Math.round(snap.maxWait) + 's';
    els.complaints.parentElement.classList.toggle('danger',
      snap.complaints > S.COMPLAINT_LIMIT);
    els.energy.parentElement.classList.toggle('over', snap.energy > snap.budget);
  }

  function finishGame() {
    cancelAnimationFrame(rafId);
    rafId = null;
    setControlsDisabled(false);
    els.start.disabled = false;
    els.pause.disabled = true;
    const r = sim.result;
    els.result.className = 'result ' + (r.success ? 'ok' : 'fail');
    els.result.innerHTML =
      '<h3>本局结果</h3>' +
      '<div class="big">' + (r.success ? '✅ 成功' : '❌ 失败') + '</div>' +
      (r.reasons.length ? '<div>' + r.reasons.join('；') + '</div>' : '') +
      row('完成时间', r.time.toFixed(1) + 's / ' + S.TIME_LIMIT + 's') +
      row('总耗电', Math.round(r.energy) + ' / ' + r.budget + ' 度') +
      row('启停次数', r.starts + ' 次') +
      row('投诉', r.complaints + ' / ' + S.COMPLAINT_LIMIT) +
      row('平均等待', r.avgWait ? r.avgWait.toFixed(1) + 's' : '-') +
      row('最长等待', Math.round(r.maxWait) + 's（忍耐 ' + S.PATIENCE + 's）');
  }

  function row(k, v) {
    return '<div class="kv"><span>' + k + '</span><b>' + v + '</b></div>';
  }

  function compareHoming() {
    const base = readConfig();
    const scenarios = [
      { name: 'A 大堂回位', homes: HOME_PRESETS[0].homes },
      { name: 'B 分区回位', homes: HOME_PRESETS[1].homes },
    ];
    const results = scenarios.map((sc) => {
      const headless = new S.Simulation({
        speeds: base.speeds, strategies: base.strategies,
        homes: sc.homes, budget: base.budget,
      });
      return { name: sc.name, r: headless.runHeadless() };
    });
    renderCompare(results, base.budget);
  }

  function renderCompare(results, budget) {
    const head = ['指标', ...results.map((x) => x.name)];
    const metric = (fn) => results.map((x) => fn(x.r));
    const lines = [
      ['结果', metric((r) => r.success
        ? '<span class="win">成功</span>'
        : '<span class="lose">失败</span>')],
      ['完成时间(s)', metric((r) => r.time.toFixed(1))],
      ['耗电(度)', metric((r) => Math.round(r.energy) + ' / ' + budget)],
      ['启停(次)', metric((r) => r.starts)],
      ['投诉', metric((r) => r.complaints)],
      ['平均等待(s)', metric((r) => r.avgWait ? r.avgWait.toFixed(1) : '-')],
      ['最长等待(s)', metric((r) => Math.round(r.maxWait))],
    ];
    const table =
      '<table><thead><tr>' + head.map((h) => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' +
      lines.map(([k, vals]) =>
        '<tr><td>' + k + '</td>' + vals.map((v) => '<td>' + v + '</td>').join('') + '</tr>').join('') +
      '</tbody></table>';
    const [a, b] = results;
    const verdict =
      '<div class="kv"><span>耗电差（B−A）</span><b>' +
      Math.round(b.r.energy - a.r.energy) + ' 度</b></div>' +
      '<div class="kv"><span>完成时间差</span><b>' +
      (b.r.time - a.r.time).toFixed(1) + 's</b></div>' +
      '<div class="kv"><span>平均等待差</span><b>' +
      (b.r.avgWait - a.r.avgWait).toFixed(1) + 's</b></div>';
    els.compareCard.classList.remove('hidden');
    els.compareCard.innerHTML =
      '<h3>回位策略 A/B 对比</h3><p style="font-size:12px;color:var(--muted)">' +
      '相同客流、速度与停靠策略，仅改变空闲回位层（无任务 ' + S.HOME_GRACE + 's 后回位）</p>' +
      table + verdict;
  }

  function drawIdle() {
    const idle = new S.Simulation({
      speeds: ['medium', 'medium', 'medium'],
      strategies: ['collective', 'collective', 'collective'],
      homes: [1, 4, 7], budget: Number(els.budgetInput.value) || 1600,
    });
    renderer.draw(idle.snapshot(), S);
  }

  function buildLegend() {
    els.legend.innerHTML =
      '<span><i class="dot" style="background:#4da3ff"></i>1 号梯</span>' +
      '<span><i class="dot" style="background:#3ddc97"></i>2 号梯</span>' +
      '<span><i class="dot" style="background:#ffb454"></i>3 号梯</span>' +
      '<span><i class="dot" style="background:#cfe0ff"></i>候梯乘客（数字为目标层）</span>' +
      '<span><i class="dot" style="background:#ffb454"></i>等待接近超时</span>' +
      '<span><i class="dot" style="background:#ff6b6b"></i>已投诉</span>' +
      '<span>虚线框 = 空闲回位层</span>';
  }

  els.start.addEventListener('click', startGame);
  els.pause.addEventListener('click', togglePause);
  els.reset.addEventListener('click', resetGame);
  els.compare.addEventListener('click', compareHoming);
  els.mute.addEventListener('click', () => {
    muted = !muted;
    audio.ensure();
    audio.setMuted(muted);
    els.mute.textContent = muted ? '🔇 音效关' : '🔊 音效开';
  });

  renderer = new window.ElevatorRenderer(els.canvas);
  buildCarControls();
  buildLegend();
  drawIdle();
})();
