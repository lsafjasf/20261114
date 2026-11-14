/* Canvas 渲染：纸张预览（CMYK 油墨错位）、放大镜对位标记、纸堆叠层。 */
var PressRender = (function () {
  "use strict";

  var COLORS = [
    { name: "C", css: "rgba(0,160,220,0.55)" },
    { name: "M", css: "rgba(220,0,140,0.55)" },
    { name: "Y", css: "rgba(230,200,0,0.55)" },
    { name: "K", css: "rgba(40,40,40,0.6)" }
  ];
  var MM_TO_PX = 90; // 预览图上 1mm 误差对应像素

  /* 油墨网点纹理：在离屏 canvas 上画一层随机网点 */
  function inkDots(ctx, x, y, w, h, color, seed) {
    var rng = PressLogic.mulberry32(seed);
    ctx.fillStyle = color;
    for (var i = 0; i < 260; i++) {
      var dx = x + rng() * w;
      var dy = y + rng() * h;
      var r = 1 + rng() * 2.2;
      ctx.beginPath();
      ctx.arc(dx, dy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* 单张纸预览：四色圆环按各自偏移绘制，错位肉眼可见 */
  function drawSheet(canvas, errX, errY, opts) {
    var ctx = canvas.getContext("2d");
    var W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    opts = opts || {};

    // 纸张
    ctx.fillStyle = opts.wrinkled ? "#efe9db" : "#f7f4ec";
    ctx.fillRect(20, 14, W - 40, H - 28);
    ctx.strokeStyle = "#c9c2b2";
    ctx.strokeRect(20, 14, W - 40, H - 28);

    // 起皱效果：画几道斜向褶皱阴影
    if (opts.wrinkled) {
      ctx.strokeStyle = "rgba(120,110,90,0.5)";
      for (var w = 0; w < 6; w++) {
        ctx.beginPath();
        ctx.moveTo(30 + w * 80, 16);
        ctx.quadraticCurveTo(60 + w * 80, H / 2, 40 + w * 80, H - 16);
        ctx.stroke();
      }
    }

    // 四色同心圆环：K 固定为基准，CMY 按误差比例偏移（K 也带一半漂移增强观感）
    var cx = W / 2, cy = H / 2;
    var offs = [
      { x: errX * MM_TO_PX, y: errY * MM_TO_PX },
      { x: errX * MM_TO_PX * 0.8, y: errY * MM_TO_PX * 0.9 },
      { x: errX * MM_TO_PX * 0.9, y: errY * MM_TO_PX * 0.7 },
      { x: 0, y: 0 }
    ];
    for (var i = 0; i < 4; i++) {
      var ox = cx + offs[i].x, oy = cy + offs[i].y;
      ctx.strokeStyle = COLORS[i].css;
      ctx.lineWidth = 10;
      for (var r = 30; r <= 110; r += 26) {
        ctx.beginPath();
        ctx.arc(ox, oy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      inkDots(ctx, ox - 120, oy - 120, 240, 240, COLORS[i].css, 1000 + i * 7);
    }
    ctx.lineWidth = 1;

    // 四角对位标记（十字 + 圆）
    drawRegisterMarks(ctx, 20, 14, W - 40, H - 28, errX * MM_TO_PX, errY * MM_TO_PX);

    // 容差圆（以 K 版为基准）
    ctx.strokeStyle = "rgba(80,200,120,0.8)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, PressLogic.TOLERANCE_MM * MM_TO_PX, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawRegisterMarks(ctx, x, y, w, h, ox, oy) {
    var pts = [[x + 18, y + 18], [x + w - 18, y + 18],
               [x + 18, y + h - 18], [x + w - 18, y + h - 18]];
    for (var i = 0; i < pts.length; i++) {
      var px = pts[i][0], py = pts[i][1];
      // K 基准十字
      ctx.strokeStyle = "#333";
      ctx.beginPath();
      ctx.moveTo(px - 7, py); ctx.lineTo(px + 7, py);
      ctx.moveTo(px, py - 7); ctx.lineTo(px, py + 7);
      ctx.stroke();
      // 色版偏移圆
      ctx.strokeStyle = "rgba(220,0,140,0.8)";
      ctx.beginPath();
      ctx.arc(px + ox * 0.5, py + oy * 0.5, 5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /* 放大镜：中心对位标记特写，显示各色版十字偏移与容差环 */
  function drawScope(canvas, errX, errY, tolerance) {
    var ctx = canvas.getContext("2d");
    var W = canvas.width, H = canvas.height;
    var cx = W / 2, cy = H / 2;
    var SCALE = 260; // 1mm -> px，放大视图
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#f2eee2";
    ctx.fillRect(0, 0, W, H);

    // 网格纸纹
    ctx.strokeStyle = "rgba(0,0,0,0.05)";
    for (var g = 0; g < W; g += 13) {
      ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(g, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, g); ctx.lineTo(W, g); ctx.stroke();
    }

    // 容差环
    ctx.strokeStyle = "rgba(60,180,100,0.9)";
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, tolerance * SCALE, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 各色版十字（K 居中，CMY 按误差偏移）
    var plates = [
      { css: "#222", dx: 0, dy: 0 },
      { css: "#00a0dc", dx: errX, dy: errY },
      { css: "#dc008c", dx: errX * 0.85, dy: errY * 0.9 },
      { css: "#e6c800", dx: errX * 0.9, dy: errY * 0.75 }
    ];
    for (var i = 0; i < plates.length; i++) {
      var p = plates[i];
      var px = cx + p.dx * SCALE, py = cy + p.dy * SCALE;
      ctx.strokeStyle = p.css;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px - 16, py); ctx.lineTo(px + 16, py);
      ctx.moveTo(px, py - 16); ctx.lineTo(px, py + 16);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px, py, 9, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineWidth = 1;

    // 镜筒暗角
    var grad = ctx.createRadialGradient(cx, cy, H * 0.32, cx, cy, H * 0.52);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  /* 纸堆：良品整齐叠放，废纸歪斜堆放 */
  function drawStack(canvas, history) {
    var ctx = canvas.getContext("2d");
    var W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    var good = history.filter(function (s) { return s.result.pass; });
    var bad = history.filter(function (s) { return !s.result.pass; });

    // 良品堆（左）
    for (var i = 0; i < good.length; i++) {
      var y = H - 30 - i * 12;
      ctx.fillStyle = "#f5f2e8";
      ctx.fillRect(20, y, 100, 10);
      ctx.strokeStyle = "#b8b0a0";
      ctx.strokeRect(20, y, 100, 10);
      ctx.fillStyle = "rgba(0,140,200,0.35)";
      ctx.fillRect(28, y + 2, 84, 3);
    }
    // 废纸堆（右，歪斜）
    for (var j = 0; j < bad.length; j++) {
      var by = H - 30 - j * 12;
      ctx.save();
      ctx.translate(190, by + 5);
      ctx.rotate((j % 2 ? -1 : 1) * 0.09 * (j + 1));
      ctx.fillStyle = "#e8ddc8";
      ctx.fillRect(-45, -5, 90, 10);
      ctx.strokeStyle = "#a89078";
      ctx.strokeRect(-45, -5, 90, 10);
      ctx.restore();
    }
    ctx.fillStyle = "#9aa3ad";
    ctx.font = "12px sans-serif";
    ctx.fillText("良品", 20, H - 8);
    ctx.fillText("废纸", 160, H - 8);
  }

  return { drawSheet: drawSheet, drawScope: drawScope, drawStack: drawStack };
})();
