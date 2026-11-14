// autopilot.js -- 左右两个 AI 角色，演示一次真正的协同配合
(function (global) {
  const Core = typeof module !== 'undefined' ? require('./game-core.js') : global.StageLightCore;
  const { CFG, clamp, actorPos } = Core;

  // 左控台 AI：负责两灯色温对齐与亮度维持
  function leftController(st) {
    const a = st.lights[0].temp, b = st.lights[1].temp;
    const mean = (a + b) / 2;
    const band = 40; // 死区，避免来回抖动
    return {
      temp1: a < mean - band ? 1 : a > mean + band ? -1 : 0,
      temp2: b < mean - band ? 1 : b > mean + band ? -1 : 0,
      brightness: st.brightness < 0.8 ? 1 : 0,
    };
  }

  // 右追光 AI：负责目标点跟随与扩散匹配，同时控制电机温度
  function rightController(st) {
    const actor = actorPos(st.actorS);
    const maxHeat = Math.max(st.lights[0].heat, st.lights[1].heat);
    const anyHot = st.lights.some(l => l.overheated);
    const dx = actor.x - st.aimX;
    let aim = 0;
    if (Math.abs(dx) > 10) {
      // 越接近过热越放慢追光，过热时完全松手
      const throttle = anyHot ? 0 : maxHeat > 75 ? 0.3 : maxHeat > 55 ? 0.6 : 1;
      aim = Math.sign(dx) * throttle;
    }
    // 需要的扩散角：覆盖两灯中偏差较大的一侧，留少量余量
    let need = CFG.spreadMin;
    for (const lt of st.lights) {
      const angToActor = Math.atan2(actor.y - lt.y, actor.x - lt.x);
      need = Math.max(need, Math.abs(angToActor - lt.angle) / CFG.coverFactor + 0.02);
    }
    const target = clamp(need, CFG.spreadMin, CFG.spreadMaxQual - 0.02);
    return {
      aim,
      spread: st.spread < target - 0.01 ? 1 : st.spread > target + 0.01 ? -1 : 0,
    };
  }

  function autoInput(st) {
    return Object.assign(leftController(st), rightController(st));
  }

  const api = { leftController, rightController, autoInput };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.StageLightAuto = api;
})(typeof window !== 'undefined' ? window : globalThis);
