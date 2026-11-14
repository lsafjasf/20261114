/* Canvas 渲染：路口、车辆、信号灯、排队热区 */
(function () {
  'use strict';
  var W = 1000, H = 700;
  var CX = W / 2, CY = H / 2;
  var LANE = 26, HALF = 78;          // 路宽一半（3 车道）
  var CAR_L = 21, CAR_W = 10, GAP = 5;
  var COLORS = ['#9fd8e8', '#a8e6a1', '#f2d38a', '#e8b4d9', '#b8c4f2', '#f2b29a'];

  // 各进口几何：dir 为来车方向单位向量，stop 为停止线坐标
  var GEO = {
    W: { dir: { x: 1, y: 0 },  stop: { x: CX - HALF, y: CY }, side: 1 },
    E: { dir: { x: -1, y: 0 }, stop: { x: CX + HALF, y: CY }, side: 1 },
    N: { dir: { x: 0, y: 1 },  stop: { x: CX, y: CY - HALF }, side: 1 },
    S: { dir: { x: 0, y: -1 }, stop: { x: CX, y: CY + HALF }, side: 1 }
  };
  // 车道中心相对停止线中点的横向偏移（左车道靠中线）
  function laneOffset(approach, lane) {
    var off = lane === 'left' ? LANE * 0.5 : LANE * 1.5;
    switch (approach) {
      case 'W': return { x: 0, y: off };
      case 'E': return { x: 0, y: -off };
      case 'N': return { x: -off, y: 0 };
      case 'S': return { x: off, y: 0 };
    }
  }
  function carPos(approach, lane, idx) {
    var g = GEO[approach];
    var lo = laneOffset(approach, lane);
    var back = (CAR_L + GAP) * idx + CAR_L / 2 + 4;
    return {
      x: g.stop.x + lo.x - g.dir.x * back,
      y: g.stop.y + lo.y - g.dir.y * back,
      angle: Math.atan2(g.dir.y, g.dir.x)
    };
  }

  var canvas, ctx;
  function ensureCtx() {
    if (!canvas) {
      canvas = document.getElementById('scene');
      ctx = canvas.getContext('2d');
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawRoads() {
    ctx.fillStyle = '#0a130f';
    ctx.fillRect(0, 0, W, H);
    // 路面
    ctx.fillStyle = '#131d19';
    ctx.fillRect(0, CY - HALF, W, HALF * 2);
    ctx.fillRect(CX - HALF, 0, HALF * 2, H);
    // 路口中心
    ctx.fillStyle = '#15211c';
    ctx.fillRect(CX - HALF, CY - HALF, HALF * 2, HALF * 2);
    // 中线（黄）
    ctx.strokeStyle = 'rgba(245,185,66,.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([14, 10]);
    ctx.beginPath();
    ctx.moveTo(0, CY); ctx.lineTo(CX - HALF, CY);
    ctx.moveTo(CX + HALF, CY); ctx.lineTo(W, CY);
    ctx.moveTo(CX, 0); ctx.lineTo(CX, CY - HALF);
    ctx.moveTo(CX, CY + HALF); ctx.lineTo(CX, H);
    ctx.stroke();
    // 车道虚线（白）
    ctx.strokeStyle = 'rgba(216,230,222,.18)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([10, 12]);
    [-1, 1].forEach(function (s) {
      var o = s * LANE;
      ctx.beginPath();
      ctx.moveTo(0, CY + o); ctx.lineTo(CX - HALF, CY + o);
      ctx.moveTo(CX + HALF, CY + o); ctx.lineTo(W, CY + o);
      ctx.moveTo(CX + o, 0); ctx.lineTo(CX + o, CY - HALF);
      ctx.moveTo(CX + o, CY + HALF); ctx.lineTo(CX + o, H);
      ctx.stroke();
    });
    ctx.setLineDash([]);
    // 停止线
    ctx.strokeStyle = 'rgba(216,230,222,.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(CX - HALF, CY + 2); ctx.lineTo(CX - HALF, CY + HALF);
    ctx.moveTo(CX + HALF, CY - HALF); ctx.lineTo(CX + HALF, CY - 2);
    ctx.moveTo(CX - HALF, CY - HALF); ctx.lineTo(CX - 2, CY - HALF);
    ctx.moveTo(CX + 2, CY + HALF); ctx.lineTo(CX + HALF, CY + HALF);
    ctx.stroke();
    // 路名
    ctx.fillStyle = 'rgba(125,147,138,.7)';
    ctx.font = '12px sans-serif';
    ctx.fillText('滨 江 大 道', 30, CY - HALF - 12);
    ctx.save();
    ctx.translate(CX + HALF + 16, 30);
    ctx.fillText('云 杉 路', 0, 0);
    ctx.restore();
  }

  function signalState(state) {
    // 返回 {EW:{main,left}, NS:{...}}，取值 red/yellow/green
    var out = {
      EW: { main: 'red', left: 'red' },
      NS: { main: 'red', left: 'red' }
    };
    var sim = state.sim;
    if (!sim) return out;
    var ph = sim.phase();
    if (ph.axis) {
      out[ph.axis][ph.lane === 'left' ? 'left' : 'main'] = 'green';
    } else {
      out[state.lastAxis].main = 'yellow';
      out[state.lastAxis].left = 'yellow';
    }
    return out;
  }

  var LAMP = { red: '#f05555', yellow: '#f5b942', green: '#b9f24b' };

  function drawSignal(x, y, vertical, st) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#0d1512';
    ctx.strokeStyle = '#24352e';
    ctx.lineWidth = 1;
    var w = vertical ? 14 : 34, h = vertical ? 34 : 14;
    roundRect(-w / 2, -h / 2, w, h, 4);
    ctx.fill(); ctx.stroke();
    var lamps = ['red', 'yellow', 'green'];
    lamps.forEach(function (l, i) {
      var on = st.main === l;
      ctx.fillStyle = on ? LAMP[l] : '#22302a';
      if (on) { ctx.shadowColor = LAMP[l]; ctx.shadowBlur = 8; }
      ctx.beginPath();
      var dx = vertical ? 0 : (i - 1) * 10;
      var dy = vertical ? (i - 1) * 10 : 0;
      ctx.arc(dx, dy, 3.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    });
    // 左转箭头灯
    ctx.fillStyle = st.left === 'green' ? LAMP.green : (st.left === 'yellow' ? LAMP.yellow : '#22302a');
    if (st.left !== 'red') { ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 8; }
    ctx.beginPath();
    var ax = vertical ? 0 : -17, ay = vertical ? -17 : 0;
    ctx.arc(ax, ay, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSignals(state) {
    var st = signalState(state);
    drawSignal(CX - HALF - 16, CY + HALF - 18, true, st.EW);   // 西进口
    drawSignal(CX + HALF + 16, CY - HALF + 18, true, st.EW);   // 东进口
    drawSignal(CX - HALF + 18, CY - HALF - 16, false, st.NS);  // 北进口
    drawSignal(CX + HALF - 18, CY + HALF + 16, false, st.NS);  // 南进口
  }

  function drawHeat(state) {
    if (!state.sim) return;
    var q = state.sim.queues();
    Object.keys(q).forEach(function (a) {
      var ratio = Math.min(1, q[a] / 16);
      if (ratio <= 0.02) return;
      var g = GEO[a];
      var len = 40 + ratio * 320;
      var grad;
      var x0 = g.stop.x, y0 = g.stop.y;
      var x1 = x0 - g.dir.x * len, y1 = y0 - g.dir.y * len;
      grad = ctx.createLinearGradient(x0, y0, x1, y1);
      var col = ratio >= 1 ? '240,85,85' : ratio >= 0.75 ? '245,185,66' : '185,242,75';
      grad.addColorStop(0, 'rgba(' + col + ',' + (0.30 * ratio + 0.08) + ')');
      grad.addColorStop(1, 'rgba(' + col + ',0)');
      ctx.fillStyle = grad;
      ctx.save();
      ctx.beginPath();
      if (a === 'W') ctx.rect(x1, CY, len, HALF);
      if (a === 'E') ctx.rect(x0, CY - HALF, len, HALF);
      if (a === 'N') ctx.rect(CX - HALF, y1, HALF, len);
      if (a === 'S') ctx.rect(CX, y0, HALF, len);
      ctx.fill();
      ctx.restore();
    });
  }

  function drawCar(x, y, angle, color, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.fillStyle = color;
    roundRect(-CAR_L / 2, -CAR_W / 2, CAR_L, CAR_W, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(10,18,15,.55)';
    roundRect(-CAR_L / 2 + 4, -CAR_W / 2 + 2, 6, CAR_W - 4, 2);
    ctx.fill();
    ctx.restore();
  }

  function drawQueues(state) {
    var sim = state.sim;
    if (!sim) return;
    Object.keys(sim.lanes).forEach(function (a) {
      ['left', 'thru'].forEach(function (lane) {
        var n = sim.lanes[a][lane];
        for (var i = 0; i < n; i++) {
          var p = carPos(a, lane, i);
          var color = COLORS[(i * 7 + a.charCodeAt(0)) % COLORS.length];
          drawCar(p.x, p.y, p.angle, color);
        }
      });
      // 排队计数
      var g = GEO[a];
      var q = sim.lanes[a].left + sim.lanes[a].thru;
      var lx = g.stop.x - g.dir.x * 30;
      var ly = g.stop.y - g.dir.y * 30;
      ctx.font = 'bold 13px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = q > 16 ? '#f05555' : q >= 12 ? '#f5b942' : 'rgba(216,230,222,.75)';
      var off = laneOffset(a, 'thru');
      ctx.fillText(String(q), lx + off.x * 1.6, ly + off.y * 1.6 + 4);
      ctx.textAlign = 'left';
    });
  }

  function drawDepartures(state) {
    state.departAnims.forEach(function (d) {
      var g = GEO[d.approach];
      var lo = laneOffset(d.approach, d.lane);
      var prog = d.t / d.dur;
      var dist = prog * (HALF * 2 + 260);
      var x = g.stop.x + lo.x + g.dir.x * dist;
      var y = g.stop.y + lo.y + g.dir.y * dist;
      var angle = Math.atan2(g.dir.y, g.dir.x);
      // 左转车：过路口后向左并线（视觉上横向偏移）
      if (d.lane === 'left' && prog > 0.35) {
        var shift = (prog - 0.35) * 120;
        if (d.approach === 'W') y -= shift;
        if (d.approach === 'E') y += shift;
        if (d.approach === 'N') x += shift;
        if (d.approach === 'S') x -= shift;
      }
      var alpha = prog > 0.8 ? 1 - (prog - 0.8) / 0.2 : 1;
      drawCar(x, y, angle, '#cfe8d8', alpha * 0.95);
    });
  }

  function drawSpillback(state) {
    if (!state.sim) return;
    var q = state.sim.queues();
    Object.keys(q).forEach(function (a) {
      if (q[a] < state.sim.opts.storage) return;
      var g = GEO[a];
      var x = g.stop.x - g.dir.x * 430;
      var y = g.stop.y - g.dir.y * 430;
      ctx.fillStyle = '#f05555';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('⚠ 回堵上游', x, y);
      ctx.textAlign = 'left';
    });
  }

  window.Renderer = {
    draw: function (state) {
      ensureCtx();
      ctx.clearRect(0, 0, W, H);
      drawRoads();
      drawHeat(state);
      drawQueues(state);
      drawDepartures(state);
      drawSignals(state);
      drawSpillback(state);
      // 相位指示
      if (state.sim) {
        var ph = state.sim.phase();
        ctx.font = '12px ui-monospace, monospace';
        ctx.fillStyle = 'rgba(125,147,138,.9)';
        var label = ph.axis
          ? (ph.axis === 'EW' ? '东西向' : '南北向') + (ph.lane === 'left' ? ' · 左转相位' : ' · 直行相位')
          : '黄灯清空';
        ctx.fillText(label + '  ' + Math.max(0, ph.dur - state.sim.phaseT).toFixed(1) + 's', 16, H - 16);
      }
    }
  };
})();
