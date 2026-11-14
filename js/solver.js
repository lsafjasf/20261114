/*
 * 配色求解器：先粗网格定位，再逐维贪心微调。
 * 分阶段产出结果，模拟玩家“最多三次提交”的试色过程。
 */
(function (root, factory) {
  const mod = factory(typeof Mixing !== 'undefined' ? Mixing : require('./mixing.js'));
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.Solver = mod;
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';

  function evaluate(amounts, targetLab) {
    return M.deltaE(M.mix(amounts).lab, targetLab);
  }

  function clampAmount(v) {
    return v < 0 ? 0 : v > 100 ? 100 : Math.round(v);
  }

  // 粗网格：7^4 = 2401 个组合，步长 15
  function coarseSearch(targetLab) {
    const grid = [0, 15, 30, 45, 60, 75, 90];
    let best = null, bestDe = Infinity;
    for (const c of grid) for (const m of grid) for (const y of grid) for (const k of grid) {
      const amounts = [c, m, y, k];
      const de = evaluate(amounts, targetLab);
      if (de < bestDe) { bestDe = de; best = amounts; }
    }
    return best.slice();
  }

  // 给定步长做逐维贪心，直到本步长无改进
  function greedyPass(amounts, targetLab, step) {
    let cur = amounts.slice();
    let curDe = evaluate(cur, targetLab);
    let improved = true;
    while (improved) {
      improved = false;
      for (let dim = 0; dim < 4; dim++) {
        for (const dir of [-1, 1]) {
          const trial = cur.slice();
          trial[dim] = clampAmount(trial[dim] + dir * step);
          if (trial[dim] === cur[dim]) continue;
          const de = evaluate(trial, targetLab);
          if (de < curDe - 1e-9) {
            cur = trial; curDe = de; improved = true;
          }
        }
      }
    }
    return cur;
  }

  function refine(amounts, targetLab, steps) {
    let cur = amounts.slice();
    for (const step of steps) cur = greedyPass(cur, targetLab, step);
    return cur;
  }

  // 多起点：粗网格最优 + 抖动重启，避免贪心陷入局部最优
  function bestOfRestarts(targetLab, rng) {
    const starts = [coarseSearch(targetLab)];
    const base = starts[0];
    for (let i = 0; i < 6; i++) {
      starts.push(base.map(function (v) {
        return clampAmount(v + Math.round((rng() - 0.5) * 30));
      }));
    }
    let best = null, bestDe = Infinity;
    for (const start of starts) {
      const cur = refine(start, targetLab, [15, 10, 5, 2, 1]);
      const de = evaluate(cur, targetLab);
      if (de < bestDe) { bestDe = de; best = cur; }
    }
    return best;
  }

  function snapshot(amounts, targetLab) {
    return {
      amounts: amounts.slice(),
      de: evaluate(amounts, targetLab),
      hex: M.mix(amounts).hex
    };
  }

  /*
   * 三个阶段的试色快照：
   * 1) 粗网格（步长 15）
   * 2) 贪心步长 15、10、5
   * 3) 贪心步长 2、1（必要时多起点兜底）
   * 始终返回三个阶段；游戏在任一阶段命中即判定完成。
   */
  function stagedAttempts(targetLab, tolerance) {
    const tol = tolerance || M.TOLERANCE;
    const attempts = [];

    let cur = coarseSearch(targetLab);
    attempts.push(snapshot(cur, targetLab));

    cur = refine(cur, targetLab, [15, 10, 5]);
    attempts.push(snapshot(cur, targetLab));

    cur = refine(cur, targetLab, [2, 1]);
    if (evaluate(cur, targetLab) > tol) {
      const fallback = bestOfRestarts(targetLab,
        M.mulberry32((Math.abs(Math.floor(cur[0] * 1000 + cur[3])) ^ 0x9e3779b9) >>> 0));
      if (evaluate(fallback, targetLab) < evaluate(cur, targetLab)) cur = fallback;
    }
    attempts.push(snapshot(cur, targetLab));
    return attempts;
  }

  function solve(targetLab, rng) {
    const cur = bestOfRestarts(targetLab,
      rng || M.mulberry32((Math.random ? Math.random() * 1e9 : 1234) >>> 0));
    return snapshot(cur, targetLab);
  }

  return { coarseSearch: coarseSearch, greedyPass: greedyPass,
    refine: refine, bestOfRestarts: bestOfRestarts,
    stagedAttempts: stagedAttempts, solve: solve };
});
