// Browser front-end: Canvas attitude ball / trajectory / error bands,
// Web Audio drift-direction pitch cues, keyboard + button bias control.
(function () {
  "use strict";

  const sim = GyroSim.createSim();
  const params = sim.params;
  const AXIS_NAMES = ["X", "Y", "Z"];
  const AXIS_LABELS = ["横滚 Roll", "俯仰 Pitch", "偏航 Yaw"];
  const AXIS_COLORS = ["#f7786b", "#4ad991", "#5aa2ff"];
  const DEG_RANGE = 5; // attitude ball shows ±5°

  const ballCanvas = document.getElementById("ball");
  const ballCtx = ballCanvas.getContext("2d");
  const bandCanvas = document.getElementById("bands");
  const bandCtx = bandCanvas.getContext("2d");
  const holdText = document.getElementById("holdText");
  const holdFill = document.getElementById("holdFill");
  const statusText = document.getElementById("statusText");
  const resultBox = document.getElementById("result");
  const finalBias = document.getElementById("finalBias");

  // ---------- bias control (keyboard + buttons, hold to repeat) ----------
  const held = new Map(); // key -> {axis, dir}
  const KEYMAP = {
    a: { axis: 0, dir: -1 }, d: { axis: 0, dir: 1 },
    s: { axis: 1, dir: -1 }, w: { axis: 1, dir: 1 },
    q: { axis: 2, dir: -1 }, e: { axis: 2, dir: 1 },
  };

  window.addEventListener("keydown", (ev) => {
    const k = ev.key.toLowerCase();
    if (k === "m") { muted = !muted; return; }
    const m = KEYMAP[k];
    if (m) {
      held.set(k, m);
      ensureAudio();
      ev.preventDefault();
    }
  });
  window.addEventListener("keyup", (ev) => held.delete(ev.key.toLowerCase()));

  function applyHeld(dt, fine) {
    const rate = fine ? 6 : 25; // nudges per second while held
    held.forEach((m) => sim.nudgeBias(m.axis, m.dir, dt * rate));
  }

  // Build per-axis control rows.
  const axesBox = document.getElementById("axes");
  const rateSpans = [];
  AXIS_NAMES.forEach((name, i) => {
    const row = document.createElement("div");
    row.className = "axis-row";
    row.innerHTML =
      '<div class="axis-name" style="color:' + AXIS_COLORS[i] + '">' +
      name + " 轴<small>" + AXIS_LABELS[i] + '</small></div>' +
      '<div class="axis-rate">漂移 0.000 °/s</div>' +
      '<div class="axis-btns"><button data-d="-1">−</button>' +
      '<button data-d="1">+</button></div>';
    axesBox.appendChild(row);
    rateSpans.push(row.querySelector(".axis-rate"));
    row.querySelectorAll("button").forEach((btn) => {
      const dir = Number(btn.dataset.d);
      const key = "btn" + i + dir;
      const start = (ev) => { ev.preventDefault(); ensureAudio(); held.set(key, { axis: i, dir }); };
      const stop = () => held.delete(key);
      btn.addEventListener("pointerdown", start);
      btn.addEventListener("pointerup", stop);
      btn.addEventListener("pointerleave", stop);
    });
  });

  document.getElementById("restartBtn").addEventListener("click", () => location.reload());

  // ---------- Web Audio: pitch encodes drift direction ----------
  let audioCtx = null, osc = null, oscGain = null, panner = null;
  let muted = false;

  function ensureAudio() {
    if (audioCtx || typeof AudioContext === "undefined") return;
    audioCtx = new AudioContext();
    osc = audioCtx.createOscillator();
    osc.type = "sine";
    oscGain = audioCtx.createGain();
    oscGain.gain.value = 0;
    panner = audioCtx.createStereoPanner ? audioCtx.createStereoPanner() : null;
    if (panner) {
      osc.connect(oscGain).connect(panner).connect(audioCtx.destination);
    } else {
      osc.connect(oscGain).connect(audioCtx.destination);
    }
    osc.start();
  }

  function updateAudio(rate) {
    if (!audioCtx) return;
    // Pick the axis with the strongest residual drift.
    let axis = 0;
    for (let i = 1; i < 3; i++) if (Math.abs(rate[i]) > Math.abs(rate[axis])) axis = i;
    const r = Math.max(-1.5, Math.min(1.5, rate[axis]));
    const mag = Math.abs(r);
    const now = audioCtx.currentTime;
    // Higher pitch = positive drift, lower pitch = negative drift.
    const freq = 340 * Math.pow(2, r);
    osc.frequency.setTargetAtTime(freq, now, 0.05);
    const vol = muted || mag < 0.02 ? 0 : 0.03 + 0.09 * Math.min(1, mag / 1.5);
    oscGain.gain.setTargetAtTime(vol, now, 0.08);
    if (panner) panner.pan.setTargetAtTime((axis - 1) * 0.7, now, 0.1);
  }

  function chime() {
    if (!audioCtx || muted) return;
    [523, 659, 784].forEach((f, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.15, audioCtx.currentTime + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + i * 0.12 + 0.35);
      o.connect(g).connect(audioCtx.destination);
      o.start(audioCtx.currentTime + i * 0.12);
      o.stop(audioCtx.currentTime + i * 0.12 + 0.4);
    });
  }

  // ---------- trajectory history ----------
  const trail = [];
  const TRAIL_MAX = 900;

  // ---------- main loop ----------
  let last = performance.now();
  let chimed = false;

  function frame(now) {
    let dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    applyHeld(dt, false);
    // Fixed-ish step integration.
    sim.step(dt);
    const ro = sim.readout();

    trail.push([ro.error[0], ro.error[1]]);
    if (trail.length > TRAIL_MAX) trail.shift();

    for (let i = 0; i < 3; i++) {
      rateSpans[i].textContent =
        "漂移 " + (ro.rate[i] >= 0 ? "+" : "") + ro.rate[i].toFixed(3) + " °/s";
      rateSpans[i].style.color =
        Math.abs(ro.rate[i]) < 0.05 ? "#4ad991" : "#8fa0b5";
    }

    holdText.textContent =
      "稳定保持 " + ro.hold.toFixed(1) + " / " + params.holdTime.toFixed(1) + " s";
    holdFill.style.width = Math.min(100, (ro.hold / params.holdTime) * 100) + "%";
    statusText.textContent = ro.passed ? "已通过" : ro.inside ? "稳定中…" : "调整中";
    statusText.className = "status" + (ro.inside ? " ok" : "");

    updateAudio(ro.rate);
    drawBall(ballCtx, ro, trail, params, AXIS_COLORS);
    drawBands(bandCtx, ro, params, AXIS_NAMES, AXIS_COLORS);

    if (ro.passed && !chimed) {
      chimed = true;
      chime();
      finalBias.textContent = sim.state.bias
        .map((b, i) => AXIS_NAMES[i] + ": " + (b >= 0 ? "+" : "") + b.toFixed(3))
        .join("\n");
      resultBox.classList.remove("hidden");
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------- rendering ----------
  function drawBall(ctx, ro, trail, params, colors) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 14;
    const scale = R / DEG_RANGE;
    const [ex, ey, ez] = ro.error;

    ctx.clearRect(0, 0, W, H);

    // Ball background clipped to circle.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();

    // Artificial horizon: roll = ex, pitch = ey.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((ex * Math.PI) / 180);
    ctx.translate(0, ey * scale);
    ctx.fillStyle = "#16324f";
    ctx.fillRect(-W, -H * 2, W * 2, H * 2);
    ctx.fillStyle = "#3a2c1c";
    ctx.fillRect(-W, 0, W * 2, H * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-W, 0);
    ctx.lineTo(W, 0);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    for (let d = -4; d <= 4; d++) {
      if (d === 0) continue;
      ctx.beginPath();
      ctx.moveTo(-30, d * scale);
      ctx.lineTo(30, d * scale);
      ctx.stroke();
    }
    ctx.restore();

    // Trajectory of the error vector (ex, ey).
    if (trail.length > 1) {
      for (let i = 1; i < trail.length; i++) {
        const a = i / trail.length;
        ctx.strokeStyle = "rgba(255, 200, 90, " + (a * 0.8).toFixed(3) + ")";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx + trail[i - 1][0] * scale, cy - trail[i - 1][1] * scale);
        ctx.lineTo(cx + trail[i][0] * scale, cy - trail[i][1] * scale);
        ctx.stroke();
      }
    }
    ctx.restore();

    // Rim with yaw (ez) tick marker.
    ctx.strokeStyle = "#33405a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    const yawA = -Math.PI / 2 + (ez * Math.PI) / 180;
    ctx.strokeStyle = colors[2];
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx + (R - 10) * Math.cos(yawA), cy + (R - 10) * Math.sin(yawA));
    ctx.lineTo(cx + (R + 4) * Math.cos(yawA), cy + (R + 4) * Math.sin(yawA));
    ctx.stroke();

    // Tolerance circle (error band) and target crosshair.
    ctx.strokeStyle = ro.inside ? "rgba(74,217,145,0.9)" : "rgba(74,217,145,0.4)";
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, params.tol * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "#e8ecf3";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 16, cy); ctx.lineTo(cx + 16, cy);
    ctx.moveTo(cx, cy - 16); ctx.lineTo(cx, cy + 16);
    ctx.stroke();

    // Current error dot.
    const px = cx + ex * scale, py = cy - ey * scale;
    ctx.fillStyle = ro.inside ? "#4ad991" : "#ffc85a";
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#0a0e14";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawBands(ctx, ro, params, names, colors) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const range = 4; // ±4° per row
    ctx.clearRect(0, 0, W, H);
    const rowH = H / 3;
    const xOf = (v) => W / 2 + (v / range) * (W / 2 - 18);

    for (let i = 0; i < 3; i++) {
      const y0 = i * rowH;
      const yc = y0 + rowH / 2;
      // Tolerance band.
      ctx.fillStyle = "rgba(74,217,145,0.14)";
      ctx.fillRect(xOf(-params.tol), y0 + 6, xOf(params.tol) - xOf(-params.tol), rowH - 12);
      // Zero line.
      ctx.strokeStyle = "#33405a";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xOf(0), y0 + 4);
      ctx.lineTo(xOf(0), y0 + rowH - 4);
      ctx.stroke();
      // Error marker.
      const e = Math.max(-range, Math.min(range, ro.error[i]));
      ctx.strokeStyle = colors[i];
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(xOf(e), y0 + 8);
      ctx.lineTo(xOf(e), y0 + rowH - 8);
      ctx.stroke();
      // Labels.
      ctx.fillStyle = colors[i];
      ctx.font = "11px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(names[i] + " " + ro.error[i].toFixed(2) + "°", 6, y0 + 14);
      ctx.fillStyle = "rgba(74,217,145,0.7)";
      ctx.textAlign = "right";
      ctx.fillText("±" + params.tol.toFixed(1) + "°", W - 6, y0 + 14);
    }
  }
})();
