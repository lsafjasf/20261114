// Browser game shell: input, audio, main loop. Rendering lives in render.js.
(function () {
  const CFG = Physics.CFG;
  const canvas = document.getElementById("cv");
  const ctx = canvas.getContext("2d");

  let state = Physics.createState();
  let auto = false;
  let audio = null;

  // ---------- audio: pitch follows levitation height ----------
  function ensureAudio() {
    if (audio) return audio;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ac = new AC();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const lfo = ac.createOscillator();
    const lfoGain = ac.createGain();
    osc.type = "sine";
    lfo.type = "sine";
    lfo.frequency.value = 6;
    lfoGain.gain.value = 0;
    lfo.connect(lfoGain); lfoGain.connect(gain.gain);
    osc.connect(gain); gain.connect(ac.destination);
    gain.gain.value = 0;
    osc.start(); lfo.start();
    audio = { ac, osc, gain, lfoGain };
    return audio;
  }

  function blip(freq, dur, type, vol) {
    const a = ensureAudio(); if (!a) return;
    const o = a.ac.createOscillator(), g = a.ac.createGain();
    o.type = type || "square"; o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.12, a.ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, a.ac.currentTime + dur);
    o.connect(g); g.connect(a.ac.destination);
    o.start(); o.stop(a.ac.currentTime + dur);
  }

  function updateDrone() {
    if (!audio) return;
    const h = 1 - state.y / CFG.H;              // 0 floor .. 1 ceiling
    audio.osc.frequency.value = 110 + h * 330;  // higher hover -> higher pitch
    const busy = state.phase === "success" || state.phase === "crashed" ? 0 : 1;
    const wobble = Math.min(1, Math.hypot(state.vx, state.vy) / 200);
    audio.gain.gain.value = 0.05 * busy;
    audio.lfoGain.gain.value = 0.04 * wobble * busy;
  }

  // ---------- input ----------
  const sliders = [...document.querySelectorAll(".coil-ctl")].map((el) => ({
    coil: +el.dataset.coil,
    input: el.querySelector("input"),
    val: el.querySelector(".val"),
  }));
  for (const s of sliders) {
    s.input.addEventListener("input", () => {
      state.targets[s.coil] = +s.input.value;
      s.val.textContent = (+s.input.value).toFixed(2) + " A";
      ensureAudio();
    });
  }
  function syncSliders() {
    for (const s of sliders) {
      s.input.value = state.targets[s.coil];
      s.val.textContent = state.targets[s.coil].toFixed(2) + " A";
    }
  }

  const keyMap = { q: [0, 1], a: [0, -1], e: [1, 1], d: [1, -1],
                   w: [2, 1], s: [2, -1], r: [3, 1], f: [3, -1] };
  const held = new Set();
  window.addEventListener("keydown", (ev) => {
    const k = ev.key.toLowerCase();
    if (keyMap[k]) { held.add(k); ensureAudio(); ev.preventDefault(); }
    if (k === "p") toggleAuto();
    if (k === " ") { reset(); ev.preventDefault(); }
  });
  window.addEventListener("keyup", (ev) => held.delete(ev.key.toLowerCase()));

  function applyKeys(dt) {
    for (const k of held) {
      const [coil, dir] = keyMap[k];
      state.targets[coil] = Math.max(0, Math.min(CFG.iMax, state.targets[coil] + dir * 1.6 * dt));
    }
    if (held.size) syncSliders();
  }

  const btnAuto = document.getElementById("btnAuto");
  function toggleAuto() {
    auto = !auto;
    btnAuto.classList.toggle("on", auto);
    ensureAudio();
  }
  btnAuto.addEventListener("click", toggleAuto);
  document.getElementById("btnReset").addEventListener("click", reset);

  function reset() {
    state = Physics.createState();
    syncSliders();
  }

  // ---------- main loop ----------
  let last = performance.now();
  let acc = 0;
  const DT = 1 / 120;
  const prev = { ringIdx: 0, touches: 0, phase: "rings" };

  function frame(now) {
    const elapsed = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += elapsed;
    applyKeys(elapsed);
    while (acc >= DT) {
      if (auto) { Autopilot.control(state); syncSliders(); }
      Physics.step(state, DT);
      acc -= DT;
    }
    // event sounds
    if (state.ringIdx > prev.ringIdx) { blip(660, 0.25, "sine", 0.2); blip(990, 0.4, "sine", 0.12); }
    if (state.touches > prev.touches) blip(140, 0.2, "sawtooth", 0.18);
    if (state.phase !== prev.phase) {
      if (state.phase === "success") { blip(523, 0.5, "sine", 0.2); setTimeout(() => blip(784, 0.7, "sine", 0.2), 180); }
      if (state.phase === "crashed") blip(70, 0.8, "sawtooth", 0.25);
    }
    prev.ringIdx = state.ringIdx; prev.touches = state.touches; prev.phase = state.phase;
    updateDrone();
    Renderer.draw(ctx, state, auto);
    requestAnimationFrame(frame);
  }
  syncSliders();
  requestAnimationFrame(frame);
})();
