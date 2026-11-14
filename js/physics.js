// 双桅帆船物理核心：纯函数/状态机，浏览器与 Node 共用。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Physics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TAU = Math.PI * 2;
  var DEG = Math.PI / 180;

  var WORLD = {
    width: 1600,
    height: 1000,
    // 固定风场：基础风 + 空间变化的阵风带（确定性的，不随时间变）
    wind: {
      baseSpeed: 8.5,          // m/s
      baseDir: 225 * DEG,      // 屏幕坐标"来向"向量：指向左上 = 西北风
      gustAmp: 6.0,            // 阵风带增幅
      dirWaveAmp: 14 * DEG     // 风向空间摆动幅度
    },
    boat: {
      mass: 5200,              // kg（含空压舱）
      ballastMax: 2600,        // 压舱水最大质量 kg
      pumpRate: 0.09,          // 每秒压舱调节量 (0..1)
      sailArea: 86,            // 双桅总帆面积 m^2
      hullSpeedDrag: 0.14,     // 水阻系数
      heelDragK: 0.0006,       // 横倾附加阻力系数 (per rad^2)
      ballastDragK: 0.35,      // 压舱额外阻力权重
      rudderMax: 35 * DEG,
      turnK: 0.16,             // 舵效系数
      sheetMax: 84 * DEG,      // 帆角最大（完全松帆）
      sheetRate: 0.45,         // 帆角调节速度（满量程比例/秒）
      rightingBase: 9500,      // 基础复原力矩 N·m
      rightingBallast: 16000,  // 满压舱附加复原力矩
      heelInertia: 0.22,       // 横倾响应惯性
      capsizeHeel: 58 * DEG,   // 超过即翻覆
      capsizeHold: 0.9,        // 超限持续秒数判定翻覆
      hullMax: 100,
      rockDamageK: 9.0,        // 触礁伤害 ~ 撞击速度
      rockMinSpeed: 1.2        // 低于此速度不扣船体
    },
    // 浮标：必须依次通过（三段航程）
    buoys: [
      { x: 760, y: 190, r: 46, name: '1号浮标' },
      { x: 1390, y: 760, r: 46, name: '2号浮标' },
      { x: 430, y: 800, r: 46, name: '3号浮标' }
    ],
    start: { x: 120, y: 650, heading: 0 }, // 朝正东，避开阵风带出生
    // 礁石群（圆形障碍）
    rocks: [
      { x: 520, y: 380, r: 46 }, { x: 590, y: 330, r: 30 },
      { x: 1050, y: 480, r: 58 }, { x: 1120, y: 540, r: 34 },
      { x: 880, y: 860, r: 44 }, { x: 260, y: 240, r: 38 },
      { x: 1350, y: 300, r: 40 }, { x: 700, y: 640, r: 30 }
    ]
  };

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function wrapAngle(a) {
    while (a > Math.PI) a -= TAU;
    while (a < -Math.PI) a += TAU;
    return a;
  }

  // 固定风场：返回 {vx, vy, speed, dir}（风去向向量）
  function windAt(x, y) {
    var w = WORLD.wind;
    var dir = w.baseDir
      + Math.sin(x * 0.004 + 1.7) * w.dirWaveAmp
      + Math.sin(y * 0.003) * w.dirWaveAmp * 0.6;
    // 阵风带：中部强风走廊
    var band = Math.exp(-Math.pow((y - 430 - 120 * Math.sin(x * 0.003)) / 150, 2));
    var speed = w.baseSpeed + w.gustAmp * band
      + 1.1 * Math.sin(x * 0.011) * Math.cos(y * 0.009);
    // 风"来向"转"去向"向量
    var goDir = dir + Math.PI;
    return { vx: Math.cos(goDir) * speed, vy: Math.sin(goDir) * speed, speed: speed, dir: dir };
  }

  function createState() {
    return {
      x: WORLD.start.x, y: WORLD.start.y,
      heading: WORLD.start.heading,
      vx: 0, vy: 0,
      heel: 0, heelVel: 0,
      sheet: 0.45,        // 0=收满帆 1=全松（帆角 = sheet * sheetMax）
      rudder: 0,          // -1..1（乘 rudderMax）
      ballast: 0.5,       // 0..1
      hull: WORLD.boat.hullMax,
      leg: 0,             // 当前航段 0..2，3=完成
      capsized: false,
      sunk: false,
      finished: false,
      overHeelTime: 0,
      time: 0,
      // 供渲染/音频使用的派生量
      dbg: {
        windSpeed: 0, awa: 0, aws: 0, sailAngle: 0,
        luff: 0, drive: 0, speed: 0, heelDeg: 0
      },
      events: []          // {type:'buoy'|'rock'|'capsize'|'sink'|'finish', ...}
    };
  }

  // 输入: {rudder:-1..1, sheet:-1..1(增减), ballast:-1..1(增减)}
  function step(st, input, dt) {
    if (st.capsized || st.sunk || st.finished) { st.events.length = 0; return st; }
    var B = WORLD.boat;
    st.events.length = 0;
    dt = Math.min(dt, 0.05);

    // --- 控制量 ---
    st.rudder = clamp(st.rudder + (input.rudder || 0) * 2.2 * dt, -1, 1);
    if (!input.rudder) st.rudder *= Math.max(0, 1 - 3.5 * dt); // 舵自动回中
    st.sheet = clamp(st.sheet + (input.sheet || 0) * B.sheetRate * dt, 0, 1);
    st.ballast = clamp(st.ballast + (input.ballast || 0) * B.pumpRate * dt, 0, 1);

    // --- 视风 ---
    var w = windAt(st.x, st.y);
    var awx = w.vx - st.vx, awy = w.vy - st.vy;
    var aws = Math.hypot(awx, awy);
    // 视风相对船首的舷角（+ = 风从右舷来）
    var awa = wrapAngle(Math.atan2(awy, awx) - st.heading + Math.PI);

    // --- 帆力 ---
    var sailAngle = st.sheet * B.sheetMax;          // 帆与船中线夹角
    var absAwa = Math.abs(awa);
    // 最佳帆角约为视风角的一半（简化的帆装极曲线）
    var optSail = clamp(absAwa * 0.5, 6 * DEG, B.sheetMax);
    var trimErr = Math.abs(sailAngle - optSail);
    var trimEff = Math.max(0, Math.cos(trimErr * 1.35));
    // 帆抖动（luff）：帆角过大兜不住风，或正顶风
    var luff = clamp((trimErr - 0.18) * 3.2, 0, 1);
    if (absAwa < 22 * DEG) luff = Math.max(luff, clamp((22 * DEG - absAwa) * 8, 0, 1));
    var pressure = 0.5 * 1.225 * aws * aws * B.sailArea; // 风压 N
    // 帆力曲线：横风最强，正顺风仍有"气囊"推力下限
    var driveShape = 0.3 + 0.7 * Math.sin(absAwa);
    var drive = pressure * trimEff * driveShape * (1 - luff * 0.85);
    // 横倾力矩：横风最强，正顺风/顶风小
    var heelMoment = pressure * trimEff * Math.sin(absAwa) * Math.abs(Math.sin(awa)) * 1.9;

    // --- 横倾动力学 ---
    var rightingMax = B.rightingBase + B.rightingBallast * st.ballast;
    var righting = rightingMax * Math.sin(st.heel);
    var heelAcc = (heelMoment * Math.sign(awa) * Math.cos(st.heel) - righting)
      / (rightingMax * B.heelInertia);
    st.heelVel = (st.heelVel + heelAcc * dt) * Math.max(0, 1 - 1.4 * dt);
    st.heel = clamp(st.heel + st.heelVel * dt, -1.4, 1.4);

    // 翻覆判定：横倾超限持续一段时间
    if (Math.abs(st.heel) > B.capsizeHeel) {
      st.overHeelTime += dt;
      if (st.overHeelTime > B.capsizeHold) {
        st.capsized = true;
        st.events.push({ type: 'capsize' });
      }
    } else st.overHeelTime = Math.max(0, st.overHeelTime - dt * 2);

    // --- 水阻与推进 ---
    var speed = Math.hypot(st.vx, st.vy);
    var dragK = B.hullSpeedDrag
      * (1 + B.ballastDragK * st.ballast)
      + B.heelDragK * st.heel * st.heel * 1000;
    var drag = dragK * speed * speed * 1000; // N
    var driveHeel = drive * Math.cos(st.heel); // 横倾泄风：帆投影面积下降
    var mass = B.mass + B.ballastMax * st.ballast;
    var uvx = speed > 0.01 ? st.vx / speed : 0;
    var uvy = speed > 0.01 ? st.vy / speed : 0;
    var ax = (Math.cos(st.heading) * driveHeel - drag * uvx) / mass;
    var ay = (Math.sin(st.heading) * driveHeel - drag * uvy) / mass;
    // 横向漂移（leeway）：横倾越大越明显
    var leeway = Math.sin(st.heel) * 0.28 * speed;
    ax += Math.cos(st.heading + Math.PI / 2) * leeway;
    ay += Math.sin(st.heading + Math.PI / 2) * leeway;
    st.vx += ax * dt; st.vy += ay * dt;

    // 龙骨侧向阻力：抑制垂直于航向的速度分量
    var hx = Math.cos(st.heading), hy = Math.sin(st.heading);
    var along = st.vx * hx + st.vy * hy;
    var perpX = st.vx - along * hx, perpY = st.vy - along * hy;
    var keel = Math.max(0, 1 - 5.0 * dt);
    st.vx = along * hx + perpX * keel;
    st.vy = along * hy + perpY * keel;

    // --- 舵 ---
    var turn = st.rudder * B.rudderMax * B.turnK * clamp(speed / 4, 0, 1.4);
    st.heading = wrapAngle(st.heading + turn * dt);

    st.x += st.vx * dt; st.y += st.vy * dt;
    st.x = clamp(st.x, 8, WORLD.width - 8);
    st.y = clamp(st.y, 8, WORLD.height - 8);

    // --- 礁石碰撞 ---
    for (var i = 0; i < WORLD.rocks.length; i++) {
      var r = WORLD.rocks[i];
      var dx = st.x - r.x, dy = st.y - r.y;
      var d = Math.hypot(dx, dy);
      if (d < r.r + 10 && d > 0.001) {
        var impact = speed;
        if (impact > B.rockMinSpeed) {
          var dmg = impact * B.rockDamageK;
          st.hull -= dmg;
          st.events.push({ type: 'rock', damage: dmg, x: r.x, y: r.y });
        }
        // 推出礁面并大幅减速
        var push = (r.r + 10 - d);
        st.x += dx / d * push; st.y += dy / d * push;
        st.vx *= 0.25; st.vy *= 0.25;
        if (st.hull <= 0) {
          st.hull = 0; st.sunk = true;
          st.events.push({ type: 'sink' });
        }
      }
    }

    // --- 浮标依次通过 ---
    if (st.leg < WORLD.buoys.length) {
      var b = WORLD.buoys[st.leg];
      if (Math.hypot(st.x - b.x, st.y - b.y) < b.r + 14) {
        st.leg++;
        st.events.push({ type: 'buoy', leg: st.leg, name: b.name });
        if (st.leg >= WORLD.buoys.length) {
          st.finished = true;
          st.events.push({ type: 'finish', time: st.time });
        }
      }
    }

    // --- 派生量 ---
    st.time += dt;
    st.dbg.windSpeed = w.speed;
    st.dbg.awa = awa; st.dbg.aws = aws;
    st.dbg.sailAngle = sailAngle;
    st.dbg.luff = luff;
    st.dbg.drive = drive;
    st.dbg.speed = Math.hypot(st.vx, st.vy);
    st.dbg.heelDeg = st.heel / DEG;
    return st;
  }

  return {
    WORLD: WORLD,
    windAt: windAt,
    createState: createState,
    step: step,
    clamp: clamp,
    wrapAngle: wrapAngle,
    DEG: DEG
  };
});
