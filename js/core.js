/* 温度序列修复核心逻辑：可在浏览器与 Node 中复用（无 DOM 依赖） */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TempCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STRATEGIES = {
    LINEAR: 'linear',
    NEIGHBOR: 'neighbor',
    FFORWARD: 'fforward'
  };

  const STRATEGY_LABELS = {
    linear: '线性插值',
    neighbor: '邻居平均',
    fforward: '保持前值'
  };

  const ANOMALY_LABELS = {
    gap_short: '短时断点',
    spike: '错误尖峰',
    gap_long: '长时断点',
    stuck: '传感器卡死'
  };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const DEFAULT_SEGMENTS = [
    { id: 'A', type: 'gap_short', start: 20, end: 23, strategy: 'linear' },
    { id: 'B', type: 'spike', start: 40, end: 41, strategy: 'linear' },
    { id: 'C', type: 'gap_long', start: 60, end: 69, strategy: 'linear' },
    { id: 'D', type: 'stuck', start: 85, end: 90, strategy: 'linear' }
  ];

  function generateSeries(options) {
    const opts = Object.assign({ count: 120, seed: 20261114, stepMinutes: 5 }, options || {});
    const segments = (options && options.segments) || DEFAULT_SEGMENTS;
    const rand = mulberry32(opts.seed);
    const points = [];
    const start = new Date('2026-11-14T00:00:00Z').getTime();
    for (let i = 0; i < opts.count; i++) {
      const t = new Date(start + i * opts.stepMinutes * 60000).toISOString();
      const base = 22 + 4 * Math.sin((i / opts.count) * Math.PI * 2) + (rand() - 0.5) * 0.4;
      points.push({ index: i, time: t, clean: round1(base), raw: round1(base), flagged: null });
    }
    segments.forEach(function (seg) {
      for (let i = seg.start; i <= seg.end && i < opts.count; i++) {
        points[i].flagged = seg.id;
        if (seg.type === 'gap_short' || seg.type === 'gap_long') {
          points[i].raw = null;
        } else if (seg.type === 'spike') {
          points[i].raw = round1(points[i].clean + (i % 2 === 0 ? 18 : -12));
        } else if (seg.type === 'stuck') {
          points[i].raw = round1(points[seg.start - 1] ? points[seg.start - 1].raw : points[i].clean);
        }
      }
    });
    return { points: points, segments: segments.map(function (s) { return Object.assign({}, s); }) };
  }

  function round1(v) {
    return Math.round(v * 10) / 10;
  }

  function findBoundary(points, index, direction) {
    let i = index + direction;
    while (i >= 0 && i < points.length) {
      if (points[i].flagged === null && points[i].raw !== null) return points[i];
      i += direction;
    }
    return null;
  }

  function applyStrategy(points, segment, strategy) {
    const values = points.map(function (p) { return p.raw; });
    const result = [];
    for (let i = segment.start; i <= segment.end && i < points.length; i++) {
      let value = null;
      let note = '';
      const prev = findBoundary(points, i, -1);
      const next = findBoundary(points, i, 1);
      if (strategy === STRATEGIES.FFORWARD) {
        value = prev ? prev.raw : (next ? next.raw : null);
        note = prev ? '' : '无前值，回退使用后值';
      } else if (strategy === STRATEGIES.NEIGHBOR) {
        if (prev && next) value = (prev.raw + next.raw) / 2;
        else if (prev) value = prev.raw;
        else if (next) value = next.raw;
      } else {
        if (prev && next) {
          const ratio = (i - prev.index) / (next.index - prev.index);
          value = prev.raw + (next.raw - prev.raw) * ratio;
        } else if (prev) {
          value = prev.raw;
          note = '区间在边界，退化为保持前值';
        } else if (next) {
          value = next.raw;
          note = '区间在边界，退化为保持后值';
        }
      }
      values[i] = value === null ? null : round1(value);
      result.push({ index: i, value: values[i], note: note });
    }
    return { values: values, filled: result };
  }

  function repairSeries(points, segments) {
    const repaired = points.map(function (p) {
      return { index: p.index, time: p.time, clean: p.clean, raw: p.raw,
        repaired: p.raw, flagged: p.flagged, status: p.flagged ? 'pending' : 'original' };
    });
    const summary = [];
    segments.forEach(function (seg) {
      const applied = applyStrategy(points, seg, seg.strategy);
      let replaced = 0;
      applied.filled.forEach(function (item) {
        const p = repaired[item.index];
        p.repaired = item.value;
        p.status = item.value === null ? 'unfilled' : 'replaced';
        p.note = item.note;
        if (p.status === 'replaced') replaced++;
      });
      summary.push({ id: seg.id, type: seg.type, strategy: seg.strategy,
        start: seg.start, end: seg.end, replaced: replaced });
    });
    return { points: repaired, summary: summary };
  }

  function computeDiff(repairedPoints) {
    let changed = 0;
    let sumAbs = 0;
    let maxAbs = 0;
    let maxIndex = -1;
    repairedPoints.forEach(function (p) {
      if (p.status === 'replaced') {
        const rawValue = p.raw === null ? null : p.raw;
        const d = rawValue === null ? null : Math.abs(p.repaired - rawValue);
        changed++;
        if (d !== null) {
          sumAbs += d;
          if (d > maxAbs) { maxAbs = d; maxIndex = p.index; }
        }
      }
    });
    return { replaced: changed,
      meanAbsDelta: changed ? round1(sumAbs / changed) : 0,
      maxAbsDelta: round1(maxAbs), maxIndex: maxIndex };
  }

  function csvEscape(value) {
    if (value === null || value === undefined) return '';
    const s = String(value);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(repairedPoints) {
    const header = ['index', 'time', 'raw_c', 'repaired_c', 'status', 'flag', 'delta_c'];
    const lines = [header.join(',')];
    repairedPoints.forEach(function (p) {
      const delta = p.status === 'replaced' && p.raw !== null
        ? round1(p.repaired - p.raw) : '';
      lines.push([
        p.index,
        csvEscape(p.time),
        p.raw === null ? '' : p.raw,
        p.repaired === null ? '' : p.repaired,
        csvEscape(p.status),
        csvEscape(p.flagged || ''),
        delta
      ].join(','));
    });
    return lines.join('\n') + '\n';
  }

  return {
    STRATEGIES,
    STRATEGY_LABELS,
    ANOMALY_LABELS,
    DEFAULT_SEGMENTS,
    mulberry32,
    generateSeries,
    applyStrategy,
    repairSeries,
    computeDiff,
    toCSV
  };
});
