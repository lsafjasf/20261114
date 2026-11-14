/* 夜间短波测向 —— 纯计算仿真模型（无 DOM 依赖，可在 Node 中单测） */
(function (global) {
  "use strict";

  var NF = global.NF || (global.NF = {});
  var PI = Math.PI;

  NF.CONST = {
    F_MIN: 3000,          // kHz
    F_MAX: 12000,
    WINDOW_HALF: 4,       // 瀑布窗口半宽 kHz
    LOCK_FREQ_TOL: 0.25,  // 频率误差容限 kHz
    LOCK_ANGLE_TOL: 32,   // 天线对准容限 度
    TIME_SCALE: 40,       // 1 真实秒 = 40 现场秒
    START_CLOCK: 22 * 3600,
    RAMP_SECONDS: 480,    // 噪声/干扰在 8 分钟内升至最强
    TONE_CENTER: 700,     // 调谐点对应的音频频率 Hz
    TONE_SLOPE: 260       // 每 kHz 偏移对应的音频偏移 Hz
  };

  // 三个断续信标：频率 kHz、方位角、通断周期、慢漂移
  NF.BEACONS = [
    { id: "B1", name: "信标 α", freq: 4320, bearing: 45,
      on: 7, off: 5, phase: 0, driftAmp: 0.04, driftSpeed: 0.12, driftPhase: 0.4 },
    { id: "B2", name: "信标 β", freq: 7150, bearing: 160,
      on: 6, off: 8, phase: 3, driftAmp: 0.05, driftSpeed: 0.09, driftPhase: 2.1 },
    { id: "B3", name: "信标 γ", freq: 10280, bearing: 275,
      on: 8, off: 6, phase: 7, driftAmp: 0.045, driftSpeed: 0.15, driftPhase: 4.0 }
  ];

  // 游荡的假信标：频率与方位都在缓慢游走，用于误锁验证
  NF.DECOY = {
    id: "D0", name: "游动干扰源", baseFreq: 8460, baseBearing: 200,
    on: 6, off: 7, phase: 4
  };

  // 邻频干扰台：恒定频率、常发、无键控
  NF.INTERFERERS = [
    { id: "I1", freq: 7152.4, bearing: 118, level: 0.95 },
    { id: "I2", freq: 10277.6, bearing: 305, level: 1.0 },
    { id: "I3", freq: 6600, bearing: 20, level: 0.4 }
  ];

  NF.angleDiff = function (a, b) {
    return ((a - b + 540) % 360) - 180;
  };

  // 定向天线方向图：主瓣 + 弱旁瓣 + 底噪
  NF.antGain = function (heading, bearing) {
    var d = Math.abs(NF.angleDiff(heading, bearing));
    var main = Math.pow(Math.max(0, Math.cos(d * PI / 180)), 2.2);
    var side = 0.1 * Math.pow(Math.max(0, Math.cos((d - 150) * PI / 60)), 2);
    return main + side + 0.02;
  };

  NF.beaconOn = function (b, t) {
    var m = (t + b.phase) % (b.on + b.off);
    return m < b.on;
  };

  NF.beaconFreq = function (b, t) {
    return b.freq + b.driftAmp * Math.sin(t * b.driftSpeed + b.driftPhase);
  };

  NF.decoyOn = function (t) {
    var d = NF.DECOY;
    return ((t + d.phase) % (d.on + d.off)) < d.on;
  };

  NF.decoyFreq = function (t) {
    return NF.DECOY.baseFreq
      + 1.2 * Math.sin(t * 2 * PI / 42)
      + 0.3 * Math.sin(t * 2 * PI / 13);
  };

  NF.decoyBearing = function (t) {
    var b = NF.DECOY.baseBearing + 55 * Math.sin(t * 2 * PI / 27 + 1.3);
    return (b + 360) % 360;
  };

  // 邻频干扰强度随时间增强
  NF.ramp = function (t) {
    return Math.min(1, t / NF.CONST.RAMP_SECONDS);
  };

  NF.noiseBase = function (t) {
    return 0.045 + 0.11 * NF.ramp(t);
  };

  NF.toneFor = function (sigFreq, tuned) {
    var c = NF.CONST;
    var f = c.TONE_CENTER + (sigFreq - tuned) * c.TONE_SLOPE;
    return Math.max(55, Math.min(3000, f));
  };

  // 带通滤波幅度近似：半功率点在 ±bw/2
  NF.filterFactor = function (offsetKhz, bwKhz) {
    var x = offsetKhz / (bwKhz / 2);
    return Math.pow(2, -x * x);
  };

  // 汇总当前时刻所有可闻信号（含开关状态、方位、滤波后电平）
  NF.getSignals = function (st) {
    var t = st.simTime, out = [];
    NF.BEACONS.forEach(function (b) {
      var on = NF.beaconOn(b, t);
      var freq = NF.beaconFreq(b, t);
      var off = freq - st.tuned;
      var level = on ? NF.antGain(st.heading, b.bearing)
        * NF.filterFactor(off, st.bw) : 0;
      out.push({ id: b.id, type: "beacon", name: b.name,
        freq: freq, bearing: b.bearing, on: on, offset: off,
        level: level, base: 1.0 });
    });
    var don = NF.decoyOn(t);
    var df = NF.decoyFreq(t), db = NF.decoyBearing(t);
    var doff = df - st.tuned;
    out.push({ id: "D0", type: "decoy", name: NF.DECOY.name,
      freq: df, bearing: db, on: don, offset: doff,
      level: don ? 1.1 * NF.antGain(st.heading, db)
        * NF.filterFactor(doff, st.bw) : 0, base: 1.1 });
    NF.INTERFERERS.forEach(function (it) {
      var off = it.freq - st.tuned;
      var lvl = it.level * (0.55 + 0.45 * NF.ramp(t))
        * NF.antGain(st.heading, it.bearing)
        * NF.filterFactor(off, st.bw);
      out.push({ id: it.id, type: "interferer", name: "邻频干扰 " + it.id,
        freq: it.freq, bearing: it.bearing, on: true, offset: off,
        level: lvl, base: it.level });
    });
    return out;
  };

  NF.passbandLevel = function (st) {
    var sigs = NF.getSignals(st);
    var p = NF.noiseBase(st.simTime) * 0.55;
    sigs.forEach(function (s) { p += s.level * s.level; });
    return Math.min(1, Math.sqrt(p));
  };

  // 记录/定位判定
  NF.evaluateLock = function (st) {
    var c = NF.CONST;
    var sigs = NF.getSignals(st).filter(function (s) {
      return s.on && Math.abs(s.offset) <= c.WINDOW_HALF;
    });
    sigs.sort(function (a, b) { return b.level - a.level; });
    var top = sigs[0];
    if (!top || top.level < 0.06) {
      return { result: "nosignal" };
    }
    if (top.type === "decoy") {
      st.decoyVerified = true;
      return { result: "decoy", signal: top };
    }
    if (top.type === "interferer") {
      return { result: "interferer", signal: top };
    }
    var beacon = NF.BEACONS.filter(function (b) { return b.id === top.id; })[0];
    var angleErr = Math.abs(NF.angleDiff(st.heading, beacon.bearing));
    var freqErr = Math.abs(st.tuned - NF.beaconFreq(beacon, st.simTime));
    if (freqErr > c.LOCK_FREQ_TOL) {
      return { result: "freqerr", signal: top, beacon: beacon,
        freqErr: freqErr, angleErr: angleErr };
    }
    if (angleErr > c.LOCK_ANGLE_TOL) {
      return { result: "angle", signal: top, beacon: beacon,
        freqErr: freqErr, angleErr: angleErr };
    }
    if (st.locks[beacon.id]) {
      return { result: "duplicate", signal: top, beacon: beacon,
        freqErr: freqErr };
    }
    st.locks[beacon.id] = {
      recorded: st.tuned,
      actual: NF.beaconFreq(beacon, st.simTime),
      error: freqErr,
      bearing: beacon.bearing,
      simTime: st.simTime
    };
    return { result: "locked", signal: top, beacon: beacon,
      freqErr: freqErr };
  };

  NF.missionComplete = function (st) {
    return NF.BEACONS.every(function (b) { return st.locks[b.id]; })
      && st.decoyVerified;
  };

  NF.createState = function () {
    return {
      started: false,
      simTime: 0,
      heading: 90,
      tuned: 5850,
      bw: 1.2,
      volume: 0.6,
      locks: {},
      decoyVerified: false,
      logs: []
    };
  };

  NF.formatMHz = function (khz) {
    return (khz / 1000).toFixed(4) + " MHz";
  };

  NF.formatClock = function (simSeconds) {
    var total = (NF.CONST.START_CLOCK + simSeconds * NF.CONST.TIME_SCALE)
      % 86400;
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = Math.floor(total % 60);
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(h) + ":" + p(m) + ":" + p(s);
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = NF;
  }
})(typeof window !== "undefined" ? window : globalThis);
