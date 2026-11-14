/* 早高峰路口调度 - 仿真内核（浏览器 / Node 共用） */
(function (global) {
  'use strict';

  var APPROACHES = ['N', 'E', 'S', 'W'];
  var AXIS = { N: 'NS', S: 'NS', E: 'EW', W: 'EW' };

  var DEFAULTS = {
    duration: 180,        // 挑战时长（秒）
    queueLimit: 16,       // 每进口排队阈值（辆）
    storage: 26,          // 进口物理容量，超过则回堵上游
    ewGreen: 32,
    nsGreen: 28,
    yellow: 3,
    leftFirst: true,      // 轴内先放行左转
    saturation: 0.5,      // 每车道饱和流率（辆/秒）
    thruLanes: 2,         // 每进口直行/右转车道数
    startupLoss: 2.0,     // 相位启动损失（秒）
    leftShare: 0.4,       // 轴绿灯中左转相位占比
    seed: 20261114
  };

  // 早高峰到达率（辆/秒）与左转比例
  var ARRIVAL = {
    N: { rate: 0.17, left: 0.20 },
    E: { rate: 0.27, left: 0.22 },
    S: { rate: 0.18, left: 0.20 },
    W: { rate: 0.29, left: 0.25 }
  };

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function phasePlan(opts) {
    function split(axisGreen) {
      var left = Math.round(axisGreen * opts.leftShare);
      left = Math.max(5, Math.min(axisGreen - 6, left));
      return { left: left, thru: axisGreen - left };
    }
    var ew = split(opts.ewGreen);
    var ns = split(opts.nsGreen);
    var ewPhases = opts.leftFirst
      ? [{ axis: 'EW', lane: 'left', dur: ew.left }, { axis: 'EW', lane: 'thru', dur: ew.thru }]
      : [{ axis: 'EW', lane: 'thru', dur: ew.thru }, { axis: 'EW', lane: 'left', dur: ew.left }];
    var nsPhases = opts.leftFirst
      ? [{ axis: 'NS', lane: 'left', dur: ns.left }, { axis: 'NS', lane: 'thru', dur: ns.thru }]
      : [{ axis: 'NS', lane: 'thru', dur: ns.thru }, { axis: 'NS', lane: 'left', dur: ns.left }];
    var seq = [];
    ewPhases.forEach(function (p) { seq.push(p); });
    seq.push({ axis: null, lane: null, dur: opts.yellow, clearance: true });
    nsPhases.forEach(function (p) { seq.push(p); });
    seq.push({ axis: null, lane: null, dur: opts.yellow, clearance: true });
    return seq;
  }

  function createSim(userOpts) {
    var opts = {};
    for (var k in DEFAULTS) opts[k] = DEFAULTS[k];
    if (userOpts) for (var k2 in userOpts) opts[k2] = userOpts[k2];

    var rand = mulberry32(opts.seed);

    // 到达间隔 = 60% 指数随机 + 40% 均匀，均值 1/rate，降低突发方差
    function interarrival(rate) {
      return (-Math.log(1 - rand()) * 0.5 + 0.5) / rate;
    }

    var lanes = {};
    var nextArrival = {};
    APPROACHES.forEach(function (a) {
      lanes[a] = { left: 0, thru: 0 };
      nextArrival[a] = interarrival(ARRIVAL[a].rate);
    });

    var seq = phasePlan(opts);
    var sim = {
      opts: opts,
      t: 0,
      phaseIndex: 0,
      phaseT: 0,
      lanes: lanes,
      passed: 0,
      blocked: 0,
      greenBusy: 0,
      greenTotal: 0,
      switches: 0,
      failed: false,
      failReason: null,
      finished: false,
      dischargeAcc: {},
      seq: seq,
      waitArea: 0
    };
    APPROACHES.forEach(function (a) {
      sim.dischargeAcc[a] = { left: 0, thru: 0 };
    });

    function currentPhase() { return seq[sim.phaseIndex]; }

    function queueOf(a) { return lanes[a].left + lanes[a].thru; }

    sim.queues = function () {
      var q = {};
      APPROACHES.forEach(function (a) { q[a] = queueOf(a); });
      return q;
    };

    sim.maxQueue = function () {
      var m = 0;
      APPROACHES.forEach(function (a) { m = Math.max(m, queueOf(a)); });
      return m;
    };

    sim.efficiency = function () {
      return sim.greenTotal > 0 ? sim.greenBusy / sim.greenTotal : 0;
    };

    sim.avgWait = function () {
      return sim.passed > 0 ? sim.waitArea / sim.passed : 0;
    };

    sim.phase = currentPhase;

    // 运行中调整配时：重建相位序列，从当前轴起点重新计时
    sim.reconfigure = function (userOpts) {
      for (var k in userOpts) opts[k] = userOpts[k];
      sim.opts = opts;
      seq.length = 0;
      phasePlan(opts).forEach(function (p) { seq.push(p); });
      sim.phaseIndex = 0;
      sim.phaseT = 0;
      APPROACHES.forEach(function (a) {
        sim.dischargeAcc[a].left = 0;
        sim.dischargeAcc[a].thru = 0;
      });
    };

    sim.step = function (dt) {
      if (sim.finished) return;
      sim.t += dt;
      var ph = currentPhase();

      APPROACHES.forEach(function (a) {
        nextArrival[a] -= dt;
        while (nextArrival[a] <= 0) {
          nextArrival[a] += interarrival(ARRIVAL[a].rate);
          if (queueOf(a) >= opts.storage) {
            sim.blocked += 1;
          } else {
            if (rand() < ARRIVAL[a].left) lanes[a].left += 1;
            else lanes[a].thru += 1;
          }
        }
      });

      if (ph.axis) {
        sim.greenTotal += dt;
        if (sim.phaseT >= opts.startupLoss) {
          var active = false;
          APPROACHES.forEach(function (a) {
            if (AXIS[a] !== ph.axis) return;
            var lane = ph.lane;
            if (lanes[a][lane] > 0) {
              active = true;
              var rate = opts.saturation * (lane === 'thru' ? opts.thruLanes : 1);
              sim.dischargeAcc[a][lane] += dt * rate;
              while (sim.dischargeAcc[a][lane] >= 1 && lanes[a][lane] > 0) {
                sim.dischargeAcc[a][lane] -= 1;
                lanes[a][lane] -= 1;
                sim.passed += 1;
              }
            }
          });
          if (active) sim.greenBusy += dt;
        }
      }

      APPROACHES.forEach(function (a) { sim.waitArea += queueOf(a) * dt; });

      sim.phaseT += dt;
      if (sim.phaseT >= ph.dur) {
        sim.phaseT = 0;
        sim.phaseIndex = (sim.phaseIndex + 1) % seq.length;
        sim.switches += 1;
        APPROACHES.forEach(function (a) {
          sim.dischargeAcc[a].left = 0;
          sim.dischargeAcc[a].thru = 0;
        });
      }

      for (var i = 0; i < APPROACHES.length; i++) {
        var a = APPROACHES[i];
        if (queueOf(a) > opts.queueLimit) {
          sim.failed = true;
          sim.finished = true;
          sim.failReason = a;
          return;
        }
      }
      if (sim.t >= opts.duration) sim.finished = true;
    };

    return sim;
  }

  function optimize(seeds) {
    var results = [];
    var best = null;
    for (var ew = 16; ew <= 44; ew += 4) {
      for (var ns = 12; ns <= 44; ns += 4) {
        for (var y = 2; y <= 4; y += 1) {
          for (var lf = 0; lf <= 1; lf++) {
            var passAll = true;
            var effSum = 0, waitSum = 0, maxQ = 0, blockedSum = 0;
            for (var s = 0; s < seeds.length; s++) {
              var sim = createSim({
                ewGreen: ew, nsGreen: ns, yellow: y,
                leftFirst: lf === 1, seed: seeds[s]
              });
              while (!sim.finished) sim.step(0.1);
              if (sim.failed) { passAll = false; break; }
              effSum += sim.efficiency();
              waitSum += sim.avgWait();
              maxQ = Math.max(maxQ, sim.maxQueue());
              blockedSum += sim.blocked;
            }
            if (!passAll) continue;
            var n = seeds.length;
            var score = (effSum / n) * 100 - (waitSum / n) * 0.8
              - maxQ * 1.5 - Math.max(0, maxQ - 11) * 8 - blockedSum * 0.05;
            var cand = {
              ewGreen: ew, nsGreen: ns, yellow: y, leftFirst: lf === 1,
              score: score, eff: effSum / n, wait: waitSum / n, maxQueue: maxQ
            };
            results.push(cand);
            if (!best || cand.score > best.score) best = cand;
          }
        }
      }
    }
    return { best: best, tested: results.length };
  }

  var API = {
    createSim: createSim,
    optimize: optimize,
    APPROACHES: APPROACHES,
    AXIS: AXIS,
    ARRIVAL: ARRIVAL,
    DEFAULTS: DEFAULTS
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.TrafficSim = API;
})(typeof window !== 'undefined' ? window : globalThis);
