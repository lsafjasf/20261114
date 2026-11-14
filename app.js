/* Canvas 2D seabed renderer: terrain, sea surface, dynamic contours,
 * labels, drag orbit, SVG/PNG export. No external data is loaded. */
(function () {
  'use strict';

  var N = 72;                 // height-field resolution
  var RENDER_STEP = 2;        // quad grid uses every 2nd field point
  var canvas = document.getElementById('view');
  var ctx = canvas.getContext('2d');

  var state = {
    seed: 20261114,
    tide: 0,
    spacing: 0.5,
    yaw: -0.7,
    pitch: 0.95,
    showSea: true,
    showLabels: true,
    grid: null,
    stats: null,
    levels: [],
    contours: [],
    tideContour: null,
    band: null,
    lastCheck: null
  };

  /* ---------------- camera / projection ---------------- */

  // World coordinates: x,z in [-1, 1], y = normalized height.
  function worldPoint(i, j, h) {
    return {
      x: (i / (N - 1)) * 2 - 1,
      y: h,
      z: (j / (N - 1)) * 2 - 1
    };
  }

  function rotate(p, yaw, pitch) {
    var cy = Math.cos(yaw);
    var sy = Math.sin(yaw);
    var x1 = p.x * cy - p.z * sy;
    var z1 = p.x * sy + p.z * cy;
    var cp = Math.cos(pitch);
    var sp = Math.sin(pitch);
    // pitch about the x axis; depth is the view-space y coordinate
    return {
      x: x1,
      y: z1 * sp - p.y * cp,
      depth: z1 * cp + p.y * sp
    };
  }

  function makeProjector() {
    var w = canvas.clientWidth || canvas.width;
    var hgt = canvas.clientHeight || canvas.height;
    var scale = Math.min(w, hgt) * 0.34;
    var cx = w / 2;
    var cy = hgt / 2;
    return function (p) {
      var r = rotate(p, state.yaw, state.pitch);
      return {
        sx: cx + r.x * scale,
        sy: cy - r.y * scale,
        depth: r.depth
      };
    };
  }

  /* ---------------- recompute pipeline ---------------- */

  function rebuildTerrain() {
    state.grid = Terrain.createHeightField(N, state.seed);
    state.stats = Terrain.gridStats(state.grid);
    rebuildTideControls();
    rebuildContours();
  }

  function rebuildContours() {
    state.levels = Terrain.contourLevels(
      state.stats.min, state.stats.max, state.spacing);
    state.contours = Terrain.extractContours(state.grid, N, state.levels);
    rebuildTideContour();
    state.band = Terrain.shoalBand(
      state.tide, state.stats.min, state.spacing);
  }

  function rebuildTideContour() {
    // the live tide line is recomputed every time the tide slider moves
    state.tideContour = Terrain.extractContour(state.grid, N, state.tide);
  }

  function rebuildTideControls() {
    var slider = document.getElementById('tide');
    var lo = state.stats.min;
    var hi = state.stats.max;
    slider.min = lo.toFixed(3);
    slider.max = hi.toFixed(3);
    if (state.tide < lo || state.tide > hi) {
      state.tide = Math.min(hi, Math.max(lo, state.tide || 0));
    }
    slider.value = state.tide.toFixed(3);
  }

  /* ---------------- live integrity self-check ---------------- */

  function runSelfCheck() {
    // 1) same seed must regenerate a bit-identical field
    var again = Terrain.createHeightField(N, state.seed);
    var sameSeed = again.length === state.grid.length;
    for (var k = 0; sameSeed && k < again.length; k++) {
      if (again[k] !== state.grid[k]) sameSeed = false;
    }
    // 2) every contour, including the moving tide line, must be unbroken
    var all = state.contours.concat([state.tideContour]);
    var v = Terrain.verifyContours(all, N);
    state.lastCheck = {
      ok: sameSeed && v.ok,
      sameSeed: sameSeed,
      contours: v
    };
    return state.lastCheck;
  }

  window.__seabed = { state: state, runSelfCheck: runSelfCheck };

  /* ---------------- rendering ---------------- */

  function rgb(c, a) {
    return a === undefined
      ? 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'
      : 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  // normalized height used to scale the vertical axis visually
  function heightScale(h) {
    var span = state.stats.max - state.stats.min || 1;
    return (h - state.stats.min) / span * 1.6 - 0.8;
  }

  function collectQuads(project) {
    var quads = [];
    var g = state.grid;
    for (var j = 0; j < N - RENDER_STEP; j += RENDER_STEP) {
      for (var i = 0; i < N - RENDER_STEP; i += RENDER_STEP) {
        var i2 = i + RENDER_STEP;
        var j2 = j + RENDER_STEP;
        var h00 = g[j * N + i];
        var h10 = g[j * N + i2];
        var h11 = g[j2 * N + i2];
        var h01 = g[j2 * N + i];
        var p0 = project(worldPoint(i, j, heightScale(h00)));
        var p1 = project(worldPoint(i2, j, heightScale(h10)));
        var p2 = project(worldPoint(i2, j2, heightScale(h11)));
        var p3 = project(worldPoint(i, j2, heightScale(h01)));
        var avgH = (h00 + h10 + h11 + h01) / 4;
        quads.push({
          pts: [p0, p1, p2, p3],
          depth: (p0.depth + p1.depth + p2.depth + p3.depth) / 4,
          h: avgH
        });
      }
    }
    return quads;
  }

  function collectSeaQuads(project) {
    var out = [];
    var y = heightScale(state.tide);
    for (var j = 0; j < N - RENDER_STEP; j += RENDER_STEP) {
      for (var i = 0; i < N - RENDER_STEP; i += RENDER_STEP) {
        var i2 = i + RENDER_STEP;
        var j2 = j + RENDER_STEP;
        var p0 = project(worldPoint(i, j, y));
        var p1 = project(worldPoint(i2, j, y));
        var p2 = project(worldPoint(i2, j2, y));
        var p3 = project(worldPoint(i, j2, y));
        out.push({
          pts: [p0, p1, p2, p3],
          depth: (p0.depth + p1.depth + p2.depth + p3.depth) / 4
        });
      }
    }
    return out;
  }

  function drawQuad(q, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(q.pts[0].sx, q.pts[0].sy);
    for (var k = 1; k < q.pts.length; k++) ctx.lineTo(q.pts[k].sx, q.pts[k].sy);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 0.4;
      ctx.stroke();
    }
  }

  function drawTerrain(quads) {
    for (var k = 0; k < quads.length; k++) {
      var q = quads[k];
      var base = Terrain.rampColor(Terrain.TERRAIN_RAMP, q.h);
      // simple depth shading for a sense of relief
      var shade = 0.82 + Math.min(0.18, Math.max(0, (q.depth + 1.4) * 0.06));
      var c = base.map(function (ch) {
        return Math.round(Math.min(255, ch * shade));
      });
      drawQuad(q, rgb(c), 'rgba(255,255,255,0.05)');
    }
  }

  function drawSea(seaQuads) {
    var water = state.band.water;
    for (var k = 0; k < seaQuads.length; k++) {
      drawQuad(seaQuads[k], rgb(water, 0.42));
    }
    // sea surface outline
    var corners = [
      worldPoint(0, 0, heightScale(state.tide)),
      worldPoint(N - 1, 0, heightScale(state.tide)),
      worldPoint(N - 1, N - 1, heightScale(state.tide)),
      worldPoint(0, N - 1, heightScale(state.tide))
    ].map(makeProjector());
    ctx.beginPath();
    ctx.moveTo(corners[0].sx, corners[0].sy);
    for (var k = 1; k < corners.length; k++) ctx.lineTo(corners[k].sx, corners[k].sy);
    ctx.closePath();
    ctx.strokeStyle = rgb(water, 0.9);
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  function drawContours(project) {
    var groups = state.contours;
    ctx.lineJoin = 'round';
    for (var g = 0; g < groups.length; g++) {
      var contour = groups[g];
      var isCoast = Math.abs(contour.level - state.tide) < 1e-9;
      for (var p = 0; p < contour.polylines.length; p++) {
        var line = contour.polylines[p];
        if (line.length < 2) continue;
        ctx.beginPath();
        for (var k = 0; k < line.length; k++) {
          var pt = line[k];
          var sp = project(worldPoint(pt.x, pt.y,
            heightScale(contour.level) + 0.012));
          if (k === 0) ctx.moveTo(sp.sx, sp.sy);
          else ctx.lineTo(sp.sx, sp.sy);
        }
        ctx.lineWidth = isCoast ? 2.4 : 1.1;
        ctx.strokeStyle = isCoast
          ? 'rgba(255,244,200,0.95)'
          : (contour.level < state.tide
              ? 'rgba(220,240,255,0.55)'
              : 'rgba(255,255,255,0.78)');
        ctx.stroke();
      }
    }
    drawTideLine(project);
  }

  function drawTideLine(project) {
    var c = state.tideContour;
    if (!c) return;
    ctx.save();
    ctx.setLineDash([7, 5]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(120,220,255,0.95)';
    for (var p = 0; p < c.polylines.length; p++) {
      var line = c.polylines[p];
      if (line.length < 2) continue;
      ctx.beginPath();
      for (var k = 0; k < line.length; k++) {
        var sp = project(worldPoint(line[k].x, line[k].y,
          heightScale(c.level) + 0.02));
        if (k === 0) ctx.moveTo(sp.sx, sp.sy);
        else ctx.lineTo(sp.sx, sp.sy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawLabels(project) {
    if (!state.showLabels) return;
    ctx.font = '11px "PingFang SC", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var used = [];
    for (var g = 0; g < state.contours.length; g++) {
      var contour = state.contours[g];
      for (var p = 0; p < contour.polylines.length; p++) {
        var line = contour.polylines[p];
        if (line.length < 18) continue; // label only well-developed lines
        var mid = line[Math.floor(line.length / 2)];
        var sp = project(worldPoint(mid.x, mid.y,
          heightScale(contour.level) + 0.03));
        // avoid overlapping labels when contour lines run close together
        var crowded = used.some(function (q) {
          return Math.hypot(q.sx - sp.sx, q.sy - sp.sy) < 46;
        });
        if (crowded) continue;
        used.push(sp);
        var label = (Math.round(contour.level * 100) / 100).toFixed(2);
        ctx.fillStyle = 'rgba(8,19,31,0.72)';
        var w = ctx.measureText(label).width + 8;
        ctx.fillRect(sp.sx - w / 2, sp.sy - 8, w, 16);
        ctx.fillStyle = 'rgba(235,245,255,0.95)';
        ctx.fillText(label, sp.sx, sp.sy + 0.5);
      }
    }
  }

  function render() {
    var cssW = canvas.clientWidth;
    var cssH = canvas.clientHeight;
    if (canvas.width !== Math.floor(cssW * devicePixelRatio) ||
        canvas.height !== Math.floor(cssH * devicePixelRatio)) {
      canvas.width = Math.floor(cssW * devicePixelRatio);
      canvas.height = Math.floor(cssH * devicePixelRatio);
    }
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    var project = makeProjector();

    // backdrop uses the current shoal-band haze, so a crossing retints
    // the whole scene
    var bg = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight);
    bg.addColorStop(0, rgb(state.band.haze));
    bg.addColorStop(1, '#08131f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

    var terrain = collectQuads(project).map(function (q) {
      return { kind: 'land', q: q };
    });
    var drawables = terrain;
    if (state.showSea) {
      var sea = collectSeaQuads(project).map(function (q) {
        return { kind: 'sea', q: q };
      });
      drawables = terrain.concat(sea);
    }
    // painter's algorithm: far (larger depth, away from camera) first
    drawables.sort(function (a, b) { return b.q.depth - a.q.depth; });

    for (var k = 0; k < drawables.length; k++) {
      var d = drawables[k];
      if (d.kind === 'land') {
        var base = Terrain.rampColor(Terrain.TERRAIN_RAMP, d.q.h);
        var shade = 0.82 + Math.min(0.18, Math.max(0, (d.q.depth + 1.4) * 0.06));
        var c = base.map(function (ch) {
          return Math.round(Math.min(255, ch * shade));
        });
        drawQuad(d.q, rgb(c), 'rgba(255,255,255,0.04)');
      } else {
        drawQuad(d.q, rgb(state.band.water, 0.4));
      }
    }

    if (state.showSea) drawSeaOutline(project);
    drawContours(project);
    drawLabels(project);
    updateHud();
  }

  function drawSeaOutline(project) {
    var y = heightScale(state.tide);
    var corners = [
      worldPoint(0, 0, y),
      worldPoint(N - 1, 0, y),
      worldPoint(N - 1, N - 1, y),
      worldPoint(0, N - 1, y)
    ].map(project);
    ctx.beginPath();
    ctx.moveTo(corners[0].sx, corners[0].sy);
    for (var k = 1; k < corners.length; k++) ctx.lineTo(corners[k].sx, corners[k].sy);
    ctx.closePath();
    ctx.strokeStyle = rgb(state.band.water, 0.95);
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  function updateHud() {
    var crossed = Math.max(0,
      Math.floor((state.tide - state.stats.min) / state.spacing + 1e-9));
    var html =
      '<div>种子 <b>' + state.seed + '</b></div>' +
      '<div>潮位 <b>' + state.tide.toFixed(2) + '</b> m</div>' +
      '<div>线距 <b>' + state.spacing.toFixed(2) + '</b> m</div>' +
      '<div>已跨等高线 <b>' + crossed + '</b> 条 · 浅滩 <b>' +
        state.band.name + '</b></div>' +
      '<div>等高线 <b>' + state.contours.length + '</b> 组 / 折线 ' +
        '<b>' + countLines(state.contours) + '</b> 条</div>';
    document.getElementById('hud').innerHTML = html;

    var badge = document.getElementById('badge');
    var check = state.lastCheck || runSelfCheck();
    badge.className = 'badge ' + (check.ok ? 'ok' : 'fail');
    badge.textContent = check.ok
      ? '✓ 同 seed 一致 · 等高线无断裂'
      : '✗ 校验失败：' + (check.contours.reason || 'seed mismatch');
  }

  function countLines(groups) {
    var n = 0;
    for (var k = 0; k < groups.length; k++) n += groups[k].polylines.length;
    return n;
  }

  /* ---------------- interaction ---------------- */

  var drag = null;
  canvas.addEventListener('pointerdown', function (e) {
    drag = { x: e.clientX, y: e.clientY, yaw: state.yaw, pitch: state.pitch };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!drag) return;
    state.yaw = drag.yaw + (e.clientX - drag.x) * 0.01;
    state.pitch = Math.max(0.15, Math.min(1.45,
      drag.pitch + (e.clientY - drag.y) * 0.01));
    render();
  });
  canvas.addEventListener('pointerup', function (e) {
    drag = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
  });

  function scheduleFrame() {
    if (scheduleFrame.queued) return;
    scheduleFrame.queued = true;
    requestAnimationFrame(function () {
      scheduleFrame.queued = false;
      runSelfCheck();
      render();
    });
  }

  function bindControls() {
    var tideEl = document.getElementById('tide');
    var gapEl = document.getElementById('gap');
    var seedEl = document.getElementById('seed');
    var seaEl = document.getElementById('showSea');
    var labelEl = document.getElementById('showLabels');

    tideEl.addEventListener('input', function () {
      state.tide = parseFloat(tideEl.value);
      rebuildTideContour();
      state.band = Terrain.shoalBand(state.tide, state.stats.min, state.spacing);
      document.getElementById('tideVal').textContent = state.tide.toFixed(2) + ' m';
      scheduleFrame();
    });

    gapEl.addEventListener('input', function () {
      state.spacing = parseFloat(gapEl.value);
      rebuildContours();
      document.getElementById('gapVal').textContent = state.spacing.toFixed(2) + ' m';
      scheduleFrame();
    });

    seedEl.addEventListener('change', function () {
      var v = parseInt(seedEl.value, 10);
      if (!Number.isFinite(v) || v < 1) return;
      state.seed = v >>> 0;
      seedEl.value = state.seed;
      rebuildTerrain();
      syncReadouts();
      scheduleFrame();
    });

    document.getElementById('reseed').addEventListener('click', function () {
      state.seed = (Math.floor(Math.random() * 0xffffffff) + 1) >>> 0;
      seedEl.value = state.seed;
      rebuildTerrain();
      syncReadouts();
      scheduleFrame();
    });

    seaEl.addEventListener('change', function () {
      state.showSea = seaEl.checked;
      render();
    });
    labelEl.addEventListener('change', function () {
      state.showLabels = labelEl.checked;
      render();
    });

    document.getElementById('exportSvg').addEventListener('click', exportSvg);
    document.getElementById('exportPng').addEventListener('click', exportPng);
  }

  function syncReadouts() {
    document.getElementById('seedVal').textContent = state.seed;
    document.getElementById('tideVal').textContent = state.tide.toFixed(2) + ' m';
    document.getElementById('gapVal').textContent = state.spacing.toFixed(2) + ' m';
    document.getElementById('tide').value = state.tide.toFixed(3);
    document.getElementById('seed').value = state.seed;
  }

  function buildLegend() {
    var host = document.getElementById('legend');
    host.innerHTML = Terrain.SHOAL_BANDS.map(function (b) {
      return '<div class="row"><span class="swatch" style="background:' +
        rgb(b.water) + '"></span>' + b.name + '</div>';
    }).join('');
  }

  /* ---------------- export ---------------- */

  // Top-down SVG contour layer in grid units (independent of camera).
  function buildSvg() {
    var size = 1000;
    var scale = size / (N - 1);
    var parts = [];
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + size +
      '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">');
    parts.push('<rect width="100%" height="100%" fill="#0b1622"/>');
    parts.push('<g fill="none" stroke-linejoin="round" stroke-linecap="round">');
    state.contours.forEach(function (contour) {
      var isCoast = Math.abs(contour.level - state.tide) < 1e-9;
      var color = isCoast ? '#fff4c8'
        : (contour.level < state.tide ? '#9cc7e8' : '#e8f2ff');
      var width = isCoast ? 2.4 : 1;
      contour.polylines.forEach(function (line) {
        if (line.length < 2) return;
        var d = line.map(function (p, k) {
          return (k ? 'L' : 'M') +
            (p.x * scale).toFixed(2) + ' ' + (p.y * scale).toFixed(2);
        }).join(' ');
        parts.push('<path d="' + d + '" stroke="' + color +
          '" stroke-width="' + width + '"/>');
      });
    });
    parts.push('</g>');
    // tide line as a distinct dashed layer
    parts.push('<g fill="none" stroke="#78dcff" stroke-width="2" ' +
      'stroke-dasharray="8 6">');
    state.tideContour.polylines.forEach(function (line) {
      if (line.length < 2) return;
      var d = line.map(function (p, k) {
        return (k ? 'L' : 'M') +
          (p.x * scale).toFixed(2) + ' ' + (p.y * scale).toFixed(2);
      }).join(' ');
      parts.push('<path d="' + d + '"/>');
    });
    parts.push('</g>');
    parts.push('<text x="16" y="30" fill="#cfe3f5" font-family="sans-serif" ' +
      'font-size="18">seed ' + state.seed + ' · tide ' +
      state.tide.toFixed(2) + ' · spacing ' + state.spacing.toFixed(2) +
      '</text>');
    parts.push('</svg>');
    return parts.join('\n');
  }

  function download(name, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportSvg() {
    var blob = new Blob([buildSvg()], { type: 'image/svg+xml;charset=utf-8' });
    download('contours-seed' + state.seed + '.svg', blob);
  }

  function exportPng() {
    runSelfCheck();
    render(); // ensure the canvas reflects current controls
    canvas.toBlob(function (blob) {
      download('seabed-overview-seed' + state.seed + '.png', blob);
    }, 'image/png');
  }

  /* ---------------- boot ---------------- */

  function init() {
    bindControls();
    buildLegend();
    rebuildTerrain();
    syncReadouts();
    runSelfCheck();
    render();
    window.addEventListener('resize', render);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
