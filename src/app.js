/* global Coverage */
(function () {
  'use strict';

  var C = Coverage;
  var canvas = document.getElementById('map');
  var ctx = canvas.getContext('2d');
  var W = C.WORLD.width;
  var H = C.WORLD.height;

  var COLORS = ['#39d98a', '#4aa8ff', '#ff8a5c'];
  var TERRAIN_COLORS = {};
  TERRAIN_COLORS[C.TERRAIN.GRASS] = [77, 122, 68];
  TERRAIN_COLORS[C.TERRAIN.FOREST] = [47, 90, 54];
  TERRAIN_COLORS[C.TERRAIN.WATER] = [44, 95, 138];
  TERRAIN_COLORS[C.TERRAIN.ROCK] = [124, 116, 104];

  var terrain = C.createTerrain();
  var stations = C.defaultStations();
  var stats = null;
  var draggingId = null;
  var dragOffset = { x: 0, y: 0 };

  document.getElementById('seedLabel').textContent = String(C.SEED);

  function terrainImageData() {
    var img = ctx.createImageData(W, H);
    var data = img.data;
    for (var gy = 0; gy < terrain.gridH; gy++) {
      for (var gx = 0; gx < terrain.gridW; gx++) {
        var rgb = TERRAIN_COLORS[terrain.grid[gy * terrain.gridW + gx]];
        var x0 = gx * C.CELL;
        var y0 = gy * C.CELL;
        for (var py = y0; py < y0 + C.CELL; py++) {
          for (var px = x0; px < x0 + C.CELL; px++) {
            var off = (py * W + px) * 4;
            data[off] = rgb[0];
            data[off + 1] = rgb[1];
            data[off + 2] = rgb[2];
            data[off + 3] = 255;
          }
        }
      }
    }
    return img;
  }

  var terrainLayer = document.createElement('canvas');
  terrainLayer.width = W;
  terrainLayer.height = H;
  terrainLayer.getContext('2d').putImageData(terrainImageData(), 0, 0);

  function drawSector(st) {
    var start = (st.angle - st.beam / 2) * Math.PI / 180;
    var end = (st.angle + st.beam / 2) * Math.PI / 180;
    ctx.beginPath();
    ctx.moveTo(st.x, st.y);
    ctx.arc(st.x, st.y, st.radius, start, end);
    ctx.closePath();
    ctx.fill();
    if (st.beam < 359.999) {
      var mid = st.angle * Math.PI / 180;
      ctx.beginPath();
      ctx.moveTo(st.x, st.y);
      ctx.lineTo(st.x + Math.cos(mid) * st.radius, st.y + Math.sin(mid) * st.radius);
      ctx.stroke();
    }
  }

  function drawBlindHatch() {
    var gw = terrain.gridW;
    var gh = terrain.gridH;
    ctx.fillStyle = 'rgba(8, 12, 22, 0.72)';
    for (var gy = 0; gy < gh; gy++) {
      for (var gx = 0; gx < gw; gx++) {
        var idx = gy * gw + gx;
        if (C.COVERABLE[terrain.grid[idx]] && stats.counts[idx] === 0) {
          ctx.fillRect(gx * C.CELL, gy * C.CELL, C.CELL, C.CELL);
        }
      }
    }
  }

  function drawOverlap() {
    var gw = terrain.gridW;
    ctx.fillStyle = 'rgba(255, 196, 0, 0.5)';
    for (var i = 0; i < stats.counts.length; i++) {
      if (stats.counts[i] >= 2) {
        var gx = i % gw;
        var gy = Math.floor(i / gw);
        ctx.fillRect(gx * C.CELL, gy * C.CELL, C.CELL, C.CELL);
      }
    }
  }

  function drawGrid() {
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (var x = 0; x <= W; x += 100) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, H);
      ctx.stroke();
    }
    for (var y = 0; y <= H; y += 100) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(W, y + 0.5);
      ctx.stroke();
    }
  }

  function drawStations() {
    stations.forEach(function (st, i) {
      var col = COLORS[i];
      ctx.beginPath();
      ctx.arc(st.x, st.y, 9, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(st.name.slice(-1), st.x, st.y + 0.5);

      ctx.fillStyle = '#eef4ff';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(st.name + ' (' + Math.round(st.x) + ', ' + Math.round(st.y) + ')',
        st.x + 13, st.y - 12);
    });
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(terrainLayer, 0, 0);
    stations.forEach(function (st, i) {
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = COLORS[i];
      ctx.strokeStyle = COLORS[i];
      ctx.lineWidth = 2;
      drawSector(st);
      ctx.restore();
    });
    drawBlindHatch();
    drawOverlap();
    drawGrid();
    drawStations();
  }

  function fmtArea(m2) {
    return m2.toLocaleString('zh-CN') + ' m²';
  }

  function updateStats() {
    stats = C.computeCoverage(terrain, stations);
    document.getElementById('statCoverable').textContent = fmtArea(stats.coverableArea);
    document.getElementById('statCovered').textContent = fmtArea(stats.coveredArea);
    document.getElementById('statBlind').textContent = fmtArea(stats.blindArea);
    document.getElementById('statOverlap').textContent = fmtArea(stats.overlapArea);
    document.getElementById('statWaste').textContent = fmtArea(stats.wastedArea);
    document.getElementById('statRate').textContent =
      (stats.coverageRate * 100).toFixed(2) + '%';
    document.getElementById('wasteWarn').hidden = stats.wasteRate < 0.2;
    document.getElementById('confirmBox').hidden = true;
    render();
  }
  function buildControls() {
    var wrap = document.getElementById('stationControls');
    wrap.innerHTML = '';
    stations.forEach(function (st, i) {
      var card = document.createElement('div');
      card.className = 'station-card';
      card.innerHTML =
        '<h3><span class="dot" style="background:' + COLORS[i] + '"></span>' + st.name +
        ' <small style="color:#8b98b0">位置 ' + Math.round(st.x) + ', ' + Math.round(st.y) + ' m（可在地图上拖动）</small></h3>' +
        sliderHtml('radius-' + i, '覆盖半径', 60, 420, 10, st.radius, 'm') +
        sliderHtml('angle-' + i, '发射方位角', -180, 180, 1, st.angle, '°') +
        sliderHtml('beam-' + i, '波束宽度', 20, 360, 1, st.beam, '°');
      wrap.appendChild(card);
    });

    stations.forEach(function (st, i) {
      bind('radius-' + i, function (v) { st.radius = v; });
      bind('angle-' + i, function (v) { st.angle = v; });
      bind('beam-' + i, function (v) { st.beam = v; });
    });

    function sliderHtml(id, label, min, max, step, value, unit) {
      return '<div class="ctrl"><label>' + label + '<b><span id="' + id + '-val">' +
        value + '</span> ' + unit + '</b></label>' +
        '<input type="range" id="' + id + '" min="' + min + '" max="' + max +
        '" step="' + step + '" value="' + value + '"></div>';
    }

    function bind(id, apply) {
      var input = document.getElementById(id);
      var val = document.getElementById(id + '-val');
      input.addEventListener('input', function () {
        apply(Number(input.value));
        val.textContent = input.value;
        updateStats();
      });
    }
  }

  function refreshControlLabels() {
    stations.forEach(function (st, i) {
      document.getElementById('radius-' + i + '-val').textContent = st.radius;
      document.getElementById('angle-' + i + '-val').textContent = st.angle;
      document.getElementById('beam-' + i + '-val').textContent = st.beam;
      var card = document.querySelector('.station-card:nth-child(' + (i + 1) + ') h3 small');
      card.textContent = '位置 ' + Math.round(st.x) + ', ' + Math.round(st.y) + ' m（可在地图上拖动）';
      var inputs = document.querySelectorAll('.station-card:nth-child(' + (i + 1) + ') input');
      inputs[0].value = st.radius;
      inputs[1].value = st.angle;
      inputs[2].value = st.beam;
    });
  }

  function toMapCoords(evt) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (evt.clientX - rect.left) * (W / rect.width),
      y: (evt.clientY - rect.top) * (H / rect.height)
    };
  }

  function hitStation(p) {
    for (var i = stations.length - 1; i >= 0; i--) {
      var st = stations[i];
      var dx = p.x - st.x;
      var dy = p.y - st.y;
      if (dx * dx + dy * dy <= 14 * 14) return i;
    }
    return -1;
  }

  var mouseHud = document.getElementById('mouseHud');

  canvas.addEventListener('mousemove', function (evt) {
    var p = toMapCoords(evt);
    mouseHud.textContent = '鼠标位置: ' + Math.round(p.x) + ', ' +
      Math.round(p.y) + ' m';
    if (draggingId === null) return;
    var st = stations[draggingId];
    st.x = Math.max(0, Math.min(W, p.x - dragOffset.x));
    st.y = Math.max(0, Math.min(H, p.y - dragOffset.y));
    refreshControlLabels();
    updateStats();
  });

  canvas.addEventListener('mousedown', function (evt) {
    var p = toMapCoords(evt);
    var id = hitStation(p);
    if (id >= 0) {
      draggingId = id;
      dragOffset.x = p.x - stations[id].x;
      dragOffset.y = p.y - stations[id].y;
      canvas.classList.add('dragging');
    }
  });

  window.addEventListener('mouseup', function () {
    draggingId = null;
    canvas.classList.remove('dragging');
  });

  canvas.addEventListener('mouseleave', function () {
    mouseHud.textContent = '鼠标位置: --, -- m';
  });

  document.getElementById('btnConfirm').addEventListener('click', function () {
    document.getElementById('confirmBox').hidden = false;
    document.getElementById('confirmRate').textContent =
      (stats.coverageRate * 100).toFixed(2) + '%';
    document.getElementById('confirmDetail').textContent =
      '已覆盖 ' + fmtArea(stats.coveredArea) +
      '，盲区 ' + fmtArea(stats.blindArea) +
      '，重复覆盖浪费 ' + fmtArea(stats.wastedArea) +
      '（基于 ' + C.CELL + ' m 栅格估算，水域与岩石不计入可覆盖区域）。';
  });

  document.getElementById('btnExport').addEventListener('click', function () {
    var exportCanvas = document.createElement('canvas');
    exportCanvas.width = W;
    exportCanvas.height = H;
    var ex = exportCanvas.getContext('2d');
    ex.drawImage(canvas, 0, 0);
    ex.fillStyle = 'rgba(10,16,28,0.85)';
    ex.fillRect(12, H - 38, 430, 26);
    ex.fillStyle = '#dce3ef';
    ex.font = '13px sans-serif';
    ex.fillText('覆盖率 ' + (stats.coverageRate * 100).toFixed(2) +
      '% · 盲区 ' + fmtArea(stats.blindArea) + ' · seed ' + C.SEED, 20, H - 20);
    var link = document.createElement('a');
    link.download = 'base-station-coverage.png';
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
  });

  document.getElementById('btnReset').addEventListener('click', function () {
    stations = C.defaultStations();
    buildControls();
    updateStats();
  });

  buildControls();
  updateStats();
})();
