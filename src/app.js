(function () {
  const $ = (id) => document.getElementById(id);
  const canvas = $('grid');
  const renderer = new Renderer(canvas);
  const ambience = new Ambience();

  let simState = EnergySim.createState();
  let lastResult = null;
  let running = false;
  let tickTimer = null;
  let lastFrame = performance.now();

  $('scenario-name').textContent = EnergySim.SCENARIO.name;

  const sliders = { solar: $('s-solar'), gen: $('s-gen'), battery: $('s-batt') };

  function readInputs() {
    return {
      solar: Number(sliders.solar.value),
      gen: Number(sliders.gen.value),
      battery: Number(sliders.battery.value),
    };
  }

  function refreshSliderLabels() {
    $('o-solar').textContent = sliders.solar.value;
    $('o-gen').textContent = sliders.gen.value;
    $('o-batt').textContent = sliders.battery.value;
    const t = Math.min(simState.t, EnergySim.SCENARIO.solarAvail.length - 1);
    $('avail').textContent = EnergySim.SCENARIO.solarAvail[t] + ' kW';
  }

  for (const key of Object.keys(sliders)) {
    sliders[key].addEventListener('input', () => { ambience.ensure(); refreshSliderLabels(); });
  }

  function setStatus(text, cls) {
    const el = $('status');
    el.textContent = text;
    el.className = 'status ' + cls;
  }

  function showBanner(text, cls) {
    const b = $('banner');
    b.textContent = text;
    b.className = cls;
  }

  function updateHud() {
    $('clock').textContent = `t = ${simState.t} / ${EnergySim.CONFIG.duration} s`;
    $('soc-text').textContent = (simState.soc * 100).toFixed(0) + '%';
    $('soc-fill').style.width = (simState.soc * 100).toFixed(1) + '%';
    if (lastResult) {
      $('b-supply').textContent = lastResult.supply.toFixed(1);
      $('b-demand').textContent = lastResult.demand;
      $('b-charge').textContent = lastResult.batteryCharge.toFixed(1);
      $('b-curtail').textContent = lastResult.curtailed.toFixed(1);
    }
  }

  function doTick() {
    const r = EnergySim.tick(simState, readInputs());
    if (!r) return;
    lastResult = r;
    refreshSliderLabels();
    updateHud();
    if (r.status === 'success') {
      stopRun();
      setStatus('调度成功', 'ok');
      showBanner('✔ 调度成功：20 秒无断电', 'ok');
      ambience.mute();
    } else if (r.status === 'blackout') {
      stopRun();
      setStatus('断电', 'bad');
      showBanner('✖ 断电！供给不足', 'bad');
      ambience.mute();
    } else if (r.status === 'tripped') {
      stopRun();
      setStatus('线路跳闸', 'bad');
      showBanner('✖ 线路过载跳闸', 'bad');
      ambience.mute();
    }
  }

  function startRun() {
    ambience.ensure();
    if (simState.status !== 'running') reset();
    running = true;
    setStatus('运行中', 'run');
    $('banner').className = 'hidden';
    $('btn-run').textContent = '暂停';
    tickTimer = setInterval(doTick, 1000);
  }

  function stopRun() {
    running = false;
    clearInterval(tickTimer);
    tickTimer = null;
    $('btn-run').textContent = '开始运行';
  }

  function reset() {
    stopRun();
    simState = EnergySim.createState();
    lastResult = null;
    setStatus('待机', 'idle');
    $('banner').className = 'hidden';
    refreshSliderLabels();
    updateHud();
    ambience.mute();
  }

  $('btn-run').addEventListener('click', () => (running ? (stopRun(), setStatus('已暂停', 'idle')) : startRun()));
  $('btn-reset').addEventListener('click', reset);
  $('btn-overload').addEventListener('click', () => {
    reset();
    sliders.solar.value = 0;
    sliders.gen.value = 50; // 超过发电机线路容量 40kW
    sliders.battery.value = 0;
    refreshSliderLabels();
    startRun();
  });

  function frame(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    renderer.updateParticles(dt, lastResult);
    renderer.draw(lastResult, simState.soc);
    const loadRatio = lastResult ? Math.min(1, lastResult.delivered / EnergySim.CONFIG.lineCaps.load) : 0;
    ambience.update(loadRatio, !!(lastResult && lastResult.anyOverload));
    requestAnimationFrame(frame);
  }

  refreshSliderLabels();
  updateHud();
  requestAnimationFrame(frame);

  window.EnergyApp = {
    get t() { return simState.t; },
    get status() { return simState.status; },
    get lastResult() { return lastResult; },
    setInputs(v) {
      sliders.solar.value = v.solar;
      sliders.gen.value = v.gen;
      sliders.battery.value = v.battery;
      refreshSliderLabels();
    },
    start: startRun,
    reset,
  };
})();
