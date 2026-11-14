/* 温度序列修复工具：界面交互与状态管理 */
(function () {
  'use strict';

  const Core = window.TempCore;
  const Chart = window.TempChart;

  const state = {
    series: null,
    result: null,
    compare: false,
    chartMeta: null,
    hoverIndex: null
  };

  const el = {
    canvas: document.getElementById('chart'),
    tooltip: document.getElementById('tooltip'),
    segments: document.getElementById('segment-list'),
    legendRaw: document.getElementById('legend-raw'),
    legendRepaired: document.getElementById('legend-repaired'),
    stats: document.getElementById('stats'),
    seedInput: document.getElementById('seed')
  };

  function regenerate() {
    const seed = Number(el.seedInput.value) || 20261114;
    state.series = Core.generateSeries({ seed: seed });
    renderSegmentControls();
    runRepair();
  }

  function runRepair() {
    state.result = Core.repairSeries(state.series.points, state.series.segments);
    state.chartMeta = Chart.draw(el.canvas, state.series.points,
      state.series.segments, state.result.points, { showRaw: state.compare });
    renderStats();
  }

  function renderSegmentControls() {
    el.segments.innerHTML = '';
    state.series.segments.forEach(function (seg) {
      const row = document.createElement('div');
      row.className = 'segment-row';
      const name = Core.ANOMALY_LABELS[seg.type] + ' [' + seg.id + '] ' +
        '#' + seg.start + '–#' + seg.end;
      const select = document.createElement('select');
      Object.keys(Core.STRATEGY_LABELS).forEach(function (key) {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = Core.STRATEGY_LABELS[key];
        if (seg.strategy === key) option.selected = true;
        select.appendChild(option);
      });
      select.addEventListener('change', function () {
        seg.strategy = select.value;
        runRepair();
      });
      const label = document.createElement('span');
      label.className = 'segment-name';
      label.textContent = name;
      row.appendChild(label);
      row.appendChild(select);
      el.segments.appendChild(row);
    });
  }

  function renderStats() {
    const diff = Core.computeDiff(state.result.points);
    const rows = state.result.summary.map(function (s) {
      return '<tr><td>' + s.id + '</td><td>' + Core.ANOMALY_LABELS[s.type] +
        '</td><td>' + Core.STRATEGY_LABELS[s.strategy] +
        '</td><td>' + s.replaced + ' 点</td></tr>';
    }).join('');
    el.stats.innerHTML =
      '<table><thead><tr><th>区间</th><th>异常</th><th>策略</th><th>替换量</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<p class="diff-line">共替换 <b>' + diff.replaced + '</b> 点；' +
      '平均偏差 <b>' + diff.meanAbsDelta + '°C</b>；' +
      '最大偏差 <b>' + diff.maxAbsDelta + '°C</b>（#' + diff.maxIndex + '）</p>';
  }

  function toggleCompare() {
    state.compare = !state.compare;
    el.legendRaw.style.display = state.compare ? '' : 'none';
    state.chartMeta = Chart.draw(el.canvas, state.series.points,
      state.series.segments, state.result.points, { showRaw: state.compare });
    document.getElementById('compare').textContent =
      state.compare ? '退出对照' : '原始/修复对照';
  }

  function downloadCSV() {
    const csv = Core.toCSV(state.result.points);
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'temperature-repaired.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function onHover(event) {
    if (!state.chartMeta) return;
    const index = Chart.hitTest(el.canvas, event, state.chartMeta.sc,
      state.chartMeta.range, state.series.points);
    if (index === null) return;
    state.hoverIndex = index;
    const original = state.series.points[index];
    const fixed = state.result.points[index];
    const delta = fixed.status === 'replaced' && original.raw !== null
      ? (fixed.repaired - original.raw).toFixed(1) : '—';
    const seg = state.series.segments.find(function (s) {
      return s.id === original.flagged;
    });
    el.tooltip.innerHTML =
      '<b>#' + index + ' · ' + original.time.slice(11, 16) + '</b><br>' +
      '原始：' + (original.raw === null ? '缺失' : original.raw + '°C') + '<br>' +
      '修复：' + (fixed.repaired === null ? '未填' : fixed.repaired + '°C') +
      (seg ? '（' + Core.STRATEGY_LABELS[seg.strategy] + '）' : '') + '<br>' +
      '偏差：' + delta + '°C';
    el.tooltip.style.display = 'block';
    const rect = el.canvas.getBoundingClientRect();
    el.tooltip.style.left = Math.min(event.clientX - rect.left + 14, rect.width - 170) + 'px';
    el.tooltip.style.top = (event.clientY - rect.top + 14) + 'px';
  }

  window.addEventListener('DOMContentLoaded', function () {
    document.getElementById('regen').addEventListener('click', regenerate);
    document.getElementById('apply-all').addEventListener('click', function () {
      const strategy = document.getElementById('bulk-strategy').value;
      state.series.segments.forEach(function (s) { s.strategy = strategy; });
      renderSegmentControls();
      runRepair();
    });
    document.getElementById('compare').addEventListener('click', toggleCompare);
    document.getElementById('download').addEventListener('click', downloadCSV);
    el.canvas.addEventListener('mousemove', onHover);
    el.canvas.addEventListener('mouseleave', function () {
      el.tooltip.style.display = 'none';
      state.hoverIndex = null;
    });
    regenerate();
  });

  window.__tempApp = { state: state, regenerate: regenerate, runRepair: runRepair };
})();
