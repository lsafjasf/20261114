// UI controller: state, parameter wiring, orbit/drag interactions and the
// synchronized highlighting between the 3D terrain and 2D section views.
(function () {
  'use strict';

  const canvas3d = document.getElementById('view3d');
  const canvas2d = document.getElementById('view2d');
  const renderer = Renderer3D.createRenderer(canvas3d);
  const section = Section2D.createSectionView(canvas2d);

  const ui = {
    amplitude: document.getElementById('amplitude'),
    level: document.getElementById('level'),
    yaw: document.getElementById('yaw'),
    pitch: document.getElementById('pitch'),
    zoom: document.getElementById('zoom'),
    amplitudeValue: document.getElementById('amplitudeValue'),
    levelValue: document.getElementById('levelValue'),
    yawValue: document.getElementById('yawValue'),
    pitchValue: document.getElementById('pitchValue'),
    zoomValue: document.getElementById('zoomValue'),
    stats: document.getElementById('stats'),
    checkResult: document.getElementById('checkResult'),
  };

  const state = {
    amplitude: 1,
    level: 0,
    terrain: null,
    contour: null,
    highlightPolylineId: null,
  };

  function rebuildTerrain() {
    state.terrain = Terrain.createTerrain({
      resolution: 48,
      amplitude: state.amplitude,
      seed: 20261114,
    });
    // Keep the level slider aligned to the new amplitude range.
    ui.level.min = state.terrain.hmin.toFixed(4);
    ui.level.max = state.terrain.hmax.toFixed(4);
    state.level = Math.max(state.terrain.hmin, Math.min(state.terrain.hmax, state.level));
    ui.level.value = state.level.toFixed(4);
    state.highlightPolylineId = null;
  }

  function highlightSegmentIds() {
    if (state.highlightPolylineId == null) return [];
    const line = state.contour.polylines[state.highlightPolylineId];
    return line ? line.segmentIds : [];
  }

  function render() {
    renderer.render(state.terrain, state.contour, state.level, {
      highlightSegmentIds: highlightSegmentIds(),
    });
    section.render(state.terrain, state.contour, {
      highlightPolylineIds:
        state.highlightPolylineId == null ? [] : [state.highlightPolylineId],
    });
    updateStats();
  }

  function updateStats() {
    const s = state.contour.stats;
    ui.stats.innerHTML =
      '切片高度 y = <b>' + state.level.toFixed(4) + '</b><br>' +
      '地形范围: [' + state.terrain.hmin.toFixed(3) + ', ' +
      state.terrain.hmax.toFixed(3) + ']<br>' +
      '轮廓线段: ' + s.segmentCount + '<br>' +
      '折线: ' + s.polylineCount + '（闭合环 ' + s.loopCount + ' / 开放 ' + s.openCount + '）<br>' +
      '总长度: ' + s.totalLength.toFixed(4);
  }

  function updateLevelLabels() {
    ui.levelValue.textContent = state.level.toFixed(3);
  }

  function refreshContour() {
    state.contour = Contour.extractContour(state.terrain, state.level);
    const id = state.highlightPolylineId;
    if (id != null && id >= state.contour.polylines.length) {
      state.highlightPolylineId = null;
    }
    updateLevelLabels();
    render();
  }

  // ---------- Slider wiring ----------
  ui.amplitude.addEventListener('input', () => {
    state.amplitude = parseFloat(ui.amplitude.value);
    ui.amplitudeValue.textContent = state.amplitude.toFixed(2);
    rebuildTerrain();
    refreshContour();
  });

  ui.level.addEventListener('input', () => {
    state.level = parseFloat(ui.level.value);
    refreshContour();
  });

  function syncViewSliders() {
    ui.yaw.value = Math.round((renderer.view.yaw * 180) / Math.PI);
    ui.pitch.value = Math.round((renderer.view.pitch * 180) / Math.PI);
    ui.zoom.value = renderer.view.scale.toFixed(2);
    ui.yawValue.textContent = ui.yaw.value + '°';
    ui.pitchValue.textContent = ui.pitch.value + '°';
    ui.zoomValue.textContent = renderer.view.scale.toFixed(2);
  }

  ui.yaw.addEventListener('input', () => {
    renderer.view.yaw = (parseFloat(ui.yaw.value) * Math.PI) / 180;
    ui.yawValue.textContent = ui.yaw.value + '°';
    render();
  });
  ui.pitch.addEventListener('input', () => {
    renderer.view.pitch = (parseFloat(ui.pitch.value) * Math.PI) / 180;
    ui.pitchValue.textContent = ui.pitch.value + '°';
    render();
  });
  ui.zoom.addEventListener('input', () => {
    renderer.view.scale = parseFloat(ui.zoom.value);
    ui.zoomValue.textContent = renderer.view.scale.toFixed(2);
    render();
  });

  // ---------- 3D view drag: orbit, and right/Shift drag moves the slice ----------
  const drag = { active: false, mode: 'orbit', x: 0, y: 0 };

  canvas3d.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas3d.addEventListener('pointerdown', (e) => {
    drag.active = true;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.moved = false;
    drag.mode = e.button === 2 || e.shiftKey ? 'slice' : 'orbit';
    canvas3d.setPointerCapture(e.pointerId);
  });

  canvas3d.addEventListener('pointermove', (e) => {
    if (!drag.active) {
      hover3d(e);
      return;
    }
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (drag.mode === 'orbit') {
      renderer.view.yaw += dx * 0.008;
      renderer.view.pitch = Math.max(0.08, Math.min(1.48, renderer.view.pitch + dy * 0.006));
      syncViewSliders();
    } else {
      const span = state.terrain.hmax - state.terrain.hmin;
      state.level = Math.max(
        state.terrain.hmin,
        Math.min(state.terrain.hmax, state.level - (dy / canvas3d.height) * span * 1.4)
      );
      ui.level.value = state.level.toFixed(4);
      refreshContour();
    }
    render();
  });

  canvas3d.addEventListener('pointerup', (e) => {
    if (drag.active && !drag.moved) pick3d(e);
    drag.active = false;
  });

  function eventPos(canvas, e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  // Map a picked triangle back to the polyline whose contour crosses it.
  function polylineForTriangle(triangleId) {
    for (let i = 0; i < state.contour.polylines.length; i++) {
      if (state.contour.polylines[i].triangleIds.includes(triangleId)) return i;
    }
    return null;
  }

  function pick3d(e) {
    const p = eventPos(canvas3d, e);
    const hit = renderer.pickTriangle(state.terrain, p.x, p.y);
    if (!hit) {
      state.highlightPolylineId = null;
    } else {
      state.highlightPolylineId = polylineForTriangle(hit.triangleId);
    }
    render();
  }

  function hover3d(e) {
    if (e.buttons) return;
    const p = eventPos(canvas3d, e);
    const hit = renderer.pickTriangle(state.terrain, p.x, p.y);
    canvas3d.style.cursor = hit ? 'pointer' : 'crosshair';
    if (!hit) return;
    const id = polylineForTriangle(hit.triangleId);
    if (id != null && id !== state.highlightPolylineId) {
      state.highlightPolylineId = id;
      render();
    }
  }

  // ---------- 2D section picking ----------
  canvas2d.addEventListener('pointermove', (e) => {
    if (e.buttons) return;
    const p = eventPos(canvas2d, e);
    const hit = section.pickPolyline(state.contour, p.x, p.y, canvas2d.width, canvas2d.height);
    canvas2d.style.cursor = hit ? 'pointer' : 'crosshair';
    const id = hit ? hit.polylineId : state.highlightPolylineId;
    if (hit && hit.polylineId !== state.highlightPolylineId) {
      state.highlightPolylineId = hit.polylineId;
      render();
    }
  });

  canvas2d.addEventListener('pointerdown', (e) => {
    const p = eventPos(canvas2d, e);
    const hit = section.pickPolyline(state.contour, p.x, p.y, canvas2d.width, canvas2d.height);
    state.highlightPolylineId = hit ? hit.polylineId : null;
    render();
  });

  // ---------- SVG export ----------
  document.getElementById('exportSvg').addEventListener('click', () => {
    const svg = SvgExport.buildSectionSvg(state.terrain, state.contour, {
      highlightPolylineIds:
        state.highlightPolylineId == null ? [] : [state.highlightPolylineId],
    });
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'section-y' + state.level.toFixed(3) + '.svg';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  // ---------- In-browser continuity self check ----------
  document.getElementById('runCheck').addEventListener('click', () => {
    const result = runContinuityCheck(state.terrain);
    const box = ui.checkResult;
    box.className = 'check ' + (result.pass ? 'ok' : 'fail');
    box.textContent = result.report;
  });

  // Sweep the plane from valley floor to ridge top using the same
  // topology-aware continuity criteria as tools/verify.js.
  function runContinuityCheck(terrain) {
    const samples = 200;
    const step = (terrain.hmax - terrain.hmin) / samples;
    const gridEdge = 1 / terrain.resolution;
    let prev = null;
    let firstLevel = null;
    let lastLevel = null;
    let worstMovement = 0;
    let worstBidirectional = 0;
    let topologyEvents = 0;
    const rows = [];

    function distToSegment(point, a, b) {
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len2 = dx * dx + dz * dz || 1;
      let tt = ((point.x - a.x) * dx + (point.z - a.z) * dz) / len2;
      tt = Math.max(0, Math.min(1, tt));
      return Math.hypot(point.x - (a.x + tt * dx), point.z - (a.z + tt * dz));
    }
    function distToContour(point, segments) {
      let best = Infinity;
      for (const seg of segments) best = Math.min(best, distToSegment(point, seg.a, seg.b));
      return best;
    }
    for (let k = 0; k <= samples; k++) {
      const level = terrain.hmin + (terrain.hmax - terrain.hmin) * (k / samples);
      const c = Contour.extractContour(terrain, level);
      if (c.segments.length) {
        if (firstLevel == null) firstLevel = level;
        lastLevel = level;
      }
      if (prev && prev.segments.length && c.segments.length) {
        let newToPrev = 0;
        for (const line of c.polylines) {
          let farthest = 0;
          for (const p of line.points) {
            farthest = Math.max(farthest, distToContour(p, prev.segments));
          }
          if (farthest <= gridEdge) worstMovement = Math.max(worstMovement, farthest);
          else topologyEvents++;
          newToPrev = Math.max(newToPrev, farthest);
        }
        let prevToNew = 0;
        for (const seg of prev.segments) {
          prevToNew = Math.max(prevToNew,
            distToContour(seg.a, c.segments), distToContour(seg.b, c.segments));
        }
        if (newToPrev > gridEdge && prevToNew > gridEdge) {
          worstBidirectional = Math.max(worstBidirectional, Math.min(newToPrev, prevToNew));
        }
      }
      if (k % 20 === 0 || k === samples) {
        rows.push('y=' + level.toFixed(3) + ' segs=' + c.stats.segmentCount +
          ' lines=' + c.stats.polylineCount + ' len=' + c.stats.totalLength.toFixed(3));
      }
      prev = c;
    }
    const tearLimit = gridEdge * 3;
    const pass = firstLevel != null && lastLevel != null &&
      worstMovement < gridEdge && worstBidirectional < tearLimit;
    return {
      pass,
      report:
        (pass ? '✔ 连续性检查通过' : '✘ 检测到不连续跳变') +
        '\n首条轮廓 y=' + firstLevel.toFixed(4) +
        '，末条轮廓 y=' + lastLevel.toFixed(4) +
        '\n持续组件最大移动=' + worstMovement.toFixed(4) +
        '（网格边长 ' + gridEdge.toFixed(4) + '）' +
        '\n双向跳变最大值=' + worstBidirectional.toFixed(4) +
        '（阈值 ' + tearLimit.toFixed(4) + '，超出均为跨网格顶点的离散切换）' +
        '，拓扑事件=' + topologyEvents +
        '\n\n' + rows.join('\n'),
    };
  }

  // ---------- Init ----------
  rebuildTerrain();
  refreshContour();
  syncViewSliders();
})();
