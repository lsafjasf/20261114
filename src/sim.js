/* 饮料灌装线调度模拟内核（固定步长、无随机数，Node/浏览器通用） */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CFG = {
    TICK: 0.05,              // 固定步长 50ms
    SPEEDS: { slow: 0.6, normal: 1.0, fast: 1.8 },
    FEED_SPAWN: 2.6,          // 正常速度下每 2.6s 出一瓶（略慢于装箱，稳态安全）
    BRANCH_CAP: 5,           // 支线缓存容量
    DOWN_CAP: 3,             // 下游缓存容量
    BELT_GAP: 0.16,          // 皮带瓶间距
    FEED_CAP: 6,             // 进料皮带容量
    BRANCH_BELT_CAP: 4,
    MERGE_CAP: 3,            // 汇合皮带容量
    BRANCH_OUT: 1.1,         // 支线出口节拍（决定单支线供瓶速度）
    PACK_TIME: 2.4,          // 下游灌装/装箱节拍（瓶颈，10件约需24s）
    JAM_CLEAR_TIME: 2.5,     // 暂停后清堵所需时间
    JAM_OVERFLOW_TIME: 4.0,  // 不暂停时堵点堆满后多久溢出
    JAM_TIMEOUT: 14,         // 堵塞超过该时长未清堵则全线堵瓶失败
    RESUME_DELAY: 1.5,       // 支线重启启动延迟
    SPEED_DELAY: 1.0,        // 变速重启延迟
    DIVERTER_DELAY: 0.9,     // 分流器切换延迟
    WIN_GOODS: 10,
    FLUSH_LEVEL: 2,          // 缓存低于该水位视为清空
    JAM_SCHEDULE: [{ t: 7, lane: 'A' }, { t: 16, lane: 'B' }],
  };

  function createSim(opts) {
    opts = opts || {};
    const cfg = Object.assign({}, CFG, opts.cfg || {});
    const state = {
      cfg,
      time: 0,
      status: 'running',      // running | won | failed
      failReason: '',
      speed: 'normal',
      speedRamp: 0,
      switches: 0,
      goods: 0,
      spawnAcc: 0,
      nextId: 1,
      feed: [],               // 进料皮带上的瓶 {id,p}
      merge: [],              // 汇合皮带上的瓶
      down: { buffer: [], packAcc: 0 },
      diverter: { mode: 'AUTO', timer: 0, lastRoute: 'B' },
      branches: {
        A: makeBranch(),
        B: makeBranch(),
      },
      jamQueue: (opts.jams || cfg.JAM_SCHEDULE).slice(),
      events: [],
      totals: { spawned: 0, packed: 0, overflow: 0 },
    };


    function makeBranch() {
      return {
        paused: false,
        jammed: false,
        jamCleared: false,
        flushed: false,
        clearAcc: 0,
        jamHitAcc: 0,
        resumeTimer: 0,
        outAcc: 0,
        belt: [],
        buffer: [],
      };
    }

    function snapshot() {
      return JSON.parse(JSON.stringify(state));
    }

    function log(ev) {
      ev.t = +state.time.toFixed(2);
      state.events.push(ev);
      if (state.events.length > 60) state.events.shift();
    }

    function fail(reason) {
      if (state.status !== 'running') return;
      state.status = 'failed';
      state.failReason = reason;
      state.totals.overflow++;
      log({ type: 'overflow', reason });
    }

    function speedFactor() {
      if (state.speedRamp > 0) return cfg.SPEEDS.slow; // 启动延迟期间按低速运转
      return cfg.SPEEDS[state.speed];
    }

    function moveBelt(belt, dt, acceptTail) {
      const gap = cfg.BELT_GAP;
      for (let i = 0; i < belt.length; i++) {
        const maxP = i === 0 ? 1 : belt[i - 1].p - gap;
        belt[i].p = Math.min(belt[i].p + dt, maxP);
      }
      if (belt.length && belt[0].p >= 1 && acceptTail()) {
        const bottle = belt.shift();
        if (bottle) bottle.p = 0;
        return bottle;
      }
      return null;
    }

    function step() {
      if (state.status !== 'running') return state;
      const s = state;
      const dtTick = cfg.TICK;
      s.time = +(s.time + dtTick).toFixed(4);
      const f = speedFactor();
      const dt = dtTick * f;

      if (s.speedRamp > 0) s.speedRamp = Math.max(0, s.speedRamp - dtTick);
      if (s.diverter.timer > 0) s.diverter.timer = Math.max(0, s.diverter.timer - dtTick);

      while (s.jamQueue.length && s.jamQueue[0].t <= s.time) {
        const j = s.jamQueue.shift();
        const b0 = s.branches[j.lane];
        b0.jammed = true;
        b0.jamCleared = false;
        b0.flushed = false;
        log({ type: 'jam', lane: j.lane });
      }

      // 1) 进料：按速度节拍生成瓶体颗粒
      s.spawnAcc += dt;
      if (s.spawnAcc >= cfg.FEED_SPAWN) {
        s.spawnAcc = 0;
        if (s.feed.length < cfg.FEED_CAP) {
          s.feed.push({ id: s.nextId++, p: 0 });
          s.totals.spawned++;
        }
      }

      // 2) 进料皮带运动，末端由分流器分配（堵塞/暂停/满瓶的支线会被跳过）
      const head = moveBelt(s.feed, dt, () => {
        if (s.diverter.timer > 0) return false;
        return chooseRoute() !== null;
      });
      if (head) {
        const lane = chooseRoute();
        s.branches[lane].belt.push(head);
      }

      runBranch('A', dt);
      runBranch('B', dt);
      runMerge(dt);
      checkEnd();
      return s;
    }

    function laneAcceptable(lane) {
      const b = state.branches[lane];
      if (b.paused || b.jammed) return false;
      return b.belt.length < cfg.BRANCH_BELT_CAP;
    }

    function chooseRoute() {
      const d = state.diverter;
      // 强制偏向时无视堵塞（误操作会把瓶送往堵点）；仅容量满才挡住
      if (d.mode === 'A') {
        const ba = state.branches.A;
        if (ba.paused || ba.belt.length >= cfg.BRANCH_BELT_CAP) return null;
        return 'A';
      }
      if (d.mode === 'B') {
        const bb = state.branches.B;
        if (bb.paused || bb.belt.length >= cfg.BRANCH_BELT_CAP) return null;
        return 'B';
      }
      const first = d.lastRoute === 'A' ? 'B' : 'A';
      if (laneAcceptable(first)) { d.lastRoute = first; return first; }
      const other = first === 'A' ? 'B' : 'A';
      if (laneAcceptable(other)) { d.lastRoute = other; return other; }
      return null;
    }

    function runBranch(lane, dt) {
      const b = state.branches[lane];
      if (b.resumeTimer > 0) b.resumeTimer = Math.max(0, b.resumeTimer - dt);
      const active = !b.paused && b.resumeTimer === 0;

      if (b.paused && b.jammed) {
        b.clearAcc += state.cfg.TICK;
        if (b.clearAcc >= cfg.JAM_CLEAR_TIME) {
          b.jammed = false;
          b.jamCleared = true;
          b.clearAcc = 0;
          log({ type: 'cleared', lane });
        }
      }

      // 支线皮带：颗粒向堵塞点/缓存运动；堵塞时堆积在皮带上，堆满后仍来瓶则在堵塞点溢出
      const beltRun = b.paused ? 0 : dt;
      const tailOpen = !b.jammed && !b.paused;
      const out = moveBelt(b.belt, beltRun, () => tailOpen);
      if (out) {
        if (b.buffer.length >= cfg.BRANCH_CAP) {
          fail(lane + ' 支线缓存溢出：来瓶撞上满缓存');
          return;
        }
        b.buffer.push(out);
      }
      if (b.jammed && !b.paused && b.belt.length >= cfg.BRANCH_BELT_CAP) {
        b.jamHitAcc = (b.jamHitAcc || 0) + state.cfg.TICK;
        if (b.jamHitAcc >= cfg.JAM_OVERFLOW_TIME) {
          fail(lane + ' 堵塞点溢出：未暂停清堵，瓶体持续撞击堵点');
          return;
        }
      } else {
        b.jamHitAcc = 0;
      }
      if (b.jammed) {
        b.jamTimer = (b.jamTimer || 0) + state.cfg.TICK;
        if (b.jamTimer >= cfg.JAM_TIMEOUT) {
          fail(lane + ' 堵塞超时未处理：全线堵瓶');
          return;
        }
      } else {
        b.jamTimer = 0;
      }

      // 支线出口：缓存向汇合皮带供瓶
      if (active && b.buffer.length) {
        b.outAcc += dt;
        if (b.outAcc >= cfg.BRANCH_OUT) {
          b.outAcc = 0;
          if (state.merge.length < cfg.MERGE_CAP) {
            state.merge.push(b.buffer.shift());
          } else if (state.down.buffer.length >= cfg.DOWN_CAP &&
                     state.merge.length >= cfg.MERGE_CAP) {
            fail(lane + ' 支线顶瓶溢出：下游缓存与汇合皮带均已满');
          }
        }
      }

      if (b.jamCleared && !b.jammed && b.buffer.length <= cfg.FLUSH_LEVEL) {
        b.flushed = true;
      }
    }

    function runMerge(dt) {
      const d = state.down;
      const blocked = d.buffer.length >= cfg.DOWN_CAP;
      const bottle = moveBelt(state.merge, dt, () => !blocked);
      if (bottle) {
        if (d.buffer.length >= cfg.DOWN_CAP) {
          fail('下游缓存溢出：装箱速度跟不上供瓶速度');
          return;
        }
        d.buffer.push(bottle);
      }
      if (d.buffer.length) {
        d.packAcc += dt;
        if (d.packAcc >= cfg.PACK_TIME) {
          d.packAcc = 0;
          d.buffer.shift();
          state.goods++;
          state.totals.packed++;
          log({ type: 'pack', goods: state.goods });
        }
      }
    }

    function checkEnd() {
      if (state.status !== 'running') return;
      const A = state.branches.A;
      const B = state.branches.B;
      const bothFlushed = A.flushed && B.flushed;
      const scheduleDone = state.jamQueue.length === 0;
      if (state.goods >= cfg.WIN_GOODS && bothFlushed && scheduleDone) {
        state.status = 'won';
        log({ type: 'won' });
      }
    }

    const controls = {
      pause(lane) {
        const b = state.branches[lane];
        if (!b || b.paused) return false;
        b.paused = true;
        b.resumeTimer = 0;
        b.clearAcc = 0;
        state.switches++;
        log({ type: 'pause', lane });
        return true;
      },
      resume(lane) {
        const b = state.branches[lane];
        if (!b || !b.paused) return false;
        if (b.jammed) return false;
        b.paused = false;
        b.resumeTimer = cfg.RESUME_DELAY;
        state.switches++;
        log({ type: 'resume', lane });
        return true;
      },
      setSpeed(level) {
        if (!cfg.SPEEDS[level] || state.speed === level) return false;
        state.speed = level;
        state.speedRamp = cfg.SPEED_DELAY;
        state.switches++;
        log({ type: 'speed', level });
        return true;
      },
      setDiverter(mode) {
        if (!['A', 'AUTO', 'B'].includes(mode)) return false;
        if (state.diverter.mode === mode) return false;
        state.diverter.mode = mode;
        state.diverter.timer = cfg.DIVERTER_DELAY;
        state.switches++;
        log({ type: 'diverter', mode });
        return true;
      },
      get snapshot() { return snapshot(); },
    };

    return { cfg, state, step, controls, snapshot };
  }

  const api = { CFG, createSim };
  if (typeof self !== 'undefined') self.createSim = createSim;
  return api;
});
