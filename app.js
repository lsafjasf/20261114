/* 锋面剖面交互页面：Canvas 2D 渲染 + 交互 */
(function () {
  'use strict';

  var M = window.FrontModel;
  var canvas = document.getElementById('section');
  var ctx = canvas.getContext('2d');

  // 画布布局：主剖面区 + 底部独立风矢泳道（颜色与箭头互不遮挡）
  var PLOT = { left: 56, right: 860, top: 20, bottom: 424 };
  var WIND_LANE = { top: 440, bottom: 544 };

  var state = {
    frontId: 'warm',
    probeX: 500,          // 当前探针水平位置 (km)
    selectMode: false,
    selection: null,      // {x0,y0,x1,y1} 画布像素
    dragging: false,
    selecting: false
  };

  function xToPx(x) {
    return PLOT.left + (x - M.DOMAIN.xMin) / (M.DOMAIN.xMax - M.DOMAIN.xMin) * (PLOT.right - PLOT.left);
  }
  function zToPy(z) {
    return PLOT.bottom - (z - M.DOMAIN.zMin) / (M.DOMAIN.zMax - M.DOMAIN.zMin) * (PLOT.bottom - PLOT.top);
  }
  function pxToX(px) {
    var t = (px - PLOT.left) / (PLOT.right - PLOT.left);
    return M.DOMAIN.xMin + Math.min(1, Math.max(0, t)) * (M.DOMAIN.xMax - M.DOMAIN.xMin);
  }

  // 温度填色色带：冷蓝 -> 暖红
  function tempColor(t, tMin, tMax) {
    var k = (t - tMin) / (tMax - tMin || 1);
    k = Math.min(1, Math.max(0, k));
    var r = Math.round(40 + 215 * k);
    var g = Math.round(60 + 80 * (1 - Math.abs(k - 0.5) * 2));
    var b = Math.round(220 - 180 * k);
    return 'rgba(' + r + ',' + g + ',' + b + ',0.5)';
  }

  function fieldRange() {
    var tMin = Infinity, tMax = -Infinity;
    for (var i = 0; i <= 40; i++) {
      for (var j = 0; j <= 24; j++) {
        var t = M.temperatureAt(
          M.DOMAIN.xMin + (M.DOMAIN.xMax - M.DOMAIN.xMin) * i / 40,
          M.DOMAIN.zMin + (M.DOMAIN.zMax - M.DOMAIN.zMin) * j / 24,
          state.frontId);
        if (t < tMin) tMin = t;
        if (t > tMax) tMax = t;
      }
    }
    return { min: tMin, max: tMax };
  }

  function drawTempFill(range) {
    var nx = 100, nz = 60;
    var w = (PLOT.right - PLOT.left) / nx;
    var h = (PLOT.bottom - PLOT.top) / nz;
    for (var i = 0; i < nx; i++) {
      for (var j = 0; j < nz; j++) {
        var x = M.DOMAIN.xMin + (M.DOMAIN.xMax - M.DOMAIN.xMin) * (i + 0.5) / nx;
        var z = M.DOMAIN.zMin + (M.DOMAIN.zMax - M.DOMAIN.zMin) * (j + 0.5) / nz;
        ctx.fillStyle = tempColor(M.temperatureAt(x, z, state.frontId), range.min, range.max);
        ctx.fillRect(PLOT.left + i * w, PLOT.bottom - (j + 1) * h, w + 0.5, h + 0.5);
      }
    }
  }

  function drawFrontLine() {
    ctx.save();
    ctx.strokeStyle = '#ffd34d';
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    ctx.beginPath();
    var f = M.FRONTS[state.frontId];
    for (var z = M.DOMAIN.zMin; z <= M.DOMAIN.zMax; z += 0.2) {
      var px = xToPx(f.frontX(z)), py = zToPy(z);
      if (z === M.DOMAIN.zMin) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawAxes() {
    ctx.save();
    ctx.strokeStyle = '#3a4a61';
    ctx.fillStyle = '#9fb2c9';
    ctx.lineWidth = 1;
    ctx.font = '11px sans-serif';
    ctx.strokeRect(PLOT.left, PLOT.top, PLOT.right - PLOT.left, PLOT.bottom - PLOT.top);
    for (var z = 0; z <= 12; z += 3) {
      var py = zToPy(z);
      ctx.fillText(z + ' km', 14, py + 4);
      ctx.beginPath(); ctx.moveTo(PLOT.left - 4, py); ctx.lineTo(PLOT.left, py); ctx.stroke();
    }
    for (var x = 0; x <= 1000; x += 200) {
      var px = xToPx(x);
      ctx.fillText(x + '', px - 8, PLOT.bottom + 14);
    }
    ctx.fillText('水平距离 (km)', PLOT.right - 78, PLOT.bottom + 14);
    ctx.restore();
  }

  // 等温线：轻量 marching squares
  function drawIsotherms(range) {
    var nx = 80, nz = 48;
    var grid = [];
    var i, j;
    for (j = 0; j <= nz; j++) {
      var row = [];
      for (i = 0; i <= nx; i++) {
        row.push(M.temperatureAt(
          M.DOMAIN.xMin + (M.DOMAIN.xMax - M.DOMAIN.xMin) * i / nx,
          M.DOMAIN.zMin + (M.DOMAIN.zMax - M.DOMAIN.zMin) * j / nz,
          state.frontId));
      }
      grid.push(row);
    }
    var levels = [];
    for (var lv = Math.ceil(range.min / 3) * 3; lv <= range.max; lv += 3) levels.push(lv);

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1;
    ctx.font = '10px sans-serif';

    function interp(p1, p2, v1, v2, level) {
      var t = (level - v1) / (v2 - v1 || 1e-9);
      return [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t];
    }

    levels.forEach(function (level, li) {
      ctx.beginPath();
      var labelAnchor = null;
      var labelCol = Math.floor(nx * (0.18 + 0.13 * (li % 6)));
      for (var jj = 0; jj < nz; jj++) {
        for (var ii = 0; ii < nx; ii++) {
          var x0 = xToPx(M.DOMAIN.xMin + (M.DOMAIN.xMax - M.DOMAIN.xMin) * ii / nx);
          var x1 = xToPx(M.DOMAIN.xMin + (M.DOMAIN.xMax - M.DOMAIN.xMin) * (ii + 1) / nx);
          var y0 = zToPy(M.DOMAIN.zMin + (M.DOMAIN.zMax - M.DOMAIN.zMin) * jj / nz);
          var y1 = zToPy(M.DOMAIN.zMin + (M.DOMAIN.zMax - M.DOMAIN.zMin) * (jj + 1) / nz);
          var v = [grid[jj][ii], grid[jj][ii + 1], grid[jj + 1][ii + 1], grid[jj + 1][ii]];
          var pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
          var cross = [];
          for (var e = 0; e < 4; e++) {
            var a = v[e], b = v[(e + 1) % 4];
            if ((a < level && b >= level) || (a >= level && b < level)) {
              cross.push(interp(pts[e], pts[(e + 1) % 4], a, b, level));
            }
          }
          if (cross.length === 2) {
            ctx.moveTo(cross[0][0], cross[0][1]);
            ctx.lineTo(cross[1][0], cross[1][1]);
            if (!labelAnchor && ii === labelCol) labelAnchor = cross[0];
          } else if (cross.length === 4) {
            ctx.moveTo(cross[0][0], cross[0][1]); ctx.lineTo(cross[1][0], cross[1][1]);
            ctx.moveTo(cross[2][0], cross[2][1]); ctx.lineTo(cross[3][0], cross[3][1]);
          }
        }
      }
      ctx.stroke();
      if (labelAnchor) ctx.fillText(level + '°', labelAnchor[0] + 3, labelAnchor[1] - 3);
    });
    ctx.restore();
  }

  // 云层：沿锋面绘制的半透明白色云块
  function drawClouds() {
    var f = M.FRONTS[state.frontId];
    var spec = f.cloud;
    ctx.save();
    ctx.fillStyle = 'rgba(235,242,250,0.55)';
    ctx.strokeStyle = 'rgba(200,215,235,0.8)';
    ctx.lineWidth = 1;

    function puff(cx, cy, rx, ry) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }

    if (spec.type === 'layered') {
      // 暖锋：锋前大范围层状云
      for (var z = 1; z <= spec.top; z += 1.4) {
        var cx = xToPx(f.frontX(z) - spec.width * 0.7);
        puff(cx, zToPy(z), 120, 9);
        puff(cx - 90, zToPy(z) + 6, 90, 7);
      }
    } else if (spec.type === 'cumulus') {
      // 冷锋：锋区狭窄高耸积雨云
      for (var z2 = 0.8; z2 <= spec.top; z2 += 1.2) {
        var cx2 = xToPx(f.frontX(z2)) + 12 * Math.sin(z2 * 2.3);
        puff(cx2, zToPy(z2), 34, 16);
      }
      puff(xToPx(f.frontX(spec.top)), zToPy(spec.top + 0.6), 70, 12); // 砧状顶
    } else {
      // 静止锋：沿锋宽带状云
      for (var z3 = 0.8; z3 <= spec.top; z3 += 1.3) {
        var cx3 = xToPx(f.frontX(z3));
        puff(cx3 - 30, zToPy(z3), 55, 10);
        puff(cx3 + 40, zToPy(z3) - 4, 45, 8);
      }
    }
    ctx.restore();
  }

  // 底部独立风矢泳道：与主图颜色区域完全分离，箭头不与色块重叠
  function drawWindLane() {
    ctx.save();
    ctx.fillStyle = '#0a0f16';
    ctx.fillRect(PLOT.left, WIND_LANE.top, PLOT.right - PLOT.left, WIND_LANE.bottom - WIND_LANE.top);
    ctx.strokeStyle = '#3a4a61';
    ctx.strokeRect(PLOT.left, WIND_LANE.top, PLOT.right - PLOT.left, WIND_LANE.bottom - WIND_LANE.top);
    ctx.font = '11px sans-serif';

    var rows = M.LAYERS.length;
    var rowH = (WIND_LANE.bottom - WIND_LANE.top) / rows;
    for (var li = 0; li < rows; li++) {
      var cy = WIND_LANE.top + rowH * (li + 0.5);
      ctx.fillStyle = '#8fa1b8';
      ctx.fillText(M.LAYERS[li].name + '风', PLOT.left + 6, cy + 4);
      if (li > 0) {
        ctx.strokeStyle = '#223046';
        ctx.beginPath();
        ctx.moveTo(PLOT.left, WIND_LANE.top + rowH * li);
        ctx.lineTo(PLOT.right, WIND_LANE.top + rowH * li);
        ctx.stroke();
      }
      for (var x = 60; x <= 1000; x += 68) {
        var w = M.windAt(x, M.LAYERS[li].z, state.frontId, li);
        var px = xToPx(x);
        // 气象风向 -> 去向（水平投影）
        var toRad = ((w.dir + 180) % 360) * Math.PI / 180;
        var len = 6 + Math.min(20, w.speed * 0.55);
        var dx = -Math.sin(toRad) * len; // 0°=北风(向下)，90°=东风(向左)
        var dy = Math.cos(toRad) * len * 0.25;
        ctx.strokeStyle = '#6fd3a7';
        ctx.fillStyle = '#6fd3a7';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px - dx, cy - dy);
        ctx.lineTo(px + dx, cy + dy);
        ctx.stroke();
        var ang = Math.atan2(dy, dx);
        ctx.beginPath();
        ctx.moveTo(px + dx, cy + dy);
        ctx.lineTo(px + dx - 6 * Math.cos(ang - 0.5), cy + dy - 6 * Math.sin(ang - 0.5));
        ctx.lineTo(px + dx - 6 * Math.cos(ang + 0.5), cy + dy - 6 * Math.sin(ang + 0.5));
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#9fb2c9';
        ctx.font = '9px sans-serif';
        ctx.fillText(Math.round(w.speed) + '', px - 6, cy + rowH * 0.32);
        ctx.font = '11px sans-serif';
      }
    }
    ctx.restore();
  }

  // 探针十字线 + 三层高度标记
  function drawProbe() {
    var px = xToPx(state.probeX);
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(px, PLOT.top);
    ctx.lineTo(px, PLOT.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    M.LAYERS.forEach(function (layer) {
      var py = zToPy(layer.z);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#2f6fd0';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawSelection() {
    if (!state.selection) return;
    var s = state.selection;
    var x = Math.min(s.x0, s.x1), y = Math.min(s.y0, s.y1);
    var w = Math.abs(s.x1 - s.x0), h = Math.abs(s.y1 - s.y0);
    ctx.save();
    ctx.strokeStyle = '#c99bff';
    ctx.fillStyle = 'rgba(160,110,255,0.15)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var range = fieldRange();
    drawTempFill(range);
    drawIsotherms(range);
    drawClouds();
    drawFrontLine();
    drawAxes();
    drawWindLane();
    drawProbe();
    drawSelection();
  }

  // ===== 双读数同步：画布浮层 chip 与右侧面板由同一采样结果驱动 =====
  var chip = document.getElementById('probeChip');
  var panelX = document.getElementById('panelX');
  var panelFront = document.getElementById('panelFront');
  var tbody = document.querySelector('#readoutTable tbody');

  function fmt(v, digits) { return v.toFixed(digits); }

  function updateProbe() {
    var samples = M.sampleAt(state.probeX, state.frontId);
    var xText = fmt(state.probeX, 0) + ' km';

    // 读数组 1：画布左上角浮层
    var lines = ['位置 ' + xText + ' ｜ ' + M.FRONTS[state.frontId].name];
    samples.forEach(function (s) {
      lines.push(s.layer.name + '  ' + fmt(s.temperature, 1) + ' °C  '
        + fmt(s.pressure, 1) + ' hPa  ' + fmt(s.wind.speed, 1) + ' m/s');
    });
    chip.textContent = lines.join('\n');

    // 读数组 2：右侧面板
    panelX.textContent = xText;
    panelFront.textContent = M.FRONTS[state.frontId].name;
    tbody.innerHTML = samples.map(function (s) {
      return '<tr><td>' + s.layer.name + ' (' + s.layer.range + ')</td><td>'
        + fmt(s.temperature, 1) + '</td><td>'
        + fmt(s.pressure, 1) + '</td><td>'
        + fmt(s.wind.speed, 1) + '</td></tr>';
    }).join('');

    render();
  }

  // ===== 交互 =====
  function canvasPos(evt) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (evt.clientX - r.left) * (canvas.width / r.width),
      y: (evt.clientY - r.top) * (canvas.height / r.height)
    };
  }

  canvas.addEventListener('pointerdown', function (evt) {
    var p = canvasPos(evt);
    canvas.setPointerCapture(evt.pointerId);
    if (state.selectMode) {
      state.selecting = true;
      state.selection = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      render();
    } else {
      state.dragging = true;
      state.probeX = pxToX(p.x);
      updateProbe();
    }
  });

  canvas.addEventListener('pointermove', function (evt) {
    var p = canvasPos(evt);
    if (state.selecting && state.selection) {
      state.selection.x1 = p.x;
      state.selection.y1 = p.y;
      render();
    } else if (state.dragging) {
      state.probeX = pxToX(p.x);
      updateProbe();
    }
  });

  function endPointer() {
    if (state.selecting) updateSelectionInfo();
    state.dragging = false;
    state.selecting = false;
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  // 锋面图层切换
  document.querySelectorAll('.front-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.front-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      state.frontId = btn.dataset.front;
      updateProbe();
    });
  });

  // 选区模式与 PNG 导出
  var selectModeBtn = document.getElementById('selectModeBtn');
  var exportBtn = document.getElementById('exportBtn');
  var selectionInfo = document.getElementById('selectionInfo');

  selectModeBtn.addEventListener('click', function () {
    state.selectMode = !state.selectMode;
    selectModeBtn.setAttribute('aria-pressed', String(state.selectMode));
    canvas.style.cursor = state.selectMode ? 'cell' : 'crosshair';
  });

  function updateSelectionInfo() {
    var s = state.selection;
    var w = s ? Math.abs(s.x1 - s.x0) : 0;
    var h = s ? Math.abs(s.y1 - s.y0) : 0;
    if (s && w > 4 && h > 4) {
      exportBtn.disabled = false;
      selectionInfo.textContent = '已选择导出区域：' + Math.round(w) + ' × ' + Math.round(h) + ' px';
    } else {
      exportBtn.disabled = true;
      state.selection = null;
      selectionInfo.textContent = '未选择导出区域';
      render();
    }
  }

  exportBtn.addEventListener('click', function () {
    var s = state.selection;
    if (!s) return;
    var x = Math.min(s.x0, s.x1), y = Math.min(s.y0, s.y1);
    var w = Math.abs(s.x1 - s.x0), h = Math.abs(s.y1 - s.y0);
    var out = document.createElement('canvas');
    out.width = Math.round(w);
    out.height = Math.round(h);
    out.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
    var a = document.createElement('a');
    a.download = 'front-section-' + state.frontId + '-' + Math.round(state.probeX) + 'km.png';
    a.href = out.toDataURL('image/png');
    a.click();
  });

  // 供自动化验证读取的内部状态
  window.__app = {
    state: state,
    updateProbe: updateProbe,
    render: render
  };

  updateProbe();
})();

