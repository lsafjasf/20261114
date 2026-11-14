/* 配色练习主逻辑 */
(function () {
  'use strict';
  const SEED = 81;
  const TOL = Mixing.TOLERANCE;
  const MAX_SUBMIT = 3;

  const el = {
    roundNo: document.getElementById('roundNo'),
    leftCount: document.getElementById('leftCount'),
    tolLabel: document.getElementById('tolLabel'),
    sliders: document.getElementById('sliders'),
    totalVal: document.getElementById('totalVal'),
    deText: document.getElementById('deText'),
    deBar: document.getElementById('deBar'),
    attemptList: document.getElementById('attemptList'),
    submitBtn: document.getElementById('submitBtn'),
    autoBtn: document.getElementById('autoBtn'),
    resetBtn: document.getElementById('resetBtn'),
    muteBtn: document.getElementById('muteBtn'),
    wheel: document.getElementById('wheelCanvas'),
    palette: document.getElementById('paletteCanvas'),
    swatches: document.getElementById('swatchCanvas'),
    resultPanel: document.getElementById('resultPanel'),
    resultBody: document.getElementById('resultBody'),
    restartBtn: document.getElementById('restartBtn')
  };
  el.tolLabel.textContent = TOL;

  const state = {
    rng: Mixing.mulberry32(SEED),
    round: 0,
    targets: [],
    target: null,
    amounts: [0, 0, 0, 0],
    used: 0,
    attempts: [],
    plan: null,
    over: false,
    summary: []
  };

  // 预生成五组目标（保证随机但可复现）
  for (let i = 0; i < 5; i++) {
    const q = Mixing.randomTarget(state.rng);
    state.targets.push(Mixing.mix(q));
  }

  function buildSliders() {
    el.sliders.innerHTML = '';
    Mixing.PIGMENTS.forEach(function (p, i) {
      const row = document.createElement('div');
      row.className = 'slider-row';
      const label = document.createElement('label');
      label.textContent = p.name;
      const input = document.createElement('input');
      input.type = 'range'; input.min = 0; input.max = 100; input.value = 0;
      input.dataset.idx = i;
      input.addEventListener('input', onSlider);
      const val = document.createElement('span');
      val.className = 'val'; val.textContent = '0';
      row.append(label, input, val);
      el.sliders.appendChild(row);
    });
  }

  function onSlider(e) {
    if (state.over) return;
    const idx = Number(e.target.dataset.idx);
    state.amounts[idx] = Number(e.target.value);
    e.target.parentElement.querySelector('.val').textContent = state.amounts[idx];
    Sound.slide();
    render();
  }

  function syncSliders() {
    el.sliders.querySelectorAll('input').forEach(function (input, i) {
      input.value = state.amounts[i];
      input.parentElement.querySelector('.val').textContent = state.amounts[i];
    });
  }

  function currentResult() { return Mixing.mix(state.amounts); }

  function render() {
    const cur = currentResult();
    const de = Mixing.deltaE(cur.lab, state.target.lab);
    Views.drawWheel(el.wheel, cur);
    Views.drawPalette(el.palette, cur);
    Views.drawSwatches(el.swatches, state.target, cur, de, TOL);
    el.totalVal.textContent = cur.total.toFixed(0);
    el.deText.textContent = '实时色差 ΔE：' + de.toFixed(2) +
      '（H' + cur.hsl[0].toFixed(0) + ' S' + cur.hsl[1].toFixed(0) +
      ' L' + cur.hsl[2].toFixed(0) + '）';
    const pct = Math.max(0, 100 - de * 8);
    el.deBar.style.width = pct + '%';
    el.deBar.style.background = de <= TOL ? '#2ea043' : '#d97757';
    el.roundNo.textContent = String(state.round + 1);
    el.leftCount.textContent = String(MAX_SUBMIT - state.used);
    const lock = state.over || state.used >= MAX_SUBMIT;
    el.submitBtn.disabled = lock;
    el.autoBtn.disabled = lock;
  }

  function renderAttempts() {
    el.attemptList.innerHTML = '';
    state.attempts.forEach(function (a) {
      const li = document.createElement('li');
      const chip = document.createElement('span');
      chip.className = 'chip'; chip.style.background = a.hex;
      const tag = document.createElement('span');
      tag.className = 'tag ' + (a.de <= TOL ? 'hit' : 'miss');
      tag.textContent = a.de <= TOL ? '命中' : '未中';
      li.append(chip, document.createTextNode(
        'C/M/Y/K ' + a.amounts.join('/') + ' · ΔE ' + a.de.toFixed(2)), tag);
      el.attemptList.appendChild(li);
    });
  }

  function submit() {
    if (state.over || state.used >= MAX_SUBMIT) return;
    const cur = currentResult();
    const de = Mixing.deltaE(cur.lab, state.target.lab);
    state.used++;
    state.attempts.push({
      amounts: state.amounts.slice(), hex: cur.hex, de: de
    });
    renderAttempts();
    const hit = de <= TOL;
    hit ? Sound.hit() : Sound.miss();
    render();
    if (hit || state.used >= MAX_SUBMIT) {
      finishRound(hit, de);
    }
  }

  function finishRound(hit, finalDe) {
    state.summary.push({
      round: state.round + 1,
      targetHex: state.target.hex,
      amounts: state.amounts.slice(),
      finalHex: currentResult().hex,
      submits: state.used,
      de: finalDe,
      hit: hit
    });
    if (state.round >= 4) {
      state.over = true;
      render();
      showSummary();
      return;
    }
    setTimeout(nextRound, 900);
  }

  function nextRound() {
    state.round++;
    state.target = state.targets[state.round];
    state.amounts = [0, 0, 0, 0];
    state.used = 0;
    state.attempts = [];
    state.plan = Solver.stagedAttempts(state.target.lab, TOL);
    syncSliders();
    renderAttempts();
    Sound.round();
    render();
  }

  function autoAttempt() {
    if (state.over || state.used >= MAX_SUBMIT) return;
    const step = state.plan[state.used];
    state.amounts = step.amounts.slice();
    syncSliders();
    render();
    submit();
  }

  function showSummary() {
    el.resultBody.innerHTML = '';
    state.summary.forEach(function (r) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + r.round + '</td>' +
        '<td><span class="chip" style="background:' + r.targetHex + '"></span> ' + r.targetHex + '</td>' +
        '<td>' + r.amounts.join(' / ') + '</td>' +
        '<td><span class="chip" style="background:' + r.finalHex + '"></span> ' + r.finalHex + '</td>' +
        '<td>' + r.submits + '</td>' +
        '<td>' + r.de.toFixed(2) + '</td>' +
        '<td><span class="tag ' + (r.hit ? 'hit' : 'miss') + '">' +
          (r.hit ? '完成' : '未达标') + '</span></td>';
      el.resultBody.appendChild(tr);
    });
    el.resultPanel.classList.remove('hidden');
    el.resultPanel.scrollIntoView({ behavior: 'smooth' });
  }

  function restart() {
    state.rng = Mixing.mulberry32(SEED);
    state.round = 0;
    state.targets = [];
    for (let i = 0; i < 5; i++) {
      state.targets.push(Mixing.mix(Mixing.randomTarget(state.rng)));
    }
    state.summary = [];
    state.over = false;
    state.target = state.targets[0];
    state.amounts = [0, 0, 0, 0];
    state.used = 0;
    state.attempts = [];
    state.plan = Solver.stagedAttempts(state.target.lab, TOL);
    el.resultPanel.classList.add('hidden');
    syncSliders();
    renderAttempts();
    render();
  }

  el.submitBtn.addEventListener('click', submit);
  el.autoBtn.addEventListener('click', autoAttempt);
  el.resetBtn.addEventListener('click', function () {
    state.amounts = [0, 0, 0, 0];
    syncSliders(); render();
  });
  el.muteBtn.addEventListener('click', function () {
    Sound.enabled = !Sound.enabled;
    el.muteBtn.textContent = Sound.enabled ? '🔊 音效开' : '🔇 静音';
  });
  el.restartBtn.addEventListener('click', restart);
  window.addEventListener('resize', render);

  buildSliders();
  state.target = state.targets[0];
  state.plan = Solver.stagedAttempts(state.target.lab, TOL);
  renderAttempts();
  render();
})();
