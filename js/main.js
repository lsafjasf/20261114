(function () {
  'use strict';
  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d');
  var W = canvas.width, H = canvas.height;
  var sim = window.AquariumSim, R = window.AquariumRender;
  var state = sim.createState();
  var autopilot = false;
  var speedFactor = 1;
  var acc = 0, last = performance.now();
  var lastEventCount = 0;

  var sliders = {
    pump: document.getElementById('pump'),
    v1: document.getElementById('v1'),
    v2: document.getElementById('v2')
  };
  var labels = {
    pump: document.getElementById('pumpVal'),
    v1: document.getElementById('v1Val'),
    v2: document.getElementById('v2Val')
  };

  function syncSliders() {
    sliders.pump.value = Math.round(state.target.pump * 100);
    sliders.v1.value = Math.round(state.target.v1 * 100);
    sliders.v2.value = Math.round(state.target.v2 * 100);
    labels.pump.textContent = sliders.pump.value + '%';
    labels.v1.textContent = sliders.v1.value + '%';
    labels.v2.textContent = sliders.v2.value + '%';
  }

  Object.keys(sliders).forEach(function (key) {
    sliders[key].addEventListener('input', function () {
      autopilot = false;
      document.getElementById('autoBtn').textContent = '开启自动巡航';
      state.target[key] = Number(sliders[key].value) / 100;
      labels[key].textContent = sliders[key].value + '%';
      window.AquariumAudio.init();
    });
  });

  document.getElementById('autoBtn').addEventListener('click', function () {
    autopilot = !autopilot;
    this.textContent = autopilot ? '关闭自动巡航' : '开启自动巡航';
    window.AquariumAudio.init();
  });

  document.getElementById('resetBtn').addEventListener('click', function () {
    state = sim.createState(Date.now() % 100000);
    autopilot = false;
    document.getElementById('autoBtn').textContent = '开启自动巡航';
    syncSliders();
  });

  // Failure demo: force pump to max immediately (fine-sand churn).
  document.getElementById('failBtn').addEventListener('click', function () {
    state = sim.createState(99);
    autopilot = false;
    state.target.pump = 1;
    syncSliders();
    window.AquariumAudio.init();
  });

  document.getElementById('muteBtn').addEventListener('click', function () {
    var A = window.AquariumAudio;
    A.init();
    A.setMuted(!A.muted);
    this.textContent = A.muted ? '取消静音' : '静音';
  });

  document.getElementById('speedSel').addEventListener('change', function (e) {
    speedFactor = Number(e.target.value);
  });

  function appendEvents() {
    var box = document.getElementById('log');
    while (lastEventCount < state.events.length) {
      var ev = state.events[lastEventCount++];
      var line = document.createElement('div');
      line.className = 'ev ev-' + ev.type;
      line.textContent = '[' + ev.t.toFixed(1) + 's] ' + ev.msg;
      box.insertBefore(line, box.firstChild);
      while (box.childNodes.length > 12) box.removeChild(box.lastChild);
    }
    if (state.events.length < lastEventCount) lastEventCount = state.events.length;
  }

  function updateHud() {
    document.getElementById('clock').textContent = state.t.toFixed(1) + 's';
    var total = 0, bad = 0;
    for (var i = 0; i < 3; i++) {
      if (!sim.inRange(state, i)) bad++;
      total++;
    }
    var hud = document.getElementById('hud');
    hud.textContent = '达标缸数 ' + (total - bad) + '/3 · 达标保持 ' +
      state.inRangeHold.toFixed(1) + 's / ' + sim.CONFIG.stableHoldSeconds +
      's · 压力 ' + state.pressure.toFixed(2) +
      (state.pressureAlarmOn ? '（超压）' : '') +
      ' · 翻砂 ' + state.sandTimer.toFixed(1) + 's';
    hud.className = bad > 0 || state.pressureAlarmOn ? 'hud warn' : 'hud ok';
  }

  function frame(now) {
    var elapsed = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += elapsed * speedFactor;
    var dt = sim.CONFIG.dt;
    while (acc >= dt && state.status === 'running') {
      if (autopilot) sim.autoPilot(state, dt);
      sim.step(state, dt);
      acc -= dt;
    }
    if (autopilot) syncSliders();
    R.drawScene(ctx, state, W, H);
    updateHud();
    appendEvents();
    window.AquariumAudio.update(state);
    requestAnimationFrame(frame);
  }

  syncSliders();
  requestAnimationFrame(frame);
})();
