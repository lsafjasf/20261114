/* 早高峰路口调度 - 前端主逻辑 */
(function () {
  'use strict';
  var S = window.TrafficSim;
  var APPROACHES = S.APPROACHES;
  var NAMES = { N: '北进口', E: '东进口', S: '南进口', W: '西进口' };

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    scene: $('scene'), overlay: $('overlay'), ovTitle: $('ovTitle'), ovDesc: $('ovDesc'),
    ovStart: $('ovStart'), startBtn: $('startBtn'), resetBtn: $('resetBtn'), optBtn: $('optBtn'),
    muteBtn: $('muteBtn'), simStatus: $('simStatus'), cfgTag: $('cfgTag'),
    ewGreen: $('ewGreen'), nsGreen: $('nsGreen'), yellow: $('yellow'),
    ewVal: $('ewVal'), nsVal: $('nsVal'), yVal: $('yVal'),
    ordLeft: $('ordLeft'), ordThru: $('ordThru'),
    timeLabel: $('timeLabel'), timeBar: $('timeBar'), queueList: $('queueList'),
    passedVal: $('passedVal'),
    stTime: $('stTime'), stPassed: $('stPassed'), stWait: $('stWait'),
    stEff: $('stEff'), stState: $('stState'), stStateSub: $('stStateSub')
  };

  var params = new URLSearchParams(location.search);
  var state = {
    sim: null,
    running: false,
    lastAxis: 'EW',
    departAnims: [],
    prevLanes: null,
    seed: (Math.random() * 1e9) | 0,
    lastFrame: 0,
    alarmOn: false
  };

  function cfg() {
    return {
      ewGreen: +els.ewGreen.value,
      nsGreen: +els.nsGreen.value,
      yellow: +els.yellow.value,
      leftFirst: els.ordLeft.classList.contains('active')
    };
  }

  // ---------- 排队面板 ----------
  var qRows = {};
  APPROACHES.forEach(function (a) {
    var row = document.createElement('div');
    row.className = 'q-row';
    row.innerHTML = '<span class="name">' + NAMES[a] + '</span>' +
      '<div class="q-bar"><div class="q-fill"></div><div class="q-limit" style="left:' +
      (16 / 26 * 100) + '%"></div></div><span class="q-num">0</span>';
    els.queueList.appendChild(row);
    qRows[a] = { fill: row.querySelector('.q-fill'), num: row.querySelector('.q-num') };
  });

  function fmtTime(s) {
    s = Math.max(0, Math.ceil(s));
    return '0' + Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  function refreshPanels() {
    var sim = state.sim;
    var t = sim ? sim.t : 0;
    var q = sim ? sim.queues() : { N: 0, E: 0, S: 0, W: 0 };
    APPROACHES.forEach(function (a) {
      var v = q[a];
      qRows[a].fill.style.width = Math.min(100, v / 26 * 100) + '%';
      qRows[a].fill.className = 'q-fill' + (v > 16 ? ' bad' : v >= 12 ? ' warn' : '');
      qRows[a].num.textContent = v;
    });
    els.timeLabel.textContent = Math.floor(t) + ' / 180 s';
    els.timeBar.style.width = (t / 180 * 100) + '%';
    els.passedVal.textContent = (sim ? sim.passed : 0) + ' 辆';
    els.stTime.textContent = fmtTime(180 - t);
    els.stPassed.innerHTML = (sim ? sim.passed : 0) + ' <small>辆</small>';
    els.stWait.innerHTML = (sim ? sim.avgWait().toFixed(1) : '0.0') + ' <small>s</small>';
    els.stEff.innerHTML = (sim && sim.greenTotal > 0 ? Math.round(sim.efficiency() * 100) : '--') + ' <small>%</small>';
  }

  function setState(text, sub, cls) {
    els.stState.textContent = text;
    els.stState.className = cls || '';
    els.stStateSub.textContent = sub;
  }

  // ---------- 游戏流程 ----------
  function start() {
    var c = cfg();
    c.seed = state.seed;
    state.sim = S.createSim(c);
    state.running = true;
    state.lastAxis = 'EW';
    state.departAnims = [];
    state.prevLanes = snapshotLanes();
    els.overlay.classList.add('hidden');
    els.simStatus.innerHTML = '<i class="dot ok"></i>仿真运行中';
    els.startBtn.innerHTML = '⏸ 暂停 <kbd>Space</kbd>';
    setState('运行中', '相位循环中');
    AudioEngine.start();
  }

  function pause() {
    state.running = false;
    els.startBtn.innerHTML = '▶ 继续 <kbd>Space</kbd>';
    els.simStatus.innerHTML = '<i class="dot warn"></i>已暂停';
    setState('已暂停', '等待恢复');
    AudioEngine.duck();
  }

  function resume() {
    state.running = true;
    els.startBtn.innerHTML = '⏸ 暂停 <kbd>Space</kbd>';
    els.simStatus.innerHTML = '<i class="dot ok"></i>仿真运行中';
    setState('运行中', '相位循环中');
  }

  function reset() {
    state.sim = null;
    state.running = false;
    state.departAnims = [];
    state.seed = (Math.random() * 1e9) | 0;
    els.overlay.classList.remove('hidden');
    els.ovTitle.textContent = '让车流撑过三分钟';
    els.ovTitle.className = 'ov-title';
    els.ovDesc.textContent = '调整东西向、南北向绿灯时长与黄灯间隔。任何进口排队超过 16 辆，挑战立即失败。';
    els.ovStart.style.display = '';
    els.startBtn.innerHTML = '▶ 开始挑战 <kbd>Space</kbd>';
    els.simStatus.innerHTML = '<i class="dot dim"></i>仿真待命';
    setState('待命', '等待发车');
    AudioEngine.stop();
    refreshPanels();
  }

  function finish(win, reason) {
    state.running = false;
    els.overlay.classList.remove('hidden');
    els.ovStart.style.display = 'none';
    if (win) {
      els.ovTitle.textContent = '✓ 挑战成功';
      els.ovTitle.className = 'ov-title win';
      els.ovDesc.textContent = '路口连续运行 180 秒，通过 ' + state.sim.passed +
        ' 辆，平均等待 ' + state.sim.avgWait().toFixed(1) + ' 秒，绿灯利用率 ' +
        Math.round(state.sim.efficiency() * 100) + '%。';
      setState('已通过', '早高峰收官', 'win');
      els.simStatus.innerHTML = '<i class="dot ok"></i>挑战成功';
      AudioEngine.win();
    } else {
      els.ovTitle.textContent = '✗ 排队溢出';
      els.ovTitle.className = 'ov-title lose';
      els.ovDesc.textContent = NAMES[reason] + '排队超过 16 辆，回堵上游。调整配时后点击重置再来一局。';
      setState('已失败', NAMES[reason] + '溢出', 'lose');
      els.simStatus.innerHTML = '<i class="dot bad"></i>排队溢出';
      AudioEngine.lose();
    }
    els.startBtn.innerHTML = '↻ 重新开始 <kbd>Space</kbd>';
  }

  function snapshotLanes() {
    var s = state.sim, snap = {};
    APPROACHES.forEach(function (a) {
      snap[a] = { left: s.lanes[a].left, thru: s.lanes[a].thru };
    });
    return snap;
  }

  // ---------- 主循环 ----------
  function tick(now) {
    var dt = Math.min(0.06, (now - state.lastFrame) / 1000 || 0.016);
    state.lastFrame = now;
    var sim = state.sim;
    if (state.running && sim && !sim.finished) {
      sim.step(dt);
      detectDepartures();
      var ph = sim.phase();
      if (ph.axis) state.lastAxis = ph.axis;
      if (sim.finished) finish(!sim.failed, sim.failReason);
    }
    updateAnims(dt);
    Renderer.draw(state, cfg());
    AudioEngine.update(state);
    refreshPanels();
    requestAnimationFrame(tick);
  }

  function detectDepartures() {
    var sim = state.sim;
    APPROACHES.forEach(function (a) {
      ['left', 'thru'].forEach(function (lane) {
        var diff = state.prevLanes[a][lane] - sim.lanes[a][lane];
        for (var i = 0; i < diff; i++) spawnDepart(a, lane);
      });
    });
    state.prevLanes = snapshotLanes();
  }

  function spawnDepart(a, lane) {
    state.departAnims.push({ approach: a, lane: lane, t: 0, dur: 2.2 });
  }

  function updateAnims(dt) {
    for (var i = state.departAnims.length - 1; i >= 0; i--) {
      var d = state.departAnims[i];
      d.t += dt;
      if (d.t >= d.dur) state.departAnims.splice(i, 1);
    }
  }

  // ---------- 控件 ----------
  function bindSlider(input, label, suffix) {
    input.addEventListener('input', function () {
      label.textContent = input.value + suffix;
      liveApply();
    });
  }
  bindSlider(els.ewGreen, els.ewVal, ' s');
  bindSlider(els.nsGreen, els.nsVal, ' s');
  bindSlider(els.yellow, els.yVal, ' s');

  function setOrder(leftFirst) {
    els.ordLeft.classList.toggle('active', leftFirst);
    els.ordThru.classList.toggle('active', !leftFirst);
    liveApply();
  }
  els.ordLeft.addEventListener('click', function () { setOrder(true); AudioEngine.click(); });
  els.ordThru.addEventListener('click', function () { setOrder(false); AudioEngine.click(); });

  function liveApply() {
    if (state.sim && !state.sim.finished) {
      state.sim.reconfigure(cfg());
      els.cfgTag.textContent = '已实时应用';
      els.cfgTag.className = 'tag';
    }
  }

  function toggleStart() {
    AudioEngine.unlock();
    if (!state.sim || state.sim.finished) { reset(); start(); }
    else if (state.running) pause();
    else resume();
  }
  els.startBtn.addEventListener('click', toggleStart);
  els.ovStart.addEventListener('click', toggleStart);
  els.resetBtn.addEventListener('click', function () { AudioEngine.unlock(); reset(); });
  document.addEventListener('keydown', function (e) {
    if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
      e.preventDefault();
      toggleStart();
    }
  });

  els.optBtn.addEventListener('click', function () {
    AudioEngine.unlock();
    els.optBtn.disabled = true;
    els.optBtn.textContent = '✦ 寻优中…';
    setTimeout(function () {
      var base = state.seed;
      var r = S.optimize([base, base + 1, base + 2, base + 3, base + 4]);
      els.optBtn.disabled = false;
      els.optBtn.textContent = '✦ 自动寻优';
      if (!r.best) {
        els.cfgTag.textContent = '无解';
        return;
      }
      els.ewGreen.value = r.best.ewGreen;
      els.nsGreen.value = r.best.nsGreen;
      els.yellow.value = r.best.yellow;
      els.ewVal.textContent = r.best.ewGreen + ' s';
      els.nsVal.textContent = r.best.nsGreen + ' s';
      els.yVal.textContent = r.best.yellow + ' s';
      setOrder(r.best.leftFirst);
      els.cfgTag.textContent = '寻优完成 · 测试 ' + r.tested + ' 组';
      els.cfgTag.className = 'tag';
      AudioEngine.click();
    }, 30);
  });

  els.muteBtn.addEventListener('click', function () {
    var muted = AudioEngine.toggleMute();
    els.muteBtn.textContent = muted ? '🔇 静音' : '🔊 声音';
    els.muteBtn.classList.toggle('muted', muted);
  });

  reset();
  // 测试参数：?auto=1 自动开始，?ff=秒 快进
  if (params.get('ew')) els.ewGreen.value = params.get('ew');
  if (params.get('ns')) els.nsGreen.value = params.get('ns');
  if (params.get('y')) els.yellow.value = params.get('y');
  if (params.get('ew')) {
    els.ewVal.textContent = els.ewGreen.value + ' s';
    els.nsVal.textContent = els.nsGreen.value + ' s';
    els.yVal.textContent = els.yellow.value + ' s';
  }
  if (params.get('ff') || params.get('auto')) {
    start();
    var ff = +params.get('ff') || 0;
    for (var i = 0; i < ff * 10 && !state.sim.finished; i++) {
      state.sim.step(0.1);
      detectDepartures();
    }
    if (state.sim.finished) finish(!state.sim.failed, state.sim.failReason);
  }
  requestAnimationFrame(tick);
})();
