/* Canvas side-view renderer: tanks, water levels, turbidity clouds,
 * fine-sand bed with churn particles, pipes and animated flow. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AquariumRender = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TANK_X = [60, 370, 680];
  var TANK_W = 240;
  var TOP = 90, BOTTOM = 390;
  var PIPE_Y = 430;

  function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function waterY(level) {
    return BOTTOM - level * (BOTTOM - TOP);
  }

  function drawTank(ctx, s, i, x) {
    var level = s.level[i];
    var wy = waterY(level);
    var tur = s.turbidity[i];

    // glass body
    ctx.save();
    roundedRect(ctx, x, TOP, TANK_W, BOTTOM - TOP, 10);
    ctx.fillStyle = 'rgba(210,235,245,0.18)';
    ctx.fill();
    ctx.clip();

    // water body
    var grad = ctx.createLinearGradient(0, wy, 0, BOTTOM);
    grad.addColorStop(0, 'rgba(70,150,205,0.85)');
    grad.addColorStop(1, 'rgba(25,85,140,0.92)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, wy, TANK_W, BOTTOM - wy);

    // animated surface wave
    ctx.beginPath();
    ctx.moveTo(x, wy);
    for (var px = 0; px <= TANK_W; px += 12) {
      var yy = wy + Math.sin((s.t * 2.2 + px * 0.12 + i * 2)) * 2.2;
      ctx.lineTo(x + px, yy);
    }
    ctx.lineTo(x + TANK_W, wy + 8);
    ctx.lineTo(x, wy + 8);
    ctx.closePath();
    ctx.fillStyle = 'rgba(160,215,245,0.55)';
    ctx.fill();

    drawTurbidity(ctx, s, i, x, wy, tur);
    if (i === 0) drawSand(ctx, s, x);
    if (i === 1) drawBubbles(ctx, s, x);
    ctx.restore();

    // glass outline
    roundedRect(ctx, x, TOP, TANK_W, BOTTOM - TOP, 10);
    ctx.strokeStyle = 'rgba(180,220,235,0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // level marker ticks for the allowed band
    var r = AquariumSim.CONFIG.ranges.level;
    ctx.fillStyle = 'rgba(120,230,160,0.85)';
    ctx.fillRect(x + TANK_W - 8, waterY(r[1]), 4, waterY(r[0]) - waterY(r[1]));
  }

  function drawTurbidity(ctx, s, i, x, wy, tur) {
    if (tur <= 0.01) return;
    var rng = Math.sin;
    var count = Math.round(6 + tur * 22);
    for (var n = 0; n < count; n++) {
      var seed = n * 37.7 + i * 91.3;
      var cx = x + 18 + ((rng(seed) * 43758.5) % 1) * (TANK_W - 36);
      var drift = Math.sin(s.t * 0.7 + seed) * 14;
      var cy = wy + 14 + ((rng(seed * 1.7) * 24634.6) % 1) * (BOTTOM - wy - 24);
      var rad = 14 + ((rng(seed * 2.3) * 12345.2) % 1) * 26;
      var g = ctx.createRadialGradient(cx + drift, cy, 2, cx + drift, cy, rad);
      g.addColorStop(0, 'rgba(150,130,95,' + (0.10 + tur * 0.30).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(150,130,95,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx + drift, cy, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawSand(ctx, s, x) {
    var bedH = 26;
    var churn = s.sandChurn;
    ctx.fillStyle = '#c9b183';
    ctx.fillRect(x, BOTTOM - bedH, TANK_W, bedH);
    ctx.fillStyle = '#b39a68';
    for (var k = 0; k < 26; k++) {
      var sx = x + (k * 37) % TANK_W;
      ctx.fillRect(sx, BOTTOM - bedH + (k % 3) * 7, 3, 3);
    }
    if (churn <= 0.02) return;
    // lifted fine-sand particles
    for (var p = 0; p < Math.round(churn * 40); p++) {
      var phase = (s.t * 1.6 + p * 0.37) % 1;
      var px2 = x + 10 + ((p * 53) % (TANK_W - 20));
      var py2 = BOTTOM - bedH - phase * (90 * churn + 20);
      ctx.fillStyle = 'rgba(201,177,131,' + (0.9 - phase * 0.7).toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(px2, py2, 1.6 + (p % 3) * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBubbles(ctx, s, x) {
    var f = s.flow.bc;
    for (var p = 0; p < 8; p++) {
      var phase = (s.t * (0.5 + f) + p * 0.23) % 1;
      var bx = x + 30 + ((p * 67) % (TANK_W - 60));
      var by = BOTTOM - 14 - phase * (BOTTOM - TOP - 40);
      ctx.strokeStyle = 'rgba(220,245,255,' + (0.55 - phase * 0.35).toFixed(2) + ')';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(bx, by, 2.5 + (p % 3), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function pipeSegment(ctx, x1, x2, y, flow, t) {
    ctx.strokeStyle = '#5d7686';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.stroke();
    // animated flow dashes
    if (flow > 0.02) {
      ctx.save();
      ctx.strokeStyle = 'rgba(150,220,255,0.9)';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 14]);
      ctx.lineDashOffset = -(t * 90 * flow) % 24;
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawValve(ctx, x, y, open, label) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#263846';
    ctx.strokeStyle = '#9fd4ef';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-14, -12); ctx.lineTo(14, 0); ctx.lineTo(-14, 12); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(14, -12); ctx.lineTo(-14, 0); ctx.lineTo(14, 12); ctx.closePath();
    ctx.fill(); ctx.stroke();
    // opening indicator
    ctx.fillStyle = open > 0.4 ? '#7fe3a4' : '#f0c66b';
    ctx.fillRect(-4, -18, 8 * open, 4);
    ctx.fillStyle = '#dcecf5';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label + ' ' + Math.round(open * 100) + '%', 0, 30);
    ctx.restore();
  }

  function drawPump(ctx, x, y, speed) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#1f3242';
    ctx.strokeStyle = '#9fd4ef';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    var blades = 4;
    ctx.rotate(speed * 20);
    ctx.fillStyle = '#7cc4ea';
    for (var b = 0; b < blades; b++) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.ellipse(7, 0, 7, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = '#dcecf5';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('循环泵 ' + Math.round(speed * 100) + '%', x, y + 34);
  }

  function drawPipes(ctx, s) {
    var xs = TANK_X;
    var midY = PIPE_Y, topY = 52;
    // bottom run A -> V1 -> B
    pipeSegment(ctx, xs[0] + TANK_W, xs[1], midY, s.flow.ab, s.t);
    drawValve(ctx, (xs[0] + TANK_W + xs[1]) / 2, midY, s.v1, '潮阀1');
    // bottom run B -> pump -> C
    pipeSegment(ctx, xs[1] + TANK_W, xs[2], midY, s.flow.bc, s.t);
    drawPump(ctx, (xs[1] + TANK_W + xs[2]) / 2, midY, s.pump);
    // return over the top: C -> V2 -> A
    ctx.strokeStyle = '#5d7686';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(xs[2] + TANK_W / 2, TOP);
    ctx.lineTo(xs[2] + TANK_W / 2, topY);
    ctx.lineTo(xs[0] + TANK_W / 2, topY);
    ctx.lineTo(xs[0] + TANK_W / 2, TOP);
    ctx.stroke();
    if (s.flow.ca > 0.02) {
      ctx.save();
      ctx.strokeStyle = 'rgba(150,220,255,0.9)';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 14]);
      ctx.lineDashOffset = -(s.t * 90 * s.flow.ca) % 24;
      ctx.beginPath();
      ctx.moveTo(xs[2] + TANK_W / 2, topY);
      ctx.lineTo(xs[0] + TANK_W / 2, topY);
      ctx.stroke();
      ctx.restore();
    }
    drawValve(ctx, (xs[0] + xs[2] + TANK_W) / 2, topY, s.v2, '潮阀2');
  }

  function readout(ctx, s, i, x) {
    var r = AquariumSim.CONFIG.ranges;
    function row(label, value, range, y) {
      var ok = value >= range[0] && value <= range[1];
      ctx.fillStyle = ok ? '#9fe6b6' : '#ff9a8b';
      ctx.font = '12px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(label + value.toFixed(2) + (ok ? '  ✓' : '  ✕'), x, y);
    }
    row('盐度 ', s.salinity[i], r.salinity, 470);
    row('溶氧 ', s.oxygen[i], r.oxygen, 486);
    row('浊度 ', s.turbidity[i], r.turbidity, 502);
    row('水位 ', s.level[i], r.level, 518);
  }

  function drawScene(ctx, s, W, H) {
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0c1d2b');
    bg.addColorStop(1, '#122b3c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    drawPipes(ctx, s);
    for (var i = 0; i < 3; i++) {
      drawTank(ctx, s, i, TANK_X[i]);
      ctx.fillStyle = '#dcecf5';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(AquariumSim.CONFIG.tanks[i], TANK_X[i] + TANK_W / 2, 78);
      readout(ctx, s, i, TANK_X[i] + 12);
    }
    // pressure / surge warning banner
    if (s.surgeAlarm > 0 || s.pressureAlarmOn || s.sandActive) {
      var msg = s.sandActive ? '⚠ 细砂翻涌中 ' + s.sandTimer.toFixed(0) + 's' : '⚠ 压力波动 / 超压';
      ctx.fillStyle = 'rgba(220,80,60,0.85)';
      roundedRect(ctx, W / 2 - 150, 532, 300, 28, 8);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(msg, W / 2, 551);
    }
    if (s.status !== 'running') {
      ctx.fillStyle = s.status === 'stabilized' ? 'rgba(40,140,90,0.88)' : 'rgba(150,40,35,0.9)';
      roundedRect(ctx, W / 2 - 200, H / 2 - 40, 400, 80, 12);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(s.status === 'stabilized' ? '稳定循环完成' : '闭馆：' + (s.closeReason || '异常'), W / 2, H / 2 + 6);
    }
  }

  return {
    TANK_X: TANK_X, TANK_W: TANK_W, TOP: TOP, BOTTOM: BOTTOM, PIPE_Y: PIPE_Y,
    waterY: waterY,
    drawTank: drawTank,
    drawScene: drawScene
  };
});
