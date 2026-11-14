/* 应用入口：固定步长驱动模拟内核，连接 Canvas 渲染、Web Audio 与控制面板 */
(function () {
  'use strict';

  const sim = createSim();
  window.simRef = sim;
  const renderer = new Renderer(document.getElementById('line'));
  const audio = new AudioEngine();
  const TICK = sim.cfg.TICK;

  let running = false;
  let acc = 0;
  let last = 0;
  let alarmOn = false;
  let prevEventCount = 0;

  const el = {
    goods: document.getElementById('hud-goods'),
    time: document.getElementById('hud-time'),
    switches: document.getElementById('hud-switches'),
    status: document.getElementById('hud-status'),
    log: document.getElementById('event-log'),
    modal: document.getElementById('modal'),
    modalTitle: document.getElementById('modal-title'),
    modalText: document.getElementById('modal-text'),
    btnMute: document.getElementById('btn-mute'),
  };

  function pushLog(text, cls) {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = '[' + sim.state.time.toFixed(1) + 's] ' + text;
    el.log.appendChild(div);
    el.log.scrollTop = el.log.scrollHeight;
  }

  function handleEvents() {
    const evs = sim.state.events;
    for (let i = prevEventCount; i < evs.length; i++) {
      const e = evs[i];
      if (e.type === 'jam') { pushLog('支线 ' + e.lane + ' 出现堵塞！', 'ev-warn'); audio.startAlarm(); }
      if (e.type === 'cleared') { pushLog('支线 ' + e.lane + ' 堵塞已清除', 'ev-warn'); audio.click(520, 0.12); }
      if (e.type === 'pack') audio.tick();
      if (e.type === 'pause' || e.type === 'resume' || e.type === 'speed' || e.type === 'diverter') {
        audio.confirm();
      }
      if (e.type === 'overflow') { pushLog(e.reason, 'ev-err'); audio.crash(); }
      if (e.type === 'won') { pushLog('任务完成：10 件成品且无溢出', 'ev-err'); audio.win(); }
    }
    prevEventCount = evs.length;
  }

  function updateAlarm() {
    const anyJam = sim.state.branches.A.jammed || sim.state.branches.B.jammed;
    if (anyJam && !alarmOn && running) { audio.startAlarm(); alarmOn = true; }
    if (!anyJam && alarmOn) { audio.stopAlarm(); alarmOn = false; }
  }

  function updateHud() {
    const s = sim.state;
    el.goods.textContent = s.goods + '/10';
    el.time.textContent = s.time.toFixed(1) + 's';
    el.switches.textContent = s.switches;
    el.status.textContent = s.status === 'won' ? '通过' : s.status === 'failed' ? '溢出失败' : '运行中';
    el.status.style.color = s.status === 'won' ? '#8fe388' : s.status === 'failed' ? '#ff7676' : '#8fe388';
  }

  function endGame() {
    const s = sim.state;
    running = false;
    audio.stopAlarm();
    alarmOn = false;
    el.modal.classList.remove('hidden');
    if (s.status === 'won') {
      el.modalTitle.textContent = '✅ 演练通过';
      el.modalText.textContent = '在不关闭整条产线的情况下清空两段缓存，产出 ' + s.goods +
        ' 件成品，切换 ' + s.switches + ' 次，全程无溢出，用时 ' + s.time.toFixed(1) + 's。';
    } else {
      el.modalTitle.textContent = '❌ 溢出失败';
      el.modalText.textContent = s.failReason + '（用时 ' + s.time.toFixed(1) + 's，已产出 ' + s.goods + ' 件）';
    }
  }

  function loop(ts) {
    if (!running) { last = ts; requestAnimationFrame(loop); return; }
    if (!last) last = ts;
    acc += Math.min(0.1, (ts - last) / 1000);
    last = ts;
    let guard = 0;
    while (acc >= TICK && guard < 20) {
      sim.step();
      acc -= TICK;
      guard++;
    }
    handleEvents();
    updateAlarm();
    updateHud();
    renderer.draw(sim.state);
    if (sim.state.status !== 'running') { endGame(); return; }
    requestAnimationFrame(loop);
  }

  function act(action) {
    audio.ensure();
    const c = sim.controls;
    const s = sim.state;
    switch (action) {
      case 'pauseA': c.pause('A'); break;
      case 'resumeA': c.resume('A'); break;
      case 'pauseB': c.pause('B'); break;
      case 'resumeB': c.resume('B'); break;
      case 'speedSlow': c.setSpeed('slow'); break;
      case 'speedNormal': c.setSpeed('normal'); break;
      case 'speedFast': c.setSpeed('fast'); break;
      case 'divA': c.setDiverter('A'); break;
      case 'divAuto': c.setDiverter('AUTO'); break;
      case 'divB': c.setDiverter('B'); break;
      case 'mute':
        audio.setMuted(!audio.muted);
        el.btnMute.textContent = audio.muted ? '声音 关' : '声音 开';
        return;
      case 'reset':
        location.reload();
        return;
      case 'start':
        if (s.status === 'running') { running = !running; last = 0; }
        break;
    }
    if (action.startsWith('speed')) {
      document.querySelectorAll('[data-act^="speed"]').forEach((b) => b.classList.remove('active'));
      const map = { speedSlow: 'speedSlow', speedNormal: 'speedNormal', speedFast: 'speedFast' };
      const btn = document.querySelector('[data-act="' + map[action] + '"]');
      if (btn) btn.classList.add('active');
    }
    if (action.startsWith('div')) {
      document.querySelectorAll('[data-act^="div"]').forEach((b) => b.classList.remove('active'));
      const btn = document.querySelector('[data-act="' + action + '"]');
      if (btn) btn.classList.add('active');
    }
  }

  document.querySelectorAll('button[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => act(btn.dataset.act));
  });

  pushLog('演练就绪：点击“开始 / 继续”，两段支线将先后堵塞');
  updateHud();
  renderer.draw(sim.state);
  requestAnimationFrame(loop);
})();
