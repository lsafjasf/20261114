// game.js -- 浏览器端：键盘输入、Web Audio 节拍/警报、Canvas 渲染
(function () {
  const Core = window.StageLightCore;
  const Auto = window.StageLightAuto;
  const { CFG, actorPos, kelvinToRgb } = Core;
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');

  let st = Core.createGame();
  let playing = false;
  let demo = false;
  const keys = {};

  // ---------- 输入 ----------
  window.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; });

  function humanInput() {
    return {
      temp1: (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0),
      temp2: (keys.KeyE ? 1 : 0) - (keys.KeyQ ? 1 : 0),
      brightness: (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0),
      aim: (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0),
      spread: (keys.ArrowUp ? 1 : 0) - (keys.ArrowDown ? 1 : 0),
    };
  }

  // ---------- Web Audio ----------
  let ac = null;
  function audio() { if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); return ac; }

  function beep(freq, dur, type, gain, when) {
    const a = audio(), t = a.currentTime + (when || 0);
    const o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(gain || 0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t); o.stop(t + dur);
  }
  const click = hi => beep(hi ? 1200 : 800, 0.05, 'square', 0.06);
  const alarm = () => { beep(880, 0.12, 'sawtooth', 0.12); beep(660, 0.12, 'sawtooth', 0.12, 0.15); };
  const chime = () => { beep(523, 0.15, 'sine', 0.15); beep(659, 0.15, 'sine', 0.15, 0.12); beep(784, 0.3, 'sine', 0.15, 0.24); };
  const sting = () => { beep(220, 0.4, 'sawtooth', 0.15); beep(165, 0.7, 'sawtooth', 0.15, 0.3); };

  // 节拍器：100 BPM，每小节 4 拍
  let nextBeat = 0, beatCount = 0;
  function metronome(now) {
    if (!playing || st.status !== 'running') return;
    if (now >= nextBeat) {
      click(beatCount % 4 === 0);
      beatCount++;
      nextBeat = (nextBeat || now) + 0.6;
      if (nextBeat < now) nextBeat = now + 0.6;
    }
  }

  function handleEvents() {
    for (const ev of st.events.splice(0)) {
      if (ev.type === 'overheat') alarm();
      if (ev.type === 'segment') chime();
      if (ev.type === 'win') { chime(); setTimeout(chime, 400); }
      if (ev.type === 'fail') sting();
    }
    if (st.lights.some(l => l.overheated) && st.status === 'running') {
      if (!handleEvents.lastAlarm || performance.now() - handleEvents.lastAlarm > 900) {
        handleEvents.lastAlarm = performance.now();
        alarm();
      }
    }
  }

  // ---------- 渲染 ----------
  function drawCone(lt) {
    const [r, g, b] = kelvinToRgb(lt.temp);
    const len = 560;
    const a1 = lt.angle - st.spread, a2 = lt.angle + st.spread;
    const grad = ctx.createRadialGradient(lt.x, lt.y, 10, lt.x, lt.y, len);
    const alpha = lt.overheated ? 0.04 : 0.10 + st.brightness * 0.25;
    grad.addColorStop(0, `rgba(${r},${g},${b},${alpha + 0.12})`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(lt.x, lt.y);
    ctx.arc(lt.x, lt.y, len, a1, a2);
    ctx.closePath();
    ctx.fill();
  }

  function drawHeatBar(lt, i) {
    const x = lt.x - 45, y = 20;
    ctx.fillStyle = '#222'; ctx.fillRect(x, y, 90, 10);
    const hot = lt.heat > 70;
    ctx.fillStyle = lt.overheated ? '#ff3344' : hot ? '#ff9933' : '#44cc66';
    ctx.fillRect(x, y, 90 * lt.heat / 100, 10);
    ctx.strokeStyle = '#555'; ctx.strokeRect(x, y, 90, 10);
    ctx.fillStyle = '#aaa'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(lt.overheated ? `灯${i + 1} 过热冷却 ${lt.coolLeft.toFixed(1)}s` : `灯${i + 1} 电机温度`, x + 45, y - 3);
  }

  function render() {
    ctx.clearRect(0, 0, CFG.width, CFG.height);
    // 舞台地板与弧线
    ctx.fillStyle = '#1a1a26';
    ctx.fillRect(0, CFG.floorY + 15, CFG.width, CFG.height - CFG.floorY);
    ctx.strokeStyle = '#3a3a4d'; ctx.setLineDash([6, 6]); ctx.beginPath();
    ctx.moveTo(130, 455); ctx.quadraticCurveTo(480, 345, 830, 455); ctx.stroke();
    ctx.setLineDash([]);
    // 桁架
    ctx.fillStyle = '#2c2c3a'; ctx.fillRect(0, 60, CFG.width, 8);

    for (const lt of st.lights) drawCone(lt);

    // 目标点标记（右侧玩家操控）
    ctx.strokeStyle = '#66aaff'; ctx.beginPath();
    ctx.arc(st.aimX, CFG.floorY, 8, 0, Math.PI * 2); ctx.stroke();

    // 演员 + 目标热区
    const actor = actorPos(st.actorS);
    ctx.strokeStyle = st.qualified ? '#4ade80' : '#facc15';
    ctx.lineWidth = 2; ctx.beginPath();
    ctx.arc(actor.x, actor.y, 26, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = '#e8c07a';
    ctx.beginPath(); ctx.arc(actor.x, actor.y - 14, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(actor.x - 6, actor.y - 8, 12, 26);

    // 灯体
    st.lights.forEach((lt, i) => {
      const [r, g, b] = kelvinToRgb(lt.temp);
      ctx.fillStyle = lt.overheated ? '#551111' : `rgb(${r},${g},${b})`;
      ctx.beginPath(); ctx.arc(lt.x, lt.y, 12, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.stroke();
      drawHeatBar(lt, i);
    });

    drawHud(actor);
    if (st.status !== 'running') drawOverlay();
  }

  function drawHud(actor) {
    const L = st.lights;
    ctx.textAlign = 'left'; ctx.font = '14px sans-serif';
    // 段落进度
    ctx.fillStyle = '#ddd';
    ctx.fillText(`第 ${Math.min(st.segment + 1, 5)}/5 段`, 20, CFG.height - 60);
    ctx.fillStyle = '#222'; ctx.fillRect(20, CFG.height - 50, 220, 12);
    ctx.fillStyle = '#4ade80';
    ctx.fillRect(20, CFG.height - 50, 220 * st.segmentProgress / CFG.segNeed[Math.min(st.segment, 4)], 12);
    ctx.strokeStyle = '#555'; ctx.strokeRect(20, CFG.height - 50, 220, 12);
    // 色温与亮度
    const dT = Math.abs(L[0].temp - L[1].temp);
    ctx.fillStyle = dT <= CFG.tempMatch ? '#4ade80' : '#ff6666';
    ctx.fillText(`色温 ${Math.round(L[0].temp)}K / ${Math.round(L[1].temp)}K（差 ${Math.round(dT)}K）`, 270, CFG.height - 40);
    ctx.fillStyle = st.brightness >= CFG.brightMin ? '#ddd' : '#ff6666';
    ctx.fillText(`亮度 ${(st.brightness * 100) | 0}%`, 620, CFG.height - 40);
    ctx.fillStyle = st.spread <= CFG.spreadMaxQual ? '#ddd' : '#ff6666';
    ctx.fillText(`扩散 ${(st.spread * 100).toFixed(0)}`, 730, CFG.height - 40);
    // 暗场警告
    if (st.darkTimer > 0.5 && st.status === 'running') {
      ctx.fillStyle = `rgba(255,40,40,${0.25 + 0.2 * Math.sin(st.time * 10)})`;
      ctx.fillRect(0, 0, CFG.width, CFG.height);
      ctx.fillStyle = '#ffdddd'; ctx.textAlign = 'center'; ctx.font = 'bold 22px sans-serif';
      ctx.fillText(`暗场警告 ${(CFG.darkLimit - st.darkTimer).toFixed(1)}s`, CFG.width / 2, 110);
    }
    // 合格指示
    ctx.textAlign = 'right'; ctx.font = '14px sans-serif';
    ctx.fillStyle = st.qualified ? '#4ade80' : '#888';
    ctx.fillText(st.qualified ? '● 合格照明' : '○ 未合格', CFG.width - 20, CFG.height - 40);
  }

  function drawOverlay() {
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, 0, CFG.width, CFG.height);
    ctx.textAlign = 'center';
    if (st.status === 'won') {
      ctx.fillStyle = '#4ade80'; ctx.font = 'bold 34px sans-serif';
      ctx.fillText('演出通过！五段照明全部完成', CFG.width / 2, 280);
    } else {
      ctx.fillStyle = '#ff5566'; ctx.font = 'bold 34px sans-serif';
      ctx.fillText('演出失败', CFG.width / 2, 270);
      ctx.font = '18px sans-serif'; ctx.fillStyle = '#ffcccc';
      ctx.fillText(st.failReason, CFG.width / 2, 310);
    }
    ctx.font = '15px sans-serif'; ctx.fillStyle = '#ccc';
    ctx.fillText('点击按钮重新开始', CFG.width / 2, 350);
  }

  // ---------- 主循环 ----------
  let last = 0;
  function loop(ts) {
    const dt = Math.min(0.05, (ts - last) / 1000 || 0);
    last = ts;
    if (playing && st.status === 'running') {
      Core.step(st, demo ? Auto.autoInput(st) : humanInput(), dt);
      handleEvents();
      metronome(ts / 1000);
    }
    render();
    requestAnimationFrame(loop);
  }

  function start(isDemo) {
    st = Core.createGame();
    demo = isDemo;
    playing = true;
    nextBeat = 0; beatCount = 0;
    audio().resume();
  }
  document.getElementById('startBtn').onclick = () => start(false);
  document.getElementById('demoBtn').onclick = () => start(true);
  requestAnimationFrame(loop);
})();
