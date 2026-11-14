// game-core.js -- 双人协同舞台灯光：纯逻辑核心（浏览器与 Node 模拟共用）
(function (global) {
  const CFG = {
    width: 960,
    height: 600,
    floorY: 470,
    lightX: [250, 710],
    lightY: 80,
    tempMin: 2200,
    tempMax: 6500,
    tempRate: 900,        // 色温调节速度 K/s
    tempMatch: 250,       // 两灯色温允许偏差 K
    tempDrift: 40,        // 灯具老化导致的色温漂移幅度 K/s
    brightRate: 0.5,      // 亮度调节速度 /s
    brightMin: 0.35,      // 合格照明最低亮度
    aimSpeed: 430,        // 目标点移动速度 px/s
    motorMaxVel: 1.7,     // 电机最大角速度 rad/s
    heatPerRad: 70,       // 每弧度转角产热
    coolRate: 10,         // 常态散热 /s
    overheatCool: 3.0,    // 过热冷却秒数
    spreadMin: 0.07,
    spreadMax: 0.30,
    spreadRate: 0.22,     // 扩散调节速度 rad/s
    spreadMaxQual: 0.24,  // 超过则照度不足，不计合格
    coverFactor: 0.85,    // 光锥有效覆盖系数
    darkLimit: 3.5,       // 连续不合格照明秒数 -> 暗场事故
    darkGrace: 2.0,       // 开局宽限秒数
    segNeed: [5, 6, 6, 7, 7], // 每段所需合格照明秒数
    actorSpeedBase: 0.05,
    actorSpeedPerSeg: 0.016,
  };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // 演员弧线（二次贝塞尔）
  function actorPos(s) {
    const p0 = { x: 130, y: 455 }, p1 = { x: 480, y: 345 }, p2 = { x: 830, y: 455 };
    const u = 1 - s;
    return {
      x: u * u * p0.x + 2 * u * s * p1.x + s * s * p2.x,
      y: u * u * p0.y + 2 * u * s * p1.y + s * s * p2.y,
    };
  }

  function kelvinToRgb(k) {
    const t = clamp(k, 1000, 12000) / 100;
    let r, g, b;
    r = t <= 66 ? 255 : clamp(329.698727446 * Math.pow(t - 60, -0.1332047592), 0, 255);
    g = t <= 66 ? clamp(99.4708025861 * Math.log(t) - 161.1195681661, 0, 255)
                : clamp(288.1221695283 * Math.pow(t - 60, -0.0755148492), 0, 255);
    b = t >= 66 ? 255 : t <= 19 ? 0 : clamp(138.5177312231 * Math.log(t - 10) - 305.0447927307, 0, 255);
    return [Math.round(r), Math.round(g), Math.round(b)];
  }

  function createGame() {
    return {
      time: 0,
      status: 'running', // running | won | failed
      failReason: '',
      segment: 0,
      segmentProgress: 0,
      actorS: 0.5,
      actorDir: 1,
      aimX: 480,
      spread: 0.15,
      brightness: 0.8,
      darkTimer: 0,
      qualified: false,
      lights: [0, 1].map(i => ({
        x: CFG.lightX[i],
        y: CFG.lightY,
        temp: 3200 + i * 300,
        angle: Math.atan2(CFG.floorY - CFG.lightY, 480 - CFG.lightX[i]),
        heat: 0,
        overheated: false,
        coolLeft: 0,
        covered: false,
      })),
      events: [],
    };
  }

  function step(st, input, dt) {
    if (st.status !== 'running') return;
    st.time += dt;
    const L = st.lights;

    // 左侧玩家：两灯色温 + 总亮度
    L[0].temp = clamp(L[0].temp + (input.temp1 || 0) * CFG.tempRate * dt, CFG.tempMin, CFG.tempMax);
    L[1].temp = clamp(L[1].temp + (input.temp2 || 0) * CFG.tempRate * dt, CFG.tempMin, CFG.tempMax);
    st.brightness = clamp(st.brightness + (input.brightness || 0) * CFG.brightRate * dt, 0, 1);
    // 灯具老化漂移（两灯漂移节律不同，需持续校正）
    L[0].temp = clamp(L[0].temp + Math.sin(st.time * 0.45) * CFG.tempDrift * dt, CFG.tempMin, CFG.tempMax);
    L[1].temp = clamp(L[1].temp + Math.cos(st.time * 0.38) * CFG.tempDrift * dt, CFG.tempMin, CFG.tempMax);

    // 右侧玩家：方向（目标点）+ 扩散范围
    st.aimX = clamp(st.aimX + (input.aim || 0) * CFG.aimSpeed * dt, 60, CFG.width - 60);
    st.spread = clamp(st.spread + (input.spread || 0) * CFG.spreadRate * dt, CFG.spreadMin, CFG.spreadMax);

    // 电机追光与过热
    for (let i = 0; i < 2; i++) {
      const lt = L[i];
      if (lt.overheated) {
        lt.coolLeft -= dt;
        lt.heat = Math.max(0, lt.heat - (100 / CFG.overheatCool) * dt);
        if (lt.coolLeft <= 0) {
          lt.overheated = false;
          lt.heat = 0;
          st.events.push({ type: 'cooled', light: i, t: st.time });
        }
        continue;
      }
      const desired = Math.atan2(CFG.floorY - lt.y, st.aimX - lt.x);
      const dAng = clamp(desired - lt.angle, -CFG.motorMaxVel * dt, CFG.motorMaxVel * dt);
      lt.angle += dAng;
      lt.heat += Math.abs(dAng) * CFG.heatPerRad;
      lt.heat = Math.max(0, lt.heat - CFG.coolRate * dt);
      if (lt.heat >= 100) {
        lt.heat = 100;
        lt.overheated = true;
        lt.coolLeft = CFG.overheatCool;
        st.events.push({ type: 'overheat', light: i, t: st.time });
      }
    }

    // 演员沿弧线往返移动
    const speed = CFG.actorSpeedBase + st.segment * CFG.actorSpeedPerSeg;
    st.actorS += st.actorDir * speed * dt;
    if (st.actorS > 1) { st.actorS = 1; st.actorDir = -1; }
    if (st.actorS < 0) { st.actorS = 0; st.actorDir = 1; }

    // 合格照明判定：双灯覆盖 + 色温接近 + 亮度与扩散达标
    const actor = actorPos(st.actorS);
    let allCovered = true;
    for (const lt of L) {
      const angToActor = Math.atan2(actor.y - lt.y, actor.x - lt.x);
      lt.covered = !lt.overheated && Math.abs(angToActor - lt.angle) <= st.spread * CFG.coverFactor;
      if (!lt.covered) allCovered = false;
    }
    const tempOk = Math.abs(L[0].temp - L[1].temp) <= CFG.tempMatch;
    st.qualified = allCovered && tempOk &&
      st.brightness >= CFG.brightMin && st.spread <= CFG.spreadMaxQual;

    if (st.qualified) {
      st.segmentProgress += dt;
      st.darkTimer = Math.max(0, st.darkTimer - 2 * dt);
    } else if (st.time > CFG.darkGrace) {
      st.darkTimer += dt;
      if (st.darkTimer >= CFG.darkLimit) {
        st.status = 'failed';
        st.failReason = '暗场事故：演员失去合格照明超过 ' + CFG.darkLimit + ' 秒';
        st.events.push({ type: 'fail', t: st.time });
        return;
      }
    }

    if (st.segmentProgress >= CFG.segNeed[st.segment]) {
      st.events.push({ type: 'segment', n: st.segment + 1, t: st.time });
      st.segment += 1;
      st.segmentProgress = 0;
      if (st.segment >= CFG.segNeed.length) {
        st.status = 'won';
        st.events.push({ type: 'win', t: st.time });
      }
    }
  }

  const api = { CFG, clamp, actorPos, kelvinToRgb, createGame, step };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.StageLightCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
