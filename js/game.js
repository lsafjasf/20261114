// 主循环、输入、渲染
(function () {
  'use strict';
  var P = window.Physics;
  var WORLD = P.WORLD;
  var DEG = P.DEG;
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');

  var st = P.createState();
  var keys = {};
  var wake = [];            // 航迹 {x, y, age}
  var message = { text: '', until: 0 };
  var lastTime = 0;
  var finished = false;

  function restart() {
    st = P.createState();
    wake = [];
    finished = false;
    showMessage('出航！依次通过 3 个浮标', 2.5);
  }

  function showMessage(text, secs) {
    message.text = text;
    message.until = performance.now() / 1000 + secs;
  }

  // ---------- 输入 ----------
  window.addEventListener('keydown', function (e) {
    if (e.repeat) return;
    SailAudio.start(); SailAudio.resume();
    keys[e.code] = true;
    if (e.code === 'KeyM') {
      var m = SailAudio.toggleMute();
      showMessage(m ? '声音关闭' : '声音开启', 1);
    }
    if (e.code === 'KeyR') restart();
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].indexOf(e.code) >= 0) e.preventDefault();
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });
  canvas.addEventListener('pointerdown', function () { SailAudio.start(); SailAudio.resume(); });

  function readInput() {
    return {
      rudder: (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0),
      sheet: (keys.ArrowUp || keys.KeyW ? 1 : 0) - (keys.ArrowDown || keys.KeyS ? 1 : 0),
      ballast: (keys.KeyE ? 1 : 0) - (keys.KeyQ ? 1 : 0)
    };
  }

  // ---------- 事件 ----------
  function handleEvents() {
    for (var i = 0; i < st.events.length; i++) {
      var e = st.events[i];
      if (e.type === 'buoy') {
        showMessage('通过 ' + e.name + '！航段 ' + st.leg + '/3 完成', 2.5);
        SailAudio.event('buoy');
      } else if (e.type === 'rock') {
        showMessage('触礁！船体 -' + e.damage.toFixed(0), 1.5);
        SailAudio.event('rock');
      } else if (e.type === 'capsize') {
        showMessage('翻覆了！按 R 重新出航', 999);
        SailAudio.event('capsize');
      } else if (e.type === 'sink') {
        showMessage('船体解体，沉没了…按 R 重新出航', 999);
        SailAudio.event('sink');
      } else if (e.type === 'finish') {
        showMessage('三段航程全部完成！用时 ' + e.time.toFixed(0) + ' 秒 · 按 R 再来一次', 999);
        SailAudio.event('finish');
        finished = true;
      }
    }
  }

  // ---------- 主循环 ----------
  function frame(nowMs) {
    var now = nowMs / 1000;
    var dt = Math.min(now - (lastTime || now), 0.05);
    lastTime = now;

    if (!st.capsized && !st.sunk && !st.finished) {
      // 子步进保证物理稳定
      for (var s = 0; s < 3; s++) {
        P.step(st, readInput(), dt / 3);
        handleEvents(); // 每个子步后立即消费事件，避免被下一步清空
      }
    }

    // 航迹记录
    if (st.dbg.speed > 0.4 && (wake.length === 0 ||
        Math.hypot(st.x - wake[wake.length - 1].x, st.y - wake[wake.length - 1].y) > 6)) {
      wake.push({ x: st.x, y: st.y, age: 0 });
    }
    for (var i = 0; i < wake.length; i++) wake[i].age += dt;
    while (wake.length && wake[0].age > 9) wake.shift();

    SailAudio.update(st.dbg.aws, st.dbg.luff, st.heel);
    render(now);
    updateHud();
    requestAnimationFrame(frame);
  }

  // ---------- 渲染 ----------
  function render(now) {
    // 水面底色：随深度渐变
    var g = ctx.createLinearGradient(0, 0, 0, WORLD.height);
    g.addColorStop(0, '#0e5f86');
    g.addColorStop(1, '#083c5c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    drawWaves(now);
    drawWindStreaks(now);
    drawRocks();
    drawBuoys(now);
    drawWake();
    drawBoat(now);
    drawWindArrow();
    drawMessage(now);
  }

  // 浪花：网格散点短弧，随时间漂移
  function drawWaves(now) {
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 2;
    var cell = 90;
    for (var gx = 0; gx < WORLD.width / cell; gx++) {
      for (var gy = 0; gy < WORLD.height / cell; gy++) {
        var h = Math.sin(gx * 12.9898 + gy * 78.233) * 43758.5453;
        h = h - Math.floor(h);
        var x = gx * cell + h * 60 + Math.sin(now * 0.6 + gy) * 8;
        var y = gy * cell + (h * 97 % 1) * 60 + Math.cos(now * 0.5 + gx) * 5;
        var len = 12 + h * 14;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + len * 0.5, y - 3, x + len, y);
        ctx.stroke();
      }
    }
  }

  // 风纹：沿风向流动的细线
  function drawWindStreaks(now) {
    ctx.strokeStyle = 'rgba(200,235,255,0.10)';
    ctx.lineWidth = 1.5;
    for (var i = 0; i < 26; i++) {
      var seed = i * 137.5;
      var x = (seed * 7.3 + now * 60) % (WORLD.width + 200) - 100;
      var y = (seed * 3.1 + now * 40) % (WORLD.height + 200) - 100;
      var w = P.windAt(x, y);
      var len = 20 + w.speed * 3;
      var ang = Math.atan2(w.vy, w.vx);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      ctx.stroke();
    }
  }

  function drawRocks() {
    for (var i = 0; i < WORLD.rocks.length; i++) {
      var r = WORLD.rocks[i];
      // 白沫圈
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r + 6, 0, Math.PI * 2);
      ctx.stroke();
      // 锯齿岩体
      ctx.fillStyle = '#4a4f55';
      ctx.beginPath();
      for (var k = 0; k < 9; k++) {
        var a = k / 9 * Math.PI * 2;
        var rr = r.r * (0.75 + 0.25 * Math.sin(k * 5.3 + i));
        var px = r.x + Math.cos(a) * rr, py = r.y + Math.sin(a) * rr;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.arc(r.x - r.r * 0.25, r.y - r.r * 0.3, r.r * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBuoys(now) {
    for (var i = 0; i < WORLD.buoys.length; i++) {
      var b = WORLD.buoys[i];
      var isNext = (i === st.leg);
      var passed = (i < st.leg);
      if (isNext) {
        var pulse = 1 + Math.sin(now * 4) * 0.12;
        ctx.strokeStyle = 'rgba(255,220,80,0.85)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r * pulse, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = passed ? '#3f8f5f' : (isNext ? '#e8433f' : '#8a4a44');
      ctx.beginPath();
      ctx.arc(b.x, b.y, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(b.x - 14, b.y - 3.5, 28, 7);
      ctx.fillStyle = '#06283d';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), b.x, b.y - 20);
    }
  }

  function drawWake() {
    if (wake.length < 2) return;
    for (var i = 1; i < wake.length; i++) {
      var a = Math.max(0, 1 - wake[i].age / 9);
      ctx.strokeStyle = 'rgba(255,255,255,' + (a * 0.45) + ')';
      ctx.lineWidth = 2 + a * 5;
      ctx.beginPath();
      ctx.moveTo(wake[i - 1].x, wake[i - 1].y);
      ctx.lineTo(wake[i].x, wake[i].y);
      ctx.stroke();
    }
  }

  // 船：俯视船体 + 斜仰视双桅帆，桅顶向横倾侧偏移
  function drawBoat(now) {
    var h = st.heading;
    var hx = Math.cos(h), hy = Math.sin(h);
    var sx = -hy, sy = hx;                       // 右舷方向
    var lean = Math.sin(st.heel);
    var leeSign = st.dbg.awa >= 0 ? -1 : 1;      // 下风侧
    var sa = st.dbg.sailAngle;
    var luff = st.dbg.luff;
    var flutter = luff * Math.sin(now * (6 + luff * 8)) * 5;

    var masts = [
      { dx: -12, boom: 30, mastH: 52 },          // 主桅
      { dx: 16, boom: 20, mastH: 38 }            // 前桅
    ];

    // 桅杆顶点/帆角点的世界坐标
    function mastGeo(m) {
      var bx = st.x + hx * m.dx, by = st.y + hy * m.dx;
      var topX = bx - sx * lean * m.mastH * 0.85;
      var topY = by - sy * lean * m.mastH * 0.85 - m.mastH * 0.72;
      var boomX = bx - hx * Math.cos(sa) * m.boom + sx * leeSign * Math.sin(sa) * m.boom;
      var boomY = by - hy * Math.cos(sa) * m.boom + sy * leeSign * Math.sin(sa) * m.boom;
      boomX += sx * flutter * 0.5; boomY += sy * flutter * 0.5;
      return { bx: bx, by: by, topX: topX, topY: topY, boomX: boomX, boomY: boomY };
    }

    // --- 帆影与船影（阳光斜射在水面）---
    ctx.fillStyle = 'rgba(2,20,35,0.25)';
    var shX = 26, shY = 30;
    for (var sh = 0; sh < masts.length; sh++) {
      var gm = mastGeo(masts[sh]);
      ctx.beginPath();
      ctx.moveTo(gm.topX + shX, gm.topY + shY);
      ctx.lineTo(gm.bx + shX, gm.by + shY);
      ctx.lineTo(gm.boomX + shX, gm.boomY + shY);
      ctx.closePath();
      ctx.fill();
    }
    ctx.save();
    ctx.translate(st.x + shX * 0.7, st.y + shY * 0.7);
    ctx.rotate(h);
    ctx.beginPath();
    ctx.ellipse(0, 0, 34, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // --- 船体 ---
    ctx.save();
    ctx.translate(st.x, st.y);
    ctx.rotate(h);
    ctx.fillStyle = st.sunk ? '#5a4a3a' : '#8a5a2b';
    ctx.beginPath();
    ctx.moveTo(34, 0);
    ctx.quadraticCurveTo(24, 10.5, -10, 9.5);
    ctx.quadraticCurveTo(-30, 8.5, -33, 0);
    ctx.quadraticCurveTo(-30, -8.5, -10, -9.5);
    ctx.quadraticCurveTo(24, -10.5, 34, 0);
    ctx.fill();
    ctx.fillStyle = '#d9b382';
    ctx.beginPath();
    ctx.ellipse(-2, 0, 22, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6b4423';
    ctx.fillRect(-16, -2, 8, 4); // 船舱
    ctx.restore();

    // --- 桅杆与帆 ---
    for (var mi = 0; mi < masts.length; mi++) {
      var g2 = mastGeo(masts[mi]);
      // 帆面
      var grad = ctx.createLinearGradient(g2.bx, g2.by, g2.boomX, g2.boomY);
      grad.addColorStop(0, luff > 0.4 ? '#e6dcc0' : '#f7f1de');
      grad.addColorStop(1, '#cfc39f');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(g2.topX, g2.topY);
      ctx.lineTo(g2.bx, g2.by);
      ctx.lineTo(g2.boomX, g2.boomY);
      ctx.quadraticCurveTo(
        (g2.topX + g2.boomX) / 2 + sx * leeSign * 6,
        (g2.topY + g2.boomY) / 2 + sy * leeSign * 6,
        g2.topX, g2.topY);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(90,70,40,0.55)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      // 桅杆
      ctx.strokeStyle = '#5a3a1a';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(g2.bx, g2.by);
      ctx.lineTo(g2.topX, g2.topY);
      ctx.stroke();
    }

    // 船首浪花
    if (st.dbg.speed > 1.5) {
      ctx.save();
      ctx.translate(st.x, st.y);
      ctx.rotate(h);
      ctx.strokeStyle = 'rgba(255,255,255,' + Math.min(0.7, st.dbg.speed * 0.12) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(30, 5);
      ctx.quadraticCurveTo(38, 10, 44, 13);
      ctx.moveTo(30, -5);
      ctx.quadraticCurveTo(38, -10, 44, -13);
      ctx.stroke();
      ctx.restore();
    }
  }

  // 风向罗盘（屏幕固定位置）
  function drawWindArrow() {
    var cx = WORLD.width / 2, cy = 64, R = 34;
    var w = P.windAt(st.x, st.y);
    ctx.save();
    ctx.fillStyle = 'rgba(4,30,48,0.72)';
    ctx.beginPath();
    ctx.arc(cx, cy, R + 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(140,220,255,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    // 风去向箭头
    var ang = Math.atan2(w.vy, w.vx);
    ctx.strokeStyle = '#ffd94d';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(ang) * R * 0.7, cy - Math.sin(ang) * R * 0.7);
    ctx.lineTo(cx + Math.cos(ang) * R * 0.7, cy + Math.sin(ang) * R * 0.7);
    ctx.stroke();
    ctx.fillStyle = '#ffd94d';
    ctx.beginPath();
    var tx = cx + Math.cos(ang) * R * 0.7, ty = cy + Math.sin(ang) * R * 0.7;
    ctx.moveTo(tx + Math.cos(ang) * 10, ty + Math.sin(ang) * 10);
    ctx.lineTo(tx + Math.cos(ang + 2.5) * 8, ty + Math.sin(ang + 2.5) * 8);
    ctx.lineTo(tx + Math.cos(ang - 2.5) * 8, ty + Math.sin(ang - 2.5) * 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#eaf6ff';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(w.speed.toFixed(1) + ' m/s', cx, cy + R + 26);
    ctx.restore();
  }

  function drawMessage(now) {
    var el = document.getElementById('message');
    el.textContent = now < message.until ? message.text : '';
  }

  function updateHud() {
    document.getElementById('hud-leg').textContent = Math.min(st.leg + 1, 3) + ' / 3';
    document.getElementById('hud-speed').textContent = (st.dbg.speed * 1.94).toFixed(1) + ' kn';
    document.getElementById('hud-wind').textContent = st.dbg.aws.toFixed(1) + ' m/s';
    var heelDeg = st.dbg.heelDeg;
    var heelEl = document.getElementById('hud-heel');
    heelEl.textContent = heelDeg.toFixed(0) + '°';
    heelEl.style.color = Math.abs(heelDeg) > 45 ? '#ff6b5e' : (Math.abs(heelDeg) > 30 ? '#ffd94d' : '#eaf6ff');
    var hullEl = document.getElementById('hud-hull');
    hullEl.textContent = st.hull.toFixed(0);
    hullEl.style.color = st.hull < 35 ? '#ff6b5e' : '#eaf6ff';
    document.getElementById('hud-sheet').textContent = (st.dbg.sailAngle / DEG).toFixed(0) + '°';
    document.getElementById('hud-rudder').textContent = (st.rudder * 35).toFixed(0) + '°';
    document.getElementById('hud-ballast').textContent = (st.ballast * 100).toFixed(0) + '%';
  }

  showMessage('出航！依次通过 3 个浮标', 3);
  requestAnimationFrame(frame);

  // 调试/自动化测试钩子
  window.__game = {
    get state() { return st; },
    restart: restart
  };
})();
