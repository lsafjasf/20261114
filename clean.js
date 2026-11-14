/*
 * 潮汐 CSV 清洗模块：解析、排序、去重、补缺、异常标记。
 * 同时支持浏览器 (window.TidalClean) 与 Node (module.exports)，便于自动化验证。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TidalClean = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // 解析 CSV 文本，返回带原始行号（含表头，从 1 开始）的记录
  function parseCSV(text) {
    const lines = text.split(/\r?\n/);
    const rows = [];
    let headerSeen = false;
    for (let i = 0; i < lines.length; i++) {
      const lineNo = i + 1;
      const raw = lines[i];
      if (raw.trim() === "") continue;
      const cells = raw.split(",").map((c) => c.trim());
      if (!headerSeen && /[a-zA-Z一-龥]/.test(cells[0]) && isNaN(Date.parse(cells[0]))) {
        headerSeen = true;
        continue; // 表头行
      }
      rows.push({
        row: lineNo,
        timeRaw: cells[0] || "",
        aRaw: cells.length > 1 ? cells[1] : "",
        bRaw: cells.length > 2 ? cells[2] : "",
      });
    }
    return rows;
  }

  function toNumber(s) {
    if (s === "" || s == null) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  // 无时区信息的 ISO 本地时间一律按 UTC 解析，保证结果与运行环境时区无关
  function parseTime(s) {
    let norm = s.trim().replace(" ", "T");
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(norm)) {
      norm += "Z";
    }
    return Date.parse(norm);
  }

  function median(sorted) {
    const n = sorted.length;
    if (n === 0) return 0;
    const mid = n >> 1;
    return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /*
   * 稳健尖峰检测：以滑动窗口中位数为基准求残差，
   * 再对残差做 中位数 + MAD 检验。对潮汐这类平滑周期信号
   * 不会把正常波峰波谷误判为异常。
   */
  function detectAnomalies(values, k, halfWindow) {
    const w = halfWindow == null ? 3 : halfWindow;
    const residuals = values.map((v, i) => {
      if (v == null) return null;
      const neighbors = [];
      for (let j = Math.max(0, i - w); j <= Math.min(values.length - 1, i + w); j++) {
        if (j !== i && values[j] != null) neighbors.push(values[j]);
      }
      if (!neighbors.length) return 0;
      neighbors.sort((x, y) => x - y);
      return v - median(neighbors);
    });
    const valid = residuals.filter((r) => r != null).map(Math.abs).sort((x, y) => x - y);
    const mad = median(valid) || 1e-6;
    const sigma = 1.4826 * mad;
    return residuals.map((r) => r != null && Math.abs(r) > k * sigma);
  }

  /*
   * 清洗主流程。
   * 返回 {
   *   points: [{t, a, b, row, aFilled, bFilled, aAnomaly, bAnomaly}],
   *   report: {...}
   * }
   */
  function clean(text, options) {
    const opts = Object.assign({ anomalyK: 5 }, options || {});
    const rawRows = parseCSV(text);
    const report = {
      totalRows: rawRows.length,
      invalidRows: [],
      duplicatesRemoved: [],
      missingFilled: [],
      anomalies: [],
    };

    // 1. 解析时间戳，剔除无法解析的行
    const parsed = [];
    for (const r of rawRows) {
      const t = parseTime(r.timeRaw);
      if (isNaN(t)) {
        report.invalidRows.push({ row: r.row, timeRaw: r.timeRaw });
        continue;
      }
      parsed.push({ t, row: r.row, a: toNumber(r.aRaw), b: toNumber(r.bRaw) });
    }

    // 2. 乱序时间戳 -> 按时间升序（稳定排序保留原始先后）
    parsed.sort((p, q) => (p.t - q.t) || (p.row - q.row));

    // 3. 去重：同一时间戳保留先出现的记录
    const deduped = [];
    for (const p of parsed) {
      const last = deduped[deduped.length - 1];
      if (last && last.t === p.t) {
        report.duplicatesRemoved.push({
          t: p.t,
          keptRow: last.row,
          removedRow: p.row,
        });
        continue;
      }
      deduped.push(p);
    }

    // 4. 缺失值：线性插值（端点用最近邻）
    for (const key of ["a", "b"]) {
      const station = key === "a" ? "station_a" : "station_b";
      for (let i = 0; i < deduped.length; i++) {
        if (deduped[i][key] != null) continue;
        let lo = i - 1;
        while (lo >= 0 && deduped[lo][key] == null) lo--;
        let hi = i + 1;
        while (hi < deduped.length && deduped[hi][key] == null) hi++;
        let filled;
        if (lo >= 0 && hi < deduped.length) {
          const t0 = deduped[lo].t, t1 = deduped[hi].t;
          const v0 = deduped[lo][key], v1 = deduped[hi][key];
          filled = v0 + ((v1 - v0) * (deduped[i].t - t0)) / (t1 - t0);
        } else if (lo >= 0) {
          filled = deduped[lo][key];
        } else if (hi < deduped.length) {
          filled = deduped[hi][key];
        } else {
          filled = 0;
        }
        filled = Math.round(filled * 1000) / 1000;
        deduped[i][key] = filled;
        deduped[i][key === "a" ? "aFilled" : "bFilled"] = true;
        report.missingFilled.push({
          t: deduped[i].t,
          row: deduped[i].row,
          station,
          value: filled,
        });
      }
    }

    // 5. 异常标记（对补缺后的完整序列做稳健检测）
    const aFlags = detectAnomalies(deduped.map((p) => p.a), opts.anomalyK);
    const bFlags = detectAnomalies(deduped.map((p) => p.b), opts.anomalyK);
    const points = deduped.map((p, i) => {
      const pt = {
        t: p.t,
        a: p.a,
        b: p.b,
        row: p.row,
        aFilled: !!p.aFilled,
        bFilled: !!p.bFilled,
        aAnomaly: aFlags[i],
        bAnomaly: bFlags[i],
      };
      if (aFlags[i]) {
        report.anomalies.push({ t: p.t, row: p.row, station: "station_a", value: p.a });
      }
      if (bFlags[i]) {
        report.anomalies.push({ t: p.t, row: p.row, station: "station_b", value: p.b });
      }
      return pt;
    });

    report.outputRows = points.length;
    return { points, report };
  }

  return { parseCSV, clean, detectAnomalies };
});
