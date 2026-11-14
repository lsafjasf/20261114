// 渲染 + 输入 + Web Audio，依赖全局 Sim（src/sim.js）。
(function () {
  'use strict';

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var P = Sim.P;

  var W = 0, H = 0;
  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- 输入 ----------
  var keys = {};
  var KEYMAP = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down'
  };
  window.addEventListener('keydown', function (e) {
    if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = true; e.preventDefault(); }
    if (e.code === 'KeyR') reset();
    audio.unlock();
  });
  window.addEventListener('keyup', function (e) {
    if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = false;
  });

  function readInput() {
    return {
      x: (keys.right ? 1 : 0) - (keys.left ? 1 : 0),
      y: (keys.down ? 1 : 0) - (keys.up ? 1 : 0)
    };
  }

  // ---------- 音频：转速越高音越尖，锁定越稳越柔和 ----------
  var audio = (function () {
    var ac = null, osc, mod, modGain, tone, filter, master;
    function unlock() {
      if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      osc = ac.createOscillator();          // 主音：锁定度 -> 音高
      osc.type = 'sine';
      mod = ac.createOscillator();          // 颤音：超速 -> 抖动声
      mod.type = 'square';
      mod.frequency.value = 6;
      modGain = ac.createGain();
      modGain.gain.value = 0;
      mod.connect(modGain).connect(osc.frequency);
      filter = ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      tone = ac.createGain();
      tone.gain.value = 0;
      master = ac.createGain();
      master.gain.value = 0.5;
      osc.connect(filter).connect(tone).connect(master).connect(ac.destination);
      osc.start(); mod.start();
    }
    function update(view, speed) {
      if (!ac) return;
      var t = ac.currentTime;
      var lock = view ? view.lockRatio : 0;
      var excess = view ? view.excess : 0;
      // 基础音高随锁定度上升；转速整体抬高音高制造紧迫感
      var freq = 160 + lock * 320 + Math.min(speed, 6) * 30;
      osc.frequency.setTargetAtTime(freq, t, 0.05);
      // 超速抖动 -> 颤音深度 + 滤波放开（变刺耳）
      modGain.gain.setTargetAtTime(Math.min(excess * 60, 80), t, 0.05);
      filter.frequency.setTargetAtTime(700 + excess * 2200, t, 0.08);
      // 音量：有锁定时轻声，超速时变大
      var vol = 0.03 + lock * 0.05 + Math.min(excess * 0.08, 0.12);
      tone.gain.setTargetAtTime(vol, t, 0.08);
    }
    return { unlock: unlock, update: update };
  })();

  // ---------- 游戏状态 ----------
  var state = Sim.createState();
  function reset() { state = Sim.createState(); }

  // 世界 -> 屏幕投影（与 sim.js 判定一致的简易针孔模型）
  function project(worldX, worldZ) {
    var dx = worldX, dz = worldZ, dy = -P.camHeight;
    var cy = Math.cos(state.yaw), sy = Math.sin(state.yaw);
    // 绕竖直轴旋转到相机系（yaw=0 朝 +z）
    var cx1 = dx * cy - dz * sy;
    var cz1 = dx * sy + dz * cy;
    var cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
    var cy2 = dy * cp - cz1 * sp;
    var cz2 = dy * sp + cz1 * cp;
    if (cz2 <= 0.05) return null;
    var fx = 1 / Math.tan(P.fovHalfX);
    var fy = 1 / Math.tan(P.fovHalfY);
    return {
      x: W / 2 + (cx1 / cz2) * fx * (W / 2),
      y: H / 2 - (cy2 / cz2) * fy * (H / 2),
      depth: cz2
    };
  }

  // ---------- 渲染 ----------
  function drawGrass() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#20301c');
    g.addColorStop(0.5, '#2e4a24');
    g.addColorStop(1, '#3c5f2c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 草地网格：沿地面画透视线，直观看出云台转动
    var half = P.fieldSize / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    for (var i = -half; i <= half; i += 6) {
      drawGroundLine(i, -half, i, half);
      drawGroundLine(-half, i, half, i);
    }
    // 场地边界
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    drawGroundLine(-half, -half, half, -half);
    drawGroundLine(half, -half, half, half);
    drawGroundLine(half, half, -half, half);
    drawGroundLine(-half, half, -half, -half);
  }

  function drawGroundLine(x1, z1, x2, z2) {
    var a = project(x1, z1), b = project(x2, z2);
    if (!a || !b) return;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  function drawTrajectory() {
    ctx.strokeStyle = 'rgba(255,220,120,0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    var started = false;
    for (var i = 0; i < Sim.TRAJECTORY.length; i++) {
      var p = project(Sim.TRAJECTORY[i][0], Sim.TRAJECTORY[i][1]);
      if (!p) { started = false; continue; }
      if (!started) { ctx.moveTo(p.x, p.y); started = true; }
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  function drawTarget() {
    var pos = Sim.targetPosAt(state.t);
    var p = project(pos[0], pos[1]);
    if (!p) return;
    var r = Math.max(4, 220 / p.depth);
    ctx.fillStyle = '#e8483f';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r *0.35, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawViewfinder() {
    var cx = W / 2, cy = H / 2;
    // 取景框
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - W * 0.28, cy - H * 0.28, W * 0.56, H * 0.56);
    // 中心十字（含抖动偏移，直观看到不稳定）
    var jx = (state.jitterX / P.fovHalfX) * W * 0.28;
    var jy = -(state.jitterY / P.fovHalfY) * H * 0.28;
    ctx.strokeStyle = state.view && state.view.excess > 0 ? '#ff7a5c' : '#7dffb0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + jx - 16, cy + jy); ctx.lineTo(cx + jx + 16, cy + jy);
    ctx.moveTo(cx + jx, cy + jy - 16); ctx.lineTo(cx + jx, cy + jy + 16);
    ctx.stroke();
  }

  function drawHUD() {
    var v = state.view;
    ctx.font = '14px monospace';
    // 稳定误差条：横向 = yaw 误差，纵向 = pitch 误差
    var bx = 20, by = 20, bw = 220, bh = 14;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(bx - 6, by - 6, bw + 12, 86);
    ctx.fillStyle = '#cfe8d2';
    ctx.fillText('稳定误差', bx, by + 2);
    var ex = v ? Sim.clamp(v.nx, -1, 1) : 0;
    var ey = v ? Sim.clamp(v.ny, -1, 1) : 0;
    ctx.fillStyle = '#333'; ctx.fillRect(bx, by + 8, bw, bh);
    ctx.fillStyle = Math.abs(ex) > 0.7 ? '#ff7a5c' : '#7dffb0';
    ctx.fillRect(bx + bw / 2, by + 8, ex * bw / 2, bh);
    ctx.fillStyle = '#333'; ctx.fillRect(bx, by + 26, bw, bh);
    ctx.fillStyle = Math.abs(ey) > 0.7 ? '#ff7a5c' : '#7dffb0';
    ctx.fillRect(bx + bw / 2, by + 26, ey * bw / 2, bh);
    // 转速与抖动提示
    var spd = v ? v.speed : 0;
    ctx.fillStyle = spd > P.safeSpeed ? '#ff7a5c' : '#cfe8d2';
    ctx.fillText('转速 ' + spd.toFixed(2) + ' rad/s' +
      (v && v.excess > 0 ? '  抖动!' : ''), bx, by + 58);
    // 锁定进度 / 出画倒计时
    ctx.fillStyle = '#cfe8d2';
    ctx.fillText('锁定 ' + state.lockTimer.toFixed(1) + ' / ' +
      P.winTime.toFixed(0) + ' s', bx, by + 76);
    if (state.outTimer > 0) {
      ctx.fillStyle = '#ff5c5c';
      ctx.font = 'bold 22px monospace';
      ctx.fillText('目标出画! ' + (P.outGrace - state.outTimer).toFixed(1),
        W / 2 - 110, 60);
      ctx.font = '14px monospace';
    }
    // 结束画面
    if (state.status !== 'running') {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = state.status === 'win' ? '#7dffb0' : '#ff5c5c';
      ctx.font = 'bold 48px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(state.status === 'win' ? '追踪完成!' : '目标丢失',
        W / 2, H / 2);
      ctx.font = '18px sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText('按 R 重新开始', W / 2, H / 2 + 44);
      ctx.textAlign = 'left';
    }
  }

  // ---------- 主循环 ----------
  var last = performance.now();
  function frame(now) {
    var dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    Sim.step(state, readInput(), dt);
    drawGrass();
    drawTrajectory();
    drawTarget();
    drawViewfinder();
    drawHUD();
    audio.update(state.view, state.view ? state.view.speed : 0);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 供自动化测试钩子使用
  window.__game = {
    getState: function () { return state; },
    reset: reset,
    step: function (input, dt) { Sim.step(state, input, dt); }
  };
})();
