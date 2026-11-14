// 前端：输入、Canvas 渲染、WebAudio 声音
(function () {
  const Sim = window.PondSim;
  const canvas = document.getElementById("pond");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  let state = Sim.createState();
  const input = { light: 0.6, feed: 0.2, dose: 0, waterChange: false };

  // ---------- 输入绑定 ----------
  const lightSlider = document.getElementById("light");
  const feedSlider = document.getElementById("feed");
  lightSlider.addEventListener("input", () => {
    input.light = lightSlider.value / 100;
    document.getElementById("light-val").textContent = lightSlider.value + "%";
  });
  feedSlider.addEventListener("input", () => {
    input.feed = feedSlider.value / 100;
    document.getElementById("feed-val").textContent = feedSlider.value + "%";
  });
  const doseBtn = document.getElementById("dose");
  const doseOn = (e) => { e.preventDefault(); input.dose = 0.6; };
  const doseOff = () => { input.dose = 0; };
  doseBtn.addEventListener("pointerdown", doseOn);
  window.addEventListener("pointerup", doseOff);
  document.getElementById("water-change").addEventListener("click", () => {
    input.waterChange = true;
  });
  document.getElementById("restart").addEventListener("click", () => {
    state = Sim.createState();
    const msg = document.getElementById("message");
    msg.textContent = "";
    msg.className = "";
  });

  // ---------- 声音：强度随活动密度变化 ----------
  let audioCtx = null;
  let masterGain = null;
  let osc = null;
  let noiseGain = null;
  let muted = false;

  function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.05;
    masterGain.connect(audioCtx.destination);

    // 基础嗡鸣：音高随鱼群规模
    osc = audioCtx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 160;
    const oscGain = audioCtx.createGain();
    oscGain.gain.value = 0.5;
    osc.connect(oscGain).connect(masterGain);
    osc.start();

    // 气泡噪声：密度随活动
    const bufferSize = audioCtx.sampleRate;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const filter = audioCtx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 800;
    noiseGain = audioCtx.createGain();
    noiseGain.gain.value = 0.1;
    noise.connect(filter).connect(noiseGain).connect(masterGain);
    noise.start();
  }
  window.addEventListener("pointerdown", initAudio, { once: true });

  document.getElementById("mute").addEventListener("click", (e) => {
    muted = !muted;
    e.target.textContent = muted ? "声音关" : "声音开";
  });

  function updateAudio() {
    if (!audioCtx) return;
    const act = state.status === "running" ? state.activity : 0;
    const target = muted ? 0 : 0.02 + act * 0.25;
    masterGain.gain.setTargetAtTime(target, audioCtx.currentTime, 0.2);
    osc.frequency.setTargetAtTime(120 + state.fish * 3, audioCtx.currentTime, 0.3);
    noiseGain.gain.setTargetAtTime(0.05 + act * 0.6, audioCtx.currentTime, 0.2);
  }

  // ---------- 渲染 ----------
  function lerp(a, b, t) { return a + (b - a) * t; }

  function waterColor() {
    // 清澈蓝 -> 藻华绿，依据透明度与藻类占比
    const murk = 1 - state.transparency / 100;
    const algaeTint = state.algae / 100;
    return {
      r: Math.round(lerp(28, 74, murk) + algaeTint * 20),
      g: Math.round(lerp(120, 130, murk) + algaeTint * 30),
      b: Math.round(lerp(160, 60, murk)),
    };
  }

  function drawWater() {
    const c = waterColor();
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, `rgb(${c.r + 20},${c.g + 20},${c.b + 25})`);
    grad.addColorStop(1, `rgb(${c.r},${c.g - 20},${c.b - 30})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // 光照光柱
    if (input.light > 0.05) {
      ctx.save();
      ctx.globalAlpha = input.light * 0.25;
      ctx.fillStyle = "#fff8d0";
      ctx.beginPath();
      ctx.moveTo(W * 0.35, 0);
      ctx.lineTo(W * 0.65, 0);
      ctx.lineTo(W * 0.8, H);
      ctx.lineTo(W * 0.2, H);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // 生态色块：底部堆叠条，各色块宽度 ∝ 生物量
  function drawEcoBlocks() {
    const groups = [
      { label: "浮游植物", value: state.phyto, color: "#4dd0a6" },
      { label: "藻类", value: state.algae, color: "#8fce3a" },
      { label: "小鱼", value: state.fish, color: "#f2a541" },
    ];
    const total = groups.reduce((acc, g) => acc + g.value, 0) || 1;
    const barH = 34;
    const y = H - barH - 12;
    let x = 16;
    const barW = W - 32;
    ctx.font = "12px sans-serif";
    for (const g of groups) {
      const w = (g.value / total) * barW;
      ctx.fillStyle = g.color;
      ctx.fillRect(x, y, Math.max(w, 1), barH);
      if (w > 70) {
        ctx.fillStyle = "#0b1d26";
        ctx.fillText(`${g.label} ${g.value.toFixed(0)}`, x + 6, y + 21);
      }
      x += w;
    }
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.strokeRect(16, y, barW, barH);
  }

  // 食物链：阳光/营养 -> 浮游植物/藻类 -> 小鱼
  function drawFoodChain() {
    const nodes = {
      sun: { x: 90, y: 70, r: 22, color: "#ffd75e", label: "阳光" },
      nutr: { x: 90, y: 180, r: 14 + state.nutrients * 0.15, color: "#b08968", label: "营养" },
      phyto: { x: 260, y: 90, r: 12 + state.phyto * 0.28, color: "#4dd0a6", label: "浮游植物" },
      algae: { x: 260, y: 210, r: 10 + state.algae * 0.28, color: "#8fce3a", label: "藻类" },
      fish: { x: 460, y: 130, r: 12 + state.fish * 0.28, color: "#f2a541", label: "小鱼" },
    };
    const arrows = [
      ["sun", "phyto"], ["nutr", "phyto"], ["nutr", "algae"],
      ["phyto", "fish"], ["algae", "fish"],
    ];
    ctx.lineWidth = 2;
    for (const [a, b] of arrows) {
      const na = nodes[a];
      const nb = nodes[b];
      const dx = nb.x - na.x;
      const dy = nb.y - na.y;
      const len = Math.hypot(dx, dy);
      const sx = na.x + (dx / len) * na.r;
      const sy = na.y + (dy / len) * na.r;
      const ex = nb.x - (dx / len) * (nb.r + 6);
      const ey = nb.y - (dy / len) * (nb.r + 6);
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      // 箭头
      const ang = Math.atan2(ey - sy, ex - sx);
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - 9 * Math.cos(ang - 0.4), ey - 9 * Math.sin(ang - 0.4));
      ctx.lineTo(ex - 9 * Math.cos(ang + 0.4), ey - 9 * Math.sin(ang + 0.4));
      ctx.closePath();
      ctx.fill();
    }
    ctx.textAlign = "center";
    for (const key of Object.keys(nodes)) {
      const n = nodes[key];
      ctx.fillStyle = n.color;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#eaf6fa";
      ctx.font = "13px sans-serif";
      ctx.fillText(n.label, n.x, n.y + n.r + 16);
    }
    ctx.textAlign = "left";
  }

  // 透明度与氧气仪表
  function drawMeters() {
    const meters = [
      { label: "透明度", value: state.transparency, color: "#7ec8e3", y: 300 },
      { label: "溶解氧", value: state.oxygen, color: "#a8e6ff", y: 340 },
    ];
    for (const m of meters) {
      const x = W - 220;
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.fillRect(x, m.y, 180, 14);
      ctx.fillStyle = m.color;
      ctx.fillRect(x, m.y, (m.value / 100) * 180, 14);
      ctx.fillStyle = "#eaf6fa";
      ctx.font = "12px sans-serif";
      ctx.fillText(`${m.label} ${m.value.toFixed(0)}`, x, m.y - 5);
    }
    // 藻华预警
    if (state.algae > Sim.BLOOM_THRESHOLD * 0.8) {
      ctx.fillStyle = state.algae >= Sim.BLOOM_THRESHOLD ? "#ff6b6b" : "#ffd75e";
      ctx.font = "bold 15px sans-serif";
      ctx.fillText(
        state.algae >= Sim.BLOOM_THRESHOLD ? "⚠ 藻华爆发中！" : "⚠ 藻类逼近藻华阈值",
        W - 220,
        380
      );
    }
  }

  function drawFish() {
    // 简单游动的小鱼点缀
    const n = Math.min(Math.round(state.fish / 4), 18);
    ctx.fillStyle = "rgba(242,165,65,0.9)";
    for (let i = 0; i < n; i++) {
      const fx = ((i * 137 + state.t * 30 * (1 + (i % 3) * 0.3)) % (W + 60)) - 30;
      const fy = 250 + Math.sin(state.t * 1.5 + i * 2.1) * 20 + (i % 5) * 28;
      ctx.beginPath();
      ctx.ellipse(fx, fy, 9, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(fx - 9, fy);
      ctx.lineTo(fx - 15, fy - 5);
      ctx.lineTo(fx - 15, fy + 5);
      ctx.closePath();
      ctx.fill();
    }
  }

  function render() {
    drawWater();
    drawFish();
    drawFoodChain();
    drawMeters();
    drawEcoBlocks();
  }

  // ---------- HUD 与主循环 ----------
  function updateHud() {
    document.getElementById("hud-time").textContent = Math.max(
      0,
      Math.ceil(Sim.WIN_TIME - state.t)
    );
    document.getElementById("hud-diversity").textContent = state.diversity.toFixed(2);
    document.getElementById("hud-transparency").textContent = state.transparency.toFixed(0);
    const msg = document.getElementById("message");
    if (state.status === "win") {
      msg.textContent = "🎉 生态平衡达成！系统稳定运行了 5 分钟。";
      msg.className = "win";
    } else if (state.status === "fail") {
      msg.textContent = "💀 失败：" + state.failReason;
      msg.className = "fail";
    }
  }

  const DT = 0.1;
  let acc = 0;
  let lastTs = null;
  function loop(ts) {
    if (lastTs === null) lastTs = ts;
    acc += Math.min((ts - lastTs) / 1000, 0.25);
    lastTs = ts;
    while (acc >= DT) {
      Sim.step(state, input, DT);
      input.waterChange = false; // 换水是一次性动作
      acc -= DT;
    }
    render();
    updateHud();
    updateAudio();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
