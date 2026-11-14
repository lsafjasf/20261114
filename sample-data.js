/*
 * 内置样例：确定性生成 72 小时两站潮位数据，并注入三类数据问题：
 *   1) 乱序时间戳  2) 缺失值  3) 重复记录
 * 另注入 2 个尖峰用于验证异常标记。
 * 浏览器 (window.SAMPLE_CSV) 与 Node (module.exports) 均可用。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SAMPLE_CSV = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const START = Date.UTC(2026, 10, 1, 0, 0, 0); // 2026-11-01 00:00 UTC
  const HOURS = 72;

  function tide(hour, phase, base, amp) {
    // 半日潮 + 全日潮分量 + 确定性微扰
    const m2 = amp * Math.sin((2 * Math.PI * hour) / 12.42 + phase);
    const k1 = 0.45 * Math.sin((2 * Math.PI * hour) / 24.84 + phase * 0.5);
    const jitter = 0.03 * Math.sin(hour * 12.9898);
    return Math.round((base + m2 + k1 + jitter) * 1000) / 1000;
  }

  function iso(ms) {
    return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
  }

  function build() {
    const rows = [];
    for (let h = 0; h < HOURS; h++) {
      const t = START + h * 3600 * 1000;
      let a = tide(h, 0.0, 2.5, 1.8);
      let b = tide(h, 0.9, 2.3, 1.6);
      rows.push({ h, t, a: String(a), b: String(b) });
    }

    // 注入尖峰异常：第 15 小时 A 站暴冲，第 60 小时 B 站异常跌落
    rows[15].a = "9.870";
    rows[60].b = "-3.450";

    // 注入缺失值：第 10 小时 A 站、第 33 小时 B 站、第 48 小时 A 站
    rows[10].a = "";
    rows[33].b = "";
    rows[48].a = "";

    // 注入重复记录：第 30 小时完全重复；第 55 小时数值略异的重复
    const dup30 = Object.assign({}, rows[30]);
    const dup55 = Object.assign({}, rows[55], { a: "2.001" });

    // 组装输出行（乱序：第 20 小时移到第 25 小时之后；第 40/41 小时互换）
    const order = [];
    for (let h = 0; h < HOURS; h++) order.push(h);
    order.splice(20, 1);
    order.splice(25, 0, 20);
    const tmp = order[40];
    order[40] = order[41];
    order[41] = tmp;

    const lines = ["timestamp,station_a,station_b"];
    for (const h of order) {
      const r = rows[h];
      lines.push(`${iso(r.t)},${r.a},${r.b}`);
      if (h === 30) lines.push(`${iso(dup30.t)},${dup30.a},${dup30.b}`);
      if (h === 55) lines.push(`${iso(dup55.t)},${dup55.a},${dup55.b}`);
    }
    return lines.join("\n") + "\n";
  }

  return build();
});
