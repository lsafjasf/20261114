'use strict';

(function () {
  var Core = window.LoopCore;
  var D = Core.DURATION, W = Core.WIDTH, H = Core.HEIGHT;

  var els = {
    seedInput: document.getElementById('seedInput'),
    regenBtn: document.getElementById('regenBtn'),
    randomBtn: document.getElementById('randomBtn'),
    fixToggle: document.getElementById('fixToggle'),
    modeBadge: document.getElementById('modeBadge'),
    stage: document.getElementById('stage'),
    playBtn: document.getElementById('playBtn'),
    firstBtn: document.getElementById('firstBtn'),
    lastBtn: document.getElementById('lastBtn'),
    scrubber: document.getElementById('scrubber'),
    timeRead: document.getElementById('timeRead'),
    roundCount: document.getElementById('roundCount'),
    loop3Btn: document.getElementById('loop3Btn'),
    offlineBtn: document.getElementById('offlineBtn'),
    loopStatus: document.getElementById('loopStatus'),
    firstCanvas: document.getElementById('firstCanvas'),
    lastCanvas: document.getElementById('lastCanvas'),
    heatCanvas: document.getElementById('heatCanvas'),
    rawMetrics: document.getElementById('rawMetrics'),
    fixMetrics: document.getElementById('fixMetrics'),
    snapTable: document.getElementById('snapTable'),
    copyBtn: document.getElementById('copyBtn'),
    downloadBtn: document.getElementById('downloadBtn'),
    loadBtn: document.getElementById('loadBtn'),
    fileInput: document.getElementById('fileInput'),
    jsonView: document.getElementById('jsonView'),
    ioStatus: document.getElementById('ioStatus')
  };

  var state = {
    rawParams: null,
    fixedParams: null,
    corrected: false,
    t: 0,
    playing: false,
    rafId: null,
    wallStart: 0,
    baseTime: 0,
    loopRounds: 0,
    loopTarget: 0,
    lastSeamReport: null
  };

  function currentParams() {
    return state.corrected ? state.fixedParams : state.rawParams;
  }

  function frame(ctx, params, t) {
    Core.renderFrame(ctx, params, Math.min(t, D));
    return ctx.getImageData(0, 0, W, H);
  }

  function put(canvas, imageData) {
    canvas.getContext('2d').putImageData(imageData, 0, 0);
  }

  function fmt(n, digits) {
    if (!isFinite(n)) return '–';
    return n.toFixed(digits === undefined ? 3 : digits);
  }

  /* ---------------- seam analysis ---------------- */

  function analyzeSeam(params) {
    var ctx = els.stage.getContext('2d');
    var first = frame(ctx, params, 0);
    var last = frame(ctx, params, D);
    var stats = Core.diffStats(first, last);
    var heat = ctx.createImageData(W, H);
    Core.buildHeatmap(first, last, heat);
    return { first: first, last: last, heat: heat, stats: stats };
  }

  function metricRows(r) {
    var c = r.stats.channelMae;
    return [
      ['MAE 平均像素差', fmt(r.stats.mae, 4)],
      ['RMSE 均方根差', fmt(r.stats.rmse, 4)],
      ['最大单通道差', fmt(r.stats.max, 1) + ' / 255'],
      ['变化像素占比', fmt(r.stats.changedPct, 3) + ' %'],
      ['通道 MAE (R/G/B)', fmt(c.r, 3) + ' / ' + fmt(c.g, 3) + ' / ' + fmt(c.b, 3)]
    ];
  }

  function renderMetrics(el, report, okThreshold) {
    var bad = report.stats.mae > okThreshold;
    var rows = metricRows(report).map(function (kv) {
      return '<div class="metric-row"><span>' + kv[0] + '</span><b>' + kv[1] + '</b></div>';
    }).join('');
    var badge = bad
      ? '<span class="badge bad">明显跳变</span>'
      : '<span class="badge good">接缝连续</span>';
    el.innerHTML = badge + rows;
  }

  function renderSnapTable() {
    var rows = Core.describeSnaps(state.rawParams, state.fixedParams);
    var html = '<tr><th>元素</th><th>频率字段</th><th>修正前 Hz</th><th>修正后 Hz</th><th>8s 内周期数</th></tr>';
    html += rows.map(function (r) {
      return '<tr><td>' + r.item + '</td><td>' + r.field +
        '</td><td>' + fmt(r.raw, 4) + '</td><td class="delta-good">' +
        fmt(r.corrected, 4) + '</td><td>' + r.cycles + '</td></tr>';
    }).join('');
    els.snapTable.innerHTML = html;
  }

  function refreshSeamPanels() {
    var rawReport = analyzeSeam(state.rawParams);
    var fixReport = analyzeSeam(state.fixedParams);
    state.lastSeamReport = { raw: rawReport, fixed: fixReport };

    renderMetrics(els.rawMetrics, rawReport, 1);
    renderMetrics(els.fixMetrics, fixReport, 1);
    renderSnapTable();

    var active = state.corrected ? fixReport : rawReport;
    put(els.firstCanvas, active.first);
    put(els.lastCanvas, active.last);
    put(els.heatCanvas, active.heat);

    var reduction = (1 - fixReport.stats.mae / rawReport.stats.mae) * 100;
    els.loopStatus.textContent =
      '接缝 MAE 从 ' + fmt(rawReport.stats.mae, 3) + ' 降到 ' +
      fmt(fixReport.stats.mae, 5) + '，降低 ' + fmt(reduction, 2) + '%。';
    updateModeBadge();
  }

  function updateModeBadge() {
    if (state.corrected) {
      els.modeBadge.textContent = '已修正 · 整数周期闭环';
      els.modeBadge.className = 'badge good';
    } else {
      els.modeBadge.textContent = '未修正 · 接缝断开';
      els.modeBadge.className = 'badge bad';
    }
  }

  /* ---------------- JSON ---------------- */

  function buildExport() {
    return {
      generator: 'loop-seam-inspector',
      version: 1,
      duration: D,
      seedInput: els.seedInput.value,
      normalizedSeed: state.rawParams.seed,
      correction: {
        enabled: state.corrected,
        rule: 'snap every motion frequency to nearest k/8 Hz (integer cycles over 8s)'
      },
      rawParams: state.rawParams,
      correctedParams: state.fixedParams
    };
  }

  function refreshJson() {
    els.jsonView.textContent = JSON.stringify(buildExport(), null, 2);
  }

  /* ---------------- playback ---------------- */

  function drawStage() {
    var ctx = els.stage.getContext('2d');
    Core.renderFrame(ctx, currentParams(), state.t);
    els.scrubber.value = String(state.t);
    els.timeRead.textContent = 't = ' + fmt(state.t, 2) + ' s';
  }

  function stopPlayback() {
    state.playing = false;
    if (state.rafId) cancelAnimationFrame(state.rafId);
    state.rafId = null;
    els.playBtn.textContent = '▶ 播放';
  }

  function tick(now) {
    if (!state.playing) return;
    var elapsed = (now - state.wallStart) / 1000 + state.baseTime;
    var rounds = Math.floor(elapsed / D);
    state.t = elapsed % D;
    state.loopRounds = rounds;
    els.roundCount.textContent = String(Math.min(rounds, state.loopTarget || 99));
    drawStage();

    if (state.loopTarget && rounds >= state.loopTarget) {
      stopPlayback();
      state.loopTarget = 0;
      state.t = 0;
      drawStage();
      els.roundCount.textContent = '3';
      els.loopStatus.textContent = '已连续播放 3 轮：' +
        (state.corrected ? '接缝无跳变，颜色与形状连续。' : '每次回到首帧均出现明显跳变（见热图）。');
      return;
    }
    state.rafId = requestAnimationFrame(tick);
  }

  function play(targetRounds) {
    state.playing = true;
    state.wallStart = performance.now();
    state.baseTime = state.t;
    state.loopRounds = 0;
    state.loopTarget = targetRounds || 0;
    els.playBtn.textContent = '⏸ 暂停';
    state.rafId = requestAnimationFrame(tick);
  }

  /* ---------------- offline 30fps x 3 rounds ---------------- */

  function offlineAnalysis() {
    els.loopStatus.textContent = '离线分析中（30fps × 8s × 3 轮 × 两种模式）…';
    var fps = 30, frames = fps * D;
    setTimeout(function () {
      var out = ['rawParams', 'fixedParams'].map(function (key) {
        var params = state[key];
        var ctx = els.stage.getContext('2d');
        var prev = frame(ctx, params, 0);
        var interSum = 0, interN = 0, interMax = 0;
        var wrapSum = 0, wrapMax = 0, wrapRows = [];
        for (var round = 0; round < 3; round++) {
          for (var k = 1; k <= frames; k++) {
            var img = frame(ctx, params, (k % frames) / fps);
            var st = Core.diffStats(prev, img);
            if (k === frames) {
              wrapSum += st.mae; wrapMax = Math.max(wrapMax, st.max);
              wrapRows.push(st.mae);
            } else {
              interSum += st.mae; interN++; interMax = Math.max(interMax, st.max);
            }
            prev = img;
          }
        }
        return {
          mode: key === 'rawParams' ? '修正前' : '修正后',
          wrapMeanMae: wrapSum / 3,
          wrapMax: wrapMax,
          wrapPerRound: wrapRows,
          interMeanMae: interSum / interN,
          interMax: interMax,
          ratio: (wrapSum / 3) / (interSum / interN)
        };
      });
      var r = out[0], f = out[1];
      els.loopStatus.innerHTML =
        '离线结果 — 修正前接缝 MAE <b class="delta-bad">' + fmt(r.wrapMeanMae, 3) +
        '</b>（普通帧差 ' + fmt(r.interMeanMae, 3) + '，比值 ' + fmt(r.ratio, 2) + '×）；' +
        '修正后接缝 MAE <b class="delta-good">' + fmt(f.wrapMeanMae, 4) +
        '</b>（普通帧差 ' + fmt(f.interMeanMae, 3) + '，比值 ' + fmt(f.ratio, 2) + '×）。' +
        '三轮接缝 MAE 完全一致：' + f.wrapPerRound.map(function (v) { return fmt(v, 5); }).join(' = ');
    }, 30);
  }

  /* ---------------- (re)build params ---------------- */

  function rebuild(seedValue) {
    stopPlayback();
    state.rawParams = Core.makeParams(seedValue);
    state.fixedParams = Core.snapParams(state.rawParams);
    state.t = 0;
    state.loopRounds = 0;
    els.roundCount.textContent = '0';
    refreshSeamPanels();
    refreshJson();
    drawStage();
  }

  function setCorrected(on) {
    stopPlayback();
    state.corrected = on;
    state.t = 0;
    refreshSeamPanels();
    refreshJson();
    drawStage();
  }

  /* ---------------- events ---------------- */

  els.regenBtn.addEventListener('click', function () {
    rebuild(els.seedInput.value || 'demo-seed-2026');
  });
  els.randomBtn.addEventListener('click', function () {
    var s = 'seed-' + Math.floor(Math.random() * 1e9).toString(36);
    els.seedInput.value = s;
    rebuild(s);
  });
  els.fixToggle.addEventListener('change', function () {
    setCorrected(els.fixToggle.checked);
  });
  els.playBtn.addEventListener('click', function () {
    if (state.playing) {
      state.baseTime += (performance.now() - state.wallStart) / 1000;
      stopPlayback();
    } else {
      play(0);
    }
  });
  els.firstBtn.addEventListener('click', function () {
    stopPlayback(); state.t = 0; drawStage();
  });
  els.lastBtn.addEventListener('click', function () {
    stopPlayback(); state.t = D; drawStage();
  });
  els.scrubber.addEventListener('input', function () {
    stopPlayback();
    state.t = parseFloat(els.scrubber.value);
    drawStage();
  });
  els.loop3Btn.addEventListener('click', function () {
    stopPlayback();
    state.t = 0;
    els.roundCount.textContent = '0';
    play(3);
  });
  els.offlineBtn.addEventListener('click', offlineAnalysis);

  els.copyBtn.addEventListener('click', function () {
    var text = els.jsonView.textContent;
    navigator.clipboard.writeText(text).then(function () {
      els.ioStatus.textContent = 'JSON 已复制到剪贴板。';
    }).catch(function () {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      els.ioStatus.textContent = 'JSON 已复制（兼容路径）。';
    });
  });
  els.downloadBtn.addEventListener('click', function () {
    var blob = new Blob([els.jsonView.textContent], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'loop-params-seed-' + state.rawParams.seed + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  els.loadBtn.addEventListener('click', function () { els.fileInput.click(); });
  els.fileInput.addEventListener('change', function () {
    var file = els.fileInput.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        var raw = data.rawParams || data.params || data;
        if (!raw.blobs || !raw.duration) throw new Error('缺少必要字段');
        stopPlayback();
        state.rawParams = raw;
        state.fixedParams = data.correctedParams || Core.snapParams(raw);
        state.corrected = !!data.correction && !!data.correction.enabled;
        els.fixToggle.checked = state.corrected;
        els.seedInput.value = data.seedInput !== undefined ? String(data.seedInput) : String(raw.seed);
        state.t = 0;
        refreshSeamPanels(); refreshJson(); drawStage();
        els.ioStatus.textContent = '已载入 JSON 并重新计算接缝。';
      } catch (e) {
        els.ioStatus.textContent = '载入失败：' + e.message;
      }
    };
    reader.readAsText(file);
    els.fileInput.value = '';
  });

  rebuild('demo-seed-2026');
})();
