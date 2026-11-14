/*
 * app.js — 交互主控：拖拽控制点、requestAnimationFrame 实时播放、
 * 预设保存、时间线复用、速度连续性自检
 */
(function () {
  'use strict';

  var SAMPLE_COUNT = 240;
  var DEFAULT_DURATION_MS = 2000;

  var COLORS = {
    linear: '#8a93a5',
    ease: '#7b61ff',
    easeIn: '#d64545',
    easeOut: '#2e8b57',
    easeInOut: '#1f78b4',
    custom: '#e08214'
  };

  var state = {
    controlPoints: [0.25, 0.1, 0.25, 1],
    driverId: 'easeIn',
    compareId: 'easeOut',
    playing: false,
    progress: 0,
    durationMs: DEFAULT_DURATION_MS,
    dragIndex: -1,
    timelineMode: false,
    timelineElapsed: 0,
    timelineValue: 0,
    lastFrameTs: 0
  };

  var store = new EasingPresets.PresetStore();
  var timeline = new EasingTimeline.Timeline();

  function buildEasing(presetId, customP) {
    if (presetId === 'custom') {
      return new EasingCore.Easing(customP[0], customP[1], customP[2], customP[3]);
    }
    var preset = store.findById(presetId);
    var p = preset ? preset.p : [0, 0, 1, 1];
    return new EasingCore.Easing(p[0], p[1], p[2], p[3]);
  }

  function currentCurves() {
    var customEasing = buildEasing('custom', state.controlPoints);
    var list = EasingPresets.BUILTIN.map(function (preset) {
      return {
        id: preset.id,
        name: preset.name,
        color: COLORS[preset.id],
        easing: buildEasing(preset.id)
      };
    });
    list.push({
      id: 'custom',
      name: '自定义曲线',
      color: COLORS.custom,
      easing: customEasing
    });
    return list;
  }

  function findCurve(curves, id) {
    return curves.filter(function (c) { return c.id === id; })[0];
  }

  /* 速度连续性检测：采样相邻速度的最大跳变（绝对差与相对差） */
  function velocityContinuity(easing) {
    var samples = easing.sample(SAMPLE_COUNT);
    var maxJump = 0;
    var maxRelJump = 0;
    var atU = 0;
    var maxAccel = 0;
    var vMin = Infinity, vMax = -Infinity;
    samples.forEach(function (pt) {
      if (pt.v < vMin) vMin = pt.v;
      if (pt.v > vMax) vMax = pt.v;
      if (Math.abs(pt.a) > maxAccel) maxAccel = Math.abs(pt.a);
    });
    var vRange = Math.max(vMax - vMin, 0.05);
    for (var i = 1; i < samples.length; i++) {
      var jump = Math.abs(samples[i].v - samples[i - 1].v);
      if (jump > maxJump) {
        maxJump = jump;
        atU = samples[i].u;
      }
      var localV = Math.max(Math.abs(samples[i].v), Math.abs(samples[i - 1].v));
      if (localV > vRange * 0.15) {
        if (jump / localV > maxRelJump) maxRelJump = jump / localV;
      }
    }
    return {
      maxJump: maxJump, maxRelJump: maxRelJump,
      normalizedJump: maxJump / vRange, maxAccel: maxAccel,
      atU: atU, samples: samples
    };
  }

  function renderAll() {
    var curves = currentCurves();
    var driver = findCurve(curves, state.driverId) || curves[0];
    var compare = findCurve(curves, state.compareId);

    var editorInfo = EasingRender.drawCurveEditor(
      document.getElementById('curveCanvas'),
      {
        curves: curves,
        driverId: state.driverId,
        compareId: state.compareId,
        controlPoints: state.controlPoints,
        dragIndex: state.dragIndex,
        timeCursor: state.progress
      }
    );
    window._editorInfo = editorInfo;

    var balls = [{
      label: driver.name,
      progress: state.timelineMode ? state.timelineValue :
        driver.easing.valueAt(state.progress),
      color: driver.color,
      ghost: false,
      lane: 0
    }];
    if (compare && compare.id !== driver.id) {
      balls.push({
        label: compare.name,
        progress: state.timelineMode ? state.timelineValue :
          compare.easing.valueAt(state.progress),
        color: compare.color,
        ghost: true,
        lane: 26
      });
    }
    EasingRender.drawTrack(document.getElementById('trackCanvas'), { balls: balls });

    var driverSamples = driver.easing.sample(SAMPLE_COUNT);
    var series = [{ samples: driverSamples, color: driver.color, label: driver.name }];
    if (compare && compare.id !== driver.id) {
      series.push({
        samples: compare.easing.sample(SAMPLE_COUNT),
        color: compare.color,
        label: compare.name
      });
    }
    EasingRender.drawGraph(document.getElementById('dispCanvas'), '位移 s(u)', series, 's', state.progress);
    EasingRender.drawGraph(document.getElementById('velCanvas'), '速度 ds/du', series, 'v', state.progress);
    EasingRender.drawGraph(document.getElementById('accCanvas'), '加速度 d²s/du²', series, 'a', state.progress);

    updateReadout(driver, compare);
  }

  function updateReadout(driver, compare) {
    var check = velocityContinuity(driver.easing);
    var el = document.getElementById('continuity');
    var ok = check.normalizedJump < 0.05 && check.maxRelJump < 0.10 &&
      isFinite(check.maxAccel) && check.maxAccel < 60;
    el.textContent = '速度连续性自检（' + driver.name + '）：最大相邻跳变 ' +
      check.maxJump.toFixed(5) + '（相对 ' + (check.maxRelJump * 100).toFixed(2) +
      '%，归一化 ' + (check.normalizedJump * 100).toFixed(2) + '%，最大加速度 ' +
      check.maxAccel.toFixed(2) + '，位于 u=' + check.atU.toFixed(3) +
      '）→ ' + (ok ? '通过，无明显断点' : '存在断点');
    el.className = 'check ' + (ok ? 'ok' : 'bad');

    document.getElementById('pointReadout').textContent =
      'P1=(' + state.controlPoints[0].toFixed(3) + ', ' +
      state.controlPoints[1].toFixed(3) + ')  P2=(' +
      state.controlPoints[2].toFixed(3) + ', ' +
      state.controlPoints[3].toFixed(3) + ')' +
      '  当前 u=' + state.progress.toFixed(3) +
      (state.timelineMode && window._timelineLocal ?
        '  时间线片段 ' + (window._timelineLocal.index + 1) +
        '，片段内进度=' + window._timelineLocal.localProgress.toFixed(3) : '');
  }

  window.EasingApp = {
    state: state,
    store: store,
    timeline: timeline,
    renderAll: renderAll,
    velocityContinuity: velocityContinuity,
    currentCurves: currentCurves,
    buildEasing: buildEasing
  };

  /* ---- 播放循环：仅用 requestAnimationFrame 按真实时间增量实时求值 ---- */
  function frame(ts) {
    if (!state.playing) return;
    if (!state.lastFrameTs) state.lastFrameTs = ts;
    var delta = ts - state.lastFrameTs;
    state.lastFrameTs = ts;

    if (state.timelineMode && timeline.clips.length > 0) {
      state.timelineElapsed += delta;
      var total = timeline.totalDuration();
      if (state.timelineElapsed >= total) {
        state.timelineElapsed = total;
        state.playing = false;
      }
      var located = timeline.locate(state.timelineElapsed);
      if (located) {
        state.progress = located.globalProgress;
        var clipEasing = new EasingCore.Easing(
          located.clip.p[0], located.clip.p[1],
          located.clip.p[2], located.clip.p[3]
        );
        state.timelineValue = clipEasing.valueAt(located.localProgress);
        window._timelineLocal = {
          index: located.index,
          localProgress: located.localProgress,
          value: clipEasing.valueAt(located.localProgress)
        };
      }
    } else {
      state.progress += delta / state.durationMs;
      if (state.progress >= 1) {
        state.progress = 1;
        state.playing = false;
      }
    }
    renderAll();
    if (state.playing) requestAnimationFrame(frame);
  }

  function play() {
    if (state.playing) return;
    if (!state.timelineMode && state.progress >= 1) state.progress = 0;
    if (state.timelineMode && state.timelineElapsed >= timeline.totalDuration()) {
      state.timelineElapsed = 0;
    }
    state.playing = true;
    state.lastFrameTs = 0;
    requestAnimationFrame(frame);
  }

  function pause() {
    state.playing = false;
  }

  function reset() {
    pause();
    state.progress = 0;
    state.timelineElapsed = 0;
    state.timelineValue = 0;
    renderAll();
  }

  /* ---- 控制点拖拽：指针事件，拖动即实时重算重绘 ---- */
  function bindDrag() {
    var canvas = document.getElementById('curveCanvas');

    function pointerPos(evt) {
      var rect = canvas.getBoundingClientRect();
      return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
    }

    function hitTest(pos) {
      var info = window._editorInfo;
      if (!info) return -1;
      var pts = [info.c1, info.c2];
      for (var i = 0; i < pts.length; i++) {
        var dx = pos.x - pts[i].x;
        var dy = pos.y - pts[i].y;
        if (dx * dx + dy * dy <= 14 * 14) return i;
      }
      return -1;
    }

    function updatePoint(index, pos) {
      var area = window._editorInfo.area;
      var u = (pos.x - area.x) / area.w;
      var v = 1 - (pos.y - area.y) / area.h;
      u = Math.max(0, Math.min(1, u));
      v = Math.max(-0.25, Math.min(1.25, v));
      if (index === 0) {
        state.controlPoints[0] = u;
        state.controlPoints[1] = v;
      } else {
        state.controlPoints[2] = u;
        state.controlPoints[3] = v;
      }
      state.driverId = 'custom';
      renderAll();
    }

    canvas.addEventListener('pointerdown', function (evt) {
      var hit = hitTest(pointerPos(evt));
      if (hit >= 0) {
        state.dragIndex = hit;
        canvas.setPointerCapture(evt.pointerId);
        renderAll();
      }
    });
    canvas.addEventListener('pointermove', function (evt) {
      var pos = pointerPos(evt);
      if (state.dragIndex >= 0) {
        updatePoint(state.dragIndex, pos);
      } else {
        canvas.style.cursor = hitTest(pos) >= 0 ? 'grab' : 'default';
      }
    });
    function endDrag(evt) {
      if (state.dragIndex >= 0) {
        state.dragIndex = -1;
        try { canvas.releasePointerCapture(evt.pointerId); } catch (e) {}
        renderAll();
      }
    }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
  }

  window.EasingApp.play = play;
  window.EasingApp.pause = pause;
  window.EasingApp.reset = reset;
  window.EasingApp.bindDrag = bindDrag;

  /* ---- 预设与时间线列表渲染 ---- */
  function optionLabel(item) {
    return item.name + '  [' + item.p.map(function (n) {
      return n.toFixed(2);
    }).join(', ') + ']';
  }

  function refreshSelects() {
    ['driverSelect', 'compareSelect'].forEach(function (selectId) {
      var select = document.getElementById(selectId);
      var current = selectId === 'driverSelect' ? state.driverId : state.compareId;
      select.innerHTML = '';
      store.all().forEach(function (item) {
        var opt = document.createElement('option');
        opt.value = item.id;
        opt.textContent = optionLabel(item);
        select.appendChild(opt);
      });
      var customOpt = document.createElement('option');
      customOpt.value = 'custom';
      customOpt.textContent = '自定义（拖拽控制点）';
      select.appendChild(customOpt);
      var valid = current === 'custom' || store.findById(current);
      var nextValue = valid ? current : store.all()[0].id;
      select.value = nextValue;
      if (selectId === 'driverSelect') state.driverId = nextValue;
      else state.compareId = nextValue;
    });
  }

  function refreshPresetList() {
    var ul = document.getElementById('presetList');
    ul.innerHTML = '';
    store.custom.forEach(function (item) {
      var li = document.createElement('li');
      li.textContent = optionLabel(item) + '  ';
      var del = document.createElement('button');
      del.textContent = '删除';
      del.className = 'mini';
      del.addEventListener('click', function () {
        store.remove(item.id);
        refreshSelects();
        refreshPresetList();
      });
      li.appendChild(del);
      ul.appendChild(li);
    });
  }

  function refreshTimeline() {
    var ul = document.getElementById('timelineList');
    ul.innerHTML = '';
    timeline.clips.forEach(function (clip, index) {
      var li = document.createElement('li');
      li.textContent = (index + 1) + '. ' + clip.name + '（' + clip.durationMs + 'ms）  ';
      var del = document.createElement('button');
      del.textContent = '移除';
      del.className = 'mini';
      del.addEventListener('click', function () {
        timeline.removeAt(index);
        refreshTimeline();
      });
      li.appendChild(del);
      ul.appendChild(li);
    });
    document.getElementById('timelineInfo').textContent =
      timeline.clips.length + ' 个片段，总时长 ' + timeline.totalDuration() + 'ms';
  }

  function activePreset() {
    if (state.driverId === 'custom') {
      return { name: '自定义曲线', p: state.controlPoints.slice() };
    }
    var preset = store.findById(state.driverId);
    return { name: preset.name, p: preset.p.slice() };
  }

  function bindControls() {
    document.getElementById('driverSelect').addEventListener('change', function (evt) {
      state.driverId = evt.target.value;
      renderAll();
    });
    document.getElementById('compareSelect').addEventListener('change', function (evt) {
      state.compareId = evt.target.value;
      renderAll();
    });
    document.getElementById('playBtn').addEventListener('click', play);
    document.getElementById('pauseBtn').addEventListener('click', pause);
    document.getElementById('resetBtn').addEventListener('click', reset);

    document.getElementById('savePresetBtn').addEventListener('click', function () {
      var name = document.getElementById('presetName').value.trim();
      try {
        store.add(name || ('自定义 ' + (store.custom.length + 1)), state.controlPoints.slice());
        document.getElementById('presetName').value = '';
        refreshSelects();
        refreshPresetList();
      } catch (err) {
        window.alert(err.message);
      }
    });

    document.getElementById('uploadTimelineBtn').addEventListener('click', function () {
      timeline.addClip(activePreset());
      refreshTimeline();
    });
    document.getElementById('clearTimelineBtn').addEventListener('click', function () {
      timeline.clear();
      refreshTimeline();
    });
    document.getElementById('playTimelineBtn').addEventListener('click', function () {
      if (timeline.clips.length === 0) return;
      state.timelineMode = true;
      state.timelineElapsed = 0;
      state.progress = 0;
      play();
    });
    document.getElementById('playSingleBtn').addEventListener('click', function () {
      state.timelineMode = false;
      state.progress = 0;
      play();
    });
  }

  function init() {
    refreshSelects();
    refreshPresetList();
    refreshTimeline();
    bindControls();
    bindDrag();
    renderAll();
    global.addEventListener('resize', renderAll);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
