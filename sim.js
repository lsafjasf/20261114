// 池塘生态模拟核心：纯逻辑，不依赖 DOM，浏览器与 Node 均可加载。
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PondSim = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  const WIN_TIME = 300; // 稳定运行目标：5 分钟
  const BLOOM_THRESHOLD = 70; // 藻类超过该值视为藻华风险
  const BLOOM_HOLD = 8; // 需持续秒数
  const FISH_DECLINE_HOLD = 25; // 鱼群连续下降秒数
  const DIVERSITY_MIN = 0.45; // 中等多样性区间（Simpson 指数）
  const DIVERSITY_MAX = 0.67;

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function createState() {
    return {
      t: 0,
      nutrients: 35, // 营养盐
      phyto: 40, // 浮游植物
      algae: 15, // 藻类
      fish: 30, // 小鱼
      oxygen: 80, // 溶解氧
      transparency: 60,
      diversity: 0,
      activity: 0, // 活动密度（驱动声音）
      bloomTimer: 0,
      fishDeclineTimer: 0,
      declineStartFish: 30,
      prevFish: 30,
      status: "running", // running | win | fail
      failReason: null,
      events: [],
    };
  }

  // input: { light:0..1, feed:0..1, dose:0..1, waterChange:boolean }
  function step(s, input, dt) {
    if (s.status !== "running") return s;
    const light = clamp(input.light || 0, 0, 1);
    const feed = clamp(input.feed || 0, 0, 1);
    const dose = clamp(input.dose || 0, 0, 1);

    // 换水：稀释营养与藻类，补充氧气
    if (input.waterChange) {
      s.nutrients *= 0.5;
      s.algae *= 0.7;
      s.phyto *= 0.9;
      s.oxygen = clamp(s.oxygen + 25, 0, 100);
      s.events.push({ t: s.t, type: "waterChange" });
    }

    // 投喂 -> 营养盐
    s.nutrients = clamp(s.nutrients + feed * 6 * dt, 0, 100);

    // 藻类浮于表层遮光，浮游植物实际接收的光照打折
    const effLight = light * (1 - 0.6 * (s.algae / 100));

    // 浮游植物：光 + 营养驱动生长，被鱼摄食，药剂过量会误伤
    const pGrow = 0.09 * effLight * (s.nutrients / (s.nutrients + 25)) * s.phyto * (1 - s.phyto / 100);
    const pEaten = 0.02 * s.fish * (s.phyto / (s.phyto + 30));
    const pDose = dose * 6 * (s.phyto / 100);
    s.phyto = clamp(s.phyto + (pGrow - pEaten - pDose) * dt, 0, 100);

    // 藻类：高营养下增长更快（藻华风险源）
    const aGrow = 0.05 * light * (s.nutrients / (s.nutrients + 15)) * s.algae * (1 - s.algae / 100);
    const aDose = dose * 10 * (s.algae / 100);
    s.algae = clamp(s.algae + (aGrow - aDose) * dt, 0, 100);

    // 小鱼：依赖浮游植物与氧气
    const foodRatio = s.phyto / (s.phyto + 25);
    const fGrow = 0.03 * s.fish * foodRatio * (s.oxygen / 100) * (1 - s.fish / 80);
    const fStarve = 0.02 * s.fish * (1 - foodRatio);
    const fHypoxia = s.oxygen < 30 ? 0.06 * s.fish * (1 - s.oxygen / 30) : 0;
    s.fish = clamp(s.fish + (fGrow - fStarve - fHypoxia) * dt, 0, 100);

    // 溶解氧：浮游植物光合产氧，生物呼吸与藻类分解耗氧，大气复氧
    const oProd = 2.0 * effLight * (s.phyto / 40);
    const oCons = 0.012 * s.fish + 0.004 * s.phyto + 0.02 * s.algae * (s.algae / 100);
    const oReaeration = 0.03 * (75 - s.oxygen);
    s.oxygen = clamp(s.oxygen + (oProd - oCons + oReaeration) * dt, 0, 100);

    // 营养盐缓慢被消耗/沉降
    s.nutrients = clamp(s.nutrients - 0.15 * (s.phyto / 50 + s.algae / 50) * dt, 0, 100);

    // 水体透明度
    s.transparency = clamp(100 - 0.6 * (s.phyto + s.algae), 5, 100);

    // 多样性：Simpson 指数（1 - Σp²），平衡群落自然落在中等区间
    const total = s.phyto + s.algae + s.fish;
    if (total > 1) {
      let sumSq = 0;
      for (const v of [s.phyto, s.algae, s.fish]) {
        const p = v / total;
        sumSq += p * p;
      }
      s.diversity = 1 - sumSq;
    } else {
      s.diversity = 0;
    }

    // 活动密度：各量变化速率之和（供声音强度使用）
    s.activity = clamp(
      (Math.abs(pGrow - pEaten) + Math.abs(aGrow) + Math.abs(fGrow - fStarve - fHypoxia)) * 8,
      0,
      1
    );

    // 失败判定：藻华
    if (s.algae >= BLOOM_THRESHOLD) {
      s.bloomTimer += dt;
      if (s.bloomTimer >= BLOOM_HOLD) return fail(s, "藻华爆发：藻类失控，水体缺氧");
    } else {
      s.bloomTimer = Math.max(0, s.bloomTimer - dt);
    }

    // 失败判定：鱼群连续下降且跌幅显著（>25%），或灭绝
    if (s.fish < s.prevFish - 1e-9) {
      s.fishDeclineTimer += dt;
    } else {
      s.fishDeclineTimer = 0;
      s.declineStartFish = s.fish;
    }
    s.prevFish = s.fish;
    if (s.fish <= 2) return fail(s, "鱼群灭绝");
    if (s.fishDeclineTimer >= FISH_DECLINE_HOLD) {
      if (s.fish < 0.75 * s.declineStartFish) {
        return fail(s, "鱼群数量连续下降，生态崩溃");
      }
      s.fishDeclineTimer = 0; // 缓慢收敛不算崩溃，重新计时
      s.declineStartFish = s.fish;
    }

    // 胜利判定：稳定运行 5 分钟且多样性中等
    s.t += dt;
    if (s.t >= WIN_TIME) {
      if (s.diversity >= DIVERSITY_MIN && s.diversity <= DIVERSITY_MAX) {
        s.status = "win";
      } else {
        return fail(s, "多样性失衡：未保持在中间区间");
      }
    }
    return s;
  }

  function fail(s, reason) {
    s.status = "fail";
    s.failReason = reason;
    return s;
  }

  return {
    createState,
    step,
    WIN_TIME,
    BLOOM_THRESHOLD,
    DIVERSITY_MIN,
    DIVERSITY_MAX,
  };
});
